/**
 * CMS field-level diff engine — Phase 1C.
 *
 * Compares two revision snapshots and returns human-readable field changes.
 * Recursively diffs nested objects, detects array reorders/content changes
 * via stable IDs, resolves media references, and translates internal keys.
 */
const pool = require('../config/db');

// ── Spanish field label registry ──
const FIELD_LABELS = Object.freeze({
  // Universal
  status: 'Estado',
  is_enabled: 'Habilitado',
  is_visible: 'Visible',
  sort_order: 'Orden',
  public_id: 'ID público',
  created_at: 'Fecha de creación',
  updated_at: 'Fecha de actualización',
  deleted_at: 'Fecha de eliminación',
  published_at: 'Fecha de publicación',

  // Site settings
  setting_key: 'Clave de configuración',
  setting_value: 'Valor',
  published_value: 'Valor publicado',
  value_type: 'Tipo de valor',

  // Page sections
  content_json: 'Contenido (JSON)',
  style_json: 'Estilo (JSON)',
  name: 'Nombre',
  section_key: 'Identificador de sección',
  page_id: 'Página',
  published_content_json: 'Contenido publicado',
  published_style_json: 'Estilo publicado',

  // Navigation items
  label: 'Etiqueta',
  url: 'URL',
  link_type: 'Tipo de enlace',
  target: 'Destino',
  media_public_id: 'Icono',
  location: 'Ubicación',
  parent_id: 'Padre',
  published_data: 'Datos publicados',

  // Repeatable items
  title: 'Título',
  description: 'Descripción',
  detail_text: 'Texto detallado',
  button_label: 'Texto del botón',
  button_url: 'URL del botón',
  button_target: 'Destino del botón',
  eyebrow: 'Texto superior',
  heading: 'Encabezado',
  alt_text: 'Texto alternativo',
  theme_key: 'Tema visual',
  item_type: 'Tipo de elemento',
  text_content: 'Contenido de texto',
  icon_type: 'Tipo de icono',
  icon_key: 'Clave de icono',
  style_variant: 'Variante de estilo',

  // Social items
  platform: 'Plataforma',
  profile_url: 'URL de perfil',
  aria_label: 'Etiqueta accesible',

  // Media
  public_url: 'URL pública',
  filename: 'Nombre de archivo',
  original_name: 'Nombre original',
  storage_path: 'Ruta de almacenamiento',
  thumbnail_path: 'Miniatura',
  mime_type: 'Tipo MIME',
  extension: 'Extensión',
  file_size: 'Tamaño',
  width: 'Ancho',
  height: 'Alto',
  checksum: 'Checksum',
  category: 'Categoría',

  // Carousel/media
  media_alt: 'Texto alternativo de imagen',
  preview_media_public_id: 'Imagen de preview',
  preview_media_alt: 'Texto alternativo de preview',
  link_aria_label: 'Etiqueta de enlace',
  custom_cover_path: 'Portada personalizada',
  youtube_url: 'URL de YouTube',
  media_type: 'Tipo de medio',
  media_path: 'Archivo',

  // Generic
  id: 'ID',
  items: 'Elementos',
});

/**
 * Resolve a media public_id to a display label.
 */
async function resolveMediaLabel(mediaPublicId) {
  if (!mediaPublicId) return null;
  try {
    const [[row]] = await pool.query(
      `SELECT title, filename, public_url FROM media_assets WHERE public_id = ? LIMIT 1`,
      [mediaPublicId]
    );
    if (!row) return mediaPublicId;
    return row.title || row.filename || row.public_url || mediaPublicId;
  } catch {
    return mediaPublicId;
  }
}

/**
 * Resolve media references in a value recursively.
 */
async function resolveMediaReferences(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(v => resolveMediaReferences(v)));
  }
  const result = { ...obj };
  for (const [key, val] of Object.entries(result)) {
    if (typeof val === 'string' && val.startsWith('media://')) {
      result[key] = await resolveMediaLabel(val.replace('media://', ''));
    } else if (typeof val === 'object' && val !== null) {
      result[key] = await resolveMediaReferences(val);
    }
  }
  return result;
}

function labelFor(key) {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ');
}

function formatValue(val, truncateAt = 150) {
  if (val === null || val === undefined) return '(vacío)';
  if (typeof val === 'boolean') return val ? 'Sí' : 'No';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') {
    const s = JSON.stringify(val);
    if (s.length <= truncateAt) return s;
    return s.slice(0, truncateAt) + '…';
  }
  const s = String(val);
  if (s.length <= truncateAt) return s;
  return s.slice(0, truncateAt) + '…';
}

