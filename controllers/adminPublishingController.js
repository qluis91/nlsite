/**
 * Publishing & History controller — Phase 1C.
 *
 * Handles:
 *   - GET /admin/page/publishing   — dashboard
 *   - POST /admin/page/publishing/publish-selected
 *   - POST /admin/page/publishing/publish-home
 *   - GET /admin/page/history       — history browser
 *   - GET /admin/page/history/revision/:id  — revision detail with field diff
 *   - GET /admin/page/history/compare
 *   - GET/POST /admin/page/history/revision/:id/restore
 */
const crypto = require('crypto');
const publicationService = require('../services/publicationService');
const revisionService = require('../services/contentRevisionService');
const diffEngine = require('../services/diffEngine');
const registry = require('../services/moduleRegistry');
const pool = require('../config/db');

// ── Helpers ──

function safeJsonParse(val) {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

function safeStringify(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

function csrfInput(req) {
  return `<input type="hidden" name="_csrf" value="${req.csrfToken?.() || ''}">`;
}

/**
 * Fully merge a restore snapshot into an existing draft, preserving
 * sibling fields not present in the snapshot.
 */
function mergeRestoreSnapshot(existing, snapshot) {
  if (!existing || typeof existing !== 'object') return snapshot || {};
  if (!snapshot || typeof snapshot !== 'object') return existing;
  const result = { ...existing };
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

// ── Publishing Dashboard ──

async function showPublishingDashboard(req, res, next) {
  try {
    const cards = await publicationService.buildDashboardSummary();
    const [batches] = await pool.query(
      `SELECT pb.public_id, pb.scope, pb.status, pb.summary, pb.created_at, pb.published_at,
              u1.name AS created_by_name, u2.name AS published_by_name
       FROM publication_batches pb
       LEFT JOIN users u1 ON u1.id = pb.created_by
       LEFT JOIN users u2 ON u2.id = pb.published_by
       ORDER BY pb.created_at DESC LIMIT 10`
    );

    res.render('pages/admin/page/publishing/index', {
      title: 'Publicación e historial',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      cards,
      recentBatches: batches,
      moduleKeys: registry.MODULE_KEY_VALUES,
      MODULES: registry.MODULES,
      csrfToken: req.csrfToken?.() || '',
      error: req.query.error,
      saved: req.query.saved,
    });
  } catch (e) { return next(e); }
}

// ── Publish Selected ──

async function publishSelected(req, res, next) {
  try {
    const keys = Array.isArray(req.body.modules)
      ? req.body.modules
      : (req.body.modules ? [req.body.modules] : []);

    if (!keys.length) {
      return res.redirect('/admin/page/publishing?error=Sin+módulos+seleccionados');
    }

    await publicationService.publishModules(keys, 'selected', {
      actorId: req.user?.id,
    });
    return res.redirect('/admin/page/publishing?saved=Módulos+publicados+correctamente');
  } catch (e) {
    return res.redirect(`/admin/page/publishing?error=${encodeURIComponent(e.message)}`);
  }
}

// ── Publish Full Home ──

async function publishFullHome(req, res, next) {
  try {
    const allKeys = registry.MODULE_KEY_VALUES;
    await publicationService.publishModules(allKeys, 'homepage', {
      actorId: req.user?.id,
    });
    return res.redirect('/admin/page/publishing?saved=Página+completa+publicada+correctamente');
  } catch (e) {
    return res.redirect(`/admin/page/publishing?error=${encodeURIComponent(e.message)}`);
  }
}

// ── History Browser ──

async function showHistory(req, res, next) {
  try {
    const { moduleKey, action, page, limit, sort } = req.query;
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(50, Math.max(5, parseInt(limit) || 20));
    const offset = (p - 1) * l;

    let where = 'WHERE 1=1';
    const params = [];

    if (moduleKey) {
      const mod = registry.getModule(moduleKey);
      if (mod && mod.revisionEntityTypes.length) {
        const placeholders = mod.revisionEntityTypes.map(() => '?').join(',');
        where += ` AND cr.entity_type IN (${placeholders})`;
        params.push(...mod.revisionEntityTypes);
      }
    }
    if (action) {
      where += ' AND cr.action = ?';
      params.push(action);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total FROM content_revisions cr ${where}`,
      params
    );

    const order = sort === 'oldest' ? 'ASC' : 'DESC';
    const [rows] = await pool.query(
      `SELECT cr.id, cr.entity_type, cr.entity_id, cr.revision_number, cr.action,
              cr.change_summary, cr.created_at, cr.source_revision_id,
              COALESCE(cr.actor_name, u.name) AS actor_name,
              cr.previous_data IS NOT NULL AS has_previous,
              cr.new_data IS NOT NULL AS has_new
       FROM content_revisions cr
       LEFT JOIN users u ON u.id = cr.changed_by
       ${where}
       ORDER BY cr.created_at ${order} LIMIT ? OFFSET ?`,
      [...params, l, offset]
    );

    const revisionActions = require('../config/cmsOptions').REVISION_ACTIONS;

    // Map action codes to Spanish labels for the filter dropdown
    const actionLabels = {
      upload: 'Creación / subida',
      metadata_edit: 'Edición de metadatos',
      replace: 'Reemplazo de archivo',
      archive: 'Archivado',
      restore: 'Restauración',
      permanent_delete: 'Eliminación permanente',
      selector_upload: 'Subida por selector',
      publish: 'Publicación',
      reorder: 'Reordenamiento',
      activate: 'Activación',
      deactivate: 'Desactivación',
    };

    // Map entity types to Spanish labels
    const entityLabels = {
      media_asset: 'Multimedia',
      page: 'Página',
      page_section: 'Sección',
      site_setting: 'Configuración',
      navigation_item: 'Navegación',
      logo_loop_item: 'LogoLoop',
      carousel_item: 'Carrusel',
      feature_item: 'Tarjeta (Panel 3)',
      social_item: 'Red social',
      category: 'Categoría de tienda',
    };

    res.render('pages/admin/page/history/index', {
      title: 'Historial de revisiones',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      revisions: rows,
      total,
      page: p,
      totalPages: Math.ceil(total / l),
      limit: l,
      moduleKey: moduleKey || '',
      action: action || '',
      sort: sort || 'newest',
      moduleKeys: registry.MODULE_KEY_VALUES,
      MODULES: registry.MODULES,
      revisionActions: Object.values(revisionActions),
      actionLabels,
      entityLabels,
      csrfToken: req.csrfToken?.() || '',
      error: req.query.error,
      saved: req.query.saved,
    });
  } catch (e) { return next(e); }
}

// ── Revision Detail ──

async function showRevisionDetail(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(400).send('Revisión no encontrada.');

    const [[rev]] = await pool.query(
      `SELECT cr.*, COALESCE(cr.actor_name, u.name) AS actor_name,
              COALESCE(cr.actor_email, u.email) AS actor_email
       FROM content_revisions cr
       LEFT JOIN users u ON u.id = cr.changed_by
       WHERE cr.id = ?`,
      [id]
    );
    if (!rev) {
      req.session.ninjaAlert = { type: 'error', message: 'Revisión no encontrada.' };
      return res.redirect('/admin/page/history');
    }

    const prevData = safeJsonParse(rev.previous_data);
    const newData = safeJsonParse(rev.new_data);

    // Generate field-level changes using the diff engine
    let fieldChanges = [];
    try {
      fieldChanges = await diffEngine.diffFields(prevData, newData);
    } catch {
      // Fallback to basic diff
      if (prevData && newData && typeof prevData === 'object' && typeof newData === 'object') {
        const allKeys = new Set([...Object.keys(prevData), ...Object.keys(newData)]);
        for (const key of allKeys) {
          if (JSON.stringify(prevData[key]) !== JSON.stringify(newData[key])) {
            fieldChanges.push({
              field: key, label: diffEngine.labelFor(key),
              oldValue: diffEngine.formatValue(prevData[key]),
              newValue: diffEngine.formatValue(newData[key]),
              type: prevData[key] === undefined ? 'added' : newData[key] === undefined ? 'removed' : 'changed',
            });
          }
        }
      }
    }

    // Find related publication batch
    const [batches] = await pool.query(
      `SELECT pb.public_id, pb.scope, pb.status
       FROM publication_batch_items pbi
       JOIN publication_batches pb ON pb.id = pbi.batch_id
       WHERE pbi.source_revision_id = ? OR pbi.published_revision_id = ?
       LIMIT 1`,
      [id, id]
    );

    // Find source revision if this was a restore
    let sourceRev = null;
    if (rev.source_revision_id) {
      const [[src]] = await pool.query(
        'SELECT id, revision_number, action, created_at FROM content_revisions WHERE id = ?',
        [rev.source_revision_id]
      );
      sourceRev = src || null;
    }

    // Determine restoration eligibility
    let restorationEligible = false;
    let restorationNote = null;
    if (newData && typeof newData === 'object' && Object.keys(newData).length > 0) {
      restorationEligible = true;
    } else if (prevData && typeof prevData === 'object' && Object.keys(prevData).length > 0) {
      restorationEligible = true;
    } else {
      restorationNote = 'Esta revisión no contiene datos suficientes para restaurar.';
    }

    // Check if this is a legacy/incomplete record
    const isLegacy = !rev.actor_name && !rev.actor_email && !rev.changed_by;

    res.render('pages/admin/page/history/detail', {
      title: `Revisión #${rev.revision_number}`,
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      revision: rev,
      prevData,
      newData,
      fieldChanges,
      batch: batches[0] || null,
      sourceRev,
      restorationEligible,
      restorationNote,
      isLegacy,
      csrfToken: req.csrfToken?.() || '',
    });
  } catch (e) { return next(e); }
}

// ── Compare Revisions ──

async function showCompare(req, res, next) {
  try {
    const fromId = parseInt(req.query.from);
    const toId = parseInt(req.query.to);
    if (!fromId || !toId || isNaN(fromId) || isNaN(toId)) {
      return res.status(400).send('Debe especificar dos revisiones para comparar.');
    }

    const [[fromRev]] = await pool.query(
      `SELECT cr.*, COALESCE(cr.actor_name, u.name) AS actor_name
       FROM content_revisions cr LEFT JOIN users u ON u.id = cr.changed_by WHERE cr.id = ?`,
      [fromId]
    );
    const [[toRev]] = await pool.query(
      `SELECT cr.*, COALESCE(cr.actor_name, u.name) AS actor_name
       FROM content_revisions cr LEFT JOIN users u ON u.id = cr.changed_by WHERE cr.id = ?`,
      [toId]
    );

    if (!fromRev || !toRev) {
      return res.status(404).send('Una o ambas revisiones no existen.');
    }

    if (fromRev.entity_type !== toRev.entity_type) {
      return res.status(400).send('Las revisiones pertenecen a entidades distintas.');
    }

    const fromData = safeJsonParse(fromRev.new_data || fromRev.previous_data);
    const toData = safeJsonParse(toRev.new_data || toRev.previous_data);

    let differences = [];
    try {
      differences = await diffEngine.diffFields(fromData, toData);
    } catch {
      // Fallback
      if (fromData && toData && typeof fromData === 'object' && typeof toData === 'object') {
        const allKeys = new Set([...Object.keys(fromData), ...Object.keys(toData)]);
        for (const key of allKeys) {
          if (JSON.stringify(fromData[key]) !== JSON.stringify(toData[key])) {
            differences.push({
              field: key, label: diffEngine.labelFor(key),
              oldValue: diffEngine.formatValue(fromData[key]),
              newValue: diffEngine.formatValue(toData[key]),
              type: fromData[key] === undefined ? 'agregado' : toData[key] === undefined ? 'eliminado' : 'modificado',
            });
          }
        }
      }
    }

    res.render('pages/admin/page/history/compare', {
      title: 'Comparar revisiones',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      fromRev, toRev,
      fromData, toData,
      differences,
      csrfToken: req.csrfToken?.() || '',
    });
  } catch (e) { return next(e); }
}

// ── Restore Revision ──

async function showRestore(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(400).send('Revisión no encontrada.');

    const [[rev]] = await pool.query(
      `SELECT cr.*, COALESCE(cr.actor_name, u.name) AS actor_name
       FROM content_revisions cr LEFT JOIN users u ON u.id = cr.changed_by WHERE cr.id = ?`,
      [id]
    );
    if (!rev) return res.status(404).send('Revisión no encontrada.');

    const snapshot = safeJsonParse(rev.new_data || rev.previous_data);

    res.render('pages/admin/page/history/restore', {
      title: 'Restaurar revisión',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      revision: rev,
      snapshot,
      csrfToken: req.csrfToken?.() || '',
    });
  } catch (e) { return next(e); }
}

async function restoreRevision(req, res, next) {
  const id = parseInt(req.params.id);
  const publishAfter = req.body.publish === '1';
  const actorId = req.user?.id;

  if (!id || isNaN(id)) {
    return res.redirect('/admin/page/history?error=Revisión+inválida');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // ── 1. Load the revision ──
    const [[rev]] = await connection.query(
      'SELECT * FROM content_revisions WHERE id = ? FOR UPDATE',
      [id]
    );
    if (!rev) {
      await connection.rollback();
      return res.redirect('/admin/page/history?error=Revisión+no+encontrada');
    }

    const snapshot = safeJsonParse(rev.new_data || rev.previous_data);
    if (!snapshot || (typeof snapshot === 'object' && Object.keys(snapshot).length === 0)) {
      await connection.rollback();
      return res.redirect('/admin/page/history?error=Esta+revisión+no+contiene+datos+restaurables');
    }

    // ── 2. Conflict check — load current draft version ──
    let currentVersion = null;
    if (rev.entity_type === 'page_section') {
      const [[section]] = await connection.query(
        'SELECT id, version FROM page_sections WHERE id = ?',
        [rev.entity_id]
      );
      currentVersion = section;
    }

    // ── 3. Restore content based on entity type ──
    let restored = false;
    let restoredEntityLabel = rev.entity_type;

    if (rev.entity_type === 'page_section') {
      restored = await restorePageSection(connection, rev, snapshot, actorId);
      const [[section]] = await connection.query(
        "SELECT s.name FROM page_sections s WHERE s.id = ?", [rev.entity_id]
      );
      restoredEntityLabel = section?.name || 'Sección';
    } else if (rev.entity_type === 'site_setting') {
      restored = await restoreSiteSetting(connection, rev, snapshot, actorId);
      restoredEntityLabel = 'Configuración';
    } else if (rev.entity_type === 'navigation_item') {
      restored = await restoreNavItem(connection, rev, snapshot, actorId);
      restoredEntityLabel = 'Enlace de navegación';
    } else if (
      ['logo_loop_item', 'carousel_item', 'feature_item', 'social_item'].includes(rev.entity_type)
    ) {
      restored = await restoreRepeatableItem(connection, rev, snapshot, actorId);
      restoredEntityLabel = 'Elemento';
    } else {
      await connection.rollback();
      return res.redirect('/admin/page/history?error=Tipo+de+entidad+no+soportado+para+restauración');
    }

    if (!restored) {
      await connection.rollback();
      return res.redirect(`/admin/page/history?error=No+se+pudo+restaurar+${encodeURIComponent(restoredEntityLabel)}`);
    }

    // ── 4. Record the restore revision ──
    const actor = await revisionService.resolveActor(actorId);
    const restoreSummary = publishAfter
      ? `Restaurado y publicado desde revisión #${rev.revision_number}`
      : `Restaurado como borrador desde revisión #${rev.revision_number}`;

    await revisionService.recordRevision({
      entityType: rev.entity_type,
      entityId: rev.entity_id,
      action: 'restore',
      previousData: { status: 'draft', ...snapshot },
      newData: { status: publishAfter ? 'published' : 'draft', ...snapshot },
      changeSummary: restoreSummary,
      changedBy: actorId,
      actorName: actor.name,
      actorEmail: actor.email,
      sourceRevisionId: id,
    }, connection);

    // ── 5. If publishing immediately, create a publication batch ──
    if (publishAfter) {
      const batchId = crypto.randomUUID();
      await connection.query(
        `INSERT INTO publication_batches (public_id, scope, status, created_by, published_by, published_at, summary)
         VALUES (?, 'restore', 'published', ?, ?, NOW(), ?)`,
        [batchId, actorId, actorId, restoreSummary.slice(0, 500)]
      );
    }

    await connection.commit();

    // Invalidate caches if publishAfter
    if (publishAfter) {
      const publishing = require('../services/cmsPublishingService');
      publishing.invalidateNamespace('sc_home');
      publishing.invalidateNamespace('siteSettings');
      publishing.invalidateNamespace('nav_home');
      publishing.invalidateNamespace('logoLoop_home');
      publishing.invalidateNamespace('carousel_home');
      publishing.invalidateNamespace('features_home');
      publishing.invalidateNamespace('sc_nosotros');
    }

    const msg = publishAfter
      ? `${encodeURIComponent(restoredEntityLabel)}+restaurad${encodeURIComponent(restoredEntityLabel.endsWith('n') ? 'a' : 'o')}+y+publicad${encodeURIComponent(restoredEntityLabel.endsWith('n') ? 'a' : 'o')}`
      : `${encodeURIComponent(restoredEntityLabel)}+restaurad${encodeURIComponent(restoredEntityLabel.endsWith('n') ? 'a' : 'o')}+como+borrador.+Debe+publicar+para+que+los+cambios+sean+visibles`;

    return res.redirect(`/admin/page/history?saved=${msg}`);
  } catch (e) {
    await connection.rollback().catch(() => {});
    return res.redirect(`/admin/page/history?error=${encodeURIComponent(e.message)}`);
  } finally {
    connection.release();
  }
}

// ── Restore helpers ──

async function restorePageSection(connection, rev, snapshot, actorId) {
  const { content_json, style_json } = snapshot;
  const updates = [];
  const params = [];

  if (content_json !== undefined) {
    let contentVal;
    if (typeof content_json === 'object') {
      contentVal = JSON.stringify(content_json);
    } else if (typeof content_json === 'string') {
      contentVal = content_json;
    } else {
      return false;
    }
    updates.push('content_json = ?');
    params.push(contentVal);
  }
  if (style_json !== undefined) {
    let styleVal;
    if (typeof style_json === 'object') {
      styleVal = JSON.stringify(style_json);
    } else if (typeof style_json === 'string') {
      styleVal = style_json;
    } else {
      return false;
    }
    updates.push('style_json = ?');
    params.push(styleVal);
  }

  if (!updates.length) return false;

  updates.push("status = 'draft'");
  updates.push('is_enabled = 1');
  updates.push('version = version + 1');
  updates.push('updated_by = ?');
  params.push(actorId);

  params.push(rev.entity_id);

  await connection.query(
    `UPDATE page_sections SET ${updates.join(', ')} WHERE id = ?`,
    params
  );
  return true;
}

async function restoreSiteSetting(connection, rev, snapshot, actorId) {
  const { setting_value, setting_key } = snapshot;
  if (setting_value === undefined && !setting_key) return false;

  let where = 'id = ?';
  const whereParams = [rev.entity_id];
  if (setting_key) {
    where = 'setting_key = ?';
    whereParams[0] = setting_key;
  }

  const val = typeof setting_value === 'object' ? JSON.stringify(setting_value) : String(setting_value ?? '');
  await connection.query(
    `UPDATE site_settings SET setting_value = ?, has_unpublished_changes = 1, updated_by = ? WHERE ${where}`,
    [val, actorId, ...whereParams]
  );
  return true;
}

async function restoreNavItem(connection, rev, snapshot, actorId) {
  const updates = [];
  const params = [];

  const mappableFields = ['label', 'url', 'link_type', 'target', 'media_public_id', 'sort_order', 'is_visible'];
  for (const field of mappableFields) {
    if (snapshot[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(snapshot[field]);
    }
  }
  if (!updates.length) return false;

  updates.push("status = 'draft'");
  updates.push('updated_by = ?');
  params.push(actorId);
  params.push(rev.entity_id);

  await connection.query(
    `UPDATE navigation_items SET ${updates.join(', ')} WHERE id = ?`,
    params
  );
  return true;
}

async function restoreRepeatableItem(connection, rev, snapshot, actorId) {
  const tables = {
    logo_loop_item: 'logo_loop_items',
    carousel_item: 'home_carousel_items',
    feature_item: 'home_feature_items',
    social_item: 'home_social_items',
  };
  const table = tables[rev.entity_type];
  if (!table) return false;

  const updates = [];
  const params = [];

  // Pass through non-internal scalar fields from snapshot
  const skip = new Set(['id', 'public_id', 'page_section_id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by', 'revision_number', 'status']);
  for (const [key, val] of Object.entries(snapshot)) {
    if (skip.has(key)) continue;
    if (val !== undefined) {
      updates.push(`${key} = ?`);
      params.push(val);
    }
  }
  if (!updates.length) return false;

  updates.push("status = 'draft'");
  updates.push('updated_by = ?');
  params.push(actorId);
  params.push(rev.entity_id);

  await connection.query(
    `UPDATE \`${table}\` SET ${updates.join(', ')} WHERE id = ?`,
    params
  );
  return true;
}

module.exports = {
  showPublishingDashboard,
  publishSelected,
  publishFullHome,
  showHistory,
  showRevisionDetail,
  showCompare,
  showRestore,
  restoreRevision,
};
