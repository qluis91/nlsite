const multer = require('multer');
const path = require('path');
const { MAX_FILE_SIZE, ALLOWED_MIME_TYPES } = require('../services/imageProcessingService');

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
    fields: 10,
    fieldSize: MAX_FILE_SIZE,
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
    fileSize: 2 * 1024 * 1024,
    files: 1,
    fields: 5,
    fieldSize: 64 * 1024,
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
    fieldSize: 64 * 1024,
  },
}).single('hero_image');

module.exports = {
  productImageUpload,
  singleImageUpload,
  avatarImageUpload,
  proofFileUpload,
  categoryHeroUpload,
};
