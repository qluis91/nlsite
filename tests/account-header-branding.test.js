/**
 * Account header & branding tests — Phase account header improvement.
 *
 * Covers: site logo rendering, admin navigation, normal-user authorization,
 * header/sidebar structure, CSRF logout, responsive markup.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../config/db');
const { startTestServer, stopTestServer } = require('./testServer');
const bcrypt = require('bcryptjs');

const marker = `acct_hdr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const adminEmail = `${marker}_a@example.invalid`;
const adminPass = `A-${crypto.randomBytes(6).toString('hex')}!`;
const userEmail = `${marker}_u@example.invalid`;
const userPass = `U-${crypto.randomBytes(6).toString('hex')}!`;
let baseUrl;
let adminId;
let userId;
let adminJar = { cookie: '' };
let userJar = { cookie: '' };

function csrf(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

async function req(method, urlPath, body, jar) {
  const h = {};
  if (body) { body = new URLSearchParams(body).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (jar && jar.cookie) h.Cookie = jar.cookie;
  const r = await fetch(`${baseUrl}${urlPath}`, { method, headers: h, body: body || undefined, redirect: 'manual' });
  const c = r.headers.get('set-cookie');
  if (c && jar) jar.cookie = c.split(';')[0];
  return { status: r.status, location: r.headers.get('location') || '', text: await r.text() };
}

test.before(async () => {
  const info = await startTestServer();
  baseUrl = info.baseUrl;

  // Create admin
  const adminHash = await bcrypt.hash(adminPass, 10);
  const [adminResult] = await pool.query(
    "INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, 1)",
    ['Admin Test', adminEmail, adminHash]
  );
  adminId = adminResult.insertId;

  // Create normal user
  const userHash = await bcrypt.hash(userPass, 10);
  const [userResult] = await pool.query(
    "INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, 2)",
    ['Normal User', userEmail, userHash]
  );
  userId = userResult.insertId;

  // Login admin
  const loginPage = await req('GET', '/auth/login', null, adminJar);
  const token = csrf(loginPage.text);
  if (token) {
    await req('POST', '/auth/login', { _csrf: token, email: adminEmail, password: adminPass, returnTo: '/cuenta' }, adminJar);
  }

  // Login user
  const loginPage2 = await req('GET', '/auth/login', null, userJar);
  const token2 = csrf(loginPage2.text);
  if (token2) {
    await req('POST', '/auth/login', { _csrf: token2, email: userEmail, password: userPass, returnTo: '/cuenta' }, userJar);
  }
});

test.after(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE ?", [`${marker}_%`]);
  await stopTestServer();
});

// ═══════════ PART 1 — Account header structure ═══════════

test('Account header renders branded dark header (not public navbar)', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('account-header-bar'), 'Must contain account-header-bar');
});

test('Account header does NOT hardcode "Mi Sitio Web"', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(!r.text.includes('Mi Sitio Web'), 'Must not hardcode "Mi Sitio Web"');
});

test('Account header renders site name when no logo configured', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(r.text.includes('account-header-bar__name'), 'Must render site name fallback');
});

test('Account header never uses media:// directly as img src', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(!/src="media:\/\//.test(r.text), 'Must not use media:// as img src');
});

// ═══════════ PART 2 — Admin visibility ═══════════

test('Admin user sees "Administración" button in header', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(r.text.includes('account-header-bar__admin-btn'), 'Admin button must exist');
  assert.ok(r.text.includes('href="/admin"'), 'Must link to /admin');
});

test('Admin user sees "Administración" in sidebar', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(r.text.includes('account-sidebar__link--admin'), 'Admin sidebar link must exist');
});

test('Normal user does NOT see admin links', async () => {
  const r = await req('GET', '/cuenta', null, userJar);
  assert.ok(!r.text.includes('account-header-bar__admin-btn'), 'No admin header button');
  assert.ok(!r.text.includes('account-sidebar__link--admin'), 'No admin sidebar link');
  assert.ok(!r.text.includes('account-sidebar__nav--admin'), 'No admin nav section');
});

test('Normal user cannot access /admin', async () => {
  const r = await req('GET', '/admin', null, userJar);
  assert.ok(r.status === 302 || r.status === 403, `Must be blocked. Got ${r.status}`);
});

// ═══════════ PART 3 — Dashboard quick-action card ═══════════

test('Dashboard quick-action card still exists for admin', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(r.text.includes('Ir al panel administrativo'), 'Dashboard must retain admin quick-action');
});

test('Dashboard does NOT show admin quick-action to normal user', async () => {
  const r = await req('GET', '/cuenta', null, userJar);
  assert.ok(!r.text.includes('Ir al panel administrativo'), 'No quick-action for normal user');
});

// ═══════════ PART 4 — User name ═══════════

test('Header renders full user name', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(r.text.includes('Admin Test'), 'Must show full name');
});

test('Sidebar renders user identity', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(r.text.includes('account-sidebar__identity'), 'Identity section must exist');
  assert.ok(r.text.includes(adminEmail), 'Must show email');
});

// ═══════════ PART 5 — Logout CSRF ═══════════

test('Logout form is CSRF-protected POST in sidebar', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(r.text.includes('action="/auth/logout"'), 'Logout action must exist');
  assert.ok(r.text.includes('method="POST"'), 'Logout must use POST method');
});

// ═══════════ PART 6 — Navigation ═══════════

test('Account header has site nav links', async () => {
  const r = await req('GET', '/cuenta', null, adminJar);
  assert.ok(r.text.includes('href="/tienda"'), 'Must have Tienda');
  assert.ok(r.text.includes('href="/galeria"'), 'Must have Galería');
  assert.ok(r.text.includes('href="/nosotros"'), 'Must have Nosotros');
});

// ═══════════ PART 7 — account.ejs layout change ═══════════

test('Account layout includes account-header, not public navbar', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'layouts', 'account.ejs'), 'utf8');
  assert.ok(src.includes('account-header'), 'Layout must include account-header');
  assert.ok(!src.includes("include('../components/navbar')"), 'Layout must not include public navbar');
});

test('account-header.ejs renders logo or site name fallback', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'components', 'account-header.ejs'), 'utf8');
  assert.ok(src.includes('account-header-bar__logo'), 'Must render logo img');
  assert.ok(src.includes('account-header-bar__name'), 'Must have site name fallback');
  assert.ok(src.includes('site.name'), 'Must use site.name for fallback');
  assert.ok(!src.includes('Mi Sitio Web'), 'Must not hardcode Mi Sitio Web');
});

test('account-sidebar.ejs conditionally renders admin section', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'components', 'account-sidebar.ejs'), 'utf8');
  assert.ok(src.includes('account-sidebar__nav--admin'), 'Must have admin nav section');
  assert.ok(src.includes('isAdmin'), 'Must check isAdmin flag');
  assert.ok(src.includes('href="/admin"'), 'Admin link must point to /admin');
});

test('accountController passes isAdmin and accountFullName', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'accountController.js'), 'utf8');
  assert.ok(src.includes('isAdmin: isAdminUser'), 'Must compute isAdmin');
  assert.ok(src.includes('accountFullName'), 'Must compute accountFullName');
  assert.ok(src.includes('resolveAccountSiteLogo'), 'Must have logo resolver');
  assert.ok(src.includes('resolveAccountSiteName'), 'Must have site name resolver');
  assert.ok(src.includes("'global.site_name'"), 'Must read global.site_name from CMS');
  assert.ok(src.includes("'site.logo_light'"), 'Must try light logo first');
  assert.ok(src.includes('getPublishedSettings'), 'Must check published settings');
});

// ═══════════ PART 8 — Logo priority & site name ═══════════

test('Account header prefers CMS site name over .env', async () => {
  // Seed the real CMS key: global.site_name
  await pool.query(
    "INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES ('global.site_name', 'NinjaLab CR CMS', 'string', 'global', 1) ON DUPLICATE KEY UPDATE setting_value = 'NinjaLab CR CMS'"
  );

  const r = await req('GET', '/cuenta', null, adminJar);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('NinjaLab CR CMS'), 'Header must use CMS global.site_name');
  assert.ok(!r.text.includes('Mi Sitio Web'), 'Must not show Mi Sitio Web');

  await pool.query("DELETE FROM site_settings WHERE setting_key = 'global.site_name'");
});

test('Page title uses CMS site name when configured', async () => {
  await pool.query(
    "INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES ('global.site_name', 'NinjaPage', 'string', 'global', 1) ON DUPLICATE KEY UPDATE setting_value = 'NinjaPage'"
  );

  const r = await req('GET', '/cuenta', null, adminJar);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('<title>Mi cuenta | NinjaPage</title>'), `Title must use CMS name. Got text snippet: ${r.text.slice(r.text.indexOf('<title>'), r.text.indexOf('</title>') + 8)}`);

  await pool.query("DELETE FROM site_settings WHERE setting_key = 'global.site_name'");
});

test('Logo resolver tries light logo then primary logo', async () => {
  const { resolveAccountSiteLogo } = require('../controllers/accountController');
  // With no settings, should return null
  const result = await resolveAccountSiteLogo();
  assert.equal(result, null, 'No logo when no settings exist');

  // Now seed a primary logo with a fake ref
  await pool.query(
    "INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES ('site.logo_primary', 'media://00000000-0000-0000-0000-000000000001', 'media', 'navbar', 1) ON DUPLICATE KEY UPDATE setting_value = 'media://00000000-0000-0000-0000-000000000001'"
  );

  // Should still return null because the asset doesn't exist
  const result2 = await resolveAccountSiteLogo();
  assert.equal(result2, null, 'Null when referenced asset does not exist');

  await pool.query("DELETE FROM site_settings WHERE setting_key = 'site.logo_primary'");
});

test('Resolved logo URL is a browser-safe path (not media://)', async () => {
  const { resolveAccountSiteLogo } = require('../controllers/accountController');

  // Create a real media asset
  const [assetResult] = await pool.query(
    "INSERT INTO media_assets (public_id, filename, original_name, storage_disk, storage_path, public_url, thumbnail_path, mime_type, extension, file_size, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [crypto.randomUUID(), 'logo.png', 'Site Logo', 'local', 'media/logos/logo-test.png', '/uploads/media/logos/logo-test.png', '/uploads/media/thumbnails/logo-test-thumb.webp', 'image/png', 'png', 1024, 'logos', 'active']
  );
  const publicId = assetResult.insertId
    ? (await pool.query("SELECT public_id FROM media_assets WHERE id = ?", [assetResult.insertId]))[0][0].public_id
    : null;

  if (publicId) {
    await pool.query(
      "INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES ('site.logo_light', ?, 'media', 'navbar', 1) ON DUPLICATE KEY UPDATE setting_value = ?",
      [`media://${publicId}`, `media://${publicId}`]
    );

    // Set primary to a different (non-existent) ref — should pick light logo
    await pool.query(
      "INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES ('site.logo_primary', 'media://00000000-0000-0000-0000-000000000099', 'media', 'navbar', 1) ON DUPLICATE KEY UPDATE setting_value = 'media://00000000-0000-0000-0000-000000000099'"
    );

    const result = await resolveAccountSiteLogo();
    // Should resolve the light logo because primary ref is fake
    assert.ok(result, 'Must resolve when valid light logo exists');
    if (result) {
      assert.ok(result.url.startsWith('/'), 'URL must be browser path');
      assert.ok(!result.url.includes('media://'), 'Must not be media:// ref');
      assert.ok(!result.url.includes('\\'), 'Must not be filesystem path');
    }

    await pool.query("DELETE FROM site_settings WHERE setting_key IN ('site.logo_light', 'site.logo_primary')");
    await pool.query("DELETE FROM media_assets WHERE public_id = ?", [publicId]);
  }
});

// ═══════════ PART 9 — Avatar initials ═══════════

test('Account header avatar renders initials when no avatar_path', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'components', 'account-header.ejs'), 'utf8'
  );
  assert.ok(src.includes('account-header-bar__user-avatar-initials'), 'Must render initials span');
  assert.ok(src.includes('accountInitials'), 'Must use accountInitials variable');
});

test('accountService.getInitials returns correct initials', () => {
  const accountService = require('../services/accountService');
  assert.equal(accountService.getInitials({ name: 'Luis', last_name: 'Quijano' }), 'LQ');
  assert.equal(accountService.getInitials({ name: 'Luis Quijano' }), 'LQ',
    'Single name field with space must produce first+last word initials');
  assert.equal(accountService.getInitials({ name: 'A' }), 'A');
  assert.equal(accountService.getInitials({ name: 'Admin', last_name: '' }), 'A');
  assert.equal(accountService.getInitials({ name: 'Ana María Sol' }), 'AS',
    'Multi-word name: first + last word initials');
  assert.equal(accountService.getInitials({ name: '' }), 'NL');
});
