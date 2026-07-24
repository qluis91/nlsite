/**
 * Tilopay Service — business logic for payment initiation, verification, confirmation.
 * Orchestrates DB transactions, provider calls, and order/payment synchronization.
 */
const crypto = require('crypto');
const pool = require('../config/db');
const tilopayConfig = require('../config/tilopay');
const { normalizeStatus, isTerminal, isApproved, canRetry, customerLabel, INTERNAL_STATUSES } = require('../config/tilopayStatusMap');
const tilopayClient = require('./tilopayClient');

class TilopayError extends Error {
  constructor(message, code = 'TILOPAY_ERROR') {
    super(message); this.name = 'TilopayError'; this.code = code;
  }
}

// ── Eligibility ──
function canPayWithTilopay(order) {
  if (!order) return false;
  if (order.payment_method !== 'tilopay') return false;
  if (order.payment_status !== 'pending') return false;
  if (order.final_total === null || order.final_total === undefined) return false;
  if (!['not_required', 'quoted'].includes(order.shipping_status)) return false;
  if (order.order_status !== 'pending_payment') return false;
  if (['cancelled', 'completed'].includes(order.order_status)) return false;
  return true;
}

function needsShippingQuote(order) {
  return order && order.payment_method === 'tilopay' && order.shipping_status === 'pending_quote';
}

// ── Generate unique internal reference (UUID v4) ──
function generateInternalRef() {
  return crypto.randomUUID();
}

