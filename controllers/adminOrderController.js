const service = require('../services/adminOrderService');
const tilopayService = require('../services/tilopayService');
const {
  validateOrderReference, parseMoneyToCents, validateNote,
  validatePaymentReference, validateOrderStatus,
  validateCarrier, validateTrackingNumber, validateTrackingUrl,
} = require('../validators/adminOrderValidator');
const {
  ORDER_STATUSES, ORDER_STATUS_LABELS, SHIPPING_STATUS_LABELS, PAYMENT_STATUS_LABELS,
  DELIVERY_METHOD_LABELS, PAYMENT_METHOD_LABELS,
} = require('../config/orderOptions');

function referenceOrRedirect(req, res) {
  const result = validateOrderReference(req.params.reference);
  if (!result.valid) {
    req.session.error_msg = 'Referencia de pedido inválida.';
    res.redirect('/admin/orders');
    return null;
  }
  return result.value;
}

function handleOperationError(req, res, error, reference) {
  req.session.error_msg = error instanceof service.AdminOrderError
    ? error.message : 'No se pudo actualizar el pedido.';
  if (!(error instanceof service.AdminOrderError)) console.error('[admin-orders] Operation failed:', error.message);
  return res.redirect(reference ? `/admin/orders/${reference}` : '/admin/orders');
}

exports.list = async (req, res, next) => {
  try {
    const result = await service.listOrders(req.query);
    res.render('pages/admin/orders', {
      title: 'Pedidos', layout: 'layouts/admin', ...result,
      options: { ORDER_STATUSES, ORDER_STATUS_LABELS, SHIPPING_STATUS_LABELS, PAYMENT_STATUS_LABELS, DELIVERY_METHOD_LABELS, PAYMENT_METHOD_LABELS },
    });
  } catch (error) { next(error); }
};

exports.detail = async (req, res, next) => {
  const reference = referenceOrRedirect(req, res);
  if (!reference) return;
  try {
    const detail = await service.getOrderByReference(reference);
    if (!detail) { req.session.error_msg = 'Pedido no encontrado.'; return res.redirect('/admin/orders'); }
    const tilopayTx = detail.order && detail.order.payment_method === 'tilopay'
      ? await tilopayService.getTransactionSummary(detail.order.id) : null;
    return res.render('pages/admin/order-detail', {
      title: `Pedido ${reference}`, layout: 'layouts/admin', ...detail, ORDER_STATUS_LABELS, tilopayTx,
    });
  } catch (error) { return next(error); }
};

exports.quoteShipping = async (req, res) => {
  const reference = referenceOrRedirect(req, res); if (!reference) return;
  const amount = parseMoneyToCents(req.body.shippingAmount);
  if (!amount.valid) { req.session.error_msg = amount.error; return res.redirect(`/admin/orders/${reference}`); }
  try {
    await service.quoteShipping(reference, amount.value, req.session.user.id);
    req.session.success_msg = 'Cotización de envío guardada y total final recalculado.';
    return res.redirect(`/admin/orders/${reference}`);
  } catch (error) { return handleOperationError(req, res, error, reference); }
};

exports.confirmPayment = async (req, res) => {
  const reference = referenceOrRedirect(req, res); if (!reference) return;
  const paymentReference = validatePaymentReference(req.body.paymentReference);
  if (!paymentReference.valid) { req.session.error_msg = paymentReference.error; return res.redirect(`/admin/orders/${reference}`); }
  try {
    await service.confirmPayment(reference, paymentReference.value, req.session.user.id);
    req.session.success_msg = 'Pago confirmado manualmente.';
    return res.redirect(`/admin/orders/${reference}`);
  } catch (error) { return handleOperationError(req, res, error, reference); }
};

exports.changeStatus = async (req, res) => {
  const reference = referenceOrRedirect(req, res); if (!reference) return;
  const status = validateOrderStatus(req.body.orderStatus);
  if (!status.valid) { req.session.error_msg = status.error; return res.redirect(`/admin/orders/${reference}`); }
  try {
    await service.transitionOrder(reference, status.value, req.session.user.id);
    req.session.success_msg = 'Estado del pedido actualizado.';
    return res.redirect(`/admin/orders/${reference}`);
  } catch (error) { return handleOperationError(req, res, error, reference); }
};

exports.addNote = async (req, res) => {
  const reference = referenceOrRedirect(req, res); if (!reference) return;
  const note = validateNote(req.body.note, true);
  if (!note.valid) { req.session.error_msg = note.error; return res.redirect(`/admin/orders/${reference}`); }
  try {
    await service.addInternalNote(reference, note.value, req.session.user.id);
    req.session.success_msg = 'Nota interna agregada al historial.';
    return res.redirect(`/admin/orders/${reference}`);
  } catch (error) { return handleOperationError(req, res, error, reference); }
};

exports.cancel = async (req, res) => {
  const reference = referenceOrRedirect(req, res); if (!reference) return;
  try {
    await service.cancelOrder(reference, req.session.user.id);
    req.session.success_msg = 'Pedido cancelado e inventario restaurado.';
    return res.redirect(`/admin/orders/${reference}`);
  } catch (error) { return handleOperationError(req, res, error, reference); }
};

exports.updateTracking = async (req, res) => {
  const reference = referenceOrRedirect(req, res); if (!reference) return;
  const carrier = validateCarrier(req.body.carrier);
  const trackingNumber = validateTrackingNumber(req.body.trackingNumber);
  const trackingUrl = validateTrackingUrl(req.body.trackingUrl);
  if (!carrier.valid) { req.session.error_msg = carrier.error; return res.redirect(`/admin/orders/${reference}`); }
  if (!trackingNumber.valid) { req.session.error_msg = trackingNumber.error; return res.redirect(`/admin/orders/${reference}`); }
  if (!trackingUrl.valid) { req.session.error_msg = trackingUrl.error; return res.redirect(`/admin/orders/${reference}`); }
  try {
    await service.updateTracking(reference, {
      carrier: carrier.value,
      trackingNumber: trackingNumber.value,
      trackingUrl: trackingUrl.value,
    }, req.session.user.id);
    req.session.success_msg = 'Información de envío actualizada.';
    return res.redirect(`/admin/orders/${reference}`);
  } catch (error) { return handleOperationError(req, res, error, reference); }
};
