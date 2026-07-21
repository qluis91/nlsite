/**
 * Middleware de Autenticación y Roles.
 *
 * Funciones exportadas:
 * - isAuthenticated : redirige a /auth/login si no hay sesión.
 * - isGuest         : redirige a / si ya hay sesión (para login/register).
 * - isAdmin         : verifica que el rol sea 'admin'.
 * - setLocals       : inyecta user y siteConfig en res.locals para EJS.
 */

const siteConfig = require('../config/site');

// ── Inyectar variables globales en todas las vistas ──
function setLocals(req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.site = siteConfig;
  res.locals.currentPath = req.path;
  res.locals.success_msg = req.session.success_msg || null;
  res.locals.error_msg = req.session.error_msg || null;
  delete req.session.success_msg;
  delete req.session.error_msg;
  next();
}

// ── Proteger rutas: requiere sesión ──
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  req.session.error_msg = 'Debes iniciar sesión para acceder.';
  return res.redirect('/auth/login');
}

// ── Redirigir usuarios ya logueados ──
function isGuest(req, res, next) {
  if (!req.session.user) return next();
  return res.redirect('/');
}

// ── Proteger rutas: requiere rol admin ──
function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  req.session.error_msg = 'Acceso denegado. Se requieren permisos de administrador.';
  return res.redirect('/');
}

module.exports = { setLocals, isAuthenticated, isGuest, isAdmin };
