/**
 * Non-destructive readiness checks for the catalog capabilities used by the
 * Admin Products list/editor and the public Store. MariaDB boolean aliases are
 * reported as TINYINT, and JSON aliases may be reported as LONGTEXT.
 */
const pool = require('../config/db');

const INTEGER_TYPES = Object.freeze(['tinyint', 'smallint', 'mediumint', 'int', 'bigint']);
const TEXT_TYPES = Object.freeze(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext']);
const JSON_TEXT_STORAGE_TYPES = Object.freeze(['text', 'mediumtext', 'longtext']);
const DECIMAL_TYPES = Object.freeze([...INTEGER_TYPES, 'decimal', 'float', 'double']);
const DATE_TYPES = Object.freeze(['date', 'datetime', 'timestamp']);

const CATALOG_SCHEMA_REQUIREMENTS = Object.freeze({
  categories: Object.freeze({
    id: INTEGER_TYPES, name: TEXT_TYPES, slug: TEXT_TYPES, description: TEXT_TYPES,
    seo_title: TEXT_TYPES, seo_description: TEXT_TYPES, og_image: TEXT_TYPES,
    hero_title: TEXT_TYPES, hero_description: TEXT_TYPES, hero_image: TEXT_TYPES,
    hero_alt: TEXT_TYPES, hero_position: TEXT_TYPES, created_at: DATE_TYPES,
  }),
  products: Object.freeze({
    id: INTEGER_TYPES, name: TEXT_TYPES, slug: TEXT_TYPES, regular_price: DECIMAL_TYPES,
    promotional_price: DECIMAL_TYPES, web_price: DECIMAL_TYPES, weight: INTEGER_TYPES,
    stock_quantity: INTEGER_TYPES, description: TEXT_TYPES, seo_title: TEXT_TYPES,
    seo_description: TEXT_TYPES, og_image: TEXT_TYPES, tags: TEXT_TYPES,
    is_active: INTEGER_TYPES, is_published: INTEGER_TYPES, created_at: DATE_TYPES,
  }),
  product_categories: Object.freeze({
    product_id: INTEGER_TYPES, category_id: INTEGER_TYPES,
  }),
  product_images: Object.freeze({
    id: INTEGER_TYPES, product_id: INTEGER_TYPES, file_path: TEXT_TYPES,
    file_name: TEXT_TYPES, mime_type: TEXT_TYPES, width: INTEGER_TYPES,
    height: INTEGER_TYPES, size_bytes: INTEGER_TYPES, is_primary: INTEGER_TYPES,
    position: INTEGER_TYPES,
  }),
});

const CATALOG_INDEX_REQUIREMENTS = Object.freeze([
  Object.freeze({ table: 'categories', columns: Object.freeze(['slug']), unique: true }),
  Object.freeze({ table: 'products', columns: Object.freeze(['slug']), unique: true }),
  Object.freeze({ table: 'products', columns: Object.freeze(['is_active']), unique: false }),
  Object.freeze({ table: 'products', columns: Object.freeze(['is_published']), unique: false }),
  Object.freeze({ table: 'product_categories', columns: Object.freeze(['product_id', 'category_id']), unique: true }),
  Object.freeze({ table: 'product_categories', columns: Object.freeze(['category_id']), unique: false }),
  Object.freeze({ table: 'product_images', columns: Object.freeze(['product_id', 'position']), unique: false }),
  Object.freeze({ table: 'product_images', columns: Object.freeze(['product_id', 'is_primary']), unique: false }),
]);

const CATALOG_FOREIGN_KEY_REQUIREMENTS = Object.freeze([
  Object.freeze({ table: 'product_categories', columns: Object.freeze(['product_id']), referencedTable: 'products', referencedColumns: Object.freeze(['id']) }),
  Object.freeze({ table: 'product_categories', columns: Object.freeze(['category_id']), referencedTable: 'categories', referencedColumns: Object.freeze(['id']) }),
  Object.freeze({ table: 'product_images', columns: Object.freeze(['product_id']), referencedTable: 'products', referencedColumns: Object.freeze(['id']) }),
]);

const CACHE_TTL_MS = 30_000;
let cachedResult = null;
let cachedAt = 0;

function baseType(value) {
  return String(value || '').toLowerCase().split('(')[0];
}

/**
 * Catalog capability types are semantic rather than engine-specific.
 * MySQL exposes native JSON as DATA_TYPE=json. MariaDB exposes its JSON alias
 * as LONGTEXT (normally with json_valid), and the catalog read/write boundary
 * safely validates and normalizes text-backed values.
 */
function isCatalogColumnTypeCompatible(table, column, metadata, allowedTypes) {
  const dataType = baseType(metadata?.dataType);
  const columnType = baseType(metadata?.columnType);
  const physicalType = dataType || columnType;

  if (table === 'products' && column === 'tags') {
    return physicalType === 'json' || JSON_TEXT_STORAGE_TYPES.includes(physicalType);
  }
  return Boolean(physicalType && allowedTypes.includes(physicalType));
}

function matchesColumns(actual, required) {
  return required.every((column, index) => actual[index] === column);
}

async function inspectCatalogDatabaseCompatibility(db = pool) {
  const [[versionRow]] = await db.query('SELECT VERSION() AS version');
  const [columnRows] = await db.query(
    `SELECT DATA_TYPE AS dataType, COLUMN_TYPE AS columnType
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME = 'tags'
      LIMIT 1`
  );
  const column = columnRows[0] || null;
  const version = String(versionRow?.version || 'unknown')
    .replace(/[^a-z0-9._+\- ]/gi, '')
    .slice(0, 100);
  const engine = /mariadb/i.test(version) ? 'MariaDB' : 'MySQL';
  const compatible = Boolean(column && isCatalogColumnTypeCompatible(
    'products',
    'tags',
    column,
    CATALOG_SCHEMA_REQUIREMENTS.products.tags
  ));

  return {
    engine,
    version,
    dataType: column ? baseType(column.dataType) : null,
    columnType: column ? String(column.columnType || '').toLowerCase().slice(0, 100) : null,
    compatible,
    typeAlteration: !column
      ? 'not-applicable-column-missing'
      : compatible ? 'skipped-semantically-compatible' : 'manual-review-required',
  };
}

async function inspectCatalogSchema(db = pool, { force = false } = {}) {
  const mayCache = db === pool;
  if (mayCache && !force && cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  const tableNames = Object.keys(CATALOG_SCHEMA_REQUIREMENTS);
  const placeholders = tableNames.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
            DATA_TYPE AS dataType, COLUMN_TYPE AS columnType
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );

  const actual = new Map();
  rows.forEach((row) => {
    actual.set(`${row.tableName}.${row.columnName}`, {
      dataType: row.dataType,
      columnType: row.columnType,
    });
  });

  const missing = [];
  const incompatible = [];
  for (const [table, columns] of Object.entries(CATALOG_SCHEMA_REQUIREMENTS)) {
    for (const [column, allowedTypes] of Object.entries(columns)) {
      const key = `${table}.${column}`;
      const metadata = actual.get(key);
      const physicalType = baseType(metadata?.dataType || metadata?.columnType);
      if (!metadata) missing.push(key);
      else if (!isCatalogColumnTypeCompatible(table, column, metadata, allowedTypes)) {
        incompatible.push(`${key}:${physicalType}`);
      }
    }
  }

  const [indexRows] = await db.query(
    `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName,
            NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    tableNames
  );
  const indexes = new Map();
  for (const row of indexRows) {
    const key = `${row.tableName}.${row.indexName}`;
    if (!indexes.has(key)) {
      indexes.set(key, { table: row.tableName, unique: Number(row.nonUnique) === 0, columns: [] });
    }
    indexes.get(key).columns.push(row.columnName);
  }
  const missingIndexes = CATALOG_INDEX_REQUIREMENTS
    .filter((required) => ![...indexes.values()].some((index) => (
      index.table === required.table
      && (!required.unique || index.unique)
      && matchesColumns(index.columns, required.columns)
    )))
    .map((required) => `${required.table}(${required.columns.join(',')})${required.unique ? ':unique' : ''}`);

  const [foreignKeyRows] = await db.query(
    `SELECT kcu.TABLE_NAME AS tableName, kcu.CONSTRAINT_NAME AS constraintName,
            kcu.COLUMN_NAME AS columnName,
            kcu.REFERENCED_TABLE_NAME AS referencedTable,
            kcu.REFERENCED_COLUMN_NAME AS referencedColumn
       FROM information_schema.KEY_COLUMN_USAGE kcu
      WHERE kcu.TABLE_SCHEMA = DATABASE()
        AND kcu.TABLE_NAME IN (${placeholders})
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    tableNames
  );
  const foreignKeys = new Map();
  for (const row of foreignKeyRows) {
    const key = `${row.tableName}.${row.constraintName}`;
    if (!foreignKeys.has(key)) {
      foreignKeys.set(key, {
        table: row.tableName, referencedTable: row.referencedTable,
        columns: [], referencedColumns: [],
      });
    }
    foreignKeys.get(key).columns.push(row.columnName);
    foreignKeys.get(key).referencedColumns.push(row.referencedColumn);
  }
  const missingForeignKeys = CATALOG_FOREIGN_KEY_REQUIREMENTS
    .filter((required) => ![...foreignKeys.values()].some((key) => (
      key.table === required.table
      && key.referencedTable === required.referencedTable
      && matchesColumns(key.columns, required.columns)
      && matchesColumns(key.referencedColumns, required.referencedColumns)
    )))
    .map((required) => (
      `${required.table}(${required.columns.join(',')})->`
      + `${required.referencedTable}(${required.referencedColumns.join(',')})`
    ));

  const result = {
    ready: missing.length === 0
      && incompatible.length === 0
      && missingIndexes.length === 0
      && missingForeignKeys.length === 0,
    missing,
    incompatible,
    missingIndexes,
    missingForeignKeys,
    tagsStorage: (() => {
      const metadata = actual.get('products.tags');
      if (!metadata) return null;
      return {
        dataType: baseType(metadata.dataType),
        columnType: String(metadata.columnType || '').toLowerCase(),
        compatible: isCatalogColumnTypeCompatible(
          'products',
          'tags',
          metadata,
          CATALOG_SCHEMA_REQUIREMENTS.products.tags
        ),
      };
    })(),
  };
  if (mayCache) {
    cachedResult = result;
    cachedAt = Date.now();
  }
  return result;
}

function formatCatalogSchemaIssues(result) {
  const issues = [];
  if (result.missing?.length) issues.push(`columnas/tablas: ${result.missing.join(', ')}`);
  if (result.incompatible?.length) issues.push(`tipos incompatibles: ${result.incompatible.join(', ')}`);
  if (result.missingIndexes?.length) issues.push(`índices: ${result.missingIndexes.join(', ')}`);
  if (result.missingForeignKeys?.length) issues.push(`llaves foráneas: ${result.missingForeignKeys.join(', ')}`);
  return issues.join('; ') || 'capacidad desconocida';
}

async function assertCatalogSchemaReady(db = pool, options = {}) {
  const result = await inspectCatalogSchema(db, options);
  if (result.ready) return result;

  const error = new Error(
    `Esquema de catálogo incompleto (${formatCatalogSchemaIssues(result)}). `
    + 'Ejecute las migraciones pendientes.'
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
  CATALOG_INDEX_REQUIREMENTS,
  CATALOG_FOREIGN_KEY_REQUIREMENTS,
  isCatalogColumnTypeCompatible,
  inspectCatalogDatabaseCompatibility,
  inspectCatalogSchema,
  assertCatalogSchemaReady,
  formatCatalogSchemaIssues,
  invalidateCatalogSchemaReadiness,
};
