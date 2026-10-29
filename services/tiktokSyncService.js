/**
 * TikTok Sync Service — Phase 2E-C (Close).
 *
 * Imports public videos from a connected TikTok account via Display API v2.
 *
 * Thumbnail strategy:
 * - `provider_thumbnail_url` stores expiring TikTok cover_image_url
 * - `provider_thumbnail_local_path` stores persistent WebP under UPLOAD_PUBLIC_ROOT/social/tiktok/
 * - `thumbnail_media_ref` is reserved for local Media Library assets only
 * - During sync, only provider-managed metadata is updated (never manual fields)
 *
 * Display mode:
 * - TikTok videos use `embed` with `embed_enabled=true`
 * - Embed src uses canonical TikTok embed URL: https://www.tiktok.com/embed/v2/{videoId}
 */
const crypto = require('node:crypto');
const pool = require('../config/db');
const tiktok = require('./tiktokOAuthService');
const thumbnailCache = require('./socialProviderThumbnailService');

const PROVIDER = 'tiktok';
const MAX_VIDEOS_DEFAULT = 25;
const MAX_PAGES = 3;

// Thumbnail TTL: TikTok cover images have short TTL (~1 hour typical)
// We use 24h as a conservative bound; sync refreshes them frequently.
const THUMBNAIL_TTL_MS = 24 * 60 * 60 * 1000;

const {
  isValidTikTokThumbnail,
  ALLOWED_THUMBNAIL_ORIGINS,
} = thumbnailCache;

// ── HTTP mock ──

let _httpGet = null;
let _httpPost = null;
function setHttpGet(fn) { _httpGet = fn; }
function setHttpPost(fn) { _httpPost = fn; }

// ── Video list ──

async function fetchVideoList(accessToken, maxResults = MAX_VIDEOS_DEFAULT) {
  const limit = Math.min(20, Math.max(1, maxResults));
  let allVideos = [];
  let cursor = 0;
  let pages = 0;

  while (pages < MAX_PAGES && allVideos.length < maxResults) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const raw = await fetch(`${tiktok.API_BASE}/video/list/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ max_count: limit, cursor }),
        signal: controller.signal,
      });

      const responseData = await raw.json();
      const data = responseData?.data || {};
      const videos = data.videos || [];

      if (!videos.length) break;

      allVideos.push(...videos);
      cursor = data.cursor || 0;
      pages++;
      if (!data.has_more) break;

    } catch (err) {
      if (pages === 0) throw err;
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  return allVideos.slice(0, maxResults).map(normalizeTikTokVideo);
}

// ── Normalize ──

function normalizeTikTokVideo(item) {
  const videoId = item.id || '';
  const title = item.title || (item.video_description || '').slice(0, 200) || `TikTok ${videoId}`;
  const description = item.video_description || '';

  // Only store cover_image_url if it's from an allowed origin
  const coverUrl = isValidTikTokThumbnail(item.cover_image_url) ? item.cover_image_url : '';

  return {
    externalId: videoId,
    title,
    description: description.length > 800 ? description.slice(0, 797) + '...' : description,
    coverImageUrl: coverUrl,
    shareUrl: item.share_url || `https://www.tiktok.com/@user/video/${videoId}`,
    createTime: item.create_time ? new Date(item.create_time * 1000).toISOString() : null,
    duration: item.duration || 0,
    // TikTok embed URL: canonical https://www.tiktok.com/embed/v2/{videoId}
    embedSrc: `https://www.tiktok.com/embed/v2/${videoId}`,
  };
}

// ── Video query (for refreshing thumbnail URLs) ──

