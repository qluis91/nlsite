/**
 * Phase 11A — CMS foundation migration ("Administrar página").
 *
 * Creates media_assets, pages, page_sections, content_revisions and extends the
 * pre-existing site_settings table additively. Idempotent and non-destructive:
 * no DROP, no column removal, no type narrowing.
 *
 * Rollback notes: this migration only adds tables and nullable columns, so a
 * rollback is never performed automatically. To undo it manually, drop the four
 * new tables and the added site_settings columns after taking a backup; the
 * public site keeps working because every panel still renders hardcoded
 * fallbacks in Phase 11A.
 *
 * Run: node scripts/migrate-cms.js
 */
require('dotenv').config();
const pool = require('../config/db');

const MEDIA_ASSETS_SQL = `CREATE TABLE IF NOT EXISTS media_assets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL COMMENT 'Stable UUID used in admin URLs and content references',
  filename VARCHAR(255) NOT NULL COMMENT 'Server-generated collision-resistant name',
  original_name VARCHAR(255) NULL COMMENT 'Browser-supplied name, metadata only',
  storage_disk VARCHAR(30) NOT NULL DEFAULT 'public',
  storage_path VARCHAR(500) NOT NULL COMMENT 'Path relative to the media root',
  public_url VARCHAR(500) NOT NULL,
  thumbnail_path VARCHAR(500) NULL COMMENT 'Public URL of the grid thumbnail',
  variants_json JSON NULL COMMENT 'Generated derivative variants',
  mime_type VARCHAR(100) NOT NULL,
  extension VARCHAR(10) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  width INT NULL,
  height INT NULL,
  model_metadata JSON NULL COMMENT 'GLB header metadata when applicable',
  checksum CHAR(64) NOT NULL COMMENT 'SHA-256 of the uploaded bytes',
  title VARCHAR(150) NULL,
  alt_text VARCHAR(250) NULL,
  description VARCHAR(2000) NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'other',
  status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active | archived | processing | failed',
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL COMMENT 'Soft deletion marker',
  UNIQUE KEY uq_media_assets_public_id (public_id),
  UNIQUE KEY uq_media_assets_storage_path (storage_path),
  KEY idx_media_assets_category_status (category, status, deleted_at),
  KEY idx_media_assets_status_created (status, created_at),
  KEY idx_media_assets_checksum (checksum),
  KEY idx_media_assets_creator (created_by),
  KEY idx_media_assets_title (title),
  CONSTRAINT fk_media_assets_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_media_assets_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const PAGES_SQL = `CREATE TABLE IF NOT EXISTS pages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page_key VARCHAR(60) NOT NULL COMMENT 'Stable internal key, e.g. home',
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'published' COMMENT 'draft | published | archived',
  published_version INT NOT NULL DEFAULT 1,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pages_page_key (page_key),
  UNIQUE KEY uq_pages_slug (slug),
  KEY idx_pages_status (status),
  CONSTRAINT fk_pages_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_pages_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const PAGE_SECTIONS_SQL = `CREATE TABLE IF NOT EXISTS page_sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page_id INT NOT NULL,
  section_key VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  content_json JSON NULL COMMENT 'Validated section-specific configuration',
  style_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT 'draft | published | archived',
  version INT NOT NULL DEFAULT 1,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_page_sections_page_section (page_id, section_key),
  KEY idx_page_sections_page_order (page_id, sort_order, id),
  KEY idx_page_sections_status (status, is_enabled),
  CONSTRAINT fk_page_sections_page FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
  CONSTRAINT fk_page_sections_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_page_sections_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const SITE_SETTINGS_SQL = `CREATE TABLE IF NOT EXISTS site_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT,
  value_type VARCHAR(20) NOT NULL DEFAULT 'string' COMMENT 'string | number | boolean | json | media',
  setting_group VARCHAR(40) NOT NULL DEFAULT 'general',
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/** Additive columns for installations created before Phase 11A. */
const SITE_SETTINGS_COLUMNS = Object.freeze({
  value_type: "VARCHAR(20) NOT NULL DEFAULT 'string' AFTER setting_value",
  setting_group: "VARCHAR(40) NOT NULL DEFAULT 'general' AFTER value_type",
  is_public: 'TINYINT(1) NOT NULL DEFAULT 0 AFTER setting_group',
  updated_by: 'INT NULL AFTER is_public',
  created_at: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER updated_by',
});

