const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { isGuest, safeAuthReturnPath } = require('../middlewares/authMiddleware');

// ── Rate Limiter para Login ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const returnTo = safeAuthReturnPath(req.body.returnTo);
    req.session.loginForm = {
      email: (req.body.email || '').trim().toLowerCase(),
    };
    req.session.error_msg =
      'Demasiados intentos de inicio de sesión. Inténtalo nuevamente en unos minutos.';
    return res.redirect(
      returnTo === '/' ? '/auth/login' : `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    );
  },
});

// ── Rate Limiter para Registro ──
const registerLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.error_msg =
      'Demasiados intentos de registro. Inténtalo nuevamente en unos minutos.';
    return res.redirect('/auth/register');
  },
});

// ── Rate Limiter para Reenvío de Verificación ──
const resendLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.error_msg =
      'Demasiadas solicitudes. Inténtalo nuevamente en unos minutos.';
    return res.redirect('/auth/verify-pending');
  },
});

// ── Rate Limiter para Olvidó Contraseña ──
const forgotLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.success_msg =
      'Si existe una cuenta activa con ese correo, recibirás un enlace para restablecer la contraseña.';
    return res.redirect('/auth/forgot-password');
  },
});

// ── Rate Limiter para Reset de Contraseña ──
const resetPasswordLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.error_msg =
      'Demasiados intentos. Inténtalo nuevamente en unos minutos.';
    return res.redirect('/auth/login');
  },
});

// ── Login ──
router.get('/login', isGuest, authController.showLogin);
router.post('/login', isGuest, loginLimiter, authController.login);

// ── Registro + verificación ──
router.get('/register', isGuest, authController.showRegister);
router.post('/register', isGuest, registerLimiter, authController.register);
router.get('/verify-pending', authController.showVerifyPending);
router.get('/verify-email', authController.verifyEmail);
router.get('/resend-verification', authController.showResendForm);
router.post('/resend-verification', resendLimiter, authController.resendVerification);

// ── Olvidó / Reset contraseña ──
router.get('/forgot-password', isGuest, authController.showForgotPassword);
router.post('/forgot-password', isGuest, forgotLimiter, authController.forgotPassword);
router.get('/reset-password', isGuest, authController.showResetPassword);
router.post('/reset-password', isGuest, resetPasswordLimiter, authController.resetPassword);

// ── Logout ──
router.post('/logout', authController.logout);

module.exports = router;
