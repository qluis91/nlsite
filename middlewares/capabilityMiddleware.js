/**
 * Capability guard for CMS routes. Runs after isAuthenticated + isAdmin and
 * makes each operation's required permission explicit.
 */
const { hasCapability, capabilitiesFor } = require('../config/capabilities');

function requireCapability(capability) {
  return function capabilityGuard(req, res, next) {
    if (hasCapability(req.session?.user, capability)) {
      res.locals.capabilities = capabilitiesFor(req.session.user);
      return next();
    }
    req.session.error_msg = 'No tienes permisos para realizar esta acción.';
    return res.redirect('/admin');
  };
}

module.exports = { requireCapability };
