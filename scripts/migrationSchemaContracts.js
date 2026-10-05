/**
 * Schema contracts for encoding-only migration checksum reconciliation.
 * Each contract describes the live DB state expected after the migration ran.
 */
async function verifySchemaContract(pool, contract, label) {
  try {
    for (const table of contract.tables || []) {
      const [rows] = await pool.query(
        "SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
        [table]
      );
      if (!rows.length) {
        console.warn(`[migrate:deploy] ${label}: missing table ${table}`);
        return false;
      }
    }

    for (const [table, columns] of Object.entries(contract.columns || {})) {
      const [cols] = await pool.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
        [table]
      );
      const actual = new Set(cols.map((c) => c.COLUMN_NAME));
      const missing = columns.filter((c) => !actual.has(c));
      if (missing.length) {
        console.warn(`[migrate:deploy] ${label}: ${table} missing columns: ${missing.join(', ')}`);
        return false;
      }
    }

    for (const [table, indexes] of Object.entries(contract.indexes || {})) {
      const [idx] = await pool.query(
        "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
        [table]
      );
      const names = new Set(idx.map((i) => i.INDEX_NAME));
      const missing = indexes.filter((i) => !names.has(i));
      if (missing.length) {
        console.warn(`[migrate:deploy] ${label}: ${table} missing indexes: ${missing.join(', ')}`);
        return false;
      }
    }

    for (const fk of contract.foreignKeys || []) {
      const [rows] = await pool.query(
        `SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
           AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [fk.table, fk.column]
      );
      const ok = rows.some(
        (r) =>
          (!fk.name || r.CONSTRAINT_NAME === fk.name) &&
          r.REFERENCED_TABLE_NAME === fk.refTable &&
          r.REFERENCED_COLUMN_NAME === fk.refColumn
      );
      if (!ok) {
        console.warn(
          `[migrate:deploy] ${label}: missing FK ${fk.name || '(any)'} on ${fk.table}.${fk.column} → ${fk.refTable}(${fk.refColumn})`
        );
        return false;
      }
    }

    for (const seed of contract.seedRows || []) {
      const keys = Object.keys(seed.where);
      const whereSql = keys.map((k) => `\`${k}\` = ?`).join(' AND ');
      const [rows] = await pool.query(
        `SELECT 1 AS ok FROM \`${seed.table}\` WHERE ${whereSql} LIMIT 1`,
        keys.map((k) => seed.where[k])
      );
      if (!rows.length) {
        console.warn(`[migrate:deploy] ${label}: missing seed row in ${seed.table} (${whereSql})`);
        return false;
      }
    }

    for (const row of contract.existsRows || []) {
      const [rows] = await pool.query(row.sql, row.params || []);
      if (!rows.length) {
        console.warn(`[migrate:deploy] ${label}: ${row.label || 'required row'} missing`);
        return false;
      }
    }

    console.log(`[migrate:deploy] ${label} schema verified OK.`);
    return true;
  } catch (err) {
    console.warn(`[migrate:deploy] ${label} schema verification error: ${err.message}`);
    return false;
  }
}

function makeVerifier(contract, label) {
  return (pool) => verifySchemaContract(pool, contract, label);
}

