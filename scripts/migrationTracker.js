/**
 * Phase 13 — Migration tracker: schema_migrations table, advisory lock, checksum.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCK_TIMEOUT_SEC = 30;
const LOCK_NAME = 'migrate_deploy';

// ── Encoding-only checksum reconciliation ──────────────────────────────────
// When a migration source file is re-encoded (e.g. UTF-16 LE → UTF-8) without
// any logic or SQL change, the checksum drifts. Reconciliation is ONLY
// permitted when:
//
//   1. stored.checksum === exact oldChecksum (proves it's the encoding change)
//   2. currentChecksum === exact newChecksum (proves it's the UTF-8 version)
//   3. Schema verification passes (proves DB state matches migration result)
//
// A future edit producing a third checksum MUST fail — even with a valid schema.
//
// Each entry: { oldChecksum, newChecksum, reason, verifySchema(pool) }

const ENCODING_RECONCILE_REGISTRY = {
  migrateTilopay: {
    oldChecksum: 'b34806e579a927ebfced8a493115d3f6f0542bf06f26bc1090756a2882771c87',
    newChecksum: '164b20c89dbb60d53d0bca3f8c2fa70edb30c6ecf49575b6ea289a88439c40bb',
    reason: 'UTF-16 LE → UTF-8 re-encode (no logic or SQL change)',
    verifySchema: null, // set below after _verifyTilopaySchema is defined
  },
};

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
  { name: 'migrateSocialFeed', file: './migrate-social-feed', exportName: 'migrateSocialFeed', passPool: true },
  { name: 'migrateSocialFeedHomeSection', file: './migrate-social-feed-home-section', exportName: 'migrateSocialFeedHomeSection', passPool: true },
  { name: 'migrateTestimonials', file: './migrate-testimonials', exportName: 'migrateTestimonials', passPool: true },
  { name: 'migrateSocialIntegrations', file: './migrate-social-integrations', exportName: 'migrateSocialIntegrations', passPool: true },
  { name: 'migrateSocialSyncRuns', file: './migrate-social-sync-runs', exportName: 'migrateSocialSyncRuns', passPool: true },
  { name: 'migrateSocialPostsImportFields', file: './migrate-social-posts-import-fields', exportName: 'migrateSocialPostsImportFields', passPool: true },
  { name: 'migrateSocialTokenSecrets', file: './migrate-social-token-secrets', exportName: 'migrateSocialTokenSecrets', passPool: true },
  { name: 'migrateSocialOAuthStates', file: './migrate-social-oauth-states', exportName: 'migrateSocialOAuthStates', passPool: true },
  { name: 'migrateSeedMetaIntegrations', file: './migrate-seed-meta-integrations', exportName: 'migrateSeedMetaIntegrations', passPool: true },
  { name: 'migrateSeedTikTok', file: './migrate-seed-tiktok', exportName: 'migrateSeedTikTok', passPool: true },
  { name: 'migrateSocialPostsProviderThumbnail', file: './migrate-social-posts-provider-thumbnail', exportName: 'migrateSocialPostsProviderThumbnail', passPool: true },
  { name: 'migrateCarouselImagePosition', file: './migrate-carousel-image-position', exportName: 'migrateCarouselImagePosition', passPool: true },
  { name: 'migrateCostQuote', file: './migrate-cost-quote', exportName: 'migrate' },
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

async function _verifyTilopaySchema(pool) {
  // Verify tilopay_transactions table exists with all expected columns
  // and indexes matching the CREATE TABLE in scripts/migrate-tilopay.js.
  const expectedColumns = [
    'id', 'order_id', 'internal_reference', 'idempotency_key',
    'provider_transaction_id', 'provider_session_token', 'status',
    'amount', 'currency', 'checkout_url', 'provider_created_at',
    'confirmed_at', 'failed_at', 'failure_code', 'failure_message',
    'raw_status', 'created_at', 'updated_at',
  ];

  try {
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tilopay_transactions' ORDER BY ORDINAL_POSITION"
    );
    const actualColumns = cols.map(c => c.COLUMN_NAME);
    const missing = expectedColumns.filter(c => !actualColumns.includes(c));
    if (missing.length > 0) {
      console.warn('[migrate:deploy] tilopay_transactions missing columns: ' + missing.join(', '));
      return false;
    }

    const [idx] = await pool.query(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tilopay_transactions'"
    );
    const indexNames = [...new Set(idx.map(i => i.INDEX_NAME))];
    const requiredIndexes = [
      'PRIMARY', 'idx_tilopay_internal_ref', 'idx_tilopay_idempotency',
      'idx_tilopay_provider_id', 'idx_tilopay_order_created', 'idx_tilopay_status',
    ];
    const missingIdx = requiredIndexes.filter(i => !indexNames.includes(i));
    if (missingIdx.length > 0) {
      console.warn('[migrate:deploy] tilopay_transactions missing indexes: ' + missingIdx.join(', '));
      return false;
    }

    console.log('[migrate:deploy] tilopay_transactions schema verified OK.');
    return true;
  } catch (err) {
    console.warn('[migrate:deploy] tilopay_transactions schema verification error: ' + err.message);
    return false;
  }
}

// Link the verifySchema function now that _verifyTilopaySchema is defined
ENCODING_RECONCILE_REGISTRY.migrateTilopay.verifySchema = _verifyTilopaySchema;

async function _reconcileChecksum(pool, name, newChecksum, reason) {
  const [rows] = await pool.query(
    "SELECT checksum FROM schema_migrations WHERE name = ? AND status = 'ok'",
    [name]
  );
  if (rows.length === 0) {
    throw new Error('No executed migration found for "' + name + '"');
  }
  const oldChecksum = rows[0].checksum;
  await pool.query(
    "UPDATE schema_migrations SET checksum = ? WHERE name = ? AND status = 'ok'",
    [newChecksum, name]
  );
  console.log(
    '[migrate:deploy] RECONCILED checksum: ' + name + ' ' +
    oldChecksum.slice(0, 12) + '\u2026 \u2192 ' + newChecksum.slice(0, 12) + '\u2026 (' + reason + ')'
  );
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
        // ── Encoding-only checksum reconciliation ──
        // Strict exact-pair matching: only reconcile if the stored checksum
        // matches the known old encoding AND the current checksum matches the
        // known new encoding. A third checksum (future edit) always fails.
        const reconcileEntry = ENCODING_RECONCILE_REGISTRY[name];
        if (
          reconcileEntry &&
          reconcileEntry.oldChecksum &&
          reconcileEntry.newChecksum &&
          typeof reconcileEntry.verifySchema === 'function' &&
          existing.checksum === reconcileEntry.oldChecksum &&
          checksum === reconcileEntry.newChecksum
        ) {
          console.log(
            `[migrate:deploy] "${name}" checksum drift: known encoding-only transition. Verifying schema...`
          );
          const schemaOk = await reconcileEntry.verifySchema(pool);
          if (schemaOk) {
            await _reconcileChecksum(pool, name, checksum, reconcileEntry.reason);
            reconciled++;
            skipped++;
            console.log(`[migrate:deploy] Encoding-only drift reconciled for ${name}. Schema unchanged.`);
            continue;
          }
          console.error(`[migrate:deploy] "${name}" schema verification FAILED. Encoding reconciliation NOT applied.`);
        }
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
  ENCODING_RECONCILE_REGISTRY,
  ensureMigrationsTable,
  computeChecksum,
  acquireLock,
  releaseLock,
  getExecutedMigrations,
  recordMigration,
  recordMigrationFailure,
  runPendingMigrations,
  _verifyTilopaySchema,
  _reconcileChecksum,
  LOCK_NAME,
  LOCK_TIMEOUT_SEC,
};
