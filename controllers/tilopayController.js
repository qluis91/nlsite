/**
 * Initiate hosted Tilopay payment (authenticated customer).
 * Creates the hosted payment session and redirects to Tilopay's secure page.
 * NEVER exposes Tilopay credentials, SDK scripts, or card inputs to the browser.
 */
const tilopayService = require('../services/tilopayService');
const tilopayConfig = require('../config/tilopay');
const customerOrders = require('../services/customerOrderService');

function normalizeRef(req) {
  return customerOrders.normalizeReference(req.params.reference);
}

function logInitiationError(label, error) {
  const fallback = error?.code || error?.name || 'UNEXPECTED_ERROR';
  if (process.env.NODE_ENV === 'production') {
    console.error(label, fallback);
    return;
  }
  console.error(label, {
    name: error?.name || null,
    code: error?.code || null,
    message: error?.message ? String(error.message).slice(0, 200) : null,
    operation: error?.operation || null,
    httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
    providerType: error?.providerType || null,
    providerMessage: error?.providerMessage || null,
    safeCause: error?.safeCause || null,
  });
}

exports.initiatePayment = async (req, res) => {
  if (!tilopayConfig.ENABLED) {
    req.session.error_msg = 'El pago con tarjeta no está disponible en este momento.';
    return res.redirect('/cuenta/pedidos');
  }

  const reference = normalizeRef(req);
  if (!reference) {
    req.session.error_msg = 'Referencia inválida.';
    return res.redirect('/cuenta/pedidos');
  }

  try {
    const accessRecord = await customerOrders.getAccessRecord(reference);
    if (!accessRecord) {
      req.session.error_msg = 'Pedido no encontrado.';
      return res.redirect('/cuenta/pedidos');
    }

    const allowed = customerOrders.canAccessCustomerOrder({
      order: accessRecord, authenticatedUser: req.session.user, session: req.session,
    });
    if (!allowed) {
      req.session.error_msg = 'No tienes acceso a este pedido.';
      return res.redirect('/cuenta/pedidos');
    }

    const customerData = {
      firstName: req.session.user.name || '',
      lastName: req.session.user.last_name || '',
      email: req.session.user.email || '',
      phone: req.session.user.phone || '',
    };
    const result = await tilopayService.initiateHostedPayment(
      accessRecord.internal_id,
      req.session.user.id,
      customerData
    );

    if (result.redirect && result.url) {
      // CSP-safe redirect: form-action 'self' would block a 302 to secure.tilopay.com.
      // Use JS-based navigation instead (not subject to form-action CSP).
      return res.send(`
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Redirigiendo a Tilopay</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;text-align:center;}p{font-size:1.2rem;color:#333;}</style></head>
<body><p>Redirigiendo a la plataforma segura de Tilopay&hellip;</p>
<script nonce="${res.locals.cspNonce || ''}">window.location.href = ${JSON.stringify(result.url)};</script>
</body></html>`);
    }

    req.session.error_msg = 'No se pudo iniciar el pago. Intenta de nuevo.';
    return res.redirect('/cuenta/pedidos/' + reference);
  } catch (error) {
    const message = error instanceof tilopayService.TilopayError
      ? error.message
      : 'No fue posible iniciar el pago en este momento. Inténtalo nuevamente más tarde.';
    req.session.error_msg = message;
    if (!(error instanceof tilopayService.TilopayError)) {
      logInitiationError('[tilopay] Initiation error:', error);
    }
    return res.redirect('/cuenta/pedidos/' + reference);
  }
};

// ── Initiate payment (guest) ──
// ── Initiate hosted Tilopay payment (guest customer) ──
exports.initiatePaymentGuest = async (req, res) => {
  if (!tilopayConfig.ENABLED) {
    req.session.error_msg = 'El pago con tarjeta no está disponible en este momento.';
    return res.redirect('/consultar-pedido');
  }

  const reference = normalizeRef(req);
  if (!reference) {
    req.session.error_msg = 'Referencia inválida.';
    return res.redirect('/consultar-pedido');
  }

  try {
    const accessRecord = await customerOrders.getAccessRecord(reference);
    if (!accessRecord) {
      req.session.error_msg = 'Pedido no encontrado.';
      return res.redirect('/consultar-pedido');
    }

    const allowed = customerOrders.canAccessCustomerOrder({
      order: accessRecord, authenticatedUser: null, session: req.session,
    });
    if (!allowed) {
      req.session.error_msg = 'Acceso no autorizado.';
      return res.redirect('/consultar-pedido');
    }

    const result = await tilopayService.initiateHostedPayment(accessRecord.internal_id, null, {
      firstName: req.body?.firstName || accessRecord?.billing_name || '',
      lastName: req.body?.lastName || '',
      email: req.body?.email || accessRecord?.customer_email || '',
      phone: req.body?.phone || accessRecord?.billing_phone || '',
    });

    if (result.redirect && result.url) {
      // CSP-safe redirect: form-action 'self' would block a 302 to secure.tilopay.com.
      // Use JS-based navigation instead (not subject to form-action CSP).
      return res.send(`
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Redirigiendo a Tilopay</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;text-align:center;}p{font-size:1.2rem;color:#333;}</style></head>
<body><p>Redirigiendo a la plataforma segura de Tilopay&hellip;</p>
<script nonce="${res.locals.cspNonce || ''}">window.location.href = ${JSON.stringify(result.url)};</script>
</body></html>`);
    }

    req.session.error_msg = 'No se pudo iniciar el pago. Intenta de nuevo.';
    return res.redirect('/consultar-pedido/' + reference);
  } catch (error) {
    const message = error instanceof tilopayService.TilopayError
      ? error.message
      : 'No fue posible iniciar el pago en este momento.';
    req.session.error_msg = message;
    if (!(error instanceof tilopayService.TilopayError)) {
      logInitiationError('[tilopay] Guest initiation error:', error);
    }
    return res.redirect('/consultar-pedido/' + reference);
  }
};

