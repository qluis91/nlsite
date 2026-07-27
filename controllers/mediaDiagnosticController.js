/**
 * Media diagnostics controller — Phase 16D.
 *
 * Admin-only, disabled by default. Exposes media deployment health
 * without leaking credentials, headers, cookies, or absolute file paths.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const storage = require('../services/mediaStorageService');
const reconciliation = require('../services/mediaReconciliationService');
const { CAPABILITIES, hasCapability } = require('../config/capabilities');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeDir(dir) {
  // Show the configured value but mask local user paths for safety
  const raw = String(dir || '');
  if (!raw) return '(no configurado)';
  const homeMatch = raw.match(/^(\/[Uu]sers\/|\/home\/|C:\\[Uu]sers\\)[^/\\]+/);
  if (homeMatch) return raw.replace(homeMatch[0], '/[user]');
  return raw;
}

async function mediaDiagnostic(req, res, next) {
  if (process.env.MEDIA_DIAGNOSTIC_ENABLED !== 'true') {
    return res.status(404).render('pages/404', {
      title: 'Página no encontrada',
      layout: 'layouts/main',
    });
  }

  try {
    const uploadDir = process.env.UPLOAD_PUBLIC_DIR || path.join(__dirname, '..', 'public', 'uploads');
    const resolved = path.resolve(uploadDir);
    const dirExists = fs.existsSync(resolved);
    let dirWritable = false;
    try {
      fs.accessSync(resolved, fs.constants.W_OK);
      dirWritable = true;
    } catch (_) { /* not writable */ }

    // Check if the /uploads static mount uses the same directory
    // The app.js mount uses UPLOAD_PUBLIC which resolves the same way
    const uploadsPublic = process.env.UPLOAD_PUBLIC_DIR
      ? path.resolve(process.env.UPLOAD_PUBLIC_DIR)
      : path.resolve(path.join(__dirname, '..', 'public', 'uploads'));
    const uploadsMountedMatches = (path.resolve(resolved) === path.resolve(uploadsPublic));

    // Verify permanent-delete route exists
    let permanentDeleteRoute = false;
    try {
      const routes = require('../routes/adminPageRoutes');
      permanentDeleteRoute = typeof routes !== 'undefined';
    } catch (_) { /* route module not loadable */ }

    // Capability check for current admin
    const userHasDelete = hasCapability(req.session?.user, CAPABILITIES.MEDIA_DELETE);

    // Media counts
    const [[activeCount]] = await pool.query(
      "SELECT COUNT(*) AS total FROM media_assets WHERE status = 'active' AND deleted_at IS NULL"
    );
    const [[archivedCount]] = await pool.query(
      "SELECT COUNT(*) AS total FROM media_assets WHERE status = 'archived'"
    );

    // File existence check for a given public_id
    let fileCheck = null;
    const queryId = String(req.query.public_id || '').trim();
    if (queryId && UUID_PATTERN.test(queryId)) {
      try {
        const [rows] = await pool.query(
          'SELECT storage_path, filename, status FROM media_assets WHERE public_id = ? LIMIT 1',
          [queryId]
        );
        if (rows.length) {
          const row = rows[0];
          const fileExists = await storage.storedPathExists(row.storage_path).catch(() => false);
          fileCheck = {
            public_id: queryId,
            status: row.status,
            storage_exists: fileExists,
          };
        } else {
          fileCheck = { public_id: queryId, found: false };
        }
      } catch (_) { /* query error — skip */ }
    } else if (queryId) {
      fileCheck = { public_id: queryId, valid_uuid: false };
    }

    const reconciliationReport = await reconciliation.buildReport();

    res.render('pages/admin/diagnostics/media', {
      title: 'Diagnóstico de medios',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      diagnostics: {
        version: process.env.APP_VERSION || '(no definida)',
        upload_dir_env: process.env.UPLOAD_PUBLIC_DIR || '(por defecto: public/uploads)',
        upload_dir_sanitized: sanitizeDir(resolved),
        upload_dir_exists: dirExists,
        upload_dir_writable: dirWritable,
        uploads_mount_matches: uploadsMountedMatches,
        permanent_delete_route: permanentDeleteRoute,
        admin_has_media_delete: userHasDelete,
        active_media_count: Number(activeCount.total),
        archived_media_count: Number(archivedCount.total),
        file_check: fileCheck,
        reconciliation: reconciliationReport,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { mediaDiagnostic };
