/**
 * Tilopay Controller — payment initiation, return pages, webhook, admin reconciliation.
 */
const tilopayService = require('../services/tilopayService');
const tilopayConfig = require('../config/tilopay');
const customerOrders = require('../services/customerOrderService');

// ── Helpers ──
function normalizeRef(req) {
  return customerOrders.normalizeReference(req.params.reference);
}

// ── Initiate payment (authenticated customer) ──
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
    const result = await tilopayService.initiatePayment(reference, req.session.user.id, req.session);

    // Render the Tilopay payment page with SDK token
    res.render('pages/tilopay-pay', {
      pageTitle: 'Pagar con Tarjeta — ' + reference,
      sdkToken: result.sdkToken,
      orderReference: result.orderReference,
      amount: Number(result.amount),
      currency: result.currency,
      internalRef: result.internalRef,
      methods: result.methods,
      csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || ''),
      tilopayScriptUrl: tilopayConfig.SDK_SCRIPT_URL,
      jqueryScriptUrl: tilopayConfig.JQUERY_SCRIPT_URL,
      returnUrl: tilopayConfig.deriveReturnUrl()
        ? `${tilopayConfig.deriveReturnUrl()}?ref=${encodeURIComponent(result.internalRef)}`
        : `/pagos/tilopay/retorno?ref=${encodeURIComponent(result.internalRef)}`,
      pageClass: '',
      pageStyles: '',
    });
  } catch (error) {
    const message = error instanceof tilopayService.TilopayError
      ? error.message
      : 'No fue posible iniciar el pago en este momento. Inténtalo nuevamente más tarde.';
    req.session.error_msg = message;
    if (!(error instanceof tilopayService.TilopayError)) {
      console.error('[tilopay] Initiation error:', error.message);
    }
    return res.redirect(`/cuenta/pedidos/${reference}`);
  }
};

// ── Initiate payment (guest) ──
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
    const result = await tilopayService.initiatePayment(reference, null, req.session);

    res.render('pages/tilopay-pay', {
      pageTitle: 'Pagar con Tarjeta — ' + reference,
      sdkToken: result.sdkToken,
      orderReference: result.orderReference,
      amount: Number(result.amount),
      currency: result.currency,
      internalRef: result.internalRef,
      methods: result.methods,
      csrfToken: req.csrfToken ? req.csrfToken() : (res.locals.csrfToken || ''),
      tilopayScriptUrl: tilopayConfig.SDK_SCRIPT_URL,
      jqueryScriptUrl: tilopayConfig.JQUERY_SCRIPT_URL,
      returnUrl: tilopayConfig.deriveReturnUrl()
        ? `${tilopayConfig.deriveReturnUrl()}?ref=${encodeURIComponent(result.internalRef)}`
        : `/pagos/tilopay/retorno?ref=${encodeURIComponent(result.internalRef)}`,
      pageClass: '',
      pageStyles: '',
    });
  } catch (error) {
    const message = error instanceof tilopayService.TilopayError
      ? error.message
      : 'No fue posible iniciar el pago en este momento.';
    req.session.error_msg = message;
    if (!(error instanceof tilopayService.TilopayError)) {
      console.error('[tilopay] Guest initiation error:', error.message);
    }
    return res.redirect(`/consultar-pedido/${reference}`);
  }
};

// ── Return from Tilopay (success redirect) ──
exports.returnFromTilopay = async (req, res) => {
  // NEVER trust query parameters to mark payment as paid.
  const internalRef = String(req.query.ref || '').trim();

  if (!internalRef) {
    return res.render('pages/tilopay-result', {
      pageTitle: 'Resultado del pago',
      status: 'unknown',
      message: 'Estamos verificando el resultado del pago.',
      pageClass: '', pageStyles: '',
    });
  }

  try {
    const tx = await tilopayService.getTransactionByInternalRef(internalRef);
    if (!tx) {
      return res.render('pages/tilopay-result', {
        pageTitle: 'Resultado del pago',
        status: 'unknown',
        message: 'Estamos verificando el resultado del pago.',
        pageClass: '', pageStyles: '',
      });
    }

    // Use centralized verification via server-to-server lookup
    const trigger = req.session.user ? 'return' : 'return';
    const result = await tilopayService.verifyTilopayPayment(internalRef, {
      trigger,
      actorUserId: req.session.user ? req.session.user.id : null,
    });

    if (result.orderPaid) {
      if (req.session.user) {
        return res.redirect(`/cuenta/pedidos/${tx.order_reference || ''}`);
      }
      return res.redirect(`/consultar-pedido/${tx.order_reference || ''}`);
    }

    if (result.messageCode === 'PAYMENT_PENDING' || result.messageCode === 'PAYMENT_UNKNOWN') {
      return res.render('pages/tilopay-result', {
        pageTitle: 'Pago en proceso',
        status: 'pending',
        message: 'Tu pago está siendo procesado. Te notificaremos cuando se confirme.',
        pageClass: '', pageStyles: '',
      });
    }

    return res.render('pages/tilopay-result', {
      pageTitle: 'Resultado del pago',
      status: tx.status,
      message: 'El pago no fue aprobado. Puedes intentarlo nuevamente.',
      pageClass: '', pageStyles: '',
    });
  } catch (error) {
    console.error('[tilopay] Return error:', error.message);
    return res.render('pages/tilopay-result', {
      pageTitle: 'Resultado del pago',
      status: 'unknown',
      message: 'Estamos verificando el resultado del pago.',
      pageClass: '', pageStyles: '',
    });
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

    const result = await tilopayService.verifyTilopayPayment(internalRef, {
      trigger: 'customer_verify',
      actorUserId: req.session.user.id,
    });

    if (result.orderPaid) {
      req.session.success_msg = 'Pago confirmado.';
    } else if (result.messageCode === 'PAYMENT_PENDING') {
      req.session.info_msg = 'El pago está en proceso.';
    } else if (result.retryAllowed) {
      req.session.info_msg = result.customerMessage || 'El pago no fue aprobado.';
    } else {
      req.session.error_msg = result.customerMessage || 'No pudimos confirmar el pago.';
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
    const result = await tilopayService.verifyTilopayPayment(internalRef, {
      trigger: 'guest_verify',
      actorUserId: null,
    });

    if (result.orderPaid) {
      req.session.success_msg = 'Pago confirmado.';
    } else if (result.messageCode === 'PAYMENT_PENDING') {
      req.session.info_msg = 'El pago está en proceso.';
    } else if (result.retryAllowed) {
      req.session.info_msg = result.customerMessage || 'El pago no fue aprobado.';
    } else {
      req.session.error_msg = result.customerMessage || 'No pudimos confirmar el pago.';
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