// ── Return from Tilopay (success redirect) ──
exports.returnFromTilopay = async (req, res) => {
  // NEVER trust browser query parameters (code, description, auth, order,
  // tpt, tilopay-transaction, OrderHash, returnData).
  // Payment is verified SERVER-TO-SERVER via POST /api/v1/consult.

  const internalRef = String(req.query.ref || '').trim();

  if (!internalRef) {
    return res.render('pages/tilopay-result', {
      pageTitle: 'Resultado del pago',
      status: 'unknown',
      message: 'Estamos verificando el resultado del pago.',
      orderReference: '',
      pageClass: '', pageStyles: '',
    });
  }

  try {
    const tx = await tilopayService.getTransactionByInternalRef(internalRef);
    if (!tx) {
      return res.render('pages/tilopay-result', {
        pageTitle: 'Resultado del pago',
        status: 'unknown',
        message: 'No se encontro la transaccion.',
        orderReference: '',
        pageClass: '', pageStyles: '',
      });
    }

    // Already paid -> redirect
    if (tx.status === 'approved' || tx.status === 'paid' || tx.payment_status === 'paid') {
      return res.redirect(
        req.session.user
          ? '/cuenta/pedidos/' + (tx.order_reference || '')
          : '/consultar-pedido/' + (tx.order_reference || '')
      );
    }

    // Not in a payment state -> show status
    if (tx.status !== 'pending' && tx.status !== 'creating' && tx.status !== 'failed') {
      return res.render('pages/tilopay-result', {
        pageTitle: 'Resultado del pago',
        status: tx.status || 'unknown',
        message: 'El pago no esta en proceso.',
        orderReference: tx.order_reference || '',
        pageClass: '', pageStyles: '',
      });
    }

    // Server-to-server verification
    const result = await tilopayService.verifyAndConfirmPayment(internalRef, {
      trigger: 'return',
      actorUserId: req.session.user ? req.session.user.id : null,
    });

    if (result.paid) {
      req.session.success_msg = 'Tu pago ha sido confirmado. Gracias por tu compra.';
      return res.redirect(
        req.session.user
          ? '/cuenta/pedidos/' + (tx.order_reference || '')
          : '/consultar-pedido/' + (tx.order_reference || '')
      );
    }

    // For rejected/failed/pending results, redirect to order detail with a safe message.
    // NEVER expose raw provider text (e.g. "Issuer unreachable") — use result.message
    // which comes from the centralized tilopayStatusMap.mapProviderCode.
    if (result.pending) {
      req.session.info_msg = result.message || 'Estamos verificando tu pago. Intenta nuevamente en unos minutos.';
    } else {
      req.session.error_msg = result.message || 'El pago no fue aprobado. Puedes intentarlo nuevamente.';
    }
    return res.redirect(
      req.session.user
        ? '/cuenta/pedidos/' + (tx.order_reference || '')
        : '/consultar-pedido/' + (tx.order_reference || '')
    );
  } catch (error) {
    console.error('[tilopay] Return error:', error.message);
    return res.redirect(
      req.session.user
        ? '/cuenta/pedidos/' + (tx.order_reference || '')
        : '/consultar-pedido/' + (tx.order_reference || '')
    );
  }
};

// ── Cancelled by user ──
exports.cancelledByUser = (req, res) => {
  return res.render('pages/tilopay-result', {
    pageTitle: 'Pago cancelado',
    status: 'cancelled',
    message: 'El pago fue cancelado. Puedes intentarlo nuevamente cuando estés listo.',
    pageClass: '', pageStyles: '',
  });
};

