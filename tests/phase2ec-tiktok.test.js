/**
 * Phase 2E-C — TikTok OAuth + Display API auto-import tests.
 *
 * All TikTok API calls are mocked — no live network requests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../config/db');

// ── Environment ──

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = 'test-enc-key-32bytes-len!!!';
process.env.TIKTOK_CLIENT_KEY = 'test-tiktok-client-key-123';
process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-secret-456';
process.env.SITE_URL = 'http://localhost:3000';

const encryption = require('../services/tokenEncryptionService');
const tiktokOAuth = require('../services/tiktokOAuthService');
const tiktokSync = require('../services/tiktokSyncService');

// ── Setup / Teardown ──

test.before(async () => {
  const { migrateSeedTikTok } = require('../scripts/migrate-seed-tiktok');
  await migrateSeedTikTok(pool);

  await pool.query("DELETE FROM social_token_secrets WHERE provider = 'tiktok' OR provider = 'tiktok_refresh'");
  await pool.query("DELETE FROM social_oauth_states WHERE provider = 'tiktok'");
  await pool.query("DELETE FROM social_posts WHERE provider = 'tiktok'");
  await pool.query(
    "UPDATE social_integrations SET config_json = '{}', is_connected = 0, is_enabled = 0, auto_sync = 0 WHERE provider = 'tiktok'"
  );
});

test.after(async () => {
  await pool.query("DELETE FROM social_token_secrets WHERE provider = 'tiktok' OR provider = 'tiktok_refresh'");
  await pool.query("DELETE FROM social_oauth_states WHERE provider = 'tiktok'");
  await pool.query("DELETE FROM social_posts WHERE provider = 'tiktok'");
  await pool.end();
});

// ═══════════════════════════════════════
// Migration 33
// ═══════════════════════════════════════

test('migration 33: TikTok row exists', async () => {
  const [[row]] = await pool.query("SELECT * FROM social_integrations WHERE provider = 'tiktok'");
  assert.ok(row);
  assert.equal(row.label, 'TikTok');
  assert.equal(row.is_enabled, 0);
});

test('migration 33 is idempotent', async () => {
  const { migrateSeedTikTok } = require('../scripts/migrate-seed-tiktok');
  await migrateSeedTikTok(pool);
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM social_integrations WHERE provider = 'tiktok'");
  assert.equal(cnt, 1);
});

test('MIGRATION_REGISTRY has 33 entries', () => {
  const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');
  assert.equal(MIGRATION_REGISTRY.length, 35);
});

test('migration 27 checksum still preserved', () => {
  const fs = require('fs');
  const buf = fs.readFileSync('scripts/migrate-social-integrations.js');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(sha, '6154521b99fb5a26a8aee31e6bae5ab151f4e5505f655d52244314ca03fb6575');
});

// ═══════════════════════════════════════
// Config & origins
// ═══════════════════════════════════════

test('getClientKey returns env value', () => {
  assert.equal(tiktokOAuth.getClientKey(), 'test-tiktok-client-key-123');
});

test('validateUrlOrigin rejects non-TikTok URLs', () => {
  assert.throws(() => tiktokOAuth.validateUrlOrigin('https://evil.com/attack'), { code: 'ORIGIN_DENIED' });
});

test('validateUrlOrigin accepts official TikTok origins', () => {
  tiktokOAuth.validateUrlOrigin('https://www.tiktok.com/v2/auth/authorize/');
  tiktokOAuth.validateUrlOrigin('https://open.tiktokapis.com/v2/oauth/token/');
});

// ═══════════════════════════════════════
// OAuth URL & scopes
// ═══════════════════════════════════════

test('getAuthorizationUrl uses correct endpoint and scopes', () => {
  const { url, scopes } = tiktokOAuth.getAuthorizationUrl('tiktok', 'sess-tk1');
  assert.match(url, /tiktok\.com\/v2\/auth\/authorize/);
  assert.ok(scopes.includes('user.info.basic'));
  assert.ok(scopes.includes('video.list'));
});

test('getAuthorizationUrl includes state parameter', () => {
  const { url, stateId } = tiktokOAuth.getAuthorizationUrl('tiktok', 'sess-tk2');
  assert.match(url, new RegExp(stateId));
  assert.ok(stateId.length > 16);
});

test('getAuthorizationUrl uses consistent redirect URI', () => {
  const { url } = tiktokOAuth.getAuthorizationUrl('tiktok', 'sess-tk3');
  const expected = encodeURIComponent(tiktokOAuth.getRedirectUri());
  assert.match(url, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('getAuthorizationUrl enforces HTTPS in production', () => {
  const saved = process.env.NODE_ENV;
  const savedUrl = process.env.SITE_URL;
  process.env.NODE_ENV = 'production';
  process.env.SITE_URL = 'http://mysite.com';
  try {
    assert.throws(() => tiktokOAuth.getAuthorizationUrl('tiktok', 'sess'), { code: 'HTTPS_REQUIRED' });
  } finally {
    process.env.NODE_ENV = saved;
    process.env.SITE_URL = savedUrl;
  }
});

// ═══════════════════════════════════════
// OAuth state lifecycle
// ═══════════════════════════════════════

test('state is created, consumed once, then gone', async () => {
  const { id } = tiktokOAuth.generateState('sess-tk-st');
  await tiktokOAuth.persistState(id, 'tiktok', 'sess-tk-st');
  const consumed = await tiktokOAuth.consumeState(id, 'sess-tk-st');
  assert.ok(consumed);
  const consumed2 = await tiktokOAuth.consumeState(id, 'sess-tk-st');
  assert.equal(consumed2, null);
});

test('state rejects cross-session access', async () => {
  const { id } = tiktokOAuth.generateState('sess-A');
  await tiktokOAuth.persistState(id, 'tiktok', 'sess-A');
  const consumed = await tiktokOAuth.consumeState(id, 'sess-B');
  assert.equal(consumed, null);
});

test('state expires after timeout', async () => {
  const { id } = tiktokOAuth.generateState('sess-ex');
  await pool.query(
    'INSERT INTO social_oauth_states (state_id, provider, expires_at, session_id) VALUES (?, ?, ?, ?)',
    [id, 'tiktok', new Date(Date.now() - 1000), 'sess-ex']
  );
  const consumed = await tiktokOAuth.consumeState(id, 'sess-ex');
  assert.equal(consumed, null);
});

test('generateState throws without sessionId', () => {
  assert.throws(() => tiktokOAuth.generateState(), { code: 'NO_SESSION' });
});

// ═══════════════════════════════════════
// Token exchange
// ═══════════════════════════════════════

test('exchangeCodeForToken returns access + refresh tokens', async () => {
  const { id: stateId } = tiktokOAuth.generateState('sess-tk-ex');
  await tiktokOAuth.persistState(stateId, 'tiktok', 'sess-tk-ex');

  tiktokOAuth.setHttpPost(async () => ({
    status: 200,
    data: {
      access_token: 'tk-access-abc123',
      refresh_token: 'tk-refresh-xyz789',
      expires_in: 86400,
      open_id: 'openid_test123',
      scope: 'user.info.basic,video.list',
      token_type: 'Bearer',
    },
  }));

  const result = await tiktokOAuth.exchangeCodeForToken('auth-code', stateId, 'sess-tk-ex');
  assert.equal(result.accessToken, 'tk-access-abc123');
  assert.equal(result.refreshToken, 'tk-refresh-xyz789');
  assert.equal(result.expiresIn, 86400);
  assert.equal(result.openId, 'openid_test123');

  tiktokOAuth.setHttpPost(null);
});

test('exchangeCodeForToken rejects invalid state', async () => {
  await assert.rejects(
    () => tiktokOAuth.exchangeCodeForToken('code', 'nonexistent', 'sess'),
    { code: 'INVALID_STATE' }
  );
});

// ═══════════════════════════════════════
// Token encryption & no leakage
// ═══════════════════════════════════════

test('completeConnection stores encrypted tokens, never plaintext', async () => {
  // Mock user info
  const origFetch = global.fetch;
  global.fetch = async () => ({
    status: 200,
    json: async () => ({ data: { open_id: 'open_user_1', display_name: 'Test User', avatar_url: 'https://avatar.url' } }),
  });

  await tiktokOAuth.completeConnection('tiktok', {
    accessToken: 'tk-enc-acc',
    refreshToken: 'tk-enc-ref',
    expiresIn: 86400,
    openId: 'open_user_1',
    scope: 'user.info.basic,video.list',
  }, 'sess-enc');

  global.fetch = origFetch;

  // Verify token is NOT plaintext in config_json
  const [[intRow]] = await pool.query("SELECT config_json FROM social_integrations WHERE provider = 'tiktok'");
  const raw = JSON.stringify(intRow.config_json);
  assert.doesNotMatch(raw, /tk-enc-acc/);
  assert.doesNotMatch(raw, /tk-enc-ref/);

  // Verify encrypted token can be decrypted
  const stored = await encryption.retrieveToken(pool, 'tiktok', 'open_user_1');
  assert.ok(stored);
  assert.equal(stored.token, 'tk-enc-acc');

  // Verify refresh token stored separately
  const refreshStored = await encryption.retrieveToken(pool, 'tiktok_refresh', 'open_user_1');
  assert.ok(refreshStored);
  assert.equal(refreshStored.token, 'tk-enc-ref');

  // Cleanup
  await tiktokOAuth.disconnectProvider('tiktok');
});

// ═══════════════════════════════════════
// Token lifecycle
// ═══════════════════════════════════════

test('validateToken returns valid for working token', async () => {
  const origFetch = global.fetch;
  global.fetch = async () => ({
    status: 200,
    json: async () => ({ data: { open_id: 'ok_user' } }),
  });

  await encryption.storeToken(pool, 'tiktok', 'ok_user', 'valid-tk', { openId: 'ok_user' });
  await pool.query(
    "UPDATE social_integrations SET is_connected = 1, config_json = ? WHERE provider = 'tiktok'",
    [JSON.stringify({ openId: 'ok_user' })]
  );

  const result = await tiktokOAuth.validateToken('tiktok');
  assert.equal(result.valid, true);
  assert.equal(result.category, 'ok');

  await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'tiktok'");
  await encryption.deleteToken(pool, 'tiktok', 'ok_user');
  global.fetch = origFetch;
});

test('validateToken detects expired token', async () => {
  const origFetch = global.fetch;
  global.fetch = async () => ({
    status: 401,
    json: async () => ({ error: 'token_expired', error_description: 'Token expired' }),
  });

  await encryption.storeToken(pool, 'tiktok', 'exp_user', 'exp-tk', {});
  await pool.query(
    "UPDATE social_integrations SET is_connected = 1, config_json = ? WHERE provider = 'tiktok'",
    [JSON.stringify({ openId: 'exp_user' })]
  );

  const result = await tiktokOAuth.validateToken('tiktok');
  assert.equal(result.valid, false);
  assert.equal(result.category, 'expired');

  await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'tiktok'");
  await encryption.deleteToken(pool, 'tiktok', 'exp_user');
  global.fetch = origFetch;
});

test('checkTokenExpiration warns within 14 days', async () => {
  const future = new Date(Date.now() + 6 * 86400000).toISOString();
  await pool.query(
    "UPDATE social_integrations SET is_connected = 1, config_json = ? WHERE provider = 'tiktok'",
    [JSON.stringify({ openId: 'warn_user', tokenExpiresAt: future })]
  );
  const result = await tiktokOAuth.checkTokenExpiration('tiktok');
  assert.equal(result.warning, true);
  await pool.query("UPDATE social_integrations SET config_json = '{}', is_connected = 0 WHERE provider = 'tiktok'");
});

test('handleConnectionFailure disables sync for revoked tokens', async () => {
  await pool.query("UPDATE social_integrations SET auto_sync = 1, is_connected = 1 WHERE provider = 'tiktok'");
  const result = await tiktokOAuth.handleConnectionFailure('tiktok', 'revoked');
  assert.equal(result.action, 'disabled');
  const [[row]] = await pool.query("SELECT auto_sync, is_connected FROM social_integrations WHERE provider = 'tiktok'");
  assert.equal(row.auto_sync, 0);
});

// ═══════════════════════════════════════
// Refresh token
// ═══════════════════════════════════════

test('refreshAccessToken returns new access token', async () => {
  await encryption.storeToken(pool, 'tiktok_refresh', 'refresh_usr', 'old-refresh-tk', { openId: 'refresh_usr' });

  tiktokOAuth.setHttpPost(async () => ({
    status: 200,
    data: {
      access_token: 'new-access-abc',
      refresh_token: 'new-refresh-xyz',
      expires_in: 86400,
      scope: 'user.info.basic,video.list',
    },
  }));

  const result = await tiktokOAuth.refreshAccessToken('tiktok', 'refresh_usr');
  assert.equal(result.accessToken, 'new-access-abc');

  // Verify new refresh token rotated
  const stored = await encryption.retrieveToken(pool, 'tiktok_refresh', 'refresh_usr');
  assert.equal(stored.token, 'new-refresh-xyz');

  tiktokOAuth.setHttpPost(null);
  await encryption.deleteToken(pool, 'tiktok_refresh', 'refresh_usr');
  await encryption.deleteToken(pool, 'tiktok', 'refresh_usr');
});

test('refreshAccessToken rejects invalid_grant', async () => {
  await encryption.storeToken(pool, 'tiktok_refresh', 'bad_user', 'bad-refresh', {});

  tiktokOAuth.setHttpPost(async () => ({
    status: 400,
    data: { error: 'invalid_grant', error_description: 'Token revoked' },
  }));

  await assert.rejects(
    () => tiktokOAuth.refreshAccessToken('tiktok', 'bad_user'),
    (err) => err.code === 'REFRESH_ERROR'
  );

  tiktokOAuth.setHttpPost(null);
  await encryption.deleteToken(pool, 'tiktok_refresh', 'bad_user');
});

// ═══════════════════════════════════════
// Disconnect / reconnect
// ═══════════════════════════════════════

test('disconnect clears tokens and config', async () => {
  await encryption.storeToken(pool, 'tiktok', 'dc_user', 'dc-token', {});
  await encryption.storeToken(pool, 'tiktok_refresh', 'dc_user', 'dc-refresh', {});
  await pool.query(
    "UPDATE social_integrations SET is_connected = 1, config_json = ? WHERE provider = 'tiktok'",
    [JSON.stringify({ openId: 'dc_user' })]
  );

  await tiktokOAuth.disconnectProvider('tiktok');

  const [[row]] = await pool.query("SELECT is_connected FROM social_integrations WHERE provider = 'tiktok'");
  assert.equal(row.is_connected, 0);
  const tok = await encryption.retrieveToken(pool, 'tiktok', 'dc_user');
  assert.equal(tok, null);
  const ref = await encryption.retrieveToken(pool, 'tiktok_refresh', 'dc_user');
  assert.equal(ref, null);
});

// ═══════════════════════════════════════
// Video normalization
// ═══════════════════════════════════════

test('normalizeTikTokVideo extracts fields', () => {
  const result = tiktokSync.normalizeTikTokVideo({
    id: 'vid_12345',
    title: 'My TikTok',
    video_description: 'Check out this video!',
    cover_image_url: 'https://p16-sign.tiktokcdn-us.com/img.jpg',
    share_url: 'https://www.tiktok.com/@user/video/12345',
    create_time: 1700000000,
    duration: 30,
  });
  assert.equal(result.externalId, 'vid_12345');
  assert.equal(result.title, 'My TikTok');
  assert.ok(result.coverImageUrl);
  assert.ok(result.createTime);
});

test('normalizeTikTokVideo falls back title from description', () => {
  const result = tiktokSync.normalizeTikTokVideo({
    id: 'vid_fb',
    video_description: 'A cool clip from TikTok',
    share_url: 'https://www.tiktok.com/@user/video/vid_fb',
  });
  assert.ok(result.title.includes('A cool clip'));
});

// ═══════════════════════════════════════
// Video upsert
// ═══════════════════════════════════════

test('tiktok upsertPost creates draft by default', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-vid-001', title: 'Test', description: 'Desc', coverImageUrl: 'https://cover.url', shareUrl: 'https://www.tiktok.com/@user/video/001' };
    const result = await tiktokSync.upsertPost(conn, video, intRow);
    assert.equal(result.action, 'imported');
    const [[post]] = await conn.query("SELECT status, platform FROM social_posts WHERE provider_external_id = 'tk-vid-001'");
    assert.equal(post.status, 'draft');
    assert.equal(post.platform, 'tiktok');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('tiktok upsertPost skips duplicates', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-dup-002', title: 'Dup', description: '', coverImageUrl: '', shareUrl: 'https://www.tiktok.com/@user/video/tk-dup-002' };
    await tiktokSync.upsertPost(conn, video, intRow);
    const result2 = await tiktokSync.upsertPost(conn, video, intRow);
    assert.ok(['skipped', 'updated'].includes(result2.action));
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('tiktok upsertPost preserves manual post content', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const pid = crypto.randomUUID();
    await conn.query(
      "INSERT INTO social_posts (public_id, platform, post_url, title, status, provider, provider_external_id, is_imported) VALUES (?, ?, ?, ?, 'published', 'manual', ?, 0)",
      [pid, 'tiktok', 'https://www.tiktok.com/@user/video/manual-tk', 'Manual TikTok Title', 'tk-manual-003']
    );
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-manual-003', title: 'Auto', description: '', coverImageUrl: '', shareUrl: 'https://www.tiktok.com/@user/video/manual-tk' };
    const result = await tiktokSync.upsertPost(conn, video, intRow);
    assert.equal(result.action, 'skipped');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ═══════════════════════════════════════
// queryVideos (max 20 IDs)
// ═══════════════════════════════════════

test('queryVideos respects 20 ID limit', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `vid_${i}`);
  const origFetch = global.fetch;

  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const requestedIds = body.filters?.video_ids || [];
    assert.ok(requestedIds.length <= 20);
    return {
      status: 200,
      json: async () => ({ data: { videos: requestedIds.map(id => ({ id, cover_image_url: 'https://cover/' + id })) } }),
    };
  };

  const results = await tiktokSync.queryVideos('token', ids);
  assert.ok(results.length <= 20);
  global.fetch = origFetch;
});

// ═══════════════════════════════════════
// Provider isolation & regressions
// ═══════════════════════════════════════

test('YouTube integration still configured', async () => {
  const [[row]] = await pool.query("SELECT provider FROM social_integrations WHERE provider = 'youtube'");
  assert.ok(row);
});

test('Instagram integration still configured', async () => {
  const [[row]] = await pool.query("SELECT provider FROM social_integrations WHERE provider = 'instagram'");
  assert.ok(row);
});

test('Facebook integration still configured', async () => {
  const [[row]] = await pool.query("SELECT provider FROM social_integrations WHERE provider = 'facebook'");
  assert.ok(row);
});

test('Testimonials capability still registered', () => {
  const { CAPABILITIES } = require('../config/capabilities');
  assert.ok(CAPABILITIES.TESTIMONIALS_VIEW);
});

test('Social integrations cap still registered', () => {
  const { CAPABILITIES } = require('../config/capabilities');
  assert.ok(CAPABILITIES.SOCIAL_INTEGRATIONS_VIEW);
});
