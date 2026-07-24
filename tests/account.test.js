const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const pool = require('../config/db');
const accountService = require('../services/accountService');
const accountController = require('../controllers/accountController');
const { migrateUserProfile } = require('../scripts/migrate-user-profile');

const marker = `codex_account_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const email = `${marker}@example.invalid`;
const otherEmail = `${marker}_other@example.invalid`;
const initialPassword = `Old-${crypto.randomBytes(8).toString('hex')}!`;
const newPassword = `New-${crypto.randomBytes(8).toString('hex')}!`;
const port = 34500 + Math.floor(Math.random() * 400);
const fixture = { userId: null, otherUserId: null, refs: [], otherRef: null };
const authenticatedJar = {};
let serverProcess;

function reference() {
  return `NL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function request(method, requestPath, body, jar = {}, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let payload = null;
    const headers = { ...extraHeaders };
    if (body && !Buffer.isBuffer(body)) {
      payload = Buffer.from(new URLSearchParams(body).toString());
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (Buffer.isBuffer(body)) {
      payload = body;
    }
    if (payload) headers['Content-Length'] = payload.length;
    if (jar.cookie) headers.Cookie = jar.cookie;
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: requestPath, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          if (setCookie?.[0]) jar.cookie = setCookie[0].split(';')[0];
          resolve({ status: res.statusCode, data, location: res.headers.location || '' });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function multipart(fields, file = null) {
  const boundary = `----codex${crypto.randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
  }
  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="upload.bin"\r\n`
      + `Content-Type: ${file.mimeType}\r\n\r\n`
    ));
    parts.push(file.buffer);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  };
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'a CSRF token should be rendered');
  return match[1];
}

async function login(jar, loginEmail = email, password = initialPassword, returnTo = '/cuenta') {
  const page = await request('GET', `/auth/login?returnTo=${encodeURIComponent(returnTo)}`, null, jar);
  const response = await request('POST', '/auth/login', {
    email: loginEmail,
    password,
    returnTo,
    _csrf: csrf(page.data),
  }, jar);
  assert.equal(response.status, 302);
  return response;
}

async function ensureAuthenticated() {
  if (!authenticatedJar.cookie) {
    assert.equal((await login(authenticatedJar)).location, '/cuenta');
  }
}

async function insertOrder(userId, orderStatus, paymentStatus = 'pending') {
  const ref = reference();
  await pool.query(
    `INSERT INTO orders
      (order_reference,user_id,customer_name,customer_email,customer_phone,delivery_method,
       shipping_status,shipping_amount,payment_method,payment_status,order_status,
       product_subtotal,final_total,idempotency_key)
     VALUES (?,?,?,?,?,'local_pickup','not_required',0,'sinpe',?,?,1000,1000,?)`,
    [ref, userId, marker, email, '70240270', paymentStatus, orderStatus, crypto.randomBytes(32).toString('hex')]
  );
  return ref;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await request('GET', '/', null, {});
      if (response.status === 200) return;
    } catch (_error) {
      // Retry while the isolated process connects to MySQL.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Isolated account test server did not start');
}

