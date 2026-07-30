/**
 * Migration 26 — Testimonials (Phase 2D)
 * Creates the testimonials table for manually curated customer reviews.
 * Additive, idempotent. Run: node scripts/migrate-testimonials.js
 */
require('dotenv').config();
const pool = require('../config/db');

async function migrateTestimonials() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      public_id     VARCHAR(36)  NOT NULL,
      display_name  VARCHAR(200) NOT NULL DEFAULT '',
      testimonial_text TEXT      NOT NULL,
      platform      VARCHAR(20)  NOT NULL DEFAULT 'other',
      source_url    VARCHAR(2048) NOT NULL DEFAULT '',
      avatar_media_ref VARCHAR(255) NOT NULL DEFAULT '',
      rating        TINYINT UNSIGNED NULL DEFAULT NULL,
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
      UNIQUE KEY uk_testimonials_public_id (public_id),
      INDEX idx_testimonials_platform (platform),
      INDEX idx_testimonials_status (status),
      INDEX idx_testimonials_sort (sort_order),
      INDEX idx_testimonials_featured (is_featured),
      INDEX idx_testimonials_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('✅ Testimonials migration complete.');
}

if (require.main === module) {
  migrateTestimonials()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Testimonials migration failed:', error.message);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { migrate: migrateTestimonials, migrateTestimonials };
