/**
 * CMS content read service — Phase 11A foundation.
 *
 * Reusable by later phases (navbar and global settings, Panel 1, Panel 2,
 * Panel 3). Every getter takes a fallback and returns it whenever the CMS has
 * no published value, so the public site keeps rendering its current hardcoded
 * content until each section is migrated deliberately.
 */
const pool = require('../config/db');
const storage = require('./mediaStorageService');
const { CONTENT_STATUSES } = require('../config/cmsOptions');
const { REFERENCE_SCHEME } = require('./mediaUsageService');

function parseJsonColumn(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function getPage(pageKey) {
  const [rows] = await pool.query(
    'SELECT id, page_key, name, slug, status, published_version FROM pages WHERE page_key = ? LIMIT 1',
    [String(pageKey || '')]
  );
  return rows[0] || null;
}

async function listSections(pageKey) {
  const [rows] = await pool.query(
    `SELECT s.id, s.section_key, s.name, s.content_json, s.style_json, s.sort_order,
            s.is_enabled, s.status, s.version
       FROM page_sections s
       INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = ?
      ORDER BY s.sort_order ASC, s.id ASC`,
    [String(pageKey || '')]
  );
  return rows.map((row) => ({
    ...row,
    content: parseJsonColumn(row.content_json),
    style: parseJsonColumn(row.style_json),
  }));
}

/**
 * Published + enabled section content, or the caller's fallback.
 * Phase 11A seeds sections as disabled drafts, so this always returns the
 * fallback until a later phase publishes real content.
 */
async function getPublishedSectionContent(pageKey, sectionKey, fallback = null) {
  const [rows] = await pool.query(
    `SELECT s.content_json
       FROM page_sections s
       INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = ? AND s.section_key = ? AND s.is_enabled = 1 AND s.status = ?
      LIMIT 1`,
    [String(pageKey || ''), String(sectionKey || ''), CONTENT_STATUSES.PUBLISHED]
  );
  const content = parseJsonColumn(rows[0]?.content_json);
  return content === null ? fallback : content;
}

async function getSetting(settingKey, fallback = null) {
  const [rows] = await pool.query(
    'SELECT setting_value, value_type FROM site_settings WHERE setting_key = ? LIMIT 1',
    [String(settingKey || '')]
  );
  const row = rows[0];
  if (!row || row.setting_value === null || row.setting_value === '') return fallback;
  switch (row.value_type) {
    case 'number': {
      const parsed = Number(row.setting_value);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    case 'boolean':
      return row.setting_value === '1' || row.setting_value === 'true';
    case 'json':
      return parseJsonColumn(row.setting_value) ?? fallback;
    default:
      return row.setting_value;
  }
}

async function getPublicSettings(group = null) {
  const params = [];
  let where = 'WHERE is_public = 1';
  if (group) {
    where += ' AND setting_group = ?';
    params.push(String(group));
  }
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value, value_type, setting_group FROM site_settings ${where}`,
    params
  );
  return rows;
}

function isMediaReference(value) {
  return typeof value === 'string' && value.startsWith(REFERENCE_SCHEME);
}

/**
 * Resolve `media://<public_id>` to a public URL. Returns the fallback when the
 * reference is missing, archived, or not a reference at all — a replaced file
 * keeps working because references point at the media identity, not the path.
 */
async function resolveMediaReference(reference, fallback = null) {
  if (!isMediaReference(reference)) return fallback;
  const publicId = reference.slice(REFERENCE_SCHEME.length);
  const [rows] = await pool.query(
    `SELECT storage_path, public_url, thumbnail_path, variants_json, alt_text,
            title, original_name AS original_filename, mime_type, category, width, height
       FROM media_assets
      WHERE public_id = ? AND status = 'active' AND deleted_at IS NULL
      LIMIT 1`,
    [publicId]
  );
  const row = rows[0];
  if (!row) return fallback;
  let paths;
  try {
    paths = storage.resolvedAssetPaths(row);
  } catch {
    return fallback;
  }
  if (!(await storage.storedPathExists(paths.storagePath))) return fallback;
  return {
    url: paths.publicUrl,
    thumbnailUrl: paths.thumbnailUrl,
    variants: storage.parseVariants(row.variants_json),
    altText: row.alt_text,
    title: row.title || row.original_filename || null,
    mimeType: row.mime_type,
    category: row.category,
    dimensions: row.width && row.height ? `${row.width}Ã—${row.height}` : null,
  };
}

module.exports = {
  parseJsonColumn,
  getPage,
  listSections,
  getPublishedSectionContent,
  getSetting,
  getPublicSettings,
  isMediaReference,
  resolveMediaReference,
};
