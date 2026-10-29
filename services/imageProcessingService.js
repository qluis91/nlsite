/**
 * Centralized image processing service using Sharp.
 * All image uploads in the project route through this service
 * (except CMS media library variants, which use mediaStorageService).
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  PUBLIC_IMAGE_SOURCE_MAX_BYTES,
  PUBLIC_IMAGE_WEBP_QUALITY,
  PUBLIC_IMAGE_MAX_DIMENSION,
  PUBLIC_IMAGE_MAX_PIXELS,
  PUBLIC_IMAGE_BATCH_MAX_BYTES,
  PUBLIC_IMAGE_BATCH_MAX_MB,
  PUBLIC_IMAGE_SOURCE_MAX_MB,
  AVATAR_SOURCE_MAX_BYTES,
  AVATAR_SOURCE_MAX_MB,
} = require('../config/imageUploadPolicy');

// ── Configuration ──
const UPLOAD_ROOT = process.env.UPLOAD_PUBLIC_DIR || path.join(__dirname, '..', 'public', 'uploads');
const DEFAULT_PROFILE = {
  maxWidth: 1800,
  maxHeight: 1800,
  quality: PUBLIC_IMAGE_WEBP_QUALITY,
  format: 'webp',
};
/** @deprecated Prefer PUBLIC_IMAGE_SOURCE_MAX_BYTES — kept for existing imports. */
const MAX_FILE_SIZE = PUBLIC_IMAGE_SOURCE_MAX_BYTES;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

// ── Profiles ──
const PROFILES = {
  product: {
    maxWidth: 1800,
    maxHeight: 1800,
    quality: PUBLIC_IMAGE_WEBP_QUALITY,
    format: 'webp',
  },
  avatar: {
    maxWidth: 512,
    maxHeight: 512,
    quality: PUBLIC_IMAGE_WEBP_QUALITY,
    format: 'webp',
    fit: 'cover',
    position: 'attention',
    withoutEnlargement: false,
  },
  gallery: {
    maxWidth: 2400,
    maxHeight: 1600,
    quality: PUBLIC_IMAGE_WEBP_QUALITY,
    format: 'webp',
  },
  category: {
    maxWidth: 1200,
    maxHeight: 800,
    quality: PUBLIC_IMAGE_WEBP_QUALITY,
    format: 'webp',
  },
  carousel: {
    maxWidth: 2560,
    maxHeight: 2560,
    quality: PUBLIC_IMAGE_WEBP_QUALITY,
    format: 'webp',
  },
  icon: {
    maxWidth: 800,
    maxHeight: 800,
    quality: PUBLIC_IMAGE_WEBP_QUALITY,
    format: 'webp',
  },
};

/**
 * Validate a file buffer/object before processing.
 * @param {{ buffer?: Buffer, mimetype?: string, size?: number, path?: string }} file
 * @param {{ maxBytes?: number, sizeLabel?: string }} [options]
 * @returns {{ valid: boolean, error?: string }}
 */
function validateImageFile(file, options = {}) {
  if (!file) return { valid: false, error: 'No se recibió ningún archivo.' };
  const maxBytes = options.maxBytes ?? PUBLIC_IMAGE_SOURCE_MAX_BYTES;
  const sizeLabel = options.sizeLabel
    || `${Math.round(maxBytes / (1024 * 1024))} MB`;
  const size = Number(file.size || file.buffer?.length || 0);
  if (size && size > maxBytes) {
    return { valid: false, error: `Cada imagen debe pesar menos de ${sizeLabel}.` };
  }
  const mimetype = file.mimetype || '';
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    return { valid: false, error: `Formato no permitido: ${mimetype}. Use JPEG, PNG, WebP o AVIF.` };
  }
  return { valid: true };
}

/**
 * Reject multi-file public uploads whose combined source size exceeds the batch cap.
 * @param {Record<string, Array>|Array|null|undefined} filesByField
 */
function assertPublicImageBatchWithinLimit(filesByField) {
  if (!filesByField) return;
  const files = Array.isArray(filesByField)
    ? filesByField
    : Object.values(filesByField).flatMap((list) => (Array.isArray(list) ? list : []));
  const total = files.reduce(
    (sum, file) => sum + Number(file?.size || file?.buffer?.length || 0),
    0
  );
  if (total > PUBLIC_IMAGE_BATCH_MAX_BYTES) {
    throw new Error(
      `El conjunto de imágenes supera el límite total permitido de ${PUBLIC_IMAGE_BATCH_MAX_MB} MB.`
    );
  }
}

