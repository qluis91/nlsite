/**
 * Multer configuration for the CMS media library — Phase 11A.
 *
 * Memory storage: buffers are validated and processed before anything reaches
 * disk, so a rejected upload never leaves an orphan file. The filter is a
 * coarse first gate only; mediaStorageService performs the authoritative
 * content-based validation.
 */
const multer = require('multer');
const {
  RASTER_MIME_TYPES,
  MODEL_MIME_TYPES,
  SVG_MIME_TYPE,
  SVG_UPLOAD_ENABLED,
  MAX_UPLOAD_SIZE,
  MAX_FILES_PER_REQUEST,
} = require('../config/cmsOptions');

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

const baseLimits = {
  fileSize: MAX_UPLOAD_SIZE,
  fields: 20,
  fieldSize: 64 * 1024,
};

const mediaBatchUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { ...baseLimits, files: MAX_FILES_PER_REQUEST },
}).array('files', MAX_FILES_PER_REQUEST);

const mediaReplaceUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { ...baseLimits, files: 1 },
}).single('file');

function friendlyUploadError(error) {
  if (error?.code === 'LIMIT_FILE_SIZE') return 'El archivo supera el límite permitido.';
  if (error?.code === 'LIMIT_FILE_COUNT') return `No se pueden cargar más de ${MAX_FILES_PER_REQUEST} archivos a la vez.`;
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
  friendlyUploadError,
  handleUpload,
};
