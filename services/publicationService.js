/**
 * Central publication service — Phase 11D.
 *
 * Coordinates atomic batch publication for all CMS modules.
 * Extends existing cmsPublishingService and cmsRepeatableService.
 * Handles validation, dependency resolution, batch creation,
 * transactional publication, cache invalidation, and audit trail.
 */
const crypto = require('crypto');
const pool = require('../config/db');
const publishing = require('./cmsPublishingService');
const repeatable = require('./cmsRepeatableService');
const revisions = require('./contentRevisionService');
const registry = require('./moduleRegistry');

function batchPublicId() {
  return crypto.randomUUID();
}

/**
 * Build the pending-changes dashboard summary.
 * Returns one object per module with status and metadata.
 */
async function buildDashboardSummary() {
  const modules = registry.getAllModules();
  const cards = [];

  for (const mod of modules) {
    const card = {
      moduleKey: mod.key,
      label: mod.label,
      hasPending: false,
      status: 'sin_cambios',
      lastDraftAt: null,
      lastPublishedAt: null,
      lastEditor: null,
      lastPublisher: null,
      pendingCount: 0,
      validation: null,
    };

    try {
      card.hasPending = await mod.pendingCheck();
      card.status = card.hasPending ? 'cambios_sin_publicar' : 'sin_cambios';

      // Validation
      try {
        card.validation = await mod.validate();
        if (card.validation && card.validation.errors && card.validation.errors.length) {
          card.status = 'borrador_invalido';
        }
      } catch { card.validation = { valid: true, errors: [], warnings: [] }; }

      // Latest revision for this module
      const entityTypes = mod.revisionEntityTypes.map(t => `'${t}'`).join(',');
      if (entityTypes) {
        const [revRows] = await pool.query(
          `SELECT cr.action, cr.change_summary, cr.created_at, u.name AS actor_name
           FROM content_revisions cr
           LEFT JOIN users u ON u.id = cr.changed_by
           WHERE cr.entity_type IN (${entityTypes})
           ORDER BY cr.created_at DESC LIMIT 1`
        );
        if (revRows.length) {
          card.lastDraftAt = revRows[0].created_at;
          card.lastEditor = revRows[0].actor_name;
        }
      }
    } catch (e) {
      card.status = 'error';
      card.error = 'Error al obtener estado.';
    }

    cards.push(card);
  }

  return cards;
}

/**
 * Validate all selected modules. Returns aggregated validation result.
 */
async function validateModules(moduleKeys) {
  const results = { valid: true, errors: [], warnings: [], modules: {} };

  for (const key of moduleKeys) {
    const mod = registry.getModule(key);
    try {
      const validation = await mod.validate();
      results.modules[key] = validation;
      if (validation && !validation.valid) {
        results.valid = false;
        results.errors.push(`${mod.label}: ${(validation.errors || []).join('; ')}`);
      }
      if (validation && validation.warnings && validation.warnings.length) {
        results.warnings.push(...validation.warnings.map(w => `${mod.label}: ${w}`));
      }
    } catch (e) {
      results.valid = false;
      results.errors.push(`${mod.label}: ${e.message}`);
    }
  }

  return results;
}

/**
 * Publish a set of modules atomically.
 *
 * @param {string[]} moduleKeys - Allowlisted module keys
 * @param {string} scope - 'selected' | 'homepage' | 'module'
 * @param {object} options - { actorId, forceDependentSections }
 * @returns {object} { batch, items, success }
 */
