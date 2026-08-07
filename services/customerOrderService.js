const pool = require('../config/db');
const {
  CUSTOMER_ORDER_STATUS_LABELS,
  CUSTOMER_SHIPPING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  DELIVERY_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
} = require('../config/orderOptions');
const { getWhatsAppPhone } = require('../config/publicContact');

const ORDER_REFERENCE_RE = /^NL-[A-Z0-9]{12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUEST_GRANT_TTL_MS = 30 * 60 * 1000;
const MAX_GUEST_GRANTS = 5;
const CUSTOMER_PAGE_SIZE = 10;
const MAX_CUSTOMER_PAGE_SIZE = 50;
const RECENT_ORDER_TTL_MS = 60 * 60 * 1000;

const ORDER_FIELDS = `
  o.id AS internal_id, o.order_reference, o.customer_name, o.customer_email, o.customer_phone,
  o.delivery_method, o.shipping_status, o.shipping_amount,
  o.payment_method, o.payment_status, o.order_status,
  o.province, o.canton, o.district, o.address_line, o.address_reference,
  o.product_subtotal, o.final_total, o.created_at, o.updated_at`;

function normalizeReference(value) {
  const reference = String(value || '').trim().toUpperCase();
  return ORDER_REFERENCE_RE.test(reference) ? reference : null;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 180 && EMAIL_RE.test(email) ? email : null;
}

function normalizePagination(query = {}) {
  const pageRaw = String(query.page || '1');
  const limitRaw = String(query.limit || CUSTOMER_PAGE_SIZE);
  const page = /^\d+$/.test(pageRaw) ? Math.max(1, Math.min(Number(pageRaw), 1000000)) : 1;
  const limit = /^\d+$/.test(limitRaw)
    ? Math.max(1, Math.min(Number(limitRaw), MAX_CUSTOMER_PAGE_SIZE)) : CUSTOMER_PAGE_SIZE;
  return { page, limit };
}

function formatPublicPhone() {
  const digits = getWhatsAppPhone();
  if (digits === '50670240270') return '+506 7024 0270';
  return digits.startsWith('506') && digits.length === 11
    ? `+506 ${digits.slice(3, 7)} ${digits.slice(7)}` : `+${digits}`;
}

function buildPaymentInstructions(order) {
  if (!order || order.order_status === 'cancelled') return null;
  if (order.payment_status === 'paid') {
    return { type: 'confirmed', title: 'Pago confirmado', lines: ['Pago confirmado.'] };
  }
  if (order.shipping_status === 'pending_quote' || order.final_total === null || order.final_total === undefined) {
    return {
      type: 'wait_for_quote', title: 'Espera la cotización',
      lines: ['No realices ningún pago todavía.', 'NinjaLab confirmará el costo de envío y el total final.'],
    };
  }
  if (order.payment_method === 'sinpe') {
    return {
      type: 'sinpe', title: 'Pago por SINPE Móvil',
      lines: [
        `Puedes realizar el SINPE Móvil al ${formatPublicPhone()}.`,
        'Incluye la referencia del pedido en el detalle.',
        'El pago será confirmado manualmente por NinjaLab.',
      ],
    };
  }
  if (order.payment_method === 'bank_transfer') {
    return {
      type: 'bank_transfer', title: 'Transferencia bancaria',
      lines: [
        'NinjaLab te enviará los datos bancarios para realizar la transferencia.',
        'Incluye la referencia del pedido al efectuar el pago.',
      ],
    };
  }
  if (order.payment_method === 'tilopay') {
    if (order.payment_status === 'paid') {
      return { type: 'confirmed', title: 'Pago confirmado', lines: ['El pago con tarjeta fue confirmado.'] };
    }
    if (order.payment_status === 'pending') {
      if (order.order_status === 'pending_shipping_quote' || order.shipping_status === 'pending_quote') {
        return {
          type: 'wait_for_quote', title: 'Pago pendiente de cotización',
          lines: ['El pago con tarjeta estará disponible una vez que se cotice el envío.'],
        };
      }
      return {
        type: 'tilopay_pending', title: 'Pago con tarjeta pendiente',
        lines: ['Usa el botón Pagar con Tilopay para completar tu pago con tarjeta.'],
      };
    }
  }
  return null;
}

const STATUS_TIMELINE = Object.freeze({
  preparing: ['preparing', 'En preparación', 'Tu pedido está en preparación.'],
  ready_for_pickup: ['ready_for_pickup', 'Listo para retirar', 'Tu pedido está listo para retirar.'],
  ready_for_dispatch: ['ready_for_dispatch', 'Listo para enviar', 'Tu pedido está listo para enviar.'],
  dispatched: ['dispatched', 'Enviado', 'Tu pedido fue enviado.'],
  completed: ['completed', 'Completado', 'Tu pedido fue completado.'],
  cancelled: ['cancelled', 'Cancelado', 'Tu pedido fue cancelado.'],
});

function buildPublicTimeline(order, events = []) {
  const timeline = [{
    type: 'order_created', label: 'Pedido recibido',
    description: 'Recibimos tu pedido.', occurredAt: order.created_at,
  }];
  const seen = new Set(['order_created']);
  for (const event of events) {
    let item = null;
    if (event.event_type === 'shipping_quoted') {
      item = ['shipping_quoted', 'Envío cotizado', 'El costo de envío y el total final fueron confirmados.'];
    } else if (event.event_type === 'payment_confirmed') {
      item = ['payment_confirmed', 'Pago confirmado', 'NinjaLab confirmó el pago de tu pedido.'];
    } else if (event.event_type === 'order_status_changed' && STATUS_TIMELINE[event.to_status]) {
      item = STATUS_TIMELINE[event.to_status];
    } else if (event.event_type === 'order_cancelled') {
      item = STATUS_TIMELINE.cancelled;
    }
    if (item && !seen.has(item[0])) {
      seen.add(item[0]);
      timeline.push({ type: item[0], label: item[1], description: item[2], occurredAt: event.created_at });
    }
  }
  if (order.shipping_status === 'quoted' && !seen.has('shipping_quoted')) {
    seen.add('shipping_quoted');
    timeline.push({
      type: 'shipping_quoted', label: 'Envío cotizado',
      description: 'El costo de envío y el total final fueron confirmados.', occurredAt: order.updated_at,
    });
  }
  if (order.payment_status === 'paid' && !seen.has('payment_confirmed')) {
    seen.add('payment_confirmed');
    timeline.push({
      type: 'payment_confirmed', label: 'Pago confirmado',
      description: 'NinjaLab confirmó el pago de tu pedido.', occurredAt: order.updated_at,
    });
  }
  const current = STATUS_TIMELINE[order.order_status];
  if (current && !seen.has(current[0])) {
    timeline.push({ type: current[0], label: current[1], description: current[2], occurredAt: order.updated_at });
  }
  return timeline.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
}

function serializeOrderSummary(row) {
  return {
    reference: row.order_reference,
    createdAt: row.created_at,
    orderStatus: row.order_status,
    orderStatusLabel: CUSTOMER_ORDER_STATUS_LABELS[row.order_status] || 'Estado pendiente',
    paymentStatus: row.payment_status,
    paymentStatusLabel: PAYMENT_STATUS_LABELS[row.payment_status] || 'Pendiente',
    shippingStatus: row.shipping_status,
    shippingStatusLabel: CUSTOMER_SHIPPING_STATUS_LABELS[row.shipping_status] || 'Por calcular',
    deliveryMethod: row.delivery_method,
    deliveryMethodLabel: DELIVERY_METHOD_LABELS[row.delivery_method] || 'Entrega',
    shippingAmount: row.shipping_amount,
    productSubtotal: row.product_subtotal,
    finalTotal: row.final_total,
    itemCount: Number(row.item_count || 0),
  };
}

function serializeCustomerOrder(row, items, events) {
  return {
    reference: row.order_reference,
    createdAt: row.created_at,
    orderStatus: row.order_status,
    orderStatusLabel: CUSTOMER_ORDER_STATUS_LABELS[row.order_status] || 'Estado pendiente',
    paymentMethod: row.payment_method,
    paymentMethodLabel: PAYMENT_METHOD_LABELS[row.payment_method] || 'Pago manual',
    paymentStatus: row.payment_status,
    paymentStatusLabel: PAYMENT_STATUS_LABELS[row.payment_status] || 'Pendiente',
    deliveryMethod: row.delivery_method,
    deliveryMethodLabel: DELIVERY_METHOD_LABELS[row.delivery_method] || 'Entrega',
    shippingStatus: row.shipping_status,
    shippingStatusLabel: CUSTOMER_SHIPPING_STATUS_LABELS[row.shipping_status] || 'Por calcular',
    shippingAmount: row.shipping_amount,
    productSubtotal: row.product_subtotal,
    finalTotal: row.final_total,
    customerName: row.customer_name,
    customerEmail: row.customer_email || '',
    customerPhone: String(row.customer_phone || ''),
    deliveryAddress: row.delivery_method === 'local_pickup' ? null : {
      province: row.province, canton: row.canton, district: row.district,
      addressLine: row.address_line, reference: row.address_reference,
    },
    items,
    timeline: buildPublicTimeline(row, events),
    paymentInstructions: buildPaymentInstructions(row),
  };
}

async function listOrdersForUser(userId, query) {
  const pagination = normalizePagination(query);
  const [[countRow]] = await pool.query('SELECT COUNT(*) AS total FROM orders WHERE user_id = ?', [userId]);
  const total = Number(countRow.total);
  const totalPages = Math.max(1, Math.ceil(total / pagination.limit));
  pagination.page = Math.min(pagination.page, totalPages);
  const [rows] = await pool.query(
    `SELECT o.order_reference, o.created_at, o.order_status, o.payment_status,
            o.shipping_status, o.delivery_method, o.product_subtotal, o.shipping_amount,
            o.final_total, COALESCE(SUM(oi.quantity), 0) AS item_count
       FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = ? GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
    [userId, pagination.limit, (pagination.page - 1) * pagination.limit]
  );
  return { orders: rows.map(serializeOrderSummary), total, totalPages, ...pagination };
}

async function getAccountDashboardSummary(userId) {
  const [[counts]] = await pool.query(
    `SELECT
       COUNT(*) AS total_orders,
       COALESCE(SUM(payment_status = 'pending' AND order_status <> 'cancelled'), 0) AS pending_payment_orders,
       COALESCE(SUM(order_status IN ('preparing','ready_for_pickup','ready_for_dispatch','dispatched')), 0) AS active_orders,
       COALESCE(SUM(order_status = 'completed'), 0) AS completed_orders
     FROM orders
     WHERE user_id = ?`,
    [userId]
  );
  const [latestRows] = await pool.query(
    `SELECT o.order_reference, o.created_at, o.order_status, o.payment_status,
            o.shipping_status, o.delivery_method, o.product_subtotal, o.shipping_amount,
            o.final_total, COALESCE(SUM(oi.quantity), 0) AS item_count
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT 1`,
    [userId]
  );
  return {
    totalOrders: Number(counts.total_orders || 0),
    pendingPaymentOrders: Number(counts.pending_payment_orders || 0),
    activeOrders: Number(counts.active_orders || 0),
    completedOrders: Number(counts.completed_orders || 0),
    latestOrder: latestRows[0] ? serializeOrderSummary(latestRows[0]) : null,
  };
}

async function getAccessRecord(reference) {
  const [rows] = await pool.query(
    `SELECT o.id AS internal_id, o.order_reference, o.user_id FROM orders o WHERE o.order_reference = ? LIMIT 1`,
    [reference]
  );
  return rows[0] || null;
}

async function loadCustomerOrder(whereSql, params) {
  const [rows] = await pool.query(`SELECT ${ORDER_FIELDS} FROM orders o WHERE ${whereSql} LIMIT 1`, params);
  const row = rows[0];
  if (!row) return null;
  const [items] = await pool.query(
    `SELECT oi.product_name, oi.product_slug, oi.quantity, oi.unit_price, oi.line_total, oi.primary_image,
            CASE WHEN p.id IS NOT NULL AND p.is_active = 1 AND p.is_published = 1 THEN p.slug ELSE NULL END AS live_slug
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ? ORDER BY oi.id`,
    [row.internal_id]
  );
  const [events] = await pool.query(
    `SELECT event_type, to_status, created_at FROM order_events WHERE order_id = ? ORDER BY created_at, id`,
    [row.internal_id]
  );
  const safeItems = items.map((item) => ({
    productName: item.product_name, productSlug: item.product_slug, quantity: item.quantity,
    unitPrice: item.unit_price, lineTotal: item.line_total, primaryImage: item.primary_image,
    productUrl: item.live_slug ? `/tienda/${encodeURIComponent(item.live_slug)}` : null,
  }));
  return serializeCustomerOrder(row, safeItems, events);
}

async function getOrderForUser(reference, userId) {
  return loadCustomerOrder('o.order_reference = ? AND o.user_id = ?', [reference, userId]);
}

async function getCustomerSafeOrder(reference) {
  return loadCustomerOrder('o.order_reference = ?', [reference]);
}

async function verifyGuestOrder(reference, email) {
  const [rows] = await pool.query(
    `SELECT order_reference FROM orders
      WHERE order_reference = ? AND user_id IS NULL AND LOWER(customer_email) = ? LIMIT 1`,
    [reference, email]
  );
  return rows[0] ? rows[0].order_reference : null;
}

function sanitizeGuestAccessGrants(value, now = Date.now()) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const valid = [];
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const grant = value[index];
    const reference = normalizeReference(grant && grant.reference);
    const grantedAt = Date.parse(grant && grant.grantedAt);
    const expiresAt = Date.parse(grant && grant.expiresAt);
    if (!reference || seen.has(reference) || !Number.isFinite(grantedAt) || !Number.isFinite(expiresAt)) continue;
    if (expiresAt <= now || grantedAt > now + 60000 || expiresAt - grantedAt > GUEST_GRANT_TTL_MS) continue;
    seen.add(reference);
    valid.push({ reference, grantedAt: new Date(grantedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString() });
    if (valid.length === MAX_GUEST_GRANTS) break;
  }
  return valid.reverse();
}

function grantGuestOrderAccess(session, reference, now = Date.now()) {
  const grants = sanitizeGuestAccessGrants(session.guestOrderAccess, now)
    .filter((grant) => grant.reference !== reference);
  grants.push({ reference, grantedAt: new Date(now).toISOString(), expiresAt: new Date(now + GUEST_GRANT_TTL_MS).toISOString() });
  session.guestOrderAccess = grants.slice(-MAX_GUEST_GRANTS);
}

function hasRecentOrderAccess(session, reference, now = Date.now()) {
  const recent = Array.isArray(session.recentOrders) ? session.recentOrders.slice(-5) : [];
  return recent.some((entry) => entry && normalizeReference(entry.reference) === reference
    && Number.isFinite(Number(entry.expiresAt)) && Number(entry.expiresAt) > now);
}

function recordRecentOrderAccess(session, reference, now = Date.now()) {
  const recent = (Array.isArray(session.recentOrders) ? session.recentOrders : [])
    .filter((entry) => entry && normalizeReference(entry.reference) !== reference
      && Number.isFinite(Number(entry.expiresAt)) && Number(entry.expiresAt) > now)
    .slice(-4)
    .map((entry) => ({ reference: normalizeReference(entry.reference), expiresAt: Number(entry.expiresAt) }))
    .filter((entry) => entry.reference);
  recent.push({ reference, expiresAt: now + RECENT_ORDER_TTL_MS });
  session.recentOrders = recent;
}

function canAccessGuestOrder(reference, session, now = Date.now()) {
  if (hasRecentOrderAccess(session, reference, now)) return true;
  const grants = sanitizeGuestAccessGrants(session.guestOrderAccess, now);
  session.guestOrderAccess = grants;
  return grants.some((grant) => grant.reference === reference);
}

function canAccessCustomerOrder({ order, authenticatedUser, session, now = Date.now() }) {
  if (!order) return false;
  if (authenticatedUser && authenticatedUser.id) return Number(order.user_id) === Number(authenticatedUser.id);
  return order.user_id === null && canAccessGuestOrder(order.order_reference, session, now);
}

// ── Resolve the primary next action for customer-facing display ──
function resolveNextAction(order, proofSummary, tilopayTx) {
  if (order.orderStatus === 'cancelled') return null;

  if (order.shippingStatus === 'pending_quote' || order.finalTotal === null) {
    return { type: 'wait_shipping', title: 'Esperar cotización de envío',
      description: 'NinjaLab confirmará el costo de envío y el total final.', enabled: false };
  }

  if (order.paymentStatus === 'paid') {
    if (order.orderStatus === 'completed') return null;
    if (order.orderStatus === 'ready_for_pickup') {
      return { type: 'pickup', title: 'Listo para retirar',
        description: 'Tu pedido está listo. Acércate a recogerlo.', enabled: false };
    }
    if (order.orderStatus === 'dispatched') {
      return { type: 'tracking', title: 'En camino',
        description: 'Tu pedido fue enviado.', enabled: false };
    }
    return { type: 'preparing', title: 'En preparación',
      description: 'Tu pedido está en producción.', enabled: false };
  }

  const hasTilopayPending = tilopayTx && tilopayTx.some(tx => tx.status === 'pending' || tx.status === 'creating' || tx.status === 'unknown');
  const hasTilopayApproved = tilopayTx && tilopayTx.some(tx => tx.status === 'approved');
  const tilopayEligible = order.paymentMethod === 'tilopay' && order.orderStatus === 'pending_payment';

  // Resolve stale threshold from centralized config (fallback: 15 min)
  var statusMap = null;
  try { statusMap = require('../config/tilopayStatusMap'); } catch (_) {}
  var STALE_MS = statusMap && statusMap.PENDING_STALE_THRESHOLD_MS || 900000;

  // Recent = still within the safe pending window
  var hasRecentPending = tilopayTx && tilopayTx.some(function(tx) {
    if (tx.status !== 'pending' && tx.status !== 'creating' && tx.status !== 'unknown') return false;
    var age = Date.now() - new Date(tx.createdAt).getTime();
    return age < STALE_MS;
  });

  if (hasTilopayApproved) {
    return { type: 'payment_processing', title: 'Pago confirmado',
      description: 'Tu pago con tarjeta fue confirmado.', enabled: false };
  }

  if (hasRecentPending && tilopayTx) {
    var pendingTx = tilopayTx.find(function(tx) {
      return tx.status === 'pending' || tx.status === 'creating' || tx.status === 'unknown';
    });
    return { type: 'tilopay_verify', title: 'Verificando pago',
      description: 'Estamos verificando el estado de tu pago. Esto puede tardar unos minutos.',
      tilopayInternalRef: pendingTx ? pendingTx.internalRef : null, enabled: true };
  }

  if (tilopayEligible) {
    return { type: 'pay_tilopay', title: 'Pagar con tarjeta',
      description: 'Completa tu pago de forma segura con Tilopay.',
      isTilopay: true, enabled: true };
  }

  const proofNotSubmitted = !proofSummary || proofSummary.status === 'not_submitted';
  const proofRejected = proofSummary && proofSummary.status === 'rejected';
  const proofReviewing = proofSummary && proofSummary.status === 'pending_review';
  const proofApproved = proofSummary && proofSummary.status === 'approved';

  if (proofNotSubmitted) {
    return { type: 'upload_proof', title: 'Subir comprobante',
      description: 'Adjunta el comprobante de SINPE o transferencia.', isProof: true, enabled: true };
  }

  if (proofRejected) {
    return { type: 'proof_rejected', title: 'Comprobante rechazado',
      description: proofSummary.proof.rejectionReason || 'Intenta subir un nuevo comprobante.',
      isProof: true, enabled: true };
  }

  if (proofReviewing) {
    return { type: 'proof_reviewing', title: 'Comprobante en revisión',
      description: 'NinjaLab está revisando tu comprobante.', enabled: false };
  }

  if (proofApproved) {
    return { type: 'payment_processing', title: 'Pago en proceso',
      description: 'Tu comprobante fue aprobado.', enabled: false };
  }

  return null;
}

// ── Resolve order progress stages for visual timeline ──
function resolveOrderProgress(order) {
  const stages = [
    { key: 'received', label: 'Pedido recibido', description: 'Recibimos tu pedido.',
      state: 'done', occurredAt: order.createdAt },
    { key: 'payment', label: 'Pago', description: '',
      state: 'upcoming', occurredAt: null },
    { key: 'fulfillment', label: 'Preparación / envío', description: '',
      state: 'upcoming', occurredAt: null },
    { key: 'completed', label: 'Completado', description: '',
      state: 'upcoming', occurredAt: null },
  ];

  if (order.orderStatus === 'cancelled') {
    stages.forEach(s => { s.state = s.key === 'received' ? 'done' : 'skipped'; });
    return {
      stages: stages.concat({ key: 'cancelled', label: 'Cancelado', description: 'Tu pedido fue cancelado.',
        state: 'error', occurredAt: order.updatedAt }),
      currentKey: 'cancelled', exceptionalState: 'cancelled',
    };
  }

  if (order.paymentStatus === 'paid') {
    stages[1].state = 'done';
    stages[1].description = 'Pago confirmado.';
    stages[1].occurredAt = order.updatedAt;
  } else if (order.shippingStatus === 'pending_quote') {
    stages[1].state = 'current';
    stages[1].description = 'Pendiente de cotización de envío.';
  } else {
    stages[1].state = 'current';
    stages[1].description = 'Pago pendiente.';
  }

  const activeStatuses = ['preparing', 'ready_for_pickup', 'ready_for_dispatch', 'dispatched'];
  if (activeStatuses.includes(order.orderStatus) && order.paymentStatus === 'paid') {
    stages[2].state = 'current';
    stages[2].description = CUSTOMER_ORDER_STATUS_LABELS[order.orderStatus] || 'En proceso.';
    if (stages[1].state === 'current') stages[1].state = 'done';
  }

  if (order.orderStatus === 'completed') {
    stages.forEach(s => { s.state = 'done'; });
    stages[3].description = 'Pedido completado.';
  }

  const currentStage = stages.find(s => s.state === 'current') || stages[stages.length - 1];
  return { stages, currentKey: currentStage.key, exceptionalState: null };
}

module.exports = {
  ORDER_REFERENCE_RE, GUEST_GRANT_TTL_MS, MAX_GUEST_GRANTS,
  normalizeReference, normalizeEmail, normalizePagination,
  buildPaymentInstructions, buildPublicTimeline, serializeCustomerOrder,
  listOrdersForUser, getAccountDashboardSummary, getAccessRecord, getOrderForUser, getCustomerSafeOrder,
  verifyGuestOrder, sanitizeGuestAccessGrants, grantGuestOrderAccess,
  hasRecentOrderAccess, recordRecentOrderAccess, canAccessGuestOrder, canAccessCustomerOrder,
  resolveNextAction, resolveOrderProgress,
};
