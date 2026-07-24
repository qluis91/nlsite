const pool = require('../config/db');
const proofService = require('../services/paymentProofService');
const {
  ORDER_STATUS_LABELS,
  SHIPPING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  DELIVERY_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
  EVENT_TYPE_LABELS,
  getAllowedNextStatuses,
  canQuoteShipping,
  canConfirmPayment,
  canCancelOrder,
} = require('../config/orderOptions');
const {
  parseOrderFilters,
  decimalToCents,
  centsToDecimal,
} = require('../validators/adminOrderValidator');

class AdminOrderError extends Error {
  constructor(message, code = 'INVALID_ORDER_OPERATION') {
    super(message);
    this.name = 'AdminOrderError';
    this.code = code;
  }
}

const SORT_SQL = Object.freeze({
  newest: 'o.created_at DESC, o.id DESC',
  oldest: 'o.created_at ASC, o.id ASC',
  'total-desc': 'o.final_total IS NULL, o.final_total DESC, o.id DESC',
  'total-asc': 'o.final_total IS NULL, o.final_total ASC, o.id DESC',
});

function decorateOrder(order) {
  if (!order) return null;
  return {
    ...order,
    orderStatusLabel: ORDER_STATUS_LABELS[order.order_status] || order.order_status,
    shippingStatusLabel: SHIPPING_STATUS_LABELS[order.shipping_status] || order.shipping_status,
    paymentStatusLabel: PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status,
    deliveryMethodLabel: DELIVERY_METHOD_LABELS[order.delivery_method] || order.delivery_method,
    paymentMethodLabel: PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method,
    allowedNextStatuses: getAllowedNextStatuses(order),
    canQuoteShipping: canQuoteShipping(order),
    canConfirmPayment: canConfirmPayment(order),
    canCancel: canCancelOrder(order),
  };
}

async function listOrders(rawFilters) {
  const filters = parseOrderFilters(rawFilters);
  const where = [];
  const params = [];
  if (filters.search) {
    const term = `%${filters.search}%`;
    where.push('(o.order_reference LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.customer_phone LIKE ?)');
    params.push(term, term, term, term);
  }
  const columns = {
    orderStatus: 'o.order_status', paymentStatus: 'o.payment_status', shippingStatus: 'o.shipping_status',
    deliveryMethod: 'o.delivery_method', paymentMethod: 'o.payment_method',
  };
  for (const [key, column] of Object.entries(columns)) {
    if (filters[key]) { where.push(`${column} = ?`); params.push(filters[key]); }
  }
  if (filters.dateFrom) { where.push('o.created_at >= ?'); params.push(`${filters.dateFrom} 00:00:00`); }
  if (filters.dateTo) { where.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${filters.dateTo} 00:00:00`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[countRow]] = await pool.query(`SELECT COUNT(*) AS total FROM orders o ${whereSql}`, params);
  const total = Number(countRow.total);
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  filters.page = Math.min(filters.page, totalPages);
  const offset = (filters.page - 1) * filters.limit;
  const [rows] = await pool.query(
    `SELECT o.order_reference, o.customer_name, o.customer_email, o.delivery_method,
            o.shipping_status, o.payment_method, o.payment_status, o.order_status,
            o.product_subtotal, o.shipping_amount, o.final_total, o.created_at, o.updated_at
       FROM orders o ${whereSql}
      ORDER BY ${SORT_SQL[filters.sort]} LIMIT ? OFFSET ?`,
    [...params, filters.limit, offset]
  );
  return { orders: rows.map(decorateOrder), filters, total, totalPages };
}

async function getOrderByReference(reference) {
  const [rows] = await pool.query('SELECT * FROM orders WHERE order_reference = ? LIMIT 1', [reference]);
  if (!rows[0]) return null;
  const order = rows[0];
  const [items] = await pool.query(
    'SELECT product_name, product_slug, quantity, unit_price, line_total, primary_image FROM order_items WHERE order_id = ? ORDER BY id',
    [order.id]
  );
  const [events] = await pool.query(
    `SELECT e.event_type, e.from_status, e.to_status, e.metadata_json, e.note, e.created_at,
            u.name AS actor_name
       FROM order_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.order_id = ? ORDER BY e.created_at DESC, e.id DESC`,
    [order.id]
  );
  return {
    order: decorateOrder(order),
    items,
    events: events.map((event) => {
      let metadata = null;
      try { metadata = event.metadata_json ? JSON.parse(event.metadata_json) : null; } catch (_error) { metadata = null; }
      return { ...event, metadata, eventTypeLabel: EVENT_TYPE_LABELS[event.event_type] || event.event_type };
    }),
    proofSummary: await proofService.getProofSummary(order.id),
  };
}

async function insertEvent(conn, orderId, actorUserId, eventType, details = {}) {
  const metadata = details.metadata ? JSON.stringify(details.metadata).slice(0, 4000) : null;
  await conn.query(
    `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, metadata_json, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orderId, actorUserId || null, eventType, details.fromStatus || null, details.toStatus || null, metadata, details.note || null]
  );
}

