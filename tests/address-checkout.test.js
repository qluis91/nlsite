const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const addressService = require('../services/addressService');
const customerOrderService = require('../services/customerOrderService');
const adminOrderService = require('../services/adminOrderService');
const { validateAddress } = require('../validators/addressValidator');
const { migrateUserAddresses } = require('../scripts/migrate-user-addresses');

const marker = `codex_address_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const ownerEmail = `${marker}@example.invalid`;
const otherEmail = `${marker}_other@example.invalid`;
const limitEmail = `${marker}_limit@example.invalid`;
const password = `Test-${crypto.randomBytes(8).toString('hex')}!`;
const port = 35000 + Math.floor(Math.random() * 500);
const fixture = {
  ownerId: null,
  otherId: null,
  limitId: null,
  productId: null,
  addressIds: [],
  orderRefs: [],
};
let serverProcess;

function request(method, requestPath, body, jar = {}) {
  return new Promise((resolve, reject) => {
    let payload = null;
    const headers = {};
    if (body) {
      payload = Buffer.from(new URLSearchParams(body).toString());
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = payload.length;
    }
    if (jar.cookie) headers.Cookie = jar.cookie;
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: requestPath, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.headers['set-cookie']?.[0]) jar.cookie = res.headers['set-cookie'][0].split(';')[0];
          resolve({ status: res.statusCode, data, location: res.headers.location || '' });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function hidden(html, name) {
  const match = html.match(new RegExp(`name="${name}"\\s+value="([^"]+)"`));
  assert.ok(match, `${name} should be rendered`);
  return match[1];
}

async function login(jar, email = ownerEmail, returnTo = '/cuenta') {
  const page = await request('GET', `/auth/login?returnTo=${encodeURIComponent(returnTo)}`, null, jar);
  const response = await request('POST', '/auth/login', {
    email,
    password,
    returnTo,
    _csrf: hidden(page.data, '_csrf'),
  }, jar);
  assert.equal(response.status, 302);
  return response;
}

async function addProductToCart(jar) {
  let page = await request('GET', `/tienda/${marker}`, null, jar);
  if (!/name="_csrf"\s+value="[^"]+"/.test(page.data)) {
    page = await request('GET', '/auth/login', null, jar);
  }
  const response = await request('POST', '/carrito/agregar', {
    productId: String(fixture.productId),
    quantity: '1',
    returnTo: '/carrito',
    _csrf: hidden(page.data, '_csrf'),
  }, jar);
  assert.equal(response.status, 302);
}

function validAddress(label, extra = {}) {
  return {
    label,
    province: 'San José',
    canton: 'Central',
    district: 'Carmen',
    addressLine: `Dirección ${label} ${marker}`,
    addressReference: 'Frente al parque',
    contactPhone: '8888-7777',
    ...extra,
  };
}

function checkoutPayload(page, extra = {}) {
  return {
    _csrf: hidden(page.data, '_csrf'),
    checkoutToken: hidden(page.data, 'checkoutToken'),
    customerName: 'Cliente Checkout',
    email: ownerEmail,
    phone: '+506 7000 1234',
    deliveryMethod: 'private_courier',
    paymentMethod: 'sinpe',
    addressChoice: 'manual',
    province: 'Alajuela',
    canton: 'Alajuela',
    distrito: 'San José',
    addressLine: 'Dirección manual controlada',
    addressReference: 'Portón negro',
    ...extra,
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await request('GET', '/', null, {});
      if (response.status === 200) return;
    } catch (_error) {
      // Retry while the isolated server connects.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Isolated address test server did not start');
}

async function cleanup() {
  if (fixture.orderRefs.length) {
    await pool.query(
      `DELETE FROM orders WHERE order_reference IN (${fixture.orderRefs.map(() => '?').join(',')})`,
      fixture.orderRefs
    );
  }
  if (fixture.productId) await pool.query('DELETE FROM products WHERE id = ?', [fixture.productId]);
  const userIds = [fixture.ownerId, fixture.otherId, fixture.limitId].filter(Boolean);
  if (userIds.length) {
    await pool.query(`DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`, userIds);
  }
  await pool.query('DELETE FROM sessions WHERE data LIKE ?', [`%${marker}%`]);
}

test.before(async () => {
  await migrateUserAddresses();
  await migrateUserAddresses();
  const hash = await bcrypt.hash(password, 8);
  const [owner] = await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,?,1)',
    ['Cliente Direcciones', ownerEmail, hash, 2]
  );
  const [other] = await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,?,1)',
    ['Cliente Ajeno', otherEmail, hash, 2]
  );
  const [limit] = await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,?,1)',
    ['Cliente Límite', limitEmail, hash, 2]
  );
  fixture.ownerId = owner.insertId;
  fixture.otherId = other.insertId;
  fixture.limitId = limit.insertId;
  const [product] = await pool.query(
    `INSERT INTO products
      (name,slug,regular_price,stock_quantity,is_active,is_published)
     VALUES (?,?,2500,100,1,1)`,
    [`Producto ${marker}`, marker, 100]
  );
  fixture.productId = product.insertId;

  serverProcess = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForServer();
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  await cleanup();
  await pool.end();
});

