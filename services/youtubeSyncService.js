/**
 * YouTube Sync Service — Phase 2E-A.
 *
 * Fetches recent videos from a YouTube channel via the Data API v3,
 * normalizes them to the social_posts model, and upserts without
 * overwriting manual edits.
 *
 * All external calls are abstracted behind a pluggable `httpGet`
 * function so tests can mock the transport layer completely.
 */

const pool = require('../config/db');
const crypto = require('node:crypto');

// ── Constants ──

const PROVIDER = 'youtube';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_MAX_VIDEOS = 20;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

// ── Configuration helpers ──

function getYoutubeApiKey() {
  // Priority: env var → social_integrations.config_json.apiKey
  return process.env.YOUTUBE_API_KEY || '';
}

function getChannelId(intConfig) {
  return (intConfig && typeof intConfig === 'object' ? intConfig.channelId : null) || '';
}

function getMaxVideos(intConfig) {
  const v = (intConfig && typeof intConfig === 'object' ? intConfig.maxVideos : null) || DEFAULT_MAX_VIDEOS;
  return Math.min(50, Math.max(1, Number(v)));
}

function shouldAutoPublish(intConfig) {
  if (!intConfig || typeof intConfig !== 'object') return false;
  return intConfig.defaultPublished === true || intConfig.defaultPublished === 'true';
}

// ── HTTP transport (pluggable) ──

/**
 * Default HTTP GET. Tests replace this with a mock.
 * @param {string} url
 * @returns {Promise<{status: number, data: object}>}
 */
let _httpGet = null;

function setHttpGet(fn) {
  _httpGet = fn;
}

