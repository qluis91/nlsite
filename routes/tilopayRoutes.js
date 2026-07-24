/**
 * Tilopay user-facing routes — payment initiation, return, cancellation.
 * Mounted with: app.use('/cuenta', isAuthenticated, tilopayRoutes) for account routes
 * and: app.use('/pagos', tilopayRoutes) for public return/cancel routes
 */
const express = require('express');
const { csrfSynchronisedProtection } = require('../config/csrf');
const ctrl = require('../controllers/tilopayController');

const router = express.Router();

// ── Initiation (requires CSRF, ownership authorization in controller) ──
router.post('/pedidos/:reference/pagar/tilopay', csrfSynchronisedProtection, ctrl.initiatePayment);

// ── Customer verification (Verificar estado del pago) ──
router.post('/pedidos/:reference/tilopay/verificar', csrfSynchronisedProtection, ctrl.verifyPayment);

// ── Guest initiation (requires CSRF) ──
// Mounted separately under /consultar-pedido
const guestRouter = express.Router();
guestRouter.post('/:reference/pagar/tilopay', csrfSynchronisedProtection, ctrl.initiatePaymentGuest);

// ── Guest verification (Verificar estado del pago) ──
guestRouter.post('/:reference/tilopay/verificar', csrfSynchronisedProtection, ctrl.verifyPaymentGuest);

// ── Return/cancel (GET, no CSRF — these come from provider redirect) ──
router.get('/tilopay/retorno', ctrl.returnFromTilopay);
router.get('/tilopay/cancelado', ctrl.cancelledByUser);

module.exports = { router, guestRouter };
