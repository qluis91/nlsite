/**
 * Phase 13 — Production migration deployer.
 *
 * Usage:
 *   node scripts/migrate-deploy.js    (direct, exits 0/1/2)
 *   const { run } = require('./migrate-deploy'); await run();  (programmatic, throws on failure)
 *
 * Behaviour:
 * 1. Acquires a MySQL advisory lock (GET_LOCK).
 * 2. Creates schema_migrations if missing.
 * 3. Runs pending migrations from the registry.
 * 4. Skips already-executed migrations (checksum-verified).
 * 5. Records each execution in schema_migrations.
 * 6. Releases the lock in finally.
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
    if (!locked) {
      throw new Error('LOCKED: Another migration is already running.');
    }

    const { ran, skipped } = await tracker.runPendingMigrations(pool);
    await assertCmsSchemaReady(pool, { force: true });
    await assertCatalogSchemaReady(pool, { force: true });
    console.log(`[migrate:deploy] Done — ${ran} ran, ${skipped} skipped.`);
  } finally {
    if (locked) await tracker.releaseLock(conn).catch(() => {});
    conn.release();
  }
}

if (require.main === module) {
  run()
    .then(() => pool.end().catch(() => {}).finally(() => process.exit(0)))
    .catch(err => {
      console.error('[migrate:deploy] Failed:', err.message);
      pool.end().catch(() => {}).finally(() => process.exit(err.message.startsWith('LOCKED') ? 2 : 1));
    });
}

module.exports = { run };
