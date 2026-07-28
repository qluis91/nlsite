/**
 * Production migration deployer. Pending migrations run under one advisory
 * lock; required capabilities are verified only after the registry completes.
 */
require('dotenv').config();
const pool = require('../config/db');
const tracker = require('./migrationTracker');
const { assertCmsSchemaReady } = require('../services/cmsSchemaReadinessService');
const {
  assertCatalogSchemaReady,
  inspectCatalogDatabaseCompatibility,
} = require('../services/catalogSchemaReadinessService');

async function run() {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    locked = await tracker.acquireLock(conn);
    if (!locked) throw new Error('LOCKED: Another migration is already running.');
    console.log('[migrate:deploy] Advisory lock acquired.');

    try {
      const storage = await inspectCatalogDatabaseCompatibility(pool);
      console.log(
        `[migrate:deploy] Database engine=${storage.engine} version=${storage.version}; `
        + `products.tags DATA_TYPE=${storage.dataType || 'missing'} `
        + `COLUMN_TYPE=${storage.columnType || 'missing'}; `
        + `semantic_compatible=${storage.compatible}; type_alteration=${storage.typeAlteration}.`
      );
    } catch {
      console.warn('[migrate:deploy] Catalog storage diagnostics unavailable; migrations will continue.');
    }

    const result = await tracker.runPendingMigrations(pool);
    console.log('[migrate:deploy] Registry complete; verifying required schema capabilities.');
    await assertCmsSchemaReady(pool, { force: true });
    const catalogReadiness = await assertCatalogSchemaReady(pool, { force: true });
    console.log(`[migrate:deploy] Final catalog readiness: ${catalogReadiness.ready ? 'ready' : 'not_ready'}.`);
    console.log('[migrate:deploy] Post-migration readiness passed.');
    console.log(
      `[migrate:deploy] Done — ${result.ran} ran, ${result.skipped} skipped, `
      + `${result.reconciled} reconciled.`
    );
    return result;
  } finally {
    if (locked) await tracker.releaseLock(conn).catch(() => {});
    conn.release();
  }
}

async function closePool() {
  await pool.end();
}

if (require.main === module) {
  run()
    .then(() => closePool())
    .catch(async (error) => {
      console.error('[migrate:deploy] Failed:', error.message);
      await closePool().catch(() => {});
      process.exitCode = error.message.startsWith('LOCKED') ? 2 : 1;
    });
}

module.exports = { run, closePool };
