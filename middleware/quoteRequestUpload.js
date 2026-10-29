'use strict';

const multer = require('multer');

const MAX_FILES = 5;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_MB = Math.round(MAX_BYTES / (1024 * 1024));

const STICKY_KEYS = Object.freeze({
  '3d': [
    'customer_name', 'customer_email', 'customer_phone', 'description',
    'width', 'depth', 'height', 'quantity', 'material', 'file_link',
    'reference_id', 'reference_product',
  ],
  other: [
    'customer_name', 'customer_email', 'customer_phone', 'project_type',
    'budget', 'desired_date', 'description',
  ],
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_FILES,
    fileSize: MAX_BYTES,
    fields: 40,
  },
  fileFilter(req, file, cb) {
    const mime = String(file.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      return cb(Object.assign(new Error('Solo se permiten imágenes de referencia.'), { code: 'BAD_MIME' }));
    }
    if (mime.includes('svg')) {
      return cb(Object.assign(new Error('SVG no está permitido.'), { code: 'BAD_MIME' }));
    }
    return cb(null, true);
  },
});

function quoteImagesMiddleware(fieldName = 'images') {
  return (req, res, next) => {
    upload.array(fieldName, MAX_FILES)(req, res, (err) => {
      if (!err) {
        if (Array.isArray(req.files) && req.files.length > MAX_FILES) {
          return next(Object.assign(new Error(`Podés subir hasta ${MAX_FILES} imágenes de referencia.`), {
            code: 'TOO_MANY_FILES',
            status: 422,
          }));
        }
        return next();
      }
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          err.message = `Podés subir hasta ${MAX_FILES} imágenes de referencia.`;
          err.code = 'TOO_MANY_FILES';
          err.status = 422;
        } else if (err.code === 'LIMIT_FILE_SIZE') {
          err.message = `Cada imagen puede pesar máximo ${MAX_MB} MB.`;
          err.status = 413;
        } else {
          err.status = 400;
        }
      }
      return next(err);
    });
  };
}

function wantsJson(req) {
  const accept = String(req.get('accept') || '');
  if (accept.includes('application/json')) return true;
  return req.xhr === true || req.query?.format === 'json';
}

function quoteTypeFromPath(req) {
  const path = String(req.path || req.originalUrl || '');
  if (path.includes('/pieza-3d')) return '3d';
  if (path.includes('/otros')) return 'other';
  return 'other';
}

function pickStickyValues(type, body = {}) {
  const keys = STICKY_KEYS[type] || [];
  const out = {};
  for (const key of keys) {
    if (body[key] == null) continue;
    out[key] = String(body[key]).slice(0, 5000);
  }
  return out;
}

function mapUploadError(err) {
  if (!err) return null;
  const code = String(err.code || '');
  if (code === 'LIMIT_FILE_SIZE' || code === 'FILE_TOO_LARGE') {
    return {
      status: 413,
      code: 'FILE_TOO_LARGE',
      error: err.message || `Cada imagen puede pesar máximo ${MAX_MB} MB.`,
      field: 'images',
    };
  }
  if (
    code === 'TOO_MANY_FILES'
    || code === 'LIMIT_FILE_COUNT'
    || code === 'LIMIT_UNEXPECTED_FILE'
  ) {
    return {
      status: 422,
      code: 'TOO_MANY_FILES',
      error: err.message || `Podés subir hasta ${MAX_FILES} imágenes de referencia.`,
      field: 'images',
    };
  }
  if (code === 'BAD_MIME') {
    return {
      status: 415,
      code: 'BAD_MIME',
      error: err.message || 'Solo se permiten imágenes de referencia.',
      field: 'images',
    };
  }
  return null;
}

/**
 * Express error middleware — must sit immediately after quoteImagesMiddleware.
 */
function quoteUploadErrorHandler(err, req, res, next) {
  const mapped = mapUploadError(err);
  if (!mapped) return next(err);

  if (wantsJson(req)) {
    return res.status(mapped.status).json({
      ok: false,
      error: mapped.error,
      field: mapped.field,
      code: mapped.code,
    });
  }

  const type = quoteTypeFromPath(req);
  const redirectBase = type === '3d' ? '/cotizar/pieza-3d' : '/cotizar/otros';
  if (req.session) {
    req.session.cms_alerts = [{
      type: 'warning',
      title: 'No pudimos usar esa imagen',
      description: mapped.error,
      id: 'qupload',
    }];
    req.session.quote_form_draft = {
      type,
      values: pickStickyValues(type, req.body || {}),
      fieldErrors: ['images'],
    };
  }

  let location = redirectBase;
  if (type === '3d' && req.body) {
    const qs = new URLSearchParams();
    const ref = String(req.body.reference_id || '').trim();
    const nombre = String(req.body.reference_product || '').trim();
    if (ref) qs.set('ref', ref.slice(0, 80));
    if (nombre) qs.set('nombre', nombre.slice(0, 200));
    const q = qs.toString();
    if (q) location += `?${q}`;
  }
  return res.redirect(location);
}

module.exports = {
  MAX_FILES,
  MAX_BYTES,
  MAX_MB,
  quoteImagesMiddleware,
  quoteUploadErrorHandler,
  mapUploadError,
};
