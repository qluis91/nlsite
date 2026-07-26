/**
 * "Administrar página" routes — Phase 11A.
 *
 * Mounted under /admin behind isAuthenticated + isAdmin. Multipart routes run
 * multer BEFORE csrfSynchronisedProtection, matching the established order for
 * the catalog, gallery and payment-proof uploads.
 */
const express = require('express');
const pageController = require('../controllers/adminPageController');
const mediaController = require('../controllers/adminMediaController');
const { csrfSynchronisedProtection } = require('../config/csrf');
const { requireCapability } = require('../middlewares/capabilityMiddleware');
const { CAPABILITIES } = require('../config/capabilities');
const { mediaBatchUpload, mediaReplaceUpload, handleUpload } = require('../middleware/mediaUpload');
const multer = require('multer');

const selectorUploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
}).single('file');

const router = express.Router();

const UUID_ROUTE = ':publicId([0-9a-fA-F-]{36})';
const MEDIA_BASE = '/page/media';
const UPLOAD_REDIRECT = '/admin/page/media/upload';

router.get('/page', requireCapability(CAPABILITIES.PAGE_MANAGE), pageController.overview);

router.get(MEDIA_BASE, requireCapability(CAPABILITIES.MEDIA_VIEW), mediaController.library);

router.get(
  `${MEDIA_BASE}/upload`,
  requireCapability(CAPABILITIES.MEDIA_UPLOAD),
  mediaController.showUpload
);

router.post(
  MEDIA_BASE,
  requireCapability(CAPABILITIES.MEDIA_UPLOAD),
  handleUpload(mediaBatchUpload, UPLOAD_REDIRECT),
  csrfSynchronisedProtection,
  mediaController.upload
);

router.get(
  `${MEDIA_BASE}/${UUID_ROUTE}`,
  requireCapability(CAPABILITIES.MEDIA_VIEW),
  mediaController.detail
);

router.get(
  `${MEDIA_BASE}/${UUID_ROUTE}/edit`,
  requireCapability(CAPABILITIES.MEDIA_EDIT),
  mediaController.showEdit
);

router.post(
  `${MEDIA_BASE}/${UUID_ROUTE}`,
  requireCapability(CAPABILITIES.MEDIA_EDIT),
  csrfSynchronisedProtection,
  mediaController.update
);

router.post(
  `${MEDIA_BASE}/${UUID_ROUTE}/replace`,
  requireCapability(CAPABILITIES.MEDIA_EDIT),
  handleUpload(mediaReplaceUpload, (req) => `/admin/page/media/${req.params.publicId}/edit`),
  csrfSynchronisedProtection,
  mediaController.replace
);

router.post(
  `${MEDIA_BASE}/${UUID_ROUTE}/archive`,
  requireCapability(CAPABILITIES.MEDIA_ARCHIVE),
  csrfSynchronisedProtection,
  mediaController.archive
);

router.post(
  `${MEDIA_BASE}/${UUID_ROUTE}/restore`,
  requireCapability(CAPABILITIES.MEDIA_ARCHIVE),
  csrfSynchronisedProtection,
  mediaController.restore
);

// ── Phase 11C: JSON browse endpoint for visual media selector ──
router.get(
  '/api/page/media',
  requireCapability(CAPABILITIES.MEDIA_VIEW),
  mediaController.mediaBrowse
);

// ── Phase 11C-S: Direct upload from media selector (AJAX) ──
router.post(
  '/api/page/media/upload',
  requireCapability(CAPABILITIES.MEDIA_UPLOAD),
  (req, res, next) => {
    selectorUploadMulter(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'El archivo supera el límite de tamaño.' });
        }
        return res.status(400).json({ success: false, error: 'Error al recibir el archivo.' });
      }
      next();
    });
  },
  csrfSynchronisedProtection,
  mediaController.selectorUpload
);

module.exports = router;
