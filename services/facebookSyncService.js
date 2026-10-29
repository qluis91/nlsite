/**
 * Facebook Sync Service — Phase 2E-B (Close).
 * Imports posts from connected Facebook Page via Meta Graph API.
 * Uses configurable API version and correct Page access token.
 * Provider thumbnails are persisted locally via socialProviderThumbnailService.
 */
const crypto = require('node:crypto');
const pool = require('../config/db');
const metaOAuth = require('./metaOAuthService');
const thumbnailCache = require('./socialProviderThumbnailService');

const PROVIDER = 'facebook';
const MAX_POSTS_DEFAULT = 25;

const { isValidMetaImageUrl } = thumbnailCache;

// ── Pluggable HTTP mock ──

let _httpGet = null;
function setHttpGet(fn) { _httpGet = fn; }

async function fetch(url) {
  if (_httpGet) return _httpGet(url);
  return metaOAuth.httpGet(url);
}

// ── Fetch posts ──

async function fetchFacebookPosts(pageId, accessToken, maxResults = MAX_POSTS_DEFAULT) {
  const limit = Math.min(100, Math.max(1, maxResults));
  const baseUrl = metaOAuth.getBaseUrl();

  const fields = [
    'id', 'message', 'full_picture', 'created_time', 'permalink_url',
  ].join(',');

  const url = `${baseUrl}/${pageId}/posts?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`;
  const { status, data } = await fetch(url);

  if (status !== 200) {
    const classified = metaOAuth.classifyMetaApiError(status, data);
    const isAuth = classified.category !== 'transient' && metaOAuth.requiresReconnect(classified.category);
    throw Object.assign(new Error(`Facebook API error: ${data?.error?.message || status}`), {
      code: 'FB_API_ERROR',
      status,
      data,
      authError: isAuth,
      category: classified.category,
      retryable: !isAuth && (status >= 500 || status === 429),
    });
  }

  return (data.data || [])
    .filter(item => {
      if (!item.message && !item.full_picture) return false;
      return true;
    })
    .map(normalizeFacebookPost);
}

// ── Normalize ──

function normalizeFacebookPost(item) {
  const postId = item.id;
  const message = String(item.message || '').trim();
  const createdTime = item.created_time || null;
  const fullPicture = item.full_picture || '';
  const permalink = item.permalink_url || (postId ? `https://www.facebook.com/${postId}` : '');

  return {
    externalId: postId,
    message,
    fullPicture,
    permalink,
    createdTime,
  };
}

function expiresAtFromNow() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {object} post
 * @param {object} intRow
 * @param {{ localThumbnailPath?: string }} [options]
 */
