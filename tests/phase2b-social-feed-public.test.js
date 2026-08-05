/**
 * Phase 2B — public homepage Social Feed and homepage section settings.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const pool = require('../config/db');
const { startTestServer, stopTestServer } = require('./testServer');
const { migrateSocialFeed } = require('../scripts/migrate-social-feed');
const {
  DEFAULT_CONTENT,
  migrateSocialFeedHomeSection,
} = require('../scripts/migrate-social-feed-home-section');
const social = require('../services/socialFeedService');
const cmsPublishing = require('../services/cmsPublishingService');
const { validateSocialFeedSettings } = require('../validators/socialFeedSectionValidator');

const marker = `p2b_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const password = `P2b-${crypto.randomBytes(8).toString('hex')}!`;
const email = `${marker}@example.invalid`;
let baseUrl;
let adminId;
let sectionId;
let originalSection;
let sectionCreatedByTest = false;
const jar = { cookie: '' };

function safeDb() {
  const { assertSafeTestDatabase } = require('../config/testDatabaseGuard');
  assertSafeTestDatabase({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || '',
  }, { requireMutationOptIn: true });
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'Expected CSRF token');
  return match[1];
}

async function request(method, requestPath, fields = null) {
  const headers = {};
  let body;
  if (fields) {
    body = new URLSearchParams(fields).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  if (jar.cookie) headers.cookie = jar.cookie;
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers,
    body,
    redirect: 'manual',
  });
  const cookie = response.headers.get('set-cookie');
  if (cookie) jar.cookie = cookie.split(';')[0];
  return {
    status: response.status,
    location: response.headers.get('location') || '',
    text: await response.text(),
    headers: response.headers,
  };
}

async function makePost(overrides = {}, publish = true) {
  const post = await social.createPost({
    platform: 'instagram',
    postUrl: `https://instagram.com/p/${crypto.randomBytes(5).toString('hex')}`,
    title: `${marker} ${crypto.randomBytes(3).toString('hex')}`,
    description: 'Descripción pública corta.',
    thumbnailMediaRef: '',
    embedEnabled: 0,
    displayMode: 'external',
    isActive: 1,
    isFeatured: 0,
    ...overrides,
  }, adminId);
  if (publish) await social.publishPost(post.publicId, adminId);
  return social.getPost(post.publicId);
}

test.before(async () => {
  safeDb();
  await migrateSocialFeed();
  const [[home]] = await pool.query("SELECT id FROM pages WHERE page_key = 'home' LIMIT 1");
  const [[before]] = await pool.query(
    "SELECT * FROM page_sections WHERE page_id = ? AND section_key = 'social-feed' LIMIT 1",
    [home.id]
  );
  originalSection = before || null;
  sectionCreatedByTest = !before;
  await migrateSocialFeedHomeSection(pool);
  await migrateSocialFeedHomeSection(pool);
  const [[section]] = await pool.query(
    "SELECT * FROM page_sections WHERE page_id = ? AND section_key = 'social-feed' LIMIT 1",
    [home.id]
  );
  sectionId = section.id;

  const hash = await bcrypt.hash(password, 8);
  const [created] = await pool.query(
    'INSERT INTO users (name, email, password, role_id, is_active) VALUES (?, ?, ?, 1, 1)',
    [`Admin ${marker}`, email, hash]
  );
  adminId = created.insertId;

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  const login = await request('GET', '/auth/login?returnTo=%2Fadmin%2Fpage%2Fsocial-feed');
  const response = await request('POST', '/auth/login', {
    email,
    password,
    _csrf: csrf(login.text),
    returnTo: '/admin/page/social-feed',
  });
  assert.equal(response.status, 302);
});

test.after(async () => {
  await pool.query('DELETE FROM content_revisions WHERE changed_by = ?', [adminId]).catch(() => {});
  await pool.query('DELETE FROM social_posts WHERE created_by = ?', [adminId]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = ?', [adminId]).catch(() => {});
  if (sectionCreatedByTest) {
    await pool.query('DELETE FROM page_sections WHERE id = ?', [sectionId]).catch(() => {});
  } else if (originalSection) {
    await pool.query(
      `UPDATE page_sections SET content_json = ?, style_json = ?, sort_order = ?,
       is_enabled = ?, status = ?, version = ?, published_content_json = ?,
       published_style_json = ?, published_at = ?, updated_by = ?
       WHERE id = ?`,
      [
        originalSection.content_json,
        originalSection.style_json,
        originalSection.sort_order,
        originalSection.is_enabled,
        originalSection.status,
        originalSection.version,
        originalSection.published_content_json,
        originalSection.published_style_json,
        originalSection.published_at,
        originalSection.updated_by,
        sectionId,
      ]
    ).catch(() => {});
  }
  await pool.end();
  await stopTestServer();
});

test('migration 25 is additive, idempotent, and seeds defaults after migration 24', async () => {
  const [[count]] = await pool.query(
    "SELECT COUNT(*) AS total FROM page_sections WHERE id = ? AND section_key = 'social-feed'",
    [sectionId]
  );
  assert.equal(Number(count.total), 1);
  const draft = await cmsPublishing.getSectionDraft('home', 'social-feed');
  assert.equal(draft.content.maximumPosts, 6);
  assert.equal(draft.content.title, DEFAULT_CONTENT.title);
});

test('settings validation covers enable, title, max, featured, platforms, and order', () => {
  const valid = validateSocialFeedSettings({
    enabled: '1',
    title: 'Redes',
    subtitle: 'Últimas publicaciones',
    maximumPosts: '4',
    featuredOnly: '1',
    platforms: ['instagram', 'youtube'],
    displayOrder: 'newest',
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.sanitized.platforms, ['instagram', 'youtube']);
  assert.equal(valid.sanitized.maximumPosts, 4);
  assert.equal(valid.sanitized.featuredOnly, true);
  assert.equal(validateSocialFeedSettings({ title: '', maximumPosts: '99' }).valid, false);
});

test('public feed excludes drafts, inactive posts, archives, and unsafe published URLs', async () => {
  const visible = await makePost({ isFeatured: 1 });
  await makePost({}, false);
  const inactive = await makePost({ platform: 'youtube', postUrl: 'https://youtube.com/watch?v=p2btest' });
  await social.setActive(inactive.publicId, false, adminId);
  const archived = await makePost();
  await social.archivePost(archived.publicId, adminId);
  const unsafe = await makePost();
  await pool.query(
    "UPDATE social_posts SET published_content_json = JSON_SET(published_content_json, '$.postUrl', 'javascript:alert(1)') WHERE public_id = ?",
    [unsafe.publicId]
  );

  const posts = await social.getPublicFeed({
    maximumPosts: 12,
    platforms: ['instagram', 'youtube'],
    displayOrder: 'manual',
  });
  assert.ok(posts.some((post) => post.publicId === visible.publicId));
  assert.ok(posts.every((post) => post.publicId !== inactive.publicId));
  assert.ok(posts.every((post) => post.publicId !== archived.publicId));
  assert.ok(posts.every((post) => post.publicId !== unsafe.publicId));
});

test('featured, platform, and maximum filters use published snapshots', async () => {
  await makePost({ isFeatured: 1 });
  await makePost({ isFeatured: 1 });
  await makePost({ isFeatured: 0 });
  await makePost({
    platform: 'youtube',
    postUrl: 'https://youtube.com/watch?v=p2bfilter',
    isFeatured: 1,
  });
  const filtered = await social.getPublicFeed({
    maximumPosts: 2,
    featuredOnly: true,
    platforms: ['instagram'],
    displayOrder: 'newest',
  });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((post) => post.platform === 'instagram' && post.isFeatured));
});

test('safe external/embed links and local thumbnail fallback render on homepage', async () => {
  const external = await makePost({ title: `${marker} external`, displayMode: 'external' });
  const embed = await makePost({
    title: `${marker} embed`,
    displayMode: 'embed',
    embedEnabled: 1,
  });
  await cmsPublishing.saveSectionDraft('home', 'social-feed', {
    ...DEFAULT_CONTENT,
    maximumPosts: 12,
  }, {}, { actorId: adminId });
  await cmsPublishing.publishSection('home', 'social-feed', { actorId: adminId });

  const home = await request('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /id="ninjalab-en-redes"/);
  assert.match(home.text, new RegExp(external.postUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(home.text, new RegExp(embed.postUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(home.text, /target="_blank"\s+rel="noopener noreferrer"/);
  assert.match(home.text, /src="\/images\/social-feed-fallback\.svg"/);
  assert.doesNotMatch(home.text, /<script[^>]+(?:instagram|facebook|tiktok|youtube)/i);
});

test('enabled/disabled published setting controls section visibility', async () => {
  await cmsPublishing.saveSectionDraft('home', 'social-feed', {
    ...DEFAULT_CONTENT,
    enabled: false,
  }, {}, { actorId: adminId });
  await cmsPublishing.publishSection('home', 'social-feed', { actorId: adminId });
  let home = await request('GET', '/');
  assert.doesNotMatch(home.text, /id="ninjalab-en-redes"/);

  await cmsPublishing.saveSectionDraft('home', 'social-feed', {
    ...DEFAULT_CONTENT,
    enabled: true,
  }, {}, { actorId: adminId });
  await cmsPublishing.publishSection('home', 'social-feed', { actorId: adminId });
  home = await request('GET', '/');
  assert.match(home.text, /id="ninjalab-en-redes"/);
});

test('CMS settings Save/Publish creates history and keeps restore links available', async () => {
  const page = await request('GET', '/admin/page/social-feed');
  assert.equal(page.status, 200);
  const token = csrf(page.text);
  const save = await request('POST', '/admin/page/social-feed/section/save', {
    _csrf: token,
    version: String((await cmsPublishing.getSectionDraft('home', 'social-feed')).version),
    enabled: '1',
    title: `${marker} settings`,
    subtitle: 'Configuración guardada',
    maximumPosts: '5',
    featuredOnly: '1',
    platforms: 'instagram',
    displayOrder: 'manual',
  });
  assert.equal(save.status, 302);

  const publishPage = await request('GET', '/admin/page/social-feed');
  const publish = await request('POST', '/admin/page/social-feed/section/publish', {
    _csrf: csrf(publishPage.text),
  });
  assert.equal(publish.status, 302);

  const [history] = await pool.query(
    `SELECT action FROM content_revisions
      WHERE entity_type = 'page_section' AND entity_id = ? AND changed_by = ?
      ORDER BY id DESC`,
    [sectionId, adminId]
  );
  assert.ok(history.some((entry) => entry.action === 'metadata_edit'));
  assert.ok(history.some((entry) => entry.action === 'publish'));
  const refreshed = await request('GET', '/admin/page/social-feed');
  assert.match(refreshed.text, /Historial y restauraci/);
  assert.match(refreshed.text, /\/admin\/page\/history\/revision\/\d+/);
});

test('desktop grid, mobile swipe row, keyboard controls, lazy images, and reduced motion are present', () => {
  const template = fs.readFileSync(path.join(__dirname, '../views/pages/home.ejs'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/home.css'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '../public/js/home/socialFeedRow.js'), 'utf8');
  assert.match(template, /social-public__grid/);
  assert.match(template, /data-social-feed-viewport/);
  assert.match(template, /loading="lazy"/);
  assert.match(template, /width="1200"\s+height="675"/);
  assert.match(css, /grid-template-columns:\s*repeat\(3/);
  assert.match(css, /scroll-snap-type:\s*x mandatory/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(runtime, /ArrowLeft/);
  assert.match(runtime, /ArrowRight/);
});

test('homepage, Store, Gallery, CSP, and Social Feed Admin regressions remain healthy', async () => {
  const [home, store, gallery, admin] = await Promise.all([
    request('GET', '/'),
    request('GET', '/tienda'),
    request('GET', '/galeria'),
    request('GET', '/admin/page/social-feed'),
  ]);
  assert.equal(home.status, 200);
  assert.equal(store.status, 200);
  assert.equal(gallery.status, 200);
  assert.equal(admin.status, 200);
  assert.ok(home.headers.get('content-security-policy'));
  assert.doesNotMatch(home.text, /<script[^>]+(?:instagram|facebook|tiktok|youtube)/i);
  assert.match(admin.text, /Posts curados/);
});
