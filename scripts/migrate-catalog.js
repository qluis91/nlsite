/**
 * Safe migration: creates catalog tables without destroying existing data.
 * Run: node scripts/migrate-catalog.js
 */
require('dotenv').config();
const pool = require('../config/db');

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description VARCHAR(500) NULL,
    hero_title VARCHAR(160) NULL,
    hero_description VARCHAR(500) NULL,
    hero_image VARCHAR(500) NULL,
    hero_alt VARCHAR(200) NULL,
    hero_position VARCHAR(20) NULL DEFAULT 'center',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(180) NOT NULL UNIQUE,
    regular_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    promotional_price DECIMAL(10,2) NULL,
    web_price DECIMAL(10,2) NULL,
    weight INT NULL COMMENT 'grams',
    stock_quantity INT NOT NULL DEFAULT 0,
    description TEXT NULL,
    tags JSON NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_published TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_products_slug (slug),
    INDEX idx_products_active (is_active),
    INDEX idx_products_published (is_published)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS product_categories (
    product_id INT NOT NULL,
    category_id INT NOT NULL,
    PRIMARY KEY (product_id, category_id),
    CONSTRAINT fk_pc_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_pc_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(50) NOT NULL DEFAULT 'image/webp',
    width INT NULL,
    height INT NULL,
    size_bytes INT NULL,
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_pi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_pi_product_position (product_id, position),
    INDEX idx_pi_product_primary (product_id, is_primary)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function migrateCatalog() {
  console.log('Applying catalog migrations…');
  for (const sql of MIGRATIONS) {
    await pool.query(sql);
  }
  console.log('✅ Catalog tables ready.');
}

if (require.main === module) {
  const MysqlPool = require('../config/db');
  migrateCatalog()
    .then(() => { MysqlPool.end().catch(() => {}); process.exit(0); })
    .catch(err => { console.error('❌ Failed:', err.message); MysqlPool.end().catch(() => {}); process.exit(1); });
}

module.exports = { MIGRATIONS, migrateCatalog };