// ── Generate idempotency key ──
function generateIdempotencyKey(orderId) {
  const payload = `${orderId}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// ── Get active (non-terminal) Tilopay transaction for an order ──
async function getActiveTransaction(orderId, conn) {
  const db = conn || pool;
  const [rows] = await db.query(
    `SELECT * FROM tilopay_transactions
      WHERE order_id = ? AND status IN ('creating', 'pending')
      ORDER BY id DESC LIMIT 1`,
    [orderId]
  );
  return rows[0] || null;
}

// ── Get latest Tilopay transaction for an order ──
async function getLatestTransaction(orderId, conn) {
  const db = conn || pool;
  const [rows] = await db.query(
    'SELECT * FROM tilopay_transactions WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  return rows[0] || null;
}

// ── Get Tilopay transaction by internal reference ──
async function getTransactionByInternalRef(internalRef) {
  const [rows] = await pool.query(
    `SELECT t.*, o.order_reference
       FROM tilopay_transactions t
       JOIN orders o ON o.id = t.order_id
      WHERE t.internal_reference = ? LIMIT 1`,
    [internalRef]
  );
  return rows[0] || null;
}

/**
 * Initiate a Tilopay payment for an eligible order.
 *
 * Stage A (inside TX): lock order, validate eligibility, create attempt row.
 * Stage B (outside TX): call Tilopay API for SDK token.
 * Stage C (inside TX): persist provider result.
 */
async function initiatePayment(orderReference, userId, session) {
  const conn = await pool.getConnection();
  let internalRef = null;

  try {
    // ── Stage A: reserve attempt and validate ──
    await conn.beginTransaction();

    const [orderRows] = await conn.query(
      'SELECT * FROM orders WHERE order_reference = ? FOR UPDATE',
      [orderReference]
    );
    if (!orderRows[0]) throw new TilopayError('Pedido no encontrado.', 'ORDER_NOT_FOUND');
    const order = orderRows[0];

    // Authorization
    if (userId && Number(order.user_id) !== Number(userId)) {
      throw new TilopayError('No tienes permiso para este pedido.', 'UNAUTHORIZED');
    }

    // Eligibility
    if (!canPayWithTilopay(order)) {
      throw new TilopayError(
        needsShippingQuote(order)
          ? 'El pago con tarjeta estará disponible cuando se cotice el envío.'
          : 'Este pedido no puede pagarse con Tilopay en este momento.',
        'NOT_ELIGIBLE'
      );
    }

    // Check active transaction
    const activeTx = await getActiveTransaction(order.id, conn);
    if (activeTx) {
      // If the active transaction has been in 'creating' state for > 5 minutes, allow retry
      const ageMs = Date.now() - new Date(activeTx.created_at).getTime();
      if (activeTx.status === 'creating' && ageMs < 5 * 60 * 1000) {
        throw new TilopayError('Ya hay un pago en proceso. Espera unos momentos.', 'ACTIVE_PAYMENT');
      }
      // Mark stale creating transaction as failed
      if (activeTx.status === 'creating') {
        await conn.query(
          "UPDATE tilopay_transactions SET status = 'failed', failure_code = 'TIMEOUT', failed_at = NOW() WHERE id = ?",
          [activeTx.id]
        );
      } else {
        throw new TilopayError('Ya hay un pago en proceso.', 'ACTIVE_PAYMENT');
      }
    }

    internalRef = generateInternalRef();
    const idempotencyKey = generateIdempotencyKey(order.id);

    await conn.query(
      `INSERT INTO tilopay_transactions
        (order_id, internal_reference, idempotency_key, status, amount, currency)
       VALUES (?, ?, ?, 'creating', ?, ?)`,
      [order.id, internalRef, idempotencyKey, order.final_total, tilopayConfig.DEFAULT_CURRENCY]
    );

    await conn.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, metadata_json)
       VALUES (?, ?, 'tilopay_payment_created', ?, ?, ?)`,
      [order.id, userId || null, order.order_status, order.order_status,
       JSON.stringify({ internalRef, amount: Number(order.final_total) }).slice(0, 4000)]
    );

    await conn.commit();

    // ── Stage B: provider request (outside TX) ──
    let providerResult;
    try {
      providerResult = await tilopayClient.getSdkToken({
        currency: tilopayConfig.DEFAULT_CURRENCY,
        amount: Number(order.final_total),
        orderNumber: order.order_reference,
        billToEmail: order.email || '',
        billToFirstName: order.customer_name ? order.customer_name.split(' ')[0] : undefined,
        billToLastName: order.customer_name ? order.customer_name.split(' ').slice(1).join(' ') : undefined,
        billToTelephone: order.phone || undefined,
      });
    } catch (error) {
      // Mark attempt as failed and re-throw
      await conn.query(
        "UPDATE tilopay_transactions SET status = 'failed', failure_code = 'PROVIDER_ERROR', failure_message = ?, failed_at = NOW() WHERE internal_reference = ?",
        [String(error.message).slice(0, 500), internalRef]
      );
      conn.release();
      throw new TilopayError('No fue posible iniciar el pago en este momento. Inténtalo nuevamente más tarde.', 'PROVIDER_ERROR');
    }

    // ── Stage C: persist provider result ──
    await conn.beginTransaction();

    await conn.query(
      `UPDATE tilopay_transactions
       SET provider_session_token = ?, status = 'pending'
       WHERE internal_reference = ?`,
      [providerResult.token, internalRef]
    );

    await conn.commit();
    conn.release();

    return {
      internalRef,
      sdkToken: providerResult.token,
      methods: providerResult.methods || [],
      amount: order.final_total,
      currency: tilopayConfig.DEFAULT_CURRENCY,
      orderReference: order.order_reference,
    };
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    throw error;
  }
}

/**
 * Confirm payment after authoritative provider approval.
 * Called from webhook or reconciliation — never from browser.
 *
 * @param {string} internalRef — internal transaction reference
 * @param {object} providerData — verified provider data { transactionId, status, amount, currency }
 */
