/**
 * Content revision/audit service — Phase 11A.
 *
 * Records safe metadata snapshots for every CMS write. File contents,
 * credentials, session data and filesystem roots are never stored.
 * The publishing/rollback UI belongs to a later phase; this service only
 * guarantees the history exists.
 */
const pool = require('../config/db');
const { REVISION_ENTITY_TYPES, REVISION_ACTIONS } = require('../config/cmsOptions');

const ENTITY_TYPE_VALUES = Object.values(REVISION_ENTITY_TYPES);
const ACTION_VALUES = Object.values(REVISION_ACTIONS);
const SUMMARY_MAX_LENGTH = 300;

/** Allowlisted media fields. Absolute paths are deliberately excluded. */
const MEDIA_SNAPSHOT_FIELDS = Object.freeze([
  'public_id',
  'filename',
  'original_name',
  'storage_path',
  'public_url',
  'thumbnail_path',
  'mime_type',
  'extension',
  'file_size',
  'width',
  'height',
  'checksum',
  'title',
  'alt_text',
  'description',
  'category',
  'status',
]);

function mediaSnapshot(asset) {
  if (!asset) return null;
  const snapshot = {};
  for (const field of MEDIA_SNAPSHOT_FIELDS) {
    if (asset[field] === undefined) continue;
    snapshot[field] = asset[field] instanceof Date ? asset[field].toISOString() : asset[field];
  }
  return snapshot;
}

function serialize(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

/**
 * Append a revision. Uses the supplied connection when the caller is inside a
 * transaction so the audit row commits atomically with the change.
 */
async function recordRevision({
  entityType,
  entityId,
  action,
  previousData = null,
  newData = null,
  changeSummary = null,
  changedBy = null,
}, connection = pool) {
  if (!ENTITY_TYPE_VALUES.includes(entityType)) {
    throw new Error('Tipo de entidad de revisión no válido.');
  }
  if (!ACTION_VALUES.includes(action)) {
    throw new Error('Acción de revisión no válida.');
  }
  const id = Number(entityId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Identificador de entidad de revisión no válido.');
  }

  const [[current]] = await connection.query(
    `SELECT COALESCE(MAX(revision_number), 0) AS last_revision
       FROM content_revisions WHERE entity_type = ? AND entity_id = ?`,
    [entityType, id]
  );
  const revisionNumber = Number(current.last_revision) + 1;

  await connection.query(
    `INSERT INTO content_revisions
       (entity_type, entity_id, revision_number, action, previous_data, new_data, change_summary, changed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      id,
      revisionNumber,
      action,
      serialize(previousData),
      serialize(newData),
      changeSummary ? String(changeSummary).slice(0, SUMMARY_MAX_LENGTH) : null,
      changedBy || null,
    ]
  );
  return revisionNumber;
}

async function listRevisions(entityType, entityId, limit = 20) {
  const bounded = Math.min(100, Math.max(1, Number(limit) || 20));
  const [rows] = await pool.query(
    `SELECT r.id, r.revision_number, r.action, r.change_summary, r.created_at,
            r.previous_data, r.new_data, u.name AS actor_name
       FROM content_revisions r
       LEFT JOIN users u ON u.id = r.changed_by
      WHERE r.entity_type = ? AND r.entity_id = ?
      ORDER BY r.revision_number DESC
      LIMIT ?`,
    [entityType, Number(entityId), bounded]
  );
  return rows;
}

module.exports = {
  MEDIA_SNAPSHOT_FIELDS,
  mediaSnapshot,
  recordRevision,
  listRevisions,
};
