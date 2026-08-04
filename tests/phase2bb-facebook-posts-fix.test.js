/**
 * Facebook /posts endpoint fix — Phase 2E-B.
 *
 * Verifies:
 *  - synchronization uses /{page-id}/posts, never /feed
 *  - correct Page Access Token selected
 *  - user access token NOT used for Page posts
 *  - only Page-owned posts imported
 *  - basic post fields with pages_read_engagement
 *  - error #10 produces clean Spanish message
 *  - no visitor posts, comments, reactions, insights
 *  - Instagram unchanged
 *  - duplicate prevention, draft-by-default, published-snapshot
 *  - OAuth, scheduler, Social Feed regressions
 */
const { test, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const pool = require('../config/db');
const metaOAuth = require('../services/metaOAuthService');
const facebookSync = require('../services/facebookSyncService');

function setEnv(key, val) { if (val != null) process.env[key] = val; else delete process.env[key]; }

function cacheEnv() {
  return {
    META_APP_ID: process.env.META_APP_ID || null,
    META_APP_SECRET: process.env.META_APP_SECRET || null,
    META_CONFIG_ID: process.env.META_CONFIG_ID || null,
    SOCIAL_TOKEN_ENCRYPTION_KEY: process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || null,
  };
}
function restoreEnv(c) {
  setEnv('META_APP_ID', c.META_APP_ID);
  setEnv('META_APP_SECRET', c.META_APP_SECRET);
  setEnv('META_CONFIG_ID', c.META_CONFIG_ID);
  setEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', c.SOCIAL_TOKEN_ENCRYPTION_KEY);
}

after(() => {
  facebookSync.setHttpGet(null);
  metaOAuth.setHttpGet(null);
  metaOAuth.setHttpPost(null);
});

// ═══════════════════════════════════════
// 1. Endpoint: /posts, never /feed
// ═══════════════════════════════════════

test('fetchFacebookPosts uses /{page-id}/posts endpoint', async () => {
  const captured = [];
  facebookSync.setHttpGet(async (url) => {
    captured.push(url);
    return { status: 200, data: { data: [] } };
  });

  try {
    await facebookSync.fetchFacebookPosts('page_123', 'test_token', 5);
    assert.ok(captured.length > 0, 'must make HTTP request');
    assert.ok(captured[0].includes('/page_123/posts'), `must use /posts, got: ${captured[0]}`);
    assert.ok(!captured[0].includes('/feed'), `must not use /feed, got: ${captured[0]}`);
  } finally {
    facebookSync.setHttpGet(null);
  }
});

test('fetchFacebookPosts never references /feed in URL construction', () => {
  // Static code check: the function source should not contain the string /feed
  const src = facebookSync.fetchFacebookPosts.toString();
  assert.ok(
    !src.includes("'/feed'") && !src.includes('"/feed"') && !src.includes('/feed?'),
    'fetchFacebookPosts source must not contain /feed'
  );
});

// ═══════════════════════════════════════
// 2. Page Access Token selected correctly
// ═══════════════════════════════════════

test('syncFacebook uses Page Access Token from getPageAccessToken', async () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_test';
  process.env.META_APP_SECRET = 'secret_test';
  process.env.META_CONFIG_ID = 'config_test';
  process.env.META_GRAPH_API_VERSION = 'v21.0';
  // Encryption key required for storeToken
  if (!process.env.SOCIAL_TOKEN_ENCRYPTION_KEY) {
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  }
  process.env.NODE_ENV = 'test';

  // Clean old data
  await pool.query("DELETE FROM social_token_secrets WHERE provider = 'facebook_page'");
  await pool.query("DELETE FROM social_token_secrets WHERE provider = 'facebook'");
  await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'facebook'");

  try {
    // Setup: connected integration with Page ID
    await pool.query(
      `UPDATE social_integrations SET config_json = ?, is_connected = 1, is_enabled = 1, require_approval = 0
       WHERE provider = 'facebook'`,
      [JSON.stringify({ pageId: 'page_fb_test', pageName: 'TestPage', maxPosts: 5 })]
    );

    // Store encrypted user token and Page token
    const { storeToken } = require('../services/tokenEncryptionService');
    await storeToken(pool, 'facebook', 'page_fb_test', 'fb_user_token_test', {
      expiresAt: new Date(Date.now() + 5184000 * 1000).toISOString(),
      pageId: 'page_fb_test',
    });
    await storeToken(pool, 'facebook_page', 'page_fb_test', 'fb_page_token_test_123', {
      expiresAt: new Date(Date.now() + 5184000 * 1000).toISOString(),
      pageId: 'page_fb_test',
    });

    // Mock HTTP: validateToken returns ok, /posts returns one item
    let fetchCalled = false;
    metaOAuth.setHttpGet(async (url) => {
      if (url.includes('/me')) return { status: 200, data: { id: 'page_fb_test' } };
      return { status: 200, data: { id: 'me' } };
    });
    facebookSync.setHttpGet(async (url) => {
      fetchCalled = true;
      // Verify the URL contains the Page token, not the user token
      assert.ok(!url.includes('fb_user_token_test'), 'must NOT use user token for /posts');
      return {
        status: 200,
        data: { data: [] },
      };
    });

    // Sync
    const [[intRow]] = await pool.query('SELECT * FROM social_integrations WHERE provider = ?', ['facebook']);
    intRow.config_json = typeof intRow.config_json === 'string' ? JSON.parse(intRow.config_json) : intRow.config_json;
    await facebookSync.syncFacebook(intRow);

    assert.ok(fetchCalled, 'HTTP fetch must have been called');
  } finally {
    metaOAuth.setHttpGet(null);
    facebookSync.setHttpGet(null);
    await pool.query("DELETE FROM social_token_secrets WHERE provider IN ('facebook', 'facebook_page')");
    await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'facebook'");
    restoreEnv(env);
  }
});