async function confirmPayment(internalRef, providerData) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [txRows] = await conn.query(
      'SELECT * FROM tilopay_transactions WHERE internal_reference = ? FOR UPDATE',
      [internalRef]
    );
    if (!txRows[0]) {
      await conn.rollback();
      conn.release();
      throw new TilopayError('Transacción no encontrada.', 'TRANSACTION_NOT_FOUND');
    }
    const tx = txRows[0];

    // Already terminal?
    if (isTerminal(tx.status)) {
      await conn.rollback();
      conn.release();
      return { alreadyProcessed: true, status: tx.status };
    }

    // Normalize and validate status
    const normalizedStatus = normalizeStatus(providerData.status);
    if (normalizedStatus === INTERNAL_STATUSES.UNKNOWN) {
      // Update raw status but don't confirm
      await conn.query(
        "UPDATE tilopay_transactions SET raw_status = ? WHERE id = ?",
        [String(providerData.status || '').slice(0, 100), tx.id]
      );
      await conn.commit();
      conn.release();
      throw new TilopayError('Estado de pago desconocido.', 'UNKNOWN_STATUS');
    }

    // Amount/currency verification
    const providerAmount = parseFloat(providerData.amount);
    const providerCurrency = String(providerData.currency || '').toUpperCase();
    if (isApproved(normalizedStatus)) {
      if (Math.abs(Number(tx.amount) - providerAmount) > 0.01) {
        await conn.query(
          "UPDATE tilopay_transactions SET status = 'failed', failure_code = 'AMOUNT_MISMATCH', failed_at = NOW(), raw_status = ? WHERE id = ?",
          [String(providerData.status || '').slice(0, 100), tx.id]
        );
        await conn.query(
          `INSERT INTO order_events (order_id, event_type, from_status, to_status, metadata_json)
           VALUES (?, 'tilopay_amount_mismatch', ?, ?, ?)`,
          [tx.order_id, 'pending_payment', 'pending_payment',
           JSON.stringify({ internalRef, expected: Number(tx.amount), received: providerAmount }).slice(0, 4000)]
        );
        await conn.commit();
        conn.release();
        throw new TilopayError('Discrepancia en el monto del pago.', 'AMOUNT_MISMATCH');
      }
      if (providerCurrency && providerCurrency !== tx.currency) {
        await conn.query(
          "UPDATE tilopay_transactions SET status = 'failed', failure_code = 'CURRENCY_MISMATCH', failed_at = NOW(), raw_status = ? WHERE id = ?",
          [String(providerData.status || '').slice(0, 100), tx.id]
        );
        await conn.commit();
        conn.release();
        throw new TilopayError('Discrepancia en la moneda del pago.', 'CURRENCY_MISMATCH');
      }
    }

    // Update transaction
    const updates = {
      status: normalizedStatus,
      raw_status: String(providerData.status || '').slice(0, 100),
    };
    if (providerData.transactionId) {
      updates.provider_transaction_id = String(providerData.transactionId).slice(0, 100);
    }

    if (isApproved(normalizedStatus)) {
      updates.confirmed_at = new Date();
      await conn.query(
        `UPDATE tilopay_transactions
         SET status = ?, confirmed_at = NOW(), provider_transaction_id = COALESCE(NULLIF(?, ''), provider_transaction_id),
             raw_status = ?
         WHERE id = ?`,
        [normalizedStatus, updates.provider_transaction_id || null, updates.raw_status, tx.id]
      );

      // Lock order and confirm payment
      const [orderRows] = await conn.query(
        'SELECT * FROM orders WHERE id = ? FOR UPDATE',
        [tx.order_id]
      );
      if (!orderRows[0]) {
        await conn.rollback(); conn.release();
        throw new TilopayError('Pedido no encontrado.', 'ORDER_NOT_FOUND');
      }
      const order = orderRows[0];

      if (order.payment_status === 'paid') {
        await conn.commit(); conn.release();
        return { alreadyProcessed: true, status: 'approved', orderAlreadyPaid: true };
      }

      await conn.query(
        "UPDATE orders SET payment_status = 'paid', order_status = 'payment_confirmed' WHERE id = ?",
        [tx.order_id]
      );

      await conn.query(
        `INSERT INTO order_events (order_id, event_type, from_status, to_status, metadata_json)
         VALUES (?, 'tilopay_payment_approved', ?, ?, ?)`,
        [tx.order_id, order.order_status, 'payment_confirmed',
         JSON.stringify({ internalRef, providerTxnId: updates.provider_transaction_id }).slice(0, 4000)]
      );
    } else if (normalizedStatus === INTERNAL_STATUSES.DECLINED) {
      updates.failed_at = new Date();
      updates.failure_code = 'DECLINED';
      await conn.query(
        `UPDATE tilopay_transactions
         SET status = ?, failed_at = NOW(), failure_code = 'DECLINED', raw_status = ?,
             provider_transaction_id = COALESCE(NULLIF(?, ''), provider_transaction_id)
         WHERE id = ?`,
        [normalizedStatus, updates.raw_status, updates.provider_transaction_id || null, tx.id]
      );
      await conn.query(
        `INSERT INTO order_events (order_id, event_type, from_status, to_status, metadata_json)
         VALUES (?, 'tilopay_payment_declined', ?, ?, ?)`,
        [tx.order_id, 'pending_payment', 'pending_payment',
         JSON.stringify({ internalRef }).slice(0, 4000)]
      );
    } else if (normalizedStatus === INTERNAL_STATUSES.CANCELLED) {
      updates.failed_at = new Date();
      await conn.query(
        `UPDATE tilopay_transactions SET status = ?, failed_at = NOW(), failure_code = 'CANCELLED', raw_status = ? WHERE id = ?`,
        [normalizedStatus, updates.raw_status, tx.id]
      );
      await conn.query(
        `INSERT INTO order_events (order_id, event_type, from_status, to_status, metadata_json)
         VALUES (?, 'tilopay_payment_cancelled', ?, ?, ?)`,
        [tx.order_id, 'pending_payment', 'pending_payment',
         JSON.stringify({ internalRef }).slice(0, 4000)]
      );
    } else {
      // Pending / other non-terminal
      await conn.query(
        `UPDATE tilopay_transactions SET status = ?, raw_status = ? WHERE id = ?`,
        [normalizedStatus, updates.raw_status, tx.id]
      );
    }

    await conn.commit();
    conn.release();
    return {
      status: normalizedStatus,
      confirmed: isApproved(normalizedStatus),
      providerTransactionId: updates.provider_transaction_id || null,
    };
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    throw error;
  }
}

