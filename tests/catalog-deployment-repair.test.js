const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TABLE_DEFINITIONS,
  COLUMN_DEFINITIONS,
  INDEX_DEFINITIONS,
  FOREIGN_KEY_DEFINITIONS,
  hasIndex,
  hasForeignKey,
  migrateCatalogSchemaRepair,
} = require('../scripts/migrate-catalog-schema-repair');
const {
  CATALOG_SCHEMA_REQUIREMENTS,
  CATALOG_INDEX_REQUIREMENTS,
  CATALOG_FOREIGN_KEY_REQUIREMENTS,
  inspectCatalogSchema,
  assertCatalogSchemaReady,
} = require('../services/catalogSchemaReadinessService');
const { MIGRATION_REGISTRY, runPendingMigrations } = require('../scripts/migrationTracker');
const { runPrestart } = require('../scripts/prestart');

after(async () => {
  const pool = require('../config/db');
  await pool.end().catch(() => {});
});

function completeReadinessDb({ omitColumn, omitIndex, omitForeignKey } = {}) {
  const columns = [];
  for (const [table, definitions] of Object.entries(CATALOG_SCHEMA_REQUIREMENTS)) {
    for (const [column, types] of Object.entries(definitions)) {
      if (`${table}.${column}` !== omitColumn) {
        columns.push({ tableName: table, columnName: column, dataType: types[0] });
      }
    }
  }
  const indexes = CATALOG_INDEX_REQUIREMENTS.flatMap((definition, definitionIndex) => (
    definition.columns.map((column, columnIndex) => ({
      tableName: definition.table,
      indexName: `index_${definitionIndex}`,
      nonUnique: definition.unique ? 0 : 1,
      columnName: column,
      sequenceInIndex: columnIndex + 1,
    }))
  )).filter((row) => !omitIndex || !row.indexName.endsWith(`_${omitIndex}`));
  const foreignKeys = CATALOG_FOREIGN_KEY_REQUIREMENTS.flatMap((definition, definitionIndex) => (
    definition.columns.map((column, columnIndex) => ({
      tableName: definition.table,
      constraintName: `fk_${definitionIndex}`,
      columnName: column,
      referencedTable: definition.referencedTable,
      referencedColumn: definition.referencedColumns[columnIndex],
    }))
  )).filter((row) => !omitForeignKey || !row.constraintName.endsWith(`_${omitForeignKey}`));

  return {
    async query(sql) {
      if (sql.includes('information_schema.COLUMNS')) return [columns];
      if (sql.includes('information_schema.STATISTICS')) return [indexes];
      if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [foreignKeys];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('catalog repair defines a complete empty-database bootstrap without schema.sql', () => {
  assert.deepEqual(Object.keys(TABLE_DEFINITIONS), [
    'categories', 'products', 'product_categories', 'product_images',
  ]);
  for (const [table, requirements] of Object.entries(CATALOG_SCHEMA_REQUIREMENTS)) {
    for (const column of Object.keys(requirements)) {
      assert.ok(
        TABLE_DEFINITIONS[table].includes(column) || COLUMN_DEFINITIONS[table][column],
        `missing empty/partial repair definition for ${table}.${column}`
      );
    }
  }
  assert.ok(INDEX_DEFINITIONS.length >= CATALOG_INDEX_REQUIREMENTS.length);
  assert.equal(FOREIGN_KEY_DEFINITIONS.length, CATALOG_FOREIGN_KEY_REQUIREMENTS.length);
  assert.match(TABLE_DEFINITIONS.products, /tags LONGTEXT NULL/);
  assert.doesNotMatch(TABLE_DEFINITIONS.products, /tags JSON/);
});

test('partial schema readiness reports exact column, index, and foreign-key capabilities', async () => {
  const db = completeReadinessDb({
    omitColumn: 'products.stock_quantity',
    omitIndex: 2,
    omitForeignKey: 1,
  });
  const result = await inspectCatalogSchema(db, { force: true });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['products.stock_quantity']);
  assert.ok(result.missingIndexes.includes('products(is_active)'));
  assert.ok(result.missingForeignKeys.includes('product_categories(category_id)->categories(id)'));
  await assert.rejects(
    assertCatalogSchemaReady(db, { force: true }),
    (error) => (
      error.code === 'CATALOG_SCHEMA_NOT_READY'
      && /products\.stock_quantity/.test(error.message)
      && /products\(is_active\)/.test(error.message)
    )
  );
});

test('capability matching accepts existing indexes and foreign keys regardless of names', () => {
  assert.equal(hasIndex(new Map([
    ['legacy_name', { unique: true, columns: ['slug'] }],
  ]), { unique: true, columns: ['slug'] }), true);
  assert.equal(hasForeignKey(new Map([
    ['legacy_fk', {
      referencedTable: 'products',
      columns: ['product_id'],
      referencedColumns: ['id'],
    }],
  ]), {
    referencedTable: 'products',
    columns: ['product_id'],
    referencedColumns: ['id'],
  }), true);
});

test('repair migration is registered immediately after the historical catalog migration', () => {
  const base = MIGRATION_REGISTRY.findIndex((entry) => entry.name === 'migrateCatalog');
  const repair = MIGRATION_REGISTRY.findIndex((entry) => entry.name === 'migrateCatalogSchemaRepair');
  assert.equal(repair, base + 1);
  assert.equal(MIGRATION_REGISTRY[repair].passPool, true);
  assert.equal(MIGRATION_REGISTRY[repair].reconcileOnDrift, true);
  assert.equal(new Set(MIGRATION_REGISTRY.map((entry) => entry.name)).size, MIGRATION_REGISTRY.length);
});

test('historical ok record with missing physical schema runs and records the dedicated repair', async () => {
  const recorded = [];
  const pool = {
    async query(sql, params) {
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)) return [{ affectedRows: 0 }];
      if (/SELECT name, checksum, status FROM schema_migrations/.test(sql)) {
        return [[{ name: 'historicalCatalog', checksum: 'stable', status: 'ok' }]];
      }
      if (/INSERT INTO schema_migrations/.test(sql)) {
        recorded.push(params);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected tracker query: ${sql}`);
    },
  };
  let physicalReady = false;
  const result = await runPendingMigrations(pool, {
    registry: [
      {
        name: 'historicalCatalog', file: './historical-catalog',
        exportName: 'historical', capability: 'catalog',
      },
      {
        name: 'catalogRepair', file: './catalog-repair',
        exportName: 'repair', capability: 'catalog', passPool: true,
      },
    ],
    checksumFor: () => 'stable',
    inspectCatalog: async () => ({
      ready: physicalReady,
      missing: physicalReady ? [] : ['products.stock_quantity'],
      incompatible: [],
      missingIndexes: [],
      missingForeignKeys: [],
    }),
    formatCatalogIssues: () => 'columns: products.stock_quantity',
    loadMigration: (file) => ({
      historical: async () => { throw new Error('historical SQL must not rerun'); },
      repair: async (receivedPool) => {
        assert.equal(receivedPool, pool);
        physicalReady = true;
      },
    }),
  });
  assert.deepEqual(result, { ran: 1, skipped: 1, reconciled: 0 });
  assert.equal(physicalReady, true);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0][0], 'catalogRepair');
  assert.equal(recorded[0][3], 'ok');
});

test('empty and partial local MariaDB schemas are repaired without losing legacy rows', async (t) => {
  const host = process.env.DB_HOST || 'localhost';
  const sourceDatabase = process.env.DB_NAME || 'nlsite_db';
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || sourceDatabase !== 'nlsite_db') {
    return t.skip('destructive fixture creation is restricted to the local nlsite_db test target');
  }

  const mysql = require('mysql2/promise');
  const fixtureName = `nlsite_catalog_repair_${process.pid}_${Date.now()}`;
  assert.match(fixtureName, /^nlsite_catalog_repair_\d+_\d+$/);
  const admin = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });
  let fixturePool;
  try {
    await admin.query(
      `CREATE DATABASE \`${fixtureName}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    fixturePool = mysql.createPool({
      host,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: fixtureName,
      connectionLimit: 2,
    });

    await fixturePool.query(`
      CREATE TABLE categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(120) NOT NULL
      ) ENGINE=InnoDB
    `);
    await fixturePool.query(`
      CREATE TABLE products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        slug VARCHAR(180) NOT NULL
      ) ENGINE=InnoDB
    `);
    await fixturePool.query(
      "INSERT INTO categories (name, slug) VALUES ('Legacy category', 'legacy-category')"
    );
    await fixturePool.query(
      "INSERT INTO products (name, slug) VALUES ('Legacy product', 'legacy-product')"
    );

    const first = await migrateCatalogSchemaRepair(fixturePool);
    const second = await migrateCatalogSchemaRepair(fixturePool);
    const readiness = await inspectCatalogSchema(fixturePool, { force: true });
    const [[legacyCategory]] = await fixturePool.query(
      "SELECT name, slug FROM categories WHERE slug = 'legacy-category'"
    );
    const [[legacyProduct]] = await fixturePool.query(
      "SELECT name, slug, stock_quantity, is_active, is_published FROM products WHERE slug = 'legacy-product'"
    );

    assert.equal(first.before.ready, false);
    assert.equal(first.after.ready, true);
    assert.equal(readiness.ready, true);
    assert.deepEqual(second.operations, []);
    assert.deepEqual(legacyCategory, {
      name: 'Legacy category',
      slug: 'legacy-category',
    });
    assert.deepEqual(legacyProduct, {
      name: 'Legacy product',
      slug: 'legacy-product',
      stock_quantity: 0,
      is_active: 1,
      is_published: 1,
    });
  } finally {
    if (fixturePool) await fixturePool.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${fixtureName}\``);
    await admin.end();
  }
});

