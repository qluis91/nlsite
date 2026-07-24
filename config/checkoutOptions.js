/**
 * Checkout domain options — delivery methods, payment methods, Costa Rican provinces.
 * These are the canonical server-authoritative values.
 */

// ── Delivery Methods ──
const DELIVERY_METHODS = {
  local_pickup: {
    key: 'local_pickup',
    label: 'Retiro en local',
    description: 'Recoge tu pedido directamente en nuestras instalaciones.',
    requiresAddress: false,
    shippingStatus: 'not_required',
    shippingAmount: 0,
  },
  uber_flash: {
    key: 'uber_flash',
    label: 'Uber Flash',
    description: 'Entrega express mediante Uber Flash. El costo se calcula según ubicación.',
    requiresAddress: true,
    shippingStatus: 'pending_quote',
    shippingAmount: null,
  },
  private_courier: {
    key: 'private_courier',
    label: 'Mensajero privado',
    description: 'Entrega mediante mensajería privada. El costo se calcula según ubicación.',
    requiresAddress: true,
    shippingStatus: 'pending_quote',
    shippingAmount: null,
  },
  correos_cr: {
    key: 'correos_cr',
    label: 'Correos de Costa Rica',
    description: 'Envío nacional mediante Correos de Costa Rica. El costo se calcula según destino.',
    requiresAddress: true,
    shippingStatus: 'pending_quote',
    shippingAmount: null,
  },
};

const DELIVERY_METHOD_KEYS = Object.keys(DELIVERY_METHODS);

// ── Payment Methods ──
const PAYMENT_METHODS = {
  sinpe: {
    key: 'sinpe',
    label: 'SINPE Móvil',
    description: 'Pago inmediato mediante SINPE Móvil.',
    enabled: true,
    paymentStatus: 'pending',
  },
  bank_transfer: {
    key: 'bank_transfer',
    label: 'Transferencia bancaria',
    description: 'Transferencia a cuenta bancaria nacional.',
    enabled: true,
    paymentStatus: 'pending',
  },
  tilopay: {
    key: 'tilopay',
    label: 'Tarjeta de crédito / débito con Tilopay',
    description: 'Pago seguro con tarjeta mediante Tilopay.',
    enabled: (() => {
      try { return !!require('./tilopay').ENABLED; }
      catch { return false; }
    })(),
    paymentStatus: 'pending',
  },
};

const ENABLED_PAYMENT_KEYS = Object.keys(PAYMENT_METHODS).filter(k => PAYMENT_METHODS[k].enabled);
const ALL_PAYMENT_KEYS = Object.keys(PAYMENT_METHODS);

// ── Costa Rican Provinces ──
const CR_PROVINCES = [
  'San José',
  'Alajuela',
  'Cartago',
  'Heredia',
  'Guanacaste',
  'Puntarenas',
  'Limón',
];

// ── Order Status Values ──
const SHIPPING_STATUSES = ['not_required', 'pending_quote', 'quoted'];
const PAYMENT_STATUSES = ['pending', 'paid'];

module.exports = {
  DELIVERY_METHODS,
  DELIVERY_METHOD_KEYS,
  PAYMENT_METHODS,
  ENABLED_PAYMENT_KEYS,
  ALL_PAYMENT_KEYS,
  CR_PROVINCES,
  SHIPPING_STATUSES,
  PAYMENT_STATUSES,
};
