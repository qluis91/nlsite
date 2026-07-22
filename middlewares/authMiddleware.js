/**
 * Middleware de Autenticación y Roles.
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

// ── Proteger rutas: requiere sesión con id válido ──
function isAuthenticated(req, res, next) {
  if (req.session.user && req.session.user.id) return next();
  req.session.error_msg = 'Debes iniciar sesión para acceder.';
  return res.redirect('/auth/login');
}

// ── Redirigir usuarios ya logueados ──
function isGuest(req, res, next) {
  if (!req.session.user) return next();
  return res.redirect('/');
}

// ── Proteger rutas: requiere role_id = 1 (admin) ──
function isAdmin(req, res, next) {
  if (req.session.user && Number(req.session.user.role_id) === 1) return next();
  req.session.error_msg = 'Acceso denegado. Se requieren permisos de administrador.';
  return res.redirect('/');
}

// ── Manejar visitantes del login de administrador ──
function isAdminGuest(req, res, next) {
  if (!req.session.user) return next();
  if (Number(req.session.user.role_id) === 1) return res.redirect('/admin');
  req.session.error_msg = 'No tienes permisos de administrador.';
  return res.redirect('/auth/login');
}

module.exports = { setLocals, isAuthenticated, isGuest, isAdmin, isAdminGuest };
