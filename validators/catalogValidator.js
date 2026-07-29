/**
 * Validation helpers for the admin catalog module.
 */
const { MAX_FILE_SIZE } = require('../services/imageProcessingService');

const NAME_MAX = 160;
const DESC_MAX = 10000;
const TAG_MAX_COUNT = 20;
const TAG_MAX_LENGTH = 40;
const MAX_IMAGES = 5;

/**
 * Normalize and validate category name.
 */
function validateCategoryName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { valid: false, error: 'El nombre de la categoría es obligatorio.', value: '' };
  if (trimmed.length > 100) return { valid: false, error: 'El nombre no debe exceder 100 caracteres.', value: trimmed };
  return { valid: true, value: trimmed };
}

const HERO_POSITIONS = new Set(['center', 'top', 'bottom', 'left', 'right']);
const HERO_TITLE_MAX = 160;
const HERO_DESC_MAX = 500;
const HERO_ALT_MAX = 200;
const CATEGORY_DESC_MAX = 500;
const HERO_EYEBROW_MAX = 120;
const HERO_BUTTON_LABEL_MAX = 80;
const HERO_BUTTON_URL_MAX = 500;
const HERO_TARGETS = new Set(['_self', '_blank']);
const MEDIA_REFERENCE_PATTERN = /^media:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Optional short category description.
 */
function validateCategoryDescription(value) {
  const trimmed = String(value ?? '').replace(/\0/g, '').trim();
  if (!trimmed) return { valid: true, value: null };
  if (trimmed.length > CATEGORY_DESC_MAX) {
    return { valid: false, error: `La descripción no debe exceder ${CATEGORY_DESC_MAX} caracteres.`, value: trimmed };
  }
  return { valid: true, value: trimmed };
}

/**
 * Optional category hero title.
 */
function validateHeroTitle(value) {
  const trimmed = String(value ?? '').replace(/\0/g, '').trim();
  if (!trimmed) return { valid: true, value: null };
  if (trimmed.length > HERO_TITLE_MAX) {
    return { valid: false, error: `El título del hero no debe exceder ${HERO_TITLE_MAX} caracteres.`, value: trimmed };
  }
  return { valid: true, value: trimmed };
}

/**
 * Optional category hero description.
 */
function validateHeroDescription(value) {
  const trimmed = String(value ?? '').replace(/\0/g, '').trim();
  if (!trimmed) return { valid: true, value: null };
  if (trimmed.length > HERO_DESC_MAX) {
    return { valid: false, error: `La descripción del hero no debe exceder ${HERO_DESC_MAX} caracteres.`, value: trimmed };
  }
  return { valid: true, value: trimmed };
}

/**
 * Optional hero image alt text.
 */
function validateHeroAlt(value) {
  const trimmed = String(value ?? '').replace(/\0/g, '').trim();
  if (!trimmed) return { valid: true, value: null };
  if (trimmed.length > HERO_ALT_MAX) {
    return { valid: false, error: `El texto alternativo no debe exceder ${HERO_ALT_MAX} caracteres.`, value: trimmed };
  }
  return { valid: true, value: trimmed };
}

/**
 * Allowlisted hero image focal position.
 */
function validateHeroPosition(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return { valid: true, value: 'center' };
  if (!HERO_POSITIONS.has(raw)) {
    return { valid: false, error: 'La posición de la imagen no es válida.', value: 'center' };
  }
  return { valid: true, value: raw };
}

function validateOptionalText(value, maximum, fieldLabel) {
  const trimmed = String(value ?? '').replace(/\0/g, '').trim();
  if (!trimmed) return { valid: true, value: null };
  if (trimmed.length > maximum) {
    return { valid: false, error: `${fieldLabel} no debe exceder ${maximum} caracteres.`, value: trimmed };
  }
  return { valid: true, value: trimmed };
}

function validateHeroEyebrow(value) {
  return validateOptionalText(value, HERO_EYEBROW_MAX, 'El antetítulo del hero');
}

function validateHeroButtonLabel(value) {
  return validateOptionalText(value, HERO_BUTTON_LABEL_MAX, 'La etiqueta del botón');
}

function isSafeHeroButtonUrl(value) {
  const url = String(value ?? '').replace(/\0/g, '').trim();
  if (!url || url.length > HERO_BUTTON_URL_MAX || /[\r\n\\]/.test(url)) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function validateHeroButtonUrl(value) {
  const trimmed = String(value ?? '').replace(/\0/g, '').trim();
  if (!trimmed) return { valid: true, value: null };
  if (!isSafeHeroButtonUrl(trimmed)) {
    return {
      valid: false,
      error: 'La URL del botón debe ser una ruta interna segura o una URL HTTP(S).',
      value: trimmed,
    };
  }
  return { valid: true, value: trimmed };
}

function validateHeroButtonTarget(value) {
  const target = String(value ?? '').trim();
  if (!target) return { valid: true, value: '_self' };
  if (!HERO_TARGETS.has(target)) {
    return { valid: false, error: 'El destino del botón no es válido.', value: '_self' };
  }
  return { valid: true, value: target };
}

function validateHeroMediaReference(value) {
  const reference = String(value ?? '').trim();
  if (!reference) return { valid: true, value: null };
  if (!MEDIA_REFERENCE_PATTERN.test(reference)) {
    return { valid: false, error: 'La imagen seleccionada no tiene una referencia válida.', value: reference };
  }
  return { valid: true, value: reference };
}

/**
 * Slugify a string for URLs.
 */
function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Validate product name.
 */
function validateProductName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { valid: false, error: 'El nombre del producto es obligatorio.', value: '' };
  if (trimmed.length > NAME_MAX) return { valid: false, error: `El nombre no debe exceder ${NAME_MAX} caracteres.`, value: trimmed };
  return { valid: true, value: trimmed };
}

