/**
 * Panel 2 & Panel 3 validators — Phase 11C.
 * Strict backend validation for all CMS fields.
 */
const { MEDIA_KINDS } = require('../config/cmsOptions');

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const ALLOWED_TARGETS = new Set(['_self', '_blank']);
const COLOR_HEX_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const LOGOLOOP_TYPES = new Set(['text', 'image', 'logo']);
const CAROUSEL_THEMES = new Set(['graphite', 'lime', 'silver', 'ink']);
const ICON_TYPES = new Set(['builtin', 'media']);
const ICON_KEYS = new Set(['diseno-3d', 'escaneo-3d', 'diseno-grafico', 'desarrollo-web', 'prendas', 'impresion-3d']);
const STYLE_VARIANTS = new Set(['default', 'highlight', 'minimal']);
const LINK_TYPES = new Set(['internal', 'external']);
const STATUS_VALUES = new Set(['draft', 'published', 'archived']);

function boundedText(value, field, max, { required = false } = {}) {
  if (value === undefined || value === null) value = '';
  const str = String(value).trim();
  if (required && !str) return `${field} es requerido.`;
  if (str.length > max) return `${field} excede ${max} caracteres (${str.length}).`;
  return null;
}

function validateUrl(value, { required = false, allowFragment = true } = {}) {
  if (!value || !String(value).trim()) {
    return required ? 'URL es requerida.' : null;
  }
  const str = String(value).trim();

  // Fragment-only
  if (allowFragment && str.startsWith('#') && str.length > 2) return null;
  // Internal path
  if (str.startsWith('/') && str.length > 1) return null;
  // mailto:/tel:
  if (/^(mailto|tel):/i.test(str)) return null;

  try {
    const parsed = new URL(str);
    if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) return 'Protocolo de URL no permitido.';
    // Block javascript:/data:/vbscript:
    if (/^(javascript|data|vbscript):/i.test(str)) return 'Protocolo de URL inseguro.';
    // Block control characters
    if (/[\x00-\x1f\x7f]/.test(str)) return 'URL contiene caracteres no permitidos.';
    return null;
  } catch {
    return 'URL mal formada.';
  }
}

function validateTarget(value) {
  if (!value) return null;
  if (!ALLOWED_TARGETS.has(String(value))) return 'Target no permitido.';
  return null;
}

function validateColor(value, field) {
  if (!value || !String(value).trim()) return null;
  if (!COLOR_HEX_PATTERN.test(String(value).trim())) return `${field} debe ser un color hexadecimal (#RRGGBB o #RRGGBBAA).`;
  return null;
}

function validateMediaRef(value) {
  if (!value || !String(value).trim()) return null;
  return null; // Format validated at usage time
}

function validateBoolean(value) {
  if (value === undefined || value === null) return null;
  return null;
}

// ── Panel 2 general ──

function validatePanel2Content(body = {}) {
  const errors = [];
  const e = (msg) => msg ? errors.push(msg) : null;

  e(boundedText(body.eyebrow, 'Kicker', 120));
  e(boundedText(body.heading, 'Encabezado', 220, { required: true }));
  e(boundedText(body.supportText, 'Texto de apoyo', 1200));
  e(boundedText(body.carouselLabel, 'Etiqueta del carrusel', 120));
  e(boundedText(body.logoLoopAriaLabel, 'Etiqueta ARIA del LogoLoop', 160));

  return errors;
}

function validatePanel2Style(body = {}) {
  const errors = [];
  const e = (msg) => msg ? errors.push(msg) : null;

  e(validateColor(body.backgroundColor, 'Color de fondo'));
  e(validateColor(body.textColor, 'Color de texto'));
  e(validateColor(body.accentColor, 'Color de acento'));

  return errors;
}

// ── LogoLoop ──

function validateLogoLoopItem(body = {}) {
  const errors = [];
  const e = (msg) => msg ? errors.push(msg) : null;

  const itemType = String(body.item_type || 'text').trim();
  if (!LOGOLOOP_TYPES.has(itemType)) e('Tipo de elemento no permitido.');

  if (itemType === 'text') {
    e(boundedText(body.text_content, 'Contenido de texto', 160, { required: true }));
  }

  if (itemType === 'image' || itemType === 'logo') {
    e(boundedText(body.alt_text, 'Texto alternativo', 250));
  }

  if (body.url && String(body.url).trim()) {
    e(validateUrl(body.url));
    e(validateTarget(body.target));
  }

  if (body.link_type && !LINK_TYPES.has(String(body.link_type).trim())) e('Tipo de enlace no permitido.');
  if (body.status && !STATUS_VALUES.has(String(body.status).trim())) e('Estado no permitido.');

  return errors;
}