const CONTRACTS = {
  migratePanels: {
    tables: ['logo_loop_items', 'home_carousel_items', 'home_feature_items'],
    columns: {
      logo_loop_items: ['id', 'public_id', 'page_section_id', 'item_type', 'status', 'created_at'],
      home_carousel_items: ['id', 'public_id', 'page_section_id', 'title', 'status', 'created_at'],
      home_feature_items: ['id', 'public_id', 'page_section_id', 'title', 'status', 'created_at'],
    },
    indexes: {
      logo_loop_items: ['PRIMARY', 'uq_logo_loop_items_public_id'],
      home_carousel_items: ['PRIMARY', 'uq_home_carousel_items_public_id'],
      home_feature_items: ['PRIMARY', 'uq_home_feature_items_public_id'],
    },
    foreignKeys: [
      { name: 'fk_logo_loop_items_section', table: 'logo_loop_items', column: 'page_section_id', refTable: 'page_sections', refColumn: 'id' },
      { name: 'fk_home_carousel_items_section', table: 'home_carousel_items', column: 'page_section_id', refTable: 'page_sections', refColumn: 'id' },
      { name: 'fk_home_feature_items_section', table: 'home_feature_items', column: 'page_section_id', refTable: 'page_sections', refColumn: 'id' },
    ],
  },
  migratePublishing: {
    tables: ['publication_batches', 'publication_batch_items'],
    columns: {
      publication_batches: ['id', 'public_id', 'scope', 'status', 'created_at'],
      publication_batch_items: ['id', 'batch_id', 'module_key', 'entity_type', 'entity_id', 'status'],
    },
    indexes: {
      publication_batches: ['PRIMARY', 'uq_publication_batches_public_id'],
      publication_batch_items: ['PRIMARY', 'idx_pbi_batch_id'],
    },
    foreignKeys: [
      { name: 'fk_pbi_batch_id', table: 'publication_batch_items', column: 'batch_id', refTable: 'publication_batches', refColumn: 'id' },
    ],
  },
  migrateCmsDraftPublish: {
    tables: ['page_sections', 'site_settings', 'navigation_items', 'logo_loop_items', 'home_carousel_items', 'home_feature_items'],
    columns: {
      page_sections: ['published_content_json', 'published_style_json', 'published_at'],
      site_settings: ['published_value', 'has_unpublished_changes', 'published_at'],
      navigation_items: ['published_data', 'published_at'],
      logo_loop_items: ['published_data', 'published_at'],
      home_carousel_items: ['published_data', 'published_at'],
      home_feature_items: ['published_data', 'published_at'],
    },
  },
  migrateCatalog: {
    tables: ['categories', 'products', 'product_categories', 'product_images'],
    columns: {
      categories: ['id', 'name', 'slug', 'created_at'],
      products: ['id', 'name', 'slug', 'is_active', 'is_published', 'created_at'],
      product_categories: ['product_id', 'category_id'],
      product_images: ['id', 'product_id', 'file_path', 'is_primary', 'position'],
    },
    indexes: {
      products: ['PRIMARY', 'idx_products_slug'],
      product_images: ['PRIMARY', 'idx_pi_product_position'],
    },
    foreignKeys: [
      { name: 'fk_pc_product', table: 'product_categories', column: 'product_id', refTable: 'products', refColumn: 'id' },
      { name: 'fk_pc_category', table: 'product_categories', column: 'category_id', refTable: 'categories', refColumn: 'id' },
      { name: 'fk_pi_product', table: 'product_images', column: 'product_id', refTable: 'products', refColumn: 'id' },
    ],
  },
  migrateOrders: {
    tables: ['orders', 'order_items', 'order_events'],
    columns: {
      orders: ['id', 'order_reference', 'order_status', 'payment_status', 'idempotency_key', 'created_at'],
      order_items: ['id', 'order_id', 'product_id', 'quantity', 'line_total'],
      order_events: ['id', 'order_id', 'event_type', 'created_at'],
    },
    indexes: {
      orders: ['PRIMARY', 'order_reference', 'uq_orders_idempotency'],
      order_events: ['PRIMARY', 'idx_order_events_order_created'],
    },
    foreignKeys: [
      { table: 'orders', column: 'user_id', refTable: 'users', refColumn: 'id' },
      { name: 'fk_order_events_order', table: 'order_events', column: 'order_id', refTable: 'orders', refColumn: 'id' },
    ],
  },
  migrateCategoryHero: {
    tables: ['categories'],
    columns: {
      categories: ['description', 'hero_title', 'hero_description', 'hero_image', 'hero_alt', 'hero_position'],
    },
  },
  migrateGallery: {
    tables: ['gallery_categories', 'gallery_items'],
    columns: {
      gallery_categories: ['id', 'name', 'slug', 'is_active'],
      gallery_items: ['id', 'category_id', 'title', 'slug', 'media_type', 'is_published'],
    },
    indexes: {
      gallery_categories: ['PRIMARY', 'uq_gallery_categories_slug'],
      gallery_items: ['PRIMARY', 'uq_gallery_items_slug'],
    },
    foreignKeys: [
      { name: 'fk_gallery_items_category', table: 'gallery_items', column: 'category_id', refTable: 'gallery_categories', refColumn: 'id' },
    ],
  },
  migratePaymentProofs: {
    tables: ['payment_proofs'],
    columns: {
      payment_proofs: ['id', 'order_id', 'status', 'storage_path', 'submitted_at'],
    },
    indexes: {
      payment_proofs: ['PRIMARY', 'idx_payment_proofs_order_created'],
    },
    foreignKeys: [
      { name: 'fk_payment_proofs_order', table: 'payment_proofs', column: 'order_id', refTable: 'orders', refColumn: 'id' },
    ],
  },
  migrateTracking: {
    tables: ['orders'],
    columns: {
      orders: ['carrier', 'tracking_number', 'tracking_url'],
    },
  },
  migrateCatalogSeo: {
    tables: ['products', 'categories'],
    columns: {
      products: ['seo_title', 'seo_description', 'og_image'],
      categories: ['seo_title', 'seo_description', 'og_image'],
    },
  },
  migrateGalleryYoutube: {
    tables: ['gallery_items'],
    columns: {
      gallery_items: ['youtube_url', 'custom_cover_path'],
    },
  },
  migrateCmsPhase1aSaveRepair: {
    tables: ['page_sections', 'pages'],
    existsRows: [
      {
        label: 'home page',
        sql: "SELECT 1 AS ok FROM pages WHERE page_key = 'home' LIMIT 1",
      },
    ],
  },
  migrateRevisionSourceId: {
    tables: ['content_revisions'],
    columns: {
      content_revisions: ['source_revision_id', 'actor_name', 'actor_email'],
    },
    indexes: {
      content_revisions: ['idx_content_revisions_source'],
    },
  },
  migrateStoreHeroCms: {
    tables: ['pages', 'page_sections'],
    existsRows: [
      {
        label: 'tienda page',
        sql: "SELECT 1 AS ok FROM pages WHERE page_key = 'tienda' LIMIT 1",
      },
    ],
  },
  migrateSocialFeed: {
    tables: ['social_posts'],
    columns: {
      social_posts: ['id', 'public_id', 'platform', 'post_url', 'status', 'created_at'],
    },
    indexes: {
      social_posts: ['PRIMARY', 'uk_social_posts_public_id'],
    },
  },
  migrateTestimonials: {
    tables: ['testimonials'],
    columns: {
      testimonials: ['id', 'public_id', 'display_name', 'testimonial_text', 'status', 'created_at'],
    },
    indexes: {
      testimonials: ['PRIMARY', 'uk_testimonials_public_id'],
    },
  },
  migrateSocialIntegrations: {
    tables: ['social_integrations'],
    columns: {
      social_integrations: ['id', 'provider', 'label', 'is_connected', 'is_enabled'],
    },
    indexes: {
      social_integrations: ['PRIMARY', 'uk_social_int_provider'],
    },
    seedRows: [{ table: 'social_integrations', where: { provider: 'youtube' } }],
  },
  migrateSocialSyncRuns: {
    tables: ['social_sync_runs'],
    columns: {
      social_sync_runs: ['id', 'provider', 'status', 'started_at'],
    },
    indexes: {
      social_sync_runs: ['PRIMARY', 'idx_sync_runs_provider'],
    },
  },
  migrateSocialPostsImportFields: {
    tables: ['social_posts'],
    columns: {
      social_posts: ['provider', 'provider_external_id', 'provider_synced_at', 'is_imported'],
    },
    indexes: {
      social_posts: ['uk_social_posts_provider_ext'],
    },
  },
  migrateSocialTokenSecrets: {
    tables: ['social_token_secrets'],
    columns: {
      social_token_secrets: ['id', 'provider', 'account_id', 'encrypted_data', 'iv', 'auth_tag'],
    },
    indexes: {
      social_token_secrets: ['PRIMARY', 'uk_token_secrets'],
    },
  },
  migrateSocialOAuthStates: {
    tables: ['social_oauth_states'],
    columns: {
      social_oauth_states: ['id', 'state_id', 'provider', 'expires_at'],
    },
    indexes: {
      social_oauth_states: ['PRIMARY', 'uk_oauth_state'],
    },
  },
  migrateSeedMetaIntegrations: {
    tables: ['social_integrations', 'social_oauth_states'],
    columns: {
      social_oauth_states: ['session_id'],
    },
    indexes: {
      social_oauth_states: ['idx_oauth_session'],
    },
    seedRows: [
      { table: 'social_integrations', where: { provider: 'instagram' } },
      { table: 'social_integrations', where: { provider: 'facebook' } },
    ],
  },
  migrateSeedTikTok: {
    tables: ['social_integrations'],
    seedRows: [{ table: 'social_integrations', where: { provider: 'tiktok' } }],
  },
  migrateSocialPostsProviderThumbnail: {
    tables: ['social_posts'],
    columns: {
      social_posts: ['provider_thumbnail_url', 'provider_thumbnail_expires_at'],
    },
  },
};

