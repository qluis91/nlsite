'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');
const {
  UPLOAD_PUBLIC_ROOT,
  resolveUploadStoragePath,
  assertRelativeStoragePath,
  publicUrlForStoragePath,
} = require('../config/uploadPaths');
const imageProcessing = require('./imageProcessingService');
const { PUBLIC_IMAGE_WEBP_QUALITY } = require('../config/imageUploadPolicy');

const STATUS_LABELS = Object.freeze({
  new: 'Nueva',
  in_review: 'En proceso',
  responded: 'Respondida',
  closed: 'Cerrada',
  discarded: 'Descartada',
});

const TYPE_LABELS = Object.freeze({
  website: 'Sitio web',
  '3d': 'Pieza 3D',
  other: 'Otro',
});

const THUMB_PROFILE = Object.freeze({
  maxWidth: 1600,
  maxHeight: 1600,
  quality: PUBLIC_IMAGE_WEBP_QUALITY,
  format: 'webp',
  fit: 'inside',
  withoutEnlargement: true,
});

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function processQuoteImages(publicId, files = []) {
  const created = [];
  try {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
      if (!buffer) throw Object.assign(new Error('Archivo de imagen vacío.'), { code: 'EMPTY_FILE' });
      await imageProcessing.inspectRasterBuffer(buffer);
      const processed = await imageProcessing.processBuffer(buffer, THUMB_PROFILE);
      const fileName = imageProcessing.uniqueFileName('webp');
      const relative = assertRelativeStoragePath(path.posix.join('quotes', publicId, fileName));
      const absolute = resolveUploadStoragePath(relative);
      imageProcessing.ensureDir(path.dirname(absolute));
      await fs.promises.writeFile(absolute, processed.buffer);
      created.push({
        storagePath: relative,
        absolutePath: absolute,
        originalFilename: String(file.originalname || '').slice(0, 255),
        mimeType: 'image/webp',
        fileSize: processed.buffer.length,
        sortOrder: i,
        publicUrl: publicUrlForStoragePath(relative),
      });
    }
    return created;
  } catch (err) {
    for (const item of created) {
      try { await fs.promises.unlink(item.absolutePath); } catch { /* ignore */ }
    }
    throw err;
  }
}

async function createQuoteRequest({
  requestType,
  customerName,
  customerEmail,
  customerPhone,
  subject = '',
  payload,
  sourceUrl = '',
  userId = null,
  files = [],
}) {
  const publicId = crypto.randomUUID();
  const processedFiles = await processQuoteImages(publicId, files);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO quote_requests
         (public_id, request_type, status, user_id, customer_name, customer_email, customer_phone,
          subject, payload_json, source_url)
       VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicId,
        requestType,
        userId || null,
        customerName,
        customerEmail,
        customerPhone || '',
        subject || '',
        JSON.stringify(payload || {}),
        String(sourceUrl || '').slice(0, 500),
      ]
    );
    const quoteId = result.insertId;
    for (const file of processedFiles) {
      await conn.query(
        `INSERT INTO quote_request_files
           (quote_request_id, storage_path, original_filename, mime_type, file_size, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [quoteId, file.storagePath, file.originalFilename, file.mimeType, file.fileSize, file.sortOrder]
      );
    }
    await conn.commit();
    return {
      id: quoteId,
      publicId,
      reference: `Q-${publicId.slice(0, 8).toUpperCase()}`,
      fileCount: processedFiles.length,
    };
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    for (const file of processedFiles) {
      try { await fs.promises.unlink(file.absolutePath); } catch { /* ignore */ }
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function listQuoteRequests({ type = '', status = '', limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (type) { where.push('request_type = ?'); params.push(type); }
  if (status) { where.push('status = ?'); params.push(status); }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT id, public_id, request_type, status, user_id, customer_name, customer_email,
            customer_phone, subject, created_at, updated_at
       FROM quote_requests
       ${sqlWhere}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, Math.min(200, Math.max(1, Number(limit) || 100)), Math.max(0, Number(offset) || 0)]
  );
  return rows.map((row) => ({
    ...row,
    typeLabel: TYPE_LABELS[row.request_type] || row.request_type,
    statusLabel: STATUS_LABELS[row.status] || row.status,
  }));
}

async function getQuoteRequestByPublicId(publicId) {
  const [[row]] = await pool.query(
    `SELECT * FROM quote_requests WHERE public_id = ? LIMIT 1`,
    [String(publicId || '')]
  );
  if (!row) return null;
  const [files] = await pool.query(
    `SELECT id, storage_path, original_filename, mime_type, file_size, sort_order, created_at
       FROM quote_request_files
      WHERE quote_request_id = ?
      ORDER BY sort_order ASC, id ASC`,
    [row.id]
  );
  return {
    ...row,
    payload: parsePayload(row.payload_json),
    typeLabel: TYPE_LABELS[row.request_type] || row.request_type,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    files: files.map((f) => ({
      ...f,
      publicUrl: publicUrlForStoragePath(f.storage_path),
    })),
  };
}

async function updateQuoteStatus(publicId, status) {
  const [result] = await pool.query(
    `UPDATE quote_requests SET status = ? WHERE public_id = ?`,
    [status, String(publicId || '')]
  );
  return result.affectedRows > 0;
}

module.exports = {
  STATUS_LABELS,
  TYPE_LABELS,
  UPLOAD_PUBLIC_ROOT,
  createQuoteRequest,
  listQuoteRequests,
  getQuoteRequestByPublicId,
  updateQuoteStatus,
  processQuoteImages,
};
