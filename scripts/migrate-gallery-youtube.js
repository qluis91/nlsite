/**
 * Idempotent migration: add youtube_url and custom_cover_path to gallery_items.
 * Safe to run multiple times.
 */
async function migrate() {
  const pool = require('../config/db');
  const columns = [
    { name: 'youtube_url',          def: 'VARCHAR(500) NULL' },
    { name: 'custom_cover_path',    def: 'VARCHAR(500) NULL' },
  ];
  for (const col of columns) {
    const [[exists]] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'gallery_items'
          AND COLUMN_NAME = ?`,
      [col.name]
    );
    if (!exists) {
      await pool.query(
        `ALTER TABLE gallery_items ADD COLUMN ${col.name} ${col.def}`
      );
    }
  }
}

module.exports = { migrate };
