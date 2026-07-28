/**
 * Additive CMS draft/published snapshot migration.
 *
 * Existing editable columns remain the draft workspace. Public rendering reads
 * the published snapshot columns, which are only replaced by an explicit
 * publish operation.
 */
const pool = require('../config/db');

const COLUMN_DEFINITIONS = Object.freeze({
  page_sections: Object.freeze({
    published_content_json: 'JSON NULL',
    published_style_json: 'JSON NULL',
    published_at: 'DATETIME NULL',
  }),
  site_settings: Object.freeze({
    published_value: 'LONGTEXT NULL',
    has_unpublished_changes: 'TINYINT(1) NOT NULL DEFAULT 0',
    published_at: 'DATETIME NULL',
  }),
  navigation_items: Object.freeze({
    published_data: 'JSON NULL',
    published_at: 'DATETIME NULL',
  }),
  logo_loop_items: Object.freeze({
    published_data: 'JSON NULL',
    published_at: 'DATETIME NULL',
  }),
  home_carousel_items: Object.freeze({
    published_data: 'JSON NULL',
    published_at: 'DATETIME NULL',
  }),
  home_feature_items: Object.freeze({
    published_data: 'JSON NULL',
    published_at: 'DATETIME NULL',
  }),
});

const SNAPSHOT_FIELDS = Object.freeze({
  navigation_items: Object.freeze([
    'label', 'url', 'link_type', 'target', 'media_public_id', 'sort_order', 'is_visible',
  ]),
  logo_loop_items: Object.freeze([
    'item_type', 'text_content', 'media_public_id', 'url', 'link_type', 'target',
    'alt_text', 'sort_order', 'is_visible',
  ]),
  home_carousel_items: Object.freeze([
    'eyebrow', 'title', 'description', 'button_label', 'button_url', 'button_target',
    'media_public_id', 'preview_media_public_id', 'theme_key', 'sort_order', 'is_visible',
  ]),
  home_feature_items: Object.freeze([
    'title', 'description', 'detail_text', 'icon_type', 'icon_key', 'media_public_id',
    'url', 'link_type', 'target', 'style_variant', 'sort_order', 'is_visible',
  ]),
});

async function columnExists(table, column) {
  const [[row]] = await pool.query(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [table, column]
  );
  return Boolean(row);
}

async function addMissingColumns() {
  for (const [table, columns] of Object.entries(COLUMN_DEFINITIONS)) {
    for (const [column, definition] of Object.entries(columns)) {
      if (!(await columnExists(table, column))) {
        await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      }
    }
  }
}

function snapshot(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

async function backfillPublishedSnapshots() {
  await pool.query(
    `UPDATE page_sections
        SET published_content_json = content_json,
            published_style_json = style_json,
            published_at = COALESCE(published_at, updated_at)
      WHERE status = 'published' AND published_content_json IS NULL`
  );
  await pool.query(
    `UPDATE site_settings
        SET published_value = setting_value,
            has_unpublished_changes = 0,
            published_at = COALESCE(published_at, updated_at)
      WHERE published_value IS NULL`
  );

  for (const [table, fields] of Object.entries(SNAPSHOT_FIELDS)) {
    const [rows] = await pool.query(
      `SELECT * FROM \`${table}\`
        WHERE status = 'published' AND published_data IS NULL AND deleted_at IS NULL`
    );
    for (const row of rows) {
      await pool.query(
        `UPDATE \`${table}\`
            SET published_data = ?, published_at = COALESCE(published_at, updated_at)
          WHERE id = ?`,
        [JSON.stringify(snapshot(row, fields)), row.id]
      );
    }
  }
}

async function migrateCmsDraftPublish() {
  await addMissingColumns();
  await backfillPublishedSnapshots();
}

if (require.main === module) {
  migrateCmsDraftPublish()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('CMS draft/publish migration failed:', error.message);
      await pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  COLUMN_DEFINITIONS,
  SNAPSHOT_FIELDS,
  migrateCmsDraftPublish,
};