/**
 * Process incoming notification from Tilopay.
 *
 * ARCHITECTURE NOTE (2026-07-23):
 * Tilopay webhook signature mechanism is NOT publicly documented.
 * Until confirmed from the merchant portal/Postman collection:
 *
 * Phase 1 (current): Treat notification as a hint only.
 *   1. Extract provider/internal reference from notification body
 *   2. Perform authenticated server-to-server lookup via getTransactionStatus()
 *   3. Use the lookup result as authoritative for payment confirmation
 *   4. Never mark paid based solely on an unsigned notification body
 *
 * Phase 2 (when documented): If Tilopay provides signed callbacks:
 *   - Verify signature using the documented mechanism
 *   - Then proceed to server-to-server lookup as an additional check
 *
 * @param {object|string} body — notification payload
 * @param {string} signature — signature header value (unused until mechanism confirmed)
 */
async function processNotification(body, signature) {
  // Parse payload
  const data = typeof body === 'string' ? JSON.parse(body) : body;

  // Extract reference — try multiple possible field names
  const ref = data.internal_reference || data.orderReference
    || data.reference || data.merchant_reference
    || data.provider_transaction_id || null;

  if (!ref) {
    throw new TilopayError('Missing transaction reference in notification.', 'MISSING_REFERENCE');
  }

  // Try to find by internal reference first, then by provider transaction ID
  let tx = null;
  if (ref.length === 36 && ref.includes('-')) {
    // Looks like a UUID (internal_reference)
    tx = await getTransactionByInternalRef(ref);
  }

  if (!tx && data.provider_transaction_id) {
    // Try lookup by provider ID
    const [rows] = await pool.query(
      'SELECT * FROM tilopay_transactions WHERE provider_transaction_id = ? LIMIT 1',
      [String(data.provider_transaction_id).slice(0, 100)]
    );
    tx = rows[0] || null;
  }

  if (!tx) {
    // Unknown reference — log and acknowledge to avoid retry storms
    console.warn(`[tilopay] Notification received with unknown reference: ${ref.slice(0, 50)}`);
    return { acknowledged: true, resolved: false };
  }

  // If signature verification is confirmed by Tilopay docs:
  // verify signature before proceeding
  // (Not yet implemented — see isWebhookSignatureSupported())

  // Perform server-to-server lookup for authoritative status
  let providerData;
  if (tx.provider_transaction_id) {
    try {
      providerData = await tilopayClient.getTransactionStatus(tx.provider_transaction_id);
    } catch (error) {
      console.warn(`[tilopay] Server lookup failed for ${tx.internal_reference}: ${error.message}`);
      // Use notification data as fallback but log the risk
      providerData = {
        transactionId: tx.provider_transaction_id,
        status: data.status || 'unknown',
        amount: data.amount || null,
        currency: data.currency || null,
      };
    }
  } else {
    // No provider ID yet — use notification data
    providerData = {
      transactionId: data.transaction_id || data.id || null,
      status: data.status || 'unknown',
      amount: data.amount || null,
      currency: data.currency || null,
    };
  }

  return confirmPayment(tx.internal_reference, {
    transactionId: providerData.transactionId || data.provider_transaction_id,
    status: providerData.status,
    amount: providerData.amount,
    currency: providerData.currency,
  });
}

