const ORDER_STATUSES = Object.freeze([
  'pending_shipping_quote',
  'pending_payment',
  'payment_confirmed',
  'preparing',
  'ready_for_pickup',
  'ready_for_dispatch',
  'dispatched',
  'completed',
  'cancelled',
]);

const ORDER_STATUS_LABELS = Object.freeze({
  pending_shipping_quote: 'Pendiente de cotización',
  pending_payment: 'Pendiente de pago',
  payment_confirmed: 'Pago confirmado',
  preparing: 'En preparación',
  ready_for_pickup: 'Listo para retirar',
  ready_for_dispatch: 'Listo para enviar',
  dispatched: 'Enviado',
  completed: 'Completado',
  cancelled: 'Cancelado',
});

const CUSTOMER_ORDER_STATUS_LABELS = Object.freeze({
  pending_shipping_quote: 'Pendiente de cotización de envío',
  pending_payment: 'Pendiente de pago',
  payment_confirmed: 'Pago confirmado',
  preparing: 'En preparación',
  ready_for_pickup: 'Listo para retirar',
  ready_for_dispatch: 'Listo para enviar',
  dispatched: 'Enviado',
  completed: 'Completado',
  cancelled: 'Cancelado',
});

const SHIPPING_STATUS_LABELS = Object.freeze({
  not_required: 'No requerido',
  pending_quote: 'Por cotizar',
  quoted: 'Cotizado',
});

const CUSTOMER_SHIPPING_STATUS_LABELS = Object.freeze({
  not_required: 'No requerido',
  pending_quote: 'Por calcular',
  quoted: 'Cotizado',
});

const PAYMENT_STATUS_LABELS = Object.freeze({ pending: 'Pendiente', paid: 'Pagado' });
const DELIVERY_METHOD_LABELS = Object.freeze({
  local_pickup: 'Retiro en local',
  uber_flash: 'Uber Flash',
  private_courier: 'Mensajero privado',
  correos_cr: 'Correos de Costa Rica',
});
const PAYMENT_METHOD_LABELS = Object.freeze({
  sinpe: 'SINPE Móvil',
  bank_transfer: 'Transferencia bancaria',
  tilopay: 'Tarjeta con Tilopay',
});

const EVENT_TYPE_LABELS = Object.freeze({
  order_created: 'Pedido creado',
  imported_existing_order: 'Pedido existente incorporado',
  shipping_quoted: 'Envío cotizado',
  shipping_requoted: 'Cotización de envío actualizada',
  payment_confirmed: 'Pago confirmado',
  order_status_changed: 'Estado actualizado',
  internal_note_added: 'Nota interna',
  order_cancelled: 'Pedido cancelado',
  payment_proof_submitted: 'Comprobante de pago enviado',
  payment_proof_approved: 'Comprobante aprobado',
  payment_proof_rejected: 'Comprobante rechazado',
  payment_confirmed_manually: 'Pago confirmado sin comprobante',
  tilopay_payment_created: 'Pago con Tilopay iniciado',
  tilopay_payment_creation_failed: 'Inicio de pago con Tilopay fallido',
  tilopay_payment_pending: 'Pago con Tilopay en proceso',
  tilopay_payment_approved: 'Pago con Tilopay aprobado',
  tilopay_payment_declined: 'Pago con Tilopay rechazado',
  tilopay_payment_cancelled: 'Pago con Tilopay cancelado',
  tilopay_payment_expired: 'Pago con Tilopay expirado',
  tilopay_payment_reconciled: 'Pago con Tilopay conciliado',
  tilopay_callback_received: 'Notificación de Tilopay recibida',
  tilopay_amount_mismatch: 'Discrepancia en monto de Tilopay',
});

function initialOrderStatus(shippingStatus, paymentStatus = 'pending') {
  if (paymentStatus === 'paid') return 'payment_confirmed';
  return shippingStatus === 'pending_quote' ? 'pending_shipping_quote' : 'pending_payment';
}

function getAllowedNextStatuses(order) {
  if (!order || order.order_status === 'cancelled' || order.order_status === 'completed') return [];
  if (order.order_status === 'payment_confirmed') return ['preparing'];
  if (order.order_status === 'preparing') {
    return order.delivery_method === 'local_pickup' ? ['ready_for_pickup'] : ['ready_for_dispatch'];
  }
  if (order.order_status === 'ready_for_pickup' && order.delivery_method === 'local_pickup') return ['completed'];
  if (order.order_status === 'ready_for_dispatch' && order.delivery_method !== 'local_pickup') return ['dispatched'];
  if (order.order_status === 'dispatched' && order.delivery_method !== 'local_pickup') return ['completed'];
  return [];
}

function canQuoteShipping(order) {
  return Boolean(order)
    && order.delivery_method !== 'local_pickup'
    && ['pending_quote', 'quoted'].includes(order.shipping_status)
    && order.payment_status === 'pending'
    && ['pending_shipping_quote', 'pending_payment'].includes(order.order_status);
}

function canConfirmPayment(order) {
  return Boolean(order)
    && ['sinpe', 'bank_transfer'].includes(order.payment_method)
    && order.payment_status === 'pending'
    && ['not_required', 'quoted'].includes(order.shipping_status)
    && order.final_total !== null
    && order.final_total !== undefined
    && order.order_status === 'pending_payment';
}

function canCancelOrder(order) {
  return Boolean(order)
    && order.payment_status === 'pending'
    && ['pending_shipping_quote', 'pending_payment'].includes(order.order_status);
}

module.exports = {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  SHIPPING_STATUS_LABELS,
  CUSTOMER_SHIPPING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  DELIVERY_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
  EVENT_TYPE_LABELS,
  initialOrderStatus,
  getAllowedNextStatuses,
  canQuoteShipping,
  canConfirmPayment,
  canCancelOrder,
};