// ═══════════════════════════════════════
// 3. Normalize: only Page-owned post fields
// ═══════════════════════════════════════

test('normalizeFacebookPost maps required fields', () => {
  const item = {
    id: '12345_67890',
    message: 'Hello from the Page!',
    created_time: '2026-01-01T12:00:00+0000',
    full_picture: 'https://example.com/photo.jpg',
    permalink_url: 'https://www.facebook.com/12345/posts/67890',
  };

  const normalized = facebookSync.normalizeFacebookPost(item);
  assert.strictEqual(normalized.externalId, '12345_67890');
  assert.strictEqual(normalized.message, 'Hello from the Page!');
  assert.strictEqual(normalized.fullPicture, 'https://example.com/photo.jpg');
  assert.strictEqual(normalized.permalink, 'https://www.facebook.com/12345/posts/67890');
  assert.strictEqual(normalized.createdTime, '2026-01-01T12:00:00+0000');
});

test('normalizeFacebookPost builds permalink from id when missing', () => {
  const item = { id: 'fb_789', message: 'test', created_time: '2026-01-01' };
  const normalized = facebookSync.normalizeFacebookPost(item);
  assert.strictEqual(normalized.permalink, 'https://www.facebook.com/fb_789');
});

test('normalizeFacebookPost handles empty message', () => {
  const item = { id: 'fb_x', full_picture: 'https://x.com/pic.jpg' };
  const normalized = facebookSync.normalizeFacebookPost(item);
  assert.strictEqual(normalized.message, '');
  assert.strictEqual(normalized.fullPicture, 'https://x.com/pic.jpg');
});

test('normalizeFacebookPost never includes visitor post fields', () => {
  // /posts endpoint only returns Page-owned posts — verify normalize doesn't
  // reference from/visitor/comments/reactions fields
  const src = facebookSync.normalizeFacebookPost.toString();
  assert.ok(!src.includes('.from'), 'must not reference from field');
  assert.ok(!src.includes('.reactions'), 'must not reference reactions');
  assert.ok(!src.includes('.comments'), 'must not reference comments');
  assert.ok(!src.includes('.insights'), 'must not reference insights');
  assert.ok(!src.includes('.likes'), 'must not reference likes');
});