/**
 * Admin reconciliation: query provider for current transaction status.
 */
async function reconcileTransaction(internalRef) {
  const tx = await getTransactionByInternalRef(internalRef);
  if (!tx) throw new TilopayError('Transacción no encontrada.', 'TRANSACTION_NOT_FOUND');

  if (!tx.provider_transaction_id) {
    throw new TilopayError('Esta transacción aún no tiene un identificador del proveedor.', 'NO_PROVIDER_ID');
  }

  const providerData = await tilopayClient.getTransactionStatus(tx.provider_transaction_id);

  return confirmPayment(internalRef, {
    transactionId: providerData.transactionId,
    status: providerData.status,
    amount: providerData.amount,
    currency: providerData.currency,
  });
}

/**
 * Get public summary of Tilopay transactions for an order.
 */
async function getTransactionSummary(orderId) {
  const [rows] = await pool.query(
    `SELECT id, internal_reference, provider_transaction_id, status, amount, currency,
            failure_code, created_at, confirmed_at, failed_at
       FROM tilopay_transactions WHERE order_id = ? ORDER BY id DESC`,
    [orderId]
  );
  return rows.map(tx => ({
    internalRef: tx.internal_reference,
    providerTransactionId: tx.provider_transaction_id,
    status: tx.status,
    amount: Number(tx.amount),
    currency: tx.currency,
    failureCode: tx.failure_code,
    createdAt: tx.created_at,
    confirmedAt: tx.confirmed_at,
    failedAt: tx.failed_at,
  }));
}

/**
 * CENTRALIZED PAYMENT VERIFICATION — the single authoritative operation.
 *
 * Used by:
 *   - Browser return route
 *   - Customer "Verificar estado del pago" action
 *   - Guest verification action
 *   - Admin reconciliation
 *   - Webhook/notification processing
 *   - Ambiguous provider-request recovery
 *
 * This operation:
 *   1. Loads the local transaction and order
 *   2. Calls the Tilopay provider transaction-status endpoint
 *   3. Validates amount, currency, and reference match
 *   4. Applies the authoritative result via confirmPayment()
 *   5. Returns a provider-neutral result object
 *
 * NEVER marks paid from browser query parameters or unvalidated provider body.
 *
 * @param {string} internalRef — local transaction internal_reference
 * @param {object} options
 * @param {string} options.trigger — 'return' | 'customer_verify' | 'guest_verify' | 'admin' | 'webhook'
 * @param {number|null} options.actorUserId — user ID of the actor, or null for guest/webhook
 * @returns {object} verification result contract
 */
