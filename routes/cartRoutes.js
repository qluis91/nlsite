/**
 * Cart routes — public, CSRF-protected mutations.
 */
const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');

// GET cart page
router.get('/', cartController.showCart);

// POST mutations
router.post('/agregar', cartController.addItem);
router.post('/actualizar', cartController.updateItem);
router.post('/eliminar', cartController.removeItem);
router.post('/vaciar', cartController.clearCart);

module.exports = router;
