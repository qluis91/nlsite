require('dotenv').config();
const pool = require('../config/db');

const GALLERY_MIGRATIONS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS gallery_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(180) NOT NULL,
    description VARCHAR(1000) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_gallery_categories_slug (slug),
    KEY idx_gallery_categories_active_order (is_active, sort_order, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS gallery_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NULL,
    title VARCHAR(160) NOT NULL,
    slug VARCHAR(180) NOT NULL,
    description TEXT NULL,
    media_type VARCHAR(10) NOT NULL,
    media_path VARCHAR(500) NOT NULL,
    thumbnail_path VARCHAR(500) NOT NULL,
    poster_path VARCHAR(500) NULL,
    alt_text VARCHAR(300) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_featured TINYINT(1) NOT NULL DEFAULT 0,
    is_published TINYINT(1) NOT NULL DEFAULT 0,
    published_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_gallery_items_slug (slug),
    KEY idx_gallery_items_category (category_id),
    KEY idx_gallery_items_type (media_type),
    KEY idx_gallery_items_published_order (is_published, is_featured, sort_order, published_at, id),
    KEY idx_gallery_items_featured (is_featured),
    CONSTRAINT fk_gallery_items_category
      FOREIGN KEY (category_id) REFERENCES gallery_categories(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]);

async function migrateGallery() {
  for (const statement of GALLERY_MIGRATIONS) {
    await pool.query(statement);
  }
  console.log('Gallery migration complete.');
}

if (require.main === module) {
  migrateGallery()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Gallery migration failed:', error.message);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { GALLERY_MIGRATIONS, migrateGallery };
