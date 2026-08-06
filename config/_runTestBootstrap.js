/**
 * Internal: standalone test database bootstrap script.
 * Called by testBootstrap.js as a subprocess to avoid deadlocks between
 * the lazy pool in db.js and migration modules.
 *
 * Creates the test database, runs schema.sql, and executes all registered
 * migrations in order. Idempotent.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'schema.sql');

// Signal to db.js that bootstrap already ran
process.env.__NLSITE_TEST_BOOTSTRAP_COMPLETE = 'true';

async function main() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  };

  if (!config.database) {
    console.error('[testBootstrap:worker] DB_NAME not set.');
    process.exit(1);
  }

  const quiet = process.env.NLSITE_TEST_BOOTSTRAP_QUIET === 'true';

  // Phase 1: Create database + run schema.sql
  const bootstrapConn = await mysql.createConnection({
    host: config.host, port: config.port,
    user: config.user, password: config.password,
    multipleStatements: true,
  });

  try {
    await bootstrapConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await bootstrapConn.query(`USE \`${config.database}\``);

    if (fs.existsSync(SCHEMA_PATH)) {
      let schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
      schema = schema.replace(/^USE\s+nlsite_db\s*;\s*$/im, '');
      await bootstrapConn.query(schema);
    }
  } finally {
    await bootstrapConn.end().catch(() => {});
  }

  // Phase 2: Run all registered migrations
  const { ensureMigrationsTable, getExecutedMigrations, MIGRATION_REGISTRY, computeChecksum } =
    require('../scripts/migrationTracker');

  const adminPool = mysql.createPool({
    host: config.host, port: config.port,
    user: config.user, password: config.password,
    database: config.database,
    waitForConnections: true, connectionLimit: 5, queueLimit: 0,
  });

  try {
    await ensureMigrationsTable(adminPool);
    const executed = await getExecutedMigrations(adminPool);
    const executedMap = new Map(executed.map(e => [e.name, e]));

    for (const entry of MIGRATION_REGISTRY) {
      const { name, file, exportName, passPool } = entry;
      const filePath = path.resolve(PROJECT_ROOT, 'scripts', file + '.js');
      const checksum = computeChecksum(filePath);
      const existing = executedMap.get(name);

      if (existing) {
        if (existing.checksum !== checksum && !quiet) {
          console.warn(`[testBootstrap] Migration "${name}" checksum changed — skipping.`);
        }
        continue;
      }

      try {
        const migration = require(filePath);
        if (passPool) {
          await migration[exportName](adminPool);
        } else {
          await migration[exportName]();
        }
        await adminPool.query(
          'INSERT INTO schema_migrations (name, checksum, duration_ms, status) VALUES (?, ?, 0, ?)',
          [name, checksum, 'ok']
        );
      } catch (err) {
        if (!quiet) console.warn(`[testBootstrap] Migration "${name}" error: ${err.message}`);
        try {
          await adminPool.query(
            'INSERT INTO schema_migrations (name, checksum, duration_ms, status, error) VALUES (?, ?, 0, ?, ?)',
            [name, checksum, 'failed', String(err).slice(0, 500)]
          );
        } catch (_) {}
      }
    }

    if (!quiet) console.log('[testBootstrap] Test database ready.');
  } finally {
    await adminPool.end().catch(() => {});
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[testBootstrap:worker] Fatal:', err.message);
  process.exit(1);
});