async function cleanup() {
  if (fixture.refs.length || fixture.otherRef) {
    const refs = [...fixture.refs, fixture.otherRef].filter(Boolean);
    await pool.query(`DELETE FROM orders WHERE order_reference IN (${refs.map(() => '?').join(',')})`, refs);
  }
  const ids = [fixture.userId, fixture.otherUserId].filter(Boolean);
  if (ids.length) await pool.query(`DELETE FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await pool.query('DELETE FROM sessions WHERE data LIKE ?', [`%${marker}%`]);
  const avatarDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars', String(fixture.userId || 0));
  if (fs.existsSync(avatarDir)) await fs.promises.rm(avatarDir, { recursive: true, force: true });
}

test.before(async () => {
  await migrateUserProfile();
  await cleanup();
  const hash = await bcrypt.hash(initialPassword, 8);
  const [owner] = await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,?,1)',
    ['Cliente Cuenta', email, hash, 2]
  );
  const [other] = await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,?,1)',
    ['Cliente Ajeno', otherEmail, hash, 2]
  );
  fixture.userId = owner.insertId;
  fixture.otherUserId = other.insertId;
  fixture.refs.push(await insertOrder(fixture.userId, 'pending_payment'));
  fixture.refs.push(await insertOrder(fixture.userId, 'preparing', 'paid'));
  fixture.refs.push(await insertOrder(fixture.userId, 'completed', 'paid'));
  fixture.otherRef = await insertOrder(fixture.otherUserId, 'completed', 'paid');

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

test('account routes are mounted, ordered, authenticated, and owner-scoped', async () => {
  const anonymous = {};
  for (const route of ['/cuenta', '/cuenta/perfil', '/cuenta/seguridad', '/cuenta/pedidos']) {
    const response = await request('GET', route, null, anonymous);
    assert.equal(response.status, 302);
    assert.match(response.location, /^\/auth\/login/);
  }

  assert.equal((await login(authenticatedJar)).location, '/cuenta');
  const dashboard = await request('GET', '/cuenta', null, authenticatedJar);
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.data, /Total de pedidos[\s\S]*?3/);
  assert.match(dashboard.data, new RegExp(fixture.refs[2]));
  assert.doesNotMatch(dashboard.data, new RegExp(fixture.otherRef));
  assert.match(dashboard.data, /href="\/cuenta" aria-current="page"/);
  assert.match(dashboard.data, /action="\/auth\/logout" method="POST"/);
  const ids = [...dashboard.data.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);

  const orders = await request('GET', '/cuenta/pedidos', null, authenticatedJar);
  assert.equal(orders.status, 200);
  assert.match(orders.data, /account-shell/);
  assert.match(orders.data, /href="\/cuenta\/pedidos" aria-current="page"/);
  assert.equal((await request('GET', `/cuenta/pedidos/${fixture.refs[0]}`, null, authenticatedJar)).status, 200);
  assert.equal((await request('GET', `/cuenta/pedidos/${fixture.otherRef}`, null, authenticatedJar)).status, 404);
  assert.equal((await request('GET', '/cuenta/pedidos/INVALID', null, authenticatedJar)).status, 404);
  assert.equal((await request('GET', '/cuenta/desconocida', null, authenticatedJar)).status, 404);
});

test('profile updates only allowlisted fields, normalizes phone, escapes names, and requires CSRF', async () => {
  await ensureAuthenticated();
  const page = await request('GET', '/cuenta/perfil', null, authenticatedJar);
  assert.equal(page.status, 200);
  assert.match(page.data, new RegExp(email));
  assert.match(page.data, /readonly/);

  const rawName = '<script>alert(1)</script>';
  const updated = await request('POST', '/cuenta/perfil', {
    _csrf: csrf(page.data),
    name: rawName,
    lastName: 'Prueba Segura',
    phone: '+506 7024 0270',
    email: 'attacker@example.invalid',
    userId: fixture.otherUserId,
    roleId: 1,
    isAdmin: '1',
    avatarPath: '/outside.webp',
    password: 'do-not-use',
  }, authenticatedJar);
  assert.equal(updated.status, 302);
  assert.equal(updated.location, '/cuenta/perfil');

  const [rows] = await pool.query(
    'SELECT id,name,last_name,email,phone,role_id,avatar_path FROM users WHERE id = ?',
    [fixture.userId]
  );
  assert.equal(rows[0].id, fixture.userId);
  assert.equal(rows[0].name, rawName);
  assert.equal(rows[0].last_name, 'Prueba Segura');
  assert.equal(rows[0].phone, '50670240270');
  assert.equal(rows[0].email, email);
  assert.equal(Number(rows[0].role_id), 2);
  assert.equal(rows[0].avatar_path, null);

  const rerendered = await request('GET', '/cuenta/perfil', null, authenticatedJar);
  assert.doesNotMatch(rerendered.data, /<script>alert\(1\)<\/script>/);
  assert.match(rerendered.data, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const invalid = await request('POST', '/cuenta/perfil', {
    _csrf: csrf(rerendered.data),
    name: 'Nombre válido',
    lastName: '',
    phone: '123',
  }, authenticatedJar);
  assert.equal(invalid.status, 302);
  const invalidPage = await request('GET', '/cuenta/perfil', null, authenticatedJar);
  assert.match(invalidPage.data, /entre 8 y 15 d[íi]gitos/);

  const withoutCsrf = await request('POST', '/cuenta/perfil', {
    name: 'No debe cambiar',
    phone: '70240270',
  }, authenticatedJar);
  assert.equal(withoutCsrf.status, 403);
});

test('avatar pipeline accepts safe formats, produces 512px WebP, replaces safely, and removes safely', async () => {
  await ensureAuthenticated();
  const formats = [
    { mimeType: 'image/jpeg', buffer: await sharp({ create: { width: 90, height: 60, channels: 3, background: '#f00' } }).jpeg().toBuffer() },
    { mimeType: 'image/png', buffer: await sharp({ create: { width: 70, height: 100, channels: 4, background: '#0f08' } }).png().toBuffer() },
    { mimeType: 'image/webp', buffer: await sharp({ create: { width: 80, height: 80, channels: 3, background: '#00f' } }).webp().toBuffer() },
  ];
  let previousAbsolute = null;

  for (const file of formats) {
    const profile = await request('GET', '/cuenta/perfil', null, authenticatedJar);
    const upload = multipart({ _csrf: csrf(profile.data) }, file);
    const response = await request('POST', '/cuenta/avatar', upload.body, authenticatedJar, upload.headers);
    assert.equal(response.status, 302);
    assert.equal(response.location, '/cuenta/perfil');
    const [[user]] = await pool.query('SELECT avatar_path FROM users WHERE id = ?', [fixture.userId]);
    assert.match(user.avatar_path, new RegExp(`^/uploads/avatars/${fixture.userId}/[0-9a-f-]+\\.webp$`, 'i'));
    const absolute = accountService.resolveOwnedAvatarPath(fixture.userId, user.avatar_path);
    assert.ok(absolute && fs.existsSync(absolute));
    const metadata = await sharp(await fs.promises.readFile(absolute)).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    if (previousAbsolute) {
      assert.equal(fs.existsSync(previousAbsolute), false);
    }
    previousAbsolute = absolute;
  }

  const profile = await request('GET', '/cuenta/perfil', null, authenticatedJar);
  const currentPath = (await pool.query('SELECT avatar_path FROM users WHERE id = ?', [fixture.userId]))[0][0].avatar_path;
  const malformed = multipart({ _csrf: csrf(profile.data) }, { mimeType: 'image/jpeg', buffer: Buffer.from('not an image') });
  assert.equal((await request('POST', '/cuenta/avatar', malformed.body, authenticatedJar, malformed.headers)).status, 302);
  assert.equal((await pool.query('SELECT avatar_path FROM users WHERE id = ?', [fixture.userId]))[0][0].avatar_path, currentPath);

  const svg = multipart({ _csrf: csrf(profile.data) }, { mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  assert.equal((await request('POST', '/cuenta/avatar', svg.body, authenticatedJar, svg.headers)).status, 302);
  const oversized = multipart({ _csrf: csrf(profile.data) }, { mimeType: 'image/jpeg', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  assert.equal((await request('POST', '/cuenta/avatar', oversized.body, authenticatedJar, oversized.headers)).status, 302);
  const noCsrf = multipart({}, formats[0]);
  assert.equal((await request('POST', '/cuenta/avatar', noCsrf.body, authenticatedJar, noCsrf.headers)).status, 403);

  assert.equal(accountService.resolveOwnedAvatarPath(fixture.userId, '/etc/important.webp'), null);
  assert.equal(accountService.resolveOwnedAvatarPath(fixture.userId, `/uploads/avatars/${fixture.userId}/../../important.webp`), null);

  const removalPage = await request('GET', '/cuenta/perfil', null, authenticatedJar);
  const removed = await request('POST', '/cuenta/avatar/eliminar', { _csrf: csrf(removalPage.data) }, authenticatedJar);
  assert.equal(removed.status, 302);
  assert.equal((await pool.query('SELECT avatar_path FROM users WHERE id = ?', [fixture.userId]))[0][0].avatar_path, null);
  assert.equal(fs.existsSync(previousAbsolute), false);
  const idempotentPage = await request('GET', '/cuenta/perfil', null, authenticatedJar);
  assert.equal((await request('POST', '/cuenta/avatar/eliminar', { _csrf: csrf(idempotentPage.data) }, authenticatedJar)).status, 302);
  assert.equal((await request('POST', '/cuenta/avatar/eliminar', {}, authenticatedJar)).status, 403);
});

test('failed avatar DB update removes the new orphan', async () => {
  const impossibleUserId = 2147483000;
  const avatarDir = path.join(__dirname, '..', 'public', 'uploads', 'avatars', String(impossibleUserId));
  if (fs.existsSync(avatarDir)) await fs.promises.rm(avatarDir, { recursive: true, force: true });
  const req = {
    file: {
      mimetype: 'image/jpeg',
      size: 100,
      buffer: await sharp({ create: { width: 32, height: 32, channels: 3, background: '#fff' } }).jpeg().toBuffer(),
    },
    session: { user: { id: impossibleUserId } },
  };
  const res = { redirect(value) { this.location = value; return this; } };
  await accountController.updateAvatar(req, res, (error) => { throw error; });
  assert.equal(res.location, '/cuenta/perfil');
  const entries = fs.existsSync(avatarDir) ? await fs.promises.readdir(avatarDir) : [];
  assert.deepEqual(entries, []);
  if (fs.existsSync(avatarDir)) await fs.promises.rm(avatarDir, { recursive: true, force: true });
});

test('password change validates current password, rotates session, preserves cart, and clears guest grants', async () => {
  await ensureAuthenticated();
  let page = await request('GET', '/cuenta/seguridad', null, authenticatedJar);
  const originalHash = (await pool.query('SELECT password FROM users WHERE id = ?', [fixture.userId]))[0][0].password;
  assert.doesNotMatch(page.data, /name="(?:currentPassword|newPassword|confirmPassword)"[^>]*\svalue=/);
  assert.doesNotMatch(page.data, new RegExp(originalHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const body of [
    { currentPassword: 'wrong-password', newPassword, confirmPassword: newPassword },
    { currentPassword: initialPassword, newPassword, confirmPassword: `${newPassword}x` },
    { currentPassword: initialPassword, newPassword: initialPassword, confirmPassword: initialPassword },
    { currentPassword: initialPassword, newPassword: 'short', confirmPassword: 'short' },
  ]) {
    const response = await request('POST', '/cuenta/seguridad/contrasena', {
      ...body,
      _csrf: csrf(page.data),
    }, authenticatedJar);
    assert.equal(response.status, 302);
    page = await request('GET', '/cuenta/seguridad', null, authenticatedJar);
  }
  assert.equal((await pool.query('SELECT password FROM users WHERE id = ?', [fixture.userId]))[0][0].password, originalHash);
  assert.equal((await request('POST', '/cuenta/seguridad/contrasena', {
    currentPassword: initialPassword,
    newPassword,
    confirmPassword: newPassword,
  }, authenticatedJar)).status, 403);

  const [sessions] = await pool.query('SELECT session_id,data FROM sessions WHERE data LIKE ?', [`%${email}%`]);
  assert.ok(sessions.length >= 1);
  const sessionRow = sessions[sessions.length - 1];
  const sessionData = JSON.parse(sessionRow.data);
  sessionData.cart = { items: [{ productId: 1, quantity: 2, addedAt: new Date().toISOString() }] };
  sessionData.guestOrderAccess = [{ reference: fixture.otherRef, expiresAt: new Date(Date.now() + 60000).toISOString() }];
  sessionData.recentOrders = [{ reference: fixture.otherRef, expiresAt: Date.now() + 60000 }];
  await pool.query('UPDATE sessions SET data = ? WHERE session_id = ?', [JSON.stringify(sessionData), sessionRow.session_id]);

  page = await request('GET', '/cuenta/seguridad', null, authenticatedJar);
  const changed = await request('POST', '/cuenta/seguridad/contrasena', {
    _csrf: csrf(page.data),
    currentPassword: initialPassword,
    newPassword,
    confirmPassword: newPassword,
  }, authenticatedJar);
  assert.equal(changed.status, 302);
  assert.equal(changed.location, '/cuenta/seguridad');
  assert.equal((await request('GET', '/cuenta', null, authenticatedJar)).status, 200);

  const [newSessions] = await pool.query('SELECT data FROM sessions WHERE data LIKE ?', [`%${email}%`]);
  const authenticated = newSessions.map((row) => JSON.parse(row.data)).find((data) => data.user?.id === fixture.userId);
  assert.ok(authenticated);
  assert.equal(authenticated.cart.items[0].quantity, 2);
  assert.equal(authenticated.guestOrderAccess, undefined);
  assert.equal(authenticated.recentOrders, undefined);
  const [[passwordRow]] = await pool.query(
    'SELECT password,password_changed_at FROM users WHERE id = ?',
    [fixture.userId]
  );
  assert.ok(passwordRow.password_changed_at);
  assert.equal(await bcrypt.compare(newPassword, passwordRow.password), true);
  assert.equal(await bcrypt.compare(initialPassword, passwordRow.password), false);

  const oldJar = {};
  assert.match((await login(oldJar, email, initialPassword)).location, /^\/auth\/login/);
  const newJar = {};
  assert.equal((await login(newJar, email, newPassword)).location, '/cuenta');
});
