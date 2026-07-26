/**
 * Phase 12C — Product & Category SEO columns.
 * Adds seo_title, seo_description, og_image to products and categories.
 * Idempotent — safe to run multiple times.
 *
 * Run: node scripts/migrate-catalog-seo.js
 */
require('dotenv').config();
const pool = require('../config/db');

const COLUMNS = [
  { table: 'products', col: 'seo_title',   type: 'VARCHAR(160) NULL', after: 'description' },
  { table: 'products', col: 'seo_description', type: 'VARCHAR(300) NULL', after: 'seo_title' },
  { table: 'products', col: 'og_image',    type: 'VARCHAR(500) NULL', after: 'seo_description' },
  { table: 'categories', col: 'seo_title',   type: 'VARCHAR(160) NULL', after: 'description' },
  { table: 'categories', col: 'seo_description', type: 'VARCHAR(300) NULL', after: 'seo_title' },
  { table: 'categories', col: 'og_image',    type: 'VARCHAR(500) NULL', after: 'seo_description' },
];

async function migrate() {
  const conn = await pool.getConnection();
  try {
    for (const { table, col, type, after } of COLUMNS) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) c FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, col]
      );
      if (Number(rows[0].c) === 0) {
        await conn.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${type} AFTER ${after}`);
        if (process.env.NODE_ENV !== 'test') console.log(`  ✅ ${table}.${col}`);
      } else if (process.env.NODE_ENV !== 'test') {
        console.log(`  ⏭  ${table}.${col} already exists`);
      }
    }
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('Catalog SEO migration failed:', err.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrate };
