const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isGuest } = require('../middlewares/authMiddleware');

// GET  - Mostrar formulario de login
router.get('/login', isGuest, authController.showLogin);

// POST - Procesar login
router.post('/login', isGuest, authController.login);

// GET  - Mostrar formulario de registro
router.get('/register', isGuest, authController.showRegister);

// POST - Procesar registro
router.post('/register', isGuest, authController.register);

// GET  - Cerrar sesión
router.get('/logout', authController.logout);

module.exports = router;
