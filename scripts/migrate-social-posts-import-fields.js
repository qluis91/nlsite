/**
 * Migration 29 — Add provider import fields to social_posts (Phase 2E-A).
 * Idempotent: only adds columns if they don't exist.
 */
async function migrateSocialPostsImportFields(pool) {
  // Check and add provider column
  const [[col1]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider'"
  );
  if (!col1.cnt) {
    await pool.query("ALTER TABLE social_posts ADD COLUMN provider VARCHAR(20) NOT NULL DEFAULT 'manual'");
  }

  // Check and add provider_external_id column
  const [[col2]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_external_id'"
  );
  if (!col2.cnt) {
    await pool.query("ALTER TABLE social_posts ADD COLUMN provider_external_id VARCHAR(100) NULL");
    await pool.query("ALTER TABLE social_posts ADD UNIQUE INDEX uk_social_posts_provider_ext (provider, provider_external_id)");
  }

  // Check and add provider_synced_at column
  const [[col3]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_synced_at'"
  );
  if (!col3.cnt) {
    await pool.query("ALTER TABLE social_posts ADD COLUMN provider_synced_at TIMESTAMP NULL DEFAULT NULL");
  }

  // Check and add is_imported column
  const [[col4]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'is_imported'"
  );
  if (!col4.cnt) {
    await pool.query("ALTER TABLE social_posts ADD COLUMN is_imported TINYINT(1) NOT NULL DEFAULT 0");
  }

  console.log('✅ Social posts import fields migration complete.');
}

module.exports = { migrateSocialPostsImportFields };
