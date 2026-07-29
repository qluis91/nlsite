/**
 * CMS ("Administrar página") shared options — Phase 11A.
 *
 * Central allowlists, limits and storage layout for the media library.
 * Storage roots derive from UPLOAD_PUBLIC_DIR so Railway's persistent volume
 * is honored without hardcoding any deployment path.
 */
const sharp = require('sharp');
const {
  UPLOAD_PUBLIC_ROOT,
  MEDIA_ROOT,
  UPLOAD_PUBLIC_URL_PREFIX,
} = require('./uploadPaths');

const MEDIA_CATEGORIES = Object.freeze({
  SITE: 'site',
  GALLERY: 'gallery',
  LOGO: 'logo',
  CAROUSEL: 'carousel',
  ICON: 'icon',
  MODEL: 'model',
  OTHER: 'other',
});

const MEDIA_CATEGORY_VALUES = Object.freeze(Object.values(MEDIA_CATEGORIES));

const MEDIA_CATEGORY_LABELS = Object.freeze({
  site: 'Sitio',
  gallery: 'Galería',
  logo: 'Logotipo',
  carousel: 'Carrusel',
  icon: 'Icono',
  model: 'Modelo 3D',
  other: 'Otro',
});

const MEDIA_STATUSES = Object.freeze({
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  PROCESSING: 'processing',
  FAILED: 'failed',
});

const MEDIA_STATUS_VALUES = Object.freeze(Object.values(MEDIA_STATUSES));

const MEDIA_STATUS_LABELS = Object.freeze({
  active: 'Activo',
  archived: 'Archivado',
  processing: 'Procesando',
  failed: 'Fallido',
});

/** Editable statuses from the admin metadata form. */
const EDITABLE_MEDIA_STATUSES = Object.freeze([MEDIA_STATUSES.ACTIVE, MEDIA_STATUSES.ARCHIVED]);

const MEDIA_KINDS = Object.freeze({
  IMAGE: 'image',
  MODEL: 'model',
});

/** Category → media kind. Determines validation and processing pipeline. */
const CATEGORY_KIND = Object.freeze({
  site: MEDIA_KINDS.IMAGE,
  gallery: MEDIA_KINDS.IMAGE,
  logo: MEDIA_KINDS.IMAGE,
  carousel: MEDIA_KINDS.IMAGE,
  icon: MEDIA_KINDS.IMAGE,
  model: MEDIA_KINDS.MODEL,
  other: MEDIA_KINDS.IMAGE,
});

/** Category → storage subdirectory beneath the media root. */
const CATEGORY_DIRECTORY = Object.freeze({
  site: 'site',
  gallery: 'gallery',
  logo: 'logos',
  carousel: 'carousel',
  icon: 'icons',
  model: 'models',
  other: 'other',
});

const THUMBNAIL_DIRECTORY = 'thumbnails';

const MEDIA_DIRECTORIES = Object.freeze([
  ...new Set([...Object.values(CATEGORY_DIRECTORY), THUMBNAIL_DIRECTORY]),
]);

/**
 * AVIF input is only accepted when the installed Sharp runtime can decode it.
 * Probed once at load; never assumed.
 */
function avifInputSupported() {
  try {
    return Boolean(sharp.format?.heif?.input?.buffer || sharp.format?.avif?.input?.buffer);
  } catch {
    return false;
  }
}

const AVIF_SUPPORTED = avifInputSupported();

const RASTER_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  ...(AVIF_SUPPORTED ? ['image/avif'] : []),
]);

const RASTER_EXTENSIONS = Object.freeze({
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/avif': ['.avif'],
});

const MODEL_MIME_TYPES = new Set([
  'model/gltf-binary',
  // Browsers frequently send a generic type for .glb; the binary header is the
  // authoritative check, never the declared MIME alone.
  'application/octet-stream',
]);

const MODEL_EXTENSIONS = Object.freeze(['.glb']);

/**
 * SVG stays disabled in Phase 11A: no vetted sanitizer dependency is installed
 * and custom sanitization would be unsafe. Documented, not silently ignored.
 */