async function queryVideos(accessToken, videoIds) {
  if (!videoIds.length) return [];

  const batch = videoIds.slice(0, 20);
  const raw = await fetch(`${tiktok.API_BASE}/video/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filters: { video_ids: batch },
    }),
  });

  const responseData = await raw.json();
  const data = responseData?.data || {};
  return (data.videos || []).map(v => ({
    id: v.id,
    coverImageUrl: isValidTikTokThumbnail(v.cover_image_url) ? v.cover_image_url : '',
    shareUrl: v.share_url || '',
    title: v.title || '',
  }));
}

// ── Provider-managed fields update only ──

const PROVIDER_MANAGED_FIELDS = Object.freeze([
  'provider_synced_at',
  'provider_thumbnail_url',
  'provider_thumbnail_expires_at',
  'provider_thumbnail_local_path',
]);

function expiresAtFromNow() {
  return new Date(Date.now() + THUMBNAIL_TTL_MS);
}

/**
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {object} video
 * @param {object} intRow
 * @param {{ localThumbnailPath?: string }} [options]
 */
async function upsertPost(conn, video, intRow, options = {}) {
  const autoPublish = intRow.config_json?.defaultPublished === true;
  const hasLocalOpt = Object.prototype.hasOwnProperty.call(options, 'localThumbnailPath');
  const localThumbnailPath = hasLocalOpt ? String(options.localThumbnailPath || '') : null;

  const [[existing]] = await conn.query(
    `SELECT id, public_id, is_imported, archived_at,
            thumbnail_media_ref, title, description, status, published_content_json
     FROM social_posts WHERE provider = ? AND provider_external_id = ?`,
    [PROVIDER, video.externalId]
  );

  if (existing) {
    if (existing.archived_at) return { action: 'skipped', reason: 'archived' };

    // Manual post — never overwrite
    if (!existing.is_imported) return { action: 'skipped', reason: 'manual_post' };

    // Imported post — update ONLY provider-managed fields
    // Never touch: title, description, thumbnail_media_ref, status, published_content_json
    const expiresAt = expiresAtFromNow();
    if (hasLocalOpt) {
      await conn.query(
        `UPDATE social_posts
         SET provider_synced_at = NOW(),
             provider_thumbnail_url = ?,
             provider_thumbnail_expires_at = ?,
             provider_thumbnail_local_path = ?
         WHERE id = ?`,
        [video.coverImageUrl || '', expiresAt, localThumbnailPath, existing.id]
      );
    } else {
      await conn.query(
        `UPDATE social_posts
         SET provider_synced_at = NOW(),
             provider_thumbnail_url = ?,
             provider_thumbnail_expires_at = ?
         WHERE id = ?`,
        [video.coverImageUrl || '', expiresAt, existing.id]
      );
    }
    return { action: 'updated', publicId: existing.public_id };
  }

  // Check canonical URL duplicate
  if (video.shareUrl) {
    const [[dupe]] = await conn.query(
      "SELECT id FROM social_posts WHERE post_url = ? AND provider = 'manual' AND archived_at IS NULL",
      [video.shareUrl]
    );
    if (dupe) return { action: 'skipped', reason: 'duplicate_url' };
  }

  const publicId = crypto.randomUUID();
  const status = autoPublish ? 'published' : 'draft';
  const expiresAt = expiresAtFromNow();
  const insertLocalPath = hasLocalOpt ? localThumbnailPath : '';

  // `thumbnail_media_ref` stays EMPTY — reserved for local Media Library
  // `provider_thumbnail_url` holds the expiring TikTok cover
  // Display mode: embed with TikTok modal support
  const publishedContentJson = autoPublish ? JSON.stringify({
    platform: 'tiktok',
    postUrl: video.shareUrl,
    title: video.title,
    description: video.description,
    thumbnailMediaRef: '',
    embedEnabled: true,
    displayMode: 'embed',
    isFeatured: false,
  }) : null;

  await conn.query(
    `INSERT INTO social_posts
      (public_id, platform, post_url, title, description,
       thumbnail_media_ref, provider_thumbnail_url, provider_thumbnail_expires_at,
       provider_thumbnail_local_path,
       embed_enabled, display_mode, is_active, is_featured, sort_order, status,
       published_content_json, provider, provider_external_id, provider_synced_at, is_imported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?, ?, NOW(), 1)`,
    [publicId, 'tiktok', video.shareUrl, video.title, video.description,
     '', video.coverImageUrl || '', expiresAt, insertLocalPath,
     true, 'embed', status,
     publishedContentJson, PROVIDER, video.externalId]
  );

  return { action: 'imported', publicId };
}

async function prepareAndUpsert(video, intRow) {
  const [[existing]] = await pool.query(
    `SELECT id, public_id, is_imported, archived_at, provider_thumbnail_local_path
       FROM social_posts
      WHERE provider = ? AND provider_external_id = ?`,
    [PROVIDER, video.externalId]
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

  const prepared = await thumbnailCache.ensureProviderThumbnailCached({
    provider: PROVIDER,
    sourceUrl: video.coverImageUrl || '',
    existingLocalPath: existing?.provider_thumbnail_local_path || '',
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await module.exports.upsertPost(conn, video, intRow, {
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
      thumbnailCache: thumbnailCache.toThumbnailCacheMeta(prepared),
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

// ── Main sync ──

async function syncTikTok(intRow) {
  const accessToken = await tiktok.getValidAccessToken(PROVIDER);
  if (!accessToken) {
    const validation = await tiktok.validateToken(PROVIDER);
    if (!validation.valid) {
      await tiktok.handleConnectionFailure(PROVIDER, validation.category);
    }
    throw Object.assign(new Error('Token de acceso TikTok no disponible.'), { code: 'NO_TOKEN' });
  }

  const config = intRow.config_json || {};
  const maxResults = Math.min(50, Math.max(1, Number(config.maxVideos) || MAX_VIDEOS_DEFAULT));
  const items = await fetchVideoList(accessToken, maxResults);

  let imported = 0;
  let skipped = 0;
  let updated = 0;
  const thumbnailStats = thumbnailCache.createEmptyThumbnailStats();
  const rawThumbErrors = [];

  for (const video of items) {
    if (!video.externalId) { skipped++; continue; }
    try {
      const result = await prepareAndUpsert(video, intRow);
      if (result.action === 'imported') imported++;
      else if (result.action === 'updated') updated++;
      else skipped++;
      if (result.action === 'imported' || result.action === 'updated') {
        const meta = result.thumbnailCache || {};
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
          rawThumbErrors.push({
            provider: PROVIDER,
            code: meta.code || meta.status,
            status: meta.httpStatus ?? null,
            host: meta.sourceHost || null,
          });
        }
      }
    } catch {
      skipped++;
    }
  }

  return {
    imported,
    skipped,
    updated,
    thumbnailStats,
    thumbnailErrors: thumbnailCache.summarizeThumbnailErrors(rawThumbErrors),
  };
}

module.exports = {
  PROVIDER,
  syncTikTok,
  fetchVideoList,
  queryVideos,
  normalizeTikTokVideo,
  upsertPost,
  prepareAndUpsert,
  setHttpGet,
  setHttpPost,
  isValidTikTokThumbnail,
  ALLOWED_THUMBNAIL_ORIGINS,
  MAX_VIDEOS_DEFAULT,
  MAX_PAGES,
  THUMBNAIL_TTL_MS,
  PROVIDER_MANAGED_FIELDS,
};
