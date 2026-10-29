/**
 * Persistent social-feed thumbnail cache (Instagram, Facebook, TikTok).
 * Downloads provider CDN images once, validates with Sharp, stores WebP under UPLOAD_PUBLIC_ROOT.
 */
'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const {
  UPLOAD_PUBLIC_ROOT,
  resolveUploadStoragePath,
  publicUrlForStoragePath,
  assertRelativeStoragePath,
} = require('../config/uploadPaths');
const { PUBLIC_IMAGE_WEBP_QUALITY } = require('../config/imageUploadPolicy');
const imageProcessing = require('./imageProcessingService');

const SOCIAL_THUMBNAIL_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const ALLOWED_PROVIDERS = new Set(['instagram', 'facebook', 'tiktok']);

/** Exact TikTok cover CDN hosts (must stay tight — do not loosen). */
const ALLOWED_TIKTOK_THUMBNAIL_ORIGINS = Object.freeze([
  'p16-sign.tiktokcdn-us.com',
  'p19-sign.tiktokcdn-us.com',
  'p16-sign-va.tiktokcdn.com',
  'p16-sign-sg.tiktokcdn.com',
]);

const THUMBNAIL_PROFILE = Object.freeze({
  maxWidth: 1200,
  maxHeight: 1200,
  quality: PUBLIC_IMAGE_WEBP_QUALITY,
  format: 'webp',
  fit: 'inside',
  withoutEnlargement: true,
});

/** @type {typeof fetch | null} */
let _httpFetch = null;
/** @type {((url: string) => Promise<Buffer>) | null} */
let _downloadImpl = null;

function setHttpFetch(fn) {
  _httpFetch = typeof fn === 'function' ? fn : null;
}

function setDownloadImpl(fn) {
  _downloadImpl = typeof fn === 'function' ? fn : null;
}

function getHttpFetch() {
  if (_httpFetch) return _httpFetch;
  if (typeof globalThis.fetch !== 'function') {
    throw Object.assign(new Error('fetch is not available'), { code: 'NO_FETCH' });
  }
  return globalThis.fetch.bind(globalThis);
}

function assertSecureImageUrlBasics(parsed) {
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  if (net.isIP(hostname)) return false;
  return true;
}

/**
 * Accept only HTTPS Meta image CDN hosts (no credentials, no IPs, no lookalikes).
 * @param {unknown} url
 * @returns {boolean}
 */
function isValidMetaImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (!assertSecureImageUrlBasics(parsed)) return false;
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.endsWith('.cdninstagram.com') && !hostname.endsWith('.fbcdn.net')) {
      return false;
    }
    const suffix = hostname.endsWith('.cdninstagram.com') ? '.cdninstagram.com' : '.fbcdn.net';
    if (hostname.indexOf(suffix) !== hostname.length - suffix.length) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Accept only approved TikTok cover CDN hosts.
 * @param {unknown} url
 * @returns {boolean}
 */
function isValidTikTokImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (!assertSecureImageUrlBasics(parsed)) return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_TIKTOK_THUMBNAIL_ORIGINS.some(
      (origin) => hostname === origin || hostname.endsWith(`.${origin}`)
    );
  } catch {
    return false;
  }
}

/** Compatibility alias used by tiktokSyncService / existing tests. */
function isValidTikTokThumbnail(url) {
  return isValidTikTokImageUrl(url);
}

/**
 * @param {string} provider
 * @param {unknown} url
 * @returns {boolean}
 */
function isValidProviderImageUrl(provider, url) {
  const value = String(provider || '').toLowerCase();
  if (value === 'instagram' || value === 'facebook') return isValidMetaImageUrl(url);
  if (value === 'tiktok') return isValidTikTokImageUrl(url);
  return false;
}

function assertProvider(provider) {
  const value = String(provider || '').toLowerCase();
  if (!ALLOWED_PROVIDERS.has(value)) {
    throw Object.assign(new Error('Unsupported social thumbnail provider.'), { code: 'BAD_PROVIDER' });
  }
  return value;
}

