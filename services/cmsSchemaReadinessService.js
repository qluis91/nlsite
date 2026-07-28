/**
 * Non-destructive CMS schema readiness checks used by deployment, /ready,
 * and draft writes. MariaDB reports JSON aliases as LONGTEXT, so both are
 * accepted where snapshots are expected.
 */
const pool = require('../config/db');

const JSON_TYPES = Object.freeze(['json', 'longtext', 'mediumtext', 'text']);
const CMS_SCHEMA_REQUIREMENTS = Object.freeze({
  page_sections: Object.freeze({
    content_json: JSON_TYPES,
    style_json: JSON_TYPES,
    published_content_json: JSON_TYPES,
    published_style_json: JSON_TYPES,
    status: Object.freeze(['varchar', 'enum']),
    version: Object.freeze(['int', 'bigint']),
  }),
  site_settings: Object.freeze({
    setting_value: Object.freeze(['longtext', 'mediumtext', 'text', 'varchar']),
    published_value: Object.freeze(['longtext', 'mediumtext', 'text', 'varchar']),
    has_unpublished_changes: Object.freeze(['tinyint', 'boolean']),
  }),
  navigation_items: Object.freeze({
    published_data: JSON_TYPES,
  }),
  logo_loop_items: Object.freeze({
    published_data: JSON_TYPES,
  }),
  home_carousel_items: Object.freeze({
    published_data: JSON_TYPES,
  }),
  home_feature_items: Object.freeze({
    published_data: JSON_TYPES,
  }),
  home_social_items: Object.freeze({
    public_id: Object.freeze(['char', 'varchar']),
    published_data: JSON_TYPES,
    status: Object.freeze(['varchar', 'enum']),
  }),
});

const CACHE_TTL_MS = 30_000;
let cachedResult = null;
let cachedAt = 0;

function baseType(columnType) {
  return String(columnType || '').toLowerCase().split('(')[0];
}

async function inspectCmsSchema(db = pool, { force = false } = {}) {
  const mayCache = db === pool;
  if (mayCache && !force && cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  const tableNames = Object.keys(CMS_SCHEMA_REQUIREMENTS);
  const [rows] = await db.query(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${tableNames.map(() => '?').join(',')})`,
    tableNames
  );

  const actual = new Map();
  rows.forEach((row) => {
    actual.set(
      `${row.TABLE_NAME}.${row.COLUMN_NAME}`,
      baseType(row.DATA_TYPE || row.COLUMN_TYPE)
    );
  });

  const missing = [];
  const incompatible = [];
  for (const [table, columns] of Object.entries(CMS_SCHEMA_REQUIREMENTS)) {
    for (const [column, allowedTypes] of Object.entries(columns)) {
      const key = `${table}.${column}`;
      const type = actual.get(key);
      if (!type) missing.push(key);
      else if (!allowedTypes.includes(type)) incompatible.push(`${key}:${type}`);
    }
  }

  const result = {
    ready: missing.length === 0 && incompatible.length === 0,
    missing,
    incompatible,
  };
  if (mayCache) {
    cachedResult = result;
    cachedAt = Date.now();
  }
  return result;
}

async function assertCmsSchemaReady(db = pool, options = {}) {
  const result = await inspectCmsSchema(db, options);
  if (result.ready) return result;

  const details = [...result.missing, ...result.incompatible].join(', ');
  const error = new Error(
    `Esquema CMS incompleto. Ejecute las migraciones pendientes. Capacidades ausentes: ${details}`
  );
  error.code = 'CMS_SCHEMA_NOT_READY';
  error.status = 503;
  error.schemaResult = result;
  throw error;
}

function invalidateCmsSchemaReadiness() {
  cachedResult = null;
  cachedAt = 0;
}

module.exports = {
  CMS_SCHEMA_REQUIREMENTS,
  inspectCmsSchema,
  assertCmsSchemaReady,
  invalidateCmsSchemaReadiness,
};
