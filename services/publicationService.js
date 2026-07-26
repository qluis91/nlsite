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
      return publishPageSectionInTx(connection, 'home', 'hero', actorId);

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

    default:
      throw new Error(`Módulo sin publicador: ${moduleKey}`);
  }
}

async function publishNavbarInTx(connection, actorId) {
  // Publish navigation items
  await connection.query(
    "UPDATE navigation_items SET status='published' WHERE location='home' AND status='draft' AND deleted_at IS NULL"
  );
  // Record revision
  const revNum = await revisions.recordRevision({
    entityType: 'navigation_item',
    entityId: 0,
    action: 'replace',
    previousData: JSON.stringify({ status: 'draft' }),
    newData: JSON.stringify({ status: 'published' }),
    changeSummary: 'Navbar publicado desde publicación centralizada.',
    changedBy: actorId,
  }, connection);
  return { publishedRevId: revNum, sourceRevId: null,
   previousSnapshot: { status: 'draft' }, newSnapshot: { status: 'published' } };
}

async function publishPageSectionInTx(connection, pageKey, sectionKey, actorId) {
  const [[before]] = await connection.query(
    "SELECT s.id, s.content_json, s.style_json, s.status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ? FOR UPDATE",
    [pageKey, sectionKey]
  );
  if (!before) throw new Error(`Sección ${sectionKey} no encontrada.`);

  if (before.status === 'published') {
    return { publishedRevId: null, sourceRevId: null, previousSnapshot: null, newSnapshot: null, skipped: true };
  }

  await connection.query(
    "UPDATE page_sections s INNER JOIN pages p ON p.id = s.page_id SET s.status = 'published', s.version = s.version + 1 WHERE p.page_key = ? AND s.section_key = ?",
    [pageKey, sectionKey]
  );

  const revNum = await revisions.recordRevision({
    entityType: 'page_section',
    entityId: before.id,
    action: 'replace',
    previousData: JSON.stringify({ status: before.status, content_json: before.content_json, style_json: before.style_json }),
    newData: JSON.stringify({ status: 'published', content_json: before.content_json, style_json: before.style_json }),
    changeSummary: `Sección ${sectionKey} publicada desde publicación centralizada.`,
    changedBy: actorId,
  }, connection);

  return {
    publishedRevId: revNum,
    sourceRevId: null,
    previousSnapshot: { status: before.status },
    newSnapshot: { status: 'published' },
  };
}

async function publishCollectionInTx(connection, table, entityType, actorId) {
  const [before] = await connection.query(
    `SELECT id, public_id, status FROM \`${table}\` WHERE status='draft' AND deleted_at IS NULL`
  );

  await connection.query(
    `UPDATE \`${table}\` SET status='published' WHERE status='draft' AND deleted_at IS NULL`
  );

  const revNum = await revisions.recordRevision({
    entityType,
    entityId: 0,
    action: 'replace',
    previousData: JSON.stringify({ items: before.map(r => ({ public_id: r.public_id, status: r.status })) }),
    newData: JSON.stringify({ items: before.map(r => ({ public_id: r.public_id, status: 'published' })) }),
    changeSummary: `Colección ${table} publicada desde publicación centralizada.`,
    changedBy: actorId,
  }, connection);

  return {
    publishedRevId: revNum,
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
