const {
  MEDIA_TYPES,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  ALT_TEXT_MAX_LENGTH,
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  DEFAULT_PAGE_SIZE,
  ADMIN_PAGE_SIZE,
  MAX_PAGE_SIZE,
} = require('../config/galleryOptions');
const {
  normalizePosition,
  normalizeZoom,
  DEFAULT_POSITION,
  DEFAULT_ZOOM,
} = require('../public/js/admin/carousel-image-position');

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function boundedText(value, field, max, { required = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) {
    return { valid: false, error: `${field} es obligatorio.`, value: '' };
  }
  if (normalized.length > max) {
    return { valid: false, error: `${field} no debe exceder ${max} caracteres.`, value: normalized.slice(0, max) };
  }
  return { valid: true, value: normalized || null };
}

function positiveId(value, { nullable = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw && nullable) return { valid: true, value: null };
  if (!/^[1-9]\d*$/.test(raw)) return { valid: false, error: 'Identificador inválido.', value: null };
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return { valid: false, error: 'Identificador inválido.', value: null };
  return { valid: true, value: id };
}

function sortOrder(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true, value: 0 };
  if (!/^-?\d+$/.test(raw)) return { valid: false, error: 'El orden debe ser un número entero.', value: 0 };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < -100000 || parsed > 100000) {
    return { valid: false, error: 'El orden está fuera del rango permitido.', value: 0 };
  }
  return { valid: true, value: parsed };
}

function framingAxis(value, fieldLabel, fallback = DEFAULT_POSITION) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { valid: true, value: fallback };
  }
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    return { valid: false, error: `${fieldLabel} debe ser un número entero.`, value: fallback };
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return { valid: false, error: `${fieldLabel} debe ser un número entero.`, value: fallback };
  }
  if (!Number.isInteger(numeric)) {
    return { valid: false, error: `${fieldLabel} debe ser un número entero.`, value: fallback };
  }
  if (numeric < 0 || numeric > 100) {
    return { valid: false, error: `${fieldLabel} debe estar entre 0 y 100.`, value: fallback };
  }
  return { valid: true, value: normalizePosition(numeric, fallback) };
}

function framingZoom(value, fallback = DEFAULT_ZOOM) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { valid: true, value: fallback };
  }
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    return { valid: false, error: 'El zoom de la miniatura debe ser un número entero.', value: fallback };
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    return { valid: false, error: 'El zoom de la miniatura debe ser un número entero.', value: fallback };
  }
  if (numeric < 100 || numeric > 200) {
    return { valid: false, error: 'El zoom de la miniatura debe estar entre 100 y 200.', value: fallback };
  }
  return { valid: true, value: normalizeZoom(numeric, fallback) };
}

function booleanField(value) {
  return value === '1' || value === 1 || value === true || value === 'true';
}

function validateCategory(body = {}) {
  const name = boundedText(body.name, 'El nombre', 120, { required: true });
  const description = boundedText(body.description, 'La descripción', CATEGORY_DESCRIPTION_MAX_LENGTH);
  const order = sortOrder(body.sortOrder);
  const firstError = [name, description, order].find((result) => !result.valid);
  if (firstError) return firstError;
  const slug = slugify(name.value);
  if (!slug) return { valid: false, error: 'El nombre no produce una URL válida.' };
  return {
    valid: true,
    value: {
      name: name.value,
      slug,
      description: description.value,
      sortOrder: order.value,
      isActive: booleanField(body.isActive),
    },
  };
}

function validateItem(body = {}, availableCategoryIds = []) {
  const title = boundedText(body.title, 'El título', TITLE_MAX_LENGTH, { required: true });
  const description = boundedText(body.description, 'La descripción', DESCRIPTION_MAX_LENGTH);
  const altText = boundedText(body.altText, 'El texto alternativo', ALT_TEXT_MAX_LENGTH, { required: true });
  const mediaType = String(body.mediaType || '');
  const category = positiveId(body.categoryId, { nullable: true });
  const positionX = framingAxis(body.thumbnailPositionX, 'La posición horizontal');
  const positionY = framingAxis(body.thumbnailPositionY, 'La posición vertical');
  const zoom = framingZoom(body.thumbnailZoomPercent);
  const firstError = [title, description, altText, category, positionX, positionY, zoom]
    .find((result) => !result.valid);
  if (firstError) return firstError;
  if (!Object.values(MEDIA_TYPES).includes(mediaType)) {
    return { valid: false, error: 'El tipo de medio debe ser imagen, video o YouTube.' };
  }
  if (mediaType === MEDIA_TYPES.YOUTUBE) {
    const youtubeUrl = String(body.youtubeUrl || '').trim();
    if (!youtubeUrl) {
      return { valid: false, error: 'La URL de YouTube es obligatoria para videos de YouTube.' };
    }
    if (youtubeUrl.length > 500) {
      return { valid: false, error: 'La URL de YouTube no debe exceder 500 caracteres.' };
    }
  }
  if (category.value !== null && !availableCategoryIds.includes(category.value)) {
    return { valid: false, error: 'La categoría seleccionada no es válida.' };
  }
  const slug = slugify(title.value);
  if (!slug) return { valid: false, error: 'El título no produce una URL válida.' };
  return {
    valid: true,
    value: {
      categoryId: category.value,
      title: title.value,
      slug,
      description: description.value,
      mediaType,
      youtubeUrl: mediaType === MEDIA_TYPES.YOUTUBE ? String(body.youtubeUrl || '').trim() : null,
      altText: altText.value,
      thumbnailPositionX: positionX.value,
      thumbnailPositionY: positionY.value,
      thumbnailZoomPercent: zoom.value,
      isFeatured: booleanField(body.isFeatured),
      isPublished: booleanField(body.isPublished),
    },
  };
}

function parsePublicFilters(query = {}) {
  const category = slugify(String(query.categoria || '').slice(0, 180));
  const type = Object.values(MEDIA_TYPES).includes(String(query.tipo || '')) ? String(query.tipo) : '';
  const view = ['grid', 'infinite'].includes(String(query.view || '')) ? String(query.view) : 'infinite';
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requestedLimit = Number.parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedLimit));
  return { category, type, view, page, limit };
}

function parseAdminFilters(query = {}) {
  const search = String(query.search || '').trim().slice(0, 100);
  const categoryId = positiveId(query.category, { nullable: true }).value;
  const mediaType = Object.values(MEDIA_TYPES).includes(String(query.type || '')) ? String(query.type) : '';
  const published = ['published', 'draft'].includes(String(query.published || '')) ? String(query.published) : '';
  const featured = ['featured', 'standard'].includes(String(query.featured || '')) ? String(query.featured) : '';
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  return { search, categoryId, mediaType, published, featured, page, limit: ADMIN_PAGE_SIZE };
}

module.exports = {
  slugify,
  boundedText,
  positiveId,
  sortOrder,
  framingAxis,
  framingZoom,
  booleanField,
  validateCategory,
  validateItem,
  parsePublicFilters,
  parseAdminFilters,
};