async function withLockedOrder(reference, operation) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM orders WHERE order_reference = ? FOR UPDATE', [reference]);
    if (!rows[0]) throw new AdminOrderError('Pedido no encontrado.', 'ORDER_NOT_FOUND');
    const result = await operation(conn, rows[0]);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function quoteShipping(reference, shippingDecimal, actorUserId) {
  return withLockedOrder(reference, async (conn, order) => {
    if (!canQuoteShipping(order)) throw new AdminOrderError('Este pedido ya no admite cotización de envío.');
    const subtotalCents = decimalToCents(order.product_subtotal);
    const shippingCents = decimalToCents(shippingDecimal);
    const finalTotal = centsToDecimal(subtotalCents + shippingCents);
    const eventType = order.shipping_status === 'quoted' ? 'shipping_requoted' : 'shipping_quoted';
    await conn.query(
      `UPDATE orders SET shipping_status = 'quoted', shipping_amount = ?, final_total = ?, order_status = 'pending_payment'
       WHERE id = ?`,
      [shippingDecimal, finalTotal, order.id]
    );
    await insertEvent(conn, order.id, actorUserId, eventType, {
      fromStatus: order.order_status, toStatus: 'pending_payment',
      metadata: { previousShippingAmount: order.shipping_amount, shippingAmount: shippingDecimal, finalTotal },
    });
    return { finalTotal };
  });
}

async function confirmPayment(reference, paymentReference, actorUserId) {
  return withLockedOrder(reference, async (conn, order) => {
    if (!canConfirmPayment(order)) throw new AdminOrderError('El pago no puede confirmarse en el estado actual.');

    // Block manual confirmation if a proof is pending review
    const [proofRows] = await conn.query(
      "SELECT id FROM payment_proofs WHERE order_id = ? AND status = 'pending_review' LIMIT 1",
      [order.id]
    );
    if (proofRows[0]) {
      throw new AdminOrderError('Hay un comprobante pendiente de revisión. Revisa o rechaza el comprobante antes de confirmar manualmente.');
    }

    await conn.query("UPDATE orders SET payment_status = 'paid', order_status = 'payment_confirmed' WHERE id = ?", [order.id]);
    await insertEvent(conn, order.id, actorUserId, 'payment_confirmed_manually', {
      fromStatus: order.order_status, toStatus: 'payment_confirmed',
      metadata: { paymentMethod: order.payment_method, paymentReference: paymentReference || null },
    });
  });
}

async function transitionOrder(reference, nextStatus, actorUserId) {
  return withLockedOrder(reference, async (conn, order) => {
    if (!getAllowedNextStatuses(order).includes(nextStatus)) {
      throw new AdminOrderError('La transición de estado solicitada no está permitida.');
    }
    await conn.query('UPDATE orders SET order_status = ? WHERE id = ?', [nextStatus, order.id]);
    await insertEvent(conn, order.id, actorUserId, 'order_status_changed', {
      fromStatus: order.order_status, toStatus: nextStatus,
    });
  });
}

async function addInternalNote(reference, note, actorUserId) {
  return withLockedOrder(reference, async (conn, order) => {
    await insertEvent(conn, order.id, actorUserId, 'internal_note_added', { note });
  });
}

async function cancelOrder(reference, actorUserId) {
  return withLockedOrder(reference, async (conn, order) => {
    if (!canCancelOrder(order)) throw new AdminOrderError('Este pedido no puede cancelarse ni restaurar inventario.');
    const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id FOR UPDATE', [order.id]);
    for (const item of items) {
      const [products] = await conn.query('SELECT id FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      if (!products[0]) throw new AdminOrderError('No se pudo restaurar todo el inventario del pedido.');
      await conn.query('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [item.quantity, item.product_id]);
    }
    await conn.query("UPDATE orders SET order_status = 'cancelled' WHERE id = ?", [order.id]);
    await insertEvent(conn, order.id, actorUserId, 'order_cancelled', {
      fromStatus: order.order_status, toStatus: 'cancelled', metadata: { stockRestored: true },
    });
  });
}

async function updateTracking(reference, { carrier, trackingNumber, trackingUrl }, actorUserId) {
  return withLockedOrder(reference, async (conn, order) => {
    const previous = { carrier: order.carrier, tracking_number: order.tracking_number, tracking_url: order.tracking_url };
    await conn.query(
      'UPDATE orders SET carrier = ?, tracking_number = ?, tracking_url = ? WHERE id = ?',
      [carrier, trackingNumber, trackingUrl, order.id]
    );
    await insertEvent(conn, order.id, actorUserId, 'tracking_updated', {
      metadata: { previous, current: { carrier, trackingNumber, trackingUrl } },
    });
  });
}

module.exports = {
  AdminOrderError, listOrders, getOrderByReference, quoteShipping,
  confirmPayment, transitionOrder, addInternalNote, cancelOrder, updateTracking,
};
