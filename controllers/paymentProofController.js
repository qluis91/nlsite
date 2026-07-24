/**
 * Payment Proof Controller — upload, preview, admin approve/reject.
 */
const proofService = require('../services/paymentProofService');
const customerOrders = require('../services/customerOrderService');
const fs = require('fs');
const path = require('path');

// ── Helpers ──
function getReference(req) {
  return customerOrders.normalizeReference(req.params.reference);
}

function getProofId(req) {
  const id = parseInt(req.params.proofId, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function handleProofError(req, res, error, redirect) {
  req.session.error_msg = error instanceof proofService.PaymentProofError
    ? error.message : 'No se pudo procesar la operación.';
  if (!(error instanceof proofService.PaymentProofError)) {
    console.error('[payment-proof] Error:', error.message);
  }
  return res.redirect(redirect || '/cuenta/pedidos');
}

// ── Account: upload ──
exports.accountUpload = async (req, res) => {
  const reference = getReference(req);
  if (!reference) { req.session.error_msg = 'Referencia inválida.'; return res.redirect('/cuenta/pedidos'); }
  const redirect = `/cuenta/pedidos/${reference}`;
  if (!req.file) { req.session.error_msg = 'No se recibió ningún archivo.'; return res.redirect(redirect); }
  try {
    await proofService.submitProof(reference, req.file, req.session.user, req.session, 'account');
    req.session.success_msg = 'Comprobante enviado. NinjaLab lo revisará pronto.';
    return res.redirect(redirect);
  } catch (error) { return handleProofError(req, res, error, redirect); }
};

// ── Guest: upload ──
exports.guestUpload = async (req, res) => {
  const reference = getReference(req);
  if (!reference) { req.session.error_msg = 'Referencia inválida.'; return res.redirect('/consultar-pedido'); }
  const redirect = `/consultar-pedido/${reference}`;

  // Check guest authorization
  const accessRecord = await customerOrders.getAccessRecord(reference);
  const allowed = customerOrders.canAccessCustomerOrder({
    order: accessRecord, authenticatedUser: null, session: req.session,
  });
  if (!allowed) { req.session.error_msg = 'Acceso no autorizado.'; return res.redirect('/consultar-pedido'); }

  if (!req.file) { req.session.error_msg = 'No se recibió ningún archivo.'; return res.redirect(redirect); }
  try {
    // Determine source: recent order access or guest grant
    const source = customerOrders.hasRecentOrderAccess(req.session, reference) ? 'recent' : 'guest';
    await proofService.submitProof(reference, req.file, null, req.session, source);
    req.session.success_msg = 'Comprobante enviado. NinjaLab lo revisará pronto.';
    return res.redirect(redirect);
  } catch (error) { return handleProofError(req, res, error, redirect); }
};

// ── Shared: preview proof ──
async function serveProof(req, res, isAdmin = false) {
  const reference = getReference(req);
  const proofId = getProofId(req);
  if (!reference || !proofId) return res.status(404).send('No encontrado.');

  const proof = await proofService.getProofForServing(proofId, reference);
  if (!proof) return res.status(404).send('No encontrado.');

  // Authorization
  if (isAdmin) {
    // Admin can view any
  } else {
    const user = req.session.user;
    if (user && user.id) {
      if (Number(proof.user_id) !== Number(user.id)) return res.status(404).send('No encontrado.');
    } else {
      // Guest access check
      const allowed = customerOrders.canAccessCustomerOrder({
        order: { order_reference: proof.order_reference, user_id: proof.user_id },
        authenticatedUser: null, session: req.session,
      });
      if (!allowed) return res.status(404).send('No encontrado.');
    }
  }

  // Validate path within private root
  let resolved;
  try { resolved = proofService.validateProofPath(proof.storage_path); }
  catch { return res.status(404).send('No encontrado.'); }

  if (!fs.existsSync(resolved)) return res.status(404).send('No encontrado.');

  const isPDF = proof.mime_type === 'application/pdf';
  res.set({
    'Content-Type': proof.mime_type,
    'Content-Disposition': `${isPDF ? 'inline' : 'inline'}; filename="${proof.stored_filename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  fs.createReadStream(resolved).pipe(res);
}

exports.accountPreview = (req, res) => serveProof(req, res, false);
exports.guestPreview = (req, res) => serveProof(req, res, false);
exports.adminPreview = (req, res) => serveProof(req, res, true);

// ── Admin: approve ──
exports.adminApprove = async (req, res) => {
  const reference = getReference(req);
  const proofId = getProofId(req);
  const redirect = `/admin/orders/${reference}`;
  if (!reference || !proofId) { req.session.error_msg = 'Referencia inválida.'; return res.redirect('/admin/orders'); }
  try {
    await proofService.approveProof(reference, proofId, req.session.user.id);
    req.session.success_msg = 'Comprobante aprobado y pago confirmado.';
    return res.redirect(redirect);
  } catch (error) { return handleProofError(req, res, error, redirect); }
};

// ── Admin: reject ──
exports.adminReject = async (req, res) => {
  const reference = getReference(req);
  const proofId = getProofId(req);
  const redirect = `/admin/orders/${reference}`;
  if (!reference || !proofId) { req.session.error_msg = 'Referencia inválida.'; return res.redirect('/admin/orders'); }
  const reason = String(req.body.rejectionReason || '').trim();
  if (!reason) { req.session.error_msg = 'Debes indicar un motivo de rechazo.'; return res.redirect(redirect); }
  try {
    await proofService.rejectProof(reference, proofId, reason, req.session.user.id);
    req.session.success_msg = 'Comprobante rechazado. El cliente podrá enviar uno nuevo.';
    return res.redirect(redirect);
  } catch (error) { return handleProofError(req, res, error, redirect); }
};
