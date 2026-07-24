const express = require('express');
const accountController = require('../controllers/accountController');
const { avatarImageUpload } = require('../middleware/upload');
const { csrfSynchronisedProtection } = require('../config/csrf');

const router = express.Router();

function parseAvatarUpload(req, res, next) {
  avatarImageUpload(req, res, (uploadError) => {
    csrfSynchronisedProtection(req, res, (csrfError) => {
      if (csrfError) return next(csrfError);
      if (!uploadError) return next();
      req.session.error_msg = uploadError.code === 'LIMIT_FILE_SIZE'
        ? 'La imagen no puede superar 2 MB.'
        : uploadError.message || 'El archivo seleccionado no es una imagen válida.';
      return res.redirect('/cuenta/perfil');
    });
  });
}

router.post('/avatar', parseAvatarUpload, accountController.updateAvatar);

module.exports = router;
