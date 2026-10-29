/**
 * Forward migration — gallery thumbnail framing columns + spaced sort_order.
 *
 * Adds thumbnail_position_x/y and thumbnail_zoom_percent with safe defaults.
 * Normalizes existing gallery_items.sort_order to 10,20,30… preserving the
 * current effective visual order. Idempotent column adds; sort rewrite is
 * deterministic from current ordering.
 */
const defaultPool = require('../config/db');

const TABLE = 'gallery_items';
const COLUMN_DEFINITIONS = Object.freeze({
  thumbnail_position_x: 'SMALLINT UNSIGNED NOT NULL DEFAULT 50 AFTER alt_text',
  thumbnail_position_y: 'SMALLINT UNSIGNED NOT NULL DEFAULT 50 AFTER thumbnail_position_x',
  thumbnail_zoom_percent: 'SMALLINT UNSIGNED NOT NULL DEFAULT 100 AFTER thumbnail_position_y',
});

async function ensureFramingColumns(connection) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [TABLE]
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME || row.column_name));

  for (const [column, definition] of Object.entries(COLUMN_DEFINITIONS)) {
    if (existing.has(column)) continue;
    await connection.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`${column}\` ${definition}`);
    existing.add(column);
  }
}

async function normalizeSortOrders(connection) {
  await connection.beginTransaction();
  try {
    const [items] = await connection.query(
      `SELECT id
         FROM \`${TABLE}\`
        ORDER BY is_featured DESC, sort_order ASC, created_at DESC, id DESC
        FOR UPDATE`
    );

    let next = 10;
    for (const item of items) {
      await connection.query(
        `UPDATE \`${TABLE}\` SET sort_order = ? WHERE id = ?`,
        [next, item.id]
      );
      next += 10;
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function migrateGalleryThumbnailFraming(pool = defaultPool) {
  const connection = await pool.getConnection();
  try {
    await ensureFramingColumns(connection);
    await normalizeSortOrders(connection);
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  migrateGalleryThumbnailFraming()
    .then(() => defaultPool.end())
    .then(() => console.log('Gallery thumbnail framing migration complete.'))
    .catch(async (error) => {
      console.error(`[${error.code || 'MIGRATION_ERROR'}] ${error.message}`);
      await defaultPool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  COLUMN_DEFINITIONS,
  migrateGalleryThumbnailFraming,
  ensureFramingColumns,
  normalizeSortOrders,
};
