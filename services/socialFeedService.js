/**
 * Social Feed Service — Phase 2A.
 * CRUD, reorder, archive, draft/publish, restore for manually curated social posts.
 */
const crypto = require('node:crypto');
const pool = require('../config/db');
const { recordRevision } = require('./contentRevisionService');
const cmsContent = require('./cmsContentService');
const { deriveSocialEmbed } = require('./socialEmbedService');

const ALLOWED_PLATFORMS = Object.freeze(['instagram', 'facebook', 'tiktok', 'youtube', 'other']);
const ALLOWED_DISPLAY_MODES = Object.freeze(['external_link', 'embed']);
const MAX_TITLE = 300;
const MAX_DESC = 500;
const MAX_URL = 2048;

function h(str) { return String(str || '').trim(); }

function safeUrl(value) {
  const v = h(value);
  if (!v) return '';
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return '';
}

function safeExternalUrl(value) {
  const candidate = h(value);
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function parsePublishedSnapshot(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function validatePlatformUrl(url, platform) {
  if (!url) return null;
  const patterns = {
    instagram: /^https?:\/\/(www\.)?instagram\.com\//i,
    facebook: /^https?:\/\/(www\.)?(facebook\.com|fb\.com)\//i,
    tiktok: /^https?:\/\/(www\.)?tiktok\.com\//i,
    youtube: /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i,
  };
  const pattern = patterns[platform];
  if (pattern && !pattern.test(url)) {
    return `La URL no coincide con el formato esperado para ${platform}.`;
  }
  return null;
}

async function validateMediaRef(ref) {
  if (!ref) return null;
  if (!ref.startsWith('media://')) return 'Referencia de medio inválida.';
  const publicId = ref.replace('media://', '');
  if (!/^[0-9a-f-]{32,36}$/i.test(publicId)) return 'ID de medio inválido.';

  // Verify the media asset exists, is active, not archived, and is an image
  try {
    const [rows] = await pool.query(
      `SELECT id, status, deleted_at, mime_type FROM media_assets
        WHERE public_id = ? AND deleted_at IS NULL LIMIT 1`,
      [publicId]
    );
    if (!rows.length) return 'El medio referenciado no existe o fue eliminado.';
    const asset = rows[0];
    if (asset.status !== 'active') return 'El medio referenciado no está activo.';
    if (!String(asset.mime_type || '').startsWith('image/')) return 'El medio referenciado debe ser una imagen.';
  } catch {
    return 'Error al validar la referencia del medio.';
  }
  return null;
}

async function validatePost(body) {
  const errors = [];
  const platform = h(body.platform).toLowerCase() || 'other';
  if (!ALLOWED_PLATFORMS.includes(platform)) errors.push('Plataforma no válida.');
  const displayMode = h(body.displayMode).toLowerCase() || 'external_link';
  if (!ALLOWED_DISPLAY_MODES.includes(displayMode)) errors.push('Modo de visualización no válido.');

  const title = h(body.title);
  if (!title) errors.push('El título es obligatorio.');
  else if (title.length > MAX_TITLE) errors.push(`El título no puede exceder ${MAX_TITLE} caracteres.`);

  const description = h(body.description);
  if (description.length > MAX_DESC) errors.push(`La descripción no puede exceder ${MAX_DESC} caracteres.`);

  const postUrl = h(body.postUrl);
  if (!postUrl) errors.push('La URL del post es obligatoria.');
  else if (postUrl.length > MAX_URL) errors.push(`La URL no puede exceder ${MAX_URL} caracteres.`);
  else if (!/^https?:\/\//i.test(postUrl)) errors.push('La URL debe comenzar con http:// o https://.');
  else {
    const urlErr = validatePlatformUrl(postUrl, platform);
    if (urlErr) errors.push(urlErr);
  }

  const mediaErr = await validateMediaRef(h(body.thumbnailMediaRef));
  if (mediaErr) errors.push(mediaErr);

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      platform,
      postUrl,                     // plain text, escaped at EJS output
      title,                       // plain text, escaped at EJS output
      description,                 // plain text, escaped at EJS output
      thumbnailMediaRef: h(body.thumbnailMediaRef),
      embedEnabled: body.embedEnabled === '1' || body.embedEnabled === 'true' ? 1 : 0,
      displayMode,
      isActive: body.isActive === '0' || body.isActive === 'false' ? 0 : 1,
      isFeatured: body.isFeatured === '1' || body.isFeatured === 'true' ? 1 : 0,
    },
  };
}

function postToJson(post) {
  return {
    id: post.id,
    publicId: post.public_id,
    platform: post.platform,
    postUrl: post.post_url,
    title: post.title,
    description: post.description,
    thumbnailMediaRef: post.thumbnail_media_ref,
    embedEnabled: Boolean(post.embed_enabled),
    displayMode: post.display_mode,
    isActive: Boolean(post.is_active),
    isFeatured: Boolean(post.is_featured),
    sortOrder: post.sort_order,
    status: post.status,
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    publishedAt: post.published_at,
    createdBy: post.created_by,
    updatedBy: post.updated_by,
    archivedAt: post.archived_at,
  };
}

async function listPosts(filters = {}) {
  let sql = 'SELECT * FROM social_posts WHERE archived_at IS NULL';
  const params = [];

  if (filters.platform && ALLOWED_PLATFORMS.includes(filters.platform)) {
    sql += ' AND platform = ?';
    params.push(filters.platform);
  }
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.featured !== undefined) {
    sql += ' AND is_featured = ?';
    params.push(filters.featured ? 1 : 0);
  }
  sql += ' ORDER BY sort_order ASC, created_at DESC';
  const [rows] = await pool.query(sql, params);
  return rows.map(postToJson);
}

