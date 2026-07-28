/**
 * Navbar & Panel 1 (Hero) validators — Phase 11B.
 */
const { MEDIA_KINDS, MEDIA_CATEGORY_VALUES } = require('../config/cmsOptions');

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SOCIAL_PLATFORMS = new Set(['instagram', 'facebook', 'tiktok', 'whatsapp', 'youtube', 'linkedin', 'x']);
const ALLOWED_TARGETS = new Set(['_self', '_blank']);
const COLOR_HEX_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Shared ──

function boundedText(value, field, max, { required = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) {
    return { valid: false, error: `${field} es obligatorio.` };
  }
  if (normalized.length > max) {
    return { valid: false, error: `${field} no debe exceder ${max} caracteres.` };
  }
  return { valid: true, value: normalized };
}

function validateUrl(value, { required = false, allowFragment = true } = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    return required ? { valid: false, error: 'Proporcione una URL válida.' } : { valid: true, value: '' };
  }

  // Fragment / anchor links (e.g. #servicios)
  if (allowFragment && raw.startsWith('#')) {
    const frag = raw.slice(1);
    if (!frag || /[<>"'\s]/.test(frag)) return { valid: false, error: 'El fragmento de enlace no es válido.' };
    return { valid: true, value: raw, linkType: 'internal', target: '_self' };
  }

  // Internal paths (e.g. /tienda)
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    if (/[<>"'\t]/.test(raw)) return { valid: false, error: 'La ruta interna contiene caracteres no permitidos.' };
    return { valid: true, value: raw, linkType: 'internal', target: '_self' };
  }

  // External URLs
  let parsed;
  try { parsed = new URL(raw); } catch { return { valid: false, error: 'La URL no es válida.' }; }
  if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) {
    return { valid: false, error: 'Solo se permiten enlaces https, mailto o tel.' };
  }
  if (parsed.protocol === 'https:' && parsed.hostname.length > 253) {
    return { valid: false, error: 'El dominio de la URL es demasiado largo.' };
  }
  return { valid: true, value: raw, linkType: 'external', target: '_blank' };
}

function validateTarget(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return { valid: true, value: '_self' };
  if (!ALLOWED_TARGETS.has(cleaned)) return { valid: false, error: 'El destino debe ser _self o _blank.' };
  return { valid: true, value: cleaned };
}

function validateColor(value, field) {
  const raw = String(value || '').trim();
  if (!raw) return { valid: true, value: null };
  if (!COLOR_HEX_PATTERN.test(raw)) return { valid: false, error: `${field} debe ser un color hexadecimal (#RRGGBB o #RRGGBBAA).` };
  return { valid: true, value: raw };
}

function validatePositiveNumber(value, field, { min = 0, max = Infinity, required = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return required ? { valid: false, error: `${field} es obligatorio.` } : { valid: true, value: null };
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return { valid: false, error: `${field} debe ser un número válido.` };
  if (parsed < min || parsed > max) return { valid: false, error: `${field} debe estar entre ${min} y ${max}.` };
  return { valid: true, value: parsed };
}

function validateMediaRef(value, field) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true, value: null };
  const ref = raw.startsWith('media://') ? raw.slice('media://'.length) : raw;
  if (!UUID_PATTERN.test(ref)) return { valid: false, error: `La referencia de medio para ${field} no es válida.` };
  return { valid: true, value: `media://${ref}` };
}

function validateBooleanField(value) {
  return value === '1' || value === 1 || value === true || value === 'true';
}

// ── Navbar global settings ──

function validateNavbarSettings(body = {}) {
  const logoPrimary = validateMediaRef(body.logo_primary, 'logo primario');
  if (!logoPrimary.valid) return logoPrimary;

  const logoLight = validateMediaRef(body.logo_light, 'logo claro');
  if (!logoLight.valid) return logoLight;

  const logoDark = validateMediaRef(body.logo_dark, 'logo oscuro');
  if (!logoDark.valid) return logoDark;

  const favicon = validateMediaRef(body.favicon, 'favicon');
  if (!favicon.valid) return favicon;

  const bgColor = validateColor(body.bg_color, 'El color de fondo');
  if (!bgColor.valid) return bgColor;

  const textColor = validateColor(body.text_color, 'El color de texto');
  if (!textColor.valid) return textColor;

  const accentColor = validateColor(body.accent_color, 'El color de acento');
  if (!accentColor.valid) return accentColor;

  const borderColor = validateColor(body.border_color, 'El color del borde');
  if (!borderColor.valid) return borderColor;

  const opacity = validatePositiveNumber(body.opacity, 'La opacidad', { min: 0, max: 1 });
  if (!opacity.valid) return opacity;

  const logoWidth = validatePositiveNumber(body.logo_width, 'El ancho del logo', { min: 40, max: 500 });
  if (!logoWidth.valid) return logoWidth;

  return {
    valid: true,
    value: {
      logo_primary: logoPrimary.value,
      logo_light: logoLight.value,
      logo_dark: logoDark.value,
      favicon: favicon.value,
      bg_color: bgColor.value,
      text_color: textColor.value,
      accent_color: accentColor.value,
      border_color: borderColor.value,
      opacity: opacity.value,
      logo_width: logoWidth.value,
    },
  };
}

