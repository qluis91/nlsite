/**
 * Social Integration Validator — Phase 2E-A.
 * Validates integration configuration inputs.
 */

const ALLOWED_PROVIDERS = Object.freeze(['youtube', 'instagram', 'facebook', 'tiktok']);

function h(str) { return String(str || '').trim(); }

function validateIntegrationConfig(provider, body = {}) {
  const errors = [];

  if (!ALLOWED_PROVIDERS.includes(provider)) {
    errors.push('Proveedor no válido.');
    return { valid: false, errors, sanitized: {} };
  }

  const channelId = h(body.channelId || '').slice(0, 100);
  const maxVideos = Number(body.maxVideos || 20);
  const isEnabled = body.isEnabled === '1' || body.isEnabled === true;
  const autoSync = body.autoSync === '1' || body.autoSync === true;
  const requireApproval = body.requireApproval !== '0' && body.requireApproval !== false;
  const defaultPublished = body.defaultPublished === '1' || body.defaultPublished === true;

  if (isEnabled && !channelId) {
    errors.push('El Channel ID es obligatorio cuando la integración está habilitada.');
  }

  if (!Number.isInteger(maxVideos) || maxVideos < 1 || maxVideos > 50) {
    errors.push('Máximo de videos debe ser entre 1 y 50.');
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      channelId,
      maxVideos,
      isEnabled,
      autoSync,
      requireApproval,
      defaultPublished,
    },
  };
}

module.exports = {
  ALLOWED_PROVIDERS,
  validateIntegrationConfig,
};
