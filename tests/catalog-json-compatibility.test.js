const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CATALOG_SCHEMA_REQUIREMENTS,
  CATALOG_INDEX_REQUIREMENTS,
  CATALOG_FOREIGN_KEY_REQUIREMENTS,
  isCatalogColumnTypeCompatible,
  inspectCatalogDatabaseCompatibility,
  inspectCatalogSchema,
} = require('../services/catalogSchemaReadinessService');
const { normalizeCatalogTags } = require('../services/catalogTags');
const {
  migrateCatalogSchemaRepair,
} = require('../scripts/migrate-catalog-schema-repair');

function metadataRows(tagsType = 'json') {
  return Object.entries(CATALOG_SCHEMA_REQUIREMENTS).flatMap(([table, columns]) => (
    Object.entries(columns).map(([column, allowedTypes]) => ({
      tableName: table,
      columnName: column,
      dataType: table === 'products' && column === 'tags' ? tagsType : allowedTypes[0],
      columnType: table === 'products' && column === 'tags' ? tagsType : allowedTypes[0],
    }))
  ));
}

function indexRows() {
  return CATALOG_INDEX_REQUIREMENTS.flatMap((definition, definitionIndex) => (
    definition.columns.map((column) => ({
      tableName: definition.table,
      indexName: `fixture_index_${definitionIndex}`,
      nonUnique: definition.unique ? 0 : 1,
      columnName: column,
    }))
  ));
}

function foreignKeyRows() {
  return CATALOG_FOREIGN_KEY_REQUIREMENTS.flatMap((definition, definitionIndex) => (
    definition.columns.map((column, columnIndex) => ({
      tableName: definition.table,
      constraintName: `fixture_fk_${definitionIndex}`,
      columnName: column,
      referencedTable: definition.referencedTable,
      referencedColumn: definition.referencedColumns[columnIndex],
    }))
  ));
}

