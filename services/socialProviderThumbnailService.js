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
const CACHE_USER_AGENT = 'NinjaLabCR-SocialMediaCache/1.0';
const CACHE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

/** Exact TikTok cover CDN hosts (must stay tight — do not loosen). */
const ALLOWED_TIKTOK_THUMBNAIL_ORIGINS = Object.freeze([
  'p16-sign.tiktokcdn-us.com',
  'p19-sign.tiktokcdn-us.com',
  'p16-sign-va.tiktokcdn.com',
  'p16-sign-sg.tiktokcdn.com',
]);

/** Meta-owned media CDN apex suffixes (exact apex + subdomains only). */
const META_MEDIA_HOST_SUFFIXES = Object.freeze([
  'cdninstagram.com',
  'fbcdn.net',
  'fbsbx.com',
]);

const THUMBNAIL_PROFILE = Object.freeze({
  maxWidth: 1200,
  maxHeight: 1200,
  quality: PUBLIC_IMAGE_WEBP_QUALITY,
  format: 'webp',
  fit: 'inside',
  withoutEnlargement: true,
});

const CACHE_STATUS = Object.freeze({
  CACHED_NEW: 'cached_new',
  CACHED_EXISTING: 'cached_existing',
  NO_SOURCE: 'no_source',
  INVALID_SOURCE: 'invalid_source',
  DOWNLOAD_FAILED: 'download_failed',
  PROCESSING_FAILED: 'processing_failed',
  WRITE_FAILED: 'write_failed',
});

const RETRYABLE_HTTP_STATUSES = new Set([403, 404, 410]);

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

/**
 * @param {string} hostname
 * @param {string} suffix
 * @returns {boolean}
 */
function hostnameMatchesSuffix(hostname, suffix) {
  const host = String(hostname || '').toLowerCase();
  const suf = String(suffix || '').toLowerCase();
  if (!host || !suf) return false;
  return host === suf || host.endsWith(`.${suf}`);
}

/**
 * Safe hostname only — never path/query/signatures.
 * @param {unknown} url
 * @returns {string|null}
 */
function safeHostnameFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname || null;
  } catch {
    return null;
  }
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
    return META_MEDIA_HOST_SUFFIXES.some((suffix) => hostnameMatchesSuffix(hostname, suffix));
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

const THUMBNAIL_BACKFILL_LIMIT = 100;

function createEmptyThumbnailStats() {
  return {
    cached: 0,
    reused: 0,
    failed: 0,
    noSource: 0,
    invalidSource: 0,
  };
}

function createEmptyBackfillStats() {
  return {
    scanned: 0,
    needed: 0,
    cached: 0,
    reused: 0,
    failed: 0,
    unavailable: 0,
  };
}

/**
 * True when DB path is empty or the WebP file is missing/empty on disk.
 * @param {unknown} localPath
 * @returns {boolean}
 */
function needsLocalThumbnailBackfill(localPath) {
  const raw = String(localPath || '').trim();
  if (!raw) return true;
  return !localThumbnailFileExists(raw);
}

/**
 * Public feed URL is a local social WebP under /uploads/social/{provider}/.
 * @param {unknown} thumbnailUrl
 * @returns {boolean}
 */
function isLocalSocialThumbnailPublicUrl(thumbnailUrl) {
  return typeof thumbnailUrl === 'string'
    && /^\/uploads\/social\/(instagram|facebook|tiktok)\/[^/]+\.webp$/i.test(thumbnailUrl);
}

/**
 * Graph single-object failures that are not terminal auth (deleted / inaccessible media).
 * @param {{ status?: number, data?: object, code?: string }} err
 * @returns {boolean}
 */
function isProviderMediaUnavailableError(err) {
  const status = Number(err?.status);
  const code = err?.data?.error?.code;
  if (status === 404) return true;
  if (code === 100) return true;
  const msg = String(err?.data?.error?.message || err?.message || '').toLowerCase();
  if (msg.includes('does not exist') || msg.includes('unsupported get request')) return true;
  return false;
}

/**
 * @param {object} stats
 * @param {{ status?: string, cached?: boolean, skippedDownload?: boolean, errorCode?: string|null }} result
 */
function accumulateThumbnailStat(stats, result) {
  if (!stats || !result) return;
  const status = result.status || '';
  if (status === CACHE_STATUS.CACHED_EXISTING) {
    stats.reused += 1;
    return;
  }
  if (status === CACHE_STATUS.CACHED_NEW) {
    stats.cached += 1;
    return;
  }
  if (status === CACHE_STATUS.NO_SOURCE) {
    stats.noSource += 1;
    return;
  }
  if (status === CACHE_STATUS.INVALID_SOURCE) {
    stats.invalidSource += 1;
    return;
  }
  if (result.cached && result.skippedDownload) {
    stats.reused += 1;
    return;
  }
  if (result.cached) {
    stats.cached += 1;
    return;
  }
  stats.failed += 1;
}

