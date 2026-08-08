/**
 * Phase 13 migration deployment unit tests.
 * These tests use dependency-injected fakes and must never import config/db or
 * execute scripts/migrate-deploy.js in a child process.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const tracker = require('../scripts/migrationTracker');

function loadDeployRunnerWithFakes(dependencies) {
  const filename = path.resolve(__dirname, '../scripts/migrate-deploy.js');
  const source = fs.readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const fakeRequire = (request) => {
    const replacements = {
      dotenv: { config() {} },
      '../config/db': dependencies.pool,
      './migrationTracker': dependencies.tracker,
      '../services/cmsSchemaReadinessService': {
        assertCmsSchemaReady: dependencies.assertCmsSchemaReady,
      },
      '../services/catalogSchemaReadinessService': {
        assertCatalogSchemaReady: dependencies.assertCatalogSchemaReady,
        inspectCatalogDatabaseCompatibility: dependencies.inspectCatalogDatabaseCompatibility,
      },
    };
    if (!Object.prototype.hasOwnProperty.call(replacements, request)) {
      throw new Error(`Unexpected runner dependency: ${request}`);
    }
    return replacements[request];
  };
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname, console) {${source}\n})`,
    { filename }
  );
  wrapper(module.exports, fakeRequire, module, filename, path.dirname(filename), dependencies.logger);
  return module.exports;
}

describe('Phase 13 — migration registry', () => {
  it('contains the current 36 registered migrations exactly once', () => {
    assert.equal(tracker.MIGRATION_REGISTRY.length, 36);
    assert.equal(new Set(tracker.MIGRATION_REGISTRY.map((entry) => entry.name)).size, 36);
    assert.equal(
      tracker.MIGRATION_REGISTRY.filter((entry) => entry.name === 'migrateCatalogSchemaRepair').length,
      1
    );
  });

  it('keeps meaningful registry metadata', () => {
    for (const entry of tracker.MIGRATION_REGISTRY) {
      assert.ok(entry.name, 'migration name is required');
      assert.ok(entry.file, `migration file is required for ${entry.name}`);
      assert.equal(typeof entry.exportName, 'string', `migration export is required for ${entry.name}`);
    }
  });

  it('uses the production advisory-lock contract', () => {
    assert.equal(tracker.LOCK_NAME, 'migrate_deploy');
    assert.ok(tracker.LOCK_TIMEOUT_SEC > 0);
  });
});

describe('Phase 13 — checksum and tracker SQL contracts', () => {
  it('computes deterministic, distinct SHA-256 checksums', () => {
    const catalogSeo = path.resolve(__dirname, '../scripts/migrate-catalog-seo.js');
    const cms = path.resolve(__dirname, '../scripts/migrate-cms.js');
    const first = tracker.computeChecksum(catalogSeo);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(first, tracker.computeChecksum(catalogSeo));
    assert.notEqual(first, tracker.computeChecksum(cms));
  });

  it('models schema_migrations creation without a database', async () => {
    const calls = [];
    await tracker.ensureMigrationsTable({ query: async (sql, params) => calls.push({ sql, params }) });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS schema_migrations/);
    assert.match(calls[0].sql, /checksum VARCHAR\(64\) NOT NULL/);
    assert.match(calls[0].sql, /status ENUM\('ok','failed'\)/);
  });

  it('models successful and failed migration records without executing SQL', async () => {
    const calls = [];
    const fakePool = { query: async (sql, params) => calls.push({ sql, params }) };
    await tracker.recordMigration(fakePool, 'one', 'abc', 12);
    await tracker.recordMigrationFailure(fakePool, 'two', 'def', 7, 'failure');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params, ['one', 'abc', 12, 'ok']);
    assert.deepEqual(calls[1].params, ['two', 'def', 7, 'failed', 'failure']);
  });

  it('keeps catalog reconciliation meaningful with an injected migration', async () => {
    let migrationCalls = 0;
    const fakePool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status/.test(sql)) {
          return [[{ name: 'repair', checksum: 'same', status: 'ok' }], []];
        }
        throw new Error(`Unexpected fake query: ${sql}`);
      },
    };
    const result = await tracker.runPendingMigrations(fakePool, {
      registry: [{
        name: 'repair', file: './fake-repair', exportName: 'repair',
        capability: 'catalog', passPool: true, reconcileOnDrift: true,
      }],
      checksumFor: () => 'same',
      inspectCatalog: async () => ({ ready: false }),
      formatCatalogIssues: () => 'missing capability',
      loadMigration: () => ({ repair: async (receivedPool) => {
        assert.equal(receivedPool, fakePool);
        migrationCalls += 1;
      } }),
    });
    assert.equal(migrationCalls, 1);
    assert.deepEqual(result, { ran: 0, skipped: 0, reconciled: 1 });
  });
});

describe('Phase 13 — dependency-injected deploy runner', () => {
  function createFakes() {
    const state = { trackerRuns: 0, releases: 0, closes: 0, sqlCalls: 0, logs: [] };
    const connection = {
      query: async () => { state.sqlCalls += 1; throw new Error('Runner fake must not execute SQL.'); },
      release: () => { state.releases += 1; },
    };
    const pool = {
      getConnection: async () => connection,
      query: async () => { state.sqlCalls += 1; throw new Error('Runner fake must not execute SQL.'); },
      end: async () => { state.closes += 1; },
    };
    const trackerFake = {
      acquireLock: async () => true,
      releaseLock: async () => {},
      runPendingMigrations: async () => {
        state.trackerRuns += 1;
        return state.trackerRuns === 1
          ? { ran: 1, skipped: 34, reconciled: 0 }
          : { ran: 0, skipped: 35, reconciled: 0 };
      },
    };
    const logger = {
      log: (message) => state.logs.push(message),
      warn: (message) => state.logs.push(message),
    };
    const deployer = loadDeployRunnerWithFakes({
      pool,
      tracker: trackerFake,
      assertCmsSchemaReady: async () => ({ ready: true }),
      assertCatalogSchemaReady: async () => ({ ready: true }),
      inspectCatalogDatabaseCompatibility: async () => ({
        engine: 'fake', version: '1', dataType: 'json', columnType: 'json',
        compatible: true, typeAlteration: 'not-needed',
      }),
      logger,
    });
    return { deployer, state };
  }

  it('simulates migration deployment without loading modules or executing SQL', async () => {
    const { deployer, state } = createFakes();
    assert.deepEqual(await deployer.run(), { ran: 1, skipped: 34, reconciled: 0 });
    assert.equal(state.sqlCalls, 0);
    assert.equal(state.releases, 1);
  });

  it('remains side-effect free when simulated twice', async () => {
    const { deployer, state } = createFakes();
    await deployer.run();
    assert.deepEqual(await deployer.run(), { ran: 0, skipped: 35, reconciled: 0 });
    assert.equal(state.sqlCalls, 0);
    assert.equal(state.releases, 2);
    assert.equal(state.trackerRuns, 2);
  });

  it('has no real-pool import or migration child process in the test source', () => {
    const source = fs.readFileSync(__filename, 'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\.\/config\/db['"]\)/);
    assert.doesNotMatch(source, /execSync\(['"]node scripts\/migrate-deploy\.js/);
  });
});

describe('Phase 13 — package and schema contracts', () => {
  it('keeps production and development commands unchanged', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.scripts.prestart, 'node scripts/prestart.js');
    assert.equal(pkg.scripts['migrate:deploy'], 'node scripts/migrate-deploy.js');
    assert.equal(pkg.scripts.start, 'node app.js');
    assert.equal(pkg.scripts.migrate, 'node scripts/migrate-all.js');
  });

  it('keeps schema_migrations in the canonical schema', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8');
    assert.match(sql, /schema_migrations/);
  });
});

describe('Phase 3H — Tilopay encoding-only checksum reconciliation', () => {
  const OLD = 'b34806e579a927ebfced8a493115d3f6f0542bf06f26bc1090756a2882771c87';
  const NEW = '164b20c89dbb60d53d0bca3f8c2fa70edb30c6ecf49575b6ea289a88439c40bb';
  const THIRD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // future edit

  const expectedColumns = ['id', 'order_id', 'internal_reference', 'idempotency_key',
    'provider_transaction_id', 'provider_session_token', 'status', 'amount', 'currency',
    'checkout_url', 'provider_created_at', 'confirmed_at', 'failed_at', 'failure_code',
    'failure_message', 'raw_status', 'created_at', 'updated_at'];

  const indexNames = ['PRIMARY', 'idx_tilopay_internal_ref', 'idx_tilopay_idempotency',
    'idx_tilopay_provider_id', 'idx_tilopay_order_created', 'idx_tilopay_status'];

  function validSchemaPool(extraQueries = {}) {
    return {
      async query(sql, params) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) return extraQueries.executedRows || [[{ name: 'migrateTilopay', checksum: OLD, status: 'ok' }], []];
        if (/SELECT checksum FROM schema_migrations/.test(sql)) return extraQueries.checksumRow || [[{ checksum: OLD }], []];
        if (/INFORMATION_SCHEMA.COLUMNS.*tilopay_transactions/.test(sql)) return [expectedColumns.map(c => ({ COLUMN_NAME: c })), []];
        if (/INFORMATION_SCHEMA.STATISTICS.*tilopay_transactions/.test(sql)) return [indexNames.map(n => ({ INDEX_NAME: n })), []];
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];
        throw new Error('Unexpected query: ' + sql.slice(0, 60));
      },
    };
  }

  it('migrateTilopay is in the ENCODING_RECONCILE_REGISTRY with old+new checksums', () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateTilopay;
    assert.ok(e);
    assert.equal(typeof e.verifySchema, 'function');
    assert.ok(e.reason.includes('UTF-16'));
    assert.equal(e.oldChecksum, OLD);
    assert.equal(e.newChecksum, NEW);
  });

  it('encoding reconcile registry has only one entry', () => {
    assert.equal(Object.keys(tracker.ENCODING_RECONCILE_REGISTRY).length, 1);
  });

  it('exact old×new + valid schema reconciles', async () => {
    const result = await tracker.runPendingMigrations(validSchemaPool(), {
      registry: [{ name: 'migrateTilopay', file: './migrate-tilopay', exportName: 'migrate' }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });

  it('wrong old checksum + valid schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool({
        executedRows: [[{ name: 'migrateTilopay', checksum: OLD.replace('b', 'c'), status: 'ok' }], []],
      }), {
        registry: [{ name: 'migrateTilopay', file: './migrate-tilopay', exportName: 'migrate' }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('exact old + arbitrary third checksum + VALID schema fails', async () => {
    // Third checksum with a PERFECTLY valid schema — must still be rejected.
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool(), {
        registry: [{ name: 'migrateTilopay', file: './migrate-tilopay', exportName: 'migrate' }],
        checksumFor: () => THIRD,
      }),
      /Manual review required/
    );
  });

  it('arbitrary old + exact new + VALID schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool({
        executedRows: [[{ name: 'migrateTilopay', checksum: THIRD, status: 'ok' }], []],
      }), {
        registry: [{ name: 'migrateTilopay', file: './migrate-tilopay', exportName: 'migrate' }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('rejects reconciliation when schema does not match', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) return [[{ name: 'migrateTilopay', checksum: OLD, status: 'ok' }], []];
        if (/INFORMATION_SCHEMA.COLUMNS.*tilopay_transactions/.test(sql)) return [[{ COLUMN_NAME: 'id' }], []]; // missing columns
        throw new Error('Unexpected query: ' + sql.slice(0, 60));
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(pool, {
        registry: [{ name: 'migrateTilopay', file: './migrate-tilopay', exportName: 'migrate' }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('rejects drift for a non-registered migration', async () => {
    const fakePool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) return [[{ name: 'migrateOrders', checksum: 'aaa', status: 'ok' }], []];
        throw new Error('Unexpected query');
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(fakePool, {
        registry: [{ name: 'migrateOrders', file: './migrate-orders', exportName: 'migrate' }],
        checksumFor: () => 'bbb',
      }),
      /Manual review required/
    );
  });

  it('normal already-matching migration is unaffected', async () => {
    const fakePool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) return [[{ name: 'migrateOrders', checksum: 'same_checksum', status: 'ok' }], []];
        throw new Error('Unexpected query');
      },
    };
    const result = await tracker.runPendingMigrations(fakePool, {
      registry: [{ name: 'migrateOrders', file: './migrate-orders', exportName: 'migrate' }],
      checksumFor: () => 'same_checksum',
    });
    assert.equal(result.reconciled, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });

  it('reconciliation updates only schema_migrations.checksum, never reruns SQL', async () => {
    const migrationCalls = [];
    const pool = {
      async query(sql, params) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) return [[{ name: 'migrateTilopay', checksum: OLD, status: 'ok' }], []];
        if (/SELECT checksum FROM schema_migrations/.test(sql)) return [[{ checksum: OLD }], []];
        if (/INFORMATION_SCHEMA.COLUMNS.*tilopay_transactions/.test(sql)) return [expectedColumns.map(c => ({ COLUMN_NAME: c })), []];
        if (/INFORMATION_SCHEMA.STATISTICS.*tilopay_transactions/.test(sql)) return [indexNames.map(n => ({ INDEX_NAME: n })), []];
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];
        throw new Error('Unexpected query');
      },
    };
    const result = await tracker.runPendingMigrations(pool, {
      registry: [{ name: 'migrateTilopay', file: './migrate-tilopay', exportName: 'migrate' }],
      checksumFor: () => NEW,
      loadMigration: () => ({
        migrate: async () => { migrationCalls.push('migrate called'); },
      }),
    });
    assert.equal(result.reconciled, 1);
    assert.equal(migrationCalls.length, 0, 'Migration SQL must NOT be rerun');
  });

  it('subsequent run with exact new checksum already stored follows normal skip', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) return [[{ name: 'migrateTilopay', checksum: NEW, status: 'ok' }], []];
        throw new Error('Unexpected query');
      },
    };
    const result = await tracker.runPendingMigrations(pool, {
      registry: [{ name: 'migrateTilopay', file: './migrate-tilopay', exportName: 'migrate' }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });
});