// ── Navigation item ──

function validateNavItem(body = {}) {
  const label = boundedText(body.label, 'La etiqueta', 100, { required: true });
  if (!label.valid) return label;

  const urlResult = validateUrl(body.url, { required: true });
  if (!urlResult.valid) return urlResult;

  const target = validateTarget(body.target);
  if (!target.valid) return target;

  const actualTarget = urlResult.linkType === 'external' ? '_blank' : target.value;

  const mediaRef = validateMediaRef(body.media_public_id, 'icono del enlace');
  if (!mediaRef.valid) return mediaRef;

  const sortOrder = validatePositiveNumber(body.sort_order, 'El orden', { min: 0, max: 100000 });
  if (!sortOrder.valid) return sortOrder;

  const isVisible = body.is_visible !== undefined ? validateBooleanField(body.is_visible) : true;

  return {
    valid: true,
    value: {
      label: label.value,
      url: urlResult.value,
      linkType: urlResult.linkType,
      target: actualTarget,
      mediaPublicId: mediaRef.value?.replace('media://', '') || null,
      sortOrder: sortOrder.value || 0,
      isVisible,
      location: body.location || 'home',
    },
  };
}

// ── Panel 1 / Hero ──

function validateHeroContent(body = {}) {
  const eyebrow = boundedText(body.eyebrow, 'El texto destacado', 120);
  if (!eyebrow.valid) return eyebrow;

  const heading = boundedText(body.heading, 'El título principal', 180, { required: true });
  if (!heading.valid) return heading;

  const description = boundedText(body.description, 'La descripción', 1000);
  if (!description.valid) return description;

  // Primary button
  const primaryLabel = boundedText(body.primary_label, 'La etiqueta del botón principal', 80);
  if (!primaryLabel.valid) return primaryLabel;

  let primaryUrl = { valid: true, value: '#productos', linkType: 'internal', target: '_self' };
  let primaryVisible = true;
  if (body.primary_label) {
    primaryUrl = validateUrl(body.primary_url || '#productos');
    if (!primaryUrl.valid) return primaryUrl;
    if (body.primary_target !== undefined) {
      const requestedTarget = validateTarget(body.primary_target);
      if (!requestedTarget.valid) return requestedTarget;
      primaryUrl.target = requestedTarget.value;
    }
    primaryVisible = body.primary_visible === '1' || body.primary_visible === true || body.primary_visible === undefined;
  }

  // Secondary button
  const secondaryLabel = boundedText(body.secondary_label, 'La etiqueta del botón secundario', 80);
  if (!secondaryLabel.valid) return secondaryLabel;

  let secondaryUrl = { valid: true, value: '#como-trabajamos', linkType: 'internal', target: '_self' };
  let secondaryVisible = true;
  if (body.secondary_label) {
    secondaryUrl = validateUrl(body.secondary_url || '#como-trabajamos');
    if (!secondaryUrl.valid) return secondaryUrl;
    if (body.secondary_target !== undefined) {
      const requestedTarget = validateTarget(body.secondary_target);
      if (!requestedTarget.valid) return requestedTarget;
      secondaryUrl.target = requestedTarget.value;
    }
    secondaryVisible = body.secondary_visible === '1' || body.secondary_visible === true || body.secondary_visible === undefined;
  }

  const bgMedia = validateMediaRef(body.background_media, 'imagen de fondo');
  if (!bgMedia.valid) return bgMedia;

  const modelMedia = validateMediaRef(body.model_media, 'modelo 3D');
  if (!modelMedia.valid) return modelMedia;

  const modelFallback = validateMediaRef(body.model_fallback, 'imagen de respaldo');
  if (!modelFallback.valid) return modelFallback;

  const modelEnabled = body.model_enabled !== undefined ? validateBooleanField(body.model_enabled) : true;
  const isVisible = body.is_visible !== undefined ? validateBooleanField(body.is_visible) : true;
  const metadata = {};
  const textFields = [
    ['hero_aria_label', 'La etiqueta accesible del modelo', 160, 'heroAriaLabel'],
    ['loading_aria_label', 'La etiqueta de carga', 160, 'loadingAriaLabel'],
    ['model_error_text', 'El mensaje de error del modelo', 240, 'modelErrorText'],
    ['retry_label', 'La etiqueta de reintento', 80, 'retryLabel'],
    ['model_poster_alt', 'El texto alternativo del modelo', 250, 'modelPosterAlt'],
    ['model_fallback_alt', 'El texto alternativo de respaldo', 250, 'modelFallbackAlt'],
    ['social_aria_label', 'La etiqueta accesible de redes sociales', 160, 'socialAriaLabel'],
  ];
  for (const [input, label, max, output] of textFields) {
    const result = boundedText(body[input], label, max);
    if (!result.valid) return result;
    metadata[output] = result.value || null;
  }

  return {
    valid: true,
    value: {
      eyebrow: eyebrow.value || null,
      heading: heading.value,
      description: description.value || null,
      primaryButton: {
        label: primaryLabel.value || null,
        url: primaryUrl.value,
        target: primaryUrl.target || (primaryUrl.linkType === 'external' ? '_blank' : '_self'),
        visible: primaryVisible,
      },
      secondaryButton: {
        label: secondaryLabel.value || null,
        url: secondaryUrl.value,
        target: secondaryUrl.target || (secondaryUrl.linkType === 'external' ? '_blank' : '_self'),
        visible: secondaryVisible,
      },
      backgroundMedia: bgMedia.value,
      modelMedia: modelMedia.value,
      modelFallbackMedia: modelFallback.value,
      modelEnabled,
      isVisible,
      ...metadata,
    },
  };
}