test('migration is idempotent, schema-synced, and does not change users or orders', async () => {
  const [[beforeUsers]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(id),0) sum_ids FROM users');
  const [[beforeOrders]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(id),0) sum_ids FROM orders');
  await migrateUserAddresses();
  await migrateUserAddresses();
  const [[afterUsers]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(id),0) sum_ids FROM users');
  const [[afterOrders]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(id),0) sum_ids FROM orders');
  assert.deepEqual(afterUsers, beforeUsers);
  assert.deepEqual(afterOrders, beforeOrders);

  const [columns] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_addresses'`
  );
  assert.deepEqual(
    columns.map((column) => column.COLUMN_NAME),
    ['id', 'user_id', 'label', 'province', 'canton', 'district', 'address_line',
      'address_reference', 'contact_phone', 'is_default', 'created_at', 'updated_at']
  );
  const [foreignKeys] = await pool.query(
    `SELECT REFERENCED_TABLE_NAME, DELETE_RULE
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'user_addresses'`
  );
  assert.deepEqual(foreignKeys, [{ REFERENCED_TABLE_NAME: 'users', DELETE_RULE: 'CASCADE' }]);
});

test('validation normalizes values and rejects province, lengths, phone, checkbox, and malicious text', () => {
  const valid = validateAddress({
    ...validAddress('Casa'),
    contactPhone: '+506 8888-7777',
    isDefault: '1',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.values.contactPhone, '50688887777');
  assert.equal(valid.values.isDefault, true);

  const invalid = validateAddress({
    label: '<script>\u0000</script>',
    province: 'Outside',
    canton: 'x'.repeat(81),
    district: '',
    addressLine: 'x'.repeat(301),
    addressReference: 'x'.repeat(201),
    contactPhone: 'abc',
    isDefault: 'true',
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(Object.keys(invalid.errors).sort(), [
    'addressLine', 'addressReference', 'canton', 'contactPhone', 'district',
    'isDefault', 'label', 'province',
  ]);
});

test('CRUD routes require auth and CSRF, escape output, and hide cross-user addresses as 404', async () => {
  const anonymous = {};
  const anonymousResponse = await request('GET', '/cuenta/direcciones', null, anonymous);
  assert.equal(anonymousResponse.status, 302);
  assert.match(anonymousResponse.location, /^\/auth\/login/);

  const ownerJar = {};
  const otherJar = {};
  await login(ownerJar);
  await login(otherJar, otherEmail);

  let page = await request('GET', '/cuenta/direcciones/nueva', null, ownerJar);
  assert.equal(page.status, 200);
  assert.match(page.data, /href="\/cuenta\/direcciones" aria-current="page"/);
  const noCsrf = await request('POST', '/cuenta/direcciones/nueva', validAddress('No CSRF'), ownerJar);
  assert.equal(noCsrf.status, 403);

  const invalid = await request('POST', '/cuenta/direcciones/nueva', {
    ...validAddress('<script>alert(1)</script>'),
    province: 'Invalid',
    _csrf: hidden(page.data, '_csrf'),
  }, ownerJar);
  assert.equal(invalid.status, 422);
  assert.doesNotMatch(invalid.data, /<script>alert\(1\)<\/script>/);
  assert.match(invalid.data, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  page = await request('GET', '/cuenta/direcciones/nueva', null, ownerJar);
  const created = await request('POST', '/cuenta/direcciones/nueva', {
    ...validAddress('Casa ruta'),
    _csrf: hidden(page.data, '_csrf'),
  }, ownerJar);
  assert.equal(created.status, 302);
  const addresses = await addressService.listForUser(fixture.ownerId);
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].isDefault, true, 'the first address is always default');
  fixture.addressIds.push(addresses[0].id);

  const crossGet = await request('GET', `/cuenta/direcciones/${addresses[0].id}/editar`, null, otherJar);
  assert.equal(crossGet.status, 404);
  const otherList = await request('GET', '/cuenta/direcciones', null, otherJar);
  const token = hidden(otherList.data, '_csrf');
  assert.equal((await request('POST', `/cuenta/direcciones/${addresses[0].id}/predeterminada`, { _csrf: token }, otherJar)).status, 404);
  assert.equal((await request('POST', `/cuenta/direcciones/${addresses[0].id}/eliminar`, { _csrf: token }, otherJar)).status, 404);
  assert.equal((await request('GET', '/cuenta/direcciones/not-a-number/editar', null, ownerJar)).status, 404);
});

test('default changes atomically and deleting it promotes the oldest remaining address', async () => {
  const first = (await addressService.listForUser(fixture.ownerId))[0];
  const second = await addressService.createForUser(fixture.ownerId, validAddress('Oficina'));
  const third = await addressService.createForUser(fixture.ownerId, validAddress('Taller'));
  fixture.addressIds.push(second.id, third.id);

  assert.equal(await addressService.setDefaultForUser(third.id, fixture.ownerId), true);
  let addresses = await addressService.listForUser(fixture.ownerId);
  assert.deepEqual(addresses.filter((address) => address.isDefault).map((address) => address.id), [third.id]);

  assert.equal(await addressService.deleteForUser(third.id, fixture.ownerId), true);
  addresses = await addressService.listForUser(fixture.ownerId);
  assert.deepEqual(addresses.filter((address) => address.isDefault).map((address) => address.id), [first.id]);
  assert.equal(await addressService.deleteForUser(third.id, fixture.ownerId), false);
  assert.equal(await addressService.setDefaultForUser(third.id, fixture.otherId), false);
});

test('the service enforces a maximum of 20 addresses per user', async () => {
  for (let index = 0; index < addressService.MAX_ADDRESSES_PER_USER; index += 1) {
    await addressService.createForUser(fixture.limitId, validAddress(`Lugar ${index + 1}`));
  }
  await assert.rejects(
    () => addressService.createForUser(fixture.limitId, validAddress('Exceso')),
    (error) => error.code === 'ADDRESS_LIMIT'
  );
  const addresses = await addressService.listForUser(fixture.limitId);
  assert.equal(addresses.length, 20);
  assert.equal(addresses.filter((address) => address.isDefault).length, 1);
});

test('checkout shows saved/default choices only to authenticated customers', async () => {
  const ownerJar = {};
  await login(ownerJar);
  await addProductToCart(ownerJar);
  const authenticated = await request('GET', '/checkout', null, ownerJar);
  assert.equal(authenticated.status, 200);
  const defaultAddress = (await addressService.listForUser(fixture.ownerId)).find((address) => address.isDefault);
  assert.match(authenticated.data, new RegExp(`value="saved:${defaultAddress.id}"\\s+checked`));
  assert.match(authenticated.data, /Ingresar otra dirección/);

  const guestJar = {};
  await addProductToCart(guestJar);
  const guest = await request('GET', '/checkout', null, guestJar);
  assert.equal(guest.status, 200);
  assert.doesNotMatch(guest.data, /value="saved:/);
  assert.match(guest.data, /name="addressChoice" value="manual"/);
});

test('saved checkout ignores manual address and contact phone, then remains immutable after edit and delete', async () => {
  const jar = {};
  await login(jar);
  await addProductToCart(jar);
  const selected = (await addressService.listForUser(fixture.ownerId))[0];
  const original = { ...selected };
  const page = await request('GET', '/checkout', null, jar);
  const response = await request('POST', '/checkout', checkoutPayload(page, {
    addressChoice: `saved:${selected.id}`,
    province: 'Guanacaste',
    canton: 'MANIPULADO',
    distrito: 'MANIPULADO',
    addressLine: 'MANIPULADA',
    addressReference: 'MANIPULADA',
  }), jar);
  assert.equal(response.status, 302);
  assert.match(response.location, /^\/checkout\/confirmacion\/NL-/);
  const reference = response.location.split('/').pop();
  fixture.orderRefs.push(reference);

  let [rows] = await pool.query('SELECT * FROM orders WHERE order_reference = ?', [reference]);
  assert.equal(rows[0].province, original.province);
  assert.equal(rows[0].canton, original.canton);
  assert.equal(rows[0].district, original.district);
  assert.equal(rows[0].address_line, original.addressLine);
  assert.equal(rows[0].address_reference, original.addressReference);
  assert.equal(rows[0].customer_phone, '50670001234');
  assert.notEqual(rows[0].customer_phone, original.contactPhone);

  await addressService.updateForUser(selected.id, fixture.ownerId, validAddress('Editada', {
    province: 'Cartago',
    addressLine: 'Dirección cambiada después del pedido',
  }));
  await addressService.deleteForUser(selected.id, fixture.ownerId);

  [rows] = await pool.query('SELECT * FROM orders WHERE order_reference = ?', [reference]);
  assert.equal(rows[0].province, original.province);
  assert.equal(rows[0].address_line, original.addressLine);
  const customerDetail = await customerOrderService.getCustomerSafeOrder(reference);
  assert.equal(customerDetail.deliveryAddress.addressLine, original.addressLine);
  const adminDetail = await adminOrderService.getOrderByReference(reference);
  assert.equal(adminDetail.order.address_line, original.addressLine);

  const confirmation = await request('GET', response.location, null, jar);
  assert.equal(confirmation.status, 200);
  assert.match(confirmation.data, new RegExp(original.addressLine));
  const accountDetail = await request('GET', `/cuenta/pedidos/${reference}`, null, jar);
  assert.equal(accountDetail.status, 200);
  assert.match(accountDetail.data, new RegExp(original.addressLine));
  assert.doesNotMatch(confirmation.data, /Dirección cambiada después del pedido/);
});

test('checkout rejects guest/cross-user/unknown saved choices, supports manual, and pickup clears address', async () => {
  const otherAddress = await addressService.createForUser(fixture.otherId, validAddress('Ajena'));

  const ownerJar = {};
  await login(ownerJar);
  await addProductToCart(ownerJar);
  let page = await request('GET', '/checkout', null, ownerJar);
  let response = await request('POST', '/checkout', checkoutPayload(page, {
    addressChoice: `saved:${otherAddress.id}`,
  }), ownerJar);
  assert.equal(response.status, 422);
  assert.match(response.data, /Selecciona una dirección válida/);
  response = await request('POST', '/checkout', checkoutPayload(page, {
    addressChoice: 'saved:999999999',
  }), ownerJar);
  assert.equal(response.status, 422);

  response = await request('POST', '/checkout', checkoutPayload(page, {
    addressChoice: 'manual',
  }), ownerJar);
  assert.equal(response.status, 302);
  let reference = response.location.split('/').pop();
  fixture.orderRefs.push(reference);
  let [rows] = await pool.query('SELECT * FROM orders WHERE order_reference = ?', [reference]);
  assert.equal(rows[0].address_line, 'Dirección manual controlada');

  const guestJar = {};
  await addProductToCart(guestJar);
  page = await request('GET', '/checkout', null, guestJar);
  response = await request('POST', '/checkout', checkoutPayload(page, {
    email: `${marker}_guest@example.invalid`,
    addressChoice: `saved:${otherAddress.id}`,
  }), guestJar);
  assert.equal(response.status, 422);
  assert.match(response.data, /Selecciona una dirección válida/);
  response = await request('POST', '/checkout', checkoutPayload(page, {
    email: `${marker}_guest@example.invalid`,
    addressChoice: 'manual',
  }), guestJar);
  assert.equal(response.status, 302);
  reference = response.location.split('/').pop();
  fixture.orderRefs.push(reference);

  await addProductToCart(ownerJar);
  page = await request('GET', '/checkout', null, ownerJar);
  response = await request('POST', '/checkout', checkoutPayload(page, {
    deliveryMethod: 'local_pickup',
    addressChoice: `saved:${otherAddress.id}`,
    province: 'Cartago',
    canton: 'Malicioso',
    distrito: 'Malicioso',
    addressLine: 'Maliciosa',
    addressReference: 'Maliciosa',
  }), ownerJar);
  assert.equal(response.status, 302);
  reference = response.location.split('/').pop();
  fixture.orderRefs.push(reference);
  [rows] = await pool.query('SELECT * FROM orders WHERE order_reference = ?', [reference]);
  assert.equal(rows[0].delivery_method, 'local_pickup');
  assert.equal(rows[0].province, null);
  assert.equal(rows[0].canton, null);
  assert.equal(rows[0].district, null);
  assert.equal(rows[0].address_line, null);
  assert.equal(rows[0].address_reference, null);
});
