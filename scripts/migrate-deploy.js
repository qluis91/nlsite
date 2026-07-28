/**
 * Production migration deployer. Pending migrations run under one advisory
 * lock; required capabilities are verified only after the registry completes.
 */
require('dotenv').config();
const pool = require('../config/db');
const tracker = require('./migrationTracker');
const { assertCmsSchemaReady } = require('../services/cmsSchemaReadinessService');
const { assertCatalogSchemaReady } = require('../services/catalogSchemaReadinessService');

async function run() {
  const conn = await pool.getConnection();
  let locked = false;
  try {
    locked = await tracker.acquireLock(conn);
    if (!locked) throw new Error('LOCKED: Another migration is already running.');
    console.log('[migrate:deploy] Advisory lock acquired.');

    const result = await tracker.runPendingMigrations(pool);
    console.log('[migrate:deploy] Registry complete; verifying required schema capabilities.');
    await assertCmsSchemaReady(pool, { force: true });
    await assertCatalogSchemaReady(pool, { force: true });
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
