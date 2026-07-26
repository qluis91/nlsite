/**
 * Phase 13 — Migration tracker: schema_migrations table, advisory lock, checksum.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCK_TIMEOUT_SEC = 30;
const LOCK_NAME = 'migrate_deploy';

const MIGRATION_REGISTRY = [
  { name: 'migrateUserAddresses',  file: './migrate-user-addresses',  exportName: 'migrateUserAddresses' },
  { name: 'migrateUserProfile',    file: './migrate-user-profile',    exportName: 'migrateUserProfile' },
  { name: 'migrateCms',            file: './migrate-cms',             exportName: 'migrateCms' },
  { name: 'migrateNavigationItems',file: './migrate-nav-items',       exportName: 'migrateNavigationItems' },
  { name: 'migratePanels',         file: './migrate-panels',          exportName: 'migratePanels' },
  { name: 'migratePublishing',     file: './migrate-publishing',      exportName: 'migratePublishing' },
  { name: 'migrateCatalog',        file: './migrate-catalog',         exportName: 'migrateCatalog' },
  { name: 'migrateOrders',         file: './migrate-orders',          exportName: 'migrate' },
  { name: 'migrateTilopay',        file: './migrate-tilopay',         exportName: 'migrate' },
  { name: 'migrateCategoryHero',   file: './migrate-category-hero',   exportName: 'migrateCategoryHero' },
  { name: 'migrateGallery',        file: './migrate-gallery',         exportName: 'migrateGallery' },
  { name: 'migratePaymentProofs',  file: './migrate-payment-proofs',  exportName: 'migrate' },
  { name: 'migrateTracking',       file: './migrate-tracking',        exportName: 'migrate' },
  { name: 'migrateCatalogSeo',     file: './migrate-catalog-seo',     exportName: 'migrate' },
];

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      duration_ms INT NOT NULL DEFAULT 0,
      status ENUM('ok','failed') NOT NULL DEFAULT 'ok',
      error VARCHAR(500) NULL,
      INDEX idx_migrations_name (name),
      INDEX idx_migrations_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function computeChecksum(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function acquireLock(conn, timeoutSec) {
  const t = timeoutSec || LOCK_TIMEOUT_SEC;
  const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS locked', [LOCK_NAME, t]);
  return rows[0].locked === 1;
}

async function releaseLock(conn) {
  await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
}

async function getExecutedMigrations(pool) {
  const [rows] = await pool.query(
    "SELECT name, checksum, status FROM schema_migrations WHERE status = 'ok' ORDER BY id ASC"
  );
  return rows.map(r => ({ name: r.name, checksum: r.checksum, status: r.status }));
}

async function recordMigration(pool, name, checksum, durationMs) {
  await pool.query(
    'INSERT INTO schema_migrations (name, checksum, duration_ms, status) VALUES (?, ?, ?, ?)',
    [name, checksum, durationMs, 'ok']
  );
}

async function recordMigrationFailure(pool, name, checksum, durationMs, error) {
  const errMsg = String(error).slice(0, 500);
  await pool.query(
    'INSERT INTO schema_migrations (name, checksum, duration_ms, status, error) VALUES (?, ?, ?, ?, ?)',
    [name, checksum, durationMs, 'failed', errMsg]
  );
}

async function runPendingMigrations(pool) {
  await ensureMigrationsTable(pool);

  const executed = await getExecutedMigrations(pool);
  const executedMap = new Map(executed.map(e => [e.name, e]));

  let ran = 0;
  let skipped = 0;

  for (const entry of MIGRATION_REGISTRY) {
    const { name, file, exportName } = entry;
    const filePath = path.resolve(__dirname, file + '.js');
    const checksum = computeChecksum(filePath);
    const existing = executedMap.get(name);

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `Migration "${name}" source changed after execution. ` +
          `Old: ${existing.checksum.slice(0, 12)}… New: ${checksum.slice(0, 12)}… ` +
          `Manual review required.`
        );
      }
      skipped++;
      continue;
    }

    const start = Date.now();
    const mod = require(file);
    const fn = mod[exportName];
    if (typeof fn !== 'function') {
      throw new Error(`Migration "${name}" missing export "${exportName}"`);
    }
    await fn();
    const durationMs = Date.now() - start;
    await recordMigration(pool, name, checksum, durationMs);
    ran++;
  }

  return { ran, skipped };
}

module.exports = {
  MIGRATION_REGISTRY,
  ensureMigrationsTable,
  computeChecksum,
  acquireLock,
  releaseLock,
  getExecutedMigrations,
  recordMigration,
  recordMigrationFailure,
  runPendingMigrations,
  LOCK_NAME,
  LOCK_TIMEOUT_SEC,
};