// ── Customer verification (Verificar estado del pago) ──
// POST only, CSRF, ownership required, PRG
exports.verifyPayment = async (req, res) => {
  const reference = normalizeRef(req);
  if (!reference) {
    req.session.error_msg = 'Referencia inválida.';
    return res.redirect('/cuenta/pedidos');
  }

  const internalRef = String(req.body.internalRef || '').trim();
  if (!internalRef) {
    req.session.error_msg = 'Referencia de transacción requerida.';
    return res.redirect(`/cuenta/pedidos/${reference}`);
  }

  try {
    // Load transaction and verify ownership
    const tx = await tilopayService.getTransactionByInternalRef(internalRef);
    if (!tx) {
      req.session.error_msg = 'Transacción no encontrada.';
      return res.redirect(`/cuenta/pedidos/${reference}`);
    }

    // Controller-level authorization: must own the order
    const orderAccess = await customerOrders.getAccessRecord(reference);
    if (!orderAccess || Number(orderAccess.user_id) !== Number(req.session.user.id)) {
      req.session.error_msg = 'Acceso no autorizado.';
      return res.redirect('/cuenta/pedidos');
    }

    const result = await tilopayService.verifyAndConfirmPayment(internalRef, {
      trigger: 'customer_verify',
      actorUserId: req.session.user ? req.session.user.id : null,
    });

    if (result.paid) {
      req.session.success_msg = 'Pago confirmado.';
    } else if (result.pending) {
      req.session.info_msg = result.message || 'El pago está en proceso.';
    } else {
      // Terminal failure — safe message from centralized status map
      req.session.error_msg = result.message || 'El pago no fue aprobado.';
    }
  } catch (error) {
    if (!(error instanceof tilopayService.TilopayError)) {
      console.error('[tilopay] Customer verify error:', error.message);
    }
    req.session.error_msg = 'No fue posible verificar el pago.';
  }

  return res.redirect(`/cuenta/pedidos/${reference}`);
};

// ── Guest verification (Verificar estado del pago) ──
// POST only, CSRF, guest session grant required, PRG
exports.verifyPaymentGuest = async (req, res) => {
  const reference = normalizeRef(req);
  if (!reference) {
    req.session.error_msg = 'Referencia inválida.';
    return res.redirect('/consultar-pedido');
  }

  const internalRef = String(req.body.internalRef || '').trim();
  if (!internalRef) {
    req.session.error_msg = 'Referencia de transacción requerida.';
    return res.redirect(`/consultar-pedido/${reference}`);
  }

  // Guest authorization check
  const accessRecord = await customerOrders.getAccessRecord(reference);
  const allowed = customerOrders.canAccessCustomerOrder({
    order: accessRecord, authenticatedUser: null, session: req.session,
  });
  if (!allowed) {
    req.session.error_msg = 'Acceso no autorizado.';
    return res.redirect('/consultar-pedido');
  }

  try {
    const result = await tilopayService.verifyAndConfirmPayment(internalRef, {
      trigger: 'guest_verify',
      actorUserId: null,
    });

    if (result.paid) {
      req.session.success_msg = 'Pago confirmado.';
    } else if (result.pending) {
      req.session.info_msg = result.message || 'El pago está en proceso.';
    } else {
      req.session.error_msg = result.message || 'El pago no fue aprobado.';
    }
  } catch (error) {
    if (!(error instanceof tilopayService.TilopayError)) {
      console.error('[tilopay] Guest verify error:', error.message);
    }
    req.session.error_msg = 'No fue posible verificar el pago.';
  }

  return res.redirect(`/consultar-pedido/${reference}`);
};

// ── Webhook handler ──
exports.handleWebhook = async (req, res) => {
  try {
    await tilopayService.processNotification(req.body);
    res.status(200).json({ received: true });
  } catch (error) {
    if (error instanceof tilopayService.TilopayError) {
      if (error.code !== 'MISSING_REFERENCE') {
        console.error('[tilopay] Notification error:', error.code);
      }
      return res.status(400).json({ error: error.code });
    }
    console.error('[tilopay] Notification unexpected error:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
};

// ── Admin: reconcile transaction ──
exports.adminReconcile = async (req, res) => {
  const reference = normalizeRef(req);
  if (!reference) {
    req.session.error_msg = 'Referencia inválida.';
    return res.redirect('/admin/orders');
  }

  // Get internal transaction reference from body — never accept provider ID from browser
  const internalRef = String(req.body.internalRef || '').trim();
  if (!internalRef) {
    req.session.error_msg = 'Referencia de transacción requerida.';
    return res.redirect(`/admin/orders/${reference}`);
  }

  try {
    const result = await tilopayService.verifyTilopayPayment(internalRef, {
      trigger: 'admin',
      actorUserId: req.session.adminUser ? req.session.adminUser.id : null,
    });

    if (result.orderPaid) {
      req.session.success_msg = 'Pago confirmado — la transacción fue aprobada.';
    } else if (result.messageCode === 'PAYMENT_MISMATCH') {
      req.session.error_msg = result.customerMessage;
    } else if (result.messageCode === 'PAYMENT_DECLINED' || result.messageCode === 'PAYMENT_CANCELLED'
      || result.messageCode === 'PAYMENT_EXPIRED' || result.messageCode === 'PAYMENT_FAILED') {
      req.session.info_msg = `Verificación completada: ${result.customerMessage}`;
    } else {
      req.session.info_msg = result.customerMessage || 'Verificación completada.';
    }
  } catch (error) {
    const message = error instanceof tilopayService.TilopayError
      ? error.message
      : 'No fue posible verificar la transacción.';
    req.session.error_msg = message;
    if (!(error instanceof tilopayService.TilopayError)) {
      console.error('[tilopay] Admin reconcile error:', error.message);
    }
  }

  return res.redirect(`/admin/orders/${reference}`);
};
