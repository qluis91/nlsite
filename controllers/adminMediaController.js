/**
 * Media library controller — Phase 11A.
 *
 * Renders HTML views consistent with the rest of the admin panel and keeps all
 * business logic in services. Errors surface as Spanish flash messages; stack
 * traces and filesystem paths are never exposed.
 */
const mediaService = require('../services/mediaService');
const usageService = require('../services/mediaUsageService');
const revisionService = require('../services/contentRevisionService');
const pool = require('../config/db');
const validator = require('../validators/mediaValidator');
const {
  MEDIA_CATEGORY_VALUES,
  MEDIA_CATEGORY_LABELS,
  MEDIA_STATUS_VALUES,
  MEDIA_STATUS_LABELS,
  EDITABLE_MEDIA_STATUSES,
  MEDIA_KINDS,
  MAX_FILES_PER_REQUEST,
  MAX_IMAGE_SIZE,
  MAX_MODEL_SIZE,
  MAX_IMAGE_DIMENSION,
  SVG_UPLOAD_ENABLED,
  AVIF_SUPPORTED,
  TITLE_MAX_LENGTH,
  ALT_TEXT_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  REVISION_ENTITY_TYPES,
} = require('../config/cmsOptions');

const LIBRARY_PATH = '/admin/page/media';
const PAGE_STYLES = ['/css/admin-page.css'];
const PAGE_MODULE = '/js/admin/media-library.js';

const VIEW_CONSTANTS = Object.freeze({
  categories: MEDIA_CATEGORY_VALUES,
  categoryLabels: MEDIA_CATEGORY_LABELS,
  statuses: MEDIA_STATUS_VALUES,
  statusLabels: MEDIA_STATUS_LABELS,
  editableStatuses: EDITABLE_MEDIA_STATUSES,
  kinds: MEDIA_KINDS,
  maxFiles: MAX_FILES_PER_REQUEST,
  maxImageMb: Math.round(MAX_IMAGE_SIZE / (1024 * 1024)),
  maxModelMb: Math.round(MAX_MODEL_SIZE / (1024 * 1024)),
  maxDimension: MAX_IMAGE_DIMENSION,
  svgEnabled: SVG_UPLOAD_ENABLED,
  avifSupported: AVIF_SUPPORTED,
  titleMax: TITLE_MAX_LENGTH,
  altTextMax: ALT_TEXT_MAX_LENGTH,
  descriptionMax: DESCRIPTION_MAX_LENGTH,
});

function buildLibraryUrl(filters, overrides = {}) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.search) params.set('search', next.search);
  if (next.category) params.set('category', next.category);
  if (next.kind) params.set('kind', next.kind);
  if (next.status) params.set('status', next.status);
  if (next.page && next.page !== 1) params.set('page', String(next.page));
  const query = params.toString();
  return query ? `${LIBRARY_PATH}?${query}` : LIBRARY_PATH;
}

function redirectWithError(req, res, destination, message) {
  req.session.error_msg = message || 'No fue posible completar la operación.';
  return res.redirect(destination);
}

/** Database/driver failures go to the 500 handler; domain errors flash. */
function isInfrastructureError(error) {
  return Boolean(error?.code) && String(error.code).startsWith('ER_');
}

function actorId(req) {
  return req.session?.user?.id || null;
}

async function library(req, res, next) {
  try {
    const filters = validator.parseLibraryFilters(req.query);
    const result = await mediaService.listAssets(filters);
    res.render('pages/admin/page/media/index', {
      title: 'Biblioteca multimedia',
      layout: 'layouts/admin',
      pageStyles: PAGE_STYLES,
      pageModule: PAGE_MODULE,
      ...result,
      filters,
      constants: VIEW_CONSTANTS,
      formatFileSize: mediaService.formatFileSize,
      buildLibraryUrl: (overrides) => buildLibraryUrl(filters, overrides),
    });
  } catch (error) {
    next(error);
  }
}

function showUpload(req, res) {
  res.render('pages/admin/page/media/upload', {
    title: 'Cargar multimedia',
    layout: 'layouts/admin',
    pageStyles: PAGE_STYLES,
    pageModule: PAGE_MODULE,
    constants: VIEW_CONSTANTS,
  });
}

