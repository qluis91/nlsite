const express = require('express');
const { proofFileUpload } = require('../middleware/upload');
const { csrfSynchronisedProtection } = require('../config/csrf');
const ctrl = require('../controllers/paymentProofController');

const router = express.Router();

// POST upload — multer parses multipart body into req.body, then centralized CSRF validates token, then controller
router.post('/pedidos/:reference/comprobante', proofFileUpload, csrfSynchronisedProtection, ctrl.accountUpload);

module.exports = router;
