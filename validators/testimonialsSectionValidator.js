const { ALLOWED_PLATFORMS } = require('../services/testimonialService');

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  title: 'Lo que dicen nuestros clientes',
  subtitle: 'Comentarios reales de personas que confían en nosotros.',
  maxItems: 6,
  featuredOnly: false,
  platforms: [...ALLOWED_PLATFORMS],
});

function checked(value) {
  return value === true || value === '1' || value === 'true' || value === 'on';
}

function validateTestimonialsSectionSettings(body = {}) {
  const errors = [];
  const title = String(body.title || '').trim();
  const subtitle = String(body.subtitle || '').trim();
  const maxItems = Number(body.maxItems);
  const requestedPlatforms = Array.isArray(body.platforms)
    ? body.platforms
    : body.platforms ? [body.platforms] : [];
  const platforms = [...new Set(
    requestedPlatforms.map((v) => String(v).toLowerCase()).filter((v) => ALLOWED_PLATFORMS.includes(v))
  )];

  if (!title) errors.push('El título de la sección es obligatorio.');
  if (title.length > 120) errors.push('El título no puede exceder 120 caracteres.');
  if (subtitle.length > 300) errors.push('El subtítulo no puede exceder 300 caracteres.');
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 12) {
    errors.push('La cantidad máxima debe ser un entero entre 1 y 12.');
  }
  if (requestedPlatforms.length && platforms.length !== requestedPlatforms.length) {
    errors.push('Uno o más filtros de plataforma no son válidos.');
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      enabled: checked(body.enabled),
      title,
      subtitle,
      maxItems: Number.isInteger(maxItems) ? maxItems : DEFAULT_SETTINGS.maxItems,
      featuredOnly: checked(body.featuredOnly),
      platforms,
    },
  };
}

function normalizeTestimonialsSectionSettings(value = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
  const maxItems = Number(merged.maxItems);
  return {
    enabled: merged.enabled !== false,
    title: String(merged.title || DEFAULT_SETTINGS.title).slice(0, 120),
    subtitle: String(merged.subtitle || '').slice(0, 300),
    maxItems: Number.isInteger(maxItems) ? Math.min(12, Math.max(1, maxItems)) : 6,
    featuredOnly: merged.featuredOnly === true,
    platforms: Array.isArray(merged.platforms)
      ? [...new Set(merged.platforms.filter((v) => ALLOWED_PLATFORMS.includes(v)))]
      : [...DEFAULT_SETTINGS.platforms],
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  validateTestimonialsSectionSettings,
  normalizeTestimonialsSectionSettings,
};
