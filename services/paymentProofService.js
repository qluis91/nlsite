/**
 * Payment proof management — upload, review, approve, reject.
 * Private file storage, active-proof invariant enforcement.
 */
const pool = require('../config/db');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { canConfirmPayment } = require('../config/orderOptions');
const { getWhatsAppPhone } = require('../config/publicContact');

// ── Private storage ──
const PROOF_ROOT = process.env.UPLOAD_PROOFS_DIR || path.join(__dirname, '..', 'storage', 'payment-proofs');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_PDF_MIME = new Set(['application/pdf']);
const PROOF_IMAGE_PROFILE = { maxWidth: 2400, maxHeight: 2400, quality: 86, format: 'webp', fit: 'inside', withoutEnlargement: true };

class PaymentProofError extends Error {
  constructor(message, code = 'INVALID_PROOF_OPERATION') {
    super(message); this.name = 'PaymentProofError'; this.code = code;
  }
}

// ── Eligibility ──
function canUploadProof(order) {
  if (!order) return false;
  if (!['sinpe', 'bank_transfer'].includes(order.payment_method)) return false;
  if (order.payment_status !== 'pending') return false;
  if (order.final_total === null || order.final_total === undefined) return false;
  if (!['not_required', 'quoted'].includes(order.shipping_status)) return false;
  if (order.order_status !== 'pending_payment') return false;
  if (order.order_status === 'cancelled' || order.order_status === 'completed') return false;
  return true;
}

