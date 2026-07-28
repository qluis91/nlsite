/**
 * Additive catalog reconciliation for production databases whose historical
 * schema_migrations records do not match their physical catalog schema.
 *
 * MariaDB/MySQL DDL implicitly commits, so safety comes from the deploy
 * advisory lock plus capability-aware, repeatable operations. The migration is
 * recorded as successful only after the complete schema passes readiness.
 */
require('dotenv').config();
const defaultPool = require('../config/db');
const {
  assertCatalogSchemaReady,
  inspectCatalogSchema,
  formatCatalogSchemaIssues,
  invalidateCatalogSchemaReadiness,
} = require('../services/catalogSchemaReadinessService');

const TABLE_DEFINITIONS = Object.freeze({
  categories: `CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    seo_title VARCHAR(160) NULL,
    seo_description VARCHAR(300) NULL,
    og_image VARCHAR(500) NULL,
    hero_title VARCHAR(160) NULL,
    hero_description VARCHAR(500) NULL,
    hero_image VARCHAR(500) NULL,
    hero_alt VARCHAR(200) NULL,
    hero_position VARCHAR(20) NULL DEFAULT 'center',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_categories_slug (slug)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  products: `CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(180) NOT NULL,
    regular_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    promotional_price DECIMAL(10,2) NULL,
    web_price DECIMAL(10,2) NULL,
    weight INT NULL COMMENT 'grams',
    stock_quantity INT NOT NULL DEFAULT 0,
    description TEXT NULL,
    seo_title VARCHAR(160) NULL,
    seo_description VARCHAR(300) NULL,
    og_image VARCHAR(500) NULL,
    tags LONGTEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_published TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_products_slug (slug),
    INDEX idx_products_active (is_active),
    INDEX idx_products_published (is_published)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  product_categories: `CREATE TABLE IF NOT EXISTS product_categories (
    product_id INT NOT NULL,
    category_id INT NOT NULL,
    PRIMARY KEY (product_id, category_id),
    INDEX idx_pc_category (category_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  product_images: `CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(50) NOT NULL DEFAULT 'image/webp',
    width INT NULL,
    height INT NULL,
    size_bytes INT NULL,
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pi_product_position (product_id, position),
    INDEX idx_pi_product_primary (product_id, is_primary)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
});

const COLUMN_DEFINITIONS = Object.freeze({
  categories: Object.freeze({
    id: 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST',
    name: "VARCHAR(100) NOT NULL DEFAULT ''",
    slug: "VARCHAR(120) NOT NULL DEFAULT ''",
    description: 'VARCHAR(500) NULL',
    seo_title: 'VARCHAR(160) NULL',
    seo_description: 'VARCHAR(300) NULL',
    og_image: 'VARCHAR(500) NULL',
    hero_title: 'VARCHAR(160) NULL',
    hero_description: 'VARCHAR(500) NULL',
    hero_image: 'VARCHAR(500) NULL',
    hero_alt: 'VARCHAR(200) NULL',
    hero_position: "VARCHAR(20) NULL DEFAULT 'center'",
    created_at: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
  }),
  products: Object.freeze({
    id: 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST',
    name: "VARCHAR(160) NOT NULL DEFAULT ''",
    slug: "VARCHAR(180) NOT NULL DEFAULT ''",
    regular_price: 'DECIMAL(10,2) NOT NULL DEFAULT 0',
    promotional_price: 'DECIMAL(10,2) NULL',
    web_price: 'DECIMAL(10,2) NULL',
    weight: 'INT NULL',
    stock_quantity: 'INT NOT NULL DEFAULT 0',
    description: 'TEXT NULL',
    seo_title: 'VARCHAR(160) NULL',
    seo_description: 'VARCHAR(300) NULL',
    og_image: 'VARCHAR(500) NULL',
    tags: 'LONGTEXT NULL',
    is_active: 'TINYINT(1) NOT NULL DEFAULT 1',
    is_published: 'TINYINT(1) NOT NULL DEFAULT 1',
    created_at: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
  }),
  product_categories: Object.freeze({
    product_id: 'INT NOT NULL',
    category_id: 'INT NOT NULL',
  }),
  product_images: Object.freeze({
    id: 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST',
    product_id: 'INT NOT NULL',
    file_path: "VARCHAR(500) NOT NULL DEFAULT ''",
    file_name: "VARCHAR(255) NOT NULL DEFAULT ''",
    mime_type: "VARCHAR(50) NOT NULL DEFAULT 'image/webp'",
    width: 'INT NULL',
    height: 'INT NULL',
    size_bytes: 'INT NULL',
    is_primary: 'TINYINT(1) NOT NULL DEFAULT 0',
    position: 'INT NOT NULL DEFAULT 0',
  }),
});

