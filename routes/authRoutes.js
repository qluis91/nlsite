const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { isGuest } = require('../middlewares/authMiddleware');

// ── Rate Limiter para Login ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.error_msg =
      'Demasiados intentos de inicio de sesión. Inténtalo nuevamente en unos minutos.';
    return res.redirect('/auth/login');
  },
});

// GET  - Mostrar formulario de login
router.get('/login', isGuest, authController.showLogin);

// POST - Procesar login (con rate limiting)
router.post('/login', isGuest, loginLimiter, authController.login);

// GET  - Mostrar formulario de registro
router.get('/register', isGuest, authController.showRegister);

// POST - Procesar registro
router.post('/register', isGuest, authController.register);

// POST - Cerrar sesión
router.post('/logout', authController.logout);

module.exports = router;
