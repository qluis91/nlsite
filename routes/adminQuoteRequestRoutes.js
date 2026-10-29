'use strict';

const express = require('express');
const controller = require('../controllers/adminQuoteRequestController');
const { csrfSynchronisedProtection } = require('../config/csrf');

const router = express.Router();

router.get('/cotizaciones', controller.showList);
router.get('/cotizaciones/:publicId', controller.showDetail);
router.post('/cotizaciones/:publicId/status', csrfSynchronisedProtection, controller.updateStatus);

module.exports = router;
