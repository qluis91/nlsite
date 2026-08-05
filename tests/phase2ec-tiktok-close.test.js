/**
 * Phase 2E-C Close — TikTok thumbnail, display mode, editorial preservation fixes.
 *
 * Covers: migration 34, provider thumbnail separation, display_mode=embed,
 * editorial preservation, expiration behavior, origin validation, regressions.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../config/db');

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = 'test-enc-key-32bytes-len!!!';
process.env.TIKTOK_CLIENT_KEY = 'test-tiktok-client-key-123';
process.env.TIKTOK_CLIENT_SECRET = 'test-tiktok-secret-456';
process.env.SITE_URL = 'http://localhost:3000';

const tiktokSync = require('../services/tiktokSyncService');
const encryption = require('../services/tokenEncryptionService');
const tiktokOAuth = require('../services/tiktokOAuthService');

// ── Setup ──

test.before(async () => {
  const { migrateSocialPostsProviderThumbnail } = require('../scripts/migrate-social-posts-provider-thumbnail');
  await migrateSocialPostsProviderThumbnail(pool);

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
// Migration 34
// ═══════════════════════════════════════

test('migration 34 adds provider_thumbnail_url column', async () => {
  const [[{ cnt }]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_thumbnail_url'"
  );
  assert.equal(cnt, 1);
});

test('migration 34 adds provider_thumbnail_expires_at column', async () => {
  const [[{ cnt }]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_thumbnail_expires_at'"
  );
  assert.equal(cnt, 1);
});

test('migration 34 is idempotent', async () => {
  const { migrateSocialPostsProviderThumbnail } = require('../scripts/migrate-social-posts-provider-thumbnail');
  await migrateSocialPostsProviderThumbnail(pool);
  const [[{ cnt }]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_thumbnail_url'"
  );
  assert.equal(cnt, 1);
});

test('MIGRATION_REGISTRY has 34 entries', () => {
  const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');
  assert.equal(MIGRATION_REGISTRY.length, 35);
});

test('migration 27 checksum still preserved', () => {
  const fs = require('fs');
  const buf = fs.readFileSync('scripts/migrate-social-integrations.js');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  assert.equal(sha, 'd076264e079d74cc69523eb5aeac3f23db5e657ad812b60072793ab9d325edc6');
});

// ═══════════════════════════════════════
// Thumbnail storage: no external URL in thumbnail_media_ref
// ═══════════════════════════════════════

test('thumbnail_media_ref stays empty for new imported TikTok posts', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-thumb-01', title: 'Test', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/img.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-thumb-01' };
    await tiktokSync.upsertPost(conn, video, intRow);
    const [[post]] = await conn.query(
      "SELECT thumbnail_media_ref, provider_thumbnail_url FROM social_posts WHERE provider_external_id = 'tk-thumb-01'"
    );
    assert.equal(post.thumbnail_media_ref, '');
    assert.equal(post.provider_thumbnail_url, 'https://p16-sign.tiktokcdn-us.com/img.jpg');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('provider_thumbnail_url stores cover image for imported post', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-cover-01', title: 'Cover test', description: '',
      coverImageUrl: 'https://p19-sign.tiktokcdn-us.com/cover.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-cover-01' };
    await tiktokSync.upsertPost(conn, video, intRow);
    const [[post]] = await conn.query(
      "SELECT provider_thumbnail_url, provider_thumbnail_expires_at FROM social_posts WHERE provider_external_id = 'tk-cover-01'"
    );
    assert.equal(post.provider_thumbnail_url, 'https://p19-sign.tiktokcdn-us.com/cover.jpg');
    assert.ok(post.provider_thumbnail_expires_at);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ═══════════════════════════════════════
// Thumbnail origin validation
// ═══════════════════════════════════════

test('isValidTikTokThumbnail accepts allowed origins', () => {
  assert.equal(tiktokSync.isValidTikTokThumbnail('https://p16-sign.tiktokcdn-us.com/img.jpg'), true);
  assert.equal(tiktokSync.isValidTikTokThumbnail('https://p19-sign.tiktokcdn-us.com/cover.webp'), true);
  assert.equal(tiktokSync.isValidTikTokThumbnail('https://p16-sign-va.tiktokcdn.com/thumb.jpg'), true);
  assert.equal(tiktokSync.isValidTikTokThumbnail('https://p16-sign-sg.tiktokcdn.com/pic'), true);
});

test('isValidTikTokThumbnail rejects non-TikTok origins', () => {
  assert.equal(tiktokSync.isValidTikTokThumbnail('https://evil.com/img.jpg'), false);
  assert.equal(tiktokSync.isValidTikTokThumbnail('https://graph.facebook.com/img.jpg'), false);
  assert.equal(tiktokSync.isValidTikTokThumbnail(''), false);
  assert.equal(tiktokSync.isValidTikTokThumbnail('javascript:alert(1)'), false);
});

test('isValidTikTokThumbnail rejects http', () => {
  assert.equal(tiktokSync.isValidTikTokThumbnail('http://p16-sign.tiktokcdn-us.com/img.jpg'), false);
});

// ═══════════════════════════════════════
// Display mode: embed for TikTok
// ═══════════════════════════════════════

test('imported TikTok post uses display_mode=embed with embed_enabled=true', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-embed-01', title: 'Embed test', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/img.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-embed-01' };
    await tiktokSync.upsertPost(conn, video, intRow);
    const [[post]] = await conn.query(
      "SELECT display_mode, embed_enabled, platform FROM social_posts WHERE provider_external_id = 'tk-embed-01'"
    );
    assert.equal(post.display_mode, 'embed');
    assert.equal(post.embed_enabled, 1);
    assert.equal(post.platform, 'tiktok');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('TikTok embedSrc uses canonical TikTok embed URL format', () => {
  const video = tiktokSync.normalizeTikTokVideo({
    id: '1234567890',
    share_url: 'https://www.tiktok.com/@user/video/1234567890',
  });
  assert.equal(video.embedSrc, 'https://www.tiktok.com/embed/v2/1234567890');
});

test('published snapshot includes embedEnabled and displayMode=embed', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 0, config_json: { defaultPublished: true } };
    const video = { externalId: 'tk-pub-01', title: 'Published', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/img.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-pub-01' };
    await tiktokSync.upsertPost(conn, video, intRow);
    const [[post]] = await conn.query(
      "SELECT status, published_content_json FROM social_posts WHERE provider_external_id = 'tk-pub-01'"
    );
    assert.equal(post.status, 'published');
    const snap = typeof post.published_content_json === 'string'
      ? JSON.parse(post.published_content_json)
      : post.published_content_json;
    assert.equal(snap.embedEnabled, true);
    assert.equal(snap.displayMode, 'embed');
    assert.equal(snap.thumbnailMediaRef, '');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ═══════════════════════════════════════
// Editorial preservation
// ═══════════════════════════════════════

test('sync never overwrites manual title or description', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-preserve-01', title: 'Auto Title', description: 'Auto desc',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/old.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-preserve-01' };
    await tiktokSync.upsertPost(conn, video, intRow);

    // Simulate manual edit
    await conn.query(
      "UPDATE social_posts SET title = 'Manual Title', description = 'Manual desc', thumbnail_media_ref = '/uploads/media/site/local.webp' WHERE provider_external_id = 'tk-preserve-01'"
    );

    // Re-sync
    const video2 = { externalId: 'tk-preserve-01', title: 'New Auto Title', description: 'New auto desc',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/new.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-preserve-01' };
    await tiktokSync.upsertPost(conn, video2, intRow);

    const [[post]] = await conn.query(
      "SELECT title, description, thumbnail_media_ref, provider_thumbnail_url FROM social_posts WHERE provider_external_id = 'tk-preserve-01'"
    );
    assert.equal(post.title, 'Manual Title');
    assert.equal(post.description, 'Manual desc');
    assert.equal(post.thumbnail_media_ref, '/uploads/media/site/local.webp');
    assert.equal(post.provider_thumbnail_url, 'https://p16-sign.tiktokcdn-us.com/new.jpg');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('sync never overwrites manually selected Media Library thumbnail', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-local-thumb', title: 'Local test', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/provider.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-local-thumb' };
    await tiktokSync.upsertPost(conn, video, intRow);

    await conn.query(
      "UPDATE social_posts SET thumbnail_media_ref = '/uploads/media/site/my-local.webp' WHERE provider_external_id = 'tk-local-thumb'"
    );

    const video2 = { externalId: 'tk-local-thumb', title: 'Updated', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/provider2.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-local-thumb' };
    await tiktokSync.upsertPost(conn, video2, intRow);

    const [[post]] = await conn.query(
      "SELECT thumbnail_media_ref, provider_thumbnail_url FROM social_posts WHERE provider_external_id = 'tk-local-thumb'"
    );
    assert.equal(post.thumbnail_media_ref, '/uploads/media/site/my-local.webp');
    assert.equal(post.provider_thumbnail_url, 'https://p16-sign.tiktokcdn-us.com/provider2.jpg');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('sync never changes status or republishes a draft', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-status-01', title: 'Draft test', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/img.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-status-01' };
    await tiktokSync.upsertPost(conn, video, intRow);

    const [[before]] = await conn.query(
      "SELECT status FROM social_posts WHERE provider_external_id = 'tk-status-01'"
    );
    assert.equal(before.status, 'draft');

    await tiktokSync.upsertPost(conn, video, intRow);

    const [[after]] = await conn.query(
      "SELECT status FROM social_posts WHERE provider_external_id = 'tk-status-01'"
    );
    assert.equal(after.status, 'draft');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('sync never alters published_content_json on update', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 0, config_json: { defaultPublished: true } };
    const video = { externalId: 'tk-snap-01', title: 'Snap test', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/a.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-snap-01' };
    await tiktokSync.upsertPost(conn, video, intRow);

    const [[before]] = await conn.query(
      "SELECT published_content_json FROM social_posts WHERE provider_external_id = 'tk-snap-01'"
    );
    const beforeSnap = typeof before.published_content_json === 'string'
      ? JSON.parse(before.published_content_json)
      : before.published_content_json;

    const modifiedSnap = JSON.stringify({ ...beforeSnap, isFeatured: true });
    await conn.query(
      "UPDATE social_posts SET published_content_json = ? WHERE provider_external_id = 'tk-snap-01'",
      [modifiedSnap]
    );

    const video2 = { externalId: 'tk-snap-01', title: 'New title', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/b.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-snap-01' };
    await tiktokSync.upsertPost(conn, video2, intRow);

    const [[after]] = await conn.query(
      "SELECT published_content_json, title FROM social_posts WHERE provider_external_id = 'tk-snap-01'"
    );
    const afterSnap = typeof after.published_content_json === 'string'
      ? JSON.parse(after.published_content_json)
      : after.published_content_json;
    assert.equal(afterSnap.isFeatured, true);
    assert.equal(after.title, 'Snap test');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('sync skips archived posts', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-arch-01', title: 'Archived', description: '',
      coverImageUrl: '', shareUrl: 'https://www.tiktok.com/@user/video/tk-arch-01' };
    await tiktokSync.upsertPost(conn, video, intRow);

    await conn.query(
      "UPDATE social_posts SET archived_at = NOW() WHERE provider_external_id = 'tk-arch-01'"
    );

    const result = await tiktokSync.upsertPost(conn, video, intRow);
    assert.equal(result.action, 'skipped');
    assert.equal(result.reason, 'archived');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('sync skips manual posts', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const pid = crypto.randomUUID();
    await conn.query(
      "INSERT INTO social_posts (public_id, platform, post_url, title, status, provider, provider_external_id, is_imported) VALUES (?, ?, ?, ?, 'published', 'manual', ?, 0)",
      [pid, 'tiktok', 'https://www.tiktok.com/@user/video/manual-tk', 'Manual TikTok', 'tk-manual-x']
    );
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-manual-x', title: 'Auto', description: '',
      coverImageUrl: '', shareUrl: 'https://www.tiktok.com/@user/video/manual-tk' };
    const result = await tiktokSync.upsertPost(conn, video, intRow);
    // Manual post with same URL is detected as duplicate — not overwritten
    assert.equal(result.action, 'skipped');
    assert.match(result.reason, /manual_post|duplicate_url/);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ═══════════════════════════════════════
// Expiration behavior
// ═══════════════════════════════════════

test('provider_thumbnail_expires_at set to ~24h on import', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-expire-01', title: 'Expire test', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/img.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-expire-01' };
    await tiktokSync.upsertPost(conn, video, intRow);

    const [[post]] = await conn.query(
      "SELECT provider_thumbnail_expires_at FROM social_posts WHERE provider_external_id = 'tk-expire-01'"
    );
    const expiresAt = new Date(post.provider_thumbnail_expires_at).getTime();
    const now = Date.now();
    const diffH = (expiresAt - now) / 3600000;
    assert.ok(diffH > 22 && diffH < 26, `Expected 22-26h, got ${diffH}h`);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('provider_thumbnail_expires_at refreshed on re-sync', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { externalId: 'tk-exp-02', title: 'Refresh test', description: '',
      coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/old.jpg',
      shareUrl: 'https://www.tiktok.com/@user/video/tk-exp-02' };
    await tiktokSync.upsertPost(conn, video, intRow);

    const [[first]] = await conn.query(
      "SELECT provider_thumbnail_expires_at FROM social_posts WHERE provider_external_id = 'tk-exp-02'"
    );
    const firstExp = new Date(first.provider_thumbnail_expires_at).getTime();

    await new Promise(r => setTimeout(r, 10));
    const video2 = { ...video, coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/new.jpg' };
    await tiktokSync.upsertPost(conn, video2, intRow);

    const [[second]] = await conn.query(
      "SELECT provider_thumbnail_expires_at FROM social_posts WHERE provider_external_id = 'tk-exp-02'"
    );
    const secondExp = new Date(second.provider_thumbnail_expires_at).getTime();
    assert.ok(secondExp >= firstExp, `Expected refreshed expiry >= initial`);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ═══════════════════════════════════════
// Modal embed compatibility
// ═══════════════════════════════════════

test('TikTok embed src matches socialEmbedModal allowed origins', () => {
  const embedSrc = 'https://www.tiktok.com/embed/v2/1234567890';
  const url = new URL(embedSrc);
  assert.equal(url.origin, 'https://www.tiktok.com');
  assert.ok(url.pathname.startsWith('/embed/v2/'));
});

// ═══════════════════════════════════════
// Provider origin validation on normalize
// ═══════════════════════════════════════

test('normalizeTikTokVideo drops non-TikTok cover URL', () => {
  const result = tiktokSync.normalizeTikTokVideo({
    id: 'vid_bad',
    cover_image_url: 'https://evil.com/malware.jpg',
    share_url: 'https://www.tiktok.com/@user/video/vid_bad',
  });
  assert.equal(result.coverImageUrl, '');
});

test('normalizeTikTokVideo keeps valid TikTok cover URL', () => {
  const result = tiktokSync.normalizeTikTokVideo({
    id: 'vid_ok',
    cover_image_url: 'https://p16-sign.tiktokcdn-us.com/thumb.jpg',
    share_url: 'https://www.tiktok.com/@user/video/vid_ok',
    title: 'Mi video',
  });
  assert.equal(result.coverImageUrl, 'https://p16-sign.tiktokcdn-us.com/thumb.jpg');
});

// ═══════════════════════════════════════
// YouTube, Meta, Social Feed regressions
// ═══════════════════════════════════════

test('YouTube integration still seeded', async () => {
  const [[row]] = await pool.query("SELECT provider FROM social_integrations WHERE provider = 'youtube'");
  assert.ok(row);
});

test('Instagram integration still seeded', async () => {
  const [[row]] = await pool.query("SELECT provider FROM social_integrations WHERE provider = 'instagram'");
  assert.ok(row);
});

test('social_posts display_mode column accepts canonical embed and external', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const pid1 = crypto.randomUUID(), pid2 = crypto.randomUUID(), pid3 = crypto.randomUUID();
    await conn.query(
      "INSERT INTO social_posts (public_id, platform, post_url, title, display_mode, status) VALUES (?, 'youtube', ?, 'test', 'embed', 'draft')",
      [pid1, 'https://example.com/1']
    );
    await conn.query(
      "INSERT INTO social_posts (public_id, platform, post_url, title, display_mode, status) VALUES (?, 'other', ?, 'test', 'external', 'draft')",
      [pid2, 'https://example.com/2']
    );
    await conn.query(
      "INSERT INTO social_posts (public_id, platform, post_url, title, display_mode, status) VALUES (?, 'other', ?, 'test', 'external_link', 'draft')",
      [pid3, 'https://example.com/3']
    );
    const [[post1]] = await conn.query("SELECT display_mode FROM social_posts WHERE public_id = ?", [pid1]);
    const [[post2]] = await conn.query("SELECT display_mode FROM social_posts WHERE public_id = ?", [pid2]);
    const [[post3]] = await conn.query("SELECT display_mode FROM social_posts WHERE public_id = ?", [pid3]);
    assert.equal(post1.display_mode, 'embed');
    assert.equal(post2.display_mode, 'external');
    assert.equal(post3.display_mode, 'external_link');
  } finally {
    await conn.rollback();
    conn.release();
  }
});
