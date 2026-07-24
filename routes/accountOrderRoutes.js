const express = require('express');
const controller = require('../controllers/accountOrderController');
const proofCtrl = require('../controllers/paymentProofController');

const router = express.Router();
router.get('/pedidos', controller.list);
router.get('/pedidos/:reference', controller.detail);
// Payment proof preview — GET, safe after global CSRF
router.get('/pedidos/:reference/comprobante/:proofId', proofCtrl.accountPreview);

module.exports = router;
