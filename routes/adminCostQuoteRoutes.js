const express = require('express');
const controller = require('../controllers/adminCostQuoteController');
const { csrfSynchronisedProtection } = require('../config/csrf');

const router = express.Router();

// Main page (GET — no CSRF needed)
router.get('/cotizacion-3d', controller.showCotizacion);

// Quotes JSON list (GET)
router.get('/cotizacion-3d/quotes/list', controller.listQuotes);
router.get('/cotizacion-3d/quotes/:id', controller.loadQuote);

// Mutation routes — require CSRF
const csrf = csrfSynchronisedProtection;

// Catalog CRUD
router.post('/cotizacion-3d/catalog', csrf, controller.createCatalogItem);
router.post('/cotizacion-3d/catalog/:id', csrf, controller.updateCatalogItem);
router.post('/cotizacion-3d/catalog/:id/delete', csrf, controller.deleteCatalogItem);

// Quotes CRUD
router.post('/cotizacion-3d/quotes', csrf, controller.createQuote);
router.post('/cotizacion-3d/quotes/:id', csrf, controller.updateQuote);
router.post('/cotizacion-3d/quotes/:id/delete', csrf, controller.deleteQuote);

module.exports = router;