/**
 * Generate a unique server-side filename.
 * @param {string} ext — file extension (without dot)
 * @returns {string}
 */
function uniqueFileName(ext = 'webp') {
  return crypto.randomUUID() + '.' + ext;
}

/**
 * Ensure a directory exists, creating it recursively.
 * @param {string} dir
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get the absolute storage path and public URL path for a product.
 * @param {number|string} productId
 * @returns {{ dir: string, urlPrefix: string }}
 */
function productStoragePath(productId) {
  const dir = path.join(UPLOAD_ROOT, 'products', String(productId));
  const urlPrefix = `/uploads/products/${productId}/`;
  return { dir, urlPrefix };
}

function avatarStoragePath(userId) {
  const safeUserId = String(Number(userId));
  if (!/^[1-9]\d*$/.test(safeUserId)) {
    throw new Error('Identificador de usuario inválido.');
  }
  const dir = path.join(UPLOAD_ROOT, 'avatars', safeUserId);
  const urlPrefix = `/uploads/avatars/${safeUserId}/`;
  return { dir, urlPrefix };
}

/**
 * Storage path for category hero images.
 * @param {number|string} categoryId
 * @returns {{ dir: string, urlPrefix: string }}
 */
function categoryStoragePath(categoryId) {
  const safeId = String(Number(categoryId));
  if (!/^[1-9]\d*$/.test(safeId)) {
    throw new Error('Identificador de categoría inválido.');
  }
  const dir = path.join(UPLOAD_ROOT, 'categories', safeId);
  const urlPrefix = `/uploads/categories/${safeId}/`;
  return { dir, urlPrefix };
}

/**
 * Decode-time safety checks before any resize/encode.
 * @param {Buffer} inputBuffer
 */
async function inspectRasterBuffer(inputBuffer) {
  let metadata;
  try {
    metadata = await sharp(inputBuffer, { limitInputPixels: PUBLIC_IMAGE_MAX_PIXELS }).metadata();
  } catch {
    throw new Error('El archivo no es una imagen válida o está corrupto.');
  }
  if (!metadata.width || !metadata.height) {
    throw new Error('El archivo no es una imagen válida o está corrupto.');
  }
  if (
    metadata.width > PUBLIC_IMAGE_MAX_DIMENSION
    || metadata.height > PUBLIC_IMAGE_MAX_DIMENSION
  ) {
    throw new Error(
      `La imagen excede el máximo de ${PUBLIC_IMAGE_MAX_DIMENSION} × ${PUBLIC_IMAGE_MAX_DIMENSION} píxeles.`
    );
  }
  if (metadata.width * metadata.height > PUBLIC_IMAGE_MAX_PIXELS) {
    throw new Error('La imagen excede el límite de píxeles permitido.');
  }
  if (Number(metadata.pages || 1) > 1) {
    throw new Error('Las imágenes animadas no son compatibles. Cargue una imagen estática.');
  }
  return metadata;
}

/**
 * Process a single image buffer through Sharp.
 * @param {Buffer} inputBuffer
 * @param {{ maxWidth?: number, maxHeight?: number, quality?: number, format?: string }} profile
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, mimeType: string }>}
 */
