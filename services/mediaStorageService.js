/**
 * Media storage + processing service — Phase 11A.
 *
 * Owns every filesystem interaction of the media library: containment-checked
 * path resolution, collision-resistant naming, content-based validation, Sharp
 * derivative generation and GLB header validation. No database access here.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  MEDIA_DIRECTORIES,
  MEDIA_KINDS,
  CATEGORY_KIND,
  CATEGORY_DIRECTORY,
  THUMBNAIL_DIRECTORY,
  MEDIA_CATEGORY_VALUES,
  RASTER_MIME_TYPES,
  RASTER_EXTENSIONS,
  MODEL_MIME_TYPES,
  MODEL_EXTENSIONS,
  SVG_UPLOAD_ENABLED,
  SVG_MIME_TYPE,
  MAX_IMAGE_SIZE,
  MAX_MODEL_SIZE,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  IMAGE_VARIANTS,
} = require('../config/cmsOptions');
const {
  MEDIA_ROOT,
  MEDIA_STORAGE_PREFIX,
  UPLOAD_PUBLIC_ROOT,
  toPosix,
  resolveUploadStoragePath,
  publicUrlForStoragePath,
  storagePathFromPublicUrl,
  storagePathFromAbsolute,
} = require('../config/uploadPaths');

const MEDIA_ROOT_ABS = path.resolve(MEDIA_ROOT);
const FILENAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const GLB_JSON_CHUNK = 0x4e4f534a; // 'JSON'
const MAX_GLB_JSON_CHUNK = 8 * 1024 * 1024;

function mediaRoot() {
  return MEDIA_ROOT_ABS;
}

async function ensureMediaDirectories() {
  await fs.promises.mkdir(MEDIA_ROOT_ABS, { recursive: true });
  for (const directory of MEDIA_DIRECTORIES) {
    await fs.promises.mkdir(path.join(MEDIA_ROOT_ABS, directory), { recursive: true });
  }
}

function categoryDirectory(category) {
  const directory = CATEGORY_DIRECTORY[category];
  if (!directory) throw new Error('La categoría de medio no es válida.');
  return directory;
}

function kindForCategory(category) {
  const kind = CATEGORY_KIND[category];
  if (!kind) throw new Error('La categoría de medio no es válida.');
  return kind;
}

/**
 * Resolve a stored relative path to an absolute one, refusing anything that
 * escapes the media root. Never accepts browser-supplied strings directly.
 */
function inspectStoredPath(storedPath) {
  const raw = String(storedPath || '').trim();
  if (!raw) throw new Error('Ruta de medio inválida.');

  let relative;
  let format = 'canonical';
  if (/^\/uploads\//i.test(toPosix(raw))) {
    relative = storagePathFromPublicUrl(toPosix(raw));
    format = 'public-url';
  } else if (path.isAbsolute(raw) || /^[a-z]:[\\/]/i.test(raw)) {
    relative = storagePathFromAbsolute(raw);
    format = 'absolute-under-upload-root';
  } else {
    relative = toPosix(raw).replace(/^\/+/, '');
  }

  const parts = relative.split('/');
  if (parts.length === 2) {
    relative = `${MEDIA_STORAGE_PREFIX}/${relative}`;
    if (format === 'canonical') format = 'media-root-relative';
  }

  const canonicalParts = relative.split('/');
  if (
    canonicalParts.length !== 3 ||
    canonicalParts[0] !== MEDIA_STORAGE_PREFIX ||
    !MEDIA_DIRECTORIES.includes(canonicalParts[1]) ||
    !FILENAME_PATTERN.test(canonicalParts[2]) ||
    canonicalParts[2].includes('..')
  ) {
    throw new Error('Ruta de medio fuera del almacenamiento permitido.');
  }

  const canonicalPath = canonicalParts.join('/');
  return {
    canonicalPath,
    publicUrl: publicUrlForStoragePath(canonicalPath),
    format,
    isLegacy: format !== 'canonical',
  };
}

function resolveStoragePath(relativePath) {
  return resolveUploadStoragePath(inspectStoredPath(relativePath).canonicalPath);
}

/** Public URL for a stored relative path. Never leaks the filesystem root. */
function publicUrlFor(relativePath) {
  return inspectStoredPath(relativePath).publicUrl;
}