/**
 * Group equivalent safe failure diagnostics (max few entries).
 * @param {Array<{ provider?: string, code?: string|null, status?: number|null, host?: string|null }>} errors
 * @param {number} [limit=5]
 */
function summarizeThumbnailErrors(errors, limit = 5) {
  const map = new Map();
  for (const err of errors || []) {
    const code = err?.code || 'CACHE_FAIL';
    const status = err?.status ?? null;
    const host = err?.host || null;
    const provider = err?.provider || null;
    const key = `${provider}|${code}|${status}|${host}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, {
        provider,
        code,
        status,
        host,
        count: 1,
      });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function logStructuredCacheEvent(payload) {
  console.warn(JSON.stringify({
    ts: new Date().toISOString(),
    stage: 'social_provider_thumbnail_cache',
    ...payload,
  }));
}

function logCacheFailure(provider, err, extra = {}) {
  logStructuredCacheEvent({
    provider,
    status: extra.status || CACHE_STATUS.DOWNLOAD_FAILED,
    code: err?.code || 'CACHE_FAIL',
    httpStatus: err?.status ?? null,
    host: extra.host || null,
    redirectHost: extra.redirectHost || null,
    message: String(err?.message || 'cache failed').slice(0, 120),
    uploadRootWritable: extra.uploadRootWritable,
  });
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
  const sourceHost = safeHostnameFromUrl(url);

  if (_downloadImpl) {
    if (!isValidProviderImageUrl(safeProvider, url)) {
      throw Object.assign(new Error('Invalid provider image URL'), {
        code: 'INVALID_URL',
        sourceHost,
      });
    }
    const buffer = await _downloadImpl(url);
    if (!Buffer.isBuffer(buffer)) {
      throw Object.assign(new Error('Download mock must return a Buffer'), { code: 'BAD_MOCK', sourceHost });
    }
    if (buffer.length > (options.maxBytes ?? SOCIAL_THUMBNAIL_SOURCE_MAX_BYTES)) {
      throw Object.assign(new Error('Thumbnail exceeds size limit'), { code: 'SIZE_LIMIT', sourceHost });
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
      throw Object.assign(new Error(hop === 0 ? 'Invalid provider image URL' : 'Redirect target rejected'), {
        code: hop === 0 ? 'INVALID_URL' : 'REDIRECT_REJECTED',
        sourceHost,
        redirectHost: hop === 0 ? null : safeHostnameFromUrl(current),
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await httpFetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: CACHE_ACCEPT,
          'User-Agent': CACHE_USER_AGENT,
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (response.body && typeof response.body.cancel === 'function') {
          try { await response.body.cancel(); } catch { /* ignore */ }
        }
        if (!location) {
          throw Object.assign(new Error('Redirect missing Location'), {
            code: 'BAD_REDIRECT',
            sourceHost,
            status: response.status,
          });
        }
        let nextUrl;
        try {
          nextUrl = new URL(location, current).href;
        } catch {
          throw Object.assign(new Error('Redirect Location invalid'), {
            code: 'BAD_REDIRECT',
            sourceHost,
            status: response.status,
          });
        }
        if (!isValidProviderImageUrl(safeProvider, nextUrl)) {
          throw Object.assign(new Error('Redirect target rejected'), {
            code: 'REDIRECT_REJECTED',
            sourceHost,
            redirectHost: safeHostnameFromUrl(nextUrl),
            status: response.status,
          });
        }
        current = nextUrl;
        continue;
      }

      if (!response.ok) {
        throw Object.assign(new Error(`Thumbnail HTTP ${response.status}`), {
          code: 'HTTP_ERROR',
          status: response.status,
          sourceHost: safeHostnameFromUrl(current) || sourceHost,
        });
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > maxBytes) {
        if (response.body && typeof response.body.cancel === 'function') {
          try { await response.body.cancel(); } catch { /* ignore */ }
        }
        throw Object.assign(new Error('Thumbnail exceeds size limit'), {
          code: 'SIZE_LIMIT',
          sourceHost: safeHostnameFromUrl(current) || sourceHost,
        });
      }

      if (!response.body || typeof response.body.getReader !== 'function') {
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > maxBytes) {
          throw Object.assign(new Error('Thumbnail exceeds size limit'), {
            code: 'SIZE_LIMIT',
            sourceHost: safeHostnameFromUrl(current) || sourceHost,
          });
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
          throw Object.assign(new Error('Thumbnail exceeds size limit'), {
            code: 'SIZE_LIMIT',
            sourceHost: safeHostnameFromUrl(current) || sourceHost,
          });
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, total);
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw Object.assign(new Error('Thumbnail download timed out'), {
          code: 'TIMEOUT',
          sourceHost,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw Object.assign(new Error('Too many redirects'), {
    code: 'REDIRECT_LIMIT',
    sourceHost,
  });
}

/**
 * Compatibility wrapper for existing Meta (IG/FB) tests.
 * @param {string} url
 * @param {{ maxBytes?: number, timeoutMs?: number, maxRedirects?: number }} [options]
 */
async function downloadMetaImageBytes(url, options = {}) {
  return downloadProviderImageBytes('instagram', url, options);
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
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
    return fs.statSync(absolute).size > 0;
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

function classifyFailureStatus(err) {
  const code = err?.code || '';
  if (code === 'INVALID_URL') return CACHE_STATUS.INVALID_SOURCE;
  if (code === 'WRITE_FAILED') return CACHE_STATUS.WRITE_FAILED;
  if (
    code === 'SHARP_ERROR'
    || code === 'BAD_IMAGE'
    || code === 'UNSUPPORTED_FORMAT'
    || /sharp|inspect|process/i.test(String(err?.message || ''))
  ) {
    return CACHE_STATUS.PROCESSING_FAILED;
  }
  return CACHE_STATUS.DOWNLOAD_FAILED;
}

/**
 * Download + Sharp process + write WebP. Returns storage-relative path.
 * @param {{ provider: string, sourceUrl: string }} params
 */
async function cacheProviderThumbnail({ provider, sourceUrl }) {
  const safeProvider = assertProvider(provider);
  const sourceHost = safeHostnameFromUrl(sourceUrl);
  if (!isValidProviderImageUrl(safeProvider, sourceUrl)) {
    throw Object.assign(new Error('Invalid provider image URL'), {
      code: 'INVALID_URL',
      sourceHost,
    });
  }

  let inputBuffer;
  try {
    inputBuffer = await downloadProviderImageBytes(safeProvider, sourceUrl);
  } catch (err) {
    if (!err.sourceHost) err.sourceHost = sourceHost;
    throw err;
  }

  let processed;
  try {
    await imageProcessing.inspectRasterBuffer(inputBuffer);
    processed = await imageProcessing.processBuffer(inputBuffer, THUMBNAIL_PROFILE);
  } catch (err) {
    throw Object.assign(new Error(String(err?.message || 'image processing failed').slice(0, 120)), {
      code: err?.code || 'PROCESSING_FAILED',
      sourceHost,
      cause: err,
    });
  }

  const fileName = imageProcessing.uniqueFileName('webp');
  const relative = assertRelativeStoragePath(path.posix.join('social', safeProvider, fileName));
  const absolute = resolveUploadStoragePath(relative);
  try {
    imageProcessing.ensureDir(path.dirname(absolute));
    await fs.promises.writeFile(absolute, processed.buffer);
  } catch (err) {
    let writable = null;
    try {
      fs.accessSync(UPLOAD_PUBLIC_ROOT, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    throw Object.assign(new Error('Thumbnail write failed'), {
      code: 'WRITE_FAILED',
      sourceHost,
      uploadRootWritable: writable,
      cause: err,
    });
  }

  if (!fs.existsSync(absolute) || fs.statSync(absolute).size <= 0) {
    try { await fs.promises.unlink(absolute); } catch { /* ignore */ }
    throw Object.assign(new Error('Thumbnail write verification failed'), {
      code: 'WRITE_FAILED',
      sourceHost,
    });
  }

  return {
    storagePath: relative,
    absolutePath: absolute,
    publicUrl: publicUrlForStoragePath(relative),
    width: processed.width,
    height: processed.height,
    sizeBytes: processed.buffer.length,
    sourceHost,
  };
}

function buildCacheResult(partial) {
  const cached = partial.cached === true;
  const skippedDownload = partial.skippedDownload === true;
  return {
    status: partial.status,
    localPath: partial.localPath || '',
    createdAbsolute: partial.createdAbsolute || null,
    replacedPrevious: partial.replacedPrevious || null,
    skippedDownload,
    cached,
    attempted: partial.attempted === true,
    reused: skippedDownload && cached,
    errorCode: partial.errorCode || null,
    httpStatus: partial.httpStatus ?? null,
    sourceHost: partial.sourceHost || null,
    redirectHost: partial.redirectHost || null,
    error: partial.error || null,
  };
}

/**
 * Ensure a usable local cache exists. Never clears an existing valid local path on failure.
 * @param {{ provider: string, sourceUrl: string, existingLocalPath?: string }} params
 */
async function ensureProviderThumbnailCached({ provider, sourceUrl, existingLocalPath = '' }) {
  const safeProvider = assertProvider(provider);
  const existing = String(existingLocalPath || '').trim();
  const sourceHost = safeHostnameFromUrl(sourceUrl);
  const existingValid = existing && localThumbnailFileExists(existing);

  if (existingValid) {
    return buildCacheResult({
      status: CACHE_STATUS.CACHED_EXISTING,
      localPath: existing,
      createdAbsolute: null,
      replacedPrevious: null,
      skippedDownload: true,
      cached: true,
      attempted: false,
      sourceHost,
    });
  }

  const rawSource = String(sourceUrl || '').trim();
  if (!rawSource) {
    logStructuredCacheEvent({
      provider: safeProvider,
      status: CACHE_STATUS.NO_SOURCE,
      host: null,
    });
    return buildCacheResult({
      status: CACHE_STATUS.NO_SOURCE,
      localPath: '',
      createdAbsolute: null,
      replacedPrevious: null,
      skippedDownload: true,
      cached: false,
      attempted: false,
      errorCode: 'NO_SOURCE',
      sourceHost: null,
    });
  }

  if (!isValidProviderImageUrl(safeProvider, rawSource)) {
    logStructuredCacheEvent({
      provider: safeProvider,
      status: CACHE_STATUS.INVALID_SOURCE,
      host: sourceHost,
      code: 'INVALID_URL',
    });
    return buildCacheResult({
      status: CACHE_STATUS.INVALID_SOURCE,
      localPath: '',
      createdAbsolute: null,
      replacedPrevious: null,
      skippedDownload: true,
      cached: false,
      attempted: false,
      errorCode: 'INVALID_URL',
      sourceHost,
    });
  }

  try {
    const created = await cacheProviderThumbnail({ provider: safeProvider, sourceUrl: rawSource });
    return buildCacheResult({
      status: CACHE_STATUS.CACHED_NEW,
      localPath: created.storagePath,
      createdAbsolute: created.absolutePath,
      replacedPrevious: existing || null,
      skippedDownload: false,
      cached: true,
      attempted: true,
      sourceHost: created.sourceHost || sourceHost,
    });
  } catch (err) {
    const status = classifyFailureStatus(err);
    const host = err?.sourceHost || sourceHost;
    logCacheFailure(safeProvider, err, {
      status,
      host,
      redirectHost: err?.redirectHost || null,
      uploadRootWritable: err?.uploadRootWritable,
    });
    return buildCacheResult({
      status,
      localPath: '',
      createdAbsolute: null,
      replacedPrevious: null,
      skippedDownload: false,
      cached: false,
      attempted: true,
      errorCode: err?.code || 'CACHE_FAIL',
      httpStatus: err?.status ?? null,
      sourceHost: host,
      redirectHost: err?.redirectHost || null,
      error: err,
    });
  }
}

/**
 * @param {{ status?: string, cached?: boolean, skippedDownload?: boolean, attempted?: boolean, errorCode?: string|null, sourceHost?: string|null, httpStatus?: number|null }} prepared
 */
function toThumbnailCacheMeta(prepared) {
  return {
    cached: prepared?.cached === true,
    reused: prepared?.reused === true || (prepared?.skippedDownload === true && prepared?.cached === true),
    attempted: prepared?.attempted === true,
    code: prepared?.errorCode || null,
    status: prepared?.status || null,
    httpStatus: prepared?.httpStatus ?? null,
    sourceHost: prepared?.sourceHost || null,
  };
}

function isRetryableCacheFailure(prepared) {
  if (!prepared || prepared.cached) return false;
  if (prepared.errorCode !== 'HTTP_ERROR') return false;
  return RETRYABLE_HTTP_STATUSES.has(Number(prepared.httpStatus));
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
  CACHE_USER_AGENT,
  CACHE_ACCEPT,
  CACHE_STATUS,
  RETRYABLE_HTTP_STATUSES,
  META_MEDIA_HOST_SUFFIXES,
  ALLOWED_TIKTOK_THUMBNAIL_ORIGINS,
  /** @deprecated Prefer ALLOWED_TIKTOK_THUMBNAIL_ORIGINS — kept for tiktokSyncService re-export. */
  ALLOWED_THUMBNAIL_ORIGINS: ALLOWED_TIKTOK_THUMBNAIL_ORIGINS,
  hostnameMatchesSuffix,
  safeHostnameFromUrl,
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
  THUMBNAIL_BACKFILL_LIMIT,
  createEmptyThumbnailStats,
  createEmptyBackfillStats,
  needsLocalThumbnailBackfill,
  isLocalSocialThumbnailPublicUrl,
  isProviderMediaUnavailableError,
  accumulateThumbnailStat,
  summarizeThumbnailErrors,
  toThumbnailCacheMeta,
  isRetryableCacheFailure,
  setHttpFetch,
  setDownloadImpl,
};
