/**
 * Additive migration: category hero fields for store Phase 1.5.
 * Safe to run multiple times. Does not drop or rename columns.
 * Run: node scripts/migrate-category-hero.js
 */
require('dotenv').config();
const pool = require('../config/db');

const HERO_COLUMNS = Object.freeze({
  description: 'VARCHAR(500) NULL AFTER slug',
  hero_title: 'VARCHAR(160) NULL AFTER description',
  hero_description: 'VARCHAR(500) NULL AFTER hero_title',
  hero_image: 'VARCHAR(500) NULL AFTER hero_description',
  hero_alt: 'VARCHAR(200) NULL AFTER hero_image',
  hero_position: "VARCHAR(20) NULL DEFAULT 'center' AFTER hero_alt",
});

async function migrateCategoryHero() {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories'`
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));

  for (const [column, definition] of Object.entries(HERO_COLUMNS)) {
    if (existing.has(column)) {
      console.log(`  skip categories.${column} (exists)`);
      continue;
    }
    await pool.query(`ALTER TABLE categories ADD COLUMN \`${column}\` ${definition}`);
    console.log(`  ✅ Added categories.${column}`);
  }

  console.log('✅ Category hero migration complete.');
}

if (require.main === module) {
  migrateCategoryHero()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Category hero migration failed:', error.message);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { HERO_COLUMNS, migrateCategoryHero };