const INDEX_DEFINITIONS = Object.freeze([
  Object.freeze({ table: 'categories', name: 'uq_categories_slug_repair', columns: Object.freeze(['slug']), unique: true }),
  Object.freeze({ table: 'products', name: 'uq_products_slug_repair', columns: Object.freeze(['slug']), unique: true }),
  Object.freeze({ table: 'products', name: 'idx_products_active_repair', columns: Object.freeze(['is_active']) }),
  Object.freeze({ table: 'products', name: 'idx_products_published_repair', columns: Object.freeze(['is_published']) }),
  Object.freeze({ table: 'product_categories', name: 'PRIMARY', columns: Object.freeze(['product_id', 'category_id']), unique: true, primary: true }),
  Object.freeze({ table: 'product_categories', name: 'idx_pc_category_repair', columns: Object.freeze(['category_id']) }),
  Object.freeze({ table: 'product_images', name: 'idx_pi_product_position_repair', columns: Object.freeze(['product_id', 'position']) }),
  Object.freeze({ table: 'product_images', name: 'idx_pi_product_primary_repair', columns: Object.freeze(['product_id', 'is_primary']) }),
]);

const FOREIGN_KEY_DEFINITIONS = Object.freeze([
  Object.freeze({
    table: 'product_categories', name: 'fk_pc_product_repair', columns: Object.freeze(['product_id']),
    referencedTable: 'products', referencedColumns: Object.freeze(['id']), onDelete: 'CASCADE',
  }),
  Object.freeze({
    table: 'product_categories', name: 'fk_pc_category_repair', columns: Object.freeze(['category_id']),
    referencedTable: 'categories', referencedColumns: Object.freeze(['id']), onDelete: 'RESTRICT',
  }),
  Object.freeze({
    table: 'product_images', name: 'fk_pi_product_repair', columns: Object.freeze(['product_id']),
    referencedTable: 'products', referencedColumns: Object.freeze(['id']), onDelete: 'CASCADE',
  }),
]);

function quoteId(value) {
  if (!/^[a-z0-9_]+$/i.test(value)) throw new Error(`Unsafe catalog identifier: ${value}`);
  return `\`${value}\``;
}

async function getColumns(db, table) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME AS columnName
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(rows.map((row) => row.columnName));
}

async function getIndexes(db, table) {
  const [rows] = await db.query(
    `SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
            COLUMN_NAME AS columnName
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [table]
  );
  const indexes = new Map();
  for (const row of rows) {
    if (!indexes.has(row.indexName)) {
      indexes.set(row.indexName, { unique: Number(row.nonUnique) === 0, columns: [] });
    }
    indexes.get(row.indexName).columns.push(row.columnName);
  }
  return indexes;
}

function hasIndex(indexes, required) {
  return [...indexes.values()].some((index) => (
    (!required.unique || index.unique)
    && required.columns.every((column, position) => index.columns[position] === column)
  ));
}

async function getForeignKeys(db, table) {
  const [rows] = await db.query(
    `SELECT CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName,
            REFERENCED_TABLE_NAME AS referencedTable,
            REFERENCED_COLUMN_NAME AS referencedColumn
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
    [table]
  );
  const keys = new Map();
  for (const row of rows) {
    if (!keys.has(row.constraintName)) {
      keys.set(row.constraintName, {
        referencedTable: row.referencedTable, columns: [], referencedColumns: [],
      });
    }
    keys.get(row.constraintName).columns.push(row.columnName);
    keys.get(row.constraintName).referencedColumns.push(row.referencedColumn);
  }
  return keys;
}