function checksumOf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** category-timestamp-randomhash — original names are metadata only. */
function buildBaseName(category) {
  return `${category}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function sanitizeOriginalName(value) {
  const base = path.basename(String(value || '').replace(/\\/g, '/'));
  return base.replace(/[^\w.\- ()]/g, '').slice(0, 255) || null;
}

function fileBytes(file) {
  if (file?.buffer) return file.buffer;
  throw new Error('No se pudo leer el archivo cargado.');
}

function declaredExtension(file) {
  return path.extname(String(file?.originalname || '')).toLowerCase();
}

/**
 * Content-first validation. Declared MIME and extension must agree with each
 * other and with the decoded bytes.
 */
function assertUploadAllowed(file, category) {
  if (!MEDIA_CATEGORY_VALUES.includes(category)) {
    throw new Error('La categoría de medio no es válida.');
  }
  if (!file || !file.buffer || !file.buffer.length) {
    throw new Error('Debe seleccionar un archivo válido.');
  }

  const mimeType = String(file.mimetype || '').toLowerCase();
  const extension = declaredExtension(file);
  const kind = kindForCategory(category);
  const size = Number(file.size || file.buffer.length);

  if (mimeType === SVG_MIME_TYPE && !SVG_UPLOAD_ENABLED) {
    throw new Error('La carga de SVG está deshabilitada por seguridad en esta fase.');
  }

  if (kind === MEDIA_KINDS.MODEL) {
    if (!MODEL_EXTENSIONS.includes(extension)) {
      throw new Error('Los modelos 3D deben tener extensión .glb.');
    }
    if (!MODEL_MIME_TYPES.has(mimeType)) {
      throw new Error('El tipo de archivo no corresponde a un modelo GLB.');
    }
    if (size > MAX_MODEL_SIZE) {
      throw new Error('El modelo supera el límite de 30 MB.');
    }
    return { kind, mimeType: 'model/gltf-binary', extension: '.glb' };
  }

  if (!RASTER_MIME_TYPES.has(mimeType)) {
    throw new Error('Formato no permitido. Use JPG, PNG o WebP.');
  }
  const allowedExtensions = RASTER_EXTENSIONS[mimeType] || [];
  if (!allowedExtensions.includes(extension)) {
    throw new Error('La extensión del archivo no coincide con su tipo real.');
  }
  if (size > MAX_IMAGE_SIZE) {
    throw new Error('La imagen supera el límite de 15 MB.');
  }
  return { kind, mimeType, extension };
}

/** Decode-time checks: real image, bounded dimensions, not animated. */
async function inspectRaster(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch {
    throw new Error('El archivo no es una imagen válida o está dañado.');
  }
  if (!metadata.width || !metadata.height) {
    throw new Error('El archivo no es una imagen válida o está dañado.');
  }
  if (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION) {
    throw new Error(`La imagen excede el máximo de ${MAX_IMAGE_DIMENSION} × ${MAX_IMAGE_DIMENSION} píxeles.`);
  }
  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new Error('La imagen excede el límite de píxeles permitido.');
  }
  if (Number(metadata.pages || 1) > 1) {
    throw new Error('Las imágenes animadas no son compatibles. Cargue una imagen estática.');
  }
  return metadata;
}

async function renderVariant(buffer, profile) {
  const pipeline = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({
      width: profile.maxWidth,
      height: profile.maxHeight,
      fit: profile.fit,
      withoutEnlargement: profile.withoutEnlargement,
    })
    .webp({ quality: profile.quality });
  const output = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: output.data,
    width: output.info.width,
    height: output.info.height,
    size: output.data.length,
  };
}

/** Writes a new file, never overwriting an existing one. */
async function writeNewFile(relativePath, buffer) {
  const absolute = resolveStoragePath(relativePath);
  await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
  await fs.promises.writeFile(absolute, buffer, { flag: 'wx' });
  return absolute;
}

/** Best-effort cleanup used by every failure path. Never throws. */
async function removeStoredPaths(relativePaths) {
  for (const relativePath of [...new Set((relativePaths || []).filter(Boolean))]) {
    try {
      await fs.promises.unlink(resolveStoragePath(relativePath));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[mediaStorage] No se pudo limpiar un archivo temporal.');
      }
    }
  }
}

async function storedPathExists(relativePath) {
  try {
    await fs.promises.access(resolveStoragePath(relativePath), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a GLB by its binary header and JSON chunk.
 * @returns {{ generator: string|null, version: string|null, meshCount: number|null, nodeCount: number|null }}
 */
function inspectGlb(buffer) {
  if (buffer.length < 20) throw new Error('El archivo GLB está incompleto o dañado.');
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error('El archivo no es un modelo GLB válido.');
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) {
    throw new Error('Solo se admiten modelos GLB versión 2.');
  }
  if (buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error('El encabezado del GLB no coincide con el tamaño del archivo.');
  }
  const chunkLength = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);
  if (chunkType !== GLB_JSON_CHUNK) {
    throw new Error('El modelo GLB no contiene una sección JSON válida.');
  }
  if (!chunkLength || chunkLength > MAX_GLB_JSON_CHUNK || 20 + chunkLength > buffer.length) {
    throw new Error('La sección JSON del modelo GLB no es válida.');
  }
  let parsed;
  try {
    parsed = JSON.parse(buffer.subarray(20, 20 + chunkLength).toString('utf8'));
  } catch {
    throw new Error('La sección JSON del modelo GLB no es válida.');
  }
  return {
    generator: typeof parsed?.asset?.generator === 'string' ? parsed.asset.generator.slice(0, 120) : null,
    version: typeof parsed?.asset?.version === 'string' ? parsed.asset.version.slice(0, 20) : null,
    meshCount: Array.isArray(parsed?.meshes) ? parsed.meshes.length : null,
    nodeCount: Array.isArray(parsed?.nodes) ? parsed.nodes.length : null,
  };
}

/**
 * Validate, process and persist one upload.
 * On any failure every file already written is removed before rethrowing.
 *
 * @returns {Promise<object>} storage descriptor consumed by mediaService
 */
async function storeUpload(file, category) {
  const { kind, mimeType, extension } = assertUploadAllowed(file, category);
  const buffer = fileBytes(file);
  const checksum = checksumOf(buffer);
  const originalName = sanitizeOriginalName(file.originalname);
  const written = [];

  await ensureMediaDirectories();
  const base = buildBaseName(category);

  try {
    if (kind === MEDIA_KINDS.MODEL) {
      const modelMetadata = inspectGlb(buffer);
      const relative = `${MEDIA_STORAGE_PREFIX}/${categoryDirectory(category)}/${base}.glb`;
      await writeNewFile(relative, buffer);
      written.push(relative);
      return {
        kind,
        filename: `${base}.glb`,
        storagePath: relative,
        publicUrl: publicUrlFor(relative),
        thumbnailPath: null,
        variants: {},
        writtenPaths: written,
        mimeType: 'model/gltf-binary',
        extension: '.glb',
        fileSize: buffer.length,
        width: null,
        height: null,
        modelMetadata,
        checksum,
        originalName,
      };
    }

    await inspectRaster(buffer);
    const directory = categoryDirectory(category);

    const large = await renderVariant(buffer, IMAGE_VARIANTS.large);
    const largeRelative = `${MEDIA_STORAGE_PREFIX}/${directory}/${base}.webp`;
    await writeNewFile(largeRelative, large.buffer);
    written.push(largeRelative);

    const medium = await renderVariant(buffer, IMAGE_VARIANTS.medium);
    const mediumRelative = `${MEDIA_STORAGE_PREFIX}/${directory}/${base}-medium.webp`;
    await writeNewFile(mediumRelative, medium.buffer);
    written.push(mediumRelative);

    const thumbnail = await renderVariant(buffer, IMAGE_VARIANTS.thumbnail);
    const thumbnailRelative = `${MEDIA_STORAGE_PREFIX}/${THUMBNAIL_DIRECTORY}/${base}-thumb.webp`;
    await writeNewFile(thumbnailRelative, thumbnail.buffer);
    written.push(thumbnailRelative);

    return {
      kind,
      filename: `${base}.webp`,
      storagePath: largeRelative,
      publicUrl: publicUrlFor(largeRelative),
      thumbnailPath: publicUrlFor(thumbnailRelative),
      variants: {
        medium: {
          storage_path: mediumRelative,
          public_url: publicUrlFor(mediumRelative),
          width: medium.width,
          height: medium.height,
          file_size: medium.size,
        },
        thumbnail: {
          storage_path: thumbnailRelative,
          public_url: publicUrlFor(thumbnailRelative),
          width: thumbnail.width,
          height: thumbnail.height,
          file_size: thumbnail.size,
        },
      },
      writtenPaths: written,
      mimeType: 'image/webp',
      extension: '.webp',
      fileSize: large.size,
      width: large.width,
      height: large.height,
      modelMetadata: null,
      checksum,
      originalName,
      sourceMimeType: mimeType,
      sourceExtension: extension,
    };
  } catch (error) {
    await removeStoredPaths(written);
    throw error;
  }
}

/** Every relative path owned by a stored asset row. */
function ownedPaths(asset) {
  if (!asset) return [];
  const variants = parseVariants(asset.variants_json);
  return [...new Set([
    asset.storage_path,
    asset.thumbnail_path,
    ...Object.values(variants).map((variant) => variant?.storage_path),
  ].filter(Boolean))];
}

function parseVariants(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function resolvedAssetPaths(asset) {
  if (!asset) throw new Error('Activo multimedia inválido.');
  const original = inspectStoredPath(asset.storage_path || asset.public_url);
  const variants = parseVariants(asset.variants_json);
  let thumbnail = null;
  const thumbnailSource = variants.thumbnail?.storage_path || asset.thumbnail_path;
  if (thumbnailSource) {
    try {
      thumbnail = inspectStoredPath(thumbnailSource);
    } catch {
      thumbnail = null;
    }
  }
  return {
    storagePath: original.canonicalPath,
    publicUrl: original.publicUrl,
    thumbnailStoragePath: thumbnail?.canonicalPath || null,
    thumbnailUrl: thumbnail?.publicUrl || null,
    originalFormat: original.format,
    isLegacy: original.isLegacy || Boolean(thumbnail?.isLegacy),
  };
}

module.exports = {
  UPLOAD_PUBLIC_ROOT,
  MEDIA_ROOT_ABS,
  mediaRoot,
  ensureMediaDirectories,
  categoryDirectory,
  kindForCategory,
  inspectStoredPath,
  resolveStoragePath,
  publicUrlFor,
  checksumOf,
  buildBaseName,
  sanitizeOriginalName,
  assertUploadAllowed,
  inspectRaster,
  inspectGlb,
  renderVariant,
  writeNewFile,
  removeStoredPaths,
  storedPathExists,
  storeUpload,
  ownedPaths,
  parseVariants,
  resolvedAssetPaths,
};
