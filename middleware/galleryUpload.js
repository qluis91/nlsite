const multer = require('multer');
const {
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  MAX_VIDEO_SIZE,
} = require('../config/galleryOptions');

const allowed = new Set([...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES]);

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter(_req, file, callback) {
    if (allowed.has(file.mimetype)) return callback(null, true);
    return callback(new Error('Formato no permitido. Use JPG, PNG, WebP, MP4 o WebM.'));
  },
  limits: {
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
    req.session.error_msg = error.code === 'LIMIT_FILE_SIZE'
      ? 'El archivo supera el límite permitido.'
      : error.message;
    const editMatch = req.originalUrl.match(/^\/admin\/galeria\/([1-9]\d*)$/);
    return res.redirect(editMatch ? `/admin/galeria/${editMatch[1]}/editar` : '/admin/galeria/nuevo');
  });
}

module.exports = { galleryUpload };