const SVG_UPLOAD_ENABLED = false;
const SVG_MIME_TYPE = 'image/svg+xml';
const MAX_SVG_SIZE = 2 * 1024 * 1024;

const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_MODEL_SIZE = 30 * 1024 * 1024;
const MAX_UPLOAD_SIZE = Math.max(MAX_IMAGE_SIZE, MAX_MODEL_SIZE);
const MAX_FILES_PER_REQUEST = 10;
const MAX_IMAGE_DIMENSION = 10000;
/** Decompression-bomb ceiling for decoded pixels. */
const MAX_IMAGE_PIXELS = 100 * 1000 * 1000;
/** Bounded Sharp concurrency for multi-file uploads. */
const UPLOAD_CONCURRENCY = 2;

const TITLE_MAX_LENGTH = 150;
const ALT_TEXT_MAX_LENGTH = 250;
const DESCRIPTION_MAX_LENGTH = 2000;
const SEARCH_MAX_LENGTH = 100;
const MEDIA_PAGE_SIZE = 24;
const MAX_MEDIA_PAGE_SIZE = 48;

const IMAGE_VARIANTS = Object.freeze({
  large: Object.freeze({
    key: 'large',
    maxWidth: 2560,
    maxHeight: 2560,
    quality: 80,
    format: 'webp',
    fit: 'inside',
    withoutEnlargement: true,
  }),
  medium: Object.freeze({
    key: 'medium',
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 80,
    format: 'webp',
    fit: 'inside',
    withoutEnlargement: true,
  }),
  thumbnail: Object.freeze({
    key: 'thumbnail',
    maxWidth: 400,
    maxHeight: 400,
    quality: 80,
    format: 'webp',
    fit: 'inside',
    withoutEnlargement: true,
  }),
});

/** Root of every publicly served upload (env-driven, never hardcoded). */
/** Media library lives in its own namespace so Gallery remains independent. */
const MEDIA_PUBLIC_PREFIX = `${UPLOAD_PUBLIC_URL_PREFIX}media/`;

/** Page/section publication states, distinct from media statuses. */
const CONTENT_STATUSES = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
});

const CONTENT_STATUS_VALUES = Object.freeze(Object.values(CONTENT_STATUSES));

const REVISION_ENTITY_TYPES = Object.freeze({
  MEDIA_ASSET: 'media_asset',
  PAGE: 'page',
  PAGE_SECTION: 'page_section',
  SITE_SETTING: 'site_setting',
  NAVIGATION_ITEM: 'navigation_item',
  LOGO_LOOP_ITEM: 'logo_loop_item',
  CAROUSEL_ITEM: 'carousel_item',
  FEATURE_ITEM: 'feature_item',
  SOCIAL_ITEM: 'social_item',
});

const REVISION_ACTIONS = Object.freeze({
  UPLOAD: 'upload',
  METADATA_EDIT: 'metadata_edit',
  REPLACE: 'replace',
  ARCHIVE: 'archive',
  RESTORE: 'restore',
  PERMANENT_DELETE: 'permanent_delete',
  SELECTOR_UPLOAD: 'selector_upload',
  PUBLISH: 'publish',
  REORDER: 'reorder',
  ACTIVATE: 'activate',
  DEACTIVATE: 'deactivate',
});