async function publishModules(moduleKeys, scope = 'selected', { actorId = null } = {}) {
  if (!moduleKeys || !moduleKeys.length) {
    throw new Error('Debe seleccionar al menos un módulo para publicar.');
  }

  // Validate allowlisted keys
  const invalid = moduleKeys.filter(k => !registry.MODULE_KEY_VALUES.includes(k));
  if (invalid.length) throw new Error(`Módulos no reconocidos: ${invalid.join(', ')}`);

  // Check for duplicates
  if (new Set(moduleKeys).size !== moduleKeys.length) {
    throw new Error('No se permiten módulos duplicados.');
  }

  // Resolve dependencies
  const resolved = new Set();
  for (const key of moduleKeys) {
    const mod = registry.getModule(key);
    for (const dep of mod.dependencies) {
      if (!moduleKeys.includes(dep) && !resolved.has(dep)) {
        // Auto-include dependent modules for homepage/full publishes
        if (scope === 'homepage') {
          resolved.add(dep);
        }
      }
    }
    resolved.add(key);
  }

  const orderedKeys = [...resolved];

  // Pre-validate
  const validation = await validateModules(orderedKeys);
  if (!validation.valid) {
    throw new Error(`Validación fallida: ${validation.errors.join('; ')}`);
  }

  const batchId = batchPublicId();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Create batch
    const [batchResult] = await connection.query(
      `INSERT INTO publication_batches (public_id, scope, status, created_by)
       VALUES (?, ?, 'validating', ?)`,
      [batchId, scope, actorId]
    );
    const batchDbId = batchResult.insertId;

    const items = [];
    const summaryParts = [];

    for (const key of orderedKeys) {
      const mod = registry.getModule(key);
      let itemStatus = 'published';
      let errorMessage = null;
      let sourceRevId = null;
      let publishedRevId = null;
      let previousSnapshot = null;
      let newSnapshot = null;

      try {
        const moduleResult = await publishSingleModule(connection, key, actorId);
        if (moduleResult.sourceRevId) sourceRevId = moduleResult.sourceRevId;
        if (moduleResult.publishedRevId) publishedRevId = moduleResult.publishedRevId;
        if (moduleResult.previousSnapshot) previousSnapshot = moduleResult.previousSnapshot;
        if (moduleResult.newSnapshot) newSnapshot = moduleResult.newSnapshot;
        summaryParts.push(`${mod.label}: publicado`);
      } catch (e) {
        itemStatus = 'failed';
        errorMessage = e.message;
        summaryParts.push(`${mod.label}: ERROR — ${e.message}`);

        // Create failed item record
        await connection.query(
          `INSERT INTO publication_batch_items
           (batch_id, module_key, entity_type, source_revision_id, status, error_message)
           VALUES (?, ?, NULL, NULL, 'failed', ?)`,
          [batchDbId, key, errorMessage.slice(0, 500)]
        );

        // Rollback entire batch
        await connection.rollback();
        throw new Error(`Publicación fallida en "${mod.label}": ${e.message}`);
      }

      await connection.query(
        `INSERT INTO publication_batch_items
         (batch_id, module_key, entity_type, source_revision_id, published_revision_id,
          previous_published_snapshot, new_published_snapshot, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          batchDbId, key,
          mod.revisionEntityTypes[0] || null,
          sourceRevId, publishedRevId,
          previousSnapshot ? JSON.stringify(previousSnapshot) : null,
          newSnapshot ? JSON.stringify(newSnapshot) : null,
          itemStatus,
        ]
      );

      items.push({ moduleKey: key, status: itemStatus });
    }

    // Mark batch as published
    await connection.query(
      `UPDATE publication_batches SET status='published', published_by=?, published_at=NOW(), summary=?
       WHERE id=?`,
      [actorId, summaryParts.join(' | ').slice(0, 500), batchDbId]
    );

    await connection.commit();

    // Invalidate caches after commit
    for (const key of orderedKeys) {
      const mod = registry.getModule(key);
      for (const ns of mod.cacheNamespaces) {
        publishing.invalidateNamespace(ns);
      }
    }

    return { batchId, items, success: true };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Publish a single module within an existing transaction.
 */
async function publishSingleModule(connection, moduleKey, actorId) {
  const mod = registry.getModule(moduleKey);
  const { MODULE_KEYS } = registry;

  switch (moduleKey) {
    case MODULE_KEYS.NAVBAR:
      return publishNavbarInTx(connection, actorId);

    case MODULE_KEYS.HERO:
      return publishHeroInTx(connection, actorId);

    case MODULE_KEYS.SHOWCASE:
      return publishPageSectionInTx(connection, 'home', 'showcase', actorId);

    case MODULE_KEYS.SERVICES:
      return publishPageSectionInTx(connection, 'home', 'services', actorId);

    case MODULE_KEYS.LOGO_LOOP:
      return publishCollectionInTx(connection, 'logo_loop_items', 'logo_loop_item', actorId);

    case MODULE_KEYS.CAROUSEL:
      return publishCollectionInTx(connection, 'home_carousel_items', 'carousel_item', actorId);

    case MODULE_KEYS.FEATURES:
      return publishCollectionInTx(connection, 'home_feature_items', 'feature_item', actorId);

    case MODULE_KEYS.STORE_HERO:
      return publishPageSectionInTx(connection, 'tienda', 'st-hero', actorId);

    case MODULE_KEYS.ABOUT_PAGE:
      return publishPageSectionInTx(connection, 'nosotros', 'about-content', actorId);

    case MODULE_KEYS.SOCIAL_FEED:
      return publishSocialFeedInTx(connection, actorId);

    case MODULE_KEYS.TESTIMONIALS:
      return publishTestimonialsInTx(connection, actorId);

    default:
      throw new Error(`Módulo sin publicador: ${moduleKey}`);
  }
}

async function recordPublicationRevision(connection, payload) {
  const revisionNumber = await revisions.recordRevision(payload, connection);
  const [[revision]] = await connection.query(
    `SELECT id
       FROM content_revisions
      WHERE entity_type = ? AND entity_id = ? AND revision_number = ?
      LIMIT 1`,
    [payload.entityType, Number(payload.entityId), revisionNumber]
  );
  if (!revision?.id) {
    throw new Error('No se pudo confirmar la revisión de publicación.');
  }
  return revision.id;
}

async function publishNavbarInTx(connection, actorId) {
  const settingKeys = [
    'site.logo_primary', 'site.logo_light', 'site.logo_dark', 'site.favicon',
    'navbar.bg_color', 'navbar.text_color', 'navbar.accent_color',
    'navbar.border_color', 'navbar.opacity', 'navbar.logo_width',
  ];
  const placeholders = settingKeys.map(() => '?').join(',');
  const [settings] = await connection.query(
    `SELECT id, setting_key, setting_value, published_value
       FROM site_settings
      WHERE setting_key IN (${placeholders}) AND has_unpublished_changes = 1
      FOR UPDATE`,
    settingKeys
  );
  await connection.query(
    `UPDATE site_settings
        SET published_value = setting_value, has_unpublished_changes = 0,
            published_at = NOW(), updated_by = ?
      WHERE setting_key IN (${placeholders}) AND has_unpublished_changes = 1`,
    [actorId, ...settingKeys]
  );
  let publishedRevId = null;
  for (const setting of settings) {
      publishedRevId = await recordPublicationRevision(connection, {
        entityType: 'site_setting',
        entityId: setting.id,
        action: 'publish',
        previousData: { setting_key: setting.setting_key, published_value: setting.published_value },
        newData: { setting_key: setting.setting_key, published_value: setting.setting_value },
        changeSummary: `Configuración ${setting.setting_key} publicada desde publicación centralizada.`,
        changedBy: actorId,
      });
  }
  const [items] = await connection.query(
    `SELECT * FROM navigation_items
      WHERE location = 'home' AND (status IN ('draft', 'archived') OR published_data IS NULL)
      FOR UPDATE`
  );
  for (const item of items) {
    if (item.status === 'archived') {
      await connection.query(
        `UPDATE navigation_items
            SET published_data = NULL, published_at = NOW(), deleted_at = NOW(), updated_by = ?
          WHERE id = ?`,
        [actorId, item.id]
      );
      publishedRevId = await recordPublicationRevision(connection, {
        entityType: 'navigation_item',
        entityId: item.id,
        action: 'publish',
        previousData: { status: item.status, published_data: item.published_data },
        newData: { status: 'archived', published_data: null },
        changeSummary: 'Elemento de navegación archivado desde publicación centralizada.',
        changedBy: actorId,
      });
      continue;
    }
    const snapshot = {
      label: item.label,
      url: item.url,
      link_type: item.link_type,
      target: item.target,
      media_public_id: item.media_public_id,
      sort_order: item.sort_order,
      is_visible: item.is_visible,
    };
    await connection.query(
      `UPDATE navigation_items
          SET published_data = ?, published_at = NOW(), status = 'published',
              deleted_at = NULL, updated_by = ?
        WHERE id = ?`,
      [JSON.stringify(snapshot), actorId, item.id]
    );
    publishedRevId = await recordPublicationRevision(connection, {
      entityType: 'navigation_item',
      entityId: item.id,
      action: 'publish',
      previousData: { status: item.status, published_data: item.published_data },
      newData: { status: 'published', published_data: snapshot },
      changeSummary: 'Elemento de navegación publicado desde publicación centralizada.',
      changedBy: actorId,
    });
  }
  if (!settings.length && !items.length) {
    return { publishedRevId: null, sourceRevId: null, previousSnapshot: null, newSnapshot: null, skipped: true };
  }
  return { publishedRevId, sourceRevId: null,
    previousSnapshot: { settingCount: settings.length, itemCount: items.length },
    newSnapshot: { status: 'published', settingCount: settings.length, itemCount: items.length } };
}

async function publishHeroInTx(connection, actorId) {
  const result = await publishPageSectionInTx(connection, 'home', 'hero', actorId);
  await publishCollectionInTx(connection, 'home_social_items', 'social_item', actorId);
  return result;
}

async function publishPageSectionInTx(connection, pageKey, sectionKey, actorId) {
  const [[before]] = await connection.query(
    "SELECT s.id, s.content_json, s.style_json, s.published_content_json, s.published_style_json, s.status, s.is_enabled FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ? FOR UPDATE",
    [pageKey, sectionKey]
  );
  if (!before) throw new Error(`Sección ${sectionKey} no encontrada.`);

  if (before.status === 'published' && Number(before.is_enabled) === 1) {
    return { publishedRevId: null, sourceRevId: null, previousSnapshot: null, newSnapshot: null, skipped: true };
  }

  await connection.query(
    "UPDATE page_sections s INNER JOIN pages p ON p.id = s.page_id SET s.published_content_json = s.content_json, s.published_style_json = s.style_json, s.published_at = NOW(), s.status = 'published', s.is_enabled = 1, s.version = s.version + 1 WHERE p.page_key = ? AND s.section_key = ?",
    [pageKey, sectionKey]
  );

  const publishedRevId = await recordPublicationRevision(connection, {
    entityType: 'page_section',
    entityId: before.id,
    action: 'publish',
    previousData: JSON.stringify({ status: before.status, content_json: before.content_json, style_json: before.style_json }),
    newData: JSON.stringify({ status: 'published', content_json: before.content_json, style_json: before.style_json }),
    changeSummary: `Sección ${sectionKey} publicada desde publicación centralizada.`,
    changedBy: actorId,
  });

  return {
    publishedRevId,
    sourceRevId: null,
    previousSnapshot: {
      status: before.status,
      content_json: before.published_content_json,
      style_json: before.published_style_json,
    },
    newSnapshot: { status: 'published', content_json: before.content_json, style_json: before.style_json },
  };
}

async function publishSocialFeedInTx(connection, actorId) {
  const [before] = await connection.query(
    `SELECT * FROM social_posts WHERE status = 'draft' AND archived_at IS NULL FOR UPDATE`
  );
  if (!before.length) {
    return { publishedRevId: null, sourceRevId: null, previousSnapshot: null, newSnapshot: null, skipped: true };
  }
  let publishedRevId = null;
  for (const item of before) {
    const contentJson = JSON.stringify({
      platform: item.platform,
      postUrl: item.post_url,
      title: item.title,
      description: item.description,
      thumbnailMediaRef: item.thumbnail_media_ref,
      embedEnabled: Boolean(item.embed_enabled),
      displayMode: item.display_mode,
      isFeatured: Boolean(item.is_featured),
    });
    await connection.query(
      `UPDATE social_posts
         SET status = 'published', published_content_json = ?, published_at = NOW(), updated_by = ?
       WHERE id = ?`,
      [contentJson, actorId, item.id]
    );
    publishedRevId = await recordPublicationRevision(connection, {
      entityType: 'social_post',
      entityId: item.id,
      action: 'publish',
      previousData: { public_id: item.public_id, status: 'draft' },
      newData: { public_id: item.public_id, status: 'published' },
      changeSummary: 'Social post publicado.',
      changedBy: actorId,
    });
  }
  return { publishedRevId, sourceRevId: null, previousSnapshot: null, newSnapshot: null, skipped: false };
}

async function publishTestimonialsInTx(connection, actorId) {
  const [before] = await connection.query(
    `SELECT * FROM testimonials WHERE status = 'draft' AND archived_at IS NULL FOR UPDATE`
  );
  if (!before.length) {
    return { publishedRevId: null, sourceRevId: null, previousSnapshot: null, newSnapshot: null, skipped: true };
  }
  let publishedRevId = null;
  for (const item of before) {
    const contentJson = JSON.stringify({
      displayName: item.display_name,
      testimonialText: item.testimonial_text,
      platform: item.platform,
      sourceUrl: item.source_url,
      avatarMediaRef: item.avatar_media_ref,
      rating: item.rating,
      isFeatured: Boolean(item.is_featured),
    });
    await connection.query(
      `UPDATE testimonials
         SET status = 'published', published_content_json = ?, published_at = NOW(), updated_by = ?
       WHERE id = ?`,
      [contentJson, actorId, item.id]
    );
    publishedRevId = await recordPublicationRevision(connection, {
      entityType: 'testimonial',
      entityId: item.id,
      action: 'publish',
      previousData: { public_id: item.public_id, status: 'draft' },
      newData: { public_id: item.public_id, status: 'published' },
      changeSummary: 'Testimonio publicado.',
      changedBy: actorId,
    });
  }
  return { publishedRevId, sourceRevId: null, previousSnapshot: null, newSnapshot: null, skipped: false };
}

async function publishCollectionInTx(connection, table, entityType, actorId) {
  const [before] = await connection.query(
    `SELECT * FROM \`${table}\`
      WHERE status IN ('draft', 'archived') OR published_data IS NULL
      FOR UPDATE`
  );
  if (!before.length) {
    return { publishedRevId: null, sourceRevId: null, previousSnapshot: null, newSnapshot: null, skipped: true };
  }
  const fields = repeatable.PUBLISHED_FIELDS[table];
  if (!fields) throw new Error(`Colección no permitida: ${table}`);
  let publishedRevId = null;
  for (const item of before) {
    if (item.status === 'archived') {
      await connection.query(
        `UPDATE \`${table}\`
            SET published_data = NULL, published_at = NOW(), deleted_at = NOW(), updated_by = ?
          WHERE id = ?`,
        [actorId, item.id]
      );
      publishedRevId = await recordPublicationRevision(connection, {
        entityType,
        entityId: item.id,
        action: 'publish',
        previousData: { public_id: item.public_id, status: item.status, published_data: item.published_data },
        newData: { public_id: item.public_id, status: 'archived', published_data: null },
        changeSummary: `Elemento de ${table} archivado desde publicación centralizada.`,
        changedBy: actorId,
      });
      continue;
    }
    const snapshot = Object.fromEntries(fields.map((field) => [field, item[field]]));
    await connection.query(
      `UPDATE \`${table}\`
          SET published_data = ?, published_at = NOW(), status = 'published',
              deleted_at = NULL, updated_by = ?
        WHERE id = ?`,
      [JSON.stringify(snapshot), actorId, item.id]
    );
    publishedRevId = await recordPublicationRevision(connection, {
      entityType,
      entityId: item.id,
      action: 'publish',
      previousData: { public_id: item.public_id, status: item.status, published_data: item.published_data },
      newData: { public_id: item.public_id, status: 'published', published_data: snapshot },
      changeSummary: `Elemento de ${table} publicado desde publicación centralizada.`,
      changedBy: actorId,
    });
  }
  const sectionIds = [...new Set(before.map((item) => item.page_section_id).filter(Boolean))];
  for (const sectionId of sectionIds) {
    await connection.query('UPDATE page_sections SET is_enabled = 1 WHERE id = ?', [sectionId]);
  }

  return {
    publishedRevId,
    sourceRevId: null,
    previousSnapshot: { status: 'draft', itemCount: before.length },
    newSnapshot: { status: 'published', itemCount: before.length },
  };
}

module.exports = {
  buildDashboardSummary,
  validateModules,
  publishModules,
  batchPublicId,
};
