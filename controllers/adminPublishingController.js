/**
 * Publishing & History controller — Phase 11D.
 *
 * Handles:
 *   - GET /admin/page/publishing   — dashboard
 *   - POST /admin/page/publishing/publish-selected
 *   - POST /admin/page/publishing/publish-home
 *   - GET /admin/page/history
 *   - GET /admin/page/history/:moduleKey
 *   - GET /admin/page/history/revision/:id
 *   - GET /admin/page/history/compare
 *   - GET/POST /admin/page/history/revision/:id/restore
 */
const publicationService = require('../services/publicationService');
const revisionService = require('../services/contentRevisionService');
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

    await publicationService.publishModules(keys, 'selected', { actorId: req.user?.id });
    return res.redirect('/admin/page/publishing?saved=Módulos+publicados+correctamente');
  } catch (e) {
    return res.redirect(`/admin/page/publishing?error=${encodeURIComponent(e.message)}`);
  }
}

// ── Publish Full Home ──

async function publishFullHome(req, res, next) {
  try {
    const allKeys = registry.MODULE_KEY_VALUES;
    await publicationService.publishModules(allKeys, 'homepage', { actorId: req.user?.id });
    return res.redirect('/admin/page/publishing?saved=Página+completa+publicada+correctamente');
  } catch (e) {
    return res.redirect(`/admin/page/publishing?error=${encodeURIComponent(e.message)}`);
  }
}

// ── History Browser ──

async function showHistory(req, res, next) {
  try {
    const { moduleKey, action, page, limit } = req.query;
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(50, Math.max(1, parseInt(limit) || 20));
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

    const [rows] = await pool.query(
      `SELECT cr.id, cr.entity_type, cr.entity_id, cr.revision_number, cr.action,
              cr.change_summary, cr.created_at,
              COALESCE(cr.previous_data IS NOT NULL, 0) has_previous,
              COALESCE(cr.new_data IS NOT NULL, 0) has_new,
              u.name AS actor_name
       FROM content_revisions cr
       LEFT JOIN users u ON u.id = cr.changed_by
       ${where}
       ORDER BY cr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, l, offset]
    );

    // Get available module keys for filter
    const revisionActions = require('../config/cmsOptions').REVISION_ACTIONS;

    res.render('pages/admin/page/history/index', {
      title: 'Historial de revisiones',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      revisions: rows,
      total,
      page: p,
      totalPages: Math.ceil(total / l),
      moduleKey: moduleKey || '',
      action: action || '',
      moduleKeys: registry.MODULE_KEY_VALUES,
      MODULES: registry.MODULES,
      revisionActions: Object.values(revisionActions),
      csrfToken: req.csrfToken?.() || '',
    });
  } catch (e) { return next(e); }
}

// ── Revision Detail ──

async function showRevisionDetail(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(404).send('Revisión no encontrada.');

    const [[rev]] = await pool.query(
      `SELECT cr.*, u.name AS actor_name
       FROM content_revisions cr
       LEFT JOIN users u ON u.id = cr.changed_by
       WHERE cr.id = ?`,
      [id]
    );
    if (!rev) return res.status(404).send('Revisión no encontrada.');

    const prevData = safeJsonParse(rev.previous_data);
    const newData = safeJsonParse(rev.new_data);

    // Generate field-level changes
    const fieldChanges = [];
    if (prevData && newData && typeof prevData === 'object' && typeof newData === 'object') {
      const allKeys = new Set([...Object.keys(prevData), ...Object.keys(newData)]);
      for (const key of allKeys) {
        const oldVal = prevData[key];
        const newVal = newData[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          fieldChanges.push({
            field: key,
            oldValue: typeof oldVal === 'object' ? safeStringify(oldVal) : String(oldVal ?? '(vacío)'),
            newValue: typeof newVal === 'object' ? safeStringify(newVal) : String(newVal ?? '(vacío)'),
            type: oldVal === undefined ? 'added' : newVal === undefined ? 'removed' : 'changed',
          });
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

    res.render('pages/admin/page/history/detail', {
      title: `Revisión #${rev.revision_number}`,
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      revision: rev,
      prevData,
      newData,
      fieldChanges,
      batch: batches[0] || null,
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
      'SELECT * FROM content_revisions WHERE id = ?', [fromId]
    );
    const [[toRev]] = await pool.query(
      'SELECT * FROM content_revisions WHERE id = ?', [toId]
    );

    if (!fromRev || !toRev) {
      return res.status(404).send('Una o ambas revisiones no existen.');
    }

    if (fromRev.entity_type !== toRev.entity_type) {
      return res.status(400).send('Las revisiones pertenecen a entidades distintas.');
    }

    const fromData = safeJsonParse(fromRev.new_data || fromRev.previous_data);
    const toData = safeJsonParse(toRev.new_data || toRev.previous_data);

    const differences = [];
    if (fromData && toData && typeof fromData === 'object' && typeof toData === 'object') {
      const allKeys = new Set([...Object.keys(fromData), ...Object.keys(toData)]);
      for (const key of allKeys) {
        const oldVal = fromData[key];
        const newVal = toData[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          differences.push({
            field: key,
            fromValue: typeof oldVal === 'object' ? safeStringify(oldVal) : String(oldVal ?? '(vacío)'),
            toValue: typeof newVal === 'object' ? safeStringify(newVal) : String(newVal ?? '(vacío)'),
            type: oldVal === undefined ? 'agregado' : newVal === undefined ? 'eliminado' : 'modificado',
          });
        }
      }
    }

    res.render('pages/admin/page/history/compare', {
      title: 'Comparar revisiones',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      fromRev,
      toRev,
      fromData,
      toData,
      differences,
      csrfToken: req.csrfToken?.() || '',
    });
  } catch (e) { return next(e); }
}

