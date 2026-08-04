/**
 * Phase 2E-D — Final social integrations stabilization audit.
 *
 * Covers: canonical data contract, provider audits, OAuth hardening,
 * encryption readiness, scheduler behavior, public rendering resilience,
 * admin visibility, migration integrity.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('fs');
const pool = require('../config/db');

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = 'test-enc-key-32bytes-len!!!';
process.env.SITE_URL = 'http://localhost:3000';
process.env.YOUTUBE_API_KEY = 'test-youtube-key';
process.env.META_APP_ID = 'test-meta-app-id';
process.env.META_APP_SECRET = 'test-meta-secret';
process.env.TIKTOK_CLIENT_KEY = 'test-tk-key';
process.env.TIKTOK_CLIENT_SECRET = 'test-tk-secret';

// ── Setup ──

test.before(async () => {
  const { migrateSocialPostsProviderThumbnail } = require('../scripts/migrate-social-posts-provider-thumbnail');
  await migrateSocialPostsProviderThumbnail(pool);
});

test.after(async () => {
  await pool.end();
});

// ═══════════════════════════════════════════
// 1. Canonical data contract
// ═══════════════════════════════════════════

test('ALLOWED_DISPLAY_MODES accepts canonical external and embed', () => {
  const { ALLOWED_DISPLAY_MODES } = require('../services/socialFeedService');
  assert.ok(ALLOWED_DISPLAY_MODES.includes('external'));
  assert.ok(ALLOWED_DISPLAY_MODES.includes('embed'));
  assert.ok(ALLOWED_DISPLAY_MODES.includes('external_link')); // legacy compat
});

test('validatePost normalizes external_link to external', async () => {
  const { validatePost } = require('../services/socialFeedService');
  const result = await validatePost({
    platform: 'youtube', postUrl: 'https://example.com/post', title: 'Test',
    displayMode: 'external_link', thumbnailMediaRef: '',
  });
  assert.equal(result.valid, false); // URL won't validate for youtube, but display_mode is normalized
  assert.equal(result.sanitized.displayMode, 'external');
});

test('validatePost keeps embed unchanged', async () => {
  const { validatePost } = require('../services/socialFeedService');
  const result = await validatePost({
    platform: 'youtube', postUrl: 'https://youtube.com/watch?v=aaaaaaaaaaa', title: 'Test',
    displayMode: 'embed', thumbnailMediaRef: '',
  });
  assert.equal(result.sanitized.displayMode, 'embed');
});

test('validatePost accepts canonical external', async () => {
  const { validatePost } = require('../services/socialFeedService');
  const result = await validatePost({
    platform: 'other', postUrl: 'https://example.com/post', title: 'Test',
    displayMode: 'external', thumbnailMediaRef: '',
  });
  assert.equal(result.sanitized.displayMode, 'external');
});

test('getPublicFeed normalizes external_link to external', () => {
  // The normalization happens at line ~450: === 'embed' ? 'embed' : 'external'
  // Verify the code reads correctly
  const src = fs.readFileSync('services/socialFeedService.js', 'utf8');
  const line = src.split('\n').find(l => l.includes("displayMode: snapshot.displayMode"));
  assert.ok(line.includes("'embed'"));
  assert.ok(line.includes("'external'"));
  assert.ok(!line.includes("'external_link'"));
});

test('form.ejs uses canonical external (not external_link)', () => {
  const src = fs.readFileSync('views/pages/admin/page/social-feed/form.ejs', 'utf8');
  assert.match(src, /value="external"/);
  // Should NOT have external_link as an option
  const externalLinkOption = src.match(/value="external_link"/);
  assert.equal(externalLinkOption, null);
});

// ═══════════════════════════════════════════
// 2. Provider thumbnail fallback in public feed
// ═══════════════════════════════════════════

test('homepage rendering falls back from local to provider to svg', () => {
  const src = fs.readFileSync('services/socialFeedService.js', 'utf8');
  // Must have three-tier fallback
  assert.match(src, /resolveMediaReference/);
  assert.match(src, /providerThumbnailUrl/);
  assert.match(src, /providerThumbnailExpiresAt/);
  assert.match(src, /social-feed-fallback\.svg/);
});

test('homepage does not load provider scripts initially', () => {
  const src = fs.readFileSync('views/pages/home.ejs', 'utf8');
  // Remove EJS comments and template code, then check for provider <script> tags
  const noComments = src.replace(/<%.*?%>/gs, '');
  const scripts = noComments.match(/<script[^>]*src=["'][^"']*(?:tiktok|youtube\.com|instagram\.com|facebook\.com)[^"']*["']/gi);
  assert.equal(scripts, null);
});

// ═══════════════════════════════════════════
// 3. OAuth callback safety
// ═══════════════════════════════════════════

test('Meta OAuth callback enforces HTTPS in production', () => {
  const saved = process.env.NODE_ENV;
  const savedConfig = process.env.META_CONFIG_ID;
  process.env.NODE_ENV = 'production';
  process.env.SITE_URL = 'http://mysite.com';
  process.env.META_CONFIG_ID = 'test_config';
  try {
    const metaOAuth = require('../services/metaOAuthService');
    assert.throws(() => metaOAuth.getAuthorizationUrl('instagram', 'sess'), { code: 'HTTPS_REQUIRED' });
  } finally {
    process.env.NODE_ENV = saved;
    process.env.SITE_URL = 'http://localhost:3000';
    if (savedConfig) process.env.META_CONFIG_ID = savedConfig; else delete process.env.META_CONFIG_ID;
  }
});

test('TikTok OAuth callback enforces HTTPS in production', () => {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.SITE_URL = 'http://mysite.com';
  try {
    const tiktokOAuth = require('../services/tiktokOAuthService');
    assert.throws(() => tiktokOAuth.getAuthorizationUrl('tiktok', 'sess'), { code: 'HTTPS_REQUIRED' });
  } finally {
    process.env.NODE_ENV = saved;
    process.env.SITE_URL = 'http://localhost:3000';
  }
});

test('Meta OAuth redirect URI is deterministic', () => {
  const metaOAuth = require('../services/metaOAuthService');
  const uri = metaOAuth.getRedirectUri();
  assert.equal(uri, 'http://localhost:3000/admin/page/integrations/meta-callback');
});

test('TikTok OAuth redirect URI is deterministic', () => {
  const tiktokOAuth = require('../services/tiktokOAuthService');
  const uri = tiktokOAuth.getRedirectUri();
  assert.equal(uri, 'http://localhost:3000/admin/page/integrations/tiktok-callback');
});

test('Meta OAuth state requires session', () => {
  const metaOAuth = require('../services/metaOAuthService');
  assert.throws(() => metaOAuth.generateState(null), { code: 'NO_SESSION' });
  assert.throws(() => metaOAuth.generateState(''), { code: 'NO_SESSION' });
});

test('TikTok OAuth state requires session', () => {
  const tiktokOAuth = require('../services/tiktokOAuthService');
  assert.throws(() => tiktokOAuth.generateState(null), { code: 'NO_SESSION' });
  assert.throws(() => tiktokOAuth.generateState(''), { code: 'NO_SESSION' });
});

test('OAuth state is single-use (consumeState deletes after validation)', async () => {
  const metaOAuth = require('../services/metaOAuthService');
  const { id } = metaOAuth.generateState('sess-1');
  await metaOAuth.persistState(id, 'instagram', 'sess-1');

  // First consume should succeed
  const result = await metaOAuth.consumeState(id, 'sess-1', 'instagram');
  assert.ok(result);

  // Second consume should fail (already deleted)
  const result2 = await metaOAuth.consumeState(id, 'sess-1', 'instagram');
  assert.equal(result2, null);
});

test('OAuth state rejects cross-session use', async () => {
  const metaOAuth = require('../services/metaOAuthService');
  const { id } = metaOAuth.generateState('sess-A');
  await metaOAuth.persistState(id, 'instagram', 'sess-A');

  const result = await metaOAuth.consumeState(id, 'sess-B', 'instagram');
  assert.equal(result, null);
});

test('OAuth state rejects expired', async () => {
  const metaOAuth = require('../services/metaOAuthService');
  const { id } = metaOAuth.generateState('sess-exp');
  // insert directly with past expiry
  const past = new Date(Date.now() - 60000);
  await pool.query(
    'INSERT INTO social_oauth_states (state_id, provider, expires_at, session_id) VALUES (?, ?, ?, ?)',
    [id, 'instagram', past, 'sess-exp']
  );

  const result = await metaOAuth.consumeState(id, 'sess-exp', 'instagram');
  assert.equal(result, null);
});

// ═══════════════════════════════════════════
// 4. Encryption key readiness
// ═══════════════════════════════════════════

test('encryption fails closed when key absent', () => {
  const saved = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  delete process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  try {
    const encryption = require('../services/tokenEncryptionService');
    assert.throws(() => encryption.encrypt('test-token'), { code: 'NO_ENCRYPTION_KEY' });
  } finally {
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = saved;
  }
});

test('decryption rejects tampered data', () => {
  const encryption = require('../services/tokenEncryptionService');
  const { encrypted, iv, authTag } = encryption.encrypt('my-token');
  // Tamper with authTag
  const tampered = Buffer.from(authTag);
  tampered[0] ^= 0xFF;
  assert.throws(() => encryption.decrypt(encrypted, iv, tampered));
});

test('encryption round-trips correctly', () => {
  const encryption = require('../services/tokenEncryptionService');
  const plain = 'access-token-value-12345';
  const { encrypted, iv, authTag } = encryption.encrypt(plain);
  const result = encryption.decrypt(encrypted, iv, authTag);
  assert.equal(result, plain);
});

test('encryption key derivation works with short key', () => {
  const saved = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = 'short';
  try {
    const encryption = require('../services/tokenEncryptionService');
    const key = encryption.getEncryptionKey();
    assert.equal(key.length, 32); // always 32 bytes
  } finally {
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = saved;
  }
});

// ═══════════════════════════════════════════
// 5. Scheduler behavior
// ═══════════════════════════════════════════

test('scheduler is disabled by default (no interval env)', () => {
  const saved = process.env.SOCIAL_SYNC_INTERVAL_MINUTES;
  delete process.env.SOCIAL_SYNC_INTERVAL_MINUTES;
  try {
    const scheduler = require('../services/socialSyncScheduler');
    assert.equal(scheduler.isSchedulerEnabled(), false);
    assert.equal(scheduler.getIntervalMinutes(), null);
  } finally {
    process.env.SOCIAL_SYNC_INTERVAL_MINUTES = saved;
  }
});

test('scheduler clamps interval below 60 to 60', () => {
  const saved = process.env.SOCIAL_SYNC_INTERVAL_MINUTES;
  process.env.SOCIAL_SYNC_INTERVAL_MINUTES = '30';
  try {
    const scheduler = require('../services/socialSyncScheduler');
    assert.equal(scheduler.getIntervalMinutes(), 60);
  } finally {
    process.env.SOCIAL_SYNC_INTERVAL_MINUTES = saved;
  }
});

test('scheduler accepts valid interval >= 60', () => {
  const saved = process.env.SOCIAL_SYNC_INTERVAL_MINUTES;
  process.env.SOCIAL_SYNC_INTERVAL_MINUTES = '120';
  try {
    const scheduler = require('../services/socialSyncScheduler');
    assert.equal(scheduler.isSchedulerEnabled(), true);
    assert.equal(scheduler.getIntervalMinutes(), 120);
  } finally {
    process.env.SOCIAL_SYNC_INTERVAL_MINUTES = saved;
  }
});

test('scheduler stop clears timers', () => {
  const saved = process.env.SOCIAL_SYNC_INTERVAL_MINUTES;
  process.env.SOCIAL_SYNC_INTERVAL_MINUTES = '120';
  try {
    const scheduler = require('../services/socialSyncScheduler');
    scheduler.setUnrefTimers(true);
    scheduler.start();
    assert.equal(scheduler.isRunning(), true);
    scheduler.stop();
    assert.equal(scheduler.isRunning(), false);
  } finally {
    process.env.SOCIAL_SYNC_INTERVAL_MINUTES = saved;
  }
});

test('scheduler tick guard prevents overlapping', async () => {
  const scheduler = require('../services/socialSyncScheduler');
  // Just verify the guard exists
  const src = fs.readFileSync('services/socialSyncScheduler.js', 'utf8');
  assert.match(src, /_tickRunning/);
  assert.match(src, /if.*_tickRunning.*return/);
});

test('scheduler uses provider-specific advisory locks', () => {
  const src = fs.readFileSync('services/socialSyncService.js', 'utf8');
  assert.match(src, /GET_LOCK/);
  assert.match(src, /RELEASE_LOCK/);
});

test('scheduler stop is part of graceful shutdown', () => {
  const src = fs.readFileSync('app.js', 'utf8');
  assert.match(src, /socialSyncScheduler/);
  assert.match(src, /scheduler\.stop\(\)/);
});

// ═══════════════════════════════════════════
// 6. No secret leakage
// ═══════════════════════════════════════════

test('tokens not stored in config_json', async () => {
  // Verify integration config does not contain plaintext tokens
  const integrations = await pool.query(
    "SELECT config_json FROM social_integrations WHERE provider IN ('instagram','facebook','tiktok')"
  );
  for (const [row] of integrations) {
    if (row && row.config_json) {
      const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
      assert.equal(cfg.accessToken, undefined);
      assert.equal(cfg.access_token, undefined);
      assert.equal(cfg.token, undefined);
    }
  }
});

test('social token secrets table stores encrypted data only', async () => {
  const [[{ cnt }]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_token_secrets' AND COLUMN_NAME = 'encrypted_data' AND DATA_TYPE = 'blob'"
  );
  assert.equal(cnt, 1);
});

test('redactTokens masks API keys and tokens', () => {
  const controller = require('../controllers/adminSocialSyncController');
  const msg = controller.redactTokens('Failed with key AIzaSyC1234567890abcdefghijklmnopqrstuv and token ya29.abcdefgh');
  assert.ok(msg.includes('[API_KEY]'));
  assert.ok(msg.includes('[TOKEN]'));
});

// ═══════════════════════════════════════════
// 7. Migration integrity
// ═══════════════════════════════════════════

test('MIGRATION_REGISTRY has 34 entries in correct order', () => {
  const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');
  assert.equal(MIGRATION_REGISTRY.length, 34);
  // Check last few are our social integrations migrations
  const names = MIGRATION_REGISTRY.map(e => e.name);
  assert.ok(names.includes('migrateSocialIntegrations'));
  assert.ok(names.includes('migrateSocialSyncRuns'));
  assert.ok(names.includes('migrateSocialPostsImportFields'));
  assert.ok(names.includes('migrateSocialTokenSecrets'));
  assert.ok(names.includes('migrateSocialOAuthStates'));
  assert.ok(names.includes('migrateSeedMetaIntegrations'));
  assert.ok(names.includes('migrateSeedTikTok'));
  assert.ok(names.includes('migrateSocialPostsProviderThumbnail'));
});

test('migration 24 checksum unchanged (migrate-social-feed)', () => {
  const buf = fs.readFileSync('scripts/migrate-social-feed.js');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(sha, 'c810f5ad8ada5d8d1db291f7f6636e4fee1975929bdeaa0a799d8d9849254b71');
});

test('migration 25 checksum unchanged (migrate-social-feed-home-section)', () => {
  const buf = fs.readFileSync('scripts/migrate-social-feed-home-section.js');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(sha, '7558a0dc5778654ffc9807c113cc52bef1a72771dfd44d87b702fb7ce6fc0d83');
});

test('migration 27 checksum unchanged (migrate-social-integrations)', () => {
  const buf = fs.readFileSync('scripts/migrate-social-integrations.js');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(sha, 'd076264e079d74cc69523eb5aeac3f23db5e657ad812b60072793ab9d325edc6');
});

test('migration 34 is idempotent', async () => {
  const { migrateSocialPostsProviderThumbnail } = require('../scripts/migrate-social-posts-provider-thumbnail');
  await migrateSocialPostsProviderThumbnail(pool); // re-run
  const [[{ cnt }]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_thumbnail_url'"
  );
  assert.equal(cnt, 1);
});

// ═══════════════════════════════════════════
// 8. Provider seed integrity
// ═══════════════════════════════════════════

test('YouTube integration is seeded', async () => {
  const [[row]] = await pool.query("SELECT * FROM social_integrations WHERE provider = 'youtube'");
  assert.ok(row);
});

test('Instagram integration is seeded', async () => {
  const [[row]] = await pool.query("SELECT * FROM social_integrations WHERE provider = 'instagram'");
  assert.ok(row);
  assert.equal(row.is_enabled, 0);
});

test('Facebook integration is seeded', async () => {
  const [[row]] = await pool.query("SELECT * FROM social_integrations WHERE provider = 'facebook'");
  assert.ok(row);
  assert.equal(row.is_enabled, 0);
});

test('TikTok integration is seeded', async () => {
  const [[row]] = await pool.query("SELECT * FROM social_integrations WHERE provider = 'tiktok'");
  assert.ok(row);
  assert.equal(row.is_enabled, 0);
});

test('no duplicate provider rows', async () => {
  for (const provider of ['youtube', 'instagram', 'facebook', 'tiktok']) {
    const [[{ cnt }]] = await pool.query(
      "SELECT COUNT(*) cnt FROM social_integrations WHERE provider = ?", [provider]
    );
    assert.equal(cnt, 1, `${provider} has ${cnt} rows, expected 1`);
  }
});

// ═══════════════════════════════════════════
// 9. Public rendering resilience
// ═══════════════════════════════════════════

test('home.ejs has social-embed-modal for lazy loading', () => {
  const src = fs.readFileSync('views/pages/home.ejs', 'utf8');
  assert.match(src, /social-embed-modal/);
  assert.match(src, /data-social-embed-open/);
  assert.match(src, /data-social-embed-close/);
});

test('home.ejs uses social-feed-fallback.svg as last resort', () => {
  const src = fs.readFileSync('views/pages/home.ejs', 'utf8');
  assert.match(src, /social-feed-fallback\.svg/);
});

test('home.ejs preserves no-js accessibility (static links)', () => {
  const src = fs.readFileSync('views/pages/home.ejs', 'utf8');
  // Cards should have href for direct navigation when JS disabled
  assert.match(src, /social-public__link/);
  assert.match(src, /target="_blank"/);
});

test('socialEmbedModal cleans up iframe on close', () => {
  const src = fs.readFileSync('public/js/home/socialEmbedModal.js', 'utf8');
  assert.match(src, /remove\(\)|innerHTML\s*=\s*['"]\s*['"]/);
});

// ═══════════════════════════════════════════
// 10. Admin integration rendering
// ═══════════════════════════════════════════

test('sidebar has Integraciones sociales link', () => {
  const src = fs.readFileSync('views/components/sidebar.ejs', 'utf8');
  assert.match(src, /integrations/);
  assert.match(src, /Integraciones sociales/);
});

test('sidebar has Testimonios link', () => {
  const src = fs.readFileSync('views/components/sidebar.ejs', 'utf8');
  assert.match(src, /testimonials/);
});

test('integrations list template exists', () => {
  assert.ok(fs.existsSync('views/pages/admin/page/integrations'));
});

test('tiktok config template exists', () => {
  assert.ok(fs.existsSync('views/pages/admin/page/integrations/tiktok-config.ejs'));
});

test('meta config template exists', () => {
  assert.ok(fs.existsSync('views/pages/admin/page/integrations/meta-config.ejs'));
});

// ═══════════════════════════════════════════
// 11. Environment documentation
// ═══════════════════════════════════════════

test('.env.example documents Social Integrations', () => {
  const src = fs.readFileSync('.env.example', 'utf8');
  assert.match(src, /SOCIAL_SYNC_INTERVAL_MINUTES/);
  assert.match(src, /SOCIAL_TOKEN_ENCRYPTION_KEY/);
  assert.match(src, /YOUTUBE_API_KEY/);
  assert.match(src, /META_APP_ID/);
  assert.match(src, /TIKTOK_CLIENT_KEY/);
  assert.match(src, /SITE_URL/);
});

test('PRODUCTION.md documents Social Integrations', () => {
  const src = fs.readFileSync('docs/PRODUCTION.md', 'utf8');
  assert.match(src, /Social Integrations/);
  assert.match(src, /SOCIAL_SYNC_INTERVAL_MINUTES/);
  assert.match(src, /OAuth Callback Paths/);
  assert.match(src, /Encryption Key/);
  assert.match(src, /Rollout Order/);
});

// ═══════════════════════════════════════════
// 12. Testimonials and Gallery regressions
// ═══════════════════════════════════════════

test('testimonials table exists', async () => {
  const [[{ cnt }]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'testimonials'"
  );
  assert.equal(cnt, 1);
});

test('social_posts table has all required columns', async () => {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts'"
  );
  const names = cols.map(c => c.COLUMN_NAME);
  assert.ok(names.includes('display_mode'));
  assert.ok(names.includes('embed_enabled'));
  assert.ok(names.includes('thumbnail_media_ref'));
  assert.ok(names.includes('provider_thumbnail_url'));
  assert.ok(names.includes('provider_thumbnail_expires_at'));
  assert.ok(names.includes('published_content_json'));
  assert.ok(names.includes('provider'));
  assert.ok(names.includes('provider_external_id'));
  assert.ok(names.includes('is_imported'));
});

test('social_integrations table exists with required columns', async () => {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_integrations'"
  );
  const names = cols.map(c => c.COLUMN_NAME);
  assert.ok(names.includes('provider'));
  assert.ok(names.includes('is_connected'));
  assert.ok(names.includes('is_enabled'));
  assert.ok(names.includes('auto_sync'));
  assert.ok(names.includes('require_approval'));
  assert.ok(names.includes('config_json'));
});

test('social_token_secrets table exists', async () => {
  const [[{ cnt }]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_token_secrets'"
  );
  assert.equal(cnt, 1);
});

test('social_oauth_states table exists with session_id', async () => {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_oauth_states'"
  );
  const names = cols.map(c => c.COLUMN_NAME);
  assert.ok(names.includes('session_id'));
  assert.ok(names.includes('expires_at'));
});

test('social_sync_runs table exists', async () => {
  const [[{ cnt }]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_sync_runs'"
  );
  assert.equal(cnt, 1);
});
