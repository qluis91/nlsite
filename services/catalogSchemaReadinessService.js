/**
 * Non-destructive readiness checks for the catalog capabilities used by the
 * Admin Products list/editor and the public Store. MariaDB boolean aliases are
 * reported as TINYINT, and JSON aliases may be reported as LONGTEXT.
 */
const pool = require('../config/db');

const INTEGER_TYPES = Object.freeze(['tinyint', 'smallint', 'mediumint', 'int', 'bigint']);
const TEXT_TYPES = Object.freeze(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext']);
const DECIMAL_TYPES = Object.freeze([...INTEGER_TYPES, 'decimal', 'float', 'double']);
const DATE_TYPES = Object.freeze(['date', 'datetime', 'timestamp']);

const CATALOG_SCHEMA_REQUIREMENTS = Object.freeze({
  categories: Object.freeze({
    id: INTEGER_TYPES,
    name: TEXT_TYPES,
    slug: TEXT_TYPES,
    description: TEXT_TYPES,
    seo_title: TEXT_TYPES,
    seo_description: TEXT_TYPES,
    og_image: TEXT_TYPES,
    hero_title: TEXT_TYPES,
    hero_description: TEXT_TYPES,
    hero_image: TEXT_TYPES,
    hero_alt: TEXT_TYPES,
    hero_position: TEXT_TYPES,
    created_at: DATE_TYPES,
  }),
  products: Object.freeze({
    id: INTEGER_TYPES,
    name: TEXT_TYPES,
    slug: TEXT_TYPES,
    regular_price: DECIMAL_TYPES,
    promotional_price: DECIMAL_TYPES,
    web_price: DECIMAL_TYPES,
    weight: INTEGER_TYPES,
    stock_quantity: INTEGER_TYPES,
    description: TEXT_TYPES,
    seo_title: TEXT_TYPES,
    seo_description: TEXT_TYPES,
    og_image: TEXT_TYPES,
    tags: TEXT_TYPES,
    is_active: INTEGER_TYPES,
    is_published: INTEGER_TYPES,
    created_at: DATE_TYPES,
  }),
  product_categories: Object.freeze({
    product_id: INTEGER_TYPES,
    category_id: INTEGER_TYPES,
  }),
  product_images: Object.freeze({
    id: INTEGER_TYPES,
    product_id: INTEGER_TYPES,
    file_path: TEXT_TYPES,
    file_name: TEXT_TYPES,
    mime_type: TEXT_TYPES,
    width: INTEGER_TYPES,
    height: INTEGER_TYPES,
    size_bytes: INTEGER_TYPES,
    is_primary: INTEGER_TYPES,
    position: INTEGER_TYPES,
  }),
});

const CACHE_TTL_MS = 30_000;
let cachedResult = null;
let cachedAt = 0;

function baseType(value) {
  return String(value || '').toLowerCase().split('(')[0];
}

async function inspectCatalogSchema(db = pool, { force = false } = {}) {
  const mayCache = db === pool;
  if (mayCache && !force && cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  const tableNames = Object.keys(CATALOG_SCHEMA_REQUIREMENTS);
  const [rows] = await db.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
            DATA_TYPE AS dataType, COLUMN_TYPE AS columnType
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${tableNames.map(() => '?').join(',')})`,
    tableNames
  );

  const actual = new Map();
  rows.forEach((row) => {
    actual.set(`${row.tableName}.${row.columnName}`, baseType(row.dataType || row.columnType));
  });

  const missing = [];
  const incompatible = [];
  for (const [table, columns] of Object.entries(CATALOG_SCHEMA_REQUIREMENTS)) {
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

async function assertCatalogSchemaReady(db = pool, options = {}) {
  const result = await inspectCatalogSchema(db, options);
  if (result.ready) return result;

  const error = new Error(
    'Esquema de catálogo incompleto. Ejecute las migraciones pendientes.'
  );
  error.code = 'CATALOG_SCHEMA_NOT_READY';
  error.status = 503;
  error.schemaResult = result;
  throw error;
}

function invalidateCatalogSchemaReadiness() {
  cachedResult = null;
  cachedAt = 0;
}

module.exports = {
  CATALOG_SCHEMA_REQUIREMENTS,
  inspectCatalogSchema,
  assertCatalogSchemaReady,
  invalidateCatalogSchemaReadiness,
};
