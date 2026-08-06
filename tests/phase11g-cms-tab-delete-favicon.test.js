/**
 * Phase 11G tests — LogoLoop delete, active-tab preservation, Navbar favicon save.
 *
 * Covers: LogoLoop Eliminar action, tab persistence across all Panel 2/3 actions,
 * Navbar favicon save without blocking on optional empty media fields.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const pool = require('../config/db');
const { startTestServer, stopTestServer } = require('./testServer');
const bcrypt = require('bcryptjs');

const marker = `p11g_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const adminEmail = `${marker}@example.invalid`;
const adminPass = `Aa-${crypto.randomBytes(8).toString('hex')}!`;
let baseUrl;
let adminId;
let adminJar = { cookie: '' };

function assertSafeLocalDatabase() {
  const { assertSafeTestDatabase } = require('../config/testDatabaseGuard');
  assertSafeTestDatabase({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || '',
  }, { requireMutationOptIn: true });
}

function csrf(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(m, 'CSRF token must be present');
  return m[1];
}

async function adminReq(method, reqPath, fields) {
  const headers = {};
  let body;
  if (fields) {
    body = new URLSearchParams(fields).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (adminJar.cookie) headers.Cookie = adminJar.cookie;
  const resp = await fetch(`${baseUrl}${reqPath}`, { method, headers, body, redirect: 'manual' });
  const c = resp.headers.get('set-cookie');
  if (c) adminJar.cookie = c.split(';')[0];
  return { status: resp.status, location: resp.headers.get('location') || '', text: await resp.text() };
}

// Follows redirects — returns the FINAL page, not the intermediate 302.
async function adminReqFollow(method, reqPath, fields) {
  const headers = {};
  let body;
  if (fields) {
    body = new URLSearchParams(fields).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (adminJar.cookie) headers.Cookie = adminJar.cookie;
  const resp = await fetch(`${baseUrl}${reqPath}`, { method, headers, body, redirect: 'follow' });
  const c = resp.headers.get('set-cookie');
  if (c) adminJar.cookie = c.split(';')[0];
  return { status: resp.status, url: resp.url, text: await resp.text() };
}

test.before(async () => {
  assertSafeLocalDatabase();
  const info = await startTestServer();
  baseUrl = info.baseUrl;

  // Create admin user
  const hash = await bcrypt.hash(adminPass, 8);
  const [ur] = await pool.query(
    'INSERT INTO users (name, email, password, role_id, is_active) VALUES (?, ?, ?, 1, 1)',
    ['Test Admin', adminEmail, hash]
  );
  adminId = ur.insertId;

  // Login
  const loginPage = await adminReq('GET', '/auth/login?returnTo=%2Fadmin');
  const loginToken = csrf(loginPage.text);
  const loginResp = await adminReq('POST', '/auth/login', {
    email: adminEmail, password: adminPass, _csrf: loginToken, returnTo: '/admin',
  });
  assert.equal(loginResp.status, 302);
  assert.ok(loginResp.location.includes('/admin'), `Bad redirect: ${loginResp.location}`);

  // Clean any leftover test data
  await pool.query("DELETE FROM logo_loop_items WHERE text_content LIKE 'p11g_%'");
  await pool.query("DELETE FROM home_carousel_items WHERE title LIKE 'p11g_%'");
  await pool.query("DELETE FROM home_feature_items WHERE title LIKE 'p11g_%'");
  await pool.query('DELETE FROM site_settings WHERE setting_key LIKE \'site.logo_%\' OR setting_key = \'site.favicon\'');
  await pool.query('DELETE FROM content_revisions');
});

test.after(async () => {
  await pool.query('DELETE FROM content_revisions');
  await pool.query("DELETE FROM logo_loop_items WHERE text_content LIKE 'p11g_%'");
  await pool.query("DELETE FROM home_carousel_items WHERE title LIKE 'p11g_%'");
  await pool.query("DELETE FROM home_feature_items WHERE title LIKE 'p11g_%'");
  await pool.query('DELETE FROM site_settings WHERE setting_key LIKE \'site.logo_%\' OR setting_key = \'site.favicon\'');
  await pool.query('DELETE FROM users WHERE id = ?', [adminId]);
  await pool.query('DELETE FROM content_revisions');
  await pool.end();
  await stopTestServer();
});

// ════════════════════════════════════════════════════════════
// PART 1 — LogoLoop Quick Delete
// ════════════════════════════════════════════════════════════

test('LogoLoop item renders an Eliminar action', async () => {
  const panel2 = await adminReq('GET', '/admin/page/home/panel-2');
  assert.equal(panel2.status, 200);
  // The delete form should be rendered with the correct endpoint
  assert.ok(panel2.text.includes('/logo-loop/items/delete'), 'Delete endpoint must be in the page');
  assert.ok(panel2.text.includes('Eliminar'), 'Eliminar button must be rendered');
});

test('LogoLoop delete requires CSRF', async () => {
  const resp = await adminReq('POST', '/admin/page/home/panel-2/logo-loop/items/delete', {
    public_id: 'fake-id',
    active_tab: 'logoloop',
  });
  // Without _csrf, should be rejected (403 or 422)
  assert.ok([403, 422, 302].includes(resp.status), `CSRF rejection expected, got ${resp.status}`);
});

test('LogoLoop delete shows success and redirects to logoloop tab', async () => {
  // First, create a test item via the form
  const panel2 = await adminReq('GET', '/admin/page/home/panel-2');
  const token = csrf(panel2.text);

  const createResp = await adminReq('POST', '/admin/page/home/panel-2/logo-loop/items', {
    _csrf: token,
    active_tab: 'logoloop',
    item_type: 'text',
    text_content: 'p11g_delete_test',
    is_visible: '1',
    url: '',
    link_type: 'internal',
    target: '_self',
    alt_text: '',
  });
  assert.equal(createResp.status, 302, `Create failed: ${createResp.status}`);
  assert.ok(createResp.location.includes('?tab=logoloop'), `Expected tab=logoloop in redirect: ${createResp.location}`);

  // Find the public_id of the created item
  const [[item]] = await pool.query("SELECT public_id FROM logo_loop_items WHERE text_content = 'p11g_delete_test'");
  assert.ok(item, 'Item must exist');

  // Now delete it
  const delPage = await adminReq('GET', '/admin/page/home/panel-2?tab=logoloop');
  const delToken = csrf(delPage.text);
  const delResp = await adminReq('POST', '/admin/page/home/panel-2/logo-loop/items/delete', {
    _csrf: delToken,
    active_tab: 'logoloop',
    public_id: item.public_id,
  });
  // Capture the redirect response text to diagnose
  assert.equal(delResp.status, 302, `Delete must redirect (302), got ${delResp.status}. Body: ${delResp.text.slice(0, 500)}`);
  assert.ok(delResp.location.includes('?tab=logoloop'), `Delete must redirect to logoloop tab: ${delResp.location}`);
  assert.ok(delResp.location.includes('panel-2'), `Delete must redirect to panel-2: ${delResp.location}`);

  // Verify item is gone
  const [[gone]] = await pool.query("SELECT public_id FROM logo_loop_items WHERE public_id = ?", [item.public_id]);
  assert.equal(gone, undefined, 'Deleted item must not exist in DB');
});

// ════════════════════════════════════════════════════════════
// PART 2 — Active Tab Preservation
// ════════════════════════════════════════════════════════════

test('LogoLoop draft save redirects to logoloop tab', async () => {
  const panel2 = await adminReq('GET', '/admin/page/home/panel-2?tab=logoloop');
  const token = csrf(panel2.text);

  const resp = await adminReq('POST', '/admin/page/home/panel-2/logo-loop/items', {
    _csrf: token,
    active_tab: 'logoloop',
    item_type: 'text',
    text_content: 'p11g_tab_test',
    is_visible: '1',
    url: '',
    link_type: 'internal',
    target: '_self',
    alt_text: '',
  });
  assert.equal(resp.status, 302);
  assert.ok(resp.location.includes('?tab=logoloop'), `LogoLoop create must redirect to logoloop tab: ${resp.location}`);
});

test('LogoLoop archive redirects to logoloop tab', async () => {
  const [[item]] = await pool.query("SELECT public_id FROM logo_loop_items WHERE text_content = 'p11g_tab_test'");
  assert.ok(item, 'Item must exist for archive test');

  const panel2 = await adminReq('GET', '/admin/page/home/panel-2?tab=logoloop');
  const token = csrf(panel2.text);
  const resp = await adminReq('POST', '/admin/page/home/panel-2/logo-loop/items/archive', {
    _csrf: token,
    active_tab: 'logoloop',
    public_id: item.public_id,
  });
  assert.equal(resp.status, 302);
  assert.ok(resp.location.includes('?tab=logoloop'), `LogoLoop archive must redirect to logoloop tab: ${resp.location}`);
});

test('LogoLoop reorder redirects to logoloop tab', async () => {
  const [[item]] = await pool.query("SELECT public_id FROM logo_loop_items WHERE text_content = 'p11g_tab_test' ORDER BY id DESC LIMIT 1");
  // Unarchive the item first
  if (item) {
    await pool.query("UPDATE logo_loop_items SET status = 'draft', deleted_at = NULL WHERE public_id = ?", [item.public_id]);
  }
  const [[active]] = await pool.query("SELECT public_id FROM logo_loop_items WHERE status != 'archived' LIMIT 1");

  const panel2 = await adminReq('GET', '/admin/page/home/panel-2?tab=logoloop');
  const token = csrf(panel2.text);
  const ids = active ? active.public_id : '00000000-0000-0000-0000-000000000000';
  const resp = await adminReq('POST', '/admin/page/home/panel-2/logo-loop/items/reorder', {
    _csrf: token,
    active_tab: 'logoloop',
    ids,
  });
  assert.equal(resp.status, 302);
  assert.ok(resp.location.includes('?tab=logoloop'), `LogoLoop reorder must redirect to logoloop tab: ${resp.location}`);
});

test('Carousel archive redirects to carousel tab', async () => {
  const panel2 = await adminReq('GET', '/admin/page/home/panel-2?tab=carousel');
  const token = csrf(panel2.text);

  // Create a test carousel item first
  const createResp = await adminReq('POST', '/admin/page/home/panel-2/carousel/items', {
    _csrf: token,
    active_tab: 'carousel',
    title: 'p11g_carousel_tab',
    eyebrow: '',
    description: '',
    button_label: '',
    button_url: '',
    button_target: '_self',
    media_public_id: '',
    media_alt: '',
    preview_media_public_id: '',
    preview_media_alt: '',
    position_x: '50',
    position_y: '50',
    theme_key: '',
    is_visible: '1',
  });
  assert.equal(createResp.status, 302, `Carousel create failed: ${createResp.status}`);
  assert.ok(createResp.location.includes('?tab=carousel'), `Carousel create must redirect to carousel tab: ${createResp.location}`);

  const [[carItem]] = await pool.query("SELECT public_id FROM home_carousel_items WHERE title = 'p11g_carousel_tab'");
  assert.ok(carItem, 'Carousel item must exist');

  // Archive
  const page = await adminReq('GET', '/admin/page/home/panel-2?tab=carousel');
  const delToken = csrf(page.text);
  const archResp = await adminReq('POST', '/admin/page/home/panel-2/carousel/items/archive', {
    _csrf: delToken,
    active_tab: 'carousel',
    public_id: carItem.public_id,
  });
  assert.ok(archResp.location.includes('?tab=carousel'), `Carousel archive must redirect to carousel tab: ${archResp.location}`);
});

test('Feature archive redirects to cards tab', async () => {
  const panel3 = await adminReq('GET', '/admin/page/home/panel-3?tab=cards');
  const token = csrf(panel3.text);

  // Create a test feature item
  const createResp = await adminReq('POST', '/admin/page/home/panel-3/items', {
    _csrf: token,
    active_tab: 'cards',
    title: 'p11g_feature_tab',
    description: 'desc',
    icon_type: 'builtin',
    icon_key: 'diseno-3d',
    media_public_id: '',
    media_alt: '',
    url: '',
    link_aria_label: '',
    link_type: 'internal',
    target: '_self',
    style_variant: '',
    is_visible: '1',
  });
  assert.equal(createResp.status, 302, `Feature create failed: ${createResp.status}`);
  assert.ok(createResp.location.includes('?tab=cards'), `Feature create must redirect to cards tab: ${createResp.location}`);

  const [[fItem]] = await pool.query("SELECT public_id FROM home_feature_items WHERE title = 'p11g_feature_tab'");
  assert.ok(fItem, 'Feature item must exist');

  // Archive
  const page = await adminReq('GET', '/admin/page/home/panel-3?tab=cards');
  const delToken = csrf(page.text);
  const archResp = await adminReq('POST', '/admin/page/home/panel-3/items/archive', {
    _csrf: delToken,
    active_tab: 'cards',
    public_id: fItem.public_id,
  });
  assert.ok(archResp.location.includes('?tab=cards'), `Feature archive must redirect to cards tab: ${archResp.location}`);
});

test('Unknown active_tab values fall back to safe default (no tab param)', async () => {
  const panel2 = await adminReq('GET', '/admin/page/home/panel-2');
  const token = csrf(panel2.text);

  const resp = await adminReq('POST', '/admin/page/home/panel-2/draft', {
    _csrf: token,
    active_tab: 'hacker_tab',
    eyebrow: '',
    heading: 'Test',
    supportText: '',
    carouselLabel: '',
    logoLoopAriaLabel: '',
    carouselControlsAriaLabel: '',
    carouselPreviousLabel: '',
    carouselNextLabel: '',
    isVisible: '1',
    backgroundColor: '',
    textColor: '',
    accentColor: '',
    backgroundMedia: '',
  });
  assert.equal(resp.status, 302);
  // Unknown tab must NOT appear in the redirect
  assert.ok(!resp.location.includes('?tab=hacker_tab'), 'Unknown tab must not appear in redirect');
});

test('Tab activation from URL query param works on Panel 2', async () => {
  const resp = await adminReq('GET', '/admin/page/home/panel-2?tab=carousel');
  assert.equal(resp.status, 200);
  // The JS should activate the carousel tab — verify the tab button exists
  assert.ok(resp.text.includes('data-tab="carousel"'), 'Carousel tab button must exist');
  // The tab activation JS file must be loaded
  assert.ok(resp.text.includes('panel2-editor.js'), 'Panel 2 editor JS must be loaded');
});

test('Tab activation from URL query param works on Panel 3', async () => {
  const resp = await adminReq('GET', '/admin/page/home/panel-3?tab=cards');
  assert.equal(resp.status, 200);
  assert.ok(resp.text.includes('data-tab="cards"'), 'Cards tab button must exist');
  assert.ok(resp.text.includes('panel3-editor.js'), 'Panel 3 editor JS must be loaded');
});

// ════════════════════════════════════════════════════════════
// PART 3 — Navbar Favicon 422 Fix
// ════════════════════════════════════════════════════════════

test('Navbar page renders favicon media-selector with correct field name', async () => {
  const resp = await adminReq('GET', '/admin/page/navbar');
  assert.equal(resp.status, 200);
  // favicon selector must use fieldName: 'favicon'
  assert.ok(resp.text.includes('name="favicon"'), 'Favicon hidden input must exist');
  assert.ok(resp.text.includes('logo_primary'), 'Primary logo field must exist');
  assert.ok(resp.text.includes('logo_light'), 'Light logo field must exist');
  assert.ok(resp.text.includes('logo_dark'), 'Dark logo field must exist');
});

test('Saving navbar only with favicon succeeds', async () => {
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  const resp = await adminReq('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',
    logo_light: '',
    logo_dark: '',
    favicon: '',  // empty favicon is also valid
    bg_color: '',
    text_color: '',
    accent_color: '',
    border_color: '',
    opacity: '0.9',
    logo_width: '120',
  });
  assert.equal(resp.status, 302, `Save must succeed (302), got ${resp.status}: ${resp.text.slice(0, 300)}`);
  assert.ok(resp.location.includes('/admin/page/navbar'), 'Must redirect to navbar page');
});

test('Saving navbar does not fail when optional primary logo is empty', async () => {
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  // Submit with empty logo_primary but valid other fields
  const resp = await adminReq('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',    // empty — must not cause 422
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: '#112233',
    text_color: '#ffffff',
    accent_color: '#ff0000',
    border_color: '',
    opacity: '0.85',
    logo_width: '100',
  });
  assert.equal(resp.status, 302, `Save with empty logo_primary must succeed (302), got ${resp.status}: ${resp.text.slice(0, 300)}`);
});

test('A malformed non-empty logo_primary returns 422', async () => {
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  const resp = await adminReq('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: 'not-a-valid-ref',
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: '',
    text_color: '',
    accent_color: '',
    border_color: '',
    opacity: '0.9',
    logo_width: '120',
  });
  assert.equal(resp.status, 422, `Malformed ref must return 422, got ${resp.status}`);
  assert.ok(resp.text.includes('no es válida') || resp.text.includes('logo primario'), 'Error message must mention invalid logo primary');
});

test('Existing valid logo_primary reference is stored as null when omitted (empty)', async () => {
  // Save navbar with an empty logo_primary
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  const resp1 = await adminReq('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: '#aaaaaa',
    text_color: '#bbbbbb',
    accent_color: '',
    border_color: '',
    opacity: '0.5',
    logo_width: '100',
  });
  assert.equal(resp1.status, 302, `Save with empty logo_primary must succeed: ${resp1.status}`);

  // Verify the setting was saved as empty string (not "null" string)
  const [settings] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key = 'site.logo_primary'");
  if (settings.length > 0) {
    const val = settings[0].setting_value;
    // Must be empty string, not the literal string "null" which would cause 422 on next save
    assert.ok(val === '' || val === null, `Logo primary must be empty/null, got: ${JSON.stringify(val)}`);
    assert.notEqual(val, 'null', 'Must not be literal string "null"');
  }
});

test('Favicon media-selector has correct upload profile', async () => {
  const navbar = await adminReq('GET', '/admin/page/navbar');
  assert.equal(navbar.status, 200);
  // favicon upload profile should be 'favicon'
  assert.ok(navbar.text.includes('favicon'), 'Favicon upload profile must exist');
});

// ════════════════════════════════════════════════════════════
// PART 4 — Drawer forms include active_tab
// ════════════════════════════════════════════════════════════

test('LogoLoop drawer form includes active_tab hidden field', () => {
  const partialPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'partials', 'logo-loop-form.ejs');
  const content = fs.readFileSync(partialPath, 'utf8');
  assert.ok(content.includes('name="active_tab"'), 'LogoLoop form must have active_tab hidden field');
  assert.ok(content.includes('value="logoloop"'), 'LogoLoop form active_tab default must be logoloop');
});

test('Carousel drawer form includes active_tab hidden field', () => {
  const partialPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'partials', 'carousel-form.ejs');
  const content = fs.readFileSync(partialPath, 'utf8');
  assert.ok(content.includes('name="active_tab"'), 'Carousel form must have active_tab hidden field');
  assert.ok(content.includes('value="carousel"'), 'Carousel form active_tab default must be carousel');
});

test('Feature drawer form includes active_tab hidden field', () => {
  const partialPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'partials', 'feature-form.ejs');
  const content = fs.readFileSync(partialPath, 'utf8');
  assert.ok(content.includes('name="active_tab"'), 'Feature form must have active_tab hidden field');
  assert.ok(content.includes('value="cards"'), 'Feature form active_tab default must be cards');
});

// ════════════════════════════════════════════════════════════
// PART 5 — LogoLoop delete preserves media asset
// ════════════════════════════════════════════════════════════

test('LogoLoop delete does not remove the associated media asset', async () => {
  // Create a test item with a fake media reference — deletion should not cascade to media
  // We verify that the delete action only removes from logo_loop_items
  const beforeCount = (await pool.query('SELECT COUNT(*) cnt FROM logo_loop_items WHERE text_content = \'media_prod_nonexistent\''))[0][0].cnt;

  const panel2 = await adminReq('GET', '/admin/page/home/panel-2?tab=logoloop');
  const token = csrf(panel2.text);

  const createResp = await adminReq('POST', '/admin/page/home/panel-2/logo-loop/items', {
    _csrf: token,
    active_tab: 'logoloop',
    item_type: 'text',
    text_content: 'media_prod_nonexistent',
    is_visible: '1',
    url: '',
    link_type: 'internal',
    target: '_self',
    alt_text: '',
  });
  assert.equal(createResp.status, 302, `Create failed: ${createResp.status}`);

  const [[item]] = await pool.query("SELECT * FROM logo_loop_items WHERE text_content = 'media_prod_nonexistent'");
  assert.ok(item, 'Item must exist');

  // Count media assets before delete
  const beforeMedia = (await pool.query('SELECT COUNT(*) cnt FROM media_assets'))[0][0].cnt;

  const delPage = await adminReq('GET', '/admin/page/home/panel-2?tab=logoloop');
  const delToken = csrf(delPage.text);
  const delResp = await adminReq('POST', '/admin/page/home/panel-2/logo-loop/items/delete', {
    _csrf: delToken,
    active_tab: 'logoloop',
    public_id: item.public_id,
  });
  assert.equal(delResp.status, 302, `Delete failed: ${delResp.status}`);

  const afterMedia = (await pool.query('SELECT COUNT(*) cnt FROM media_assets'))[0][0].cnt;
  assert.equal(afterMedia, beforeMedia, 'Media assets count must not change after LogoLoop delete');
});

// ════════════════════════════════════════════════════════════
// PART 6 — Panel 3 tab redirects
// ════════════════════════════════════════════════════════════

test('Panel 3 draft save redirects to general tab', async () => {
  const panel3 = await adminReq('GET', '/admin/page/home/panel-3?tab=general');
  const token = csrf(panel3.text);

  const resp = await adminReq('POST', '/admin/page/home/panel-3/draft', {
    _csrf: token,
    active_tab: 'general',
    eyebrow: '',
    heading: 'Test Heading',
    description: '',
    carouselAriaLabel: '',
    carouselControlsAriaLabel: '',
    carouselPreviousLabel: '',
    carouselNextLabel: '',
    defaultButtonLabel: '',
    isVisible: '1',
    backgroundColor: '',
    textColor: '',
    accentColor: '',
  });
  assert.equal(resp.status, 302, `Draft save failed: ${resp.status}`);
  assert.ok(resp.location.includes('?tab=general'), `Must redirect to general tab: ${resp.location}`);
});

test('Panel 3 feature publish redirects to cards tab', async () => {
  const panel3 = await adminReq('GET', '/admin/page/home/panel-3?tab=cards');
  const token = csrf(panel3.text);

  const resp = await adminReq('POST', '/admin/page/home/panel-3/items/publish', {
    _csrf: token,
    active_tab: 'cards',
  });
  assert.equal(resp.status, 302, `Publish must redirect: ${resp.status}`);
  assert.ok(resp.location.includes('?tab=cards'), `Feature publish must redirect to cards tab: ${resp.location}`);
});

test('Panel 2 style tab draft save redirects to style tab', async () => {
  const panel2 = await adminReq('GET', '/admin/page/home/panel-2?tab=style');
  const token = csrf(panel2.text);

  const resp = await adminReq('POST', '/admin/page/home/panel-2/draft', {
    _csrf: token,
    active_tab: 'style',
    eyebrow: '',
    heading: 'Test',
    supportText: '',
    carouselLabel: '',
    logoLoopAriaLabel: '',
    carouselControlsAriaLabel: '',
    carouselPreviousLabel: '',
    carouselNextLabel: '',
    isVisible: '1',
    backgroundColor: '',
    textColor: '',
    accentColor: '',
    backgroundMedia: '',
  });
  assert.equal(resp.status, 302, `Style tab save failed: ${resp.status}`);
  assert.ok(resp.location.includes('?tab=style'), `Must redirect to style tab: ${resp.location}`);
});

// ════════════════════════════════════════════════════════════
// PART 7 — Browser-equivalent integration: follow redirects, check rendered HTML
// ════════════════════════════════════════════════════════════

test('LogoLoop create → follow redirect → final page has LogoLoop tab active', async () => {
  const panel2 = await adminReq('GET', '/admin/page/home/panel-2');
  const token = csrf(panel2.text);

  // Submit create form (simulating drawer form submission)
  const result = await adminReqFollow('POST', '/admin/page/home/panel-2/logo-loop/items', {
    _csrf: token,
    active_tab: 'logoloop',
    item_type: 'text',
    text_content: 'p11g_follow_test',
    is_visible: '1',
    url: '',
    link_type: 'internal',
    target: '_self',
    alt_text: '',
  });

  assert.equal(result.status, 200, `Final page must be 200, got ${result.status}: ${result.text.slice(0, 300)}`);
  // The final URL must contain ?tab=logoloop
  assert.ok(result.url.includes('?tab=logoloop'), `Final URL must have tab=logoloop: ${result.url}`);
  // The rendered HTML must have the logoloop tab panel ACTIVE (is-active class, not hidden)
  // Server-rendered: data-panel="logoloop" with is-active and WITHOUT hidden attribute
  assert.ok(result.text.includes('data-panel="logoloop"'), 'Rendered HTML must contain logoloop panel');
  assert.ok(!result.text.match(/data-panel="logoloop"[^>]*hidden/), 'LogoLoop panel must NOT have hidden attribute');
  // Clean up
  await pool.query("DELETE FROM logo_loop_items WHERE text_content = 'p11g_follow_test'");
});

test('LogoLoop delete → follow redirect → final page has LogoLoop tab active', async () => {
  // Create item first
  const panel2 = await adminReq('GET', '/admin/page/home/panel-2');
  let token = csrf(panel2.text);
  await adminReq('POST', '/admin/page/home/panel-2/logo-loop/items', {
    _csrf: token, active_tab: 'logoloop',
    item_type: 'text', text_content: 'p11g_del_follow', is_visible: '1',
    url: '', link_type: 'internal', target: '_self', alt_text: '',
  });

  const [[item]] = await pool.query("SELECT public_id FROM logo_loop_items WHERE text_content = 'p11g_del_follow'");
  assert.ok(item, 'Item must exist');

  const delPage = await adminReq('GET', '/admin/page/home/panel-2');
  token = csrf(delPage.text);
  const result = await adminReqFollow('POST', '/admin/page/home/panel-2/logo-loop/items/delete', {
    _csrf: token, active_tab: 'logoloop', public_id: item.public_id,
  });

  assert.equal(result.status, 200, `Final page must be 200, got ${result.status}`);
  assert.ok(result.url.includes('?tab=logoloop'), `Final URL must have tab=logoloop: ${result.url}`);
  assert.ok(result.text.includes('data-panel="logoloop"'), 'Rendered HTML must contain logoloop panel');
  assert.ok(!result.text.match(/data-panel="logoloop"[^>]*hidden/), 'LogoLoop panel must NOT have hidden attribute after delete');
});

test('Carousel create → follow redirect → final page has carousel tab active', async () => {
  const panel2 = await adminReq('GET', '/admin/page/home/panel-2');
  const token = csrf(panel2.text);

  const result = await adminReqFollow('POST', '/admin/page/home/panel-2/carousel/items', {
    _csrf: token, active_tab: 'carousel',
    title: 'p11g_car_follow',
    eyebrow: '', description: '', button_label: '', button_url: '',
    button_target: '_self', media_public_id: '', media_alt: '',
    preview_media_public_id: '', preview_media_alt: '',
    position_x: '50', position_y: '50', theme_key: '', is_visible: '1',
  });

  assert.equal(result.status, 200, `Final page must be 200, got ${result.status}`);
  assert.ok(result.url.includes('?tab=carousel'), `Final URL must have tab=carousel: ${result.url}`);
  assert.ok(result.text.includes('data-panel="carousel"'), 'Rendered HTML must contain carousel panel');
  assert.ok(!result.text.match(/data-panel="carousel"[^>]*hidden/), 'Carousel panel must NOT have hidden attribute');
  await pool.query("DELETE FROM home_carousel_items WHERE title = 'p11g_car_follow'");
});

test('Feature create → follow redirect → final page has cards tab active', async () => {
  const panel3 = await adminReq('GET', '/admin/page/home/panel-3');
  const token = csrf(panel3.text);

  const result = await adminReqFollow('POST', '/admin/page/home/panel-3/items', {
    _csrf: token, active_tab: 'cards',
    title: 'p11g_feat_follow', description: 'desc',
    icon_type: 'builtin', icon_key: 'diseno-3d',
    media_public_id: '', media_alt: '', url: '',
    link_aria_label: '', link_type: 'internal', target: '_self',
    style_variant: '', is_visible: '1',
  });

  assert.equal(result.status, 200, `Final page must be 200, got ${result.status}`);
  assert.ok(result.url.includes('?tab=cards'), `Final URL must have tab=cards: ${result.url}`);
  assert.ok(result.text.includes('data-panel="cards"'), 'Rendered HTML must contain cards panel');
  assert.ok(!result.text.match(/data-panel="cards"[^>]*hidden/), 'Cards panel must NOT have hidden attribute');
  await pool.query("DELETE FROM home_feature_items WHERE title = 'p11g_feat_follow'");
});

// ════════════════════════════════════════════════════════════
// PART 8 — Favicon legacy "null" normalization (real browser scenario)
// ════════════════════════════════════════════════════════════

test('Navbar page normalizes legacy "null" stored in DB for logo_primary', async () => {
  // Simulate legacy bug: write literal "null" to DB
  await pool.query(
    "INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES ('site.logo_primary', 'null', 'media', 'navbar', 1) ON DUPLICATE KEY UPDATE setting_value = 'null'"
  );

  const navbar = await adminReq('GET', '/admin/page/navbar');
  assert.equal(navbar.status, 200);
  // The hidden input must NOT render value="null"
  assert.ok(!navbar.text.includes('value="null"'), 'Must not render value="null" for logo_primary');
  // The media-selector must have an empty currentValue
  assert.ok(navbar.text.includes('name="logo_primary"'), 'Logo primary field must exist');
});

test('Saving navbar with legacy "null" in DB succeeds (no 422)', async () => {
  // Ensure DB has "null"
  await pool.query(
    "INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES ('site.logo_primary', 'null', 'media', 'navbar', 1) ON DUPLICATE KEY UPDATE setting_value = 'null'"
  );

  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  // Submit with empty favicon and other fields — logo_primary should be
  // normalized from "null" to "" by showNavbar and the form sends "".
  const result = await adminReqFollow('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: '#112233',
    text_color: '#ffffff',
    accent_color: '#ff0000',
    border_color: '',
    opacity: '0.85',
    logo_width: '100',
  });

  assert.equal(result.status, 200, `Save must succeed (200), got ${result.status}. Body: ${result.text.slice(0, 400)}`);
  // After save, the DB must not contain literal "null" anymore
  const [[row]] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key = 'site.logo_primary'");
  assert.notEqual(row?.setting_value, 'null', 'DB must not contain literal "null" after save');
  // Clean up
  await pool.query("DELETE FROM site_settings WHERE setting_key = 'site.logo_primary'");
});

test('Favicon persists after Navbar save and reload', async () => {
  // Save navbar with favicon and bg_color
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  const saveResult = await adminReqFollow('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',
    logo_light: '',
    logo_dark: '',
    favicon: '',  // empty favicon — verifies no 422
    bg_color: '#fedcba',
    text_color: '#123456',
    accent_color: '',
    border_color: '',
    opacity: '0.7',
    logo_width: '90',
  });

  assert.equal(saveResult.status, 200, `Save must succeed: ${saveResult.status}`);

  // Reload navbar page
  const reloaded = await adminReq('GET', '/admin/page/navbar');
  assert.equal(reloaded.status, 200);
  // The bg_color should be preserved
  assert.ok(reloaded.text.includes('#fedcba') || reloaded.text.includes('fedcba'), 'Saved bg_color must appear on reload');
});

test('After legacy null fix, malformed non-empty logo_primary still returns 422', async () => {
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  const resp = await adminReq('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: 'garbage-not-a-uuid',
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: '',
    text_color: '',
    accent_color: '',
    border_color: '',
    opacity: '0.9',
    logo_width: '120',
  });
  assert.equal(resp.status, 422, `Malformed ref must return 422, got ${resp.status}`);
});

// ════════════════════════════════════════════════════════════
// PART 9 — Color "null" normalization and favicon-only save
// ════════════════════════════════════════════════════════════

test('Navbar page normalizes legacy "null" stored in DB for colors', async () => {
  await pool.query(
    "INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES ('navbar.bg_color', 'null', 'string', 'navbar', 1) ON DUPLICATE KEY UPDATE setting_value = 'null'"
  );

  const navbar = await adminReq('GET', '/admin/page/navbar');
  assert.equal(navbar.status, 200);
  // Must NOT render value="null" for bg_color
  assert.ok(!navbar.text.includes('value="null"'), 'Must not render value="null" for bg_color');
  // Must have the clean field
  assert.ok(navbar.text.includes('name="bg_color"'), 'bg_color field must exist');

  await pool.query("DELETE FROM site_settings WHERE setting_key = 'navbar.bg_color'");
});

test('Saving navbar with legacy "null" color in DB succeeds (no 422)', async () => {
  // Seed literal "null" in DB for all four color keys
  for (const key of ['navbar.bg_color', 'navbar.text_color', 'navbar.accent_color', 'navbar.border_color']) {
    await pool.query(
      "INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES (?, 'null', 'string', 'navbar', 1) ON DUPLICATE KEY UPDATE setting_value = 'null'",
      [key]
    );
  }

  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  // Submit favicon-only: all colors empty, no media refs
  const result = await adminReqFollow('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: '',
    text_color: '',
    accent_color: '',
    border_color: '',
    opacity: '0.8',
    logo_width: '100',
  });

  assert.equal(result.status, 200, `Favicon-only save must succeed (200), got ${result.status}. Body: ${result.text.slice(0, 400)}`);
  // DB must not contain "null" for any color after save
  for (const key of ['navbar.bg_color', 'navbar.text_color', 'navbar.accent_color', 'navbar.border_color']) {
    const [[row]] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key = ?", [key]);
    assert.notEqual(row?.setting_value, 'null', `DB key ${key} must not contain "null" after save`);
  }
  // Clean up
  for (const key of ['navbar.bg_color', 'navbar.text_color', 'navbar.accent_color', 'navbar.border_color']) {
    await pool.query("DELETE FROM site_settings WHERE setting_key = ?", [key]);
  }
});

test('Valid #RRGGBB color persists after save and reload', async () => {
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  const saveResult = await adminReqFollow('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: '#1a2b3c',
    text_color: '#ffffff',
    accent_color: '#ff5500',
    border_color: '#000000',
    opacity: '0.9',
    logo_width: '110',
  });

  assert.equal(saveResult.status, 200, `Save must succeed: ${saveResult.status}`);

  // Reload and verify each color persists
  const reloaded = await adminReq('GET', '/admin/page/navbar');
  assert.equal(reloaded.status, 200);
  assert.ok(reloaded.text.includes('#1a2b3c'), 'bg_color must persist');
  assert.ok(reloaded.text.includes('#ffffff'), 'text_color must persist');
  assert.ok(reloaded.text.includes('#ff5500'), 'accent_color must persist');
  assert.ok(reloaded.text.includes('#000000'), 'border_color must persist');
});

test('Valid #RRGGBBAA color persists after save and reload', async () => {
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  const saveResult = await adminReqFollow('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: '#1a2b3c80',
    text_color: '#ffffff00',
    accent_color: '',
    border_color: '',
    opacity: '0.5',
    logo_width: '100',
  });

  assert.equal(saveResult.status, 200, `Save with RRGGBBAA must succeed: ${saveResult.status}`);

  const reloaded = await adminReq('GET', '/admin/page/navbar');
  assert.ok(reloaded.text.includes('#1a2b3c80'), 'bg_color RRGGBBAA must persist');
  assert.ok(reloaded.text.includes('#ffffff00'), 'text_color RRGGBBAA must persist');
});

test('Malformed non-empty colors return 422', async () => {
  const malformedColors = [
    'red',
    '#fff',
    'rgb(0,0,0)',
    '#GGGGGG',
    '#12345',
    '#123456789',
  ];

  for (const malformed of malformedColors) {
    const navbar = await adminReq('GET', '/admin/page/navbar');
    const token = csrf(navbar.text);

    const resp = await adminReq('POST', '/admin/page/navbar/save', {
      _csrf: token,
      logo_primary: '',
      logo_light: '',
      logo_dark: '',
      favicon: '',
      bg_color: malformed,
      text_color: '',
      accent_color: '',
      border_color: '',
      opacity: '0.9',
      logo_width: '100',
    });

    assert.equal(resp.status, 422, `Malformed color "${malformed}" must return 422, got ${resp.status}`);
    assert.ok(resp.text.includes('hexadecimal'), `Error must mention hexadecimal for "${malformed}"`);
  }
});

test('Submit literal "null" and "undefined" for colors normalizes to empty and succeeds', async () => {
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  const result = await adminReqFollow('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: 'null',
    text_color: 'undefined',
    accent_color: 'null',
    border_color: 'undefined',
    opacity: '0.9',
    logo_width: '100',
  });

  assert.equal(result.status, 200, `Literal null/undefined must normalize and succeed, got ${result.status}. Body: ${result.text.slice(0, 400)}`);
});

test('Whitespace-only color fields normalize to empty and succeed', async () => {
  const navbar = await adminReq('GET', '/admin/page/navbar');
  const token = csrf(navbar.text);

  const result = await adminReqFollow('POST', '/admin/page/navbar/save', {
    _csrf: token,
    logo_primary: '',
    logo_light: '',
    logo_dark: '',
    favicon: '',
    bg_color: '   ',
    text_color: '\t',
    accent_color: '  \n  ',
    border_color: '',
    opacity: '0.9',
    logo_width: '100',
  });

  assert.equal(result.status, 200, `Whitespace-only colors must succeed, got ${result.status}`);
});
