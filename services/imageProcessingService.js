/**
 * Centralized image processing service using Sharp.
 * All image uploads in the project route through this service.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Configuration ──
const UPLOAD_ROOT = path.join(__dirname, '..', 'public', 'uploads');
const DEFAULT_PROFILE = {
  maxWidth: 1800,
  maxHeight: 1800,
  quality: 80,
  format: 'webp',
};
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

// ── Profiles ──
const PROFILES = {
  product: { maxWidth: 1800, maxHeight: 1800, quality: 80, format: 'webp' },
  avatar: {
    maxWidth: 512,
    maxHeight: 512,
    quality: 82,
    format: 'webp',
    fit: 'cover',
    position: 'attention',
    withoutEnlargement: false,
  },
  gallery: { maxWidth: 2400, maxHeight: 1600, quality: 80, format: 'webp' },
  category: { maxWidth: 1200, maxHeight: 800, quality: 80, format: 'webp' },
};

/**
 * Validate a file buffer/object before processing.
 * @param {{ buffer?: Buffer, mimetype?: string, size?: number, path?: string }} file
 * @returns {{ valid: boolean, error?: string }}
 */
function validateImageFile(file) {
  if (!file) return { valid: false, error: 'No se recibió ningún archivo.' };
  if (file.size && file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'Cada imagen debe pesar menos de 10 MB.' };
  }
  const mimetype = file.mimetype || '';
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    return { valid: false, error: `Formato no permitido: ${mimetype}. Use JPEG, PNG, WebP o AVIF.` };
  }
  return { valid: true };
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
 * Process a single image buffer through Sharp.
 * @param {Buffer} inputBuffer
 * @param {{ maxWidth?: number, maxHeight?: number, quality?: number, format?: string }} profile
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, mimeType: string }>}
 */
async function processBuffer(inputBuffer, profile = {}) {
  const cfg = { ...DEFAULT_PROFILE, ...profile };
  const pipeline = sharp(inputBuffer)
    .rotate()
    .resize({
      width: cfg.maxWidth,
      height: cfg.maxHeight,
      fit: cfg.fit || 'inside',
      position: cfg.position || 'centre',
      withoutEnlargement: cfg.withoutEnlargement !== false,
    });

  if (cfg.format === 'webp') {
    pipeline.webp({ quality: cfg.quality });
  } else if (cfg.format === 'avif') {
    pipeline.avif({ quality: cfg.quality });
  } else if (cfg.format === 'jpeg') {
    pipeline.jpeg({ quality: cfg.quality });
  } else if (cfg.format === 'png') {
    pipeline.png({ quality: cfg.quality });
  }

  const outputBuffer = await pipeline.toBuffer();
  const metadata = await sharp(outputBuffer).metadata();

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
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const inputBuffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
  if (!inputBuffer) {
    throw new Error('No se pudo leer el archivo de imagen.');
  }

  // Validate with Sharp (catches invalid/corrupt images regardless of MIME)
  try {
    await sharp(inputBuffer).metadata();
  } catch {
    throw new Error('El archivo no es una imagen válida o está corrupto.');
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
  uniqueFileName,
  ensureDir,
  productStoragePath,
  avatarStoragePath,
  processBuffer,
  processImage,
  processUploadedImages,
  deleteProcessedImage,
  cleanTempFiles,
};
