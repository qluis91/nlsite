const multer = require('multer');
const { MAX_FILE_SIZE, ALLOWED_MIME_TYPES } = require('../services/imageProcessingService');
const {
  AVATAR_SOURCE_MAX_BYTES,
  AVATAR_SOURCE_MAX_MB,
  FORM_FIELD_MAX_BYTES,
  PUBLIC_IMAGE_SOURCE_MAX_BYTES,
  PUBLIC_IMAGE_SOURCE_MAX_MB,
  PUBLIC_IMAGE_BATCH_MAX_BYTES,
  PUBLIC_IMAGE_BATCH_MAX_MB,
} = require('../config/imageUploadPolicy');
const { boundedMemoryStorage, ERROR_CODES } = require('./boundedMemoryStorage');

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Formato no permitido: ${file.mimetype}. Use JPEG, PNG, WebP o AVIF.`));
  }
}

function mapProductUploadError(error) {
  if (!error) return 'No fue posible procesar la carga.';
  if (error.code === ERROR_CODES.UPLOAD_BATCH_TOO_LARGE) {
    return `El conjunto de imágenes supera el límite total permitido de ${PUBLIC_IMAGE_BATCH_MAX_MB} MB.`;
  }
  if (error.code === ERROR_CODES.PUBLIC_FILE_TOO_LARGE || error.code === 'LIMIT_FILE_SIZE') {
    return `La imagen supera el límite permitido de ${PUBLIC_IMAGE_SOURCE_MAX_MB} MB.`;
  }
  return error.message || 'No fue posible procesar la carga.';
}

const productStorage = boundedMemoryStorage({
  resolveMaxFileBytes: () => PUBLIC_IMAGE_SOURCE_MAX_BYTES,
  maxRequestBytes: PUBLIC_IMAGE_BATCH_MAX_BYTES,
});

const productImageMulter = multer({
  storage: productStorage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5,
    fields: 20,
    fieldSize: FORM_FIELD_MAX_BYTES,
  },
}).fields([
  { name: 'primaryImage', maxCount: 1 },
  { name: 'secondaryImages', maxCount: 4 },
]);

/**
 * Product image upload middleware (5 images max: primaryImage + secondaryImages).
 * Enforces 25 MB per file and 75 MB aggregate while streaming.
 */
function productImageUpload(req, res, next) {
  productImageMulter(req, res, (error) => {
    if (!error) return next();
    req.session.error_msg = mapProductUploadError(error);
    const editMatch = req.originalUrl.match(/\/catalogo\/productos\/([1-9]\d*)(?:\/|$)/);
    if (editMatch) {
      return res.redirect(`/admin/catalogo/productos/${editMatch[1]}/editar`);
    }
    return res.redirect('/admin/catalogo/productos/nuevo');
  });
}

const publicImageStorage = boundedMemoryStorage({
  resolveMaxFileBytes: () => PUBLIC_IMAGE_SOURCE_MAX_BYTES,
  maxRequestBytes: PUBLIC_IMAGE_SOURCE_MAX_BYTES,
});

/**
 * Single image upload middleware for any module needing one image.
 * Field name: 'image'
 */
const singleImageUpload = multer({
  storage: publicImageStorage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fieldSize: FORM_FIELD_MAX_BYTES,
  },
}).single('image');

const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const avatarStorage = boundedMemoryStorage({
  resolveMaxFileBytes: () => AVATAR_SOURCE_MAX_BYTES,
  maxRequestBytes: AVATAR_SOURCE_MAX_BYTES,
});

const avatarImageUpload = multer({
  storage: avatarStorage,
  fileFilter(req, file, cb) {
    if (AVATAR_MIME_TYPES.has(file.mimetype)) return cb(null, true);
    return cb(new Error('El avatar debe ser una imagen JPG, PNG o WebP.'));
  },
  limits: {
    fileSize: AVATAR_SOURCE_MAX_BYTES,
    files: 1,
    fields: 5,
    fieldSize: FORM_FIELD_MAX_BYTES,
  },
}).single('avatar');

const PROOF_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const proofFileUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    if (PROOF_MIME_TYPES.has(file.mimetype)) return cb(null, true);
    return cb(new Error('Solo se permiten archivos JPG, PNG, WebP o PDF.'));
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 5,
    fieldSize: 4 * 1024,
  },
}).single('proofFile');

const categoryHeroUpload = multer({
  storage: publicImageStorage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 12,
    fieldSize: FORM_FIELD_MAX_BYTES,
  },
}).single('hero_image');

function mapAvatarUploadError(error) {
  if (!error) return 'El archivo seleccionado no es una imagen válida.';
  if (error.code === ERROR_CODES.PUBLIC_FILE_TOO_LARGE || error.code === 'LIMIT_FILE_SIZE') {
    return `La imagen no puede superar ${AVATAR_SOURCE_MAX_MB} MB.`;
  }
  return error.message || 'El archivo seleccionado no es una imagen válida.';
}

module.exports = {
  productImageUpload,
  productImageMulter,
  singleImageUpload,
  avatarImageUpload,
  proofFileUpload,
  categoryHeroUpload,
  mapProductUploadError,
  mapAvatarUploadError,
  AVATAR_SOURCE_MAX_MB,
};
