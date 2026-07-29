/**
 * Migration 22 — Category-specific Store heroes (Phase 1G).
 * Additive and idempotent. Existing category hero columns and data are kept.
 * Run: node scripts/migrate-category-store-hero.js
 */
require('dotenv').config();
const defaultPool = require('../config/db');

const CATEGORY_STORE_HERO_COLUMNS = Object.freeze({
  hero_media_ref: 'VARCHAR(500) NULL AFTER hero_image',
  hero_eyebrow: 'VARCHAR(120) NULL AFTER description',
  hero_button_label: 'VARCHAR(80) NULL AFTER hero_position',
  hero_button_url: 'VARCHAR(500) NULL AFTER hero_button_label',
  hero_button_target: "VARCHAR(10) NOT NULL DEFAULT '_self' AFTER hero_button_url",
  hero_custom_enabled: 'TINYINT(1) NOT NULL DEFAULT 0 AFTER hero_button_target',
});

async function migrateCategoryStoreHero(db = defaultPool) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'categories'`
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));

  for (const [column, definition] of Object.entries(CATEGORY_STORE_HERO_COLUMNS)) {
    if (existing.has(column)) continue;
    await db.query(`ALTER TABLE categories ADD COLUMN \`${column}\` ${definition}`);
    existing.add(column);
  }
}

if (require.main === module) {
  migrateCategoryStoreHero()
    .then(() => defaultPool.end())
    .catch(async (error) => {
      console.error('Category Store hero migration failed:', error.message);
      await defaultPool.end();
      process.exitCode = 1;
    });
}

module.exports = {
  CATEGORY_STORE_HERO_COLUMNS,
  migrate: migrateCategoryStoreHero,
  migrateCategoryStoreHero,
};
