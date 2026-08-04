/**
 * Instagram Sync Service — Phase 2E-B (Close).
 * Imports media from connected Instagram Professional account via Meta Graph API.
 * Uses configurable API version and correct token selection.
 */
const crypto = require('node:crypto');
const pool = require('../config/db');
const metaOAuth = require('./metaOAuthService');

const PROVIDER = 'instagram';
const MAX_MEDIA_DEFAULT = 25;

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
    const isAuth = status === 401 || status === 403 || data?.error?.code === 190;
    throw Object.assign(new Error(`Instagram API error: ${data?.error?.message || status}`), {
      code: 'IG_API_ERROR', status, authError: isAuth, retryable: !isAuth && (status >= 500 || status === 429),
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

// ── Upsert ──

async function upsertPost(conn, media, intRow) {
  const requireApproval = intRow.require_approval === 1;
  const autoPublish = intRow.config_json?.defaultPublished === true;

  const [[existing]] = await conn.query(
    'SELECT id, public_id, is_imported, archived_at FROM social_posts WHERE provider = ? AND provider_external_id = ?',
    [PROVIDER, media.externalId]
  );

  if (existing) {
    if (existing.archived_at) return { action: 'skipped', reason: 'archived' };
    if (existing.is_imported) {
      await conn.query('UPDATE social_posts SET provider_synced_at = NOW() WHERE id = ?', [existing.id]);
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
       embed_enabled, display_mode, is_active, is_featured, sort_order, status,
       published_content_json, provider, provider_external_id, provider_synced_at, is_imported)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'external', 1, 0, 0, ?, ?, ?, ?, NOW(), 1)`,
    [publicId, 'instagram', media.permalink, title, description, '',
     status, publishedContentJson, PROVIDER, media.externalId]
  );

  return { action: 'imported', publicId };
}

// ── Main sync ──

async function syncInstagram(intRow) {
  const config = intRow.config_json || {};
  const igUserId = config.igUserId;
  if (!igUserId) {
    throw Object.assign(new Error('Instagram account ID no configurado.'), { code: 'NO_IG_USER_ID' });
  }

  // Validate token before syncing
  const validation = await metaOAuth.validateToken(PROVIDER);
  if (!validation.valid) {
    await metaOAuth.handleConnectionFailure(PROVIDER, validation.category);
    throw Object.assign(
      new Error(`Token de Instagram inválido: ${validation.reason}. Reconecta la integración.`),
      { code: 'TOKEN_INVALID', category: validation.category, authError: true }
    );
  }

  const accessToken = await metaOAuth.getUserAccessToken(PROVIDER);
  if (!accessToken) {
    throw Object.assign(new Error('Token de acceso no disponible para Instagram.'), { code: 'NO_TOKEN' });
  }

  const maxResults = Math.min(50, Math.max(1, Number(config.maxPosts) || MAX_MEDIA_DEFAULT));
  const items = await fetchInstagramMedia(igUserId, accessToken, maxResults);

  const conn = await pool.getConnection();
  let imported = 0, skipped = 0, updated = 0;
  try {
    await conn.beginTransaction();
    for (const media of items) {
      if (!media.externalId) { skipped++; continue; }
      try {
        const result = await upsertPost(conn, media, intRow);
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
  syncInstagram,
  fetchInstagramMedia,
  normalizeInstagramMedia,
  upsertPost,
  setHttpGet,
};
