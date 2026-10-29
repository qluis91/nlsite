const multer = require('multer');
const {
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  MAX_VIDEO_SIZE,
} = require('../config/galleryOptions');
const {
  PUBLIC_IMAGE_SOURCE_MAX_BYTES,
  PUBLIC_IMAGE_SOURCE_MAX_MB,
  GALLERY_REQUEST_MAX_BYTES,
  GALLERY_REQUEST_MAX_MB,
} = require('../config/imageUploadPolicy');
const { boundedMemoryStorage, ERROR_CODES } = require('./boundedMemoryStorage');

const allowed = new Set([...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES]);

function resolveGalleryMaxFileBytes(_req, file) {
  if (file.fieldname === 'poster') return PUBLIC_IMAGE_SOURCE_MAX_BYTES;
  const mime = String(file.mimetype || '').toLowerCase();
  if (VIDEO_MIME_TYPES.has(mime)) return MAX_VIDEO_SIZE;
  if (IMAGE_MIME_TYPES.has(mime)) return PUBLIC_IMAGE_SOURCE_MAX_BYTES;
  return PUBLIC_IMAGE_SOURCE_MAX_BYTES;
}

function mapGalleryUploadError(error) {
  if (!error) return 'No fue posible procesar la carga.';
  if (error.code === ERROR_CODES.UPLOAD_BATCH_TOO_LARGE || error.code === 'UPLOAD_BATCH_TOO_LARGE') {
    return `La carga supera el límite total permitido de ${GALLERY_REQUEST_MAX_MB} MB.`;
  }
  if (error.code === ERROR_CODES.PUBLIC_FILE_TOO_LARGE || error.code === 'LIMIT_FILE_SIZE') {
    const mime = String(error.mimetype || '').toLowerCase();
    if (VIDEO_MIME_TYPES.has(mime)) {
      return 'El video supera el límite permitido de 100 MB.';
    }
    return `La imagen supera el límite permitido de ${PUBLIC_IMAGE_SOURCE_MAX_MB} MB.`;
  }
  return error.message || 'No fue posible procesar la carga.';
}

const upload = multer({
  storage: boundedMemoryStorage({
    resolveMaxFileBytes: resolveGalleryMaxFileBytes,
    maxRequestBytes: GALLERY_REQUEST_MAX_BYTES,
  }),
  fileFilter(_req, file, callback) {
    if (allowed.has(file.mimetype)) return callback(null, true);
    return callback(new Error('Formato no permitido. Use JPG, PNG, WebP, MP4 o WebM.'));
  },
  limits: {
    // Absolute busboy ceiling: largest allowed Gallery part is a 100 MB video.
    fileSize: MAX_VIDEO_SIZE,
    files: 2,
    fields: 20,
    fieldSize: 64 * 1024,
  },
}).fields([
  { name: 'media', maxCount: 1 },
  { name: 'poster', maxCount: 1 },
]);

function galleryUpload(req, res, next) {
  upload(req, res, (error) => {
    if (!error) return next();
    req.session.error_msg = mapGalleryUploadError(error);
    const editMatch = req.originalUrl.match(/^\/admin\/galeria\/([1-9]\d*)$/);
    return res.redirect(editMatch ? `/admin/galeria/${editMatch[1]}/editar` : '/admin/galeria/nuevo');
  });
}

module.exports = {
  galleryUpload,
  resolveGalleryMaxFileBytes,
  mapGalleryUploadError,
};
