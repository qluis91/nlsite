/**
 * Checkout validators — validate customer info, delivery, payment, address.
 */

const { DELIVERY_METHOD_KEYS, DELIVERY_METHODS, ENABLED_PAYMENT_KEYS, CR_PROVINCES } = require('../config/checkoutOptions');

const NAME_MAX = 120;
const EMAIL_MAX = 180;
const PHONE_MAX = 30;
const ADDRESS_MAX = 300;
const REFERENCE_MAX = 200;
const CANTON_MAX = 80;
const DISTRITO_MAX = 80;

function validateCustomerName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { valid: false, error: 'El nombre completo es obligatorio.' };
  if (trimmed.length > NAME_MAX) return { valid: false, error: `El nombre no debe exceder ${NAME_MAX} caracteres.` };
  return { valid: true, value: trimmed };
}

function validateEmail(email) {
  const trimmed = String(email || '').trim().toLowerCase();
  if (!trimmed) return { valid: false, error: 'El correo electrónico es obligatorio.' };
  if (trimmed.length > EMAIL_MAX) return { valid: false, error: `El correo no debe exceder ${EMAIL_MAX} caracteres.` };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { valid: false, error: 'Ingresa un correo electrónico válido.' };
  return { valid: true, value: trimmed };
}

function validatePhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return { valid: false, error: 'El teléfono es obligatorio.' };
  // Normalize: keep only digits
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) return { valid: false, error: 'Ingresa un número de teléfono válido.' };
  if (digits.length > 15) return { valid: false, error: 'El teléfono no debe exceder 15 dígitos.' };
  return { valid: true, value: digits, display: '+' + digits };
}

function validateDeliveryMethod(key) {
  const k = String(key || '').trim();
  if (!DELIVERY_METHOD_KEYS.includes(k)) return { valid: false, error: 'Selecciona un método de entrega válido.' };
  return { valid: true, value: k, config: DELIVERY_METHODS[k] };
}

function validatePaymentMethod(key) {
  const k = String(key || '').trim();
  if (!ENABLED_PAYMENT_KEYS.includes(k)) return { valid: false, error: 'Selecciona un método de pago válido.' };
  return { valid: true, value: k };
}

function validateProvince(val) {
  const v = String(val || '').trim();
  if (!CR_PROVINCES.includes(v)) return { valid: false, error: 'Selecciona una provincia válida.' };
  return { valid: true, value: v };
}

function validateCanton(val) {
  const v = String(val || '').trim();
  if (!v) return { valid: false, error: 'El cantón es obligatorio.' };
  if (v.length > CANTON_MAX) return { valid: false, error: `El cantón no debe exceder ${CANTON_MAX} caracteres.` };
  return { valid: true, value: v };
}

function validateDistrito(val) {
  const v = String(val || '').trim();
  if (!v) return { valid: false, error: 'El distrito es obligatorio.' };
  if (v.length > DISTRITO_MAX) return { valid: false, error: `El distrito no debe exceder ${DISTRITO_MAX} caracteres.` };
  return { valid: true, value: v };
}

function validateAddressLine(val) {
  const v = String(val || '').trim();
  if (!v) return { valid: false, error: 'La dirección exacta es obligatoria.' };
  if (v.length > ADDRESS_MAX) return { valid: false, error: `La dirección no debe exceder ${ADDRESS_MAX} caracteres.` };
  return { valid: true, value: v };
}

function validateAddressReference(val, required = false) {
  const v = String(val || '').trim();
  if (required && !v) return { valid: false, error: 'Las referencias son obligatorias.' };
  if (v.length > REFERENCE_MAX) return { valid: false, error: `Las referencias no deben exceder ${REFERENCE_MAX} caracteres.` };
  return { valid: true, value: v || null };
}

/**
 * Validate the full checkout payload.
 */
function validateCheckoutPayload(body, deliveryConfig) {
  const errors = {};
  const data = {};

  // Customer
  const name = validateCustomerName(body.customerName);
  if (!name.valid) errors.customerName = name.error; else data.customerName = name.value;

  const email = validateEmail(body.email);
  if (!email.valid) errors.email = email.error; else data.email = email.value;

  const phone = validatePhone(body.phone);
  if (!phone.valid) errors.phone = phone.error; else data.phone = phone.value;

  // Delivery
  const dlv = validateDeliveryMethod(body.deliveryMethod);
  if (!dlv.valid) errors.deliveryMethod = dlv.error; else data.deliveryMethod = dlv.value;

  // Payment
  const pmt = validatePaymentMethod(body.paymentMethod);
  if (!pmt.valid) errors.paymentMethod = pmt.error; else data.paymentMethod = pmt.value;

  // Address (only if delivery requires it)
  const needsAddr = dlv.valid && DELIVERY_METHODS[dlv.value] && DELIVERY_METHODS[dlv.value].requiresAddress;

  if (needsAddr) {
    const prov = validateProvince(body.province);
    if (!prov.valid) errors.province = prov.error; else data.province = prov.value;

    const canton = validateCanton(body.canton);
    if (!canton.valid) errors.canton = canton.error; else data.canton = canton.value;

    const distrito = validateDistrito(body.distrito);
    if (!distrito.valid) errors.distrito = distrito.error; else data.distrito = distrito.value;

    const addr = validateAddressLine(body.addressLine);
    if (!addr.valid) errors.addressLine = addr.error; else data.addressLine = addr.value;

    const ref = validateAddressReference(body.addressReference);
    if (!ref.valid) errors.addressReference = ref.error; else data.addressReference = ref.value;
  }

  return { valid: Object.keys(errors).length === 0, errors, data };
}

module.exports = {
  validateCustomerName,
  validateEmail,
  validatePhone,
  validateDeliveryMethod,
  validatePaymentMethod,
  validateProvince,
  validateCanton,
  validateDistrito,
  validateAddressLine,
  validateAddressReference,
  validateCheckoutPayload,
};
