/**
 * Migration 24 — Social Feed (Phase 2A)
 * Creates the social_posts table for manually curated social media posts.
 * Additive, idempotent. Run: node scripts/migrate-social-feed.js
 */
require('dotenv').config();
const pool = require('../config/db');

async function migrateSocialFeed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      public_id     VARCHAR(36)  NOT NULL,
      platform      VARCHAR(20)  NOT NULL DEFAULT 'other',
      post_url      VARCHAR(2048) NOT NULL DEFAULT '',
      title         VARCHAR(300) NOT NULL DEFAULT '',
      description   VARCHAR(500) NOT NULL DEFAULT '',
      thumbnail_media_ref VARCHAR(255) NOT NULL DEFAULT '',
      embed_enabled TINYINT(1)   NOT NULL DEFAULT 0,
      display_mode  VARCHAR(20)  NOT NULL DEFAULT 'external_link',
      is_active     TINYINT(1)   NOT NULL DEFAULT 1,
      is_featured   TINYINT(1)   NOT NULL DEFAULT 0,
      sort_order    INT          NOT NULL DEFAULT 0,
      status        VARCHAR(20)  NOT NULL DEFAULT 'draft',
      published_content_json JSON NULL,
      created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      published_at  TIMESTAMP    NULL DEFAULT NULL,
      created_by    INT          NULL,
      updated_by    INT          NULL,
      archived_at   TIMESTAMP    NULL DEFAULT NULL,
      UNIQUE KEY uk_social_posts_public_id (public_id),
      INDEX idx_social_posts_platform (platform),
      INDEX idx_social_posts_status (status),
      INDEX idx_social_posts_sort (sort_order),
      INDEX idx_social_posts_featured (is_featured)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('✅ Social feed migration complete.');
}

if (require.main === module) {
  migrateSocialFeed()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Social feed migration failed:', error.message);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { migrate: migrateSocialFeed, migrateSocialFeed };
