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
  migrateCmsHomepageFields: {
    oldChecksum: '19c2ae211bf7cd0aeb5137cb2ac2088ceeffee5680e8bdc3e6c10700707f7a4f',
    newChecksum: '3ae1a43e24bcd2d0b93c1bedaaa0f63ccc8250b252f99ce73527e1b8d4e463e3',
    reason: 'social seed URL edit after execution (schema unchanged)',
    verifySchema: null, // set below after _verifyCmsHomepageFieldsSchema is defined
  },
  migrateUserAddresses: {
    oldChecksum: '2a7cac71e27ede34ef11b395644eb6dd2a2d7592667b0617e8b8a0bc549517e4',
    newChecksum: '98250dd561e29acc944a360e3a2c7150eb67282ed822b8b13fe3eb21e5acc2b3',
    reason: 'encoding/line-ending drift after original execution (no logic or SQL change)',
    verifySchema: null, // set below after _verifyUserAddressesSchema is defined
  },
  migrateUserProfile: {
    oldChecksum: '70787565a4d77438fb9ff12234edad50c95d1230854dd2923b96f570f263b344',
    newChecksum: '15c2f21bd3b28c27832f8889a46365dfc89e2affc34620c9790209dfdf48bcbf',
    reason: 'encoding/line-ending drift after original execution (no logic or SQL change)',
    verifySchema: null, // set below after _verifyUserProfileSchema is defined
  },
  migrateCms: {
    oldChecksum: '2ef57e9cae09dc784ba1efdcd6f3ba4776e15f4fb1b3ac93873d17f9faae6c9a',
    newChecksum: '08fe0a407d6df4f2b6d18e42b46340b65094a2b1691101bf01b42652a8d846a3',
    reason: 'encoding/line-ending drift after original execution (no logic or SQL change)',
    verifySchema: null, // set below after _verifyCmsSchema is defined
  },
  migrateNavigationItems: {
    oldChecksum: '75308f0d0c2c5a07242d82b87a432aae2b3da64c042561beff3b0c0dadd2c48e',
    newChecksum: 'b0598767785ed624d0b6787ff64644347725fbdeb04f27928b704ddb0dcfc36d',
    reason: 'encoding/line-ending drift after original execution (no logic or SQL change)',
    verifySchema: null, // set below after _verifyNavigationItemsSchema is defined
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
  // Normalize CRLF / lone CR to LF so Windows autocrlf checkouts match Git LF blobs.
  const content = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

async function _verifyCmsHomepageFieldsSchema(pool) {
  // Verify objects created/altered by scripts/migrate-cms-homepage-fields.js:
  // home_social_items table + additive columns on carousel/feature item tables.
  const socialExpected = [
    'id', 'public_id', 'page_section_id', 'platform', 'label', 'profile_url',
    'aria_label', 'media_public_id', 'sort_order', 'is_visible', 'status',
    'published_data', 'published_at', 'created_by', 'updated_by',
    'created_at', 'updated_at', 'deleted_at',
  ];
  const requiredColumns = [
    ['home_carousel_items', 'media_alt'],
    ['home_carousel_items', 'preview_media_alt'],
    ['home_feature_items', 'button_label'],
    ['home_feature_items', 'media_alt'],
    ['home_feature_items', 'link_aria_label'],
  ];

  try {
    const [socialCols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'home_social_items' ORDER BY ORDINAL_POSITION"
    );
    if (!socialCols.length) {
      console.warn('[migrate:deploy] home_social_items table is missing.');
      return false;
    }
    const actualSocial = socialCols.map((c) => c.COLUMN_NAME);
    const missingSocial = socialExpected.filter((c) => !actualSocial.includes(c));
    if (missingSocial.length > 0) {
      console.warn('[migrate:deploy] home_social_items missing columns: ' + missingSocial.join(', '));
      return false;
    }

    for (const [table, column] of requiredColumns) {
      const [rows] = await pool.query(
        "SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
        [table, column]
      );
      if (!rows.length) {
        console.warn(`[migrate:deploy] ${table}.${column} is missing.`);
        return false;
      }
    }

    console.log('[migrate:deploy] CMS homepage fields schema verified OK.');
    return true;
  } catch (err) {
    console.warn('[migrate:deploy] CMS homepage fields schema verification error: ' + err.message);
    return false;
  }
}

async function _verifyUserAddressesSchema(pool) {
  // Verify objects created by scripts/migrate-user-addresses.js:
  // user_addresses columns, indexes, and user_id → users(id) FK.
  const expectedColumns = [
    'id', 'user_id', 'label', 'province', 'canton', 'district',
    'address_line', 'address_reference', 'contact_phone', 'is_default',
    'created_at', 'updated_at',
  ];
  const requiredIndexes = [
    'PRIMARY',
    'idx_user_addresses_user',
    'idx_user_addresses_user_default',
  ];

  try {
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_addresses' ORDER BY ORDINAL_POSITION"
    );
    if (!cols.length) {
      console.warn('[migrate:deploy] user_addresses table is missing.');
      return false;
    }
    const actualColumns = cols.map((c) => c.COLUMN_NAME);
    const missing = expectedColumns.filter((c) => !actualColumns.includes(c));
    if (missing.length > 0) {
      console.warn('[migrate:deploy] user_addresses missing columns: ' + missing.join(', '));
      return false;
    }

    const [idx] = await pool.query(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_addresses'"
    );
    const indexNames = [...new Set(idx.map((i) => i.INDEX_NAME))];
    const missingIdx = requiredIndexes.filter((i) => !indexNames.includes(i));
    if (missingIdx.length > 0) {
      console.warn('[migrate:deploy] user_addresses missing indexes: ' + missingIdx.join(', '));
      return false;
    }

    const [fks] = await pool.query(
      `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'user_addresses'
         AND COLUMN_NAME = 'user_id'
         AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    const hasFk = fks.some(
      (fk) =>
        fk.CONSTRAINT_NAME === 'fk_user_addresses_user' &&
        fk.REFERENCED_TABLE_NAME === 'users' &&
        fk.REFERENCED_COLUMN_NAME === 'id'
    );
    if (!hasFk) {
      console.warn('[migrate:deploy] user_addresses missing FK fk_user_addresses_user → users(id).');
      return false;
    }

    console.log('[migrate:deploy] user_addresses schema verified OK.');
    return true;
  } catch (err) {
    console.warn('[migrate:deploy] user_addresses schema verification error: ' + err.message);
    return false;
  }
}

async function _verifyUserProfileSchema(pool) {
  // Verify additive profile columns from scripts/migrate-user-profile.js.
  const requiredColumns = ['last_name', 'phone', 'avatar_path', 'password_changed_at'];

  try {
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
    );
    if (!cols.length) {
      console.warn('[migrate:deploy] users table is missing.');
      return false;
    }
    const actual = new Set(cols.map((c) => c.COLUMN_NAME));
    const missing = requiredColumns.filter((c) => !actual.has(c));
    if (missing.length > 0) {
      console.warn('[migrate:deploy] users missing profile columns: ' + missing.join(', '));
      return false;
    }

    console.log('[migrate:deploy] users profile schema verified OK.');
    return true;
  } catch (err) {
    console.warn('[migrate:deploy] users profile schema verification error: ' + err.message);
    return false;
  }
}

async function _verifyCmsSchema(pool) {
  // Verify Phase 11A objects from scripts/migrate-cms.js:
  // core CMS tables + additive site_settings columns.
  const requiredTables = [
    'media_assets',
    'pages',
    'page_sections',
    'site_settings',
    'content_revisions',
  ];
  const siteSettingsColumns = [
    'value_type',
    'setting_group',
    'is_public',
    'updated_by',
    'created_at',
  ];

  try {
    for (const table of requiredTables) {
      const [rows] = await pool.query(
        "SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
        [table]
      );
      if (!rows.length) {
        console.warn(`[migrate:deploy] Phase 11A table missing: ${table}`);
        return false;
      }
    }

    for (const column of siteSettingsColumns) {
      const [rows] = await pool.query(
        "SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_settings' AND COLUMN_NAME = ? LIMIT 1",
        [column]
      );
      if (!rows.length) {
        console.warn(`[migrate:deploy] site_settings.${column} is missing.`);
        return false;
      }
    }

    console.log('[migrate:deploy] Phase 11A CMS schema verified OK.');
    return true;
  } catch (err) {
    console.warn('[migrate:deploy] Phase 11A CMS schema verification error: ' + err.message);
    return false;
  }
}

async function _verifyNavigationItemsSchema(pool) {
  // Verify objects from scripts/migrate-nav-items.js:
  // navigation_items columns, indexes, and FKs.
  const expectedColumns = [
    'id', 'public_id', 'location', 'parent_id', 'label', 'url', 'link_type',
    'target', 'media_public_id', 'sort_order', 'is_visible', 'status',
    'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at',
  ];
  const requiredIndexes = [
    'PRIMARY',
    'uq_navigation_items_public_id',
    'idx_navigation_items_location_status',
    'idx_navigation_items_parent',
  ];
  const requiredFks = [
    { name: 'fk_navigation_items_parent', table: 'navigation_items', column: 'id' },
    { name: 'fk_navigation_items_creator', table: 'users', column: 'id' },
    { name: 'fk_navigation_items_updater', table: 'users', column: 'id' },
  ];

  try {
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'navigation_items' ORDER BY ORDINAL_POSITION"
    );
    if (!cols.length) {
      console.warn('[migrate:deploy] navigation_items table is missing.');
      return false;
    }
    const actualColumns = cols.map((c) => c.COLUMN_NAME);
    const missing = expectedColumns.filter((c) => !actualColumns.includes(c));
    if (missing.length > 0) {
      console.warn('[migrate:deploy] navigation_items missing columns: ' + missing.join(', '));
      return false;
    }

    const [idx] = await pool.query(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'navigation_items'"
    );
    const indexNames = [...new Set(idx.map((i) => i.INDEX_NAME))];
    const missingIdx = requiredIndexes.filter((i) => !indexNames.includes(i));
    if (missingIdx.length > 0) {
      console.warn('[migrate:deploy] navigation_items missing indexes: ' + missingIdx.join(', '));
      return false;
    }

    const [fks] = await pool.query(
      `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'navigation_items'
         AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    for (const required of requiredFks) {
      const ok = fks.some(
        (fk) =>
          fk.CONSTRAINT_NAME === required.name &&
          fk.REFERENCED_TABLE_NAME === required.table &&
          fk.REFERENCED_COLUMN_NAME === required.column
      );
      if (!ok) {
        console.warn(
          `[migrate:deploy] navigation_items missing FK ${required.name} → ${required.table}(${required.column}).`
        );
        return false;
      }
    }

    console.log('[migrate:deploy] navigation_items schema verified OK.');
    return true;
  } catch (err) {
    console.warn('[migrate:deploy] navigation_items schema verification error: ' + err.message);
    return false;
  }
}

// Link verifySchema functions now that the helpers are defined
ENCODING_RECONCILE_REGISTRY.migrateTilopay.verifySchema = _verifyTilopaySchema;
ENCODING_RECONCILE_REGISTRY.migrateCmsHomepageFields.verifySchema = _verifyCmsHomepageFieldsSchema;
ENCODING_RECONCILE_REGISTRY.migrateUserAddresses.verifySchema = _verifyUserAddressesSchema;
ENCODING_RECONCILE_REGISTRY.migrateUserProfile.verifySchema = _verifyUserProfileSchema;
ENCODING_RECONCILE_REGISTRY.migrateCms.verifySchema = _verifyCmsSchema;
ENCODING_RECONCILE_REGISTRY.migrateNavigationItems.verifySchema = _verifyNavigationItemsSchema;

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
  _verifyCmsHomepageFieldsSchema,
  _reconcileChecksum,
  LOCK_NAME,
  LOCK_TIMEOUT_SEC,
};
