/**
 * Testimonial Service — Phase 2D.
 * CRUD, reorder, archive, draft/publish, restore for manually curated testimonials.
 */
const crypto = require('node:crypto');
const pool = require('../config/db');
const { recordRevision } = require('./contentRevisionService');
const { validateTestimonialInput } = require('../validators/testimonialValidator');

const ALLOWED_PLATFORMS = Object.freeze(['instagram', 'facebook', 'google', 'tripadvisor', 'other']);

async function validateMediaExists(ref) {
  if (!ref || !ref.startsWith('media://')) return null;
  const publicId = ref.replace('media://', '');
  try {
    const [rows] = await pool.query(
      `SELECT id FROM media_assets
        WHERE public_id = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
      [publicId]
    );
    if (!rows.length) return 'El medio referenciado no existe o no está activo.';
    return null;
  } catch {
    return 'Error al validar la referencia del medio.';
  }
}

async function validateTestimonial(body) {
  const result = validateTestimonialInput(body);
  // Additional async validations
  if (result.sanitized.avatarMediaRef) {
    const mediaErr = await validateMediaExists(result.sanitized.avatarMediaRef);
    if (mediaErr) {
      result.errors.push(mediaErr);
      result.valid = false;
    }
  }
  return result;
}

function rowToJson(row) {
  return {
    id: row.id,
    publicId: row.public_id,
    displayName: row.display_name,
    testimonialText: row.testimonial_text,
    platform: row.platform,
    sourceUrl: row.source_url,
    avatarMediaRef: row.avatar_media_ref,
    rating: row.rating,
    isActive: Boolean(row.is_active),
    isFeatured: Boolean(row.is_featured),
    sortOrder: row.sort_order,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at,
  };
}

async function listTestimonials(filters = {}) {
  let sql = 'SELECT * FROM testimonials WHERE archived_at IS NULL';
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
  return rows.map(rowToJson);
}

async function getTestimonial(publicId) {
  const [rows] = await pool.query(
    'SELECT * FROM testimonials WHERE public_id = ? AND archived_at IS NULL LIMIT 1',
    [publicId]
  );
  return rows.length ? rowToJson(rows[0]) : null;
}

async function nextSortOrder() {
  const [[{ maxOrder }]] = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM testimonials WHERE archived_at IS NULL'
  );
  return maxOrder + 1;
}

async function createTestimonial(data, userId) {
  const publicId = crypto.randomUUID();
  const [result] = await pool.query(
    `INSERT INTO testimonials
      (public_id, display_name, testimonial_text, platform, source_url,
       avatar_media_ref, rating, is_active, is_featured, sort_order,
       status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [publicId, data.displayName, data.testimonialText, data.platform,
     data.sourceUrl, data.avatarMediaRef, data.rating,
     data.isActive, data.isFeatured,
     await nextSortOrder(), userId, userId]
  );

  await recordRevision({
    entityType: 'testimonial',
    entityId: result.insertId,
    action: 'metadata_edit',
    newData: { ...data, publicId },
    changedBy: userId,
  });

  return getTestimonial(publicId);
}

async function updateTestimonial(publicId, data, userId, { expectedUpdatedAt = null } = {}) {
  const existing = await getTestimonial(publicId);
  if (!existing) throw new Error('Testimonio no encontrado.');

  if (expectedUpdatedAt) {
    const iso = new Date(expectedUpdatedAt).toISOString().slice(0, 19);
    const existingIso = existing.updatedAt instanceof Date
      ? existing.updatedAt.toISOString().slice(0, 19)
      : String(existing.updatedAt || '').slice(0, 19);
    if (iso !== existingIso) {
      const err = new Error('El testimonio fue modificado por otro usuario. Recargá e intentá nuevamente.');
      err.code = 'STALE_UPDATE';
      throw err;
    }
  }

  await pool.query(
    `UPDATE testimonials SET
       display_name = ?, testimonial_text = ?, platform = ?, source_url = ?,
       avatar_media_ref = ?, rating = ?, is_active = ?, is_featured = ?,
       status = 'draft', updated_by = ?
     WHERE public_id = ? AND archived_at IS NULL`,
    [data.displayName, data.testimonialText, data.platform,
     data.sourceUrl, data.avatarMediaRef, data.rating,
     data.isActive, data.isFeatured, userId, publicId]
  );

  await recordRevision({
    entityType: 'testimonial',
    entityId: existing.id,
    action: 'metadata_edit',
    previousData: existing,
    newData: { ...existing, ...data },
    changedBy: userId,
  });

  return getTestimonial(publicId);
}

async function archiveTestimonial(publicId, userId) {
  const existing = await getTestimonial(publicId);
  if (!existing) throw new Error('Testimonio no encontrado.');

  await pool.query(
    'UPDATE testimonials SET archived_at = NOW(), updated_by = ? WHERE public_id = ?',
    [userId, publicId]
  );

  await recordRevision({
    entityType: 'testimonial',
    entityId: existing.id,
    action: 'archive',
    previousData: existing,
    changedBy: userId,
  });

  return true;
}

async function reorderTestimonials(orderedIds, userId) {
  let firstId = 0;
  for (let i = 0; i < orderedIds.length; i++) {
    await pool.query(
      'UPDATE testimonials SET sort_order = ?, updated_by = ? WHERE public_id = ? AND archived_at IS NULL',
      [i, userId, orderedIds[i]]
    );
    if (i === 0) {
      const [[found]] = await pool.query('SELECT id FROM testimonials WHERE public_id = ? AND archived_at IS NULL', [orderedIds[0]]);
      if (found) firstId = found.id;
    }
  }

  await recordRevision({
    entityType: 'testimonial',
    entityId: firstId || 1,
    action: 'reorder',
    newData: { order: orderedIds },
    changedBy: userId,
  });
}

async function publishTestimonial(publicId, userId) {
  const existing = await getTestimonial(publicId);
  if (!existing) throw new Error('Testimonio no encontrado.');

  const contentJson = JSON.stringify({
    displayName: existing.displayName,
    testimonialText: existing.testimonialText,
    platform: existing.platform,
    sourceUrl: existing.sourceUrl,
    avatarMediaRef: existing.avatarMediaRef,
    rating: existing.rating,
    isFeatured: existing.isFeatured,
  });

  await pool.query(
    `UPDATE testimonials SET
       status = 'published', published_content_json = ?, published_at = NOW(), updated_by = ?
     WHERE public_id = ?`,
    [contentJson, userId, publicId]
  );

  await recordRevision({
    entityType: 'testimonial',
    entityId: existing.id,
    action: 'publish',
    newData: { publicId, status: 'published' },
    changedBy: userId,
  });

  return getTestimonial(publicId);
}

async function restoreTestimonialDraft(publicId, userId, sourceRevisionId) {
  const existing = await getTestimonial(publicId);
  if (!existing) throw new Error('Testimonio no encontrado.');

  const [rows] = await pool.query(
    'SELECT published_content_json FROM testimonials WHERE public_id = ?',
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

  await pool.query(
    `UPDATE testimonials SET
       display_name = ?, testimonial_text = ?, platform = ?, source_url = ?,
       avatar_media_ref = ?, rating = ?, is_featured = ?, updated_by = ?
     WHERE public_id = ? AND archived_at IS NULL`,
    [
      snapshot.displayName || existing.displayName,
      snapshot.testimonialText || existing.testimonialText,
      snapshot.platform || existing.platform,
      snapshot.sourceUrl || existing.sourceUrl,
      snapshot.avatarMediaRef || existing.avatarMediaRef,
      snapshot.rating ?? existing.rating,
      snapshot.isFeatured ? 1 : 0,
      userId,
      publicId,
    ]
  );

  await recordRevision({
    entityType: 'testimonial',
    entityId: existing.id,
    action: 'restore',
    previousData: existing,
    newData: { ...existing, ...snapshot },
    changeSummary: 'Restaurado desde snapshot publicado.',
    changedBy: userId,
    sourceRevisionId: sourceRevisionId || null,
  });

  return getTestimonial(publicId);
}

async function setActive(publicId, active, userId) {
  await pool.query(
    'UPDATE testimonials SET is_active = ?, status = IF(status = ?,"draft",status), updated_by = ? WHERE public_id = ?',
    [active ? 1 : 0, 'published', userId, publicId]
  );

  const testimonial = await getTestimonial(publicId);
  await recordRevision({
    entityType: 'testimonial',
    entityId: testimonial?.id || 1,
    action: active ? 'activate' : 'deactivate',
    newData: { publicId, isActive: active },
    changedBy: userId,
  });
}

/**
 * Public query: only published, active, non-archived testimonials.
 */
function parsePublishedSnapshot(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

async function getPublicTestimonials(settings = {}) {
  const limit = Math.min(12, Math.max(1, Number(settings.maxItems) || 6));
  const platformFilters = Array.isArray(settings.platforms) && settings.platforms.length
    ? settings.platforms.filter(p => ALLOWED_PLATFORMS.includes(p))
    : [...ALLOWED_PLATFORMS];

  const [rows] = await pool.query(
    `SELECT * FROM testimonials
      WHERE status = 'published' AND is_active = 1 AND archived_at IS NULL
        AND published_content_json IS NOT NULL
      ORDER BY sort_order ASC, published_at DESC, id DESC`
  );

  const testimonials = rows.map(row => {
    const snap = parsePublishedSnapshot(row.published_content_json);
    if (!snap) return null;
    const platform = ALLOWED_PLATFORMS.includes(snap.platform) ? snap.platform : 'other';
    if (!platformFilters.includes(platform)) return null;
    if (settings.featuredOnly && snap.isFeatured !== true) return null;
    return {
      publicId: row.public_id,
      displayName: String(snap.displayName || ''),
      testimonialText: String(snap.testimonialText || ''),
      platform,
      sourceUrl: String(snap.sourceUrl || ''),
      avatarMediaRef: String(snap.avatarMediaRef || ''),
      rating: snap.rating ?? null,
      isFeatured: snap.isFeatured === true,
      sortOrder: Number(row.sort_order) || 0,
      publishedAt: row.published_at,
    };
  }).filter(Boolean);

  const selected = testimonials.slice(0, limit);
  return selected;
}

module.exports = {
  ALLOWED_PLATFORMS,
  validateTestimonial,
  validateMediaExists,
  listTestimonials,
  getTestimonial,
  createTestimonial,
  updateTestimonial,
  archiveTestimonial,
  reorderTestimonials,
  publishTestimonial,
  restoreTestimonialDraft,
  setActive,
  getPublicTestimonials,
};