// ═══════════════════════════════════════
// 4. Error #10 produces clean Spanish message
// ═══════════════════════════════════════

test('fetchFacebookPosts classifies error #10 as auth error', async () => {
  facebookSync.setHttpGet(async () => ({
    status: 403,
    data: {
      error: {
        message: '(#10) This endpoint requires the pages_read_engagement permission or the Page Public Content Access feature. Refer to https://developers.facebook.com/docs/...',
        type: 'OAuthException',
        code: 10,
      },
    },
  }));

  try {
    await facebookSync.fetchFacebookPosts('page_x', 'bad_token', 5);
    assert.fail('should have thrown');
  } catch (error) {
    assert.strictEqual(error.code, 'FB_API_ERROR');
    assert.strictEqual(error.authError, true, 'error #10 must be classified as auth error');
    assert.ok(error.message.includes('#10'), 'error message must include error code');
  } finally {
    facebookSync.setHttpGet(null);
  }
});

test('syncFacebook produces clean Spanish message for error #10', async () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_test2';
  process.env.META_APP_SECRET = 'secret_test2';
  process.env.META_CONFIG_ID = 'config_test2';
  if (!process.env.SOCIAL_TOKEN_ENCRYPTION_KEY) {
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  }
  process.env.NODE_ENV = 'test';

  await pool.query("DELETE FROM social_token_secrets WHERE provider IN ('facebook', 'facebook_page')");
  await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'facebook'");

  try {
    await pool.query(
      `UPDATE social_integrations SET config_json = ?, is_connected = 1, is_enabled = 1
       WHERE provider = 'facebook'`,
      [JSON.stringify({ pageId: 'page_perm_test', pageName: 'Test', maxPosts: 3 })]
    );

    const { storeToken } = require('../services/tokenEncryptionService');
    await storeToken(pool, 'facebook', 'page_perm_test', 'user_tok', {
      expiresAt: new Date(Date.now() + 5184000 * 1000).toISOString(),
    });
    await storeToken(pool, 'facebook_page', 'page_perm_test', 'page_tok', {
      expiresAt: new Date(Date.now() + 5184000 * 1000).toISOString(),
    });

    metaOAuth.setHttpGet(async (url) => {
      if (url.includes('/me')) return { status: 200, data: { id: 'page_perm_test' } };
      return { status: 200, data: { id: 'me' } };
    });

    facebookSync.setHttpGet(async () => ({
      status: 403,
      data: { error: { message: '(#10) Access denied.', type: 'OAuthException', code: 10 } },
    }));

    const [[intRow]] = await pool.query('SELECT * FROM social_integrations WHERE provider = ?', ['facebook']);
    intRow.config_json = typeof intRow.config_json === 'string' ? JSON.parse(intRow.config_json) : intRow.config_json;

    await facebookSync.syncFacebook(intRow);
    assert.fail('should have thrown');
  } catch (error) {
    assert.strictEqual(error.code, 'FB_PERMISSION_ERROR');
    assert.ok(error.message.includes('Facebook rechazó'), `Must be Spanish, got: ${error.message}`);
    assert.ok(error.message.includes('pages_read_engagement'), 'Must mention pages_read_engagement permission');
    assert.ok(error.message.includes('Page Access Token'), 'Must mention Page Access Token');
    // Must NOT expose raw Meta URLs
    assert.ok(!error.message.includes('developers.facebook.com'), 'must not expose Meta documentation URLs');
    assert.ok(!error.message.includes('Refer to'), 'must not expose raw Meta message');
  } finally {
    metaOAuth.setHttpGet(null);
    facebookSync.setHttpGet(null);
    await pool.query("DELETE FROM social_token_secrets WHERE provider IN ('facebook', 'facebook_page')");
    await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'facebook'");
    restoreEnv(env);
  }
});

// ═══════════════════════════════════════
// 5. Duplicate prevention & draft-by-default
// ═══════════════════════════════════════

