/**
 * Forward migration — persist Meta provider thumbnails on social_posts.
 *
 * Adds provider_thumbnail_local_path (storage-relative WebP path under
 * UPLOAD_PUBLIC_ROOT/social/{instagram|facebook}/). Idempotent.
 */
async function migrateSocialProviderThumbnailCache(pool) {
  const [[col]] = await pool.query(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'social_posts'
        AND COLUMN_NAME = 'provider_thumbnail_local_path'`
  );
  if (!col.cnt) {
    await pool.query(
      `ALTER TABLE social_posts
         ADD COLUMN provider_thumbnail_local_path VARCHAR(500) NOT NULL DEFAULT ''
         AFTER provider_thumbnail_expires_at`
    );
  }

  console.log('✅ Social provider thumbnail local cache column migration complete.');
}

module.exports = { migrateSocialProviderThumbnailCache };
