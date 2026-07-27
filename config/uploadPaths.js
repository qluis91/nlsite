const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UPLOAD_PUBLIC_ROOT = path.resolve(
  process.env.UPLOAD_PUBLIC_DIR || path.join(PROJECT_ROOT, 'public', 'uploads')
);
const UPLOAD_PUBLIC_URL_PREFIX = '/uploads/';
const MEDIA_STORAGE_PREFIX = 'media';
const MEDIA_ROOT = path.join(UPLOAD_PUBLIC_ROOT, MEDIA_STORAGE_PREFIX);

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function assertRelativeStoragePath(value) {
  const normalized = path.posix.normalize(toPosix(value).replace(/^\/+/, ''));
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.posix.isAbsolute(normalized) ||
    /^[a-z]:\//i.test(normalized)
  ) {
    throw new Error('Ruta de almacenamiento inválida.');
  }
  return normalized;
}

function resolveUploadStoragePath(storagePath) {
  const relative = assertRelativeStoragePath(storagePath);
  const resolved = path.resolve(UPLOAD_PUBLIC_ROOT, ...relative.split('/'));
  if (
    resolved !== UPLOAD_PUBLIC_ROOT &&
    !resolved.startsWith(`${UPLOAD_PUBLIC_ROOT}${path.sep}`)
  ) {
    throw new Error('Ruta fuera del almacenamiento permitido.');
  }
  return resolved;
}

function publicUrlForStoragePath(storagePath) {
  return `${UPLOAD_PUBLIC_URL_PREFIX}${assertRelativeStoragePath(storagePath)}`;
}

function storagePathFromPublicUrl(publicUrl) {
  const value = toPosix(publicUrl);
  if (!value.startsWith(UPLOAD_PUBLIC_URL_PREFIX)) {
    throw new Error('URL pública de carga inválida.');
  }
  return assertRelativeStoragePath(value.slice(UPLOAD_PUBLIC_URL_PREFIX.length));
}

function storagePathFromAbsolute(absolutePath) {
  const resolved = path.resolve(String(absolutePath || ''));
  if (
    resolved !== UPLOAD_PUBLIC_ROOT &&
    !resolved.startsWith(`${UPLOAD_PUBLIC_ROOT}${path.sep}`)
  ) {
    throw new Error('Ruta de medio absoluta fuera del almacenamiento configurado.');
  }
  return toPosix(path.relative(UPLOAD_PUBLIC_ROOT, resolved));
}

module.exports = {
  PROJECT_ROOT,
  UPLOAD_PUBLIC_ROOT,
  UPLOAD_PUBLIC_URL_PREFIX,
  MEDIA_STORAGE_PREFIX,
  MEDIA_ROOT,
  toPosix,
  assertRelativeStoragePath,
  resolveUploadStoragePath,
  publicUrlForStoragePath,
  storagePathFromPublicUrl,
  storagePathFromAbsolute,
};