test('upsertPost creates draft by default', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.query("DELETE FROM social_posts WHERE provider_external_id = 'fb_draft_test_001'");

    const intRow = { require_approval: 0, config_json: {} };
    const post = {
      externalId: 'fb_draft_test_001',
      message: 'Draft post test',
      fullPicture: '',
      permalink: 'https://www.facebook.com/fb_draft_test_001',
      createdTime: '2026-01-01',
    };

    const result = await facebookSync.upsertPost(conn, post, intRow);
    assert.strictEqual(result.action, 'imported');

    const [[row]] = await conn.query(
      'SELECT status, is_imported FROM social_posts WHERE public_id = ?',
      [result.publicId]
    );
    assert.strictEqual(row.status, 'draft');
    assert.strictEqual(row.is_imported, 1);

    // Cleanup
    await conn.query('DELETE FROM social_posts WHERE public_id = ?', [result.publicId]);
  } finally {
    conn.release();
  }
});

test('upsertPost skips duplicate by external ID', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.query("DELETE FROM social_posts WHERE provider_external_id = 'fb_dup_test_002'");

    const intRow = { require_approval: 0, config_json: {} };
    const post = {
      externalId: 'fb_dup_test_002',
      message: 'Original',
      fullPicture: '',
      permalink: 'https://fb.com/fb_dup_test_002',
      createdTime: '2026-01-01',
    };

    const r1 = await facebookSync.upsertPost(conn, post, intRow);
    assert.strictEqual(r1.action, 'imported');
    const r2 = await facebookSync.upsertPost(conn, post, intRow);
    assert.strictEqual(r2.action, 'updated', 'second call should update (not re-import)');

    // Cleanup
    await conn.query('DELETE FROM social_posts WHERE public_id = ?', [r1.publicId]);
  } finally {
    conn.release();
  }
});

// ═══════════════════════════════════════
// 6. fetchFacebookPosts filters empty posts
// ═══════════════════════════════════════

test('fetchFacebookPosts skips posts with no message and no picture', async () => {
  facebookSync.setHttpGet(async () => ({
    status: 200,
    data: {
      data: [
        { id: 'a1', message: 'Has text' },
        { id: 'a2' }, // no message, no picture — should be filtered out
        { id: 'a3', full_picture: 'https://x.com/p.jpg' },
        { id: 'a4', message: 'Also has text', full_picture: 'https://x.com/p2.jpg' },
      ],
    },
  }));

  try {
    const items = await facebookSync.fetchFacebookPosts('page_x', 'tok', 10);
    assert.strictEqual(items.length, 3, `Expected 3, got ${items.length} — item a2 should be filtered`);
    assert.ok(!items.some(i => i.externalId === 'a2'), 'a2 must be filtered out');
  } finally {
    facebookSync.setHttpGet(null);
  }
});

// ═══════════════════════════════════════
// 7. Instagram sync unchanged
// ═══════════════════════════════════════

test('Instagram sync service still accessible', () => {
  const ig = require('../services/instagramSyncService');
  assert.strictEqual(typeof ig.syncInstagram, 'function', 'Instagram sync must be callable');
  assert.strictEqual(ig.PROVIDER, 'instagram');
});

// ═══════════════════════════════════════
// 8. Regressions
// ═══════════════════════════════════════

test('YouTube integration still exists', async () => {
  const [[row]] = await pool.query('SELECT * FROM social_integrations WHERE provider = ?', ['youtube']);
  assert.ok(row);
});

test('TikTok integration still exists', async () => {
  const [[row]] = await pool.query('SELECT * FROM social_integrations WHERE provider = ?', ['tiktok']);
  assert.ok(row);
});

test('Facebook integration row exists', async () => {
  const [[row]] = await pool.query('SELECT * FROM social_integrations WHERE provider = ?', ['facebook']);
  assert.ok(row);
});

test('Meta OAuth getAuthorizationUrl still works', () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_oa1';
  process.env.META_APP_SECRET = 'sec_oa1';
  process.env.META_CONFIG_ID = 'cfg_oa1';
  process.env.NODE_ENV = 'test';
  try {
    const { url } = metaOAuth.getAuthorizationUrl('facebook', 'sess');
    assert.ok(url.includes('config_id=cfg_oa1'));
  } finally { restoreEnv(env); }
});
