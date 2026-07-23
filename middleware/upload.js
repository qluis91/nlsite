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

module.exports = {
  productImageUpload,
  singleImageUpload,
};
