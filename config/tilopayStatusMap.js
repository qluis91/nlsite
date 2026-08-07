/**
 * Tilopay status normalization – map raw provider status to internal allowlist.
 * Source: Tilopay Postman collection (_local/tilopay-official.postman_collection.json)
 * and real sandbox observation (2026-08-07).
 *
 * CONSULT RESPONSE CODES (from real sandbox /api/v1/consult):
 *   "1"  = Approved (Transaccion aprobada)
 *   "98" = Issuer unreachable (entidad emisora no disponible) — TERMINAL
 *
 * Other codes observed in Tilopay documentation:
 *   "2"  = Declined / Denied
 *   "3"  = Insufficient funds
 *   "5"  = Invalid CVV
 *   "7"  = 3DS authentication failed
 *   "8"  = Cancelled
 *
 * DO NOT expose raw provider messages directly to customers.
 * Use customerSafeMessage() / customerLabel() for all customer-facing text.
 */

const PENDING_STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 min

const INTERNAL_STATUSES = Object.freeze({
  CREATING: 'creating',
  PENDING: 'pending',
  APPROVED: 'approved',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
});

/**
 * Normalize a raw provider status into an internal status.
 * This is a centralized mapping — never compare raw strings in controllers.
 *
 * @param {string|null} rawStatus — status from Tilopay API/webhook
 * @returns {string} internal status from INTERNAL_STATUSES
 */
function normalizeStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== 'string') return INTERNAL_STATUSES.UNKNOWN;

  const s = rawStatus.toLowerCase().trim();

  // Terminal success
  if (s === 'approved' || s === 'success' || s === 'completed' || s === 'accepted') {
    return INTERNAL_STATUSES.APPROVED;
  }

  // Terminal failure
  if (s === 'declined' || s === 'rejected' || s === 'denied') {
    return INTERNAL_STATUSES.DECLINED;
  }

  // Cancelled
  if (s === 'cancelled' || s === 'canceled' || s === 'voided') {
    return INTERNAL_STATUSES.CANCELLED;
  }

  // Expired
  if (s === 'expired' || s === 'timeout') {
    return INTERNAL_STATUSES.EXPIRED;
  }

  // General failure
  if (s === 'failed' || s === 'error') {
    return INTERNAL_STATUSES.FAILED;
  }

  // Pending / in-progress
  if (s === 'pending' || s === 'processing' || s === 'in_progress' || s === 'authorizing') {
    return INTERNAL_STATUSES.PENDING;
  }

  return INTERNAL_STATUSES.UNKNOWN;
}

/**
 * Check whether a status is terminal (no further transitions expected).
 */
function isTerminal(status) {
  return [INTERNAL_STATUSES.APPROVED, INTERNAL_STATUSES.DECLINED,
    INTERNAL_STATUSES.CANCELLED, INTERNAL_STATUSES.EXPIRED,
    INTERNAL_STATUSES.FAILED].includes(status);
}

/**
 * Check whether the status allows the order to be marked as paid.
 * ONLY `approved` marks the order paid.
 */
function isApproved(status) {
  return status === INTERNAL_STATUSES.APPROVED;
}

/**
 * Check whether the customer may retry payment.
 */
function canRetry(status) {
  return [INTERNAL_STATUSES.DECLINED, INTERNAL_STATUSES.CANCELLED,
    INTERNAL_STATUSES.EXPIRED, INTERNAL_STATUSES.FAILED].includes(status);
}

/**
 * Customer-safe message for a given provider consult code.
 *
 * NEVER returns raw provider text (e.g. "Issuer unreachable").
 * Always returns normalized Spanish messages safe for customer display.
 *
 * @param {string} providerCode - raw code from consult (e.g. "1", "98")
 * @param {string} providerResponse - raw provider response text (logged only, never returned)
 * @returns {{ code: string, status: string, label: string, title: string, message: string, terminal: boolean }}
 */
