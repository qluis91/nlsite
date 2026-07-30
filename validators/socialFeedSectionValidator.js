const { ALLOWED_PLATFORMS } = require('../services/socialFeedService');

const DISPLAY_ORDERS = Object.freeze(['manual', 'newest', 'oldest']);
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  title: 'NinjaLab en redes',
  subtitle: 'Ideas, procesos y proyectos compartidos desde nuestros canales oficiales.',
  maximumPosts: 6,
  featuredOnly: false,
  platforms: [...ALLOWED_PLATFORMS],
  displayOrder: 'manual',
});

function checked(value) {
  return value === true || value === '1' || value === 'true' || value === 'on';
}

function validateSocialFeedSettings(body = {}) {
  const errors = [];
  const title = String(body.title || '').trim();
  const subtitle = String(body.subtitle || '').trim();
  const maximumPosts = Number(body.maximumPosts);
  const requestedPlatforms = Array.isArray(body.platforms)
    ? body.platforms
    : body.platforms ? [body.platforms] : [];
  const platforms = [...new Set(
    requestedPlatforms.map((value) => String(value).toLowerCase()).filter((value) => ALLOWED_PLATFORMS.includes(value))
  )];
  const displayOrder = String(body.displayOrder || 'manual').toLowerCase();

  if (!title) errors.push('El título de la sección es obligatorio.');
  if (title.length > 120) errors.push('El título no puede exceder 120 caracteres.');
  if (subtitle.length > 300) errors.push('El subtítulo no puede exceder 300 caracteres.');
  if (!Number.isInteger(maximumPosts) || maximumPosts < 1 || maximumPosts > 12) {
    errors.push('La cantidad máxima debe ser un entero entre 1 y 12.');
  }
  if (requestedPlatforms.length && platforms.length !== requestedPlatforms.length) {
    errors.push('Uno o más filtros de plataforma no son válidos.');
  }
  if (!DISPLAY_ORDERS.includes(displayOrder)) {
    errors.push('El orden de visualización no es válido.');
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      enabled: checked(body.enabled),
      title,
      subtitle,
      maximumPosts: Number.isInteger(maximumPosts) ? maximumPosts : DEFAULT_SETTINGS.maximumPosts,
      featuredOnly: checked(body.featuredOnly),
      platforms,
      displayOrder: DISPLAY_ORDERS.includes(displayOrder) ? displayOrder : DEFAULT_SETTINGS.displayOrder,
    },
  };
}

function normalizeSocialFeedSettings(value = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
  const maximumPosts = Number(merged.maximumPosts);
  return {
    enabled: merged.enabled !== false,
    title: String(merged.title || DEFAULT_SETTINGS.title).slice(0, 120),
    subtitle: String(merged.subtitle || '').slice(0, 300),
    maximumPosts: Number.isInteger(maximumPosts) ? Math.min(12, Math.max(1, maximumPosts)) : 6,
    featuredOnly: merged.featuredOnly === true,
    platforms: Array.isArray(merged.platforms)
      ? [...new Set(merged.platforms.filter((value) => ALLOWED_PLATFORMS.includes(value)))]
      : [...DEFAULT_SETTINGS.platforms],
    displayOrder: DISPLAY_ORDERS.includes(merged.displayOrder) ? merged.displayOrder : 'manual',
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  DISPLAY_ORDERS,
  normalizeSocialFeedSettings,
  validateSocialFeedSettings,
};