// ── Restore Revision ──

async function showRestore(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(404).send('Revisión no encontrada.');

    const [[rev]] = await pool.query(
      `SELECT cr.*, u.name AS actor_name
       FROM content_revisions cr
       LEFT JOIN users u ON u.id = cr.changed_by
       WHERE cr.id = ?`,
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
  try {
    const id = parseInt(req.params.id);
    const publishAfter = req.body.publish === '1';

    if (!id || isNaN(id)) return res.status(400).send('Revisión inválida.');

    const [[rev]] = await pool.query(
      'SELECT * FROM content_revisions WHERE id = ?', [id]
    );
    if (!rev) return res.status(404).send('Revisión no encontrada.');

    const snapshot = safeJsonParse(rev.new_data || rev.previous_data);
    if (!snapshot) return res.status(400).send('Esta revisión no contiene datos restaurables.');

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Restore based on entity type
      if (rev.entity_type === 'page_section' && snapshot.status) {
        if (publishAfter) {
          // Restore and publish: set status to published
          await connection.query(
            `UPDATE page_sections SET status = 'published', version = version + 1 WHERE id = ?`,
            [rev.entity_id]
          );
        } else {
          // Restore as draft
          await connection.query(
            `UPDATE page_sections SET status = 'draft', version = version + 1 WHERE id = ?`,
            [rev.entity_id]
          );
        }
      } else if (rev.entity_type === 'navigation_item') {
        const targetStatus = publishAfter ? 'published' : 'draft';
        // For collection-level nav restore: restore all items
        if (snapshot.items && Array.isArray(snapshot.items)) {
          for (const item of snapshot.items) {
            await connection.query(
              `UPDATE navigation_items SET status = ? WHERE public_id = ? AND deleted_at IS NULL`,
              [targetStatus, item.public_id]
            );
          }
        }
      } else if (['logo_loop_item', 'carousel_item', 'feature_item'].includes(rev.entity_type)) {
        const tableMap = {
          logo_loop_item: 'logo_loop_items',
          carousel_item: 'home_carousel_items',
          feature_item: 'home_feature_items',
        };
        const table = tableMap[rev.entity_type];
        const targetStatus = publishAfter ? 'published' : 'draft';

        if (snapshot.items && Array.isArray(snapshot.items)) {
          for (const item of snapshot.items) {
            await connection.query(
              `UPDATE \`${table}\` SET status = ? WHERE public_id = ? AND deleted_at IS NULL`,
              [targetStatus, item.public_id]
            );
          }
        }
      }

      // Record restore revision
      await revisionService.recordRevision({
        entityType: rev.entity_type,
        entityId: rev.entity_id,
        action: 'restore',
        previousData: JSON.stringify({ source_revision_id: id, source_action: rev.action }),
        newData: publishAfter ? JSON.stringify({ status: 'published', source_revision_id: id })
                               : JSON.stringify({ status: 'draft', source_revision_id: id }),
        changeSummary: publishAfter
          ? `Restauración y publicación desde revisión #${rev.revision_number}`
          : `Restauración como borrador desde revisión #${rev.revision_number}`,
        changedBy: req.user?.id,
      }, connection);

      // If publishing, create a publication batch record
      if (publishAfter) {
        const batchId = require('crypto').randomUUID();
        await connection.query(
          `INSERT INTO publication_batches (public_id, scope, status, created_by, published_by, published_at, summary)
           VALUES (?, 'restore', 'published', ?, ?, NOW(), ?)`,
          [batchId, req.user?.id, req.user?.id, `Restauración desde revisión #${rev.revision_number}`]
        );
      }

      await connection.commit();

      // Invalidate caches
      const publishing = require('../services/cmsPublishingService');
      publishing.invalidateNamespace('sc_home');
      publishing.invalidateNamespace('siteSettings');
      publishing.invalidateNamespace('nav_home');
      publishing.invalidateNamespace('logoLoop_home');
      publishing.invalidateNamespace('carousel_home');
      publishing.invalidateNamespace('features_home');

      const msg = publishAfter ? 'Revisión restaurada y publicada.' : 'Revisión restaurada como borrador.';
      return res.redirect(`/admin/page/history?saved=${encodeURIComponent(msg)}`);
    } catch (e) {
      await connection.rollback().catch(() => {});
      throw e;
    } finally {
      connection.release();
    }
  } catch (e) {
    return res.redirect(`/admin/page/history?error=${encodeURIComponent(e.message)}`);
  }
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
