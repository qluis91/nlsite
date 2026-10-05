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
  it('contains the current 38 registered migrations exactly once', () => {
    assert.equal(tracker.MIGRATION_REGISTRY.length, 38);
    assert.equal(new Set(tracker.MIGRATION_REGISTRY.map((entry) => entry.name)).size, 38);
    assert.equal(
      tracker.MIGRATION_REGISTRY.filter((entry) => entry.name === 'migrateCatalogSchemaRepair').length,
      1
    );
    assert.equal(
      tracker.MIGRATION_REGISTRY.filter((entry) => entry.name === 'migrateStoreHeroSectionRepair').length,
      1
    );
    assert.equal(
      tracker.MIGRATION_REGISTRY.filter((entry) => entry.name === 'migrateCostQuoteVarcharId').length,
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

  it('LF and CRLF versions of the same content produce the same checksum', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nlsite-checksum-'));
    const lfPath = path.join(dir, 'lf.js');
    const crlfPath = path.join(dir, 'crlf.js');
    const crPath = path.join(dir, 'cr.js');
    const body = "console.log('migrate');\nconst x = 1;\n";
    fs.writeFileSync(lfPath, body, 'utf8');
    fs.writeFileSync(crlfPath, body.replace(/\n/g, '\r\n'), 'utf8');
    fs.writeFileSync(crPath, body.replace(/\n/g, '\r'), 'utf8');
    try {
      const lf = tracker.computeChecksum(lfPath);
      const crlf = tracker.computeChecksum(crlfPath);
      const cr = tracker.computeChecksum(crPath);
      assert.equal(lf, crlf);
      assert.equal(lf, cr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('real content changes still produce different checksums after normalization', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nlsite-checksum-'));
    const aPath = path.join(dir, 'a.js');
    const bPath = path.join(dir, 'b.js');
    fs.writeFileSync(aPath, "const version = 1;\r\n", 'utf8');
    fs.writeFileSync(bPath, "const version = 2;\r\n", 'utf8');
    try {
      assert.notEqual(tracker.computeChecksum(aPath), tracker.computeChecksum(bPath));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

  it('encoding reconcile registry includes core and historical encoding-drift entries', () => {
    assert.ok(Object.keys(tracker.ENCODING_RECONCILE_REGISTRY).length >= 30);
    assert.ok(tracker.ENCODING_RECONCILE_REGISTRY.migrateTilopay);
    assert.ok(tracker.ENCODING_RECONCILE_REGISTRY.migrateCmsHomepageFields);
    assert.ok(tracker.ENCODING_RECONCILE_REGISTRY.migrateUserAddresses);
    assert.ok(tracker.ENCODING_RECONCILE_REGISTRY.migrateUserProfile);
    assert.ok(tracker.ENCODING_RECONCILE_REGISTRY.migrateCms);
    assert.ok(tracker.ENCODING_RECONCILE_REGISTRY.migrateNavigationItems);
    assert.ok(tracker.ENCODING_RECONCILE_REGISTRY.migratePanels);
    assert.ok(tracker.ENCODING_RECONCILE_REGISTRY.migrateOrders);
    assert.ok(tracker.ENCODING_RECONCILE_REGISTRY.migrateSocialFeed);
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

describe('Phase 3H — CMS homepage fields encoding-only checksum reconciliation', () => {
  const OLD = '19c2ae211bf7cd0aeb5137cb2ac2088ceeffee5680e8bdc3e6c10700707f7a4f';
  const NEW = '3ae1a43e24bcd2d0b93c1bedaaa0f63ccc8250b252f99ce73527e1b8d4e463e3';
  const THIRD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  const socialColumns = [
    'id', 'public_id', 'page_section_id', 'platform', 'label', 'profile_url',
    'aria_label', 'media_public_id', 'sort_order', 'is_visible', 'status',
    'published_data', 'published_at', 'created_by', 'updated_by',
    'created_at', 'updated_at', 'deleted_at',
  ];

  function validSchemaPool(extraQueries = {}) {
    return {
      async query(sql, params) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return extraQueries.executedRows
            || [[{ name: 'migrateCmsHomepageFields', checksum: OLD, status: 'ok' }], []];
        }
        if (/SELECT checksum FROM schema_migrations/.test(sql)) {
          return extraQueries.checksumRow || [[{ checksum: OLD }], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS.*home_social_items/.test(sql) && !/COLUMN_NAME = \?/.test(sql)) {
          return [socialColumns.map((c) => ({ COLUMN_NAME: c })), []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql) && /COLUMN_NAME = \?/.test(sql)) {
          const col = params?.[1];
          const allowed = new Set([
            'media_alt', 'preview_media_alt', 'button_label', 'link_aria_label',
          ]);
          if (allowed.has(col)) return [[{ ok: 1 }], []];
          return [[], []];
        }
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
  }

  it('migrateCmsHomepageFields is in the ENCODING_RECONCILE_REGISTRY with old+new checksums', () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateCmsHomepageFields;
    assert.ok(e);
    assert.equal(typeof e.verifySchema, 'function');
    assert.equal(e.oldChecksum, OLD);
    assert.equal(e.newChecksum, NEW);
  });

  it('exact old×new + valid schema reconciles', async () => {
    const result = await tracker.runPendingMigrations(validSchemaPool(), {
      registry: [{
        name: 'migrateCmsHomepageFields',
        file: './migrate-cms-homepage-fields',
        exportName: 'migrateCmsHomepageFields',
      }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });

  it('wrong checksum + valid schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool({
        executedRows: [[{ name: 'migrateCmsHomepageFields', checksum: OLD.replace('19', '29'), status: 'ok' }], []],
      }), {
        registry: [{
          name: 'migrateCmsHomepageFields',
          file: './migrate-cms-homepage-fields',
          exportName: 'migrateCmsHomepageFields',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('exact old + third checksum + VALID schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool(), {
        registry: [{
          name: 'migrateCmsHomepageFields',
          file: './migrate-cms-homepage-fields',
          exportName: 'migrateCmsHomepageFields',
        }],
        checksumFor: () => THIRD,
      }),
      /Manual review required/
    );
  });

  it('rejects reconciliation when schema does not match', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateCmsHomepageFields', checksum: OLD, status: 'ok' }], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS.*home_social_items/.test(sql)) {
          return [[{ COLUMN_NAME: 'id' }], []]; // missing required columns
        }
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(pool, {
        registry: [{
          name: 'migrateCmsHomepageFields',
          file: './migrate-cms-homepage-fields',
          exportName: 'migrateCmsHomepageFields',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('subsequent run with exact new checksum already stored follows normal skip', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateCmsHomepageFields', checksum: NEW, status: 'ok' }], []];
        }
        throw new Error('Unexpected query');
      },
    };
    const result = await tracker.runPendingMigrations(pool, {
      registry: [{
        name: 'migrateCmsHomepageFields',
        file: './migrate-cms-homepage-fields',
        exportName: 'migrateCmsHomepageFields',
      }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });
});

describe('migrateUserAddresses encoding-only checksum reconciliation', () => {
  const OLD = '2a7cac71e27ede34ef11b395644eb6dd2a2d7592667b0617e8b8a0bc549517e4';
  const NEW = '98250dd561e29acc944a360e3a2c7150eb67282ed822b8b13fe3eb21e5acc2b3';
  const THIRD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  const expectedColumns = [
    'id', 'user_id', 'label', 'province', 'canton', 'district',
    'address_line', 'address_reference', 'contact_phone', 'is_default',
    'created_at', 'updated_at',
  ];
  const indexNames = [
    'PRIMARY', 'idx_user_addresses_user', 'idx_user_addresses_user_default',
  ];

  function validSchemaPool(extraQueries = {}) {
    return {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return extraQueries.executedRows
            || [[{ name: 'migrateUserAddresses', checksum: OLD, status: 'ok' }], []];
        }
        if (/SELECT checksum FROM schema_migrations/.test(sql)) {
          return extraQueries.checksumRow || [[{ checksum: OLD }], []];
        }
        if (/INFORMATION_SCHEMA\.KEY_COLUMN_USAGE[\s\S]*user_addresses/.test(sql)) {
          return [[{
            CONSTRAINT_NAME: 'fk_user_addresses_user',
            REFERENCED_TABLE_NAME: 'users',
            REFERENCED_COLUMN_NAME: 'id',
          }], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS[\s\S]*user_addresses/.test(sql)) {
          return [expectedColumns.map((c) => ({ COLUMN_NAME: c })), []];
        }
        if (/INFORMATION_SCHEMA\.STATISTICS[\s\S]*user_addresses/.test(sql)) {
          return [indexNames.map((n) => ({ INDEX_NAME: n })), []];
        }
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
  }

  it('migrateUserAddresses is in the ENCODING_RECONCILE_REGISTRY with old+new checksums', () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateUserAddresses;
    assert.ok(e);
    assert.equal(typeof e.verifySchema, 'function');
    assert.equal(e.oldChecksum, OLD);
    assert.equal(e.newChecksum, NEW);
  });

  it('exact old×new + valid schema reconciles', async () => {
    const result = await tracker.runPendingMigrations(validSchemaPool(), {
      registry: [{
        name: 'migrateUserAddresses',
        file: './migrate-user-addresses',
        exportName: 'migrateUserAddresses',
      }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });

  it('wrong old checksum + valid schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool({
        executedRows: [[{ name: 'migrateUserAddresses', checksum: OLD.replace('2a', '3b'), status: 'ok' }], []],
      }), {
        registry: [{
          name: 'migrateUserAddresses',
          file: './migrate-user-addresses',
          exportName: 'migrateUserAddresses',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('exact old + third checksum + VALID schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool(), {
        registry: [{
          name: 'migrateUserAddresses',
          file: './migrate-user-addresses',
          exportName: 'migrateUserAddresses',
        }],
        checksumFor: () => THIRD,
      }),
      /Manual review required/
    );
  });

  it('rejects reconciliation when schema does not match', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateUserAddresses', checksum: OLD, status: 'ok' }], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS[\s\S]*user_addresses/.test(sql)) {
          return [[{ COLUMN_NAME: 'id' }], []]; // missing required columns
        }
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(pool, {
        registry: [{
          name: 'migrateUserAddresses',
          file: './migrate-user-addresses',
          exportName: 'migrateUserAddresses',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('rejects reconciliation when FK is missing', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateUserAddresses', checksum: OLD, status: 'ok' }], []];
        }
        if (/INFORMATION_SCHEMA\.KEY_COLUMN_USAGE[\s\S]*user_addresses/.test(sql)) {
          return [[], []]; // no FK
        }
        if (/INFORMATION_SCHEMA\.COLUMNS[\s\S]*user_addresses/.test(sql)) {
          return [expectedColumns.map((c) => ({ COLUMN_NAME: c })), []];
        }
        if (/INFORMATION_SCHEMA\.STATISTICS[\s\S]*user_addresses/.test(sql)) {
          return [indexNames.map((n) => ({ INDEX_NAME: n })), []];
        }
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(pool, {
        registry: [{
          name: 'migrateUserAddresses',
          file: './migrate-user-addresses',
          exportName: 'migrateUserAddresses',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('subsequent run with exact new checksum already stored follows normal skip', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateUserAddresses', checksum: NEW, status: 'ok' }], []];
        }
        throw new Error('Unexpected query');
      },
    };
    const result = await tracker.runPendingMigrations(pool, {
      registry: [{
        name: 'migrateUserAddresses',
        file: './migrate-user-addresses',
        exportName: 'migrateUserAddresses',
      }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });
});

describe('migrateUserProfile encoding-only checksum reconciliation', () => {
  const OLD = '70787565a4d77438fb9ff12234edad50c95d1230854dd2923b96f570f263b344';
  const NEW = '15c2f21bd3b28c27832f8889a46365dfc89e2affc34620c9790209dfdf48bcbf';
  const THIRD = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

  const profileColumns = ['last_name', 'phone', 'avatar_path', 'password_changed_at'];

  function validSchemaPool(extraQueries = {}) {
    return {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return extraQueries.executedRows
            || [[{ name: 'migrateUserProfile', checksum: OLD, status: 'ok' }], []];
        }
        if (/SELECT checksum FROM schema_migrations/.test(sql)) {
          return extraQueries.checksumRow || [[{ checksum: OLD }], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS[\s\S]*TABLE_NAME = 'users'/.test(sql)) {
          return [
            ['id', 'name', 'email', 'password', ...profileColumns].map((c) => ({ COLUMN_NAME: c })),
            [],
          ];
        }
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
  }

  it('migrateUserProfile is in the ENCODING_RECONCILE_REGISTRY with old+new checksums', () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateUserProfile;
    assert.ok(e);
    assert.equal(typeof e.verifySchema, 'function');
    assert.equal(e.oldChecksum, OLD);
    assert.equal(e.newChecksum, NEW);
  });

  it('exact old×new + valid schema reconciles', async () => {
    const result = await tracker.runPendingMigrations(validSchemaPool(), {
      registry: [{
        name: 'migrateUserProfile',
        file: './migrate-user-profile',
        exportName: 'migrateUserProfile',
      }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });

  it('wrong old checksum + valid schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool({
        executedRows: [[{ name: 'migrateUserProfile', checksum: OLD.replace('70', '80'), status: 'ok' }], []],
      }), {
        registry: [{
          name: 'migrateUserProfile',
          file: './migrate-user-profile',
          exportName: 'migrateUserProfile',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('exact old + unexpected new checksum + VALID schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool(), {
        registry: [{
          name: 'migrateUserProfile',
          file: './migrate-user-profile',
          exportName: 'migrateUserProfile',
        }],
        checksumFor: () => THIRD,
      }),
      /Manual review required/
    );
  });

  it('rejects reconciliation when schema is incomplete', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateUserProfile', checksum: OLD, status: 'ok' }], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS[\s\S]*TABLE_NAME = 'users'/.test(sql)) {
          return [[{ COLUMN_NAME: 'id' }, { COLUMN_NAME: 'last_name' }], []]; // missing phone/avatar/password_changed_at
        }
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(pool, {
        registry: [{
          name: 'migrateUserProfile',
          file: './migrate-user-profile',
          exportName: 'migrateUserProfile',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('subsequent run with exact new checksum already stored follows normal skip', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateUserProfile', checksum: NEW, status: 'ok' }], []];
        }
        throw new Error('Unexpected query');
      },
    };
    const result = await tracker.runPendingMigrations(pool, {
      registry: [{
        name: 'migrateUserProfile',
        file: './migrate-user-profile',
        exportName: 'migrateUserProfile',
      }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });
});

describe('migrateCms encoding-only checksum reconciliation', () => {
  const OLD = '2ef57e9cae09dc784ba1efdcd6f3ba4776e15f4fb1b3ac93873d17f9faae6c9a';
  const NEW = '08fe0a407d6df4f2b6d18e42b46340b65094a2b1691101bf01b42652a8d846a3';
  const THIRD = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

  const requiredTables = [
    'media_assets', 'pages', 'page_sections', 'site_settings', 'content_revisions',
  ];
  const siteSettingsColumns = [
    'value_type', 'setting_group', 'is_public', 'updated_by', 'created_at',
  ];

  function validSchemaPool(extraQueries = {}) {
    return {
      async query(sql, params) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return extraQueries.executedRows
            || [[{ name: 'migrateCms', checksum: OLD, status: 'ok' }], []];
        }
        if (/SELECT checksum FROM schema_migrations/.test(sql)) {
          return extraQueries.checksumRow || [[{ checksum: OLD }], []];
        }
        if (/INFORMATION_SCHEMA\.TABLES[\s\S]*TABLE_NAME = \?/.test(sql)) {
          const table = params?.[0];
          if (requiredTables.includes(table)) return [[{ ok: 1 }], []];
          return [[], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS[\s\S]*site_settings[\s\S]*COLUMN_NAME = \?/.test(sql)
          || (/INFORMATION_SCHEMA\.COLUMNS/.test(sql) && /COLUMN_NAME = \?/.test(sql))) {
          const col = params?.[0];
          if (siteSettingsColumns.includes(col)) return [[{ ok: 1 }], []];
          return [[], []];
        }
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
  }

  it('migrateCms is in the ENCODING_RECONCILE_REGISTRY with old+new checksums', () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateCms;
    assert.ok(e);
    assert.equal(typeof e.verifySchema, 'function');
    assert.equal(e.oldChecksum, OLD);
    assert.equal(e.newChecksum, NEW);
  });

  it('exact old×new + valid schema reconciles', async () => {
    const result = await tracker.runPendingMigrations(validSchemaPool(), {
      registry: [{ name: 'migrateCms', file: './migrate-cms', exportName: 'migrateCms' }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });

  it('wrong old checksum + valid schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool({
        executedRows: [[{ name: 'migrateCms', checksum: OLD.replace('2e', '3f'), status: 'ok' }], []],
      }), {
        registry: [{ name: 'migrateCms', file: './migrate-cms', exportName: 'migrateCms' }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('exact old + unexpected new checksum + VALID schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool(), {
        registry: [{ name: 'migrateCms', file: './migrate-cms', exportName: 'migrateCms' }],
        checksumFor: () => THIRD,
      }),
      /Manual review required/
    );
  });

  it('rejects reconciliation when a required table is missing', async () => {
    const pool = {
      async query(sql, params) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateCms', checksum: OLD, status: 'ok' }], []];
        }
        if (/INFORMATION_SCHEMA\.TABLES/.test(sql)) {
          if (params?.[0] === 'media_assets') return [[], []]; // missing
          return [[{ ok: 1 }], []];
        }
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(pool, {
        registry: [{ name: 'migrateCms', file: './migrate-cms', exportName: 'migrateCms' }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('rejects reconciliation when site_settings additive columns are incomplete', async () => {
    const pool = {
      async query(sql, params) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateCms', checksum: OLD, status: 'ok' }], []];
        }
        if (/INFORMATION_SCHEMA\.TABLES/.test(sql)) return [[{ ok: 1 }], []];
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
          if (params?.[0] === 'value_type') return [[{ ok: 1 }], []];
          return [[], []]; // missing remaining columns
        }
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(pool, {
        registry: [{ name: 'migrateCms', file: './migrate-cms', exportName: 'migrateCms' }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('subsequent run with exact new checksum already stored follows normal skip', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateCms', checksum: NEW, status: 'ok' }], []];
        }
        throw new Error('Unexpected query');
      },
    };
    const result = await tracker.runPendingMigrations(pool, {
      registry: [{ name: 'migrateCms', file: './migrate-cms', exportName: 'migrateCms' }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });
});

describe('migrateNavigationItems encoding-only checksum reconciliation', () => {
  const OLD = '75308f0d0c2c5a07242d82b87a432aae2b3da64c042561beff3b0c0dadd2c48e';
  const NEW = 'b0598767785ed624d0b6787ff64644347725fbdeb04f27928b704ddb0dcfc36d';
  const THIRD = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

  const expectedColumns = [
    'id', 'public_id', 'location', 'parent_id', 'label', 'url', 'link_type',
    'target', 'media_public_id', 'sort_order', 'is_visible', 'status',
    'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at',
  ];
  const indexNames = [
    'PRIMARY',
    'uq_navigation_items_public_id',
    'idx_navigation_items_location_status',
    'idx_navigation_items_parent',
  ];
  const fkRows = [
    { CONSTRAINT_NAME: 'fk_navigation_items_parent', REFERENCED_TABLE_NAME: 'navigation_items', REFERENCED_COLUMN_NAME: 'id' },
    { CONSTRAINT_NAME: 'fk_navigation_items_creator', REFERENCED_TABLE_NAME: 'users', REFERENCED_COLUMN_NAME: 'id' },
    { CONSTRAINT_NAME: 'fk_navigation_items_updater', REFERENCED_TABLE_NAME: 'users', REFERENCED_COLUMN_NAME: 'id' },
  ];

  function validSchemaPool(extraQueries = {}) {
    return {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return extraQueries.executedRows
            || [[{ name: 'migrateNavigationItems', checksum: OLD, status: 'ok' }], []];
        }
        if (/SELECT checksum FROM schema_migrations/.test(sql)) {
          return extraQueries.checksumRow || [[{ checksum: OLD }], []];
        }
        if (/INFORMATION_SCHEMA\.KEY_COLUMN_USAGE[\s\S]*navigation_items/.test(sql)) {
          return [fkRows, []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS[\s\S]*navigation_items/.test(sql)) {
          return [expectedColumns.map((c) => ({ COLUMN_NAME: c })), []];
        }
        if (/INFORMATION_SCHEMA\.STATISTICS[\s\S]*navigation_items/.test(sql)) {
          return [indexNames.map((n) => ({ INDEX_NAME: n })), []];
        }
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
  }

  it('migrateNavigationItems is in the ENCODING_RECONCILE_REGISTRY with old+new checksums', () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateNavigationItems;
    assert.ok(e);
    assert.equal(typeof e.verifySchema, 'function');
    assert.equal(e.oldChecksum, OLD);
    assert.equal(e.newChecksum, NEW);
  });

  it('exact old×new + valid schema reconciles', async () => {
    const result = await tracker.runPendingMigrations(validSchemaPool(), {
      registry: [{
        name: 'migrateNavigationItems',
        file: './migrate-nav-items',
        exportName: 'migrateNavigationItems',
      }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });

  it('wrong old checksum + valid schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool({
        executedRows: [[{ name: 'migrateNavigationItems', checksum: OLD.replace('75', '85'), status: 'ok' }], []],
      }), {
        registry: [{
          name: 'migrateNavigationItems',
          file: './migrate-nav-items',
          exportName: 'migrateNavigationItems',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('exact old + unexpected new checksum + VALID schema fails', async () => {
    await assert.rejects(
      () => tracker.runPendingMigrations(validSchemaPool(), {
        registry: [{
          name: 'migrateNavigationItems',
          file: './migrate-nav-items',
          exportName: 'migrateNavigationItems',
        }],
        checksumFor: () => THIRD,
      }),
      /Manual review required/
    );
  });

  it('rejects reconciliation when schema is incomplete', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateNavigationItems', checksum: OLD, status: 'ok' }], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS[\s\S]*navigation_items/.test(sql)) {
          return [[{ COLUMN_NAME: 'id' }], []];
        }
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(pool, {
        registry: [{
          name: 'migrateNavigationItems',
          file: './migrate-nav-items',
          exportName: 'migrateNavigationItems',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('rejects reconciliation when an FK is missing', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateNavigationItems', checksum: OLD, status: 'ok' }], []];
        }
        if (/INFORMATION_SCHEMA\.KEY_COLUMN_USAGE[\s\S]*navigation_items/.test(sql)) {
          return [fkRows.filter((fk) => fk.CONSTRAINT_NAME !== 'fk_navigation_items_parent'), []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS[\s\S]*navigation_items/.test(sql)) {
          return [expectedColumns.map((c) => ({ COLUMN_NAME: c })), []];
        }
        if (/INFORMATION_SCHEMA\.STATISTICS[\s\S]*navigation_items/.test(sql)) {
          return [indexNames.map((n) => ({ INDEX_NAME: n })), []];
        }
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
    await assert.rejects(
      () => tracker.runPendingMigrations(pool, {
        registry: [{
          name: 'migrateNavigationItems',
          file: './migrate-nav-items',
          exportName: 'migrateNavigationItems',
        }],
        checksumFor: () => NEW,
      }),
      /Manual review required/
    );
  });

  it('subsequent run with exact new checksum already stored follows normal skip', async () => {
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateNavigationItems', checksum: NEW, status: 'ok' }], []];
        }
        throw new Error('Unexpected query');
      },
    };
    const result = await tracker.runPendingMigrations(pool, {
      registry: [{
        name: 'migrateNavigationItems',
        file: './migrate-nav-items',
        exportName: 'migrateNavigationItems',
      }],
      checksumFor: () => NEW,
    });
    assert.equal(result.reconciled, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });
});

describe('historical encoding-drift reconciliations (contract-backed)', () => {
  const {
    HISTORICAL_RECONCILE_CHECKSUMS,
    CONTRACTS,
  } = require('../scripts/migrationSchemaContracts');

  const SAMPLE = [
    'migratePanels',
    'migrateOrders',
    'migrateTracking',
    'migrateSocialFeed',
    'migrateSeedTikTok',
  ];

  function contractPool(name, { executedChecksum, schemaOk = true } = {}) {
    const entry = tracker.ENCODING_RECONCILE_REGISTRY[name];
    const contract = CONTRACTS[name];
    const old = executedChecksum || entry.oldChecksum;
    return {
      async query(sql, params) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name, checksum: old, status: 'ok' }], []];
        }
        if (/SELECT checksum FROM schema_migrations/.test(sql)) return [[{ checksum: old }], []];
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];

        if (!schemaOk) {
          if (/INFORMATION_SCHEMA\.TABLES/.test(sql)) return [[], []];
          if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) return [[], []];
          if (/INFORMATION_SCHEMA\.STATISTICS/.test(sql)) return [[], []];
          if (/INFORMATION_SCHEMA\.KEY_COLUMN_USAGE/.test(sql)) return [[], []];
          if (/SELECT 1 AS ok FROM/.test(sql)) return [[], []];
        }

        if (/INFORMATION_SCHEMA\.TABLES/.test(sql)) return [[{ ok: 1 }], []];
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
          const table = params?.[0];
          const cols = (contract.columns && contract.columns[table]) || ['id'];
          return [cols.map((c) => ({ COLUMN_NAME: c })), []];
        }
        if (/INFORMATION_SCHEMA\.STATISTICS/.test(sql)) {
          const table = params?.[0];
          const indexes = (contract.indexes && contract.indexes[table]) || ['PRIMARY'];
          return [indexes.map((n) => ({ INDEX_NAME: n })), []];
        }
        if (/INFORMATION_SCHEMA\.KEY_COLUMN_USAGE/.test(sql)) {
          const fk = (contract.foreignKeys || []).find(
            (f) => f.table === params?.[0] && f.column === params?.[1]
          );
          if (!fk) return [[], []];
          return [[{
            CONSTRAINT_NAME: fk.name || 'auto_fk',
            REFERENCED_TABLE_NAME: fk.refTable,
            REFERENCED_COLUMN_NAME: fk.refColumn,
          }], []];
        }
        if (/SELECT 1 AS ok FROM/.test(sql)) return [[{ ok: 1 }], []];
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
  }

  it('registers every historical checksum pair with a verifier', () => {
    for (const name of Object.keys(HISTORICAL_RECONCILE_CHECKSUMS)) {
      const e = tracker.ENCODING_RECONCILE_REGISTRY[name];
      assert.ok(e, name);
      assert.equal(e.oldChecksum, HISTORICAL_RECONCILE_CHECKSUMS[name].oldChecksum);
      assert.equal(e.newChecksum, HISTORICAL_RECONCILE_CHECKSUMS[name].newChecksum);
      assert.equal(typeof e.verifySchema, 'function');
    }
  });

  for (const name of SAMPLE) {
    it(`${name}: exact old×new + valid schema reconciles`, async () => {
      const e = tracker.ENCODING_RECONCILE_REGISTRY[name];
      const result = await tracker.runPendingMigrations(contractPool(name), {
        registry: [{ name, file: `./${name.replace(/^migrate/, 'migrate-').replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()).replace(/^-/, '').replace('migrate--', 'migrate-')}`, exportName: name }],
        checksumFor: () => e.newChecksum,
      });
      assert.equal(result.reconciled, 1);
      assert.equal(result.skipped, 1);
    });

    it(`${name}: wrong old checksum fails`, async () => {
      const e = tracker.ENCODING_RECONCILE_REGISTRY[name];
      await assert.rejects(
        () => tracker.runPendingMigrations(
          contractPool(name, { executedChecksum: e.oldChecksum.replace(/^[0-9a-f]{2}/, 'ff') }),
          {
            registry: [{ name, file: './migrate-panels', exportName: name }],
            checksumFor: () => e.newChecksum,
          }
        ),
        /Manual review required/
      );
    });

    it(`${name}: incomplete schema fails`, async () => {
      const e = tracker.ENCODING_RECONCILE_REGISTRY[name];
      await assert.rejects(
        () => tracker.runPendingMigrations(contractPool(name, { schemaOk: false }), {
          registry: [{ name, file: './migrate-panels', exportName: name }],
          checksumFor: () => e.newChecksum,
        }),
        /Manual review required/
      );
    });
  }

  it('migrateTilopay accepts alternate CRLF old checksum with valid schema', async () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateTilopay;
    const alt = e.alternateOldChecksums[0];
    const expectedColumns = ['id', 'order_id', 'internal_reference', 'idempotency_key',
      'provider_transaction_id', 'provider_session_token', 'status', 'amount', 'currency',
      'checkout_url', 'provider_created_at', 'confirmed_at', 'failed_at', 'failure_code',
      'failure_message', 'raw_status', 'created_at', 'updated_at'];
    const indexNames = ['PRIMARY', 'idx_tilopay_internal_ref', 'idx_tilopay_idempotency',
      'idx_tilopay_provider_id', 'idx_tilopay_order_created', 'idx_tilopay_status'];
    const pool = {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name: 'migrateTilopay', checksum: alt, status: 'ok' }], []];
        }
        if (/SELECT checksum FROM schema_migrations/.test(sql)) return [[{ checksum: alt }], []];
        if (/INFORMATION_SCHEMA.COLUMNS.*tilopay_transactions/.test(sql)) {
          return [expectedColumns.map((c) => ({ COLUMN_NAME: c })), []];
        }
        if (/INFORMATION_SCHEMA.STATISTICS.*tilopay_transactions/.test(sql)) {
          return [indexNames.map((n) => ({ INDEX_NAME: n })), []];
        }
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];
        throw new Error('Unexpected query: ' + sql.slice(0, 60));
      },
    };
    const result = await tracker.runPendingMigrations(pool, {
      registry: [{ name: 'migrateTilopay', file: './migrate-tilopay', exportName: 'migrate' }],
      checksumFor: () => e.newChecksum,
    });
    assert.equal(result.reconciled, 1);
  });
});

describe('migrateCostQuote historical restoration checksum reconciliation', () => {
  const REQUIRED = [
    'product_name', 'payload', 'workflow_status', 'public_token',
    'client_email', 'client_name', 'total_crc', 'linked_order_id',
    'pdf_filename', 'workflow_data', 'created_by', 'created_at', 'updated_at',
  ];

  function costQuotePool({ executedChecksum, schemaOk = true, name = 'migrateCostQuote' } = {}) {
    const e = tracker.ENCODING_RECONCILE_REGISTRY[name];
    const old = executedChecksum || e.oldChecksum;
    return {
      async query(sql) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
        if (/SELECT name, checksum, status.*WHERE status = 'ok'/.test(sql)) {
          return [[{ name, checksum: old, status: 'ok' }], []];
        }
        if (/SELECT checksum FROM schema_migrations/.test(sql)) return [[{ checksum: old }], []];
        if (/UPDATE schema_migrations SET checksum/.test(sql)) return [{ affectedRows: 1 }, []];
        if (/INFORMATION_SCHEMA\.COLUMNS.*cost_quotes/.test(sql) || /TABLE_NAME = 'cost_quotes'/.test(sql)) {
          if (!schemaOk) return [[], []];
          return [REQUIRED.map((c) => ({ COLUMN_NAME: c })).concat([{ COLUMN_NAME: 'id' }]), []];
        }
        throw new Error('Unexpected query: ' + sql.slice(0, 80));
      },
    };
  }

  it('registers exact accidental→historical pair with schema verifier', () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateCostQuote;
    assert.equal(
      e.oldChecksum,
      '4c8f3afe00c55b82f17d3e1071644dd263d45d93aaca050f782afd6dc7c104e1'
    );
    assert.equal(
      e.newChecksum,
      '38559820fc53174409ed3c196d0ca8ec331733eb003dd51fe9d92996801247a1'
    );
    assert.match(e.reason, /restore historical migrateCostQuote source/);
    assert.equal(typeof e.verifySchema, 'function');
  });

  it('exact accidental×historical + verified schema reconciles', async () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateCostQuote;
    const result = await tracker.runPendingMigrations(costQuotePool(), {
      registry: [{ name: 'migrateCostQuote', file: './migrate-cost-quote', exportName: 'migrate' }],
      checksumFor: () => e.newChecksum,
    });
    assert.equal(result.reconciled, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.ran, 0);
  });

  it('wrong old checksum fails', async () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateCostQuote;
    await assert.rejects(
      () =>
        tracker.runPendingMigrations(
          costQuotePool({ executedChecksum: e.oldChecksum.replace('4c', '5d') }),
          {
            registry: [{ name: 'migrateCostQuote', file: './migrate-cost-quote', exportName: 'migrate' }],
            checksumFor: () => e.newChecksum,
          }
        ),
      /Manual review required/
    );
  });

  it('wrong current checksum fails', async () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateCostQuote;
    await assert.rejects(
      () =>
        tracker.runPendingMigrations(costQuotePool(), {
          registry: [{ name: 'migrateCostQuote', file: './migrate-cost-quote', exportName: 'migrate' }],
          checksumFor: () => e.newChecksum.replace('38', '39'),
        }),
      /Manual review required/
    );
  });

  it('incomplete schema fails', async () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateCostQuote;
    await assert.rejects(
      () =>
        tracker.runPendingMigrations(costQuotePool({ schemaOk: false }), {
          registry: [{ name: 'migrateCostQuote', file: './migrate-cost-quote', exportName: 'migrate' }],
          checksumFor: () => e.newChecksum,
        }),
      /Manual review required/
    );
  });

  it('unexpected third checksum is rejected even with valid schema', async () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateCostQuote;
    await assert.rejects(
      () =>
        tracker.runPendingMigrations(costQuotePool(), {
          registry: [{ name: 'migrateCostQuote', file: './migrate-cost-quote', exportName: 'migrate' }],
          checksumFor: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }),
      /Manual review required/
    );
    // silence unused
    assert.ok(e.newChecksum);
  });

  it('migrateCostQuoteVarcharId exact import-move pair reconciles with verified schema', async () => {
    const e = tracker.ENCODING_RECONCILE_REGISTRY.migrateCostQuoteVarcharId;
    assert.equal(
      e.oldChecksum,
      '54e611fdf1b8ec67e30497761ddb83a371882e09196d242d81f19b274d31a3cb'
    );
    assert.equal(
      e.newChecksum,
      '1e13a3c5291c4d79ac30f393bccad548a08b756580841eaa9e06fe9990fc0375'
    );
    const result = await tracker.runPendingMigrations(
      costQuotePool({ name: 'migrateCostQuoteVarcharId' }),
      {
        registry: [{
          name: 'migrateCostQuoteVarcharId',
          file: './migrate-cost-quote-varchar-id',
          exportName: 'migrateCostQuoteVarcharId',
          passPool: true,
        }],
        checksumFor: () => e.newChecksum,
      }
    );
    assert.equal(result.reconciled, 1);
  });
});