function hasForeignKey(keys, required) {
  return [...keys.values()].some((key) => (
    key.referencedTable === required.referencedTable
    && required.columns.every((column, position) => key.columns[position] === column)
    && required.referencedColumns.every((column, position) => key.referencedColumns[position] === column)
  ));
}

async function ensureForeignKey(db, definition, operations) {
  const keys = await getForeignKeys(db, definition.table);
  if (hasForeignKey(keys, definition)) return;

  const childColumn = definition.columns[0];
  const parentColumn = definition.referencedColumns[0];
  const [rows] = await db.query(
    `SELECT COUNT(*) AS orphanCount
       FROM ${quoteId(definition.table)} child
       LEFT JOIN ${quoteId(definition.referencedTable)} parent
         ON child.${quoteId(childColumn)} = parent.${quoteId(parentColumn)}
      WHERE child.${quoteId(childColumn)} IS NOT NULL
        AND parent.${quoteId(parentColumn)} IS NULL`
  );
  const orphanCount = Number(rows[0]?.orphanCount || 0);
  if (orphanCount > 0) {
    const error = new Error(
      `Catalog repair blocked: ${definition.table}.${childColumn} has `
      + `${orphanCount} orphaned reference(s) to ${definition.referencedTable}.${parentColumn}.`
    );
    error.code = 'CATALOG_REPAIR_ORPHANED_REFERENCE';
    throw error;
  }

  await db.query(
    `ALTER TABLE ${quoteId(definition.table)}
       ADD CONSTRAINT ${quoteId(definition.name)}
       FOREIGN KEY (${definition.columns.map(quoteId).join(', ')})
       REFERENCES ${quoteId(definition.referencedTable)}
         (${definition.referencedColumns.map(quoteId).join(', ')})
       ON DELETE ${definition.onDelete}`
  );
  operations.push(`foreign-key:${definition.table}.${definition.name}`);
}

async function migrateCatalogSchemaRepair(db = defaultPool) {
  const before = await inspectCatalogSchema(db, { force: true });
  console.log(`[catalog:repair] before: ${before.ready ? 'ready' : formatCatalogSchemaIssues(before)}`);
  const operations = [];

  for (const [table, sql] of Object.entries(TABLE_DEFINITIONS)) {
    const existing = await getColumns(db, table);
    await db.query(sql);
    if (existing.size === 0) operations.push(`table:${table}`);
  }

  for (const [table, definitions] of Object.entries(COLUMN_DEFINITIONS)) {
    const columns = await getColumns(db, table);
    for (const [column, definition] of Object.entries(definitions)) {
      if (columns.has(column)) continue;
      await db.query(`ALTER TABLE ${quoteId(table)} ADD COLUMN ${quoteId(column)} ${definition}`);
      operations.push(`column:${table}.${column}`);
      columns.add(column);
    }
  }

  for (const definition of INDEX_DEFINITIONS) {
    const indexes = await getIndexes(db, definition.table);
    if (hasIndex(indexes, definition)) continue;
    const clause = definition.primary
      ? `ADD PRIMARY KEY (${definition.columns.map(quoteId).join(', ')})`
      : `ADD ${definition.unique ? 'UNIQUE ' : ''}INDEX ${quoteId(definition.name)} `
        + `(${definition.columns.map(quoteId).join(', ')})`;
    await db.query(`ALTER TABLE ${quoteId(definition.table)} ${clause}`);
    operations.push(`index:${definition.table}.${definition.name}`);
  }

  for (const definition of FOREIGN_KEY_DEFINITIONS) {
    await ensureForeignKey(db, definition, operations);
  }

  invalidateCatalogSchemaReadiness();
  const after = await assertCatalogSchemaReady(db, { force: true });
  console.log(`[catalog:repair] after: ready (${operations.length} additive operation(s))`);
  return { before, after, operations };
}

if (require.main === module) {
  migrateCatalogSchemaRepair()
    .then(() => defaultPool.end())
    .catch(async (error) => {
      console.error('[catalog:repair] Failed:', error.message);
      await defaultPool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  TABLE_DEFINITIONS,
  COLUMN_DEFINITIONS,
  INDEX_DEFINITIONS,
  FOREIGN_KEY_DEFINITIONS,
  hasIndex,
  hasForeignKey,
  migrateCatalogSchemaRepair,
};
