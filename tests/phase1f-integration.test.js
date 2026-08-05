/**
 * Phase 1F — Store Hero CMS HTTP integration tests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { startTestServer, stopTestServer } = require('./testServer');
const { migrateStoreHeroCms } = require('../scripts/migrate-store-hero-cms');

const marker = `p1f_int_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const adminEmail = `${marker}@example.invalid`;
const password = `Sh-${crypto.randomBytes(8).toString('hex')}!`;
let baseUrl;
let adminId;
let originalContent;
let originalPublished;

function assertSafeLocalDatabase() {
  const { assertSafeTestDatabase } = require('../config/testDatabaseGuard');
  assertSafeTestDatabase({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || '',
  }, { requireMutationOptIn: true });
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'Must render a CSRF token');
  return match[1];
}

function heroPayload(token, overrides = {}) {
  return {
    _csrf: token,
    isVisible: '1',
    eyebrow: overrides.eyebrow ?? `${marker} eyebrow`,
    title: overrides.title ?? `${marker} title`,
    description: overrides.description ?? `${marker} description`,
    backgroundMedia: overrides.backgroundMedia ?? '',
    imageAlt: overrides.imageAlt ?? `${marker} img alt`,
    imagePosition: overrides.imagePosition ?? 'center',
    primaryLabel: overrides.primaryLabel ?? '',
    primaryUrl: overrides.primaryUrl ?? '',
    buttonTarget: overrides.buttonTarget ?? '_self',
    ariaLabel: overrides.ariaLabel ?? '',
  };
}

// ── Shared admin session for all admin tests ──
let adminJar = { cookie: '' };

async function adminReq(method, reqPath, fields = null) {
  const headers = {};
  let body;
  if (fields) {
    body = new URLSearchParams(fields).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (adminJar.cookie) headers.Cookie = adminJar.cookie;
  const resp = await fetch(`${baseUrl}${reqPath}`, { method, headers, body, redirect: 'manual' });
  const cookie = resp.headers.get('set-cookie');
  if (cookie) adminJar.cookie = cookie.split(';')[0];
  return { status: resp.status, location: resp.headers.get('location') || '', text: await resp.text() };
}

test.before(async () => {
  assertSafeLocalDatabase();
  const info = await startTestServer();
  baseUrl = info.baseUrl;

  await migrateStoreHeroCms();

  const [[section]] = await pool.query(
    `SELECT s.content_json, s.published_content_json
       FROM page_sections s
      INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = 'tienda' AND s.section_key = 'st-hero'`
  );
  if (section) {
    originalContent = section.content_json;
    originalPublished = section.published_content_json;
  }

  const hash = await bcrypt.hash(password, 8);
  const [userResult] = await pool.query(
    'INSERT INTO users (name, email, password, role_id, is_active) VALUES (?, ?, ?, 1, 1)',
    [`Admin ${marker}`, adminEmail, hash]
  );
  adminId = userResult.insertId;

  // Login once, share session for all admin tests
  const loginPage = await adminReq('GET', '/auth/login?returnTo=%2Fadmin');
  const loginResp = await adminReq('POST', '/auth/login', {
    email: adminEmail, password,
    _csrf: csrf(loginPage.text),
    returnTo: '/admin',
  });
  assert.equal(loginResp.status, 302, `Setup login failed: ${loginResp.status}`);
});

test.after(async () => {
  if (originalContent !== undefined) {
    await pool.query(
      `UPDATE page_sections s
       INNER JOIN pages p ON p.id = s.page_id
       SET s.content_json = ?, s.published_content_json = ?, s.status = 'published', s.is_enabled = 1
       WHERE p.page_key = 'tienda' AND s.section_key = 'st-hero'`,
      [originalContent, originalPublished]
    );
  }
  await pool.query('DELETE FROM users WHERE id = ?', [adminId]);
  await pool.end();
  await stopTestServer();
});

// ══════════════════════════════════════════════════════════════════

test('1. Admin loads Store Hero editor', async () => {
  const resp = await adminReq('GET', '/admin/page/store-hero');
  assert.equal(resp.status, 200);
  assert.match(resp.text, /Hero de Tienda/);
  assert.match(resp.text, /sticky-actions/);
  assert.match(resp.text, /data-advanced-section/);
});

test('2. Normal user blocked from Store Hero editor', async () => {
  const resp = await fetch(`${baseUrl}/admin/page/store-hero`, { redirect: 'manual' });
  assert.ok([302, 401].includes(resp.status));
});

test('3. Save persists draft; refresh keeps draft', async () => {
  let page = await adminReq('GET', '/admin/page/store-hero');
  assert.equal(page.status, 200);

  const draftTitle = `${marker} draft ${Date.now()}`;
  const payload = heroPayload(csrf(page.text), { title: draftTitle });

  const saveResp = await adminReq('POST', '/admin/page/store-hero/save', payload);
  assert.equal(saveResp.status, 302);

  page = await adminReq('GET', '/admin/page/store-hero');
  assert.match(page.text, new RegExp(draftTitle));
});

test('4. Public /tienda unchanged after draft save', async () => {
  const page = await adminReq('GET', '/admin/page/store-hero');
  const secretTitle = `${marker} draft_secret ${Date.now()}`;
  await adminReq('POST', '/admin/page/store-hero/save', heroPayload(csrf(page.text), { title: secretTitle }));

  const pubResp = await fetch(`${baseUrl}/tienda`);
  const pubText = await pubResp.text();
  assert.equal(pubResp.status, 200);
  assert.doesNotMatch(pubText, new RegExp(secretTitle));
});

test('5. Publish updates /tienda', async () => {
  let page = await adminReq('GET', '/admin/page/store-hero');
  const pubTitle = `${marker} published ${Date.now()}`;
  await adminReq('POST', '/admin/page/store-hero/save', heroPayload(csrf(page.text), { title: pubTitle }));

  page = await adminReq('GET', '/admin/page/store-hero');
  const pubResp = await adminReq('POST', '/admin/page/store-hero/publish', {
    _csrf: csrf(page.text),
  });
  assert.equal(pubResp.status, 302);

  const publicResp = await fetch(`${baseUrl}/tienda`);
  const publicText = await publicResp.text();
  assert.equal(publicResp.status, 200);
  assert.match(publicText, new RegExp(pubTitle));
});

test('6. Validation failure preserves values', async () => {
  const page = await adminReq('GET', '/admin/page/store-hero');
  const payload = heroPayload(csrf(page.text), { title: '', eyebrow: `${marker} kept` });

  const saveResp = await adminReq('POST', '/admin/page/store-hero/save', payload);
  if (saveResp.status === 422) {
    assert.match(saveResp.text, new RegExp(`${marker} kept`));
  } else {
    assert.equal(saveResp.status, 302);
    const nextPage = await adminReq('GET', '/admin/page/store-hero');
    assert.match(nextPage.text, new RegExp(`${marker} kept`));
  }
});