async function processBuffer(inputBuffer, profile = {}) {
  const cfg = { ...DEFAULT_PROFILE, ...profile };
  await inspectRasterBuffer(inputBuffer);

  const pipeline = sharp(inputBuffer, { limitInputPixels: PUBLIC_IMAGE_MAX_PIXELS })
    .rotate()
    .resize({
      width: cfg.maxWidth,
      height: cfg.maxHeight,
      fit: cfg.fit || 'inside',
      position: cfg.position || 'centre',
      withoutEnlargement: cfg.withoutEnlargement !== false,
    });

  if (cfg.format === 'webp') {
    pipeline.webp({ quality: cfg.quality ?? PUBLIC_IMAGE_WEBP_QUALITY });
  } else if (cfg.format === 'avif') {
    pipeline.avif({ quality: cfg.quality ?? PUBLIC_IMAGE_WEBP_QUALITY });
  } else if (cfg.format === 'jpeg') {
    pipeline.jpeg({ quality: cfg.quality ?? PUBLIC_IMAGE_WEBP_QUALITY });
  } else if (cfg.format === 'png') {
    pipeline.png({ quality: cfg.quality ?? PUBLIC_IMAGE_WEBP_QUALITY });
  }

  const outputBuffer = await pipeline.toBuffer();
  const metadata = await sharp(outputBuffer, { limitInputPixels: PUBLIC_IMAGE_MAX_PIXELS }).metadata();

  return {
    buffer: outputBuffer,
    width: metadata.width || 0,
    height: metadata.height || 0,
    mimeType: `image/${cfg.format}`,
  };
}

/**
 * Process an uploaded file, validate, convert, resize, save.
 * @param {{ buffer?: Buffer, path?: string, mimetype?: string, size?: number }} file — multer file object
 * @param {string} destDir — absolute directory to save the file
 * @param {{ maxWidth?: number, maxHeight?: number, quality?: number, format?: string }} profile
 * @returns {Promise<{ filePath: string, fileName: string, mimeType: string, width: number, height: number, sizeBytes: number }>}
 */
async function processImage(file, destDir, profile = {}) {
  const isAvatar = profile === PROFILES.avatar;
  const validation = validateImageFile(
    file,
    isAvatar
      ? { maxBytes: AVATAR_SOURCE_MAX_BYTES, sizeLabel: `${AVATAR_SOURCE_MAX_MB} MB` }
      : { maxBytes: PUBLIC_IMAGE_SOURCE_MAX_BYTES, sizeLabel: `${PUBLIC_IMAGE_SOURCE_MAX_MB} MB` }
  );
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const inputBuffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
  if (!inputBuffer) {
    throw new Error('No se pudo leer el archivo de imagen.');
  }

  const result = await processBuffer(inputBuffer, profile);
  const fileName = uniqueFileName(profile.format || 'webp');
  const filePath = path.join(destDir, fileName);

  ensureDir(destDir);
  await fs.promises.writeFile(filePath, result.buffer);

  return {
    filePath,
    fileName,
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
    sizeBytes: result.buffer.length,
  };
}

/**
 * Process multiple files through the same pipeline.
 * @param {Array} files — array of multer file objects
 * @param {string} destDir
 * @param {object} profile
 * @returns {Promise<Array>}
 */
async function processUploadedImages(files, destDir, profile = {}) {
  if (!files || !files.length) return [];
  assertPublicImageBatchWithinLimit(files);
  const results = [];
  for (const file of files) {
    const result = await processImage(file, destDir, profile);
    results.push(result);
  }
  return results;
}

/**
 * Safely delete a processed image file.
 * @param {string} absolutePath
 */
async function deleteProcessedImage(absolutePath) {
  try {
    if (absolutePath && fs.existsSync(absolutePath)) {
      // Verify path is within upload root
      const resolved = path.resolve(absolutePath);
      const rootResolved = path.resolve(UPLOAD_ROOT);
      if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
        console.warn('[imageProcessing] Refusing to delete file outside upload root:', resolved);
        return;
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await fs.promises.unlink(resolved);
          return;
        } catch (error) {
          const transient = error.code === 'EBUSY' || error.code === 'EPERM';
          if (!transient || attempt === 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        }
      }
    }
  } catch (err) {
    console.warn('[imageProcessing] Could not delete file:', absolutePath, err.message);
  }
}

/**
 * Clean temporary files from failed operations.
 * @param {Array<{ filePath: string }>} results
 */
async function cleanTempFiles(results) {
  for (const r of results) {
    await deleteProcessedImage(r.filePath);
  }
}

module.exports = {
  UPLOAD_ROOT,
  DEFAULT_PROFILE,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  PROFILES,
  validateImageFile,
  assertPublicImageBatchWithinLimit,
  uniqueFileName,
  ensureDir,
  productStoragePath,
  avatarStoragePath,
  categoryStoragePath,
  inspectRasterBuffer,
  processBuffer,
  processImage,
  processUploadedImages,
  deleteProcessedImage,
  cleanTempFiles,
};
