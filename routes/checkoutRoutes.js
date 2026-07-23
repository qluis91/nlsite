const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkoutController');

router.get('/', checkoutController.showCheckout);
router.post('/', checkoutController.submitCheckout);
router.get('/confirmacion/:reference', checkoutController.showConfirmation);

module.exports = router;
