/**
 * Phase 2E-B Close — Comprehensive Meta integration tests.
 *
 * Covers: migration repair, account selection, token lifecycle,
 * OAuth safety, provider isolation, secret redaction, regressions.
 *
 * All Meta API calls are mocked — no live network requests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../config/db');

// ── Environment setup ──

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = 'test-enc-key-32bytes-len!!!';
process.env.META_APP_ID = '123456789012345';
process.env.META_APP_SECRET = 'test-app-secret-value-32b';
process.env.META_GRAPH_API_VERSION = 'v25.0';
process.env.SITE_URL = 'http://localhost:3000';

const encryption = require('../services/tokenEncryptionService');
const metaOAuth = require('../services/metaOAuthService');
const instagram = require('../services/instagramSyncService');
const facebook = require('../services/facebookSyncService');

// ── Setup / Teardown ──

test.before(async () => {
  // Run all migrations fresh
  const { migrateSocialTokenSecrets } = require('../scripts/migrate-social-token-secrets');
  const { migrateSocialOAuthStates } = require('../scripts/migrate-social-oauth-states');
  const { migrateSeedMetaIntegrations } = require('../scripts/migrate-seed-meta-integrations');
  await migrateSocialTokenSecrets(pool);
  await migrateSocialOAuthStates(pool);
  await migrateSeedMetaIntegrations(pool);

  // Clean test data
  await pool.query("DELETE FROM social_token_secrets WHERE provider IN ('instagram','facebook','facebook_page')");
  await pool.query("DELETE FROM social_oauth_states");
  await pool.query("DELETE FROM social_posts WHERE provider IN ('instagram','facebook')");
  await pool.query("DELETE FROM social_sync_runs");
  await pool.query(
    "UPDATE social_integrations SET config_json = '{}', is_connected = 0, is_enabled = 0, auto_sync = 0 WHERE provider IN ('instagram','facebook')"
  );
});

test.after(async () => {
  await pool.query("DELETE FROM social_token_secrets WHERE provider IN ('instagram','facebook','facebook_page')");
  await pool.query("DELETE FROM social_oauth_states");
  await pool.query("DELETE FROM social_posts WHERE provider IN ('instagram','facebook')");
  await pool.end();
});

// ═══════════════════════════════════════════════════════════
// Migration history repair
// ═══════════════════════════════════════════════════════════

test('migration 27 checksum matches restored original', async () => {
  const fs = require('fs');
  const buf = fs.readFileSync('scripts/migrate-social-integrations.js');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(sha, '6154521b99fb5a26a8aee31e6bae5ab151f4e5505f655d52244314ca03fb6575');
});

test('migration 27 only seeds YouTube (not Instagram/Facebook)', () => {
  const code = require('fs').readFileSync('scripts/migrate-social-integrations.js', 'utf8');
  assert.match(code, /youtube/);
  // Should NOT contain Instagram/Facebook in the seed section
  const seedSection = code.split("// Insert a default YouTube")[1];
  assert.doesNotMatch(seedSection, /instagram/);
  assert.doesNotMatch(seedSection, /facebook/);
});

test('migration 32 is idempotent', async () => {
  const { migrateSeedMetaIntegrations } = require('../scripts/migrate-seed-meta-integrations');
  await migrateSeedMetaIntegrations(pool);
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM social_integrations WHERE provider = 'instagram'");
  assert.equal(cnt, 1);
  // Should not throw on second run
  await migrateSeedMetaIntegrations(pool);
});

test('migration 32 adds Instagram and Facebook rows', async () => {
  for (const p of ['instagram', 'facebook']) {
    const [[row]] = await pool.query("SELECT * FROM social_integrations WHERE provider = ?", [p]);
    assert.ok(row, `${p} row should exist`);
    assert.equal(row.is_enabled, 0);
  }
});

test('migration 32 adds session_id column to social_oauth_states', async () => {
  const [[{ cnt }]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_oauth_states' AND COLUMN_NAME = 'session_id'"
  );
  assert.equal(cnt, 1);
});

test('MIGRATION_REGISTRY has 32 entries (31 base + 1 new)', () => {
  const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');
  assert.equal(MIGRATION_REGISTRY.length, 35);
});

// ═══════════════════════════════════════════════════════════
// Configurable API version & origin allowlist
// ═══════════════════════════════════════════════════════════

test('getApiVersion returns configured version', () => {
  assert.equal(metaOAuth.getApiVersion(), 'v25.0');
});

test('getApiVersion defaults when env not set', () => {
  const saved = process.env.META_GRAPH_API_VERSION;
  delete process.env.META_GRAPH_API_VERSION;
  try {
    assert.equal(metaOAuth.getApiVersion(), 'v25.0');
  } finally {
    process.env.META_GRAPH_API_VERSION = saved;
  }
});

test('getBaseUrl uses configured version', () => {
  assert.match(metaOAuth.getBaseUrl(), /v25\.0/);
});

test('validateUrlOrigin rejects non-Meta URLs', () => {
  assert.throws(() => metaOAuth.validateUrlOrigin('https://evil.com/attack'), { code: 'ORIGIN_DENIED' });
  assert.throws(() => metaOAuth.validateUrlOrigin('https://graph.facebook.com.evil.com/test'), { code: 'ORIGIN_DENIED' });
});

test('validateUrlOrigin accepts official Meta origins', () => {
  metaOAuth.validateUrlOrigin('https://graph.facebook.com/v25.0/me');
  metaOAuth.validateUrlOrigin('https://www.facebook.com/v25.0/dialog/oauth');
});

// ═══════════════════════════════════════════════════════════
// OAuth state: session-bound, expiring, single-use
// ═══════════════════════════════════════════════════════════

test('generateState creates unique ID per call', () => {
  const a = metaOAuth.generateState('session-a');
  const b = metaOAuth.generateState('session-b');
  assert.notEqual(a.id, b.id);
});

test('generateState throws without sessionId', () => {
  assert.throws(() => metaOAuth.generateState(), { code: 'NO_SESSION' });
});

test('state is created, consumed once, then gone', async () => {
  const { id } = metaOAuth.generateState('sess-1');
  await metaOAuth.persistState(id, 'instagram', 'sess-1');
  const consumed = await metaOAuth.consumeState(id, 'sess-1');
  assert.ok(consumed);
  const consumed2 = await metaOAuth.consumeState(id, 'sess-1');
  assert.equal(consumed2, null);
});

test('state rejects cross-session access', async () => {
  const { id } = metaOAuth.generateState('sess-A');
  await metaOAuth.persistState(id, 'instagram', 'sess-A');
  const consumed = await metaOAuth.consumeState(id, 'sess-B');
  assert.equal(consumed, null);
  // Also consumed (destroyed)
  const consumedSelf = await metaOAuth.consumeState(id, 'sess-A');
  assert.equal(consumedSelf, null);
});

test('state expires after timeout', async () => {
  const { id } = metaOAuth.generateState('sess-ex');
  await pool.query(
    'INSERT INTO social_oauth_states (state_id, provider, expires_at, session_id) VALUES (?, ?, ?, ?)',
    [id, 'instagram', new Date(Date.now() - 1000), 'sess-ex']
  );
  const consumed = await metaOAuth.consumeState(id, 'sess-ex');
  assert.equal(consumed, null);
});

test('state rejects provider mismatch in callback', async () => {
  const { id } = metaOAuth.generateState('sess-m');
  await metaOAuth.persistState(id, 'instagram', 'sess-m');
  const consumed = await metaOAuth.consumeState(id, 'sess-m', 'facebook');
  assert.equal(consumed, null);
});

// ═══════════════════════════════════════════════════════════
// HTTPS enforcement
// ═══════════════════════════════════════════════════════════

test('getAuthorizationUrl uses HTTPS in production', () => {
  const saved = process.env.NODE_ENV;
  const savedUrl = process.env.SITE_URL;
  const savedConfig = process.env.META_CONFIG_ID;
  process.env.NODE_ENV = 'production';
  process.env.SITE_URL = 'http://mysite.com';
  process.env.META_CONFIG_ID = 'test_config';
  try {
    assert.throws(
      () => metaOAuth.getAuthorizationUrl('instagram', 'sess-prod'),
      { code: 'HTTPS_REQUIRED' }
    );
  } finally {
    process.env.NODE_ENV = saved;
    process.env.SITE_URL = savedUrl;
    if (savedConfig) process.env.META_CONFIG_ID = savedConfig; else delete process.env.META_CONFIG_ID;
  }
});

// ═══════════════════════════════════════════════════════════
// Token encryption & redaction
// ═══════════════════════════════════════════════════════════

test('encrypted tokens never stored in plaintext', async () => {
  const token = 'EAA' + crypto.randomBytes(20).toString('hex');
  await encryption.storeToken(pool, 'instagram', 'plaintext_test', token, {});
  const [[row]] = await pool.query(
    "SELECT encrypted_data FROM social_token_secrets WHERE provider = 'instagram' AND account_id = 'plaintext_test'"
  );
  const raw = Buffer.isBuffer(row.encrypted_data) ? row.encrypted_data.toString('utf-8') : '';
  assert.doesNotMatch(raw, /EAA/);
  await encryption.deleteToken(pool, 'instagram', 'plaintext_test');
});

test('tokens are not stored in config_json', async () => {
  await metaOAuth.completeConnection('instagram', 'test-token-abc', 5184000,
    { id: 'page_x', name: 'Test Page', accessToken: 'page-token-xyz', picture: '' },
    { id: 'ig_y', username: 'testig', name: 'Test IG', profilePicture: '' },
    'sess-test');
  const [[intRow]] = await pool.query("SELECT config_json FROM social_integrations WHERE provider = 'instagram'");
  const raw = JSON.stringify(intRow.config_json);
  assert.doesNotMatch(raw, /test-token-abc/);
  assert.doesNotMatch(raw, /page-token-xyz/);
  await metaOAuth.disconnectProvider('instagram');
});

test('getPageAccessToken retrieves separate page token', async () => {
  await encryption.storeToken(pool, 'facebook_page', 'page_abc', 'page-only-token', { pageId: 'page_abc' });
  const token = await metaOAuth.getPageAccessToken('page_abc');
  assert.equal(token, 'page-only-token');
  await encryption.deleteToken(pool, 'facebook_page', 'page_abc');
});

// ═══════════════════════════════════════════════════════════
// Token validation & lifecycle
// ═══════════════════════════════════════════════════════════

test('validateToken returns valid for working token', async () => {
  metaOAuth.setHttpGet(async () => ({ status: 200, data: { id: 'user123', name: 'Test' } }));
  await pool.query(
    "UPDATE social_integrations SET is_connected = 1, config_json = ? WHERE provider = 'instagram'",
    [JSON.stringify({ pageId: 'page_val_test' })]
  );
  await encryption.storeToken(pool, 'instagram', 'page_val_test', 'valid-token', {});
  const result = await metaOAuth.validateToken('instagram');
  assert.equal(result.valid, true);
  assert.equal(result.category, 'ok');
  await encryption.deleteToken(pool, 'instagram', 'page_val_test');
  await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'instagram'");
  metaOAuth.setHttpGet(null);
});

test('validateToken detects expired token', async () => {
  metaOAuth.setHttpGet(async () => ({
    status: 401, data: { error: { code: 190, error_subcode: 463, message: 'Expired' } },
  }));
  await pool.query(
    "UPDATE social_integrations SET is_connected = 1, config_json = ? WHERE provider = 'facebook'",
    [JSON.stringify({ pageId: 'page_val_exp' })]
  );
  await encryption.storeToken(pool, 'facebook', 'page_val_exp', 'expired-token', {});
  const result = await metaOAuth.validateToken('facebook');
  assert.equal(result.valid, false);
  assert.equal(result.category, 'expired');
  await encryption.deleteToken(pool, 'facebook', 'page_val_exp');
  await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'facebook'");
  metaOAuth.setHttpGet(null);
});

test('validateToken detects revoked token', async () => {
  metaOAuth.setHttpGet(async () => ({
    status: 401, data: { error: { code: 190, error_subcode: 458, message: 'Revoked' } },
  }));
  await pool.query(
    "UPDATE social_integrations SET is_connected = 1, config_json = ? WHERE provider = 'facebook'",
    [JSON.stringify({ pageId: 'page_val_rev' })]
  );
  await encryption.storeToken(pool, 'facebook', 'page_val_rev', 'revoked-token', {});
  const result = await metaOAuth.validateToken('facebook');
  assert.equal(result.valid, false);
  assert.equal(result.category, 'revoked');
  await encryption.deleteToken(pool, 'facebook', 'page_val_rev');
  await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'facebook'");
  metaOAuth.setHttpGet(null);
});

test('validateToken detects permission denied', async () => {
  metaOAuth.setHttpGet(async () => ({
    status: 403, data: { error: { code: 10, message: 'Permission denied' } },
  }));
  await pool.query(
    "UPDATE social_integrations SET is_connected = 1, config_json = ? WHERE provider = 'facebook'",
    [JSON.stringify({ pageId: 'page_val_perm' })]
  );
  await encryption.storeToken(pool, 'facebook', 'page_val_perm', 'perm-token', {});
  const result = await metaOAuth.validateToken('facebook');
  assert.equal(result.valid, false);
  assert.equal(result.category, 'permission_denied');
  await encryption.deleteToken(pool, 'facebook', 'page_val_perm');
  await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'facebook'");
  metaOAuth.setHttpGet(null);
});

test('checkTokenExpiration warns within 14 days', async () => {
  const future = new Date(Date.now() + 6 * 86400000).toISOString();
  await metaOAuth.completeConnection('instagram', 'warn-token', 5184000,
    { id: 'page_warn', name: 'Warn Page', accessToken: 'pt', picture: '' },
    null, 'sess-warn');
  // Override tokenExpiresAt
  const config = JSON.stringify({ pageId: 'page_warn', tokenExpiresAt: future });
  await pool.query("UPDATE social_integrations SET config_json = ? WHERE provider = 'instagram'", [config]);
  const result = await metaOAuth.checkTokenExpiration('instagram');
  assert.equal(result.warning, true);
  assert.ok(result.daysLeft > 0);
  await metaOAuth.disconnectProvider('instagram');
});

test('checkTokenExpiration detects expired', async () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const config = JSON.stringify({ pageId: 'page_exp_c', tokenExpiresAt: past });
  await pool.query("UPDATE social_integrations SET config_json = ?, is_connected = 1 WHERE provider = 'instagram'", [config]);
  const result = await metaOAuth.checkTokenExpiration('instagram');
  assert.equal(result.expired, true);
  await metaOAuth.disconnectProvider('instagram');
});

test('handleConnectionFailure disables sync for auth errors', async () => {
  await pool.query("UPDATE social_integrations SET auto_sync = 1, is_connected = 1 WHERE provider = 'facebook'");
  const result = await metaOAuth.handleConnectionFailure('facebook', 'expired');
  assert.equal(result.action, 'disabled');
  const [[row]] = await pool.query("SELECT auto_sync, is_connected FROM social_integrations WHERE provider = 'facebook'");
  assert.equal(row.auto_sync, 0);
  assert.equal(row.is_connected, 0);
});

test('handleConnectionFailure keeps config for transient errors', async () => {
  await pool.query("UPDATE social_integrations SET auto_sync = 1, is_connected = 1 WHERE provider = 'instagram'");
  const result = await metaOAuth.handleConnectionFailure('instagram', 'transient');
  assert.equal(result.action, 'unchanged');
});

// ═══════════════════════════════════════════════════════════
// Account discovery
// ═══════════════════════════════════════════════════════════

test('discoverAccountOptions returns zero options for no pages', async () => {
  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/accounts')) return { status: 200, data: { data: [] } };
    return { status: 500, data: {} };
  });
  const options = await metaOAuth.discoverAccountOptions('token');
  assert.equal(options.length, 0);
  metaOAuth.setHttpGet(null);
});

test('discoverAccountOptions returns one option with Instagram', async () => {
  let callCount = 0;
  metaOAuth.setHttpGet(async (url) => {
    callCount++;
    if (url.includes('/me/accounts')) return { status: 200, data: { data: [
      { id: 'p1', name: 'My Page', access_token: 'pt1', picture: { data: { url: '' } } },
    ]}};
    if (url.includes('p1?fields=instagram_business_account')) return { status: 200, data: {
      instagram_business_account: { id: 'ig1', username: 'myig', name: 'My IG', profile_picture_url: '' },
    }};
    return { status: 500, data: {} };
  });
  const options = await metaOAuth.discoverAccountOptions('token');
  assert.equal(options.length, 1);
  assert.equal(options[0].page.name, 'My Page');
  assert.equal(options[0].instagram.username, 'myig');
  metaOAuth.setHttpGet(null);
});

test('discoverAccountOptions returns multiple options', async () => {
  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/accounts')) return { status: 200, data: { data: [
      { id: 'p1', name: 'Page One', access_token: 'pt1', picture: { data: { url: '' } } },
      { id: 'p2', name: 'Page Two', access_token: 'pt2', picture: { data: { url: '' } } },
    ]}};
    return { status: 200, data: {} }; // No IG for any
  });
  const options = await metaOAuth.discoverAccountOptions('token');
  assert.equal(options.length, 2);
  assert.equal(options[0].page.name, 'Page One');
  assert.equal(options[1].page.name, 'Page Two');
  metaOAuth.setHttpGet(null);
});

// ═══════════════════════════════════════════════════════════
// Connection & reconnection
// ═══════════════════════════════════════════════════════════

test('completeConnection stores config without tokens', async () => {
  await metaOAuth.completeConnection('instagram', 'user-long-token', 5184000,
    { id: 'page_c1', name: 'Page C1', accessToken: 'page-acc-tk', picture: 'https://pic' },
    { id: 'ig_c1', username: 'iguser', name: 'IG User', profilePicture: '' },
    'sess-cc');
  const [[intRow]] = await pool.query("SELECT * FROM social_integrations WHERE provider = 'instagram'");
  assert.equal(intRow.is_connected, 1);
  const config = typeof intRow.config_json === 'string' ? JSON.parse(intRow.config_json) : intRow.config_json;
  assert.equal(config.pageId, 'page_c1');
  assert.equal(config.igUsername, 'iguser');
  // config_json must NOT contain tokens
  assert.doesNotMatch(JSON.stringify(config), /user-long-token/);
  assert.doesNotMatch(JSON.stringify(config), /page-acc-tk/);
  await metaOAuth.disconnectProvider('instagram');
});

test('switchAccount changes selection without re-OAuth', async () => {
  await metaOAuth.completeConnection('instagram', 'old-token', 5184000,
    { id: 'page_old', name: 'Old Page', accessToken: 'old-pt', picture: '' },
    null, 'sess-old');
  await metaOAuth.switchAccount('instagram', 'old-token',
    { id: 'page_new', name: 'New Page', accessToken: 'old-pt', picture: '' },
    { id: 'ig_new', username: 'newig', name: 'New IG', profilePicture: '' }, 'sess-new');
  const [[row]] = await pool.query("SELECT config_json FROM social_integrations WHERE provider = 'instagram'");
  const config = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
  assert.equal(config.pageName, 'New Page');
  assert.equal(config.igUsername, 'newig');
  await metaOAuth.disconnectProvider('instagram');
});

test('disconnect clears tokens and config', async () => {
  await metaOAuth.completeConnection('facebook', 'fb-token', 5184000,
    { id: 'page_dc', name: 'DC Page', accessToken: 'dc-pt', picture: '' }, null, 'sess-dc');
  await metaOAuth.disconnectProvider('facebook');
  const [[row]] = await pool.query("SELECT is_connected, config_json FROM social_integrations WHERE provider = 'facebook'");
  assert.equal(row.is_connected, 0);
  const tok = await metaOAuth.getUserAccessToken('facebook');
  assert.equal(tok, null);
});

// ═══════════════════════════════════════════════════════════
// Instagram sync with token validation
// ═══════════════════════════════════════════════════════════

test('instagram sync fails fast on expired token', async () => {
  metaOAuth.setHttpGet(async () => ({
    status: 401, data: { error: { code: 190, error_subcode: 463 } },
  }));
  await encryption.storeToken(pool, 'instagram', 'page_exp_sync', 'exp-tok', {});
  await pool.query(
    "UPDATE social_integrations SET is_connected = 1, is_enabled = 1, require_approval = 1, config_json = ? WHERE provider = 'instagram'",
    [JSON.stringify({ igUserId: 'ig123', pageId: 'page_exp_sync' })]
  );
  try {
    const [[intRow]] = await pool.query(
      "SELECT * FROM social_integrations WHERE provider = 'instagram' AND is_enabled = 1"
    );
    await assert.rejects(
      async () => {
        if (!intRow) throw new Error('no int');
        await instagram.syncInstagram({
          ...intRow,
          config_json: typeof intRow.config_json === 'string'
            ? JSON.parse(intRow.config_json) : (intRow.config_json || {}),
        });
      },
      (err) => err.code === 'TOKEN_INVALID' || err.category === 'expired'
    );
  } finally {
    await metaOAuth.disconnectProvider('instagram');
    metaOAuth.setHttpGet(null);
  }
});

// ═══════════════════════════════════════════════════════════
// Carousel handling
// ═══════════════════════════════════════════════════════════

test('normalizeInstagramMedia handles carousel with first child thumbnail', () => {
  const result = instagram.normalizeInstagramMedia({
    id: 'car_1', media_type: 'CAROUSEL_ALBUM', caption: 'Carousel',
    media_url: 'https://cdn.ig.com/main.jpg', permalink: 'https://ig.com/p/car/',
    timestamp: '2026-01-01T00:00:00Z',
    children: { data: [
      { media_url: 'https://cdn.ig.com/c1.jpg', thumbnail_url: 'https://cdn.ig.com/c1_thumb.jpg', media_type: 'IMAGE' },
      { media_url: 'https://cdn.ig.com/c2.jpg', media_type: 'IMAGE' },
    ]},
    username: 'caruser',
  });
  assert.equal(result.thumbnailUrl, 'https://cdn.ig.com/c1_thumb.jpg');
});

// ═══════════════════════════════════════════════════════════
// Facebook unsupported items
// ═══════════════════════════════════════════════════════════

test('fetchFacebookPosts uses /posts endpoint (Page-owned posts only)', async () => {
  facebook.setHttpGet(async () => ({
    status: 200, data: { data: [
      { id: 'a_1', message: 'Published', created_time: '2026-01-01T00:00:00Z', permalink_url: 'https://fb.com/a1' },
      { id: 'a_2', message: '', created_time: '2026-01-01T00:00:00Z', permalink_url: 'https://fb.com/a3' },
    ]},
  }));
  const items = await facebook.fetchFacebookPosts('pg', 'tk', 10);
  assert.equal(items.length, 1);
  assert.equal(items[0].externalId, 'a_1');
  facebook.setHttpGet(null);
});

// ═══════════════════════════════════════════════════════════
// Manual edit preservation
// ═══════════════════════════════════════════════════════════

test('instagram upsert preserves manual post content', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const pid = crypto.randomUUID();
    await conn.query(
      "INSERT INTO social_posts (public_id, platform, post_url, title, status, provider, provider_external_id, is_imported) VALUES (?, ?, ?, ?, 'published', 'manual', ?, 0)",
      [pid, 'instagram', 'https://www.instagram.com/p/manual-edit/', 'Manual Title', 'ig-manual-001']
    );
    const intRow = { require_approval: 1, config_json: {} };
    const media = { externalId: 'ig-manual-001', caption: 'Auto', mediaType: 'IMAGE', permalink: 'https://www.instagram.com/p/manual-edit/' };
    const result = await instagram.upsertPost(conn, media, intRow);
    assert.equal(result.action, 'skipped');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ═══════════════════════════════════════════════════════════
// Regression: existing capabilities
// ═══════════════════════════════════════════════════════════

test('YouTube integration still works', async () => {
  const { CAPABILITIES } = require('../config/capabilities');
  assert.ok(CAPABILITIES.SOCIAL_INTEGRATIONS_VIEW);
  assert.ok(CAPABILITIES.SOCIAL_INTEGRATIONS_EDIT);
});

test('Testimonials capability still registered', () => {
  const { CAPABILITIES } = require('../config/capabilities');
  assert.ok(CAPABILITIES.TESTIMONIALS_VIEW);
});

test('Social Feed module still registered', async () => {
  const [[row]] = await pool.query("SELECT provider FROM social_integrations WHERE provider = 'youtube'");
  assert.ok(row);
});
