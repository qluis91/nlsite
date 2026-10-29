/**
 * Multer configuration for the CMS media library — Phase 11A.
 *
 * Bounded memory storage: buffers are validated and processed before anything
 * reaches disk, and streaming stops once per-file or batch byte caps are hit.
 * The filter is a coarse first gate only; mediaStorageService performs the
 * authoritative content-based validation.
 */
const multer = require('multer');
const {
  RASTER_MIME_TYPES,
  MODEL_MIME_TYPES,
  SVG_MIME_TYPE,
  SVG_UPLOAD_ENABLED,
  MAX_UPLOAD_SIZE,
  MAX_MODEL_SIZE,
  MAX_FILES_PER_REQUEST,
} = require('../config/cmsOptions');
const {
  PUBLIC_IMAGE_SOURCE_MAX_BYTES,
  PUBLIC_IMAGE_SOURCE_MAX_MB,
  CMS_MEDIA_BATCH_MAX_BYTES,
  CMS_MEDIA_BATCH_MAX_MB,
  FORM_FIELD_MAX_BYTES,
} = require('../config/imageUploadPolicy');
const { boundedMemoryStorage, ERROR_CODES } = require('./boundedMemoryStorage');

const acceptedMimeTypes = new Set([...RASTER_MIME_TYPES, ...MODEL_MIME_TYPES]);

function fileFilter(_req, file, callback) {
  if (file.mimetype === SVG_MIME_TYPE && !SVG_UPLOAD_ENABLED) {
    return callback(new Error('La carga de SVG está deshabilitada por seguridad en esta fase.'));
  }
  if (acceptedMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
    return callback(null, true);
  }
  return callback(new Error('Formato no permitido. Use JPG, PNG, WebP o un modelo GLB.'));
}

function resolveCmsMaxFileBytes(_req, file) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (MODEL_MIME_TYPES.has(mime)) return MAX_MODEL_SIZE;
  if (RASTER_MIME_TYPES.has(mime)) return PUBLIC_IMAGE_SOURCE_MAX_BYTES;
  return PUBLIC_IMAGE_SOURCE_MAX_BYTES;
}

const cmsBatchStorage = boundedMemoryStorage({
  resolveMaxFileBytes: resolveCmsMaxFileBytes,
  maxRequestBytes: CMS_MEDIA_BATCH_MAX_BYTES,
});

const cmsSingleStorage = boundedMemoryStorage({
  resolveMaxFileBytes: resolveCmsMaxFileBytes,
  maxRequestBytes: MAX_UPLOAD_SIZE,
});

const baseLimits = {
  fileSize: MAX_UPLOAD_SIZE,
  fields: 20,
  fieldSize: FORM_FIELD_MAX_BYTES,
};

const mediaBatchUpload = multer({
  storage: cmsBatchStorage,
  fileFilter,
  limits: { ...baseLimits, files: MAX_FILES_PER_REQUEST },
}).array('files', MAX_FILES_PER_REQUEST);

const mediaReplaceUpload = multer({
  storage: cmsSingleStorage,
  fileFilter,
  limits: { ...baseLimits, files: 1 },
}).single('file');

const mediaSelectorUpload = multer({
  storage: cmsSingleStorage,
  fileFilter,
  limits: { ...baseLimits, files: 1 },
}).single('file');

function friendlyUploadError(error) {
  if (error?.code === ERROR_CODES.UPLOAD_BATCH_TOO_LARGE) {
    return `La carga supera el límite total permitido de ${CMS_MEDIA_BATCH_MAX_MB} MB.`;
  }
  if (error?.code === ERROR_CODES.PUBLIC_FILE_TOO_LARGE || error?.code === 'LIMIT_FILE_SIZE') {
    const mime = String(error.mimetype || '').toLowerCase();
    if (MODEL_MIME_TYPES.has(mime)) {
      return 'El modelo supera el límite permitido de 30 MB.';
    }
    return `La imagen supera el límite permitido de ${PUBLIC_IMAGE_SOURCE_MAX_MB} MB.`;
  }
  if (error?.code === 'LIMIT_FILE_COUNT') {
    return `No se pueden cargar más de ${MAX_FILES_PER_REQUEST} archivos a la vez.`;
  }
  if (error?.code === 'LIMIT_UNEXPECTED_FILE') return 'Se recibió un campo de archivo inesperado.';
  return error?.message || 'No fue posible procesar la carga.';
}

/** Wraps a multer handler so failures redirect with a Spanish message. */
function handleUpload(uploadHandler, redirectTo) {
  return function uploadMiddleware(req, res, next) {
    uploadHandler(req, res, (error) => {
      if (!error) return next();
      req.session.error_msg = friendlyUploadError(error);
      return res.redirect(typeof redirectTo === 'function' ? redirectTo(req) : redirectTo);
    });
  };
}

module.exports = {
  mediaBatchUpload,
  mediaReplaceUpload,
  mediaSelectorUpload,
  friendlyUploadError,
  handleUpload,
  resolveCmsMaxFileBytes,
};
