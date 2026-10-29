'use strict';

const multer = require('multer');

const MAX_FILES = 5;
const MAX_BYTES = 12 * 1024 * 1024;

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
          return next(Object.assign(new Error('Máximo 5 imágenes.'), { code: 'TOO_MANY_FILES', status: 400 }));
        }
        return next();
      }
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          err.message = 'Máximo 5 imágenes de referencia.';
          err.code = 'TOO_MANY_FILES';
        } else if (err.code === 'LIMIT_FILE_SIZE') {
          err.message = 'Cada imagen puede pesar máximo 12 MB.';
        }
        err.status = 400;
      }
      return next(err);
    });
  };
}

module.exports = {
  MAX_FILES,
  MAX_BYTES,
  quoteImagesMiddleware,
};
