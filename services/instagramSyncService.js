/**
 * Instagram Sync Service — Phase 2E-B (Close).
 * Imports media from connected Instagram Professional account via Meta Graph API.
 * Uses configurable API version and correct token selection.
 * Provider thumbnails are persisted locally via socialProviderThumbnailService.
 */
const crypto = require('node:crypto');
const pool = require('../config/db');
const metaOAuth = require('./metaOAuthService');
const thumbnailCache = require('./socialProviderThumbnailService');

const PROVIDER = 'instagram';
const MAX_MEDIA_DEFAULT = 25;

const { isValidMetaImageUrl } = thumbnailCache;

const MEDIA_FIELDS = [
  'id', 'caption', 'media_type', 'media_url', 'permalink',
  'thumbnail_url', 'timestamp', 'username',
  'children{media_url,media_type,thumbnail_url}',
].join(',');

// ── Pluggable HTTP mock ──

let _httpGet = null;
function setHttpGet(fn) { _httpGet = fn; }

async function fetch(url) {
  if (_httpGet) return _httpGet(url);
  return metaOAuth.httpGet(url);
}

// ── Get integration config ──

async function getIntegrationConfig() {
  const [[row]] = await pool.query(
    "SELECT * FROM social_integrations WHERE provider = ? AND is_connected = 1 AND is_enabled = 1",
    [PROVIDER]
  );
  if (!row) return null;
  return {
    ...row,
    config_json: typeof row.config_json === 'string' ? JSON.parse(row.config_json) : (row.config_json || {}),
  };
}

/**
 * Pick a usable still-image URL from a carousel child.
 * VIDEO/REELS → thumbnail_url only (never video binary).
 * IMAGE → media_url, then thumbnail_url.
 * @param {object} child
 * @returns {string}
 */
function pickChildThumbnailUrl(child) {
  if (!child || typeof child !== 'object') return '';
  const type = String(child.media_type || 'IMAGE').toUpperCase();
  if (type === 'VIDEO' || type === 'REELS') {
    return String(child.thumbnail_url || '').trim();
  }
  return String(child.media_url || child.thumbnail_url || '').trim();
}

/**
 * Walk carousel children until one yields a usable image source.
 * @param {object[]} children
 * @returns {string}
 */
function pickCarouselThumbnailUrl(children) {
  if (!Array.isArray(children)) return '';
  for (const child of children) {
    const url = pickChildThumbnailUrl(child);
    if (url) return url;
  }
  return '';
}

/**
 * Select thumbnail source for an IG media item (never prefer video binaries).
 * @param {object} item
 * @returns {string}
 */
function pickInstagramThumbnailUrl(item) {
  const mediaType = String(item?.media_type || 'IMAGE').toUpperCase();
  if (mediaType === 'CAROUSEL_ALBUM') {
    return pickCarouselThumbnailUrl(item?.children?.data);
  }
  if (mediaType === 'VIDEO' || mediaType === 'REELS') {
    return String(item?.thumbnail_url || '').trim();
  }
  // IMAGE (and unknown still types): prefer media_url
  return String(item?.media_url || item?.thumbnail_url || '').trim();
}

// ── Fetch media ──

async function fetchInstagramMedia(igUserId, accessToken, maxResults = MAX_MEDIA_DEFAULT) {
  const limit = Math.min(50, Math.max(1, maxResults));
  const baseUrl = metaOAuth.getBaseUrl();

  const url = `${baseUrl}/${igUserId}/media?fields=${encodeURIComponent(MEDIA_FIELDS)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`;
  const { status, data } = await fetch(url);

  if (status !== 200) {
    const classified = metaOAuth.classifyMetaApiError(status, data);
    const isAuth = classified.category !== 'transient' && metaOAuth.requiresReconnect(classified.category);
    throw Object.assign(new Error(`Instagram API error: ${data?.error?.message || status}`), {
      code: 'IG_API_ERROR',
      status,
      data,
      authError: isAuth,
      category: classified.category,
      retryable: !isAuth && (status >= 500 || status === 429),
    });
  }

  return (data.data || []).map(normalizeInstagramMedia);
}

/**
 * Lightweight single-media metadata refresh (signed URL retry).
 * @param {string} mediaId
 * @param {string} accessToken
 */
