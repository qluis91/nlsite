const express = require('express');
const { proofFileUpload } = require('../middleware/upload');
const { csrfSynchronisedProtection } = require('../config/csrf');
const ctrl = require('../controllers/paymentProofController');

const router = express.Router();

// POST upload — multer parses multipart body into req.body, then centralized CSRF validates token, then controller
router.post('/:reference/comprobante', proofFileUpload, csrfSynchronisedProtection, ctrl.guestUpload);

// GET preview
router.get('/:reference/comprobante/:proofId', ctrl.guestPreview);

module.exports = router;
