/**
 * Media library validators — Phase 11A.
 *
 * Server-side only. Storage fields (storage_path, filename, checksum,
 * mime_type, file_size, created_by) are never accepted from a request body.
 */
const {
  MEDIA_CATEGORY_VALUES,
  MEDIA_STATUS_VALUES,
  EDITABLE_MEDIA_STATUSES,
  MEDIA_KINDS,
  TITLE_MAX_LENGTH,
  ALT_TEXT_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  MEDIA_PAGE_SIZE,
  MAX_MEDIA_PAGE_SIZE,
} = require('../config/cmsOptions');

/** Fields a client may never set directly. */
const IMMUTABLE_FIELDS = Object.freeze([
  'storage_path',
  'storagePath',
  'filename',
  'checksum',
  'mime_type',
  'mimeType',
  'file_size',
  'fileSize',
  'created_by',
  'createdBy',
  'public_url',
  'publicUrl',
  'public_id',
  'publicId',
]);

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

function validateCategory(value) {
  const category = String(value || '').trim();
  if (!MEDIA_CATEGORY_VALUES.includes(category)) {
    return { valid: false, error: 'Seleccione una categoría de medio válida.' };
  }
  return { valid: true, value: category };
}

/**
 * Upload metadata. Alt text may be empty only when the image is explicitly
 * marked as decorative.
 */
function validateUploadMetadata(body = {}) {
  const category = validateCategory(body.category);
  if (!category.valid) return category;

  const title = boundedText(body.title, 'El título', TITLE_MAX_LENGTH);
  if (!title.valid) return title;

  const altText = boundedText(body.altText, 'El texto alternativo', ALT_TEXT_MAX_LENGTH);
  if (!altText.valid) return altText;

  const description = boundedText(body.description, 'La descripción', DESCRIPTION_MAX_LENGTH);
  if (!description.valid) return description;

  const decorative = body.decorative === '1' || body.decorative === true;
  const isModel = category.value === 'model';
  if (!altText.value && !decorative && !isModel) {
    return {
      valid: false,
      error: 'Agregue un texto alternativo o marque la imagen como decorativa.',
    };
  }

  return {
    valid: true,
    value: {
      category: category.value,
      title: title.value || null,
      altText: altText.value,
      description: description.value || null,
      decorative,
    },
  };
}

/** Metadata edit. Only title, alt text, description, category and status. */
function validateMetadataUpdate(body = {}) {
  const submittedImmutable = IMMUTABLE_FIELDS.filter((field) => body[field] !== undefined);
  if (submittedImmutable.length) {
    return { valid: false, error: 'Los datos de almacenamiento del archivo no son editables.' };
  }

  const base = validateUploadMetadata(body);
  if (!base.valid) return base;

  const status = String(body.status || '').trim();
  if (status && !EDITABLE_MEDIA_STATUSES.includes(status)) {
    return { valid: false, error: 'El estado seleccionado no es válido.' };
  }

  return { valid: true, value: { ...base.value, status: status || null } };
}

function parseLibraryFilters(query = {}) {
  const search = String(query.search || '').trim().slice(0, SEARCH_MAX_LENGTH);
  const rawCategory = String(query.category || '').trim();
  const category = MEDIA_CATEGORY_VALUES.includes(rawCategory) ? rawCategory : '';
  const rawKind = String(query.kind || '').trim();
  const kind = Object.values(MEDIA_KINDS).includes(rawKind) ? rawKind : '';
  const rawStatus = String(query.status || '').trim();
  const status = MEDIA_STATUS_VALUES.includes(rawStatus) ? rawStatus : '';
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requestedLimit = Number.parseInt(query.limit, 10) || MEDIA_PAGE_SIZE;
  const limit = Math.min(MAX_MEDIA_PAGE_SIZE, Math.max(1, requestedLimit));
  return { search, category, kind, status, page, limit };
}

module.exports = {
  IMMUTABLE_FIELDS,
  boundedText,
  validateCategory,
  validateUploadMetadata,
  validateMetadataUpdate,
  parseLibraryFilters,
};