function changeType(oldVal, newVal) {
  if (oldVal === undefined || oldVal === null) return 'added';
  if (newVal === undefined || newVal === null) return 'removed';
  return 'changed';
}

/**
 * Determine if two arrays are a reorder of the same elements.
 * Uses public_id or id as stable identifier.
 */
function detectReorder(oldArr, newArr) {
  if (!Array.isArray(oldArr) || !Array.isArray(newArr)) return false;
  if (oldArr.length !== newArr.length) return false;
  const getId = (item) => item?.public_id || item?.id || JSON.stringify(item);
  const oldIds = oldArr.map(getId).join(',');
  const newIds = newArr.map(getId).join(',');
  return oldIds !== newIds;
}

/**
 * Compare two objects field by field. Returns an array of change descriptors.
 * @param {object|null} prev - Previous snapshot
 * @param {object|null} curr - Current snapshot
 * @param {string} prefix - Key prefix for nested paths
 * @returns {Array<{field, label, oldValue, newValue, type, nested}>}
 */
async function diffFields(prev, curr, prefix = '') {
  const changes = [];
  const prevObj = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? prev : {};
  const currObj = (curr && typeof curr === 'object' && !Array.isArray(curr)) ? curr : {};
  const allKeys = new Set([...Object.keys(prevObj), ...Object.keys(currObj)]);

  for (const key of allKeys) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const oldVal = prevObj[key];
    const newVal = currObj[key];

    // Skip internal/tracking columns
    if (['created_at', 'updated_at', 'deleted_at', 'published_at', 'id', 'revision_number', 'page_section_id', 'changed_by', 'created_by', 'updated_by'].includes(key)) {
      continue;
    }

    // Deep compare objects
    if (
      oldVal && newVal
      && typeof oldVal === 'object' && typeof newVal === 'object'
      && !Array.isArray(oldVal) && !Array.isArray(newVal)
    ) {
      // Recurse into nested objects
      const nested = await diffFields(oldVal, newVal, fullKey);
      changes.push(...nested);
      continue;
    }

    // Handle arrays with stable IDs
    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      if (checkArrayIdentical(oldVal, newVal)) continue;

      if (detectReorder(oldVal, newVal)) {
        const getId = (item) => item?.public_id || item?.id || JSON.stringify(item);
        const oldIds = oldVal.map(getId);
        const newIds = newVal.map(getId);
        if (oldIds.join(',') !== newIds.join(',')) {
          changes.push({
            field: fullKey, label: labelFor(key),
            oldValue: JSON.stringify(oldIds), newValue: JSON.stringify(newIds),
            type: 'reordered', nested: null,
          });
        }
      } else {
        changes.push({
          field: fullKey, label: labelFor(key),
          oldValue: formatValue(oldVal), newValue: formatValue(newVal),
          type: 'changed', nested: null,
        });
      }
      continue;
    }

    // Scalar comparison
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      // Resolve media references in display
      const oldDisplay = typeof oldVal === 'string' && oldVal.startsWith('media://')
        ? await resolveMediaLabel(oldVal.replace('media://', ''))
        : formatValue(oldVal);
      const newDisplay = typeof newVal === 'string' && newVal.startsWith('media://')
        ? await resolveMediaLabel(newVal.replace('media://', ''))
        : formatValue(newVal);

      changes.push({
        field: fullKey,
        label: labelFor(key),
        oldValue: oldDisplay,
        newValue: newDisplay,
        type: changeType(oldVal, newVal),
        nested: null,
      });
    }
  }

  return changes;
}

function checkArrayIdentical(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Diff two snapshots and return a summary string.
 */
async function generateSummary(prev, curr) {
  const changes = await diffFields(prev, curr);
  if (!changes.length) return 'Sin cambios detectados.';

  const added = changes.filter(c => c.type === 'added').length;
  const changed = changes.filter(c => c.type === 'changed').length;
  const removed = changes.filter(c => c.type === 'removed').length;
  const reordered = changes.filter(c => c.type === 'reordered').length;

  const parts = [];
  if (changed) parts.push(`${changed} campo${changed !== 1 ? 's' : ''} modificado${changed !== 1 ? 's' : ''}`);
  if (added) parts.push(`${added} agregado${added !== 1 ? 's' : ''}`);
  if (removed) parts.push(`${removed} eliminado${removed !== 1 ? 's' : ''}`);
  if (reordered) parts.push(`reordenado`);

  return parts.join(', ') || 'Sin cambios';
}

module.exports = {
  diffFields,
  generateSummary,
  resolveMediaLabel,
  resolveMediaReferences,
  labelFor,
  formatValue,
  FIELD_LABELS,
};
