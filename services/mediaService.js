/**
 * Media library service — Phase 11A.
 *
 * Orchestrates validation/processing (mediaStorageService), persistence,
 * reference checks (mediaUsageService) and audit history
 * (contentRevisionService). Every write runs in a transaction and compensates
 * partially written files on failure.
 */
const crypto = require('crypto');
const pool = require('../config/db');
const storage = require('./mediaStorageService');
const usage = require('./mediaUsageService');
const revisions = require('./contentRevisionService');
const publishing = require('./cmsPublishingService');
const {
  MEDIA_STATUSES,
  MEDIA_KINDS,
  MEDIA_PAGE_SIZE,
  UPLOAD_CONCURRENCY,
  REVISION_ENTITY_TYPES,
  REVISION_ACTIONS,
} = require('../config/cmsOptions');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLUMNS = `m.id, m.public_id, m.filename, m.original_name, m.storage_disk, m.storage_path,
  m.public_url, m.thumbnail_path, m.variants_json, m.mime_type, m.extension, m.file_size,
  m.width, m.height, m.model_metadata, m.checksum, m.title, m.alt_text, m.description,
  m.category, m.status, m.created_by, m.updated_by, m.created_at, m.updated_at, m.deleted_at`;

class MediaError extends Error {
  constructor(message, code = 'MEDIA_ERROR') {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

function assertPublicId(publicId) {
  if (!UUID_PATTERN.test(String(publicId || ''))) {
    throw new MediaError('Identificador de medio no válido.', 'INVALID_ID');
  }
  return String(publicId);
}

function kindOf(asset) {
  return String(asset?.mime_type || '').startsWith('model/') ? MEDIA_KINDS.MODEL : MEDIA_KINDS.IMAGE;
}

function decorate(row) {
  if (!row) return null;
  let resolvedPaths = null;
  try {
    resolvedPaths = storage.resolvedAssetPaths(row);
  } catch {
    resolvedPaths = null;
  }
  return {
    ...row,
    storage_path: resolvedPaths?.storagePath || row.storage_path,
    public_url: resolvedPaths?.publicUrl || null,
    thumbnail_path: resolvedPaths?.thumbnailUrl || null,
    path_contract_valid: Boolean(resolvedPaths),
    path_contract_legacy: Boolean(resolvedPaths?.isLegacy),
    variants: storage.parseVariants(row.variants_json),
    model_metadata: storage.parseVariants(row.model_metadata),
    kind: kindOf(row),
    reference: UUID_PATTERN.test(String(row.public_id || '')) ? usage.buildReference(row.public_id) : null,
    is_archived: row.status === MEDIA_STATUSES.ARCHIVED,
  };
}

function invalidateMediaCaches() {
  for (const namespace of [
    'siteSettings',
    'nav_home',
    'sc_home',
    'logoLoop_home',
    'carousel_home',
    'features_home',
  ]) {
    publishing.invalidateNamespace(namespace);
  }
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function getByPublicId(publicId, { includeArchived = true } = {}) {
  const id = assertPublicId(publicId);
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLUMNS}, u.name AS uploader_name
       FROM media_assets m
       LEFT JOIN users u ON u.id = m.created_by
      WHERE m.public_id = ?${includeArchived ? '' : ' AND m.deleted_at IS NULL'}
      LIMIT 1`,
    [id]
  );
  return decorate(rows[0]);
}

async function findActiveByChecksum(checksum) {
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM media_assets m
      WHERE m.checksum = ? AND m.deleted_at IS NULL LIMIT 1`,
    [checksum]
  );
  return decorate(rows[0]);
}

/**
 * Server-side filtering and pagination. Archived assets are excluded unless a
 * status filter explicitly asks for them.
 */
async function listAssets(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.status) {
    conditions.push('m.status = ?');
    params.push(filters.status);
  } else {
    conditions.push('m.deleted_at IS NULL');
  }
  if (filters.search) {
    conditions.push('(m.title LIKE ? OR m.original_name LIKE ? OR m.filename LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  if (filters.category) {
    conditions.push('m.category = ?');
    params.push(filters.category);
  }
  if (filters.kind === MEDIA_KINDS.MODEL) {
    conditions.push("m.mime_type LIKE 'model/%'");
  } else if (filters.kind === MEDIA_KINDS.IMAGE) {
    conditions.push("m.mime_type LIKE 'image/%'");
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.max(1, Number(filters.limit) || MEDIA_PAGE_SIZE);
  const offset = (page - 1) * limit;

  const [rows] = await pool.query(
    `SELECT ${SELECT_COLUMNS}, u.name AS uploader_name
       FROM media_assets m
       LEFT JOIN users u ON u.id = m.created_by
       ${where}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS total FROM media_assets m ${where}`,
    params
  );

  const total = Number(count.total);
  return {
    items: rows.map(decorate),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** Single aggregate query — no per-card follow-up queries. */
async function overviewSummary() {
  const [[summary]] = await pool.query(
    `SELECT
       COUNT(*) AS total_assets,
       COALESCE(SUM(status = 'active' AND deleted_at IS NULL), 0) AS active_assets,
       COALESCE(SUM(status = 'archived'), 0) AS archived_assets,
       COALESCE(SUM(status = 'processing'), 0) AS processing_assets,
       COALESCE(SUM(status = 'failed'), 0) AS failed_assets,
       COALESCE(SUM(mime_type LIKE 'image/%'), 0) AS image_assets,
       COALESCE(SUM(mime_type LIKE 'model/%'), 0) AS model_assets,
       COALESCE(SUM(file_size), 0) AS storage_bytes
     FROM media_assets`
  );
  return {
    totalAssets: Number(summary.total_assets),
    activeAssets: Number(summary.active_assets),
    archivedAssets: Number(summary.archived_assets),
    processingAssets: Number(summary.processing_assets),
    failedAssets: Number(summary.failed_assets),
    imageAssets: Number(summary.image_assets),
    modelAssets: Number(summary.model_assets),
    storageBytes: Number(summary.storage_bytes),
    storageLabel: formatFileSize(summary.storage_bytes),
  };
}

async function recentAssets(limit = 6) {
  const bounded = Math.min(24, Math.max(1, Number(limit) || 6));
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLUMNS}, u.name AS uploader_name
       FROM media_assets m
       LEFT JOIN users u ON u.id = m.created_by
      WHERE m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?`,
    [bounded]
  );
  return rows.map(decorate);
}

/**
 * Validate, process, persist and audit a single upload.
 * Written files are removed if the database write fails.
 */
async function createFromUpload({ file, category, metadata = {}, actorId = null }) {
  const checksum = storage.checksumOf(file?.buffer || Buffer.alloc(0));
  const duplicate = await findActiveByChecksum(checksum);
  if (duplicate) {
    throw new MediaError(
      `El archivo ya existe en la biblioteca (${duplicate.title || duplicate.filename}).`,
      'DUPLICATE'
    );
  }

  const stored = await storage.storeUpload(file, category);
  const publicId = crypto.randomUUID();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO media_assets
         (public_id, filename, original_name, storage_disk, storage_path, public_url,
          thumbnail_path, variants_json, mime_type, extension, file_size, width, height,
          model_metadata, checksum, title, alt_text, description, category, status,
          created_by, updated_by)
       VALUES (?, ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        stored.filename,
        stored.originalName,
        stored.storagePath,
        stored.publicUrl,
        stored.thumbnailPath,
        Object.keys(stored.variants).length ? JSON.stringify(stored.variants) : null,
        stored.mimeType,
        stored.extension,
        stored.fileSize,
        stored.width,
        stored.height,
        stored.modelMetadata ? JSON.stringify(stored.modelMetadata) : null,
        stored.checksum,
        metadata.title || null,
        metadata.altText ?? null,
        metadata.description || null,
        category,
        MEDIA_STATUSES.ACTIVE,
        actorId,
        actorId,
      ]
    );

    const [rows] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ?`,
      [result.insertId]
    );
    await revisions.recordRevision({
      entityType: REVISION_ENTITY_TYPES.MEDIA_ASSET,
      entityId: result.insertId,
      action: REVISION_ACTIONS.UPLOAD,
      previousData: null,
      newData: revisions.mediaSnapshot(rows[0]),
      changeSummary: 'Archivo cargado en la biblioteca multimedia.',
      changedBy: actorId,
    }, connection);

    await connection.commit();
    invalidateMediaCaches();
    return decorate(rows[0]);
  } catch (error) {
    await connection.rollback().catch(() => {});
    await storage.removeStoredPaths(stored.writtenPaths);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Create from selector direct upload. Returns existing asset if duplicate.
 * @param {{ file, category, metadata?, actorId? }} params
 * @returns {Promise<object>} asset record
 */
async function createFromSelectorUpload({ file, category, metadata = {}, actorId = null }) {
  const checksum = storage.checksumOf(file?.buffer || Buffer.alloc(0));
  const duplicate = await findActiveByChecksum(checksum);
  if (duplicate) {
    return duplicate;
  }
  return createFromUpload({ file, category, metadata, actorId });
}

/**
 * Process several uploads with bounded concurrency and report partial success.
 * @returns {Promise<{created: Array, errors: Array<{file: string, message: string}>}>}
 */
async function createManyFromUploads({ files = [], category, metadata = {}, actorId = null }) {
  const created = [];
  const errors = [];
  const queue = [...files];

  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      if (!file) continue;
      try {
        created.push(await createFromUpload({ file, category, metadata, actorId }));
      } catch (error) {
        errors.push({
          file: storage.sanitizeOriginalName(file.originalname) || 'archivo',
          message: error.message,
        });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(UPLOAD_CONCURRENCY, Math.max(1, files.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return { created, errors };
}

/** Only allowlisted metadata is writable; storage fields are immutable. */
async function updateMetadata(publicId, data, actorId = null) {
  const asset = await getByPublicId(publicId);
  if (!asset) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ? FOR UPDATE`,
      [asset.id]
    );
    if (!locked[0]) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');
    const previous = locked[0];

    const nextStatus = data.status || previous.status;
    if (nextStatus !== previous.status && nextStatus === MEDIA_STATUSES.ARCHIVED) {
      await usage.assertNotReferenced(previous.public_id, 'archivar');
    }
    const deletedAt = nextStatus === MEDIA_STATUSES.ARCHIVED ? 'CURRENT_TIMESTAMP' : 'NULL';

    await connection.query(
      `UPDATE media_assets
          SET title = ?, alt_text = ?, description = ?, category = ?, status = ?,
              deleted_at = ${deletedAt}, updated_by = ?
        WHERE id = ?`,
      [
        data.title || null,
        data.altText ?? null,
        data.description || null,
        data.category || previous.category,
        nextStatus,
        actorId,
        asset.id,
      ]
    );

    const [rows] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ?`,
      [asset.id]
    );
    await revisions.recordRevision({
      entityType: REVISION_ENTITY_TYPES.MEDIA_ASSET,
      entityId: asset.id,
      action: REVISION_ACTIONS.METADATA_EDIT,
      previousData: revisions.mediaSnapshot(previous),
      newData: revisions.mediaSnapshot(rows[0]),
      changeSummary: 'Metadatos actualizados.',
      changedBy: actorId,
    }, connection);

    await connection.commit();
    invalidateMediaCaches();
    return decorate(rows[0]);
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Replace the underlying file while preserving the media identity (id and
 * public_id). Old files are removed only after the database commit succeeds.
 */
async function replaceFile(publicId, file, actorId = null) {
  const asset = await getByPublicId(publicId);
  if (!asset) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');
  if (asset.is_archived) {
    throw new MediaError('Restaure el archivo antes de reemplazarlo.', 'ARCHIVED');
  }

  // Type compatibility is checked before anything else so a mismatched file
  // reports the real reason instead of an unrelated duplicate/storage error.
  const incoming = storage.assertUploadAllowed(file, asset.category);
  if (incoming.kind !== asset.kind) {
    throw new MediaError('El tipo del archivo nuevo no coincide con el original.', 'TYPE_MISMATCH');
  }

  const checksum = storage.checksumOf(file?.buffer || Buffer.alloc(0));
  const duplicate = await findActiveByChecksum(checksum);
  if (duplicate && duplicate.id !== asset.id) {
    throw new MediaError('Ese archivo ya existe en la biblioteca.', 'DUPLICATE');
  }

  const stored = await storage.storeUpload(file, asset.category);
  if (stored.kind !== asset.kind) {
    await storage.removeStoredPaths(stored.writtenPaths);
    throw new MediaError('El tipo del archivo nuevo no coincide con el original.', 'TYPE_MISMATCH');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ? FOR UPDATE`,
      [asset.id]
    );
    if (!locked[0]) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');
    const previous = locked[0];

    await connection.query(
      `UPDATE media_assets
          SET filename = ?, original_name = ?, storage_path = ?, public_url = ?,
              thumbnail_path = ?, variants_json = ?, mime_type = ?, extension = ?,
              file_size = ?, width = ?, height = ?, model_metadata = ?, checksum = ?,
              updated_by = ?
        WHERE id = ?`,
      [
        stored.filename,
        stored.originalName,
        stored.storagePath,
        stored.publicUrl,
        stored.thumbnailPath,
        Object.keys(stored.variants).length ? JSON.stringify(stored.variants) : null,
        stored.mimeType,
        stored.extension,
        stored.fileSize,
        stored.width,
        stored.height,
        stored.modelMetadata ? JSON.stringify(stored.modelMetadata) : null,
        stored.checksum,
        actorId,
        asset.id,
      ]
    );

    const [rows] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ?`,
      [asset.id]
    );
    await revisions.recordRevision({
      entityType: REVISION_ENTITY_TYPES.MEDIA_ASSET,
      entityId: asset.id,
      action: REVISION_ACTIONS.REPLACE,
      previousData: revisions.mediaSnapshot(previous),
      newData: revisions.mediaSnapshot(rows[0]),
      changeSummary: 'Archivo reemplazado conservando la misma identidad.',
      changedBy: actorId,
    }, connection);

    await connection.commit();
    await storage.removeStoredPaths(storage.ownedPaths(previous));
    invalidateMediaCaches();
    return decorate(rows[0]);
  } catch (error) {
    await connection.rollback().catch(() => {});
    await storage.removeStoredPaths(stored.writtenPaths);
    throw error;
  } finally {
    connection.release();
  }
}

/** Soft deletion. Physical files are preserved so a restore stays possible. */
async function archive(publicId, actorId = null) {
  const asset = await getByPublicId(publicId);
  if (!asset) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');
  if (asset.is_archived) throw new MediaError('El archivo ya está archivado.', 'ALREADY_ARCHIVED');

  await usage.assertNotReferenced(asset.public_id, 'archivar');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ? FOR UPDATE`,
      [asset.id]
    );
    if (!locked[0]) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');

    await connection.query(
      `UPDATE media_assets
          SET status = ?, deleted_at = CURRENT_TIMESTAMP, updated_by = ?
        WHERE id = ?`,
      [MEDIA_STATUSES.ARCHIVED, actorId, asset.id]
    );
    const [rows] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ?`,
      [asset.id]
    );
    await revisions.recordRevision({
      entityType: REVISION_ENTITY_TYPES.MEDIA_ASSET,
      entityId: asset.id,
      action: REVISION_ACTIONS.ARCHIVE,
      previousData: revisions.mediaSnapshot(locked[0]),
      newData: revisions.mediaSnapshot(rows[0]),
      changeSummary: 'Archivo archivado (eliminación suave).',
      changedBy: actorId,
    }, connection);

    await connection.commit();
    invalidateMediaCaches();
    return decorate(rows[0]);
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function restore(publicId, actorId = null) {
  const asset = await getByPublicId(publicId);
  if (!asset) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');
  if (!asset.is_archived) throw new MediaError('El archivo no está archivado.', 'NOT_ARCHIVED');
  if (!(await storage.storedPathExists(asset.storage_path))) {
    throw new MediaError('No se puede restaurar: el archivo físico ya no existe.', 'FILE_MISSING');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ? FOR UPDATE`,
      [asset.id]
    );
    if (!locked[0]) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');

    await connection.query(
      `UPDATE media_assets SET status = ?, deleted_at = NULL, updated_by = ? WHERE id = ?`,
      [MEDIA_STATUSES.ACTIVE, actorId, asset.id]
    );
    const [rows] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ?`,
      [asset.id]
    );
    await revisions.recordRevision({
      entityType: REVISION_ENTITY_TYPES.MEDIA_ASSET,
      entityId: asset.id,
      action: REVISION_ACTIONS.RESTORE,
      previousData: revisions.mediaSnapshot(locked[0]),
      newData: revisions.mediaSnapshot(rows[0]),
      changeSummary: 'Archivo restaurado desde archivados.',
      changedBy: actorId,
    }, connection);

    await connection.commit();
    invalidateMediaCaches();
    return decorate(rows[0]);
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Permanent deletion. Removes DB record and physical files.
 * Blocked when the asset is referenced by any CMS content.
 * Missing physical files are reported but do not block DB cleanup.
 */
async function permanentDelete(publicId, actorId = null) {
  const asset = await getByPublicId(publicId);
  if (!asset) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');

  await usage.assertNotReferenced(asset.public_id, 'eliminar permanentemente');

  const pathsToRemove = storage.ownedPaths(asset);
  const deleteErrors = [];

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.query(
      `SELECT ${SELECT_COLUMNS} FROM media_assets m WHERE m.id = ? FOR UPDATE`,
      [asset.id]
    );
    if (!locked[0]) throw new MediaError('El archivo no existe en la biblioteca.', 'NOT_FOUND');
    const previous = locked[0];

    await revisions.recordRevision({
      entityType: REVISION_ENTITY_TYPES.MEDIA_ASSET,
      entityId: asset.id,
      action: REVISION_ACTIONS.PERMANENT_DELETE,
      previousData: revisions.mediaSnapshot(previous),
      newData: null,
      changeSummary: 'Archivo eliminado permanentemente.',
      changedBy: actorId,
    }, connection);

    await connection.query('DELETE FROM media_assets WHERE id = ?', [asset.id]);
    await connection.commit();
    invalidateMediaCaches();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  // Physical files removed after successful DB commit
  for (const relPath of pathsToRemove) {
    try {
      const absPath = storage.resolveStoragePath(relPath);
      await require('fs').promises.unlink(absPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        deleteErrors.push(relPath);
      }
    }
  }

  if (deleteErrors.length) {
    console.warn(`[mediaService] ${deleteErrors.length} archivo(s) físico(s) no se pudieron eliminar.`);
  }
}

module.exports = {
  MediaError,
  SELECT_COLUMNS,
  assertPublicId,
  kindOf,
  decorate,
  invalidateMediaCaches,
  formatFileSize,
  getByPublicId,
  findActiveByChecksum,
  listAssets,
  overviewSummary,
  recentAssets,
  createFromUpload,
  createFromSelectorUpload,
  createManyFromUploads,
  updateMetadata,
  replaceFile,
  archive,
  restore,
  permanentDelete,
};
