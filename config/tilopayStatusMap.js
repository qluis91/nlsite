/**
 * Tilopay status normalization — map raw provider status to internal allowlist.
 * Source: Tilopay SDK v1 documentation (2023-08-30, version 1.2.0).
 *
 * The SDK's `startPayment()` redirect flow does not return an explicit status string
 * in the redirect URL. The authoritative status is provided via:
 *   a) Server-side API transaction lookup (endpoint TBD from Tilopay API docs)
 *   b) Webhook/callback notification (endpoint TBD)
 *
 * Until the full API documentation is available, this mapping uses the
 * documented `redirect` callback URL where Tilopay appends query parameters
 * (specific param names unconfirmed) and the server-side lookup endpoint.
 */

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
 * Customer-safe label for a Tilopay transaction status.
 */
function customerLabel(status) {
  const labels = {
    creating: 'Iniciando pago',
    pending: 'Pago en proceso',
    approved: 'Pago confirmado',
    declined: 'Pago rechazado',
    cancelled: 'Pago cancelado',
    expired: 'Pago expirado',
    failed: 'Error en el pago',
    unknown: 'Estado desconocido',
  };
  return labels[status] || 'Estado desconocido';
}

module.exports = {
  INTERNAL_STATUSES,
  normalizeStatus,
  isTerminal,
  isApproved,
  canRetry,
  customerLabel,
};