/** Direct-upload profiles for the visual media selector — Phase 11C-S. */
const UPLOAD_PROFILES = Object.freeze({
  'navbar-logo': Object.freeze({
    field: 'navbar-logo',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'logo',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Logo del navbar',
  }),
  'navbar-light': Object.freeze({
    field: 'navbar-light',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'logo',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Logo claro',
  }),
  'navbar-dark': Object.freeze({
    field: 'navbar-dark',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'logo',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Logo oscuro',
  }),
  'favicon': Object.freeze({
    field: 'favicon',
    allowedMimeTypes: ['image/png','image/jpeg','image/webp'],
    category: 'logo',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Favicon',
  }),
  'hero-background': Object.freeze({
    field: 'hero-background',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'site',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Fondo del hero',
  }),
  'hero-model': Object.freeze({
    field: 'hero-model',
    allowedMimeTypes: ['model/gltf-binary','application/octet-stream'],
    category: 'model',
    maxSize: 30 * 1024 * 1024,
    kind: 'model',
    label: 'Modelo 3D',
  }),
  'hero-fallback': Object.freeze({
    field: 'hero-fallback',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'site',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Imagen de respaldo',
  }),
  'logo-loop': Object.freeze({
    field: 'logo-loop',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'logo',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'LogoLoop',
  }),
  'carousel-main': Object.freeze({
    field: 'carousel-main',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'carousel',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Imagen de carrusel',
  }),
  'carousel-preview': Object.freeze({
    field: 'carousel-preview',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'carousel',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Preview de carrusel',
  }),
  'feature-icon': Object.freeze({
    field: 'feature-icon',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'icon',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Icono de tarjeta',
  }),
  'nav-item-icon': Object.freeze({
    field: 'nav-item-icon',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'icon',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Icono de navegación',
  }),
  'gallery': Object.freeze({
    field: 'gallery',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'gallery',
    maxSize: 15 * 1024 * 1024,
    kind: 'image',
    label: 'Imagen de galería',
  }),
  'product': Object.freeze({
    field: 'product',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'gallery',
    maxSize: 10 * 1024 * 1024,
    kind: 'image',
    label: 'Imagen de producto',
  }),
  'category': Object.freeze({
    field: 'category',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'gallery',
    maxSize: 10 * 1024 * 1024,
    kind: 'image',
    label: 'Imagen de categoría',
  }),
  'avatar': Object.freeze({
    field: 'avatar',
    allowedMimeTypes: ['image/jpeg','image/png','image/webp'],
    category: 'other',
    maxSize: 2 * 1024 * 1024,
    kind: 'image',
    label: 'Avatar de usuario',
  }),
});

const UPLOAD_PROFILE_VALUES = Object.freeze(Object.values(UPLOAD_PROFILES));
const UPLOAD_PROFILE_KEYS = Object.freeze(Object.keys(UPLOAD_PROFILES));

module.exports = {
  MEDIA_CATEGORIES,
  MEDIA_CATEGORY_VALUES,
  MEDIA_CATEGORY_LABELS,
  MEDIA_STATUSES,
  MEDIA_STATUS_VALUES,
  MEDIA_STATUS_LABELS,
  EDITABLE_MEDIA_STATUSES,
  MEDIA_KINDS,
  CATEGORY_KIND,
  CATEGORY_DIRECTORY,
  THUMBNAIL_DIRECTORY,
  MEDIA_DIRECTORIES,
  AVIF_SUPPORTED,
  RASTER_MIME_TYPES,
  RASTER_EXTENSIONS,
  MODEL_MIME_TYPES,
  MODEL_EXTENSIONS,
  SVG_UPLOAD_ENABLED,
  SVG_MIME_TYPE,
  MAX_SVG_SIZE,
  MAX_IMAGE_SIZE,
  MAX_MODEL_SIZE,
  MAX_UPLOAD_SIZE,
  MAX_FILES_PER_REQUEST,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  UPLOAD_CONCURRENCY,
  TITLE_MAX_LENGTH,
  ALT_TEXT_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  SEARCH_MAX_LENGTH,
  MEDIA_PAGE_SIZE,
  MAX_MEDIA_PAGE_SIZE,
  IMAGE_VARIANTS,
  UPLOAD_PUBLIC_ROOT,
  MEDIA_ROOT,
  MEDIA_PUBLIC_PREFIX,
  CONTENT_STATUSES,
  CONTENT_STATUS_VALUES,
  REVISION_ENTITY_TYPES,
  REVISION_ACTIONS,
  UPLOAD_PROFILES,
  UPLOAD_PROFILE_VALUES,
  UPLOAD_PROFILE_KEYS,
};