function mapProviderCode(providerCode, providerResponse) {
  const code = String(providerCode || '').trim();
  const raw = String(providerResponse || '');

  const MAP = {
    // ✓ Approved
    '1': {
      status: INTERNAL_STATUSES.APPROVED,
      label: 'Confirmado',
      title: 'Pago confirmado',
      message: 'Pago confirmado. Gracias por tu compra.',
      terminal: true,
      paid: true,
    },
    // ✗ Declined / authorization denied
    '2': {
      status: INTERNAL_STATUSES.DECLINED,
      label: 'Rechazado',
      title: 'No fue posible autorizar el pago',
      message: 'La transacción no pudo ser autorizada. Puedes intentarlo nuevamente o utilizar otra tarjeta.',
      terminal: true,
      paid: false,
    },
    // ✗ Stolen / pick-up card (real sandbox: code 43, "Pick up card stolen card")
    // NEVER expose "stolen", "robada", or "pick up card" to the customer.
    '43': {
      status: INTERNAL_STATUSES.DECLINED,
      label: 'Rechazado',
      title: 'No fue posible autorizar el pago',
      message: 'No fue posible autorizar la tarjeta. Utiliza otra tarjeta o contacta a tu entidad emisora.',
      terminal: true,
      paid: false,
    },
    // ✗ Insufficient funds (real sandbox: code 51, "Insufficient funds")
    '51': {
      status: INTERNAL_STATUSES.DECLINED,
      label: 'Rechazado',
      title: 'Pago no completado',
      message: 'La transacción no pudo completarse por fondos insuficientes.',
      terminal: true,
      paid: false,
    },
    // ✗ 3DS / authentication failed
    '7': {
      status: INTERNAL_STATUSES.DECLINED,
      label: 'Rechazado',
      title: 'Verificación de seguridad no completada',
      message: 'No fue posible completar la verificación de seguridad de la tarjeta. Puedes intentarlo nuevamente.',
      terminal: true,
      paid: false,
    },
    // ✗ Cancelled
    '8': {
      status: INTERNAL_STATUSES.CANCELLED,
      label: 'Cancelado',
      title: 'Pago cancelado',
      message: 'El pago fue cancelado. Puedes intentarlo nuevamente cuando quieras.',
      terminal: true,
      paid: false,
    },
    // ✗ Invalid CVV (real sandbox: code 82, "Invalid CVV")
    '82': {
      status: INTERNAL_STATUSES.DECLINED,
      label: 'Rechazado',
      title: 'No fue posible validar la tarjeta',
      message: 'Los datos de seguridad de la tarjeta no pudieron validarse.',
      terminal: true,
      paid: false,
    },
    // ✗ Issuer unreachable / unavailable (real sandbox observation)
    '98': {
      status: INTERNAL_STATUSES.DECLINED,
      label: 'Rechazado',
      title: 'No fue posible procesar el pago',
      message: 'La entidad emisora no pudo procesar la solicitud. Inténtalo nuevamente más tarde o utiliza otra tarjeta.',
      terminal: true,
      paid: false,
    },
  };

  if (MAP[code]) {
    return { code, ...MAP[code] };
  }

  // Unknown code — treat as terminal failure with safe message.
  // Raw provider response is NOT returned; it's available in admin diagnostics only.
  return {
    code: code || 'unknown',
    status: INTERNAL_STATUSES.FAILED,
    label: 'No completado',
    title: 'No fue posible procesar el pago',
    message: 'No fue posible procesar el pago en este momento. Inténtalo nuevamente.',
    terminal: true,
    paid: false,
  };
}

/**
 * Customer-safe label for a Tilopay transaction status.
 */
function customerLabel(status) {
  const labels = {
    creating: 'Iniciando pago',
    pending: 'Verificando',
    approved: 'Pago confirmado',
    declined: 'Pago rechazado',
    cancelled: 'Pago cancelado',
    expired: 'Pago expirado',
    failed: 'No completado',
    unknown: 'Estado desconocido',
  };
  return labels[status] || 'Estado desconocido';
}

module.exports = {
  PENDING_STALE_THRESHOLD_MS,
  INTERNAL_STATUSES,
  normalizeStatus,
  isTerminal,
  isApproved,
  canRetry,
  customerLabel,
  mapProviderCode,
};