async function httpGet(url) {
  if (_httpGet) return _httpGet(url);
  // Use native fetch (Node 18+) for real calls
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const data = await resp.json();
    return { status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// ── Retry logic ──

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await httpGet(url);
      if (result.status === 200) return result;
      if (result.status === 403 || result.status === 400 || result.status === 404) {
        // Non-retryable: quota exceeded, invalid key, not found
        throw Object.assign(new Error(`YouTube API error ${result.status}: ${JSON.stringify(result.data?.error || 'unknown')}`), { status: result.status, data: result.data, retryable: false });
      }
      if (RETRYABLE_STATUSES.has(result.status)) {
        lastError = Object.assign(new Error(`YouTube API ${result.status}`), { status: result.status, retryable: true });
        if (attempt < retries) await sleep(1000 * (attempt + 1)); // exponential-ish backoff
        continue;
      }
      throw Object.assign(new Error(`YouTube API error ${result.status}`), { status: result.status, retryable: false });
    } catch (err) {
      if (err.retryable !== undefined) { lastError = err; if (attempt < retries) await sleep(1000 * (attempt + 1)); continue; }
      // Network error → retryable
      lastError = Object.assign(new Error(`Network error: ${err.message}`), { retryable: true });
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError || new Error('Max retries exceeded');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Channel → Uploads playlist resolution ──

async function resolveUploadsPlaylistId(channelId, apiKey) {
  const url = `${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;
  const { data } = await fetchWithRetry(url);
  const items = data.items || [];
  if (!items.length) {
    throw Object.assign(new Error(`Canal de YouTube no encontrado: ${channelId}`), { code: 'CHANNEL_NOT_FOUND', retryable: false });
  }
  const playlistId = items[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) {
    throw Object.assign(new Error('No se pudo resolver la lista de uploads del canal.'), { code: 'NO_UPLOADS_PLAYLIST', retryable: false });
  }
  return playlistId;
}

// ── Fetch playlist items ──

async function fetchPlaylistItems(playlistId, apiKey, maxResults) {
  const items = [];
  let pageToken = null;
  const pageSize = Math.min(50, maxResults);

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId,
      maxResults: String(pageSize),
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);

    const { data } = await fetchWithRetry(`${YOUTUBE_API_BASE}/playlistItems?${params.toString()}`);
    const pageItems = data.items || [];
    for (const item of pageItems) {
      items.push(item);
      if (items.length >= maxResults) return items;
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return items;
}

// ── Normalize ──

function normalizeVideo(item) {
  const snippet = item.snippet || {};
  const resourceId = snippet.resourceId || {};
  const videoId = resourceId.videoId || '';
  const title = String(snippet.title || '').trim();
  const description = String(snippet.description || '').trim();
  const publishedAt = snippet.publishedAt || null;

  // Build safe thumbnail URL (default quality first, then medium, then high)
  const thumbs = snippet.thumbnails || {};
  const thumb = thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || null;

  // Canonical YouTube URL
  const postUrl = videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : '';

  return {
    videoId,
    title: title.slice(0, 300),
    description: description.slice(0, 500),
    postUrl,
    thumbnailUrl: thumb?.url || '',
    publishedAt,
  };
}

// ── Upsert ──

async function upsertPost(connection, video, intRow) {
  const requireApproval = intRow.require_approval === 1;
  const autoPublish = shouldAutoPublish(intRow.config_json);
  const status = autoPublish ? 'published' : 'draft';

  // Check if post with this provider_external_id already exists
  const [[existing]] = await connection.query(
    'SELECT id, public_id, provider, provider_external_id, title, description, post_url, provider_synced_at, is_imported, archived_at FROM social_posts WHERE provider = ? AND provider_external_id = ?',
    [PROVIDER, video.videoId]
  );

  if (existing) {
    if (existing.archived_at) {
      // Archived imported post → skip
      return { action: 'skipped', reason: 'archived' };
    }

    // Preserve manual edits: if post was manually edited after import,
    // only update provider_synced_at, don't overwrite content
    if (existing.is_imported) {
      // Imported post: update thumbnail-related fields but preserve title/desc if edited
      await connection.query(
        'UPDATE social_posts SET provider_synced_at = NOW() WHERE id = ?',
        [existing.id]
      );
      return { action: 'updated', publicId: existing.public_id };
    }

    // Manual post with same videoId? Skip — preserve manual content
    return { action: 'skipped', reason: 'manual_post' };
  }

  // Check for duplicate URL (manual post with same canonical URL)
  const [[dupeUrl]] = await connection.query(
    "SELECT id FROM social_posts WHERE post_url = ? AND provider = 'manual' AND archived_at IS NULL",
    [video.postUrl]
  );
  if (dupeUrl) {
    return { action: 'skipped', reason: 'duplicate_url' };
  }

  // Create new post
  const publicId = crypto.randomUUID();
  const publishedContentJson = autoPublish ? JSON.stringify({
    platform: 'youtube',
    postUrl: video.postUrl,
    title: video.title,
    description: video.description,
    thumbnailMediaRef: '',
    embedEnabled: true,
    displayMode: 'embed',
    isFeatured: false,
  }) : null;

  await connection.query(
    `INSERT INTO social_posts
      (public_id, platform, post_url, title, description, thumbnail_media_ref,
       embed_enabled, display_mode, is_active, is_featured, sort_order, status,
       published_content_json, provider, provider_external_id, provider_synced_at, is_imported,
       created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?, ?, NOW(), 1, 0, 0)`,
    [
      publicId, 'youtube', video.postUrl, video.title, video.description,
      '', 1, 'embed', status,
      publishedContentJson, PROVIDER, video.videoId,
    ]
  );

  return { action: 'imported', publicId };
}

// ── Main sync entry point ──

/**
 * Execute a YouTube sync.
 * @param {object} intRow — social_integrations row for youtube
 * @returns {{ imported: number, skipped: number, updated: number, errors: string[] }}
 */
async function syncYoutube(intRow) {
  const errors = [];
  let imported = 0;
  let skipped = 0;
  let updated = 0;

  const apiKey = getYoutubeApiKey();
  if (!apiKey) {
    throw Object.assign(new Error('YOUTUBE_API_KEY no configurada.'), { code: 'NO_API_KEY', retryable: false });
  }

  const channelId = getChannelId(intRow.config_json);
  if (!channelId) {
    throw Object.assign(new Error('Channel ID de YouTube no configurado.'), { code: 'NO_CHANNEL_ID', retryable: false });
  }

  const maxVideos = getMaxVideos(intRow.config_json);

  // 1. Resolve uploads playlist
  let playlistId;
  try {
    playlistId = await resolveUploadsPlaylistId(channelId, apiKey);
  } catch (err) {
    throw err; // non-retryable for bad channel
  }

  // 2. Fetch playlist items
  let items;
  try {
    items = await fetchPlaylistItems(playlistId, apiKey, maxVideos);
  } catch (err) {
    throw Object.assign(new Error(`Error al obtener videos: ${err.message}`), { code: 'FETCH_ERROR', retryable: err.retryable !== false });
  }

  // 3. Normalize and upsert in a transaction
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const item of items) {
      const video = normalizeVideo(item);
      if (!video.videoId || !video.postUrl) {
        skipped++;
        continue;
      }
      try {
        const result = await upsertPost(conn, video, intRow);
        if (result.action === 'imported') imported++;
        else if (result.action === 'updated') updated++;
        else skipped++;
      } catch (upsertErr) {
        errors.push(`Error upserting ${video.videoId}: ${upsertErr.message}`);
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

  return { imported, skipped, updated, errors };
}

module.exports = {
  PROVIDER,
  getYoutubeApiKey,
  getChannelId,
  getMaxVideos,
  shouldAutoPublish,
  setHttpGet,
  resolveUploadsPlaylistId,
  fetchPlaylistItems,
  normalizeVideo,
  upsertPost,
  syncYoutube,
  fetchWithRetry,
  YOUTUBE_API_BASE,
  DEFAULT_MAX_VIDEOS,
  REQUEST_TIMEOUT_MS,
};
