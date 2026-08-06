/**
 * Shared database readiness probe — used by both startup and /ready endpoint.
 * Always releases the acquired connection. Never exposes raw DB internals.
 *
 * In test mode (NODE_ENV=test), only basic connectivity (SELECT 1) is required.
 * This allows per-test migrations to build the schema incrementally without
 * blocking app startup.
 */
const pool = require('./db');
const { inspectCmsSchema } = require('../services/cmsSchemaReadinessService');
const { inspectCatalogSchema } = require('../services/catalogSchemaReadinessService');

const READINESS_TIMEOUT_MS = 5000;

/**
 * Probes the primary application database.
 * Returns true when reachable, false when unavailable.
 * In test mode only validates basic connectivity (SELECT 1).
 */
async function probeDatabase({ requireFullSchema = true } = {}) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query('SELECT 1');

    if (!requireFullSchema) return true;

    const cmsSchema = await inspectCmsSchema(connection, { force: true });
    const catalogSchema = await inspectCatalogSchema(connection, { force: true });
    return cmsSchema.ready && catalogSchema.ready;
  } catch (_err) {
    return false;
  } finally {
    if (connection) connection.release();
  }
}

/**
 * Asserts database is reachable within a bounded timeout.
 * Throws with a safe message on failure (no raw DB errors).
 * Used at startup to block listen() when DB is unavailable.
 *
 * In test mode, only basic connectivity is required — the full CMS/catalog
 * schema is built incrementally by per-test migrations.
 */
async function assertDatabaseReady({ requireFullSchema = true } = {}) {
  const testMode = process.env.NODE_ENV === 'test';
  const fullSchema = requireFullSchema && !testMode;

  const start = Date.now();
  while (Date.now() - start < READINESS_TIMEOUT_MS) {
    if (await probeDatabase({ requireFullSchema: fullSchema })) return;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('La base de datos no está disponible.');
}

module.exports = { probeDatabase, assertDatabaseReady, READINESS_TIMEOUT_MS };
