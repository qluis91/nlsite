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
  { name: 'migrateCmsDraftPublish',file: './migrate-cms-draft-publish',exportName: 'migrateCmsDraftPublish' },
  { name: 'migrateCmsHomepageFields',file: './migrate-cms-homepage-fields',exportName: 'migrateCmsHomepageFields' },
  { name: 'migrateCatalog', file: './migrate-catalog', exportName: 'migrateCatalog', capability: 'catalog' },
  {
    name: 'migrateCatalogSchemaRepair',
    file: './migrate-catalog-schema-repair',
    exportName: 'migrateCatalogSchemaRepair',
    capability: 'catalog',
    passPool: true,
    reconcileOnDrift: true,
  },
  { name: 'migrateOrders',         file: './migrate-orders',          exportName: 'migrate' },
  { name: 'migrateTilopay',        file: './migrate-tilopay',         exportName: 'migrate' },
  { name: 'migrateCategoryHero', file: './migrate-category-hero', exportName: 'migrateCategoryHero', capability: 'catalog' },
  { name: 'migrateGallery',        file: './migrate-gallery',         exportName: 'migrateGallery' },
  { name: 'migratePaymentProofs',  file: './migrate-payment-proofs',  exportName: 'migrate' },
  { name: 'migrateTracking',       file: './migrate-tracking',        exportName: 'migrate' },
  { name: 'migrateCatalogSeo', file: './migrate-catalog-seo', exportName: 'migrate', capability: 'catalog' },
  { name: 'migrateGalleryYoutube', file: './migrate-gallery-youtube', exportName: 'migrate' },
  { name: 'migrateCmsPhase1aSaveRepair', file: './migrate-cms-phase1a-save-repair', exportName: 'migrateCmsPhase1aSaveRepair' },
  { name: 'migrateRevisionSourceId', file: './migrate-revision-source-id', exportName: 'migrate', passPool: true },
  { name: 'migrateStoreHeroCms', file: './migrate-store-hero-cms', exportName: 'migrateStoreHeroCms', passPool: true },
  { name: 'migrateCategoryStoreHero', file: './migrate-category-store-hero', exportName: 'migrateCategoryStoreHero', passPool: true, capability: 'catalog' },
  { name: 'migrateAboutPageCms', file: './migrate-about-page-cms', exportName: 'migrateAboutPageCms', passPool: true },
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

async function runPendingMigrations(pool, {
  registry = MIGRATION_REGISTRY,
  checksumFor = computeChecksum,
  loadMigration = (file) => require(file),
  inspectCatalog,
  formatCatalogIssues,
} = {}) {
  await ensureMigrationsTable(pool);

  const executed = await getExecutedMigrations(pool);
  const executedMap = new Map(executed.map(e => [e.name, e]));

  let ran = 0;
  let skipped = 0;
  let reconciled = 0;
  console.log(`[migrate:deploy] Migration registry loaded (${registry.length} entries).`);

  for (const entry of registry) {
    const { name, file, exportName } = entry;
    const filePath = path.resolve(__dirname, file + '.js');
    const checksum = checksumFor(filePath);
    const existing = executedMap.get(name);

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `Migration "${name}" source changed after execution. ` +
          `Old: ${existing.checksum.slice(0, 12)}… New: ${checksum.slice(0, 12)}… ` +
          `Manual review required.`
        );
      }
      if (entry.capability === 'catalog') {
        const readiness = require('../services/catalogSchemaReadinessService');
        const inspectCatalogSchema = inspectCatalog || readiness.inspectCatalogSchema;
        const formatCatalogSchemaIssues = formatCatalogIssues || readiness.formatCatalogSchemaIssues;
        const capabilities = await inspectCatalogSchema(pool, { force: true });
        if (!capabilities.ready) {
          console.warn(
            `[migrate:deploy] ${name} is recorded ok but catalog capabilities are incomplete: `
            + formatCatalogSchemaIssues(capabilities)
          );
          if (entry.reconcileOnDrift) {
            console.log(`[migrate:deploy] Reconciling ${name} because physical schema drift was detected.`);
            const mod = loadMigration(file);
            const fn = mod[exportName];
            if (typeof fn !== 'function') {
              throw new Error(`Migration "${name}" missing export "${exportName}"`);
            }
            await fn(pool);
            reconciled++;
            console.log(`[migrate:deploy] Reconciled ${name}.`);
            continue;
          }
        }
      }
      skipped++;
      console.log(`[migrate:deploy] Skipped ${name} (already ok).`);
      continue;
    }

    const start = Date.now();
    console.log(`[migrate:deploy] Starting ${name}.`);
    const mod = loadMigration(file);
    const fn = mod[exportName];
    if (typeof fn !== 'function') {
      throw new Error(`Migration "${name}" missing export "${exportName}"`);
    }
    try {
      await fn(entry.passPool ? pool : undefined);
      const durationMs = Math.max(1, Date.now() - start);
      await recordMigration(pool, name, checksum, durationMs);
      ran++;
      console.log(`[migrate:deploy] Completed ${name} (${durationMs}ms).`);
    } catch (error) {
      const durationMs = Math.max(1, Date.now() - start);
      await recordMigrationFailure(
        pool,
        name,
        checksum,
        durationMs,
        error.message || error.code || 'Migration failed'
      );
      throw error;
    }
  }

  return { ran, skipped, reconciled };
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
