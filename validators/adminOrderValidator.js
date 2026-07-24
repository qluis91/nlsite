const {
  ORDER_STATUSES,
} = require('../config/orderOptions');
const {
  DELIVERY_METHOD_KEYS,
  ENABLED_PAYMENT_KEYS,
  SHIPPING_STATUSES,
  PAYMENT_STATUSES,
} = require('../config/checkoutOptions');

const ORDER_REFERENCE_RE = /^NL-[A-Z0-9]{8,20}$/;
const MONEY_RE = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONEY_CENTS = 9999999999n;
const MAX_NOTE_LENGTH = 500;
const MAX_PAYMENT_REFERENCE_LENGTH = 120;
const MAX_CARRIER_LENGTH = 40;
const MAX_TRACKING_NUMBER_LENGTH = 120;
const TRACKING_URL_PROTOCOLS = ['https:', 'http:'];
const MAX_TRACKING_URL_LENGTH = 500;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function validateOrderReference(value) {
  const reference = String(first(value) || '').trim().toUpperCase();
  return { valid: ORDER_REFERENCE_RE.test(reference), value: reference };
}

function parseMoneyToCents(value) {
  const normalized = String(first(value) ?? '').trim();
  if (!MONEY_RE.test(normalized)) return { valid: false, error: 'Ingresa un monto CRC válido con máximo dos decimales.' };
  const [whole, fraction = ''] = normalized.split('.');
  const cents = (BigInt(whole) * 100n) + BigInt((fraction + '00').slice(0, 2));
  if (cents > MAX_MONEY_CENTS) return { valid: false, error: 'El monto excede el máximo permitido.' };
  return { valid: true, cents, value: `${whole}.${(fraction + '00').slice(0, 2)}` };
}

function decimalToCents(value) {
  const parsed = parseMoneyToCents(String(value));
  if (!parsed.valid) throw new Error('Monto almacenado inválido.');
  return parsed.cents;
}

function centsToDecimal(cents) {
  const whole = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, '0');
  return `${whole}.${fraction}`;
}

function validateBoundedText(value, max, required, fieldLabel) {
  const text = String(first(value) ?? '').replace(/\0/g, '').trim();
  if (required && !text) return { valid: false, error: `${fieldLabel} es obligatorio.` };
  if (text.length > max) return { valid: false, error: `${fieldLabel} no puede exceder ${max} caracteres.` };
  return { valid: true, value: text || null };
}

function validateCarrier(value) {
  return validateBoundedText(value, MAX_CARRIER_LENGTH, false, 'La empresa de envío');
}

function validateTrackingNumber(value) {
  return validateBoundedText(value, MAX_TRACKING_NUMBER_LENGTH, false, 'El número de rastreo');
}

function validateTrackingUrl(value) {
  const result = validateBoundedText(value, MAX_TRACKING_URL_LENGTH, false, 'La URL de rastreo');
  if (!result.valid) return result;
  if (result.value) {
    try {
      const parsed = new URL(result.value);
      if (!TRACKING_URL_PROTOCOLS.includes(parsed.protocol)) {
        return { valid: false, error: 'La URL de rastreo debe usar http o https.' };
      }
    } catch (_err) {
      return { valid: false, error: 'La URL de rastreo no es válida.' };
    }
  }
  return result;
}

function validateNote(value, required = false) {
  return validateBoundedText(value, MAX_NOTE_LENGTH, required, 'La nota');
}

function validatePaymentReference(value) {
  return validateBoundedText(value, MAX_PAYMENT_REFERENCE_LENGTH, false, 'La referencia de pago');
}

function validateOrderStatus(value) {
  const status = String(first(value) || '').trim();
  return { valid: ORDER_STATUSES.includes(status), value: status, error: 'Estado de pedido inválido.' };
}

function safeDate(value) {
  const date = String(first(value) || '').trim();
  if (!DATE_RE.test(date)) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? '' : date;
}

function positiveInt(value, fallback, max) {
  const raw = String(first(value) ?? '');
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function allowed(value, values) {
  const normalized = String(first(value) || '').trim();
  return values.includes(normalized) ? normalized : '';
}

function parseOrderFilters(query = {}) {
  const rawSearch = String(first(query.search) || '').replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  const sortOptions = ['newest', 'oldest', 'total-desc', 'total-asc'];
  return {
    search: rawSearch.slice(0, 100),
    orderStatus: allowed(query.orderStatus, ORDER_STATUSES),
    paymentStatus: allowed(query.paymentStatus, PAYMENT_STATUSES),
    shippingStatus: allowed(query.shippingStatus, SHIPPING_STATUSES),
    deliveryMethod: allowed(query.deliveryMethod, DELIVERY_METHOD_KEYS),
    paymentMethod: allowed(query.paymentMethod, ENABLED_PAYMENT_KEYS),
    dateFrom: safeDate(query.dateFrom),
    dateTo: safeDate(query.dateTo),
    page: positiveInt(query.page, 1, 1000000),
    limit: positiveInt(query.limit, 25, 50),
    sort: allowed(query.sort, sortOptions) || 'newest',
  };
}

module.exports = {
  MAX_NOTE_LENGTH,
  MAX_PAYMENT_REFERENCE_LENGTH,
  MAX_CARRIER_LENGTH,
  MAX_TRACKING_NUMBER_LENGTH,
  MAX_TRACKING_URL_LENGTH,
  validateOrderReference,
  parseMoneyToCents,
  decimalToCents,
  centsToDecimal,
  validateNote,
  validatePaymentReference,
  validateOrderStatus,
  validateCarrier,
  validateTrackingNumber,
  validateTrackingUrl,
  parseOrderFilters,
};