test('fully migrated local database repair is idempotent and preserves catalog row counts', async (t) => {
  if (!process.env.DB_NAME) return t.skip('database environment is not configured');
  const pool = require('../config/db');
  const tables = Object.keys(TABLE_DEFINITIONS);
  const countRows = async () => {
    const counts = {};
    for (const table of tables) {
      const [[row]] = await pool.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
      counts[table] = Number(row.count);
    }
    return counts;
  };
  const before = await countRows();
  const first = await migrateCatalogSchemaRepair(pool);
  const second = await migrateCatalogSchemaRepair(pool);
  const after = await countRows();
  assert.equal(first.after.ready, true);
  assert.deepEqual(second.operations, []);
  assert.deepEqual(after, before);
});

test('prestart blocks app launch on migration failure and always closes its owned pool', async () => {
  let closed = 0;
  let appStarted = false;
  await assert.rejects(
    runPrestart({
      environment: 'production',
      migrate: async () => { throw new Error('migration failed'); },
      closeMigrationPool: async () => { closed++; },
    }).then(() => { appStarted = true; }),
    /migration failed/
  );
  assert.equal(appStarted, false);
  assert.equal(closed, 1);
});

test('prestart allows npm startup only after successful migration and clean pool closure', async () => {
  const sequence = [];
  await runPrestart({
    environment: 'production',
    migrate: async () => { sequence.push('migrate'); },
    closeMigrationPool: async () => { sequence.push('close'); },
  });
  sequence.push('app');
  assert.deepEqual(sequence, ['migrate', 'close', 'app']);
});

test('deployment verifies catalog readiness after the complete registry and health stays independent', () => {
  const deploy = fs.readFileSync(path.join(__dirname, '../scripts/migrate-deploy.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const runIndex = deploy.indexOf('runPendingMigrations');
  const readinessIndex = deploy.indexOf('assertCatalogSchemaReady(pool');
  assert.ok(runIndex >= 0 && readinessIndex > runIndex);
  assert.match(app, /app\.get\('\/health', \(_req, res\) => \{\s*res\.status\(200\)/s);
  assert.match(app, /app\.get\('\/ready', async \(_req, res\) =>/);
  assert.match(app, /res\.status\(ready \? 200 : 503\)/);
});