/** Encoding-drift checksum pairs for remaining historical migrations. */
const HISTORICAL_RECONCILE_CHECKSUMS = {
  migratePanels: {
    oldChecksum: '4f6ad814fdc00db54bba550e29de88d093952375fb8bf756eb652ac28e533f9d',
    newChecksum: 'c75461068fe77e2c086fc580bfde811c43c7b6fe3c8b78d9257aa3914853c026',
  },
  migratePublishing: {
    oldChecksum: 'd558cd2d3fab00a07ae1a3ab3f964a47baaaebbe8c7ef720bc1df7a8b7675c18',
    newChecksum: 'f0fe2ee53d36fe3ced483f079747026fe28718465aacea7fea88e6869a4cf761',
  },
  migrateCmsDraftPublish: {
    oldChecksum: 'fe720a2f473a4066771f6205f182884ef20306c697831af595e34f6baef49a15',
    newChecksum: 'de4eeb435d7e7540efec004a62aea26f29251572a0ced34e0585e333eb6cd2fc',
  },
  migrateCatalog: {
    oldChecksum: 'f1735868498f774d950e7e02d50a41497f06bc18b7133cbf9c51b48bfee7f98b',
    newChecksum: 'c5d30229487b254759e630e9a30e89587c8ec839c8bc8da1a2f88bed5915ae50',
  },
  migrateOrders: {
    oldChecksum: '8f47cfd26b55336868e196fde3890eb73d872667ab8cf0d480509805c3a08691',
    newChecksum: '6fa21e853218d26e2e9ff1ba1247b3be45b40097a9b80f2859b2e6cf7d65bd58',
  },
  migrateCategoryHero: {
    oldChecksum: '947361f86c2493977f7a847c1e2fd9bad791f5ee3736904a73062caa57cdb719',
    newChecksum: '5e07a9baa3cac799e9a3dc54200407fc6738b869efa5bef4ef8858609bbc0b8d',
  },
  migrateGallery: {
    oldChecksum: '9e871047bfbd597c436f19baf0c6c002ad911ec17b7a2fcdf7b340ecdb25745f',
    newChecksum: 'ba06d3e4694389d79018ac053b55bfd22a72d237267b23022a074bd5192b7e1a',
  },
  migratePaymentProofs: {
    oldChecksum: '0d499e640fa1236c6afd334c87b23b9104e36916234d16744aef51c439a87339',
    newChecksum: 'a92d222cea72eb38bc9d5653e3d2b588719319d904499a3a1a0ca0d7f82bcf80',
  },
  migrateTracking: {
    oldChecksum: '1d7c01a871fc39c1c77745ac5e87069117c55615b035f075bd23945005695af5',
    newChecksum: 'b997c609b267166e8320ddd80274e08faff223c292ccbfeaae4a6fc3f988595c',
  },
  migrateCatalogSeo: {
    oldChecksum: '07630bee49d259759cb0f16e945fa01ef57be243542640d92cfec79c97d79743',
    newChecksum: '15a80ea97b92e26952f90a1a6898345b1de32bbd389d106ee0c04baf3dba154a',
  },
  migrateGalleryYoutube: {
    oldChecksum: '1980f81709c7bdbd1ace66fbbe15b65b725c8ffb0f05937392e783c931f87f01',
    newChecksum: '6698fbd3f6555e76d8e01e769130ad014b6d6af766934b7cdded63f238e2b20b',
  },
  migrateCmsPhase1aSaveRepair: {
    oldChecksum: '27753f435a5a3898630ec7e014ee3daf6bf106c49f4dc9c31d5ef23eebdd58a8',
    newChecksum: '95479de73b91b0f509cbc03f7e22b420cf054659b38352276ac4f5e5868b5d9f',
  },
  migrateRevisionSourceId: {
    oldChecksum: 'bfbd386d1a91d3166c0c623da0146139c2a73a111528e17c20fbcbcefe769954',
    newChecksum: '53892db8756fc475ef4a63a42bb8f3997c64a1d3f7be63c27ee063398bee4754',
  },
  migrateStoreHeroCms: {
    oldChecksum: '18ae6de063e25d32f2c8b4a7be773ea7ddbec7e2ccae3044f289be168ed11784',
    newChecksum: '42b21ba1e6159fd3bfeeba6042de466b121205da8b3cb1cb31c29e6b34ad41c8',
  },
  migrateSocialFeed: {
    oldChecksum: 'c810f5ad8ada5d8d1db291f7f6636e4fee1975929bdeaa0a799d8d9849254b71',
    newChecksum: '1f7d2404ac30215b20d8fc24c9f1cfe8245724e7553a1d7ab9646690ff37b313',
  },
  migrateTestimonials: {
    oldChecksum: '8d58fab419f3a2bc19864c659c2d011ba0db07c8d8e783647a61a930b7605a6d',
    newChecksum: '59b3c3fc8a803b686b98988d26abbc42d6c9a4d6feba1c0ab83b94574ca5fe46',
  },
  migrateSocialIntegrations: {
    oldChecksum: 'd076264e079d74cc69523eb5aeac3f23db5e657ad812b60072793ab9d325edc6',
    newChecksum: '6154521b99fb5a26a8aee31e6bae5ab151f4e5505f655d52244314ca03fb6575',
  },
  migrateSocialSyncRuns: {
    oldChecksum: '8bbca91d6159d30b528fdbcdbbd01e06f1cccc6331ef713381b57d7e694206cb',
    newChecksum: 'e7549be2b42881d410ed8bec22ea8ef71cabaa5548f93db8672f78b39dae9215',
  },
  migrateSocialPostsImportFields: {
    oldChecksum: '75b3c81450bc98026445aef91c009242a430ba5c5982d6c81afbcbf214c0411d',
    newChecksum: 'dcdfc6ecc7c70543e2d72539ccf6e01d052a139405d9c85696ef1037f0816c05',
  },
  migrateSocialTokenSecrets: {
    oldChecksum: '46b7ac4772b07cd39af80884e453526e93ffc3f4078a7b485d8a686233b704f4',
    newChecksum: 'bf13d5e3c75d135d3cc03ea2955a32805b5db036278b9ed77e714f04f64fcaac',
  },
  migrateSocialOAuthStates: {
    oldChecksum: '578690527ad288f42fb7559dabb5b2a78eabda54e586e396a4d2ec9ed4542254',
    newChecksum: '77c0d68b593588ae405020f0785f8fb0561f86e4707a6979ac01f9c1d80ce9d3',
  },
  migrateSeedMetaIntegrations: {
    oldChecksum: 'f8e3200c1c51241cf71dcfca64f8bb586c5528162ea41dcf043ddea12ec6f3e6',
    newChecksum: '37c8c48c6f34643760b6bc01366ef863cc38da705e34d2ec6ad05cccea9c4264',
  },
  migrateSeedTikTok: {
    oldChecksum: 'cfa43fa791333affa45b78821446e9cb88349eb7bf21d8e6313b705db8db8b9d',
    newChecksum: '37a5ad9b5080a4d0c81f64137cf843dc1864f552c8def1b737bf449f5f36c607',
  },
  migrateSocialPostsProviderThumbnail: {
    oldChecksum: 'd8a6729ae3bc70df9e7bcd63813dcc0dfe4a259cc5c91f14c919d65959a6bb4b',
    newChecksum: '738d34c8cf703fc66b52645bfafff658b07ea130a14804e76b3b83ac48706fc5',
  },
};

function buildHistoricalReconcileEntries() {
  const entries = {};
  for (const [name, checksums] of Object.entries(HISTORICAL_RECONCILE_CHECKSUMS)) {
    entries[name] = {
      oldChecksum: checksums.oldChecksum,
      newChecksum: checksums.newChecksum,
      reason: 'encoding drift after original execution (no schema regression; verified)',
      verifySchema: makeVerifier(CONTRACTS[name], name),
    };
  }
  return entries;
}

module.exports = {
  verifySchemaContract,
  makeVerifier,
  CONTRACTS,
  HISTORICAL_RECONCILE_CHECKSUMS,
  buildHistoricalReconcileEntries,
};