// ── Active proof check ──
async function getCurrentProof(orderId, conn = null) {
  const db = conn || pool;
  const [rows] = await db.query(
    `SELECT id, status, original_filename, stored_filename, mime_type, file_size_bytes,
            image_width, image_height, submitted_at, reviewed_at, rejection_reason
       FROM payment_proofs WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [orderId]
  );
  return rows[0] || null;
}

// ── Check active proofs under transaction (locks rows) ──
async function hasActiveProofUnderLock(conn, orderId) {
  const [rows] = await conn.query(
    `SELECT id, status FROM payment_proofs
      WHERE order_id = ? AND status IN ('pending_review', 'approved')
      FOR UPDATE`,
    [orderId]
  );
  return rows[0] || null;
}

// ── Get storage path for an order ──
function proofStorageDir(orderReference) {
  const safe = String(orderReference).replace(/[^A-Z0-9-]/g, '');
  return path.join(PROOF_ROOT, safe);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── File validation ──
function validateProofFile(file) {
  if (!file) throw new PaymentProofError('No se recibió ningún archivo.', 'NO_FILE');
  if (file.size > MAX_FILE_SIZE) throw new PaymentProofError('El archivo no debe superar 5 MB.', 'FILE_TOO_LARGE');
  if (!ALLOWED_IMAGE_MIME.has(file.mimetype) && !ALLOWED_PDF_MIME.has(file.mimetype)) {
    throw new PaymentProofError('Formato no permitido. Usa JPG, PNG, WebP o PDF.', 'INVALID_FORMAT');
  }
}

async function validatePDF(buffer) {
  const header = buffer.slice(0, 5).toString('utf8');
  if (!header.startsWith('%PDF-')) throw new PaymentProofError('El archivo PDF no es válido o está corrupto.', 'INVALID_PDF');
}

// ── Process file buffer (validate + re-encode) WITHOUT writing to disk ──
// Returns processed buffer + metadata. Disk write happens later inside the transaction.
async function processProofFile(file) {
  validateProofFile(file);
  const inputBuffer = file.buffer;
  if (!inputBuffer) throw new PaymentProofError('No se pudo leer el archivo.', 'NO_BUFFER');

  const isPDF = ALLOWED_PDF_MIME.has(file.mimetype);

  if (isPDF) {
    await validatePDF(inputBuffer);
    const origName = sanitizeFilename(file.originalname || 'comprobante');
    return {
      outputBuffer: inputBuffer,
      mimeType: 'application/pdf',
      storedFileName: crypto.randomUUID() + '.pdf',
      fileSizeBytes: inputBuffer.length,
      width: null,
      height: null,
      originalFilename: origName,
    };
  }

  // Validate image through Sharp
  let metadata;
  try { metadata = await sharp(inputBuffer).metadata(); }
  catch { throw new PaymentProofError('El archivo no es una imagen válida.', 'INVALID_IMAGE'); }

  // Process: auto-rotate, resize, strip metadata through re-encoding, WebP
  const pipeline = sharp(inputBuffer).rotate().resize({
    width: PROOF_IMAGE_PROFILE.maxWidth, height: PROOF_IMAGE_PROFILE.maxHeight,
    fit: 'inside', withoutEnlargement: true,
  }).webp({ quality: PROOF_IMAGE_PROFILE.quality });

  const outputBuffer = await pipeline.toBuffer();
  const outMeta = await sharp(outputBuffer).metadata();
  const origName = sanitizeFilename(file.originalname || 'comprobante');

  return {
    outputBuffer,
    mimeType: 'image/webp',
    storedFileName: crypto.randomUUID() + '.webp',
    fileSizeBytes: outputBuffer.length,
    width: outMeta.width || 0,
    height: outMeta.height || 0,
    originalFilename: origName,
  };
}

function sanitizeFilename(name) {
  return String(name || 'comprobante').replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
}

// ── Full upload workflow ──
// Stage A (outside TX): process file + pre-authorization
// Stage B (inside TX): lock order row, revalidate eligibility + active proofs, write file, insert DB rows, commit
async function submitProof(reference, file, authenticatedUser, session, source) {
  if (!file) throw new PaymentProofError('No se recibió ningún archivo.');

  // ── Stage A: pre-authorization (lightweight, no locks) ──
  const [orderRows] = await pool.query('SELECT * FROM orders WHERE order_reference = ? LIMIT 1', [reference]);
  if (!orderRows[0]) throw new PaymentProofError('Pedido no encontrado.', 'ORDER_NOT_FOUND');
  const order = orderRows[0];

  const userId = authenticatedUser ? authenticatedUser.id : null;
  if (userId && Number(order.user_id) !== Number(userId)) {
    throw new PaymentProofError('No tienes permiso para este pedido.', 'UNAUTHORIZED');
  }
  if (!userId && !['guest', 'recent'].includes(source)) {
    throw new PaymentProofError('Acceso no autorizado.', 'UNAUTHORIZED');
  }

  // ── Stage A: process file (Sharp or PDF validation, no disk write yet) ──
  const processed = await processProofFile(file);

  // ── Stage B: transactional registration with order-row lock ──
  const conn = await pool.getConnection();
  let storagePath = null;
  try {
    await conn.beginTransaction();

    // Lock the order row — serializes all concurrent uploads/approvals/rejections for this order
    const [lockedRows] = await conn.query('SELECT * FROM orders WHERE order_reference = ? FOR UPDATE', [reference]);
    if (!lockedRows[0]) {
      throw new PaymentProofError('Pedido no encontrado.', 'ORDER_NOT_FOUND');
    }
    const lockedOrder = lockedRows[0];

    // Revalidate eligibility with the locked current state
    if (!canUploadProof(lockedOrder)) {
      throw new PaymentProofError('No es posible cargar un comprobante en el estado actual del pedido.', 'NOT_ELIGIBLE');
    }

    // Revalidate authorization (user_id may have changed in edge cases)
    if (userId && Number(lockedOrder.user_id) !== Number(userId)) {
      throw new PaymentProofError('No tienes permiso para este pedido.', 'UNAUTHORIZED');
    }

    // Check active proofs under lock — guarantees at most one active proof
    const activeProof = await hasActiveProofUnderLock(conn, lockedOrder.id);
    if (activeProof) {
      throw new PaymentProofError(
        activeProof.status === 'pending_review'
          ? 'Ya existe un comprobante en revisión. Espera la respuesta de NinjaLab.'
          : 'El pago de este pedido ya fue confirmado.',
        'PROOF_EXISTS'
      );
    }

    // Write final file to disk
    const dir = proofStorageDir(lockedOrder.order_reference);
    ensureDir(dir);
    storagePath = path.join(dir, processed.storedFileName);
    await fs.promises.writeFile(storagePath, processed.outputBuffer);

    // Determine event type (initial submit vs replacement)
    const [prevProofs] = await conn.query(
      'SELECT id FROM payment_proofs WHERE order_id = ? AND status = ? LIMIT 1',
      [lockedOrder.id, 'rejected']
    );
    const eventType = prevProofs[0] ? 'payment_proof_submitted' : 'payment_proof_submitted';

    // Insert proof row
    const [result] = await conn.query(
      `INSERT INTO payment_proofs (order_id, submitted_by_user_id, submission_source, status,
        original_filename, stored_filename, storage_path, mime_type, file_size_bytes,
        image_width, image_height)
       VALUES (?, ?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?)`,
      [lockedOrder.id, userId || null, source, processed.originalFilename, processed.storedFileName,
       storagePath, processed.mimeType, processed.fileSizeBytes,
       processed.width, processed.height]
    );
    const proofId = result.insertId;

    // Insert audit event
    await conn.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [lockedOrder.id, userId || null, eventType, lockedOrder.order_status, lockedOrder.order_status,
       JSON.stringify({ proofId, submissionSource: source }).slice(0, 4000)]
    );

    await conn.commit();
    return { proofId, status: 'pending_review' };
  } catch (error) {
    await conn.rollback();
    // Compensation: delete the newly written file if DB insert failed after file write
    if (storagePath) {
      try { fs.unlinkSync(storagePath); } catch (_) {}
    }
    if (error instanceof PaymentProofError) throw error;
    console.error('[payment-proof] submitProof failed:', error.message);
    throw new PaymentProofError('Error al procesar el comprobante.', 'UPLOAD_FAILED');
  } finally {
    conn.release();
  }
}

// ── Admin: approve proof ──
async function approveProof(reference, proofId, actorUserId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orderRows] = await conn.query('SELECT * FROM orders WHERE order_reference = ? FOR UPDATE', [reference]);
    if (!orderRows[0]) throw new PaymentProofError('Pedido no encontrado.', 'ORDER_NOT_FOUND');
    const order = orderRows[0];

    const [proofRows] = await conn.query('SELECT * FROM payment_proofs WHERE id = ? FOR UPDATE', [proofId]);
    if (!proofRows[0]) throw new PaymentProofError('Comprobante no encontrado.', 'PROOF_NOT_FOUND');
    const proof = proofRows[0];

    if (Number(proof.order_id) !== Number(order.id)) {
      throw new PaymentProofError('El comprobante no pertenece a este pedido.', 'MISMATCH');
    }
    if (proof.status !== 'pending_review') {
      throw new PaymentProofError('Este comprobante ya fue revisado.', 'ALREADY_REVIEWED');
    }

    // Update proof
    await conn.query(
      `UPDATE payment_proofs SET status = 'approved', reviewed_at = NOW(), reviewed_by_user_id = ?, rejection_reason = NULL
       WHERE id = ?`,
      [actorUserId, proofId]
    );

    // Update order — confirm payment
    await conn.query(
      "UPDATE orders SET payment_status = 'paid', order_status = 'payment_confirmed' WHERE id = ?",
      [order.id]
    );

    // Insert events
    await conn.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, metadata_json)
       VALUES (?, ?, 'payment_proof_approved', ?, ?, ?)`,
      [order.id, actorUserId, order.order_status, 'payment_confirmed',
       JSON.stringify({ proofId, approvedAt: new Date().toISOString() }).slice(0, 4000)]
    );
    await conn.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status)
       VALUES (?, ?, 'payment_confirmed', ?, ?)`,
      [order.id, actorUserId, order.order_status, 'payment_confirmed']
    );

    await conn.commit();
    return { approved: true };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ── Admin: reject proof ──
async function rejectProof(reference, proofId, reason, actorUserId) {
  if (!reason || String(reason).trim().length === 0) {
    throw new PaymentProofError('Debes indicar un motivo de rechazo.', 'REASON_REQUIRED');
  }
  const safeReason = String(reason).trim().slice(0, 500);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orderRows] = await conn.query('SELECT * FROM orders WHERE order_reference = ? FOR UPDATE', [reference]);
    if (!orderRows[0]) throw new PaymentProofError('Pedido no encontrado.', 'ORDER_NOT_FOUND');
    const order = orderRows[0];

    const [proofRows] = await conn.query('SELECT * FROM payment_proofs WHERE id = ? FOR UPDATE', [proofId]);
    if (!proofRows[0]) throw new PaymentProofError('Comprobante no encontrado.', 'PROOF_NOT_FOUND');
    const proof = proofRows[0];

    if (Number(proof.order_id) !== Number(order.id)) {
      throw new PaymentProofError('El comprobante no pertenece a este pedido.', 'MISMATCH');
    }
    if (proof.status !== 'pending_review') {
      throw new PaymentProofError('Este comprobante ya fue revisado.', 'ALREADY_REVIEWED');
    }

    // Update proof — do NOT change payment_status
    await conn.query(
      `UPDATE payment_proofs SET status = 'rejected', reviewed_at = NOW(), reviewed_by_user_id = ?, rejection_reason = ?
       WHERE id = ?`,
      [actorUserId, safeReason, proofId]
    );

    // Insert event
    await conn.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, metadata_json, note)
       VALUES (?, ?, 'payment_proof_rejected', ?, ?, ?, ?)`,
      [order.id, actorUserId, order.order_status, order.order_status,
       JSON.stringify({ proofId, rejectedAt: new Date().toISOString() }).slice(0, 4000),
       safeReason]
    );

    await conn.commit();
    return { rejected: true, reason: safeReason };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ── File serving ──
