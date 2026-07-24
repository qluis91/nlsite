const express = require('express');
const controller = require('../controllers/adminOrderController');
const proofCtrl = require('../controllers/paymentProofController');
const tilopayCtrl = require('../controllers/tilopayController');

const router = express.Router();
router.get('/orders', controller.list);
router.get('/orders/:reference', controller.detail);
router.post('/orders/:reference/quote-shipping', controller.quoteShipping);
router.post('/orders/:reference/confirm-payment', controller.confirmPayment);
router.post('/orders/:reference/status', controller.changeStatus);
router.post('/orders/:reference/notes', controller.addNote);
router.post('/orders/:reference/cancel', controller.cancel);
// Tracking & shipping
router.post('/orders/:reference/tracking', controller.updateTracking);
// Payment proof
router.get('/orders/:reference/comprobante/:proofId', proofCtrl.adminPreview);
router.post('/orders/:reference/comprobante/:proofId/aprobar', proofCtrl.adminApprove);
router.post('/orders/:reference/comprobante/:proofId/rechazar', proofCtrl.adminReject);
// Tilopay admin reconciliation
router.post('/orders/:reference/tilopay/reconcile', tilopayCtrl.adminReconcile);

module.exports = router;
