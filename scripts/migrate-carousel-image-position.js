/**
 * Migration 35 — focal position for existing home carousel items.
 *
 * Draft authority lives in position_x / position_y. Published authority lives
 * in the existing published_data JSON snapshot. Column creation is independently
 * idempotent; snapshot backfill is transactional and preserves unknown keys.
 */
const defaultPool = require('../config/db');
const { normalizePosition } = require('../public/js/admin/carousel-image-position');

const TABLE = 'home_carousel_items';
const COLUMN_DEFINITIONS = Object.freeze({
  position_x: 'TINYINT UNSIGNED NOT NULL DEFAULT 50 AFTER preview_media_alt',
  position_y: 'TINYINT UNSIGNED NOT NULL DEFAULT 50 AFTER position_x',
});

function parsePublishedSnapshot(value, itemId) {
  if (value === null || value === undefined) return null;
  var parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (cause) {
      const error = new Error(`Malformed published_data for ${TABLE}.id=${itemId}`);
      error.code = 'CMS_CAROUSEL_POSITION_MALFORMED_PUBLISHED_DATA';
      error.cause = cause;
      throw error;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error(`Invalid published_data object for ${TABLE}.id=${itemId}`);
    error.code = 'CMS_CAROUSEL_POSITION_MALFORMED_PUBLISHED_DATA';
    throw error;
  }
  return parsed;
}

async function migrateCarouselImagePosition(pool = defaultPool) {
  const connection = await pool.getConnection();
  try {
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

    await connection.beginTransaction();
    try {
      const [items] = await connection.query(
        `SELECT id, published_data FROM \`${TABLE}\` WHERE published_data IS NOT NULL FOR UPDATE`
      );
      for (const item of items) {
        const snapshot = parsePublishedSnapshot(item.published_data, item.id);
        const merged = {
          ...snapshot,
          position_x: normalizePosition(snapshot.position_x),
          position_y: normalizePosition(snapshot.position_y),
        };
        await connection.query(
          `UPDATE \`${TABLE}\` SET published_data = ? WHERE id = ?`,
          [JSON.stringify(merged), item.id]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  migrateCarouselImagePosition()
    .then(() => defaultPool.end())
    .then(() => console.log('Carousel image position migration complete.'))
    .catch(async (error) => {
      console.error(`[${error.code || 'MIGRATION_ERROR'}] ${error.message}`);
      await defaultPool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  COLUMN_DEFINITIONS,
  migrateCarouselImagePosition,
  parsePublishedSnapshot,
};
