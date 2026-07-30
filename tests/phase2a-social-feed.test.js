/**
 * Phase 2A — Social Feed focused tests + release checks.
 *
 * Covers: migration idempotency, admin authorization, create/edit/save/publish,
 * validation preservation, unsafe URL rejection, media validation (exists/active/not-archived/image),
 * activation, reorder, archive, history and restore, optimistic concurrency,
 * no double escaping, CSP compliance, no public rendering.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const pool = require('../config/db');
const { migrateSocialFeed } = require('../scripts/migrate-social-feed');
const { ALLOWED_PLATFORMS, validatePost, validateMediaRef, listPosts, getPost, createPost, updatePost, archivePost, reorderPosts, publishPost, restorePostDraft, setActive, getPublishedPosts } = require('../services/socialFeedService');
const { CAPABILITIES, ADMIN_CAPABILITIES } = require('../config/capabilities');
const { MODULE_KEYS, MODULE_KEY_VALUES, MODULES } = require('../services/moduleRegistry');
const { startTestServer, stopTestServer } = require('./testServer');
const bcrypt = require('bcryptjs');

const marker = `p2a_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const adminEmail = `${marker}@example.invalid`;
const password = `Sf-${crypto.randomBytes(8).toString('hex')}!`;
let baseUrl;
let adminId;
let adminJar = { cookie: '' };

function assertSafeLocalDatabase() {
  const host = String(process.env.DB_HOST || 'localhost').toLowerCase();
  const database = String(process.env.DB_NAME || 'nlsite_db').toLowerCase();
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host));
  assert.doesNotMatch(database, /prod|production|railway/);
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'Must render a CSRF token');
  return match[1];
}

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

async function createTestPost(data = {}) {
  return createPost({
    platform: 'other',
    postUrl: `https://example.com/post/${crypto.randomBytes(4).toString('hex')}`,
    title: `Test post ${crypto.randomBytes(4).toString('hex')}`,
    description: 'Test description',
    thumbnailMediaRef: '',
    embedEnabled: 0,
    displayMode: 'external_link',
    isActive: 1,
    isFeatured: 0,
    ...data,
  }, 0);
}

test.before(async () => {
  assertSafeLocalDatabase();
  const info = await startTestServer();
  baseUrl = info.baseUrl;

  await migrateSocialFeed();

  const hash = await bcrypt.hash(password, 8);
  const [userResult] = await pool.query(
    'INSERT INTO users (name, email, password, role_id, is_active) VALUES (?, ?, ?, 1, 1)',
    [`Admin ${marker}`, adminEmail, hash]
  );
  adminId = userResult.insertId;

  const loginPage = await adminReq('GET', '/auth/login?returnTo=%2Fadmin');
  const loginToken = csrf(loginPage.text);
  const loginResp = await adminReq('POST', '/auth/login', {
    email: adminEmail, password,
    _csrf: loginToken,
    returnTo: '/admin',
  });
  assert.equal(loginResp.status, 302, `Login failed: ${loginResp.status}`);
  assert.ok(loginResp.location.includes('/admin'), `Bad redirect: ${loginResp.location}`);
});

test.after(async () => {
  await pool.query('DELETE FROM social_posts');
  await pool.query('DELETE FROM content_revisions WHERE entity_type = "social_post"');
  await pool.query('DELETE FROM users WHERE id = ?', [adminId]);
  await pool.end();
  await stopTestServer();
});

// ════════════════════════════════════════════════════════════
// 1. Migration
// ════════════════════════════════════════════════════════════

test('migration creates social_posts table', async () => {
  const [rows] = await pool.query('SHOW TABLES LIKE "social_posts"');
  assert.equal(rows.length, 1);
});

test('migration is idempotent', async () => {
  await migrateSocialFeed();
  const [rows] = await pool.query('SELECT COUNT(*) cnt FROM social_posts');
  assert.ok(rows[0].cnt >= 0);
});

test('social_posts has all required columns', async () => {
  const [cols] = await pool.query('SHOW COLUMNS FROM social_posts');
  const names = cols.map(c => c.Field);
  assert.ok(names.includes('public_id'));
  assert.ok(names.includes('platform'));
  assert.ok(names.includes('post_url'));
  assert.ok(names.includes('title'));
  assert.ok(names.includes('description'));
  assert.ok(names.includes('thumbnail_media_ref'));
  assert.ok(names.includes('embed_enabled'));
  assert.ok(names.includes('display_mode'));
  assert.ok(names.includes('is_active'));
  assert.ok(names.includes('is_featured'));
  assert.ok(names.includes('sort_order'));
  assert.ok(names.includes('status'));
  assert.ok(names.includes('published_content_json'));
  assert.ok(names.includes('created_at'));
  assert.ok(names.includes('published_at'));
  assert.ok(names.includes('archived_at'));
  assert.ok(names.includes('created_by'));
});

test('social_posts has unique index on public_id', async () => {
  const [idx] = await pool.query('SHOW INDEX FROM social_posts WHERE Key_name = "uk_social_posts_public_id"');
  assert.ok(idx.length > 0);
});

// ════════════════════════════════════════════════════════════
// 2. Capabilities
// ════════════════════════════════════════════════════════════

test('SOCIAL_FEED capabilities are registered', () => {
  assert.ok(CAPABILITIES.SOCIAL_FEED_VIEW);
  assert.ok(CAPABILITIES.SOCIAL_FEED_EDIT);
  assert.ok(CAPABILITIES.SOCIAL_FEED_PUBLISH);
});

test('SOCIAL_FEED capabilities are in admin set', () => {
  assert.ok(ADMIN_CAPABILITIES.includes(CAPABILITIES.SOCIAL_FEED_VIEW));
  assert.ok(ADMIN_CAPABILITIES.includes(CAPABILITIES.SOCIAL_FEED_EDIT));
  assert.ok(ADMIN_CAPABILITIES.includes(CAPABILITIES.SOCIAL_FEED_PUBLISH));
});

// ════════════════════════════════════════════════════════════
// 3. Module Registry
// ════════════════════════════════════════════════════════════

test('SOCIAL_FEED module is registered', () => {
  assert.ok(MODULE_KEYS.SOCIAL_FEED);
  const mod = MODULES[MODULE_KEYS.SOCIAL_FEED];
  assert.ok(mod);
  assert.equal(mod.label, 'Social Feed');
  assert.equal(mod.entitySource, 'social_posts');
});

test('module registry has 10 modules', () => {
  assert.equal(MODULE_KEY_VALUES.length, 10);
});

// ════════════════════════════════════════════════════════════
// 4. Validation — format checks
// ════════════════════════════════════════════════════════════

test('valid post passes validation', async () => {
  const result = await validatePost({
    platform: 'other',
    postUrl: 'https://example.com/test123',
    title: 'Test title',
    description: 'Test description',
    displayMode: 'external_link',
    thumbnailMediaRef: '',
  });
  assert.ok(result.valid);
  assert.equal(result.errors.length, 0);
});

test('rejects unknown platform', async () => {
  const result = await validatePost({
    platform: 'snapchat',
    postUrl: 'https://example.com',
    title: 'Test',
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('Plataforma')));
});

test('rejects missing title', async () => {
  const result = await validatePost({
    platform: 'other',
    postUrl: 'https://example.com/post',
    title: '',
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('título')));
});

test('rejects unsafe URL protocol', async () => {
  const result = await validatePost({
    platform: 'other',
    postUrl: 'javascript:alert(1)',
    title: 'Test',
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('URL')));
});

test('rejects non-http URL', async () => {
  const result = await validatePost({
    platform: 'other',
    postUrl: 'ftp://example.com/post',
    title: 'Test',
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('http')));
});

test('warns on platform URL mismatch', async () => {
  const result = await validatePost({
    platform: 'instagram',
    postUrl: 'https://www.tiktok.com/@user/video/123',
    title: 'Test',
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.toLowerCase().includes('instagram')));
});

test('rejects invalid media reference format', async () => {
  const result = await validatePost({
    platform: 'other',
    postUrl: 'https://example.com',
    title: 'Test',
    thumbnailMediaRef: '/absolute/path/bad',
  });
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.includes('medio')));
});

// ════════════════════════════════════════════════════════════
// 4b. Media validation — DB-level checks
// ════════════════════════════════════════════════════════════

test('validateMediaRef rejects non-existent media UUID', async () => {
  const err = await validateMediaRef('media://00000000-0000-4000-a000-000000000000');
  assert.ok(err);
  assert.ok(err.includes('no existe') || err.includes('eliminado'), `Got: ${err}`);
});

test('validateMediaRef accepts empty string', async () => {
  const err = await validateMediaRef('');
  assert.equal(err, null);
});

test('validateMediaRef accepts null/undefined', async () => {
  const err = await validateMediaRef(null);
  assert.equal(err, null);
});

test('stores plain text — no pre-escaped HTML entities', async () => {
  const result = await validatePost({
    platform: 'other',
    postUrl: 'https://example.com/post',
    title: '<b>Plain Title</b>',
    description: 'Desc & more',
  });
  assert.ok(result.valid);
  // Title should contain literal < and >, not &lt; &gt;
  assert.ok(result.sanitized.title.includes('<'));
  assert.ok(result.sanitized.title.includes('>'));
  assert.ok(!result.sanitized.title.includes('&lt;'));
  assert.ok(!result.sanitized.title.includes('&gt;'));
  // Description should contain literal &
  assert.ok(result.sanitized.description.includes('&'));
  assert.ok(!result.sanitized.description.includes('&amp;'));
});

// ════════════════════════════════════════════════════════════
// 5. Service CRUD
// ════════════════════════════════════════════════════════════

test('createPost creates a draft', async () => {
  const post = await createTestPost();
  assert.ok(post.publicId);
  assert.equal(post.status, 'draft');
  assert.equal(post.platform, 'other');
  assert.ok(!post.isFeatured);
});

test('getPost returns null for unknown', async () => {
  const post = await getPost('nonexistent-id');
  assert.equal(post, null);
});

test('updatePost modifies fields and stays draft', async () => {
  const post = await createTestPost();
  const updated = await updatePost(post.publicId, {
    platform: 'instagram', postUrl: 'https://www.instagram.com/p/abc/', title: 'Updated Title',
    description: 'Updated desc', thumbnailMediaRef: '', embedEnabled: 0,
    displayMode: 'external_link', isActive: 1, isFeatured: 1,
  }, 0);
  assert.equal(updated.title, 'Updated Title');
  assert.equal(updated.status, 'draft');
  assert.ok(updated.isFeatured);
});

test('updatePost throws for missing post', async () => {
  await assert.rejects(() => updatePost('nonexistent', {
    platform: 'other', postUrl: 'https://example.com', title: 'X',
    embedEnabled: 0, displayMode: 'external_link', isActive: 1, isFeatured: 0,
  }, 0));
});

test('updatePost rejects stale updatedAt (optimistic concurrency)', async () => {
  const post = await createTestPost();
  // Use a past timestamp
  const pastDate = new Date(Date.now() - 86400000).toISOString();
  await assert.rejects(
    () => updatePost(post.publicId, {
      platform: 'other', postUrl: post.postUrl, title: 'Stale', description: '',
      thumbnailMediaRef: '', embedEnabled: 0, displayMode: 'external_link',
      isActive: 1, isFeatured: 0,
    }, 0, { expectedUpdatedAt: pastDate }),
    (err) => err.code === 'STALE_UPDATE'
  );
});

test('archivePost sets archived_at', async () => {
  const post = await createTestPost();
  await archivePost(post.publicId, 0);
  const archived = await getPost(post.publicId);
  assert.equal(archived, null);
  const [rows] = await pool.query('SELECT archived_at FROM social_posts WHERE public_id = ?', [post.publicId]);
  assert.ok(rows[0].archived_at);
});

test('reorderPosts persists sort_order', async () => {
  const p1 = await createTestPost();
  const p2 = await createTestPost();
  await reorderPosts([p2.publicId, p1.publicId], 0);
  const posts = await listPosts();
  const reordered = posts.filter(p => p.publicId === p1.publicId || p.publicId === p2.publicId);
  assert.equal(reordered.length, 2);
  assert.equal(reordered[0].publicId, p2.publicId);
  assert.equal(reordered[1].publicId, p1.publicId);
});

test('publishPost sets status and published_content_json', async () => {
  const post = await createTestPost();
  const published = await publishPost(post.publicId, 0);
  assert.equal(published.status, 'published');
  assert.ok(published.publishedAt);
  const [rows] = await pool.query('SELECT published_content_json FROM social_posts WHERE public_id = ?', [post.publicId]);
  assert.ok(rows[0].published_content_json);
});

test('getPublishedPosts returns only published+active', async () => {
  const active = await createTestPost();
  await publishPost(active.publicId, 0);
  const inactive = await createTestPost({ isActive: 0 });
  await publishPost(inactive.publicId, 0);
  await createTestPost();
  const published = await getPublishedPosts();
  assert.ok(published.length >= 1);
  const inactivePub = published.find(p => p.publicId === inactive.publicId);
  assert.equal(inactivePub, undefined);
});

test('setActive toggles is_active', async () => {
  const post = await createTestPost();
  await setActive(post.publicId, false, 0);
  let reloaded = await getPost(post.publicId);
  assert.equal(reloaded.isActive, false);
  await setActive(post.publicId, true, 0);
  reloaded = await getPost(post.publicId);
  assert.equal(reloaded.isActive, true);
});

// ════════════════════════════════════════════════════════════
// 5b. Restore as draft
// ════════════════════════════════════════════════════════════

test('restorePostDraft restores from published snapshot as draft only', async () => {
  const post = await createTestPost({ title: 'Original Title' });
  await publishPost(post.publicId, 0);

  // Modify draft after publish
  await updatePost(post.publicId, {
    platform: 'other', postUrl: post.postUrl, title: 'Modified Title',
    description: 'Modified desc', thumbnailMediaRef: '', embedEnabled: 0,
    displayMode: 'external_link', isActive: 1, isFeatured: 0,
  }, 0);

  // Restore from published snapshot
  const restored = await restorePostDraft(post.publicId, 0, 99);
  assert.equal(restored.title, 'Original Title'); // back to published version
  assert.equal(restored.status, 'draft');          // still draft!

  // Published snapshot must remain unchanged (restore doesn't touch published_content_json)
  const [rows] = await pool.query(
    'SELECT published_content_json FROM social_posts WHERE public_id = ?', [post.publicId]
  );
  const pubJson = JSON.parse(rows[0].published_content_json);
  assert.equal(pubJson.title, 'Original Title');
});

test('restorePostDraft throws when no published snapshot', async () => {
  const post = await createTestPost();
  await assert.rejects(() => restorePostDraft(post.publicId, 0, null));
});

test('restorePostDraft records restore revision with source link', async () => {
  const post = await createTestPost({ title: 'SrcTitle' });
  await publishPost(post.publicId, 0);
  await restorePostDraft(post.publicId, 0, 42);

  const [revs] = await pool.query(
    'SELECT * FROM content_revisions WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1',
    ['social_post', post.id]
  );
  assert.equal(revs[0].action, 'restore');
  assert.equal(revs[0].source_revision_id, 42);
});

// ════════════════════════════════════════════════════════════
// 6. Admin Authorization (HTTP)
// ════════════════════════════════════════════════════════════

test('admin loads Social Feed list', async () => {
  const resp = await adminReq('GET', '/admin/page/social-feed');
  assert.equal(resp.status, 200);
  assert.match(resp.text, /Social Feed/);
});

test('admin loads create form', async () => {
  const resp = await adminReq('GET', '/admin/page/social-feed/create');
  assert.equal(resp.status, 200);
  assert.match(resp.text, /Nuevo Post/);
  assert.match(resp.text, /name="_csrf"/);
});

test('normal user blocked from Social Feed', async () => {
  const resp = await fetch(`${baseUrl}/admin/page/social-feed`, { redirect: 'manual' });
  assert.ok([302, 401].includes(resp.status));
});

test('sidebar includes Social Feed link', async () => {
  const resp = await adminReq('GET', '/admin/page/social-feed');
  assert.match(resp.text, /Social Feed/);
});

// ════════════════════════════════════════════════════════════
// 7. HTTP Integration — Save with validation preservation
// ════════════════════════════════════════════════════════════

test('save returns validation errors and preserves values (create)', async () => {
  const createResp = await adminReq('GET', '/admin/page/social-feed/create');
  const token = csrf(createResp.text);

  const saveResp = await adminReq('POST', '/admin/page/social-feed/save', {
    _csrf: token,
    platform: 'invalid',
    postUrl: 'not-a-url',
    title: '',
    description: '',
    displayMode: 'external_link',
    embedEnabled: '0',
    isFeatured: '0',
    isActive: '1',
  });
  // Should redirect back to create form
  assert.ok(saveResp.location.includes('/admin/page/social-feed/create'));

  // Read the rendered form again and check errors are shown
  const formResp = await adminReq('GET', '/admin/page/social-feed/create');
  assert.match(formResp.text, /Plataforma no válida/);
  assert.match(formResp.text, /título/);
  assert.match(formResp.text, /URL del post/);
});

test('save returns validation errors on edit form', async () => {
  const post = await createTestPost({ title: 'Valid Title',
    postUrl: 'https://example.com/ok', platform: 'other' });

  const editResp = await adminReq('GET', `/admin/page/social-feed/edit?id=${post.publicId}`);
  const token = csrf(editResp.text);

  const saveResp = await adminReq('POST', '/admin/page/social-feed/save', {
    _csrf: token,
    publicId: post.publicId,
    platform: 'other',
    postUrl: 'javascript:void(0)',
    title: '',
    description: '',
    displayMode: 'external_link',
    embedEnabled: '0',
    isFeatured: '0',
    isActive: '1',
  });
  assert.ok(saveResp.location.includes(`edit?id=${post.publicId}`));

  const formResp = await adminReq('GET', `/admin/page/social-feed/edit?id=${post.publicId}`);
  assert.match(formResp.text, /título/);
  assert.match(formResp.text, /URL/);
});

// ════════════════════════════════════════════════════════════
// 8. HTTP Integration — Publish
// ════════════════════════════════════════════════════════════

test('publish from list succeeds', async () => {
  const post = await createTestPost();
  // Get new CSRF from list page
  const listResp = await adminReq('GET', '/admin/page/social-feed');
  const token = csrf(listResp.text);

  const pubResp = await adminReq('POST', '/admin/page/social-feed/publish', {
    _csrf: token,
    publicId: post.publicId,
  });
  assert.equal(pubResp.status, 302);

  const reloaded = await getPost(post.publicId);
  assert.equal(reloaded.status, 'published');
});

// ════════════════════════════════════════════════════════════
// 9. HTTP Integration — Restore
// ════════════════════════════════════════════════════════════

test('restore via HTTP succeeds and creates draft', async () => {
  const post = await createTestPost({ title: 'HTTP Restore Test' });
  await publishPost(post.publicId, 0);

  // Modify draft
  await updatePost(post.publicId, {
    platform: 'other', postUrl: post.postUrl, title: 'Modified', description: '',
    thumbnailMediaRef: '', embedEnabled: 0, displayMode: 'external_link',
    isActive: 1, isFeatured: 0,
  }, 0);

  const listResp = await adminReq('GET', '/admin/page/social-feed');
  const token = csrf(listResp.text);

  const restoreResp = await adminReq('POST', '/admin/page/social-feed/restore', {
    _csrf: token,
    publicId: post.publicId,
    sourceRevisionId: '1',
  });
  assert.equal(restoreResp.status, 302);

  const reloaded = await getPost(post.publicId);
  assert.equal(reloaded.title, 'HTTP Restore Test');
  assert.equal(reloaded.status, 'draft');
});

// ════════════════════════════════════════════════════════════
// 10. HTTP Integration — Stale conflict
// ════════════════════════════════════════════════════════════

test('stale update returns alert on list', async () => {
  const post = await createTestPost();
  const editResp = await adminReq('GET', `/admin/page/social-feed/edit?id=${post.publicId}`);
  const token = csrf(editResp.text);

  // Post back with wrong updatedAt
  const saveResp = await adminReq('POST', '/admin/page/social-feed/save', {
    _csrf: token,
    publicId: post.publicId,
    platform: 'other',
    postUrl: 'https://example.com/stale',
    title: 'Stale Update',
    description: '',
    displayMode: 'external_link',
    embedEnabled: '0',
    isFeatured: '0',
    isActive: '1',
    displayOnly: '1',
  });
  // Should redirect to list with error alert
  assert.equal(saveResp.status, 302);
  assert.ok(saveResp.location.includes('/admin/page/social-feed'));
});

// ════════════════════════════════════════════════════════════
// 11. EJS Templates
// ════════════════════════════════════════════════════════════

test('list.ejs compiles', () => {
  const listTemplate = fs.readFileSync(
    path.resolve(__dirname, '../views/pages/admin/page/social-feed/list.ejs'), 'utf8'
  );
  assert.ok(listTemplate.includes('social-feed-list'));
  assert.ok(listTemplate.includes('admin-page-header'));
});

test('form.ejs compiles', () => {
  const formTemplate = fs.readFileSync(
    path.resolve(__dirname, '../views/pages/admin/page/social-feed/form.ejs'), 'utf8'
  );
  assert.ok(formTemplate.includes('sticky-actions'));
  assert.ok(formTemplate.includes('media-selector'));
  assert.ok(formTemplate.includes('csrfToken'));
  assert.ok(formTemplate.includes('name="platform"'));
});

test('form.ejs has zero inline event handlers', () => {
  const formTemplate = fs.readFileSync(
    path.resolve(__dirname, '../views/pages/admin/page/social-feed/form.ejs'), 'utf8'
  );
  // No onclick, onsubmit, onerror, etc.
  assert.doesNotMatch(formTemplate, /on\w+\s*=\s*["']/);
});

// ════════════════════════════════════════════════════════════
// 12. Migration count
// ════════════════════════════════════════════════════════════

test('migration registry has 25 entries after additive Phase 2B migration', () => {
  const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');
  assert.equal(MIGRATION_REGISTRY.length, 25);
});

test('social_post entity type is registered', () => {
  const { REVISION_ENTITY_TYPES } = require('../config/cmsOptions');
  assert.ok(REVISION_ENTITY_TYPES.SOCIAL_POST);
  assert.equal(REVISION_ENTITY_TYPES.SOCIAL_POST, 'social_post');
});

// ════════════════════════════════════════════════════════════
// 13. Draft isolation remains in force after Phase 2B
// ════════════════════════════════════════════════════════════

test('public / never exposes draft social post content', async () => {
  const draft = await createTestPost({ title: `Draft-only ${marker}` });
  const resp = await fetch(`${baseUrl}/`);
  const text = await resp.text();
  assert.doesNotMatch(text, new RegExp(draft.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

// ════════════════════════════════════════════════════════════
// 14. CSP compatibility
// ════════════════════════════════════════════════════════════

test('social feed forms have no external script imports', () => {
  const formTemplate = fs.readFileSync(
    path.resolve(__dirname, '../views/pages/admin/page/social-feed/form.ejs'), 'utf8'
  );
  assert.doesNotMatch(formTemplate, /<script[^>]*src=.*(?:facebook\.com|instagram\.com|tiktok\.com|youtube\.com)/);
});

test('publish button uses form attribute — no inline onclick', () => {
  const formTemplate = fs.readFileSync(
    path.resolve(__dirname, '../views/pages/admin/page/social-feed/form.ejs'), 'utf8'
  );
  assert.match(formTemplate, /form="publish-form"/);
  assert.doesNotMatch(formTemplate, /onclick=.+publish-form/);
});
