const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const imageProcessing = require('./imageProcessingService');
const {
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  VIDEO_EXTENSIONS,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  MAX_POSTER_SIZE,
  PUBLIC_PATHS,
  STORAGE_ROOTS,
  IMAGE_PROFILES,
  MEDIA_TYPES,
} = require('../config/galleryOptions');

function actualSize(file) {
  return Number(file?.size || file?.buffer?.length || 0);
}

function validateImageUpload(file, maxSize = MAX_IMAGE_SIZE) {
  if (!file?.buffer) throw new Error('Debe seleccionar una imagen válida.');
  if (!IMAGE_MIME_TYPES.has(file.mimetype)) {
    throw new Error('La imagen debe ser JPG, PNG o WebP.');
  }
  if (!actualSize(file) || actualSize(file) > maxSize) {
    throw new Error('La imagen supera el límite de 10 MB.');
  }
}

function validateVideoUpload(file) {
  if (!file?.buffer) throw new Error('Debe seleccionar un video válido.');
  if (!VIDEO_MIME_TYPES.has(file.mimetype)) {
    throw new Error('El video debe ser MP4 o WebM.');
  }
  if (!actualSize(file) || actualSize(file) > MAX_VIDEO_SIZE) {
    throw new Error('El video supera el límite de 100 MB.');
  }
  const expectedExtension = VIDEO_EXTENSIONS[file.mimetype];
  const suppliedExtension = path.extname(String(file.originalname || '')).toLowerCase();
  if (suppliedExtension !== expectedExtension) {
    throw new Error('La extensión del video no coincide con su tipo.');
  }
  const buffer = file.buffer;
  const isMp4 = file.mimetype === 'video/mp4'
    && buffer.length >= 12
    && buffer.toString('ascii', 4, 8) === 'ftyp';
  const isWebm = file.mimetype === 'video/webm'
    && buffer.length >= 4
    && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!isMp4 && !isWebm) {
    throw new Error('La firma del archivo de video no es válida.');
  }
  return expectedExtension;
}

function publicPath(kind, fileName) {
  return `${PUBLIC_PATHS[kind]}${fileName}`;
}

function resolveSafeGalleryPath(relativePath, expectedRoot) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('/uploads/gallery/')) {
    throw new Error('Ruta de galería inválida.');
  }
  if (path.isAbsolute(relativePath.replace(/^\//, '')) || relativePath.includes('..') || relativePath.includes('\\')) {
    throw new Error('Ruta de galería inválida.');
  }
  const entries = Object.entries(PUBLIC_PATHS);
  const match = entries.find(([, prefix]) => relativePath.startsWith(prefix));
  if (!match) throw new Error('Ruta de galería no permitida.');
  const [kind, prefix] = match;
  if (expectedRoot && kind !== expectedRoot) throw new Error('La ruta no pertenece al almacenamiento esperado.');
  const fileName = relativePath.slice(prefix.length);
  if (!fileName || path.posix.basename(fileName) !== fileName || !/^[a-f0-9-]+\.(webp|mp4|webm)$/i.test(fileName)) {
    throw new Error('Nombre de archivo de galería inválido.');
  }
  const root = path.resolve(STORAGE_ROOTS[kind]);
  const resolved = path.resolve(root, fileName);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Ruta fuera del almacenamiento de galería.');
  return resolved;
}

async function processImagePair(file, { poster = false } = {}) {
  validateImageUpload(file, poster ? MAX_POSTER_SIZE : MAX_IMAGE_SIZE);
  const created = [];
  try {
    const displayKind = poster ? 'posters' : 'images';
    const display = await imageProcessing.processImage(
      file,
      STORAGE_ROOTS[displayKind],
      poster ? IMAGE_PROFILES.poster : IMAGE_PROFILES.display
    );
    created.push(display.filePath);
    const thumbnail = await imageProcessing.processImage(
      file,
      STORAGE_ROOTS.thumbnails,
      IMAGE_PROFILES.thumbnail
    );
    created.push(thumbnail.filePath);
    return {
      mediaPath: publicPath(displayKind, display.fileName),
      posterPath: poster ? publicPath(displayKind, display.fileName) : null,
      thumbnailPath: publicPath('thumbnails', thumbnail.fileName),
      createdPaths: created,
    };
  } catch (error) {
    await deleteAbsolutePaths(created);
    throw error;
  }
}

async function saveVideo(file) {
  const extension = validateVideoUpload(file);
  await fs.promises.mkdir(STORAGE_ROOTS.videos, { recursive: true });
  const fileName = `${crypto.randomUUID()}${extension}`;
  const absolutePath = path.join(STORAGE_ROOTS.videos, fileName);
  await fs.promises.writeFile(absolutePath, file.buffer, { flag: 'wx' });
  return {
    mediaPath: publicPath('videos', fileName),
    createdPaths: [absolutePath],
  };
}

async function deleteAbsolutePaths(paths) {
  for (const candidate of paths || []) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    const galleryRoot = path.resolve(STORAGE_ROOTS.gallery);
    if (!resolved.startsWith(`${galleryRoot}${path.sep}`)) {
      console.warn('[galleryMedia] Refused cleanup outside gallery storage.');
      continue;
    }
    try {
      await fs.promises.unlink(resolved);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[galleryMedia] Cleanup failed:', error.message);
    }
  }
}

async function deleteGalleryPaths(publicPaths) {
  for (const publicFilePath of [...new Set((publicPaths || []).filter(Boolean))]) {
    try {
      const absolute = resolveSafeGalleryPath(publicFilePath);
      await fs.promises.unlink(absolute);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[galleryMedia] Safe deletion failed:', error.message);
    }
  }
}

async function galleryPathExists(publicFilePath, expectedRoot) {
  try {
    const absolute = resolveSafeGalleryPath(publicFilePath, expectedRoot);
    await fs.promises.access(absolute, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertPublishable(item) {
  if (!item?.title || !item?.alt_text) throw new Error('El título y el texto alternativo son obligatorios para publicar.');
  if (item.media_type === MEDIA_TYPES.IMAGE) {
    const validImage = await galleryPathExists(item.media_path, 'images');
    const validThumb = await galleryPathExists(item.thumbnail_path, 'thumbnails');
    if (!validImage || !validThumb) throw new Error('La imagen publicada requiere archivo y miniatura válidos.');
    return;
  }
  if (item.media_type === MEDIA_TYPES.VIDEO) {
    const validVideo = await galleryPathExists(item.media_path, 'videos');
    const validPoster = await galleryPathExists(item.poster_path, 'posters');
    const validThumb = await galleryPathExists(item.thumbnail_path, 'thumbnails');
    if (!validVideo || !validPoster || !validThumb) {
      throw new Error('El video publicado requiere video, póster y miniatura válidos.');
    }
    return;
  }
  throw new Error('Tipo de medio no permitido.');
}

module.exports = {
  actualSize,
  validateImageUpload,
  validateVideoUpload,
  resolveSafeGalleryPath,
  processImagePair,
  saveVideo,
  deleteAbsolutePaths,
  deleteGalleryPaths,
  galleryPathExists,
  assertPublishable,
};
