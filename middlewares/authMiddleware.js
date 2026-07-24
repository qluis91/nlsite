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
  // Cart badge count (light: counts session quantities only)
  const cart = req.session.cart;
  res.locals.cartItemCount = cart && Array.isArray(cart.items)
    ? cart.items.reduce((s, i) => s + (parseInt(i.quantity, 10) || 0), 0)
    : 0;
  next();
}

// ── Proteger rutas: requiere sesión con id válido ──
function safeAuthReturnPath(value) {
  const raw = String(value || '');
  return /^\/cuenta(?:\/(?:perfil|seguridad|direcciones(?:\/(?:nueva|[1-9]\d*\/editar))?|pedidos(?:\/NL-[A-Z0-9]{12})?))?(?:\?page=\d+(?:&limit=\d+)?)?$/.test(raw)
    ? raw
    : '/';
}

function isAuthenticated(req, res, next) {
  if (req.session.user && req.session.user.id) return next();
  req.session.error_msg = 'Debes iniciar sesión para acceder.';
  const returnTo = safeAuthReturnPath(req.originalUrl);
  return res.redirect(returnTo === '/' ? '/auth/login' : `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
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

module.exports = { setLocals, isAuthenticated, isGuest, isAdmin, isAdminGuest, safeAuthReturnPath };