/**
 * Validate a price field. Returns null for empty, or a positive decimal.
 */
function validatePrice(value, fieldName = 'Precio') {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true, value: null };
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) {
    return { valid: false, error: `${fieldName} debe ser un número válido no negativo.`, value: null };
  }
  if (num > 99999999.99) {
    return { valid: false, error: `${fieldName} excede el valor máximo permitido.`, value: null };
  }
  return { valid: true, value: Math.round(num * 100) / 100 };
}

/**
 * Validate stock quantity.
 */
function validateStock(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true, value: 0 };
  if (!/^\d+$/.test(raw)) return { valid: false, error: 'El stock debe ser un número entero no negativo.', value: 0 };
  const num = parseInt(raw, 10);
  if (num > 999999) return { valid: false, error: 'El stock excede el máximo permitido.', value: 0 };
  return { valid: true, value: num };
}

/**
 * Validate weight (grams, integer).
 */
function validateWeight(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true, value: null };
  if (!/^\d+$/.test(raw)) return { valid: false, error: 'El peso debe ser un número entero en gramos.', value: null };
  const num = parseInt(raw, 10);
  if (num > 999999) return { valid: false, error: 'El peso excede el máximo permitido.', value: null };
  return { valid: true, value: num };
}

/**
 * Validate description.
 */
function validateDescription(value) {
  const raw = String(value ?? '').trim();
  if (raw.length > DESC_MAX) return { valid: false, error: `La descripción no debe exceder ${DESC_MAX} caracteres.`, value: raw.slice(0, DESC_MAX) };
  return { valid: true, value: raw || null };
}

/**
 * Normalize tags from comma-separated string.
 */
function validateTags(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true, value: null };
  const tags = raw
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0 && t.length <= TAG_MAX_LENGTH)
    .slice(0, TAG_MAX_COUNT);
  // Deduplicate case-insensitively
  const seen = new Set();
  const unique = [];
  for (const t of tags) {
    const lower = t.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(t);
    }
  }
  return { valid: true, value: unique.length ? JSON.stringify(unique) : null };
}

/**
 * Validate category IDs array.
 */
function validateCategoryIds(ids, availableIds) {
  if (!ids || !ids.length) return { valid: false, error: 'Seleccione al menos una categoría.', value: [] };
  const parsed = (Array.isArray(ids) ? ids : [ids])
    .map(id => parseInt(id, 10))
    .filter(id => Number.isSafeInteger(id) && id > 0);
  const unique = [...new Set(parsed)];
  if (!unique.length) return { valid: false, error: 'Seleccione al menos una categoría.', value: [] };
  if (availableIds && availableIds.length) {
    const invalid = unique.filter(id => !availableIds.includes(id));
    if (invalid.length) return { valid: false, error: 'Una o más categorías no son válidas.', value: unique };
  }
  return { valid: true, value: unique };
}

/**
 * Validate total image count (existing + new removals + new additions).
 */
function validateImageCount(existingCount, removeIds, newCount) {
  const toRemove = Array.isArray(removeIds) ? removeIds.length : 0;
  const final = existingCount - toRemove + newCount;
  if (final > MAX_IMAGES) {
    return { valid: false, error: `Máximo ${MAX_IMAGES} imágenes por producto. Actualmente tiene ${existingCount}, eliminaría ${toRemove} y agregaría ${newCount}.` };
  }
  if (final < 0) return { valid: false, error: 'No se pueden eliminar más imágenes de las que existen.' };
  return { valid: true, final };
}

module.exports = {
  validateCategoryName,
  validateCategoryDescription,
  validateHeroTitle,
  validateHeroDescription,
  validateHeroAlt,
  validateHeroPosition,
  validateHeroEyebrow,
  validateHeroButtonLabel,
  validateHeroButtonUrl,
  validateHeroButtonTarget,
  validateHeroMediaReference,
  isSafeHeroButtonUrl,
  HERO_POSITIONS,
  HERO_TITLE_MAX,
  HERO_DESC_MAX,
  HERO_ALT_MAX,
  CATEGORY_DESC_MAX,
  HERO_EYEBROW_MAX,
  HERO_BUTTON_LABEL_MAX,
  HERO_BUTTON_URL_MAX,
  HERO_TARGETS,
  MEDIA_REFERENCE_PATTERN,
  slugify,
  validateProductName,
  validatePrice,
  validateStock,
  validateWeight,
  validateDescription,
  validateTags,
  validateCategoryIds,
  validateImageCount,
  NAME_MAX,
  DESC_MAX,
  TAG_MAX_COUNT,
  TAG_MAX_LENGTH,
  MAX_IMAGES,
  MAX_FILE_SIZE,
};
