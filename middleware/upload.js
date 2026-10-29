const multer = require('multer');
const { MAX_FILE_SIZE, ALLOWED_MIME_TYPES } = require('../services/imageProcessingService');
const {
  AVATAR_SOURCE_MAX_BYTES,
  FORM_FIELD_MAX_BYTES,
} = require('../config/imageUploadPolicy');

// Memory storage — buffers are processed by Sharp before writing to disk
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Formato no permitido: ${file.mimetype}. Use JPEG, PNG, WebP o AVIF.`));
  }
}

/**
 * Product image upload middleware (5 images max: primaryImage + secondaryImages).
 * Fields: primaryImage (single), secondaryImages (up to 4)
 */
const productImageUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5,
    // The existing product form has 14 non-file fields (including CSRF).
    // Keep this bounded while allowing the real create/update payload.
    fields: 20,
    fieldSize: FORM_FIELD_MAX_BYTES,
  },
}).fields([
  { name: 'primaryImage', maxCount: 1 },
  { name: 'secondaryImages', maxCount: 4 },
]);

/**
 * Single image upload middleware for any module needing one image.
 * Field name: 'image'
 */
const singleImageUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fieldSize: FORM_FIELD_MAX_BYTES,
  },
}).single('image');

const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const avatarImageUpload = multer({
  storage,
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
  storage,
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
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 12,
    fieldSize: FORM_FIELD_MAX_BYTES,
  },
}).single('hero_image');

module.exports = {
  productImageUpload,
  singleImageUpload,
  avatarImageUpload,
  proofFileUpload,
  categoryHeroUpload,
};