async function upsertPost(conn, post, intRow, options = {}) {
  const autoPublish = intRow.config_json?.defaultPublished === true;
  const hasLocalOpt = Object.prototype.hasOwnProperty.call(options, 'localThumbnailPath');
  const localThumbnailPath = hasLocalOpt ? String(options.localThumbnailPath || '') : null;

  const [[existing]] = await conn.query(
    'SELECT id, public_id, is_imported, archived_at FROM social_posts WHERE provider = ? AND provider_external_id = ?',
    [PROVIDER, post.externalId]
  );

  if (existing) {
    if (existing.archived_at) return { action: 'skipped', reason: 'archived' };
    if (existing.is_imported) {
      const thumbnailUrl = isValidMetaImageUrl(post.fullPicture) ? post.fullPicture : '';
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

  if (post.permalink) {
    const [[dupe]] = await conn.query(
      "SELECT id FROM social_posts WHERE post_url = ? AND provider = 'manual' AND archived_at IS NULL",
      [post.permalink]
    );
    if (dupe) return { action: 'skipped', reason: 'duplicate_url' };
  }

  const publicId = crypto.randomUUID();
  const title = post.message.slice(0, 300) || `Facebook post ${post.externalId}`;
  const description = post.message.length > 300 ? post.message.slice(300, 800) : '';
  const status = autoPublish ? 'published' : 'draft';

  const thumbnailUrl = isValidMetaImageUrl(post.fullPicture) ? post.fullPicture : '';
  const expiresAt = thumbnailUrl ? expiresAtFromNow() : null;
  const insertLocalPath = hasLocalOpt ? localThumbnailPath : '';

  const publishedContentJson = autoPublish ? JSON.stringify({
    platform: 'facebook',
    postUrl: post.permalink,
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
    [publicId, 'facebook', post.permalink, title, description, '',
     thumbnailUrl, expiresAt, insertLocalPath,
     status, publishedContentJson, PROVIDER, post.externalId]
  );

  return { action: 'imported', publicId };
}

async function prepareAndUpsert(post, intRow) {
  const [[existing]] = await pool.query(
    `SELECT id, public_id, is_imported, archived_at, provider_thumbnail_local_path
       FROM social_posts
      WHERE provider = ? AND provider_external_id = ?`,
    [PROVIDER, post.externalId]
  );

  if (existing?.archived_at) return { action: 'skipped', reason: 'archived' };
  if (existing && !existing.is_imported) return { action: 'skipped', reason: 'manual_post' };

  const thumbUrl = isValidMetaImageUrl(post.fullPicture) ? post.fullPicture : '';
  const prepared = await thumbnailCache.ensureProviderThumbnailCached({
    provider: PROVIDER,
    sourceUrl: thumbUrl,
    existingLocalPath: existing?.provider_thumbnail_local_path || '',
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Call through exports so tests can stub persistence failures.
    const result = await module.exports.upsertPost(conn, post, intRow, {
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

async function syncFacebook(intRow) {
  const config = intRow.config_json || {};
  const pageId = config.pageId;
  if (!pageId) {
    throw Object.assign(new Error('Facebook Page ID no configurado.'), { code: 'NO_PAGE_ID' });
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

  const pageToken = await metaOAuth.getPageAccessToken(pageId);
  if (!pageToken) {
    const message = 'El acceso a la página de Facebook ya no es válido. Reconectá Meta para generar un nuevo Page Access Token.';
    await metaOAuth.handleConnectionFailure(PROVIDER, 'missing', { message });
    throw Object.assign(new Error(message), {
      code: 'META_RECONNECT_REQUIRED',
      category: 'missing',
      authError: true,
    });
  }
  const accessToken = pageToken;

  const pageIdHash = pageId ? pageId.substring(0, 4) + '...' + pageId.slice(-4) : 'none';
  console.log(JSON.stringify({
    ts: new Date().toISOString(), provider: PROVIDER, stage: 'facebook_sync_start',
    endpoint: 'page_posts', pageIdHash, tokenType: 'page',
  }));

  const maxResults = Math.min(100, Math.max(1, Number(config.maxPosts) || MAX_POSTS_DEFAULT));
  let items;
  try {
    items = await fetchFacebookPosts(pageId, accessToken, maxResults);
  } catch (err) {
    const classified = metaOAuth.classifyMetaApiError(err.status, err.data);
    if (metaOAuth.requiresReconnect(classified.category)) {
      const message = classified.category === 'permission_denied'
        ? 'Facebook ya no permite leer las publicaciones de esta página. Reconectá Meta y autorizá nuevamente los permisos.'
        : 'El acceso a la página de Facebook ya no es válido. Reconectá Meta para generar un nuevo Page Access Token.';
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        provider: PROVIDER,
        stage: 'facebook_page_auth_error',
        pageIdHash,
        errorCode: classified.errorCode,
        errorSubcode: classified.errorSubcode,
        category: classified.category,
        endpoint: 'page_posts',
      }));
      await metaOAuth.handleConnectionFailure(PROVIDER, classified.category, { message });
      throw Object.assign(new Error(message), {
        code: 'META_RECONNECT_REQUIRED',
        category: classified.category,
        authError: true,
        status: err.status,
        data: err.data,
      });
    }
    throw err;
  }

  let imported = 0;
  let skipped = 0;
  let updated = 0;

  for (const post of items) {
    if (!post.externalId) { skipped++; continue; }
    try {
      const result = await prepareAndUpsert(post, intRow);
      if (result.action === 'imported') imported++;
      else if (result.action === 'updated') updated++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  console.log(JSON.stringify({
    ts: new Date().toISOString(), provider: PROVIDER, stage: 'facebook_sync_done',
    pageIdHash, imported, skipped, updated,
  }));

  return { imported, skipped, updated };
}

module.exports = {
  PROVIDER,
  syncFacebook,
  fetchFacebookPosts,
  normalizeFacebookPost,
  upsertPost,
  prepareAndUpsert,
  isValidMetaImageUrl,
  setHttpGet,
};
