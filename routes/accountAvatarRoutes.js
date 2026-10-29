const express = require('express');
const accountController = require('../controllers/accountController');
const { avatarImageUpload, mapAvatarUploadError } = require('../middleware/upload');
const { csrfSynchronisedProtection } = require('../config/csrf');

const router = express.Router();

function parseAvatarUpload(req, res, next) {
  avatarImageUpload(req, res, (uploadError) => {
    csrfSynchronisedProtection(req, res, (csrfError) => {
      if (csrfError) return next(csrfError);
      if (!uploadError) return next();
      req.session.error_msg = mapAvatarUploadError(uploadError);
      return res.redirect('/cuenta/perfil');
    });
  });
}

router.post('/avatar', parseAvatarUpload, accountController.updateAvatar);

module.exports = router;