async function getPost(publicId) {
  const [rows] = await pool.query(
    'SELECT * FROM social_posts WHERE public_id = ? AND archived_at IS NULL LIMIT 1',
    [publicId]
  );
  return rows.length ? postToJson(rows[0]) : null;
}

async function getPostForEdit(publicId) {
  return getPost(publicId);
}

async function createPost(data, userId) {
  const publicId = crypto.randomUUID();
  const [result] = await pool.query(
    `INSERT INTO social_posts
      (public_id, platform, post_url, title, description, thumbnail_media_ref,
       embed_enabled, display_mode, is_active, is_featured, sort_order, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [publicId, data.platform, data.postUrl, data.title, data.description,
     data.thumbnailMediaRef, data.embedEnabled, data.displayMode,
     data.isActive, data.isFeatured,
     await nextSortOrder(), userId, userId]
  );

  await recordRevision({
    entityType: 'social_post',
    entityId: result.insertId,
    action: 'metadata_edit',
    newData: { ...data, publicId },
    changedBy: userId,
  });

  return getPost(publicId);
}

async function updatePost(publicId, data, userId, { expectedUpdatedAt = null } = {}) {
  const existing = await getPost(publicId);
  if (!existing) throw new Error('Post no encontrado.');

  // Optimistic concurrency: reject if updated_at doesn't match
  if (expectedUpdatedAt) {
    const iso = new Date(expectedUpdatedAt).toISOString().slice(0, 19);
    const existingIso = existing.updatedAt instanceof Date
      ? existing.updatedAt.toISOString().slice(0, 19)
      : String(existing.updatedAt || '').slice(0, 19);
    if (iso !== existingIso) {
      const err = new Error('El post fue modificado por otro usuario. Recargá e intentá nuevamente.');
      err.code = 'STALE_UPDATE';
      throw err;
    }
  }

  const [result] = await pool.query(
    `UPDATE social_posts SET
       platform = ?, post_url = ?, title = ?, description = ?,
       thumbnail_media_ref = ?, embed_enabled = ?, display_mode = ?,
       is_active = ?, is_featured = ?, status = 'draft', updated_by = ?
     WHERE public_id = ? AND archived_at IS NULL`,
    [data.platform, data.postUrl, data.title, data.description,
     data.thumbnailMediaRef, data.embedEnabled, data.displayMode,
     data.isActive, data.isFeatured, userId, publicId]
  );

  await recordRevision({
    entityType: 'social_post',
    entityId: existing.id,
    action: 'metadata_edit',
    previousData: existing,
    newData: { ...existing, ...data },
    changedBy: userId,
  });

  return getPost(publicId);
}

async function archivePost(publicId, userId) {
  const existing = await getPost(publicId);
  if (!existing) throw new Error('Post no encontrado.');

  await pool.query(
    'UPDATE social_posts SET archived_at = NOW(), updated_by = ? WHERE public_id = ?',
    [userId, publicId]
  );

  await recordRevision({
    entityType: 'social_post',
    entityId: existing.id,
    action: 'archive',
    previousData: existing,
    changedBy: userId,
  });

  return true;
}

async function reorderPosts(orderedIds, userId) {
  let firstId = 0;
  for (let i = 0; i < orderedIds.length; i++) {
    await pool.query(
      'UPDATE social_posts SET sort_order = ?, updated_by = ? WHERE public_id = ? AND archived_at IS NULL',
      [i, userId, orderedIds[i]]
    );
    if (i === 0) {
      const [[found]] = await pool.query('SELECT id FROM social_posts WHERE public_id = ? AND archived_at IS NULL', [orderedIds[0]]);
      if (found) firstId = found.id;
    }
  }

  await recordRevision({
    entityType: 'social_post',
    entityId: firstId || 1,
    action: 'reorder',
    newData: { order: orderedIds },
    changedBy: userId,
  });
}

async function publishPost(publicId, userId) {
  const existing = await getPost(publicId);
  if (!existing) throw new Error('Post no encontrado.');

  const contentJson = JSON.stringify({
    platform: existing.platform,
    postUrl: existing.postUrl,
    title: existing.title,
    description: existing.description,
    thumbnailMediaRef: existing.thumbnailMediaRef,
    embedEnabled: existing.embedEnabled,
    displayMode: existing.displayMode,
    isFeatured: existing.isFeatured,
  });

  await pool.query(
    `UPDATE social_posts SET
       status = 'published', published_content_json = ?, published_at = NOW(), updated_by = ?
     WHERE public_id = ?`,
    [contentJson, userId, publicId]
  );

  await recordRevision({
    entityType: 'social_post',
    entityId: existing.id,
    action: 'publish',
    newData: { publicId, status: 'published' },
    changedBy: userId,
  });

  return getPost(publicId);
}

/**
 * Restore a social post from its published snapshot as draft only.
 * Public snapshot remains unchanged until explicit Publish.
 * Links to the source revision.
 */
async function restorePostDraft(publicId, userId, sourceRevisionId) {
  const existing = await getPost(publicId);
  if (!existing) throw new Error('Post no encontrado.');

  // Read the immutable published snapshot
  const [rows] = await pool.query(
    'SELECT published_content_json FROM social_posts WHERE public_id = ?',
    [publicId]
  );
  if (!rows.length || !rows[0].published_content_json) {
    throw new Error('No hay snapshot publicado para restaurar.');
  }

  let snapshot;
  try {
    snapshot = typeof rows[0].published_content_json === 'string'
      ? JSON.parse(rows[0].published_content_json)
      : rows[0].published_content_json;
  } catch {
    throw new Error('El snapshot publicado está corrupto.');
  }

  // Restore draft fields from snapshot — does NOT touch published_content_json or status
  await pool.query(
    `UPDATE social_posts SET
       platform = ?, post_url = ?, title = ?, description = ?,
       thumbnail_media_ref = ?, embed_enabled = ?, display_mode = ?,
       is_featured = ?, updated_by = ?
     WHERE public_id = ? AND archived_at IS NULL`,
    [
      snapshot.platform || existing.platform,
      snapshot.postUrl || existing.postUrl,
      snapshot.title || existing.title,
      snapshot.description || existing.description,
      snapshot.thumbnailMediaRef || existing.thumbnailMediaRef,
      snapshot.embedEnabled ? 1 : 0,
      snapshot.displayMode || 'external_link',
      snapshot.isFeatured ? 1 : 0,
      userId,
      publicId,
    ]
  );

  await recordRevision({
    entityType: 'social_post',
    entityId: existing.id,
    action: 'restore',
    previousData: existing,
    newData: { ...existing, ...snapshot },
    changeSummary: 'Restaurado desde snapshot publicado.',
    changedBy: userId,
    sourceRevisionId: sourceRevisionId || null,
  });

  return getPost(publicId);
}

async function setActive(publicId, active, userId) {
  await pool.query(
    'UPDATE social_posts SET is_active = ?, status = IF(status = ?,"draft",status), updated_by = ? WHERE public_id = ?',
    [active ? 1 : 0, 'published', userId, publicId]
  );

  const post = await getPost(publicId);
  await recordRevision({
    entityType: 'social_post',
    entityId: post?.id || 1,
    action: active ? 'activate' : 'deactivate',
    newData: { publicId, isActive: active },
    changedBy: userId,
  });
}

async function getPublishedPosts() {
  const [rows] = await pool.query(
    `SELECT * FROM social_posts
     WHERE status = 'published' AND archived_at IS NULL AND is_active = 1
     ORDER BY sort_order ASC, created_at DESC`
  );
  return rows.map(postToJson);
}

/**
 * Public Phase 2B projection. Draft columns are deliberately ignored: card
 * content comes from the immutable published snapshot only.
 */
async function getPublicFeed(settings = {}) {
  const maximumPosts = Math.min(12, Math.max(1, Number(settings.maximumPosts) || 6));
  const platformFilters = Array.isArray(settings.platforms)
    ? settings.platforms.filter((platform) => ALLOWED_PLATFORMS.includes(platform))
    : [...ALLOWED_PLATFORMS];
  if (!platformFilters.length) return [];

  const [rows] = await pool.query(
    `SELECT id, public_id, sort_order, published_at, published_content_json
       FROM social_posts
      WHERE status = 'published' AND is_active = 1 AND archived_at IS NULL
        AND published_content_json IS NOT NULL
      ORDER BY sort_order ASC, published_at DESC, id DESC`
  );

  const posts = rows.map((row) => {
    const snapshot = parsePublishedSnapshot(row.published_content_json);
    if (!snapshot) return null;
    const platform = ALLOWED_PLATFORMS.includes(snapshot.platform) ? snapshot.platform : 'other';
    const postUrl = safeExternalUrl(snapshot.postUrl);
    if (!postUrl || !platformFilters.includes(platform)) return null;
    if (settings.featuredOnly && snapshot.isFeatured !== true) return null;
    return {
      id: row.id,
      publicId: row.public_id,
      platform,
      postUrl,
      title: h(snapshot.title),
      description: h(snapshot.description),
      thumbnailMediaRef: h(snapshot.thumbnailMediaRef),
      displayMode: snapshot.displayMode === 'embed' ? 'embed' : 'external',
      embedEnabled: snapshot.embedEnabled === true,
      isFeatured: snapshot.isFeatured === true,
      sortOrder: Number(row.sort_order) || 0,
      publishedAt: row.published_at,
    };
  }).filter(Boolean);

  if (settings.displayOrder === 'newest') {
    posts.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  } else if (settings.displayOrder === 'oldest') {
    posts.sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
  }

  const selected = posts.slice(0, maximumPosts);
  await Promise.all(selected.map(async (post) => {
    const media = post.thumbnailMediaRef
      ? await cmsContent.resolveMediaReference(post.thumbnailMediaRef, null)
      : null;
    post.thumbnailUrl = media?.thumbnailUrl || media?.url || '/images/social-feed-fallback.svg';
    post.thumbnailAlt = media?.altText || post.title || `Publicación de ${post.platform}`;
    post.embed = deriveSocialEmbed(post);
  }));
  return selected;
}

async function nextSortOrder() {
  const [[{ maxOrder }]] = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM social_posts WHERE archived_at IS NULL'
  );
  return maxOrder + 1;
}

module.exports = {
  ALLOWED_PLATFORMS,
  validatePost,
  validateMediaRef,
  listPosts,
  getPost,
  getPostForEdit,
  createPost,
  updatePost,
  archivePost,
  reorderPosts,
  publishPost,
  restorePostDraft,
  setActive,
  getPublishedPosts,
  getPublicFeed,
  safeExternalUrl,
};
