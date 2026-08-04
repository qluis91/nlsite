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
  const fields = [
    'id', 'message', 'full_picture', 'created_time', 'permalink_url', 'type',
  ].join(',');

  const url = `${baseUrl}/${pageId}/feed?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`;
  const { status, data } = await fetch(url);

  if (status !== 200) {
    const isAuth = status === 401 || status === 403 || data?.error?.code === 190;
    throw Object.assign(new Error(`Facebook API error: ${data?.error?.message || status}`), {
      code: 'FB_API_ERROR', status, authError: isAuth, retryable: !isAuth && (status >= 500 || status === 429),
    });
  }

  return (data.data || [])
    .filter(item => {
      if (item.is_published === false) return false;
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
    type: item.type || '',
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

  // Validate token before syncing
  const validation = await metaOAuth.validateToken(PROVIDER);
  if (!validation.valid) {
    await metaOAuth.handleConnectionFailure(PROVIDER, validation.category);
    throw Object.assign(
      new Error(`Token de Facebook inválido: ${validation.reason}. Reconecta la integración.`),
      { code: 'TOKEN_INVALID', category: validation.category, authError: true }
    );
  }

  // Use Page access token for Page feed calls
  const pageToken = await metaOAuth.getPageAccessToken(pageId);
  const accessToken = pageToken || await metaOAuth.getUserAccessToken(PROVIDER);
  if (!accessToken) {
    throw Object.assign(new Error('Token de acceso no disponible para Facebook.'), { code: 'NO_TOKEN' });
  }

  const maxResults = Math.min(100, Math.max(1, Number(config.maxPosts) || MAX_POSTS_DEFAULT));
  const items = await fetchFacebookPosts(pageId, accessToken, maxResults);

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
