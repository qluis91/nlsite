/**
 * Migration 34 — Provider thumbnail metadata on social_posts (Phase 2E-C close).
 *
 * Separates provider-managed thumbnail URLs from local Media Library references.
 * - `provider_thumbnail_url`: external thumbnail URL (expiring, provider-managed)
 * - `provider_thumbnail_expires_at`: when the provider thumbnail expires
 * - `thumbnail_media_ref`: reserved exclusively for Media Library assets
 *
 * Idempotent: checks column existence before adding.
 */
async function migrateSocialPostsProviderThumbnail(pool) {
  const [[colUrl]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_thumbnail_url'"
  );
  if (!colUrl.cnt) {
    await pool.query(
      "ALTER TABLE social_posts ADD COLUMN provider_thumbnail_url VARCHAR(2048) NOT NULL DEFAULT '' AFTER thumbnail_media_ref"
    );
  }

  const [[colExpires]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_thumbnail_expires_at'"
  );
  if (!colExpires.cnt) {
    await pool.query(
      'ALTER TABLE social_posts ADD COLUMN provider_thumbnail_expires_at TIMESTAMP NULL DEFAULT NULL AFTER provider_thumbnail_url'
    );
  }

  console.log('✅ Social posts provider thumbnail columns migration complete.');
}

module.exports = { migrateSocialPostsProviderThumbnail };