const CONTENT_REVISIONS_SQL = `CREATE TABLE IF NOT EXISTS content_revisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL COMMENT 'media_asset | page | page_section | site_setting',
  entity_id BIGINT NOT NULL,
  revision_number INT NOT NULL,
  action VARCHAR(30) NOT NULL COMMENT 'upload | metadata_edit | replace | archive | restore',
  previous_data JSON NULL COMMENT 'Safe metadata snapshot, never file contents',
  new_data JSON NULL,
  change_summary VARCHAR(300) NULL,
  changed_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_content_revisions_entity_revision (entity_type, entity_id, revision_number),
  KEY idx_content_revisions_entity_created (entity_type, entity_id, created_at),
  KEY idx_content_revisions_actor (changed_by),
  CONSTRAINT fk_content_revisions_actor FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const CMS_MIGRATIONS = Object.freeze([
  ['media_assets', MEDIA_ASSETS_SQL],
  ['pages', PAGES_SQL],
  ['page_sections', PAGE_SECTIONS_SQL],
  ['site_settings', SITE_SETTINGS_SQL],
  ['content_revisions', CONTENT_REVISIONS_SQL],
]);

/** Home page seed. Sections stay disabled drafts so hardcoded output wins. */
const HOME_PAGE_SEED = Object.freeze({
  page_key: 'home',
  name: 'Inicio',
  slug: 'home',
  status: 'published',
});

const HOME_SECTION_SEEDS = Object.freeze([
  { section_key: 'hero', name: 'Panel 1 — Hero', sort_order: 1 },
  { section_key: 'showcase', name: 'Panel 2 — Showcase', sort_order: 2 },
  { section_key: 'services', name: 'Panel 3 — Servicios', sort_order: 3 },
]);

async function hasColumn(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

/**
 * Seeds only missing records. Existing page/section content is never
 * overwritten so production edits from later phases survive re-runs.
 */
async function seedHomePage(connection) {
  await connection.query(
    `INSERT INTO pages (page_key, name, slug, status)
     SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM pages WHERE page_key = ?)`,
    [HOME_PAGE_SEED.page_key, HOME_PAGE_SEED.name, HOME_PAGE_SEED.slug, HOME_PAGE_SEED.status, HOME_PAGE_SEED.page_key]
  );
  const [[page]] = await connection.query('SELECT id FROM pages WHERE page_key = ? LIMIT 1', [HOME_PAGE_SEED.page_key]);
  if (!page) throw new Error('No fue posible preparar la página "home".');

  for (const section of HOME_SECTION_SEEDS) {
    await connection.query(
      `INSERT INTO page_sections (page_id, section_key, name, content_json, style_json, sort_order, is_enabled, status, version)
       SELECT ?, ?, ?, NULL, NULL, ?, 0, 'draft', 1
        WHERE NOT EXISTS (SELECT 1 FROM page_sections WHERE page_id = ? AND section_key = ?)`,
      [page.id, section.section_key, section.name, section.sort_order, page.id, section.section_key]
    );
  }
  return page.id;
}

async function migrateCms() {
  const connection = await pool.getConnection();
  try {
    for (const [name, sql] of CMS_MIGRATIONS) {
      await connection.query(sql);
      if (process.env.NODE_ENV !== 'test') console.log(`  ✅ ${name}`);
    }

    for (const [column, definition] of Object.entries(SITE_SETTINGS_COLUMNS)) {
      if (await hasColumn(connection, 'site_settings', column)) continue;
      await connection.query(`ALTER TABLE site_settings ADD COLUMN \`${column}\` ${definition}`);
      if (process.env.NODE_ENV !== 'test') console.log(`  ✅ site_settings.${column}`);
    }

    // Seeding is transactional; DDL above cannot participate in a transaction.
    await connection.beginTransaction();
    try {
      await seedHomePage(connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    if (process.env.NODE_ENV !== 'test') console.log('✅ CMS (Phase 11A) migration complete.');
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  console.log('Applying CMS migrations…');
  migrateCms()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('CMS migration failed:', error.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = {
  CMS_MIGRATIONS,
  SITE_SETTINGS_COLUMNS,
  HOME_PAGE_SEED,
  HOME_SECTION_SEEDS,
  migrateCms,
};
