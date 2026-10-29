'use strict';

const express = require('express');
const controller = require('../controllers/quoteRequestController');
const { quoteImagesMiddleware } = require('../middleware/quoteRequestUpload');
const { csrfSynchronisedProtection } = require('../config/csrf');

const router = express.Router();

router.get('/cotizar/sitio-web', controller.showWebsiteQuote);
router.get('/cotizar/pieza-3d', controller.show3dQuote);
router.get('/cotizar/otros', controller.showOtherQuote);

// urlencoded body already parsed globally — CSRF can run first
router.post('/cotizar/sitio-web', csrfSynchronisedProtection, controller.submitWebsite);

// Multipart: multer must parse fields before CSRF can read _csrf
router.post(
  '/cotizar/pieza-3d',
  quoteImagesMiddleware('images'),
  csrfSynchronisedProtection,
  controller.submit3d
);
router.post(
  '/cotizar/otros',
  quoteImagesMiddleware('images'),
  csrfSynchronisedProtection,
  controller.submitOther
);

module.exports = router;
