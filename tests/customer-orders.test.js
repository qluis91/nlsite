const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const customerOrders = require('../services/customerOrderService');

const marker = `codex_customer_orders_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const password = crypto.randomBytes(12).toString('base64url');
const fixture = { users: {}, refs: { owner: [], other: null, guest: null }, product: null };
const port = 33000 + Math.floor(Math.random() * 1000);
let serverProcess;

function reference() { return `NL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`; }

async function insertOrder({ userId = null, email, delivery = 'local_pickup', shipping = 'not_required', shippingAmount = '0.00', payment = 'sinpe', paymentStatus = 'pending', status = 'pending_payment', subtotal = '1000.00', finalTotal = '1000.00' }) {
  const ref = reference();
  const [result] = await pool.query(
    `INSERT INTO orders
      (order_reference,user_id,customer_name,customer_email,customer_phone,delivery_method,
       shipping_status,shipping_amount,payment_method,payment_status,order_status,
       province,canton,district,address_line,address_reference,product_subtotal,final_total,idempotency_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ref,userId,'Cliente de prueba',email,'00000000',delivery,shipping,shippingAmount,payment,paymentStatus,status,
      delivery === 'local_pickup' ? null : 'San José',delivery === 'local_pickup' ? null : 'Central',delivery === 'local_pickup' ? null : 'Carmen',
      delivery === 'local_pickup' ? null : 'Dirección controlada',delivery === 'local_pickup' ? null : 'Referencia controlada',
      subtotal,finalTotal,crypto.randomBytes(32).toString('hex')]
  );
  await pool.query(
    `INSERT INTO order_items (order_id,product_id,product_name,product_slug,quantity,unit_price,line_total,primary_image)
     VALUES (?,?,?,?,1,?,?,?)`,
    [result.insertId,fixture.product.id,'Producto snapshot seguro',fixture.product.slug,'1000.00','1000.00',fixture.product.primary_image]
  );
  await pool.query(
    `INSERT INTO order_events (order_id,actor_user_id,event_type,to_status,metadata_json) VALUES (?,NULL,'order_created',?,NULL)`,
    [result.insertId,status]
  );
  return { ref, id: result.insertId };
}

