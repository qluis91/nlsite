/**
 * Facebook Sync Service — Phase 2E-B (Close).
 * Imports posts from connected Facebook Page via Meta Graph API.
 * Uses configurable API version and correct Page access token.
 */
const crypto = require('node:crypto');
const pool = require('../config/db');
const metaOAuth = require('./metaOAuthService');

const PROVIDER = 'facebook';
const MAX_POSTS_DEFAULT = 25;

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

  // Use /{page-id}/posts (Page-owned posts) — only requires pages_read_engagement.
  // /feed would require pages_read_user_content or Page Public Content Access.
  const fields = [
    'id', 'message', 'full_picture', 'created_time', 'permalink_url',
  ].join(',');

  const url = `${baseUrl}/${pageId}/posts?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`;
  const { status, data } = await fetch(url);

  if (status !== 200) {
    // Error #10 = permission/endpoint error (OAuthException with code 10)
    const isPermission = data?.error?.code === 10;
    const isAuth = status === 401 || status === 403 || data?.error?.code === 190 || isPermission;
    throw Object.assign(new Error(`Facebook API error: ${data?.error?.message || status}`), {
      code: 'FB_API_ERROR', status, data, authError: isAuth, retryable: !isAuth && (status >= 500 || status === 429),
    });
  }

  return (data.data || [])
    .filter(item => {
      // /posts returns only published Page-owned posts — no need to filter is_published
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

// ── Upsert ──

async function upsertPost(conn, post, intRow) {
  const requireApproval = intRow.require_approval === 1;
  const autoPublish = intRow.config_json?.defaultPublished === true;

  const [[existing]] = await conn.query(
    'SELECT id, public_id, is_imported, archived_at FROM social_posts WHERE provider = ? AND provider_external_id = ?',
    [PROVIDER, post.externalId]
  );

  if (existing) {
    if (existing.archived_at) return { action: 'skipped', reason: 'archived' };
    if (existing.is_imported) {
      await conn.query('UPDATE social_posts SET provider_synced_at = NOW() WHERE id = ?', [existing.id]);
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
       embed_enabled, display_mode, is_active, is_featured, sort_order, status,
       published_content_json, provider, provider_external_id, provider_synced_at, is_imported)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'external', 1, 0, 0, ?, ?, ?, ?, NOW(), 1)`,
    [publicId, 'facebook', post.permalink, title, description, '',
     status, publishedContentJson, PROVIDER, post.externalId]
  );

  return { action: 'imported', publicId };
}

// ── Main sync ──

async function syncFacebook(intRow) {
  const config = intRow.config_json || {};
  const pageId = config.pageId;
  if (!pageId) {
    throw Object.assign(new Error('Facebook Page ID no configurado.'), { code: 'NO_PAGE_ID' });
  }

  // Validate user token before syncing
  const validation = await metaOAuth.validateToken(PROVIDER);
  if (!validation.valid) {
    await metaOAuth.handleConnectionFailure(PROVIDER, validation.category);
    throw Object.assign(
      new Error(`Token de Facebook inválido: ${validation.reason}. Reconecta la integración.`),
      { code: 'TOKEN_INVALID', category: validation.category, authError: true }
    );
  }

  // Use Page Access Token exclusively for Page-owned posts (/posts endpoint).
  // The user token's permissions are insufficient for Page content queries.
  const pageToken = await metaOAuth.getPageAccessToken(pageId);
  if (!pageToken) {
    throw Object.assign(
      new Error('Page Access Token no disponible. Reconecta la integración de Facebook para regenerarlo.'),
      { code: 'NO_PAGE_TOKEN', authError: true }
    );
  }
  const accessToken = pageToken;

  // Safe diagnostics: log endpoint, page ID hash, token type
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
    // Classify error #10 specifically for a clean Admin message
    if (err.status && err.data?.error?.code === 10) {
      console.log(JSON.stringify({
        ts: new Date().toISOString(), provider: PROVIDER, stage: 'facebook_permission_error',
        pageIdHash, errorCode: 10, endpoint: 'page_posts',
      }));
      throw Object.assign(
        new Error('Facebook rechazó la consulta de publicaciones de la página. Verificá que el Page Access Token sea válido y que el permiso pages_read_engagement esté concedido.'),
        { code: 'FB_PERMISSION_ERROR', status: err.status, authError: true, retryable: false }
      );
    }
    throw err;
  }

  const conn = await pool.getConnection();
  let imported = 0, skipped = 0, updated = 0;
  try {
    await conn.beginTransaction();
    for (const post of items) {
      if (!post.externalId) { skipped++; continue; }
      try {
        const result = await upsertPost(conn, post, intRow);
        if (result.action === 'imported') imported++;
        else if (result.action === 'updated') updated++;
        else skipped++;
      } catch {
        skipped++;
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
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
  setHttpGet,
};