async function upload(req, res, next) {
  const destination = `${LIBRARY_PATH}/upload`;
  try {
    const validation = validator.validateUploadMetadata(req.body);
    if (!validation.valid) return redirectWithError(req, res, destination, validation.error);

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return redirectWithError(req, res, destination, 'Debe seleccionar al menos un archivo.');

    const { created, errors } = await mediaService.createManyFromUploads({
      files,
      category: validation.value.category,
      metadata: validation.value,
      actorId: actorId(req),
    });

    if (created.length && errors.length) {
      req.session.success_msg = `${created.length} archivo(s) cargado(s).`;
      req.session.error_msg = errors.map((item) => `${item.file}: ${item.message}`).join(' · ');
      return res.redirect(LIBRARY_PATH);
    }
    if (!created.length) {
      return redirectWithError(
        req,
        res,
        destination,
        errors.map((item) => `${item.file}: ${item.message}`).join(' · ')
      );
    }
    req.session.success_msg = `${created.length} archivo(s) cargado(s) correctamente.`;
    return res.redirect(LIBRARY_PATH);
  } catch (error) {
    if (isInfrastructureError(error)) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

async function detail(req, res, next) {
  try {
    const asset = await mediaService.getByPublicId(req.params.publicId);
    if (!asset) return redirectWithError(req, res, LIBRARY_PATH, 'El archivo no existe en la biblioteca.');
    const [usages, history] = await Promise.all([
      usageService.findUsages(asset.public_id),
      revisionService.listRevisions(REVISION_ENTITY_TYPES.MEDIA_ASSET, asset.id, 10),
    ]);
    res.render('pages/admin/page/media/detail', {
      title: asset.title || asset.filename,
      layout: 'layouts/admin',
      pageStyles: PAGE_STYLES,
      pageModule: PAGE_MODULE,
      asset,
      usages,
      history,
      constants: VIEW_CONSTANTS,
      formatFileSize: mediaService.formatFileSize,
    });
  } catch (error) {
    if (error?.code === 'INVALID_ID') {
      return redirectWithError(req, res, LIBRARY_PATH, 'Identificador de medio no válido.');
    }
    next(error);
  }
}

async function showEdit(req, res, next) {
  try {
    const asset = await mediaService.getByPublicId(req.params.publicId);
    if (!asset) return redirectWithError(req, res, LIBRARY_PATH, 'El archivo no existe en la biblioteca.');
    res.render('pages/admin/page/media/edit', {
      title: 'Editar multimedia',
      layout: 'layouts/admin',
      pageStyles: PAGE_STYLES,
      pageModule: PAGE_MODULE,
      asset,
      constants: VIEW_CONSTANTS,
      formatFileSize: mediaService.formatFileSize,
    });
  } catch (error) {
    if (error?.code === 'INVALID_ID') {
      return redirectWithError(req, res, LIBRARY_PATH, 'Identificador de medio no válido.');
    }
    next(error);
  }
}

async function update(req, res, next) {
  const destination = `${LIBRARY_PATH}/${req.params.publicId}/edit`;
  try {
    const validation = validator.validateMetadataUpdate(req.body);
    if (!validation.valid) return redirectWithError(req, res, destination, validation.error);
    await mediaService.updateMetadata(req.params.publicId, validation.value, actorId(req));
    req.session.success_msg = 'Metadatos actualizados correctamente.';
    return res.redirect(`${LIBRARY_PATH}/${req.params.publicId}`);
  } catch (error) {
    if (isInfrastructureError(error)) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

async function replace(req, res, next) {
  const destination = `${LIBRARY_PATH}/${req.params.publicId}/edit`;
  try {
    if (!req.file) return redirectWithError(req, res, destination, 'Debe seleccionar un archivo de reemplazo.');
    await mediaService.replaceFile(req.params.publicId, req.file, actorId(req));
    req.session.success_msg = 'Archivo reemplazado. La referencia del medio no cambió.';
    return res.redirect(`${LIBRARY_PATH}/${req.params.publicId}`);
  } catch (error) {
    if (isInfrastructureError(error)) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

async function archive(req, res, next) {
  const destination = `${LIBRARY_PATH}/${req.params.publicId}`;
  try {
    await mediaService.archive(req.params.publicId, actorId(req));
    req.session.success_msg = 'Archivo archivado. Puedes restaurarlo cuando lo necesites.';
    return res.redirect(destination);
  } catch (error) {
    if (isInfrastructureError(error)) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

async function restore(req, res, next) {
  const destination = `${LIBRARY_PATH}/${req.params.publicId}`;
  try {
    await mediaService.restore(req.params.publicId, actorId(req));
    req.session.success_msg = 'Archivo restaurado correctamente.';
    return res.redirect(destination);
  } catch (error) {
    if (isInfrastructureError(error)) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

// ── Phase 11C: JSON API for visual media selector ──

async function mediaBrowse(req, res, next) {
  try {
    const { search, category, mime_filter, status, allowed_types, allowed_categories, page, limit } = req.query;
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(50, Math.max(1, parseInt(limit) || 12));
    const offset = (p - 1) * l;

    let sql = 'SELECT * FROM media_assets WHERE 1=1';
    const params = [];

    if (status !== 'all') {
      sql += ' AND status = ?';
      params.push(status || 'active');
    }

    if (search) {
      sql += ' AND (title LIKE ? OR original_filename LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (category === 'null' || category === '') {
      // skip — category filter not applied
    } else if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (mime_filter) {
      sql += ' AND mime_type LIKE ?';
      params.push(`${mime_filter}/%`);
    }

    if (allowed_types) {
      const types = allowed_types.split(',').filter(Boolean);
      if (types.length) {
        const mimeConditions = types.map(() => 'mime_type LIKE ?').join(' OR ');
        sql += ` AND (${mimeConditions})`;
        types.forEach(t => params.push(`${t}%`));
      }
    }

    if (allowed_categories) {
      const cats = allowed_categories.split(',').filter(Boolean);
      if (cats.length) {
        const catConditions = cats.map(() => 'category = ?').join(' OR ');
        sql += ` AND (${catConditions})`;
        cats.forEach(c => params.push(c));
      }
    }

    // Count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) total');
    const [[{ total }]] = await pool.query(countSql, params);

    // Paginate
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(l, offset);
    const [assets] = await pool.query(sql, params);

    // Get categories for filters
    const [catRows] = await pool.query(
      "SELECT DISTINCT category FROM media_assets WHERE category IS NOT NULL AND status = 'active' ORDER BY category"
    );

    res.json({
      assets,
      total,
      page: p,
      totalPages: Math.ceil(total / l),
      categories: catRows.map(r => r.category),
    });
  } catch (error) { next(error); }
}

/** Direct upload from media selector — Phase 11C-S. AJAX JSON endpoint. */
async function selectorUpload(req, res, next) {
  try {
    const profileKey = String(req.body.profile || req.query.profile || '').trim();
    if (!profileKey) {
      return res.status(400).json({ success: false, error: 'Perfil de carga no especificado.' });
    }

    const { UPLOAD_PROFILES, UPLOAD_PROFILE_KEYS } = require('../config/cmsOptions');
    if (!UPLOAD_PROFILE_KEYS.includes(profileKey)) {
      return res.status(400).json({ success: false, error: 'Perfil de carga no reconocido.' });
    }
    const profile = UPLOAD_PROFILES[profileKey];

    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'Debe seleccionar un archivo.' });
    }

    // Validate MIME against profile
    const declaredMime = String(file.mimetype || '').toLowerCase();
    if (!profile.allowedMimeTypes.includes(declaredMime)) {
      return res.status(400).json({ success: false, error: `Formato no permitido para ${profile.label}. ` });
    }

    // Validate size
    if (file.size > profile.maxSize) {
      return res.status(400).json({ success: false, error: `El archivo supera el límite de ${Math.round(profile.maxSize / 1024 / 1024)} MB.` });
    }

    const asset = await mediaService.createFromSelectorUpload({
      file,
      category: profile.category,
      metadata: { title: file.originalname?.replace(/\.[^.]+$/, '') || 'Sin título' },
      actorId: req.user?.id || null,
    });

    res.json({
      success: true,
      asset: {
        public_id: asset.public_id,
        title: asset.title,
        original_filename: asset.original_name,
        public_url: asset.public_url,
        thumbnail_url: asset.thumbnail_path,
        mime_type: asset.mime_type,
        width: asset.width,
        height: asset.height,
        file_size: asset.file_size,
        category: asset.category,
        reference: `media://${asset.public_id}`,
      },
    });
  } catch (error) {
    console.error('[selectorUpload] Error:', error.message);
    res.status(500).json({ success: false, error: error.message || 'Error al procesar la imagen.' });
  }
}

module.exports = {
  LIBRARY_PATH,
  VIEW_CONSTANTS,
  buildLibraryUrl,
  library,
  showUpload,
  upload,
  detail,
  showEdit,
  update,
  replace,
  archive,
  restore,
  mediaBrowse,
  selectorUpload,
};