/**
 * Provider-aware bounded download with manual redirect revalidation.
 * @param {string} provider
 * @param {string} url
 * @param {{ maxBytes?: number, timeoutMs?: number, maxRedirects?: number }} [options]
 * @returns {Promise<Buffer>}
 */
async function downloadProviderImageBytes(provider, url, options = {}) {
  const safeProvider = assertProvider(provider);

  if (_downloadImpl) {
    if (!isValidProviderImageUrl(safeProvider, url)) {
      throw Object.assign(new Error('Invalid provider image URL'), { code: 'INVALID_URL' });
    }
    const buffer = await _downloadImpl(url);
    if (!Buffer.isBuffer(buffer)) {
      throw Object.assign(new Error('Download mock must return a Buffer'), { code: 'BAD_MOCK' });
    }
    if (buffer.length > (options.maxBytes ?? SOCIAL_THUMBNAIL_SOURCE_MAX_BYTES)) {
      throw Object.assign(new Error('Thumbnail exceeds size limit'), { code: 'SIZE_LIMIT' });
    }
    return buffer;
  }

  const maxBytes = options.maxBytes ?? SOCIAL_THUMBNAIL_SOURCE_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const httpFetch = getHttpFetch();

  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isValidProviderImageUrl(safeProvider, current)) {
      throw Object.assign(new Error('Invalid provider image URL'), { code: 'INVALID_URL' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await httpFetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'image/*,*/*;q=0.8' },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (response.body && typeof response.body.cancel === 'function') {
          try { await response.body.cancel(); } catch { /* ignore */ }
        }
        if (!location) {
          throw Object.assign(new Error('Redirect missing Location'), { code: 'BAD_REDIRECT' });
        }
        let nextUrl;
        try {
          nextUrl = new URL(location, current).href;
        } catch {
          throw Object.assign(new Error('Redirect Location invalid'), { code: 'BAD_REDIRECT' });
        }
        if (!isValidProviderImageUrl(safeProvider, nextUrl)) {
          throw Object.assign(new Error('Redirect target rejected'), { code: 'REDIRECT_REJECTED' });
        }
        current = nextUrl;
        continue;
      }

      if (!response.ok) {
        throw Object.assign(new Error(`Thumbnail HTTP ${response.status}`), {
          code: 'HTTP_ERROR',
          status: response.status,
        });
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > maxBytes) {
        if (response.body && typeof response.body.cancel === 'function') {
          try { await response.body.cancel(); } catch { /* ignore */ }
        }
        throw Object.assign(new Error('Thumbnail exceeds size limit'), { code: 'SIZE_LIMIT' });
      }

      if (!response.body || typeof response.body.getReader !== 'function') {
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > maxBytes) {
          throw Object.assign(new Error('Thumbnail exceeds size limit'), { code: 'SIZE_LIMIT' });
        }
        return Buffer.from(arrayBuffer);
      }

      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw Object.assign(new Error('Thumbnail exceeds size limit'), { code: 'SIZE_LIMIT' });
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, total);
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw Object.assign(new Error('Thumbnail download timed out'), { code: 'TIMEOUT' });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw Object.assign(new Error('Too many redirects'), { code: 'REDIRECT_LIMIT' });
}

/**
 * Compatibility wrapper for existing Meta (IG/FB) tests.
 * @param {string} url
 * @param {{ maxBytes?: number, timeoutMs?: number, maxRedirects?: number }} [options]
 */
async function downloadMetaImageBytes(url, options = {}) {
  return downloadProviderImageBytes('instagram', url, options);
}

function logCacheFailure(provider, err) {
  console.warn(JSON.stringify({
    ts: new Date().toISOString(),
    stage: 'social_provider_thumbnail_cache',
    provider,
    code: err?.code || 'CACHE_FAIL',
    message: String(err?.message || 'cache failed').slice(0, 120),
  }));
}

/**
 * @param {string} storagePath
 * @returns {boolean}
 */
