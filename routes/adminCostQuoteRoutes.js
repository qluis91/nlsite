const express = require('express');
const controller = require('../controllers/adminCostQuoteController');
const { csrfSynchronisedProtection } = require('../config/csrf');
const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();
const csrf = csrfSynchronisedProtection;

// ══ Admin routes (auth + admin) ══

// Main page
router.get('/cotizacion-3d', isAuthenticated, isAdmin, controller.showCotizacion);

// Catalog CRUD
router.post('/cotizacion-3d/catalog', isAuthenticated, isAdmin, csrf, controller.createCatalogItem);
router.post('/cotizacion-3d/catalog/:id', isAuthenticated, isAdmin, csrf, controller.updateCatalogItem);
router.delete('/cotizacion-3d/catalog/:id', isAuthenticated, isAdmin, csrf, controller.deleteCatalogItem);

// Quotes CRUD
router.get('/cotizacion-3d/quotes/list', isAuthenticated, isAdmin, controller.listQuotes);
router.get('/cotizacion-3d/quotes/:id', isAuthenticated, isAdmin, controller.loadQuote);
router.post('/cotizacion-3d/quotes', isAuthenticated, isAdmin, csrf, controller.createQuote);
router.post('/cotizacion-3d/quotes/:id', isAuthenticated, isAdmin, csrf, controller.updateQuote);
router.delete('/cotizacion-3d/quotes/:id', isAuthenticated, isAdmin, controller.deleteQuote);

// Workflow
router.post('/cotizacion-3d/quotes/:id/workflow', isAuthenticated, isAdmin, csrf, controller.setWorkflowStatus);

// PDF generation
router.post('/cotizacion-3d/pdf-data', isAuthenticated, isAdmin, csrf, controller.pdfData);

// Email
router.post('/cotizacion-3d/send-email', isAuthenticated, isAdmin, csrf, controller.sendEmail);

// ══ Public routes (no auth) ══

// Public quote view
router.get('/cotizacion-3d/pago/:token', controller.publicQuote);

// Public confirmation
router.post('/cotizacion-3d/pago/:token', csrf, controller.publicConfirm);

module.exports = router;
