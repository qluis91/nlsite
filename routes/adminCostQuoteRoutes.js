const express = require('express');
const multer = require('multer');
const controller = require('../controllers/adminCostQuoteController');
const { csrfSynchronisedProtection } = require('../config/csrf');
const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');

const pageRouter = express.Router();
const apiRouter = express.Router();
const csrf = csrfSynchronisedProtection;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const admin = [isAuthenticated, isAdmin];

// Admin page (mounted under /admin)
pageRouter.get('/cotizacion-3d', ...admin, controller.showCotizacion);

// Legacy aliases under /admin
pageRouter.get('/cotizacion-3d/quotes/list', ...admin, controller.listQuotes);
pageRouter.get('/cotizacion-3d/quotes/:id', ...admin, controller.loadQuote);
pageRouter.post('/cotizacion-3d/quotes', ...admin, csrf, controller.saveQuote);
pageRouter.delete('/cotizacion-3d/quotes/:id', ...admin, csrf, controller.deleteQuote);
pageRouter.post('/cotizacion-3d/quotes/:id/workflow', ...admin, csrf, controller.patchWorkflowStatus);

// Proven API contract (mounted at app root so paths are /api/admin/...)
apiRouter.get('/cost-quote-catalog', ...admin, controller.getCatalog);
apiRouter.post('/cost-quote-catalog/additionals', ...admin, csrf, controller.upsertAdditional);
apiRouter.delete('/cost-quote-catalog/additionals/:id', ...admin, csrf, controller.deleteAdditional);
apiRouter.post('/cost-quote-catalog/printers', ...admin, csrf, controller.upsertPrinter);
apiRouter.delete('/cost-quote-catalog/printers/:id', ...admin, csrf, controller.deletePrinter);
apiRouter.post('/cost-quote-catalog/materials', ...admin, csrf, controller.upsertMaterial);
apiRouter.delete('/cost-quote-catalog/materials/:id', ...admin, csrf, controller.deleteMaterial);

apiRouter.get('/cost-quotes', ...admin, controller.listQuotes);
apiRouter.get('/cost-quotes/:id', ...admin, controller.loadQuote);
apiRouter.post('/cost-quotes', ...admin, csrf, controller.saveQuote);
apiRouter.delete('/cost-quotes/:id', ...admin, csrf, controller.deleteQuote);
apiRouter.patch('/cost-quotes/:id/status', ...admin, csrf, controller.patchWorkflowStatus);
apiRouter.post('/cost-quotes/:id/send-order', ...admin, csrf, upload.single('pdf'), controller.sendOrder);
apiRouter.post(
  '/cost-quotes/:id/whatsapp-assist',
  ...admin,
  csrf,
  upload.single('pdf'),
  controller.whatsappAssist
);

module.exports = { pageRouter, apiRouter };