async function fetchInstagramMediaById(mediaId, accessToken) {
  const id = String(mediaId || '').trim();
  if (!id || !accessToken) {
    throw Object.assign(new Error('Instagram media id required'), { code: 'NO_MEDIA_ID' });
  }
  const baseUrl = metaOAuth.getBaseUrl();
  const url = `${baseUrl}/${encodeURIComponent(id)}?fields=${encodeURIComponent(MEDIA_FIELDS)}&access_token=${encodeURIComponent(accessToken)}`;
  const { status, data } = await fetch(url);

  if (status !== 200) {
    const classified = metaOAuth.classifyMetaApiError(status, data);
    throw Object.assign(new Error(`Instagram media refresh error: ${data?.error?.message || status}`), {
      code: 'IG_MEDIA_REFRESH_ERROR',
      status,
      data,
      category: classified.category,
    });
  }

  return normalizeInstagramMedia(data);
}

// ── Normalize ──

function normalizeInstagramMedia(item) {
  const mediaType = item.media_type || 'IMAGE';
  const thumbnailUrl = pickInstagramThumbnailUrl(item);

  return {
    externalId: item.id,
    mediaType,
    caption: String(item.caption || '').trim(),
    mediaUrl: item.media_url || '',
    permalink: item.permalink || '',
    thumbnailUrl,
    timestamp: item.timestamp || null,
    username: item.username || '',
  };
}

function expiresAtFromNow() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Prefer a valid new provider URL; never blank out a previously usable URL.
 * @param {string} candidate
 * @param {string} [existingUrl]
 */
function resolveProviderThumbnailUrl(candidate, existingUrl = '') {
  if (isValidMetaImageUrl(candidate)) return candidate;
  if (isValidMetaImageUrl(existingUrl)) return existingUrl;
  return '';
}

/**
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {object} media
 * @param {object} intRow
 * @param {{ localThumbnailPath?: string }} [options]
 */
async function upsertPost(conn, media, intRow, options = {}) {
  const autoPublish = intRow.config_json?.defaultPublished === true;
  const hasLocalOpt = Object.prototype.hasOwnProperty.call(options, 'localThumbnailPath');
  const localThumbnailPath = hasLocalOpt ? String(options.localThumbnailPath || '') : null;

  const [[existing]] = await conn.query(
    'SELECT id, public_id, is_imported, archived_at, provider_thumbnail_url, provider_thumbnail_local_path FROM social_posts WHERE provider = ? AND provider_external_id = ?',
    [PROVIDER, media.externalId]
  );

  if (existing) {
    if (existing.archived_at) return { action: 'skipped', reason: 'archived' };
    if (existing.is_imported) {
      const thumbnailUrl = resolveProviderThumbnailUrl(media.thumbnailUrl, existing.provider_thumbnail_url);
      const expiresAt = thumbnailUrl ? expiresAtFromNow() : null;
      let pathToStore = hasLocalOpt ? localThumbnailPath : undefined;
      if (hasLocalOpt) {
        // Never clear a valid existing local WebP with empty string on cache failure.
        if (
          !pathToStore
          && existing.provider_thumbnail_local_path
          && thumbnailCache.localThumbnailFileExists(existing.provider_thumbnail_local_path)
        ) {
          pathToStore = existing.provider_thumbnail_local_path;
        }
        await conn.query(
          `UPDATE social_posts SET provider_synced_at = NOW(),
            provider_thumbnail_url = ?, provider_thumbnail_expires_at = ?,
            provider_thumbnail_local_path = ?
           WHERE id = ?`,
          [thumbnailUrl || '', expiresAt, pathToStore || '', existing.id]
        );
      } else {
        await conn.query(
          `UPDATE social_posts SET provider_synced_at = NOW(),
            provider_thumbnail_url = ?, provider_thumbnail_expires_at = ?
           WHERE id = ?`,
          [thumbnailUrl || '', expiresAt, existing.id]
        );
      }
      return { action: 'updated', publicId: existing.public_id };
    }
    return { action: 'skipped', reason: 'manual_post' };
  }

  if (media.permalink) {
    const [[dupe]] = await conn.query(
      "SELECT id FROM social_posts WHERE post_url = ? AND provider = 'manual' AND archived_at IS NULL",
      [media.permalink]
    );
    if (dupe) return { action: 'skipped', reason: 'duplicate_url' };
  }

  const publicId = crypto.randomUUID();
  const title = media.caption.slice(0, 300) || `Instagram post ${media.externalId}`;
  const description = media.caption.length > 300 ? media.caption.slice(300, 800) : '';
  const status = autoPublish ? 'published' : 'draft';

  const thumbnailUrl = resolveProviderThumbnailUrl(media.thumbnailUrl, '');
  const expiresAt = thumbnailUrl ? expiresAtFromNow() : null;
  const insertLocalPath = hasLocalOpt ? localThumbnailPath : '';

  const publishedContentJson = autoPublish ? JSON.stringify({
    platform: 'instagram',
    postUrl: media.permalink,
    title,
    description,
    thumbnailMediaRef: '',
    embedEnabled: false,
    displayMode: 'external',
    isFeatured: false,
  }) : null;

  await conn.query(
    `INSERT INTO social_posts
      (public_id, platform, post_url, title, description, thumbnail_media_ref,
       provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
       embed_enabled, display_mode, is_active, is_featured, sort_order, status,
       published_content_json, provider, provider_external_id, provider_synced_at, is_imported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'external', 1, 0, 0, ?, ?, ?, ?, NOW(), 1)`,
    [publicId, 'instagram', media.permalink, title, description, '',
     thumbnailUrl, expiresAt, insertLocalPath,
     status, publishedContentJson, PROVIDER, media.externalId]
  );

  return { action: 'imported', publicId };
}