// ── Carousel ──

function validateCarouselItem(body = {}) {
  const errors = [];
  const e = (msg) => msg ? errors.push(msg) : null;

  e(boundedText(body.eyebrow, 'Eyebrow', 120));
  e(boundedText(body.title, 'Título', 180, { required: true }));
  e(boundedText(body.description, 'Descripción', 1200));
  e(boundedText(body.button_label, 'Etiqueta del botón', 80));

  if (body.button_url && String(body.button_url).trim()) {
    e(validateUrl(body.button_url));
    e(validateTarget(body.button_target));
  }

  if (body.theme_key && !CAROUSEL_THEMES.has(String(body.theme_key).trim())) e('Tema no permitido.');
  if (body.status && !STATUS_VALUES.has(String(body.status).trim())) e('Estado no permitido.');

  return errors;
}

// ── Panel 3 general ──

function validatePanel3Content(body = {}) {
  const errors = [];
  const e = (msg) => msg ? errors.push(msg) : null;

  e(boundedText(body.eyebrow, 'Kicker', 120));
  e(boundedText(body.heading, 'Encabezado', 220, { required: true }));
  e(boundedText(body.description, 'Descripción', 1200));

  return errors;
}

function validatePanel3Style(body = {}) {
  const errors = [];
  const e = (msg) => msg ? errors.push(msg) : null;

  e(validateColor(body.backgroundColor, 'Color de fondo'));
  e(validateColor(body.textColor, 'Color de texto'));
  e(validateColor(body.accentColor, 'Color de acento'));

  return errors;
}

// ── Feature items ──

function validateFeatureItem(body = {}) {
  const errors = [];
  const e = (msg) => msg ? errors.push(msg) : null;

  e(boundedText(body.title, 'Título', 160, { required: true }));
  e(boundedText(body.description, 'Descripción', 1000));
  e(boundedText(body.detail_text, 'Texto detallado', 1500));

  const iconType = String(body.icon_type || 'builtin').trim();
  if (!ICON_TYPES.has(iconType)) e('Tipo de icono no permitido.');

  if (iconType === 'builtin' && body.icon_key) {
    if (!ICON_KEYS.has(String(body.icon_key).trim())) e('Icono no reconocido.');
  }

  if (body.style_variant && !STYLE_VARIANTS.has(String(body.style_variant).trim())) e('Variante de estilo no permitida.');

  if (body.url && String(body.url).trim()) {
    e(validateUrl(body.url));
    e(validateTarget(body.target));
  }

  if (body.link_type && !LINK_TYPES.has(String(body.link_type).trim())) e('Tipo de enlace no permitido.');
  if (body.status && !STATUS_VALUES.has(String(body.status).trim())) e('Estado no permitido.');

  return errors;
}

const INDEXING_MODES = new Set(['index,follow', 'noindex,nofollow', 'index,nofollow']);

function validateGlobalSettings(body) {
  const errors = [];
  const e = (msg) => msg && errors.push(msg);

  if (body.site_name !== undefined && body.site_name !== null) {
    e(boundedText(body.site_name, 'Nombre del sitio', 100));
  }
  if (body.seo_title !== undefined && body.seo_title !== null) {
    e(boundedText(body.seo_title, 'Título SEO', 120));
  }
  if (body.seo_description !== undefined && body.seo_description !== null) {
    e(boundedText(body.seo_description, 'Descripción SEO', 300));
  }
  if (body.canonical_url && String(body.canonical_url).trim()) {
    e(validateUrl(body.canonical_url, { required: false }));
  }
  if (body.indexing_mode && !INDEXING_MODES.has(String(body.indexing_mode).trim())) {
    e('Modo de indexación no permitido.');
  }

  return errors;
}

module.exports = {
  validatePanel2Content,
  validatePanel2Style,
  validateLogoLoopItem,
  validateCarouselItem,
  validatePanel3Content,
  validatePanel3Style,
  validateFeatureItem,
  validateGlobalSettings,
  validateColor,
  validateUrl,
  LOGOLOOP_TYPES,
  CAROUSEL_THEMES,
  ICON_TYPES,
  ICON_KEYS,
  STYLE_VARIANTS,
};