function localThumbnailFileExists(storagePath) {
  const raw = String(storagePath || '').trim();
  if (!raw) return false;
  try {
    const absolute = resolveUploadStoragePath(raw);
    return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} storagePath
 * @returns {string|null}
 */
function resolveLocalThumbnailPublicUrl(storagePath) {
  if (!localThumbnailFileExists(storagePath)) return null;
  try {
    return publicUrlForStoragePath(String(storagePath).trim());
  } catch {
    return null;
  }
}

/**
 * Download + Sharp process + write WebP. Returns storage-relative path.
 * @param {{ provider: string, sourceUrl: string }} params
 */
async function cacheProviderThumbnail({ provider, sourceUrl }) {
  const safeProvider = assertProvider(provider);
  if (!isValidProviderImageUrl(safeProvider, sourceUrl)) {
    throw Object.assign(new Error('Invalid provider image URL'), { code: 'INVALID_URL' });
  }

  const inputBuffer = await downloadProviderImageBytes(safeProvider, sourceUrl);
  await imageProcessing.inspectRasterBuffer(inputBuffer);
  const processed = await imageProcessing.processBuffer(inputBuffer, THUMBNAIL_PROFILE);

  const fileName = imageProcessing.uniqueFileName('webp');
  const relative = assertRelativeStoragePath(path.posix.join('social', safeProvider, fileName));
  const absolute = resolveUploadStoragePath(relative);
  imageProcessing.ensureDir(path.dirname(absolute));
  await fs.promises.writeFile(absolute, processed.buffer);

  return {
    storagePath: relative,
    absolutePath: absolute,
    publicUrl: publicUrlForStoragePath(relative),
    width: processed.width,
    height: processed.height,
    sizeBytes: processed.buffer.length,
  };
}

/**
 * Ensure a usable local cache exists. Never clears an existing valid local path on failure.
 * @param {{ provider: string, sourceUrl: string, existingLocalPath?: string }} params
 */
async function ensureProviderThumbnailCached({ provider, sourceUrl, existingLocalPath = '' }) {
  const existing = String(existingLocalPath || '').trim();
  if (existing && localThumbnailFileExists(existing)) {
    return {
      localPath: existing,
      createdAbsolute: null,
      replacedPrevious: null,
      skippedDownload: true,
      cached: true,
    };
  }

  if (!isValidProviderImageUrl(provider, sourceUrl)) {
    return {
      localPath: existing,
      createdAbsolute: null,
      replacedPrevious: null,
      skippedDownload: true,
      cached: false,
    };
  }

  try {
    const created = await cacheProviderThumbnail({ provider, sourceUrl });
    return {
      localPath: created.storagePath,
      createdAbsolute: created.absolutePath,
      replacedPrevious: existing || null,
      skippedDownload: false,
      cached: true,
    };
  } catch (err) {
    logCacheFailure(provider, err);
    return {
      localPath: existing,
      createdAbsolute: null,
      replacedPrevious: null,
      skippedDownload: false,
      cached: false,
      error: err,
    };
  }
}

async function deleteLocalThumbnailSafe(storagePath) {
  const raw = String(storagePath || '').trim();
  if (!raw) return;
  try {
    const absolute = resolveUploadStoragePath(raw);
    await imageProcessing.deleteProcessedImage(absolute);
  } catch {
    /* ignore unsafe / missing paths */
  }
}

module.exports = {
  SOCIAL_THUMBNAIL_SOURCE_MAX_BYTES,
  MAX_REDIRECTS,
  DOWNLOAD_TIMEOUT_MS,
  THUMBNAIL_PROFILE,
  UPLOAD_PUBLIC_ROOT,
  ALLOWED_TIKTOK_THUMBNAIL_ORIGINS,
  /** @deprecated Prefer ALLOWED_TIKTOK_THUMBNAIL_ORIGINS — kept for tiktokSyncService re-export. */
  ALLOWED_THUMBNAIL_ORIGINS: ALLOWED_TIKTOK_THUMBNAIL_ORIGINS,
  isValidMetaImageUrl,
  isValidTikTokImageUrl,
  isValidTikTokThumbnail,
  isValidProviderImageUrl,
  downloadProviderImageBytes,
  downloadMetaImageBytes,
  cacheProviderThumbnail,
  ensureProviderThumbnailCached,
  localThumbnailFileExists,
  resolveLocalThumbnailPublicUrl,
  deleteLocalThumbnailSafe,
  setHttpFetch,
  setDownloadImpl,
};