/**
 * @param {object} media
 * @param {object} intRow
 * @param {{ accessToken?: string }} [options]
 */
async function prepareAndUpsert(media, intRow, options = {}) {
  const [[existing]] = await pool.query(
    `SELECT id, public_id, is_imported, archived_at, provider_thumbnail_local_path, provider_thumbnail_url
       FROM social_posts
      WHERE provider = ? AND provider_external_id = ?`,
    [PROVIDER, media.externalId]
  );

  if (existing?.archived_at) {
    return {
      action: 'skipped',
      reason: 'archived',
      thumbnailCache: thumbnailCache.toThumbnailCacheMeta({
        status: thumbnailCache.CACHE_STATUS.NO_SOURCE,
        cached: false,
        attempted: false,
      }),
    };
  }
  if (existing && !existing.is_imported) {
    return {
      action: 'skipped',
      reason: 'manual_post',
      thumbnailCache: thumbnailCache.toThumbnailCacheMeta({
        status: thumbnailCache.CACHE_STATUS.NO_SOURCE,
        cached: false,
        attempted: false,
      }),
    };
  }

  let working = media;
  let prepared = await thumbnailCache.ensureProviderThumbnailCached({
    provider: PROVIDER,
    sourceUrl: working.thumbnailUrl || '',
    existingLocalPath: existing?.provider_thumbnail_local_path || '',
  });

  let refreshAttempts = 0;
  if (
    thumbnailCache.isRetryableCacheFailure(prepared)
    && working.externalId
  ) {
    const accessToken = options.accessToken || await metaOAuth.getUserAccessToken(PROVIDER);
    if (accessToken) {
      try {
        refreshAttempts = 1;
        // Call through exports so tests can stub metadata refresh.
        const refreshed = await module.exports.fetchInstagramMediaById(working.externalId, accessToken);
        if (refreshed?.thumbnailUrl) {
          working = { ...working, ...refreshed };
          prepared = await thumbnailCache.ensureProviderThumbnailCached({
            provider: PROVIDER,
            sourceUrl: working.thumbnailUrl || '',
            existingLocalPath: existing?.provider_thumbnail_local_path || '',
          });
        }
      } catch {
        /* keep first failure diagnostics */
      }
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Call through exports so tests can stub persistence failures.
    const result = await module.exports.upsertPost(conn, working, intRow, {
      localThumbnailPath: prepared.localPath,
    });
    await conn.commit();

    if (result.action === 'skipped' && prepared.createdAbsolute) {
      const imageProcessing = require('./imageProcessingService');
      await imageProcessing.deleteProcessedImage(prepared.createdAbsolute);
    } else if (
      prepared.createdAbsolute
      && prepared.replacedPrevious
      && prepared.replacedPrevious !== prepared.localPath
    ) {
      await thumbnailCache.deleteLocalThumbnailSafe(prepared.replacedPrevious);
    }

    return {
      ...result,
      thumbnailCache: {
        ...thumbnailCache.toThumbnailCacheMeta(prepared),
        refreshAttempts,
      },
    };
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    if (prepared.createdAbsolute) {
      const imageProcessing = require('./imageProcessingService');
      await imageProcessing.deleteProcessedImage(prepared.createdAbsolute);
    }
    throw err;
  } finally {
    conn.release();
  }
}

function recordThumbnailOutcome(thumbnailStats, thumbnailErrors, result) {
  const meta = result?.thumbnailCache || {};
  thumbnailCache.accumulateThumbnailStat(thumbnailStats, {
    status: meta.status,
    cached: meta.cached,
    skippedDownload: meta.reused,
    errorCode: meta.code,
  });
  if (
    meta.cached !== true
    && meta.status
    && meta.status !== thumbnailCache.CACHE_STATUS.CACHED_NEW
    && meta.status !== thumbnailCache.CACHE_STATUS.CACHED_EXISTING
    && meta.status !== thumbnailCache.CACHE_STATUS.NO_SOURCE
  ) {
    thumbnailErrors.push({
      provider: PROVIDER,
      code: meta.code || meta.status,
      status: meta.httpStatus ?? null,
      host: meta.sourceHost || null,
    });
  } else if (meta.status === thumbnailCache.CACHE_STATUS.NO_SOURCE) {
    /* counted in noSource — no error entry */
  } else if (meta.status === thumbnailCache.CACHE_STATUS.INVALID_SOURCE) {
    thumbnailErrors.push({
      provider: PROVIDER,
      code: meta.code || 'INVALID_URL',
      status: null,
      host: meta.sourceHost || null,
    });
  }
}

/**
 * Imported Instagram rows that may need local thumbnail repair (ordered for Home first).
 * Not limited by config.maxPosts — that only controls provider discovery.
 */
async function listImportedPostsForThumbnailBackfill() {
  const [rows] = await pool.query(
    `SELECT id, public_id, provider_external_id, provider_thumbnail_local_path,
            provider_thumbnail_url, status, is_active, sort_order, published_at, created_at
       FROM social_posts
      WHERE provider = ?
        AND is_imported = 1
        AND archived_at IS NULL
        AND provider_external_id IS NOT NULL
        AND provider_external_id != ''
      ORDER BY
        CASE
          WHEN status = 'published' AND is_active = 1 THEN 0
          WHEN status = 'published' THEN 1
          ELSE 2
        END ASC,
        sort_order ASC,
        COALESCE(published_at, created_at) DESC,
        id ASC`,
    [PROVIDER]
  );
  return rows;
}

/**
 * After normal sync: repair imported posts outside the provider media window.
 * @param {object} intRow
 * @param {string} accessToken
 * @param {{ limit?: number }} [options]
 */
async function backfillLegacyThumbnails(intRow, accessToken, options = {}) {
  const limit = Math.min(
    500,
    Math.max(1, Number(options.limit) || thumbnailCache.THUMBNAIL_BACKFILL_LIMIT)
  );
  const backfillStats = thumbnailCache.createEmptyBackfillStats();
  const rawErrors = [];

  const rows = await listImportedPostsForThumbnailBackfill();
  backfillStats.scanned = rows.length;

  const needed = rows.filter((row) =>
    thumbnailCache.needsLocalThumbnailBackfill(row.provider_thumbnail_local_path)
  );
  backfillStats.needed = needed.length;
  const batch = needed.slice(0, limit);

  for (const row of batch) {
    try {
      const media = await module.exports.fetchInstagramMediaById(row.provider_external_id, accessToken);
      const result = await module.exports.prepareAndUpsert(media, intRow, { accessToken });
      const meta = result?.thumbnailCache || {};
      if (meta.cached === true && meta.reused === true) {
        backfillStats.reused += 1;
      } else if (meta.cached === true) {
        backfillStats.cached += 1;
      } else {
        backfillStats.failed += 1;
        rawErrors.push({
          provider: PROVIDER,
          code: meta.code || meta.status || 'CACHE_FAIL',
          status: meta.httpStatus ?? null,
          host: meta.sourceHost || null,
        });
      }
    } catch (err) {
      const classified = metaOAuth.classifyMetaApiError(err.status, err.data);
      if (metaOAuth.requiresReconnect(classified.category)) {
        await metaOAuth.handleConnectionFailure(PROVIDER, classified.category);
        throw Object.assign(
          new Error(metaOAuth.friendlyAuthErrorMessage(classified.category)),
          {
            code: 'META_RECONNECT_REQUIRED',
            category: classified.category,
            authError: true,
            status: err.status,
            data: err.data,
          }
        );
      }
      if (thumbnailCache.isProviderMediaUnavailableError(err)) {
        backfillStats.unavailable += 1;
        rawErrors.push({
          provider: PROVIDER,
          code: 'UNAVAILABLE',
          status: err.status ?? null,
          host: null,
        });
        continue;
      }
      backfillStats.failed += 1;
      rawErrors.push({
        provider: PROVIDER,
        code: err.code || 'BACKFILL_FAIL',
        status: err.status ?? null,
        host: null,
      });
    }
  }

  return {
    backfillStats,
    backfillErrors: thumbnailCache.summarizeThumbnailErrors(rawErrors),
  };
}

// ── Main sync ──

async function syncInstagram(intRow) {
  const config = intRow.config_json || {};
  const igUserId = config.igUserId;
  if (!igUserId) {
    throw Object.assign(new Error('Instagram account ID no configurado.'), { code: 'NO_IG_USER_ID' });
  }

  const validation = await metaOAuth.validateToken(PROVIDER);
  if (!validation.valid) {
    await metaOAuth.handleConnectionFailure(PROVIDER, validation.category);
    throw Object.assign(
      new Error(metaOAuth.friendlyAuthErrorMessage(validation.category)),
      {
        code: metaOAuth.requiresReconnect(validation.category)
          ? 'META_RECONNECT_REQUIRED'
          : 'TOKEN_INVALID',
        category: validation.category,
        authError: metaOAuth.requiresReconnect(validation.category),
      }
    );
  }

  const accessToken = await metaOAuth.getUserAccessToken(PROVIDER);
  if (!accessToken) {
    await metaOAuth.handleConnectionFailure(PROVIDER, 'missing');
    throw Object.assign(
      new Error(metaOAuth.friendlyAuthErrorMessage('missing')),
      { code: 'META_RECONNECT_REQUIRED', category: 'missing', authError: true }
    );
  }

  const maxResults = Math.min(50, Math.max(1, Number(config.maxPosts) || MAX_MEDIA_DEFAULT));
  let items;
  try {
    items = await fetchInstagramMedia(igUserId, accessToken, maxResults);
  } catch (err) {
    const classified = metaOAuth.classifyMetaApiError(err.status, err.data);
    if (metaOAuth.requiresReconnect(classified.category)) {
      await metaOAuth.handleConnectionFailure(PROVIDER, classified.category);
      throw Object.assign(
        new Error(metaOAuth.friendlyAuthErrorMessage(classified.category)),
        {
          code: 'META_RECONNECT_REQUIRED',
          category: classified.category,
          authError: true,
          status: err.status,
          data: err.data,
        }
      );
    }
    throw err;
  }

  let imported = 0;
  let skipped = 0;
  let updated = 0;
  const thumbnailStats = thumbnailCache.createEmptyThumbnailStats();
  const rawThumbErrors = [];

  for (const media of items) {
    if (!media.externalId) { skipped++; continue; }
    try {
      const result = await prepareAndUpsert(media, intRow, { accessToken });
      if (result.action === 'imported') imported++;
      else if (result.action === 'updated') updated++;
      else skipped++;
      if (result.action === 'imported' || result.action === 'updated') {
        recordThumbnailOutcome(thumbnailStats, rawThumbErrors, result);
      }
    } catch {
      skipped++;
    }
  }

  const { backfillStats, backfillErrors } = await backfillLegacyThumbnails(intRow, accessToken);

  return {
    imported,
    skipped,
    updated,
    thumbnailStats,
    thumbnailErrors: thumbnailCache.summarizeThumbnailErrors(rawThumbErrors),
    backfillStats,
    backfillErrors,
  };
}

module.exports = {
  PROVIDER,
  THUMBNAIL_BACKFILL_LIMIT: thumbnailCache.THUMBNAIL_BACKFILL_LIMIT,
  syncInstagram,
  fetchInstagramMedia,
  fetchInstagramMediaById,
  normalizeInstagramMedia,
  pickInstagramThumbnailUrl,
  pickChildThumbnailUrl,
  upsertPost,
  prepareAndUpsert,
  listImportedPostsForThumbnailBackfill,
  backfillLegacyThumbnails,
  isValidMetaImageUrl,
  setHttpGet,
};
