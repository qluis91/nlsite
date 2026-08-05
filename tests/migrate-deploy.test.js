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
  it('contains the current 35 registered migrations exactly once', () => {
    assert.equal(tracker.MIGRATION_REGISTRY.length, 35);
    assert.equal(new Set(tracker.MIGRATION_REGISTRY.map((entry) => entry.name)).size, 35);
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