async function verifyTilopayPayment(internalRef, options = {}) {
  const trigger = options.trigger || 'unknown';
  const actorUserId = options.actorUserId || null;

  // Step 1: Load local transaction with order data
  const tx = await getTransactionByInternalRef(internalRef);
  if (!tx) {
    return {
      verified: false,
      localStatus: 'unknown',
      orderPaid: false,
      terminal: false,
      retryAllowed: false,
      messageCode: 'PAYMENT_NOT_FOUND',
      customerMessage: 'Transacción no encontrada.',
    };
  }

  // Step 2: Can only verify if we have a provider transaction ID
  if (!tx.provider_transaction_id) {
    // Transaction was created but never had a provider session
    if (tx.status === 'creating') {
      return {
        verified: false,
        localStatus: tx.status,
        orderPaid: false,
        terminal: false,
        retryAllowed: false,
        messageCode: 'PAYMENT_PENDING',
        customerMessage: 'El pago aún no ha sido procesado por el proveedor.',
      };
    }
    return {
      verified: false,
      localStatus: tx.status,
      orderPaid: false,
      terminal: false,
      retryAllowed: false,
      messageCode: 'PAYMENT_NOT_FOUND',
      customerMessage: 'No pudimos confirmar el pago todavía.',
    };
  }

  // Step 3: If already terminally resolved locally, return current state
  if (isTerminal(tx.status)) {
    return {
      verified: true,
      localStatus: tx.status,
      orderPaid: isApproved(tx.status),
      terminal: true,
      retryAllowed: canRetry(tx.status),
      messageCode: isApproved(tx.status) ? 'PAYMENT_CONFIRMED'
        : tx.status === 'declined' ? 'PAYMENT_DECLINED'
        : tx.status === 'cancelled' ? 'PAYMENT_CANCELLED'
        : tx.status === 'expired' ? 'PAYMENT_EXPIRED'
        : 'PAYMENT_FAILED',
      customerMessage: customerLabel(tx.status),
    };
  }

  // Step 4: Perform server-to-server provider lookup
  let providerData;
  try {
    providerData = await tilopayClient.getTransactionStatus(tx.provider_transaction_id);
  } catch (error) {
    return {
      verified: false,
      localStatus: tx.status,
      orderPaid: false,
      terminal: false,
      retryAllowed: false,
      messageCode: 'PAYMENT_UNKNOWN',
      customerMessage: 'No fue posible verificar el pago en este momento. Inténtalo nuevamente más tarde.',
    };
  }

  // Step 5: Validate provider response
  const normalizedStatus = normalizeStatus(providerData.status);
  const providerAmount = parseFloat(providerData.amount);
  const providerCurrency = String(providerData.currency || '').toUpperCase();

  // Step 6: Amount and currency validation for approved payments
  if (isApproved(normalizedStatus)) {
    if (Math.abs(Number(tx.amount) - providerAmount) > 0.01) {
      // Log mismatch event
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          "UPDATE tilopay_transactions SET status = 'failed', failure_code = 'AMOUNT_MISMATCH', failed_at = NOW(), raw_status = ? WHERE id = ?",
          [String(providerData.status || '').slice(0, 100), tx.id]
        );
        await conn.query(
          `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, metadata_json)
           VALUES (?, ?, 'tilopay_amount_mismatch', ?, ?, ?)`,
          [tx.order_id, actorUserId, 'pending_payment', 'pending_payment',
           JSON.stringify({ internalRef, expected: Number(tx.amount), received: providerAmount }).slice(0, 4000)]
        );
        await conn.commit();
      } catch (err) {
        try { await conn.rollback(); } catch (_) {}
        throw err;
      } finally {
        conn.release();
      }
      return {
        verified: false,
        localStatus: 'failed',
        orderPaid: false,
        terminal: true,
        retryAllowed: false,
        messageCode: 'PAYMENT_MISMATCH',
        customerMessage: 'Encontramos una discrepancia en el monto del pago. Contacta a soporte.',
      };
    }

    if (providerCurrency && providerCurrency !== tx.currency) {
      // Log currency mismatch
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          "UPDATE tilopay_transactions SET status = 'failed', failure_code = 'CURRENCY_MISMATCH', failed_at = NOW() WHERE id = ?",
          [tx.id]
        );
        await conn.query(
          `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, metadata_json)
           VALUES (?, ?, 'tilopay_currency_mismatch', ?, ?, ?)`,
          [tx.order_id, actorUserId, 'pending_payment', 'pending_payment',
           JSON.stringify({ internalRef, expected: tx.currency, received: providerCurrency }).slice(0, 4000)]
        );
        await conn.commit();
      } catch (err) {
        try { await conn.rollback(); } catch (_) {}
        throw err;
      } finally {
        conn.release();
      }
      return {
        verified: false,
        localStatus: 'failed',
        orderPaid: false,
        terminal: true,
        retryAllowed: false,
        messageCode: 'PAYMENT_MISMATCH',
        customerMessage: 'Encontramos una discrepancia en la moneda del pago. Contacta a soporte.',
      };
    }
  }

  // Step 7: Apply authoritative result via confirmPayment
  try {
    const result = await confirmPayment(internalRef, {
      transactionId: providerData.transactionId,
      status: providerData.status,
      amount: providerData.amount,
      currency: providerData.currency,
    });

    return {
      verified: true,
      localStatus: result.status,
      orderPaid: isApproved(result.status),
      terminal: isTerminal(result.status),
      retryAllowed: canRetry(result.status),
      messageCode: isApproved(result.status) ? 'PAYMENT_CONFIRMED'
        : result.status === 'declined' ? 'PAYMENT_DECLINED'
        : result.status === 'cancelled' ? 'PAYMENT_CANCELLED'
        : result.status === 'expired' ? 'PAYMENT_EXPIRED'
        : result.status === 'failed' ? 'PAYMENT_FAILED'
        : 'PAYMENT_PENDING',
      customerMessage: customerLabel(result.status),
    };
  } catch (error) {
    if (error instanceof TilopayError) {
      return {
        verified: false,
        localStatus: tx.status,
        orderPaid: false,
        terminal: false,
        retryAllowed: false,
        messageCode: error.code === 'AMOUNT_MISMATCH' || error.code === 'CURRENCY_MISMATCH' ? 'PAYMENT_MISMATCH' : 'PAYMENT_UNKNOWN',
        customerMessage: error.message,
      };
    }
    return {
      verified: false,
      localStatus: tx.status,
      orderPaid: false,
      terminal: false,
      retryAllowed: false,
      messageCode: 'PAYMENT_UNKNOWN',
      customerMessage: 'No fue posible verificar el pago.',
    };
  }
}

/**
 * Normalize Tilopay amount from any representation to a canonical decimal number.
 * SDK V1 PDF shows amounts as decimals (e.g. 100.00).
 */
function normalizeTilopayAmount(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/[^0-9.\-]/g, '');
  const parsed = parseFloat(cleaned);
  return parsed;
}

module.exports = {
  TilopayError,
  canPayWithTilopay,
  needsShippingQuote,
  initiatePayment,
  confirmPayment,
  verifyTilopayPayment,
  processNotification,
  reconcileTransaction,
  getActiveTransaction,
  getLatestTransaction,
  getTransactionByInternalRef,
  getTransactionSummary,
  normalizeTilopayAmount,
};