function completeCatalogDb({ tagsType = 'json', version = '8.0.42' } = {}) {
  const columns = metadataRows(tagsType);
  const indexes = indexRows();
  const foreignKeys = foreignKeyRows();
  const executedSql = [];

  return {
    executedSql,
    tagsValue: '["uno","dos"]',
    async query(sql, params = []) {
      executedSql.push(sql);
      if (sql === 'SELECT VERSION() AS version') {
        return [[{ version }]];
      }
      if (sql.includes("TABLE_NAME = 'products'") && sql.includes("COLUMN_NAME = 'tags'")) {
        return [[{ dataType: tagsType, columnType: tagsType }]];
      }
      if (sql.includes('information_schema.COLUMNS') && sql.includes('TABLE_NAME IN')) {
        return [columns];
      }
      if (sql.includes('information_schema.COLUMNS') && sql.includes('TABLE_NAME = ?')) {
        return [columns
          .filter((row) => row.tableName === params[0])
          .map((row) => ({ columnName: row.columnName }))];
      }
      if (sql.includes('information_schema.STATISTICS') && sql.includes('TABLE_NAME IN')) {
        return [indexes];
      }
      if (sql.includes('information_schema.STATISTICS') && sql.includes('TABLE_NAME = ?')) {
        return [indexes
          .filter((row) => row.tableName === params[0])
          .map((row) => ({
            indexName: row.indexName,
            nonUnique: row.nonUnique,
            columnName: row.columnName,
          }))];
      }
      if (sql.includes('information_schema.KEY_COLUMN_USAGE') && sql.includes('TABLE_NAME IN')) {
        return [foreignKeys];
      }
      if (sql.includes('information_schema.KEY_COLUMN_USAGE') && sql.includes('TABLE_NAME = ?')) {
        return [foreignKeys
          .filter((row) => row.tableName === params[0])
          .map((row) => ({
            constraintName: row.constraintName,
            columnName: row.columnName,
            referencedTable: row.referencedTable,
            referencedColumn: row.referencedColumn,
          }))];
      }
      if (/^\s*CREATE TABLE IF NOT EXISTS/i.test(sql)) return [{ affectedRows: 0 }];
      if (/^\s*ALTER TABLE/i.test(sql)) {
        throw new Error(`Native JSON fixture must not be altered: ${sql}`);
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('semantic products.tags compatibility accepts MySQL JSON and MariaDB text aliases', () => {
  const allowed = CATALOG_SCHEMA_REQUIREMENTS.products.tags;
  assert.equal(
    isCatalogColumnTypeCompatible('products', 'tags', { dataType: 'json', columnType: 'json' }, allowed),
    true
  );
  assert.equal(
    isCatalogColumnTypeCompatible('products', 'tags', { dataType: 'longtext', columnType: 'longtext' }, allowed),
    true
  );
  assert.equal(
    isCatalogColumnTypeCompatible('products', 'tags', { dataType: 'text', columnType: 'text' }, allowed),
    true
  );
  assert.equal(
    isCatalogColumnTypeCompatible('products', 'tags', { dataType: 'varchar', columnType: 'varchar(100)' }, allowed),
    false
  );
  assert.equal(
    isCatalogColumnTypeCompatible('products', 'tags', { dataType: 'int', columnType: 'int(11)' }, allowed),
    false
  );
});

test('native MySQL JSON passes readiness and exposes semantic storage metadata', async () => {
  const db = completeCatalogDb();
  const result = await inspectCatalogSchema(db, { force: true });
  assert.equal(result.ready, true, JSON.stringify(result));
  assert.deepEqual(result.tagsStorage, {
    dataType: 'json',
    columnType: 'json',
    compatible: true,
  });
  assert.doesNotMatch(result.incompatible.join(','), /products\.tags/);
});

test('engine diagnostics distinguish MySQL native JSON without requesting alteration', async () => {
  const result = await inspectCatalogDatabaseCompatibility(completeCatalogDb());
  assert.deepEqual(result, {
    engine: 'MySQL',
    version: '8.0.42',
    dataType: 'json',
    columnType: 'json',
    compatible: true,
    typeAlteration: 'skipped-semantically-compatible',
  });
});

test('engine diagnostics accept MariaDB LONGTEXT JSON storage without alteration', async () => {
  const result = await inspectCatalogDatabaseCompatibility(completeCatalogDb({
    tagsType: 'longtext',
    version: '10.4.32-MariaDB',
  }));
  assert.equal(result.engine, 'MariaDB');
  assert.equal(result.compatible, true);
  assert.equal(result.typeAlteration, 'skipped-semantically-compatible');
});

test('native JSON repair completes twice without altering its type or values', async () => {
  const db = completeCatalogDb();
  const existingValue = db.tagsValue;
  const first = await migrateCatalogSchemaRepair(db);
  const second = await migrateCatalogSchemaRepair(db);
  assert.equal(first.after.ready, true);
  assert.deepEqual(first.operations, []);
  assert.deepEqual(second.operations, []);
  assert.equal(db.tagsValue, existingValue);
  assert.equal(db.executedSql.some((sql) => /^\s*ALTER TABLE/i.test(sql)), false);
});

test('genuinely incompatible scalar tags storage is rejected without blind alteration', async () => {
  const db = completeCatalogDb({ tagsType: 'int' });
  const readiness = await inspectCatalogSchema(db, { force: true });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.incompatible.includes('products.tags:int'));
  await assert.rejects(
    migrateCatalogSchemaRepair(db),
    (error) => error.code === 'CATALOG_SCHEMA_NOT_READY'
  );
  assert.equal(db.executedSql.some((sql) => /^\s*ALTER TABLE/i.test(sql)), false);
});

test('tag normalization supports parsed arrays, JSON strings, null, and malformed legacy text', () => {
  assert.deepEqual(normalizeCatalogTags(['uno', 2, 'dos']), ['uno', 'dos']);
  assert.deepEqual(normalizeCatalogTags('["uno","dos"]'), ['uno', 'dos']);
  assert.deepEqual(normalizeCatalogTags(null), []);
  assert.deepEqual(normalizeCatalogTags('not-json'), []);
  assert.deepEqual(normalizeCatalogTags({ tag: 'object-not-array' }), []);
});