async function getProofForServing(proofId, orderRef) {
  const [rows] = await pool.query(
    `SELECT p.id, p.stored_filename, p.storage_path, p.mime_type, p.status, p.order_id,
            o.order_reference, o.user_id
       FROM payment_proofs p JOIN orders o ON o.id = p.order_id
      WHERE p.id = ? AND o.order_reference = ? LIMIT 1`,
    [proofId, orderRef]
  );
  return rows[0] || null;
}

function validateProofPath(storagePath) {
  const resolved = path.resolve(storagePath);
  const rootResolved = path.resolve(PROOF_ROOT);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new PaymentProofError('Ruta no permitida.', 'PATH_TRAVERSAL');
  }
  return resolved;
}

// ── Check if manual payment confirmation should be blocked ──
async function hasPendingProof(orderId) {
  const current = await getCurrentProof(orderId);
  return current && current.status === 'pending_review';
}

// ── Proof summary for views ──
async function getProofSummary(orderId) {
  const current = await getCurrentProof(orderId);
  if (!current) return { status: 'not_submitted', proof: null };
  return {
    status: current.status,
    proof: {
      id: current.id,
      status: current.status,
      originalFilename: current.original_filename,
      mimeType: current.mime_type,
      fileSizeBytes: current.file_size_bytes,
      imageWidth: current.image_width,
      imageHeight: current.image_height,
      submittedAt: current.submitted_at,
      reviewedAt: current.reviewed_at,
      rejectionReason: current.rejection_reason,
    },
  };
}

module.exports = {
  PaymentProofError, PROOF_ROOT, canUploadProof, getCurrentProof,
  submitProof, approveProof, rejectProof,
  getProofForServing, validateProofPath, hasPendingProof, getProofSummary,
};
