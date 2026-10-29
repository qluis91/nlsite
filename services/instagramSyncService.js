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

// ── Fetch media ──

async function fetchInstagramMedia(igUserId, accessToken, maxResults = MAX_MEDIA_DEFAULT) {
  const limit = Math.min(50, Math.max(1, maxResults));
  const baseUrl = metaOAuth.getBaseUrl();
  const fields = [
    'id', 'caption', 'media_type', 'media_url', 'permalink',
    'thumbnail_url', 'timestamp', 'username',
    'children{media_url,media_type,thumbnail_url}',
  ].join(',');

  const url = `${baseUrl}/${igUserId}/media?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`;
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

// ── Normalize ──

function normalizeInstagramMedia(item) {
  const mediaType = item.media_type || 'IMAGE';
  const isCarousel = mediaType === 'CAROUSEL_ALBUM';

  let thumbnailUrl = '';
  if (isCarousel && Array.isArray(item.children?.data)) {
    const firstChild = item.children.data[0];
    thumbnailUrl = firstChild?.thumbnail_url || firstChild?.media_url || '';
  } else {
    thumbnailUrl = item.thumbnail_url || item.media_url || '';
  }

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
    'SELECT id, public_id, is_imported, archived_at FROM social_posts WHERE provider = ? AND provider_external_id = ?',
    [PROVIDER, media.externalId]
  );

  if (existing) {
    if (existing.archived_at) return { action: 'skipped', reason: 'archived' };
    if (existing.is_imported) {
      const thumbnailUrl = isValidMetaImageUrl(media.thumbnailUrl) ? media.thumbnailUrl : '';
      const expiresAt = thumbnailUrl ? expiresAtFromNow() : null;
      if (hasLocalOpt) {
        await conn.query(
          `UPDATE social_posts SET provider_synced_at = NOW(),
            provider_thumbnail_url = ?, provider_thumbnail_expires_at = ?,
            provider_thumbnail_local_path = ?
           WHERE id = ?`,
          [thumbnailUrl || '', expiresAt, localThumbnailPath, existing.id]
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

  const thumbnailUrl = isValidMetaImageUrl(media.thumbnailUrl) ? media.thumbnailUrl : '';
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

async function prepareAndUpsert(media, intRow) {
  const [[existing]] = await pool.query(
    `SELECT id, public_id, is_imported, archived_at, provider_thumbnail_local_path
       FROM social_posts
      WHERE provider = ? AND provider_external_id = ?`,
    [PROVIDER, media.externalId]
  );

  if (existing?.archived_at) return { action: 'skipped', reason: 'archived' };
  if (existing && !existing.is_imported) return { action: 'skipped', reason: 'manual_post' };

  const thumbUrl = isValidMetaImageUrl(media.thumbnailUrl) ? media.thumbnailUrl : '';
  const prepared = await thumbnailCache.ensureProviderThumbnailCached({
    provider: PROVIDER,
    sourceUrl: thumbUrl,
    existingLocalPath: existing?.provider_thumbnail_local_path || '',
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Call through exports so tests can stub persistence failures.
    const result = await module.exports.upsertPost(conn, media, intRow, {
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

    return result;
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

  for (const media of items) {
    if (!media.externalId) { skipped++; continue; }
    try {
      const result = await prepareAndUpsert(media, intRow);
      if (result.action === 'imported') imported++;
      else if (result.action === 'updated') updated++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return { imported, skipped, updated };
}

module.exports = {
  PROVIDER,
  syncInstagram,
  fetchInstagramMedia,
  normalizeInstagramMedia,
  upsertPost,
  prepareAndUpsert,
  isValidMetaImageUrl,
  setHttpGet,
};
