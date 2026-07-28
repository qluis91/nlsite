/**
 * Shared database readiness probe — used by both startup and /ready endpoint.
 * Always releases the acquired connection. Never exposes raw DB internals.
 */
const pool = require('./db');
const { inspectCmsSchema } = require('../services/cmsSchemaReadinessService');
const { inspectCatalogSchema } = require('../services/catalogSchemaReadinessService');

const READINESS_TIMEOUT_MS = 5000;

/**
 * Probes the primary application database.
 * Returns true when reachable, false when unavailable.
 */
async function probeDatabase() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query('SELECT 1');
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
 */
async function assertDatabaseReady() {
  const start = Date.now();
  while (Date.now() - start < READINESS_TIMEOUT_MS) {
    if (await probeDatabase()) return;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('La base de datos no está disponible.');
}

module.exports = { probeDatabase, assertDatabaseReady, READINESS_TIMEOUT_MS };