async function cleanup() {
  if (fixture.refs.owner.length || fixture.refs.other || fixture.refs.guest) {
    const refs = [...fixture.refs.owner, fixture.refs.other, fixture.refs.guest].filter(Boolean);
    if (refs.length) await pool.query(`DELETE FROM orders WHERE order_reference IN (${refs.map(() => '?').join(',')})`, refs);
    for (const ref of refs) await pool.query('DELETE FROM sessions WHERE data LIKE ?', [`%${ref}%`]);
  }
  const ids = ['admin', 'owner', 'other', 'empty'].map((key) => fixture.users[key]).filter(Boolean);
  if (ids.length) await pool.query(`DELETE FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await pool.query('DELETE FROM sessions WHERE data LIKE ?', [`%${marker}%`]);
}

async function setupFixtures() {
  await cleanup();
  const [products] = await pool.query('SELECT id, slug FROM products ORDER BY id LIMIT 1');
  assert.ok(products[0], 'A development product is required for snapshot fixtures');
  fixture.product = products[0];
  fixture.product.primary_image = null;
  const hash = await bcrypt.hash(password, 8);
  for (const [key, role] of [['admin',1],['owner',2],['other',2],['empty',2]]) {
    const email = `${marker}_${key}@example.invalid`;
    const [result] = await pool.query('INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,?,1)', [`Fixture ${key}`,email,hash,role]);
    fixture.users[key] = result.insertId;
    fixture.users[`${key}Email`] = email;
  }
  for (let index = 0; index < 11; index += 1) {
    const options = index === 0
      ? { userId: fixture.users.owner, email: fixture.users.ownerEmail, delivery: 'uber_flash', shipping: 'pending_quote', shippingAmount: null, status: 'pending_shipping_quote', finalTotal: null }
      : index === 1
        ? { userId: fixture.users.owner, email: fixture.users.ownerEmail, delivery: 'uber_flash', shipping: 'quoted', shippingAmount: '250.00', status: 'pending_payment', finalTotal: '1250.00' }
        : { userId: fixture.users.owner, email: fixture.users.ownerEmail };
    const order = await insertOrder(options);
    fixture.refs.owner.push(order.ref);
  }
  const other = await insertOrder({ userId: fixture.users.other, email: fixture.users.otherEmail });
  fixture.refs.other = other.ref;
  const guest = await insertOrder({ email: `${marker}_guest@example.invalid`, delivery: 'uber_flash', shipping: 'quoted', shippingAmount: '250.00', finalTotal: '1250.00' });
  fixture.refs.guest = guest.ref;
  await pool.query(
    `INSERT INTO order_events (order_id,actor_user_id,event_type,to_status,metadata_json,note)
     VALUES (?,?,'internal_note_added',NULL,?,?)`,
    [guest.id,fixture.users.admin,JSON.stringify({ privateMarker: `RAW_${marker}` }),`PRIVATE_${marker}`]
  );
  await pool.query(
    `INSERT INTO order_events (order_id,event_type,to_status) VALUES (?,'shipping_quoted','pending_payment')`,
    [guest.id]
  );
}

function request(method, path, body, jar = {}) {
  return new Promise((resolve, reject) => {
    const encoded = body ? new URLSearchParams(body).toString() : '';
    const headers = {};
    if (encoded) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(encoded); }
    if (jar.cookie) headers.Cookie = jar.cookie;
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie && setCookie[0]) jar.cookie = setCookie[0].split(';')[0];
        resolve({ status: res.statusCode, data, location: res.headers.location || '' });
      });
    });
    req.on('error', reject);
    if (encoded) req.write(encoded);
    req.end();
  });
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'CSRF token should be present in a form');
  return match[1];
}

async function login(jar, email, path = '/cuenta/pedidos', admin = false) {
  const loginPath = admin ? '/admin/login' : `/auth/login?returnTo=${encodeURIComponent(path)}`;
  const page = await request('GET', loginPath, null, jar);
  const response = await request('POST', admin ? '/admin/login' : '/auth/login', {
    email, password, _csrf: csrf(page.data), returnTo: path,
  }, jar);
  assert.equal(response.status, 302);
  return response;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { const response = await request('GET', '/', null, {}); if (response.status === 200) return; } catch (_error) { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Isolated test server did not start');
}

test.before(async () => {
  await setupFixtures();
  serverProcess = spawn(process.execPath, ['app.js'], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore', windowsHide: true,
  });
  await waitForServer();
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  await cleanup();
  await pool.end();
});

test('customer-safe serializers enforce payment, timeline, grant, and privacy rules', async () => {
  const now = Date.now();
  assert.equal(customerOrders.normalizeReference(fixture.refs.guest.toLowerCase()), fixture.refs.guest);
  assert.equal(customerOrders.normalizeReference('NL-1 OR 1=1'), null);
  assert.equal(customerOrders.normalizeEmail(`  ${marker}_GUEST@EXAMPLE.INVALID `), `${marker}_guest@example.invalid`);
  assert.equal(customerOrders.buildPaymentInstructions({ order_status:'pending_shipping_quote',payment_status:'pending',shipping_status:'pending_quote',final_total:null }).type, 'wait_for_quote');
  assert.equal(customerOrders.buildPaymentInstructions({ order_status:'pending_payment',payment_status:'pending',shipping_status:'quoted',final_total:'1.00',payment_method:'sinpe' }).lines.join(' ').includes('+506 7024 0270'), true);
  assert.equal(customerOrders.buildPaymentInstructions({ order_status:'pending_payment',payment_status:'pending',shipping_status:'quoted',final_total:'1.00',payment_method:'bank_transfer' }).type, 'bank_transfer');
  assert.equal(customerOrders.buildPaymentInstructions({ order_status:'payment_confirmed',payment_status:'paid',shipping_status:'quoted',final_total:'1.00',payment_method:'sinpe' }).type, 'confirmed');
  assert.equal(customerOrders.buildPaymentInstructions({ order_status:'cancelled',payment_status:'pending' }), null);
  const fallbackTimeline = customerOrders.buildPublicTimeline(
    { created_at: new Date(now - 1000), updated_at: new Date(now), shipping_status:'quoted', payment_status:'paid', order_status:'preparing' },
    [{ event_type:'internal_note_added',to_status:null,created_at:new Date(now - 500) }, { event_type:'unknown_event',to_status:'unknown',created_at:new Date(now - 400) }]
  );
  assert.deepEqual(fallbackTimeline.map((item) => item.type), ['order_created','shipping_quoted','payment_confirmed','preparing']);
  const session = {};
  for (let index = 0; index < 7; index += 1) customerOrders.grantGuestOrderAccess(session, reference(), now + index);
  assert.equal(session.guestOrderAccess.length, 5);
  customerOrders.grantGuestOrderAccess(session, session.guestOrderAccess[4].reference, now + 20);
  assert.equal(session.guestOrderAccess.length, 5);
  assert.equal(customerOrders.sanitizeGuestAccessGrants([{ reference: fixture.refs.guest, grantedAt: new Date(now - 4000000).toISOString(), expiresAt: new Date(now - 1).toISOString() }], now).length, 0);
  assert.equal(customerOrders.hasRecentOrderAccess({ recentOrders: [{ reference: fixture.refs.guest, expiresAt: now + 1000 }] }, fixture.refs.guest, now), true);
  assert.equal(customerOrders.hasRecentOrderAccess({ recentOrders: [{ reference: fixture.refs.guest, expiresAt: now - 1 }] }, fixture.refs.guest, now), false);
  const recentSession = {};
  customerOrders.recordRecentOrderAccess(recentSession, fixture.refs.guest, now);
  customerOrders.recordRecentOrderAccess(recentSession, fixture.refs.guest, now + 1);
  assert.equal(recentSession.recentOrders.length, 1);
  assert.deepEqual(Object.keys(recentSession.recentOrders[0]).sort(), ['expiresAt', 'reference']);
  assert.deepEqual(customerOrders.normalizePagination({ page: '-1', limit: '9999' }), { page: 1, limit: 50 });
  const safeOrder = await customerOrders.getCustomerSafeOrder(fixture.refs.guest);
  const serialized = JSON.stringify(safeOrder);
  assert.doesNotMatch(serialized, new RegExp(`PRIVATE_${marker}|RAW_${marker}|actor_user|metadata_json|idempotency|user_id|internal_id`));
  assert.equal(safeOrder.timeline.some((item) => item.type === 'shipping_quoted'), true);
  assert.equal(safeOrder.timeline.some((item) => item.type === 'internal_note_added'), false);
});

test('guest lookup is generic, CSRF-protected, rate-limited, bounded to guest orders, and session-bound', async () => {
  const noGrant = {};
  assert.equal((await request('GET', `/consultar-pedido/${fixture.refs.guest}`, null, noGrant)).status, 404);
  const form = await request('GET', '/consultar-pedido', null, noGrant);
  assert.equal(form.status, 200);
  assert.match(form.data, /noindex,nofollow/);
  assert.equal((await request('POST', '/consultar-pedido', { reference: fixture.refs.guest, email: `${marker}_guest@example.invalid` }, {})).status, 403);

  const wrongJar = {};
  const wrongForm = await request('GET', '/consultar-pedido', null, wrongJar);
  const wrong = await request('POST', '/consultar-pedido', { reference: fixture.refs.guest, email: 'wrong@example.invalid', _csrf: csrf(wrongForm.data) }, wrongJar);
  const unknown = await request('POST', '/consultar-pedido', { reference: reference(), email: 'wrong@example.invalid', _csrf: csrf(wrongForm.data) }, wrongJar);
  assert.equal(wrong.status, 200);
  assert.equal(unknown.status, 200);
  assert.match(wrong.data, /No pudimos verificar los datos del pedido/);
  assert.match(unknown.data, /No pudimos verificar los datos del pedido/);

  const jar = {};
  const lookup = await request('GET', '/consultar-pedido', null, jar);
  const verified = await request('POST', '/consultar-pedido', { reference: fixture.refs.guest.toLowerCase(), email: `${marker}_GUEST@EXAMPLE.INVALID`, _csrf: csrf(lookup.data) }, jar);
  assert.equal(verified.status, 302);
  const detail = await request('GET', verified.location, null, jar);
  assert.equal(detail.status, 200);
  assert.match(detail.data, /Producto snapshot seguro/);
  assert.match(detail.data, /₡1\s*250,00/);
  assert.match(detail.data, /\+506 7024 0270/);
  assert.match(detail.data, /Envío cotizado/);
  assert.doesNotMatch(detail.data, new RegExp(`PRIVATE_${marker}|RAW_${marker}|Fixture admin|metadata_json|idempotency`));

  const ownedLookup = await request('POST', '/consultar-pedido', { reference: fixture.refs.owner[0], email: fixture.users.ownerEmail, _csrf: csrf(lookup.data) }, jar);
  assert.equal(ownedLookup.status, 200);
  assert.match(ownedLookup.data, /No pudimos verificar los datos del pedido/);
  const referenceOnly = await request('POST', '/consultar-pedido', { reference: fixture.refs.guest, _csrf: csrf(lookup.data) }, jar);
  assert.equal(referenceOnly.status, 200);
  assert.match(referenceOnly.data, /No pudimos verificar los datos del pedido/);

  await login(jar, fixture.users.ownerEmail);
  assert.equal((await request('GET', `/consultar-pedido/${fixture.refs.guest}`, null, jar)).status, 404);

  const rateJar = {};
  const rateForm = await request('GET', '/consultar-pedido', null, rateJar);
  let rateLimited = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request('POST', '/consultar-pedido', { reference: reference(), email: 'wrong@example.invalid', _csrf: csrf(rateForm.data) }, rateJar);
    if (response.status === 429) { rateLimited = true; assert.match(response.data, /No pudimos verificar los datos del pedido/); break; }
  }
  assert.equal(rateLimited, true);
});

test('login page validates inputs, preserves only email, and keeps a safe return path', async () => {
  const jar = {};
  const returnTo = '/cuenta/pedidos?page=2';
  const page = await request('GET', `/auth/login?returnTo=${encodeURIComponent(returnTo)}`, null, jar);
  assert.equal(page.status, 200);
  assert.match(page.data, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page.data, /<h1 id="login-heading"[^>]*>Iniciar Sesi[oó]n<\/h1>/);
  assert.match(page.data, /<form[^>]+novalidate/);
  assert.match(page.data, /name="returnTo" value="\/cuenta\/pedidos\?page=2"/);

  const email = ' Remember.Me@Example.Invalid ';
  const rejected = await request('POST', '/auth/login', {
    email,
    password: '',
    returnTo,
    _csrf: csrf(page.data),
  }, jar);
  assert.equal(rejected.status, 302);
  assert.equal(rejected.location, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);

  const rerendered = await request('GET', rejected.location, null, jar);
  assert.equal(rerendered.status, 200);
  assert.match(rerendered.data, /value="remember\.me@example\.invalid"/);
  assert.doesNotMatch(rerendered.data, /name="password"[^>]*\svalue=/);
});

test('authenticated customers see only owned orders with pagination and safe 404 details', async () => {
  const jar = {};
  const anonymous = await request('GET', '/cuenta/pedidos', null, jar);
  assert.equal(anonymous.status, 302);
  assert.match(anonymous.location, /^\/auth\/login\?returnTo=/);
  const external = await request('GET', '/auth/login?returnTo=https%3A%2F%2Fevil.invalid', null, {});
  assert.match(external.data, /name="returnTo" value="\/"/);

  const loggedIn = await login(jar, fixture.users.ownerEmail, '/cuenta/pedidos');
  assert.equal(loggedIn.location, '/cuenta/pedidos');
  const list = await request('GET', '/cuenta/pedidos?userId=999', null, jar);
  assert.equal(list.status, 200);
  assert.match(list.data, new RegExp(fixture.refs.owner[10]));
  assert.doesNotMatch(list.data, new RegExp(`${fixture.refs.other}|${fixture.refs.guest}`));
  assert.match(list.data, /Pendiente|Por calcular/);
  const secondPage = await request('GET', '/cuenta/pedidos?page=2', null, jar);
  assert.equal(secondPage.status, 200);
  assert.match(secondPage.data, new RegExp(fixture.refs.owner[0]));

  const own = await request('GET', `/cuenta/pedidos/${fixture.refs.owner[0]}`, null, jar);
  assert.equal(own.status, 200);
  assert.match(own.data, /Producto snapshot seguro/);
  assert.match(own.data, /No realices ningún pago todavía/);
  assert.match(own.data, /Dirección controlada/);
  assert.equal((await request('GET', `/cuenta/pedidos/${fixture.refs.other}`, null, jar)).status, 404);
  assert.equal((await request('GET', `/checkout/confirmacion/${fixture.refs.owner[0]}`, null, jar)).status, 200);
  assert.equal((await request('GET', '/cuenta/pedidos/NL-SCRIPTXXXXX', null, jar)).status, 404);

  const emptyJar = {};
  await login(emptyJar, fixture.users.emptyEmail);
  const empty = await request('GET', '/cuenta/pedidos', null, emptyJar);
  assert.equal(empty.status, 200);
  assert.match(empty.data, /Todavía no tienes pedidos/);
});

test('controlled admin and regular-user authorization fixtures execute without skips', async () => {
  const regularJar = {};
  await login(regularJar, fixture.users.otherEmail);
  const denied = await request('GET', '/admin/orders', null, regularJar);
  assert.equal(denied.status, 302);

  const adminJar = {};
  await login(adminJar, fixture.users.adminEmail, '/admin', true);
  const allowed = await request('GET', '/admin/orders', null, adminJar);
  assert.equal(allowed.status, 200);
  assert.match(allowed.data, /Pedidos/);
});

test('store, product, cart, checkout gate, login, and navigation regressions remain functional', async () => {
  assert.equal((await request('GET', '/', null, {})).status, 200);
  const store = await request('GET', '/tienda', null, {});
  assert.equal(store.status, 200);
  assert.equal((await request('GET', `/tienda/${fixture.product.slug}`, null, {})).status, 200);
  assert.equal((await request('GET', '/carrito', null, {})).status, 200);
  const checkout = await request('GET', '/checkout', null, {});
  assert.equal(checkout.status, 302);
  assert.equal(checkout.location, '/carrito');
  assert.equal((await request('GET', '/auth/login', null, {})).status, 200);
  assert.match(store.data, /st-sidebar/);
});