function validateSocialItem(body = {}) {
  const platform = String(body.platform || '').trim().toLowerCase();
  if (!SOCIAL_PLATFORMS.has(platform)) {
    return { valid: false, error: 'La plataforma social no está permitida.' };
  }
  const label = boundedText(body.label, 'La etiqueta de plataforma', 80, { required: true });
  if (!label.valid) return label;
  const ariaLabel = boundedText(body.aria_label, 'La etiqueta accesible', 160, { required: true });
  if (!ariaLabel.valid) return ariaLabel;
  const url = validateUrl(body.profile_url, { required: true, allowFragment: false });
  if (!url.valid || url.linkType !== 'external' || !/^https?:\/\//i.test(url.value)) {
    return { valid: false, error: url.error || 'El perfil social debe usar una URL externa http o https.' };
  }
  const media = validateMediaRef(body.media_public_id, 'icono social');
  if (!media.valid) return media;
  return {
    valid: true,
    value: {
      platform,
      label: label.value,
      profile_url: url.value,
      aria_label: ariaLabel.value,
      media_public_id: media.value?.replace('media://', '') || null,
      is_visible: body.is_visible === '0' ? 0 : 1,
    },
  };
}

function validateHeroStyle(body = {}) {
  const scale = validatePositiveNumber(body.model_scale, 'La escala', { min: 0.1, max: 5 });
  if (!scale.valid) return scale;

  const posX = validatePositiveNumber(body.model_pos_x, 'Posición X', { min: -10, max: 10 });
  if (!posX.valid) return posX;
  const posY = validatePositiveNumber(body.model_pos_y, 'Posición Y', { min: -10, max: 10 });
  if (!posY.valid) return posY;
  const posZ = validatePositiveNumber(body.model_pos_z, 'Posición Z', { min: -10, max: 10 });
  if (!posZ.valid) return posZ;

  const rotX = validatePositiveNumber(body.model_rot_x, 'Rotación X', { min: -6.283, max: 6.283 });
  if (!rotX.valid) return rotX;
  const rotY = validatePositiveNumber(body.model_rot_y, 'Rotación Y', { min: -6.283, max: 6.283 });
  if (!rotY.valid) return rotY;
  const rotZ = validatePositiveNumber(body.model_rot_z, 'Rotación Z', { min: -6.283, max: 6.283 });
  if (!rotZ.valid) return rotZ;

  const autoRotate = body.auto_rotate !== undefined ? validateBooleanField(body.auto_rotate) : true;
  const autoRotateSpeed = validatePositiveNumber(body.auto_rotate_speed, 'Velocidad de rotación', { min: 0, max: 5 });
  if (!autoRotateSpeed.valid) return autoRotateSpeed;

  return {
    valid: true,
    value: {
      model: {
        scale: scale.value ?? 1,
        position: { x: posX.value ?? 0, y: posY.value ?? 0, z: posZ.value ?? 0 },
        rotation: { x: rotX.value ?? 0, y: rotY.value ?? 0, z: rotZ.value ?? 0 },
        autoRotate,
        autoRotateSpeed: autoRotateSpeed.value ?? 1,
      },
    },
  };
}

module.exports = {
  SAFE_URL_PROTOCOLS,
  ALLOWED_TARGETS,
  COLOR_HEX_PATTERN,
  UUID_PATTERN,
  boundedText,
  validateUrl,
  validateTarget,
  validateColor,
  validatePositiveNumber,
  validateMediaRef,
  validateBooleanField,
  validateNavbarSettings,
  validateNavItem,
  validateHeroContent,
  validateHeroStyle,
  validateSocialItem,
  SOCIAL_PLATFORMS,
};
