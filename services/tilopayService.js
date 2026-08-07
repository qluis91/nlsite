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

function buildProviderOrderNumber(orderId, internalRef) {
  return `NL-${Number(orderId)}-${String(internalRef || '').slice(0, 8)}`.slice(0, 40);
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
    `SELECT t.*, o.order_reference, o.payment_status, o.order_status
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
 *   2. Perform authenticated server-to-server lookup via consultTransaction()
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

  // Notification data is only a hint. The official consult is authoritative.
  return verifyAndConfirmPayment(tx.internal_reference, {
    trigger: 'webhook',
    actorUserId: null,
  });
}

/**
 * Admin reconciliation: query provider for current transaction status.
 */
async function reconcileTransaction(internalRef) {
  const tx = await getTransactionByInternalRef(internalRef);
  if (!tx) throw new TilopayError('Transacción no encontrada.', 'TRANSACTION_NOT_FOUND');

  return verifyAndConfirmPayment(internalRef, {
    trigger: 'admin',
    actorUserId: null,
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

  // Step 2: If already terminally resolved locally, return current state
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

  // Step 3: Perform the official server-to-server consult using the same
  // deterministic order number sent during hosted-payment initiation.
  let providerData;
  try {
    const expectedOrderNumber = buildProviderOrderNumber(tx.order_id, internalRef);
    const consultResult = await tilopayClient.consultTransaction(expectedOrderNumber, {
      amount: String(Number(tx.amount).toFixed(2)),
      currency: tx.currency,
    });
    providerData = consultResult && consultResult.transaction;
    if (!providerData) {
      await _recordMismatch(internalRef, tx.order_id, 'missing_provider_transaction', {
        expectedOrderNumber,
      }, { actorUserId, markFailed: false });
      return {
        verified: false,
        localStatus: tx.status,
        orderPaid: false,
        terminal: false,
        retryAllowed: false,
        messageCode: 'PAYMENT_PENDING',
        customerMessage: 'El pago aún no aparece en el proveedor.',
      };
    }
    // Tilopay prepends a merchant prefix (e.g. PFC027223-) to the orderNumber.
    // Accept if provider orderNumber ends with the expected orderNumber.
    const provOrderNum = String(providerData.orderNumber || '');
    if (provOrderNum !== expectedOrderNumber && !provOrderNum.endsWith(expectedOrderNumber)) {
      await _recordMismatch(internalRef, tx.order_id, 'order_number_mismatch', {
        expectedOrderNumber,
        receivedOrderNumber: String(providerData.orderNumber || '').slice(0, 40),
      }, { actorUserId, markFailed: true });
      return {
        verified: false,
        localStatus: 'failed',
        orderPaid: false,
        terminal: true,
        retryAllowed: false,
        messageCode: 'PAYMENT_MISMATCH',
        customerMessage: 'La referencia del pago no coincide con la orden.',
      };
    }
  } catch (error) {
    await _recordMismatch(internalRef, tx.order_id, 'malformed_provider_response', {
      errorCode: String(error.code || error.name || 'CONSULT_ERROR').slice(0, 50),
    }, { actorUserId, markFailed: false });
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

  // Step 4: Validate provider response
  const normalizedStatus = normalizeStatus(providerData.status);
  const providerAmount = parseFloat(providerData.amount);
  const providerCurrency = String(providerData.currency || '').toUpperCase();

  // Step 5: Amount and currency validation for approved payments
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

  if (normalizedStatus === INTERNAL_STATUSES.UNKNOWN) {
    await _recordMismatch(internalRef, tx.order_id, 'unsupported_provider_status', {
      providerCode: String(providerData.code || '').slice(0, 20),
    }, { actorUserId, markFailed: false });
    return {
      verified: false,
      localStatus: tx.status,
      orderPaid: false,
      terminal: false,
      retryAllowed: false,
      messageCode: 'PAYMENT_UNKNOWN',
      customerMessage: 'El proveedor devolvió un estado no reconocido.',
    };
  }

  // Step 6: Apply authoritative result via confirmPayment
  try {
    const result = await confirmPayment(internalRef, {
      transactionId: providerData.id_tilopay || providerData.transactionId,
      status: providerData.status,
      amount: providerData.amount,
      currency: providerData.currency,
      response: providerData.response,
      orderNumber: providerData.orderNumber,
      trigger,
      actorUserId,
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


/**
 * Capture provider data from SDK redirect query parameters.
 * The Tilopay SDK may append transaction_id, status, amount, currency
 * to the redirect URL after a completed payment.
 *
 * This extracts known fields and updates the local transaction record.
 * Safe: never trusts browser-supplied status to mark payment as paid.
 *
 * @param {string} internalRef
 * @param {object} queryParams — req.query or similar key-value map
 * @returns {object|null} — the updated transaction or null if not found
 */
async function captureProviderRedirectData(internalRef, queryParams) {
  if (!internalRef || !queryParams) return null;

  const providerIdCandidates = [
    'transaction_id', 'transactionId', 'tid', 'txn_id',
    'provider_transaction_id', 'id', 'reference',
  ];
  const statusCandidates = ['status', 'payment_status', 'result'];

  let providerTransactionId = null;
  for (const key of providerIdCandidates) {
    const v = String(queryParams[key] || '').trim();
    if (v && v.length <= 100 && v !== internalRef) {
      providerTransactionId = v;
      break;
    }
  }

  let rawStatus = null;
  for (const key of statusCandidates) {
    const v = String(queryParams[key] || '').trim();
    if (v && v.length <= 50) {
      rawStatus = v;
      break;
    }
  }

  // Only persist if we found useful provider data
  if (!providerTransactionId && !rawStatus) return null;

  const tx = await getTransactionByInternalRef(internalRef);
  if (!tx) return null;

  // Update if we have a provider_transaction_id and it's not already set
  if (providerTransactionId && !tx.provider_transaction_id) {
    await pool.query(
      `UPDATE tilopay_transactions
       SET provider_transaction_id = ?, raw_status = COALESCE(NULLIF(?, ''), raw_status),
           provider_created_at = COALESCE(provider_created_at, NOW())
       WHERE id = ? AND provider_transaction_id IS NULL`,
      [providerTransactionId, rawStatus || '', tx.id]
    );
  } else if (rawStatus && !tx.raw_status) {
    await pool.query(
      'UPDATE tilopay_transactions SET raw_status = ? WHERE id = ?',
      [rawStatus, tx.id]
    );
  }

  // Return fresh data
  return getTransactionByInternalRef(internalRef);
}

/**
 * Update the provider_transaction_id on an existing transaction.
 * Used when the webhook or redirect provides the provider ID after creation.
 * Only updates if the record exists and provider_transaction_id is NULL.
 *
 * @param {string} internalRef
 * @param {string} providerTransactionId
 * @returns {object|null}
 */
async function updateProviderTransactionId(internalRef, providerTransactionId) {
  if (!internalRef || !providerTransactionId) return null;
  const [result] = await pool.query(
    `UPDATE tilopay_transactions
     SET provider_transaction_id = ?, provider_created_at = COALESCE(provider_created_at, NOW())
     WHERE internal_reference = ? AND provider_transaction_id IS NULL`,
    [String(providerTransactionId).slice(0, 100), internalRef]
  );
  return result.affectedRows > 0 ? getTransactionByInternalRef(internalRef) : null;
}


// ── Hosted-payment initiation (Postman official flow) ──

/**
 * Initiate a Tilopay hosted payment session for an order.
 *
 * Flow:
 *   1. Lock order, validate eligibility
 *   2. Create local payment attempt (status: creating)
 *   3. Call processPayment API
 *   4. Persist provider metadata, set status: pending
 *   5. Return the hosted payment URL for redirect
 *
 * NEVER marks the order as paid.
 */
async function initiateHostedPayment(orderId, customerId, options = {}) {
  const pool = require('../config/db');
  const { randomUUID } = require('crypto');
  const tilopayClient = require('./tilopayClient');
  const tilopayConfig = require('../config/tilopay');
  const orderOptions = require('../config/orderOptions');

  // Stage A: Lock and validate
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query(
      'SELECT * FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (orders.length === 0) {
      throw new TilopayError('Pedido no encontrado.', 'ORDER_NOT_FOUND');
    }
    const order = orders[0];

    // Verify customer ownership
    const ownedByCustomer = customerId === null || customerId === undefined
      ? order.user_id === null
      : Number(order.user_id) === Number(customerId);
    if (!ownedByCustomer) {
      throw new TilopayError('No tienes acceso a este pedido.', 'UNAUTHORIZED');
    }

    // Check not already paid
    if (order.payment_status === 'paid') {
      throw new TilopayError('Esta orden ya fue pagada.', 'ALREADY_PAID');
    }

    if (!canPayWithTilopay(order)) {
      throw new TilopayError(
        needsShippingQuote(order)
          ? 'El pago con tarjeta estará disponible cuando se cotice el envío.'
          : 'Este pedido no puede pagarse con Tilopay en este momento.',
        'NOT_ELIGIBLE'
      );
    }

    // Check for existing active attempt
    const [existing] = await conn.query(
      `SELECT * FROM tilopay_transactions
       WHERE order_id = ? AND status IN ('creating', 'pending')
       ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    if (existing.length > 0) {
      const tx = existing[0];
      if (tx.status === 'pending' && tx.checkout_url) {
        // Reuse the existing pending attempt
        await conn.commit();
        return { redirect: true, url: tx.checkout_url, internalRef: tx.internal_reference };
      }
      if (tx.status === 'creating') {
        // Stale creating — check age
        const age = Date.now() - new Date(tx.created_at).getTime();
        // STALE THRESHOLD: only attempts older than 60s are considered stale.
      // Younger attempts remain active (customer may still be on hosted payment page).
      if (age < 60000) {
          await conn.commit();
          throw new Error('Ya hay un pago en proceso. Espera un momento e inténtalo de nuevo.');
        }
        // Recover stale
        await conn.query(
          'UPDATE tilopay_transactions SET status = ? WHERE id = ?',
          ['failed', tx.id]
        );
      }
    }

    // Create new attempt
    const internalRef = randomUUID();
    const idempotencyKey = generateIdempotencyKey(orderId);
    const amount = String(Number(order.final_total || order.total || 0).toFixed(2));
    const currency = order.currency || 'CRC';
    await conn.query(
      `INSERT INTO tilopay_transactions
       (internal_reference, order_id, idempotency_key, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'creating', NOW())`,
      [internalRef, orderId, idempotencyKey, amount, currency]);

    await conn.commit();
    conn.release();

    // Stage B: Call Tilopay (outside transaction)
    const publicUrl = tilopayConfig.PUBLIC_BASE_URL || 'http://localhost:3000';
    const redirect = `${publicUrl}/pagos/tilopay/retorno?ref=${encodeURIComponent(internalRef)}`;
    const returnData = Buffer.from(internalRef).toString('base64');
    const orderNumber = buildProviderOrderNumber(orderId, internalRef);

    // Map customer data from order snapshots
    const billToFirstName = options.firstName || order.billing_name || '';
    const billToLastName = options.lastName || '';
    const billToEmail = options.email || order.customer_email || '';
    const billToTelephone = options.phone || order.billing_phone || '';
    const billToAddress = options.address || order.billing_address || '';
    const billToCity = options.city || order.billing_city || '';
    const billToState = options.state || order.billing_state || '';
    const billToZipPostCode = options.zip || order.billing_zip || '';

    const result = await tilopayClient.processPayment({
      redirect,
      amount,
      currency,
      orderNumber,
      capture: '1',
      billToFirstName,
      billToLastName,
      billToAddress: billToAddress || 'San Jose',
      billToAddress2: '',
      billToCity: billToCity || 'San Jose',
      billToState: billToState || 'SJ',
      billToZipPostCode: billToZipPostCode || '10101',
      billToCountry: 'CR',
      billToTelephone: billToTelephone || '',
      billToEmail: billToEmail || '',
      shipToFirstName: billToFirstName,
      shipToLastName: billToLastName,
      shipToAddress: billToAddress || 'San Jose',
      shipToAddress2: '',
      shipToCity: billToCity || 'San Jose',
      shipToState: billToState || 'SJ',
      shipToZipPostCode: billToZipPostCode || '10101',
      shipToCountry: 'CR',
      shipToTelephone: billToTelephone || '',
      subscription: '0',
      returnData,
    });

    // Stage C: Persist result
    const conn2 = await pool.getConnection();
    try {
      await conn2.beginTransaction();

      await conn2.query(
        `UPDATE tilopay_transactions
         SET status = 'pending', checkout_url = ?, provider_created_at = NOW()
         WHERE internal_reference = ? AND status = 'creating'`,
        [result.url, internalRef]
      );

      // Insert order event
      await conn2.query(
        `INSERT INTO order_events (order_id, event_type, metadata_json, created_at)
         VALUES (?, ?, ?, NOW())`,
        [orderId, orderOptions.EVENT_TYPES?.tilopay_payment_created || 'tilopay_payment_created',
         JSON.stringify({ internal_ref: internalRef, provider_url: result.url })]
      );

      await conn2.commit();
      conn2.release();

      return { redirect: true, url: result.url, internalRef };
    } catch (e) {
      await conn2.rollback();
      conn2.release();
      throw e;
    }
  } catch (e) {
    await conn.rollback();
    conn.release();
    throw e;
  }
}



// ── Phase 3: Server-to-server payment verification ──

/**
 * Verify payment via POST /api/v1/consult and atomically transition
 * to paid when provider confirms approval (code "1").
 *
 * NEVER trusts browser query parameters.
 * Only the official consult response with code "1" + matching
 * orderNumber/amount/currency may transition the payment to paid.
 *
 * @returns {{ paid, pending, status, message }}
 */
async function verifyAndConfirmPayment(internalRef, options) {
  if (!options) options = {};
  var pool = require('../config/db');
  var tilopayClient = require('./tilopayClient');

  // 1. Load local transaction
  var conn = await pool.getConnection();
  try {
    var rows = await conn.query(
      'SELECT * FROM tilopay_transactions WHERE internal_reference = ?',
      [internalRef]
    );
    var tx = rows[0] && rows[0].length ? rows[0][0] : null;
  } finally {
    conn.release();
  }

  if (!tx) {
    return { paid: false, pending: false, status: 'unknown', message: 'Transaccion no encontrada.' };
  }

  // 2. Already paid — duplicate browser returns and reconciliations are harmless.
  if (tx.status === 'approved' || tx.status === 'paid') {
    return { paid: true, pending: false, status: 'approved', message: 'Pago confirmado.' };
  }

  // 3. Rebuild the exact orderNumber sent during initiation. The canonical
  // schema intentionally has no duplicate order_number/provider_order_number column.
  const expectedOrderNumber = buildProviderOrderNumber(tx.order_id, internalRef);

  // 4. Call official consult
  var consultResult;
  try {
    consultResult = await tilopayClient.consultTransaction(expectedOrderNumber, {
      amount: String(Number(tx.amount).toFixed(2)),
      currency: tx.currency,
    });
  } catch (e) {
    await _recordMismatch(internalRef, tx.order_id, 'malformed_provider_response', {
      errorCode: String(e.code || e.name || 'CONSULT_ERROR').slice(0, 50),
    }, { actorUserId: options.actorUserId || null, markFailed: false });
    return { paid: false, pending: true, status: 'pending', message: 'Verificando pago. Intenta de nuevo en unos minutos.' };
  }

  // 5. No transaction found
  if (!consultResult || !consultResult.transaction) {
    const responseRows = consultResult && consultResult.rawResponse && consultResult.rawResponse.response;
    const mismatchType = Array.isArray(responseRows) && responseRows.length > 0
      ? 'order_number_mismatch'
      : 'missing_provider_transaction';
    await _recordMismatch(internalRef, tx.order_id, mismatchType, {
      expectedOrderNumber,
    }, { actorUserId: options.actorUserId || null, markFailed: mismatchType === 'order_number_mismatch' });
    return { paid: false, pending: true, status: 'pending', message: 'El pago aun no aparece. Intenta en unos minutos.' };
  }

  var provider = consultResult.transaction;

  if (String(provider.orderNumber || '') !== expectedOrderNumber && !String(provider.orderNumber || '').endsWith(expectedOrderNumber)) {
    await _recordMismatch(internalRef, tx.order_id, 'order_number_mismatch', {
      expectedOrderNumber,
      receivedOrderNumber: String(provider.orderNumber || '').slice(0, 40),
    }, { actorUserId: options.actorUserId || null, markFailed: true });
    return { paid: false, pending: false, status: 'mismatch', message: 'Inconsistencia en la referencia del pago.' };
  }

  // 6. Mismatch checks
  const providerAmount = Number(provider.amount);
  if (provider.amountMismatch || !Number.isFinite(providerAmount)
      || Math.abs(Number(tx.amount) - providerAmount) > 0.01) {
    await _recordMismatch(internalRef, tx.order_id, 'amount_mismatch', {
      expectedAmount: String(tx.amount),
      receivedAmount: String(provider.amount || '').slice(0, 30),
    }, { actorUserId: options.actorUserId || null, markFailed: true });
    return { paid: false, pending: false, status: 'mismatch', message: 'Inconsistencia en el monto. Nuestro equipo lo revisara.' };
  }

  if (provider.currencyMismatch
      || String(provider.currency || '').toUpperCase() !== String(tx.currency).toUpperCase()) {
    await _recordMismatch(internalRef, tx.order_id, 'currency_mismatch', {
      expectedCurrency: tx.currency,
      receivedCurrency: String(provider.currency || '').slice(0, 10),
    }, { actorUserId: options.actorUserId || null, markFailed: true });
    return { paid: false, pending: false, status: 'mismatch', message: 'Inconsistencia en la moneda. Nuestro equipo lo revisara.' };
  }

  // 7. Only the documented code "1" marks paid.
  if (!provider.paid || String(provider.code || '') !== '1') {
    var localStatus = provider.terminal ? 'failed' : (provider.status || 'pending');
    const rawStatus = String(provider.code || provider.status || provider.response || '').slice(0, 100);
    await pool.query(
      `UPDATE tilopay_transactions
          SET status = ?, raw_status = ?
        WHERE internal_reference = ? AND status NOT IN ('approved', 'paid')`,
      [localStatus, rawStatus, internalRef]
    );
    if (!provider.terminal) {
      await _recordMismatch(internalRef, tx.order_id, 'unsupported_provider_status', {
        providerCode: String(provider.code || '').slice(0, 20),
        providerStatus: String(provider.status || '').slice(0, 30),
      }, { actorUserId: options.actorUserId || null, markFailed: false });
    }

    return {
      paid: false,
      pending: !provider.terminal,
      status: localStatus,
      message: provider.label || 'El pago no fue aprobado. Puedes intentarlo nuevamente.'
    };
  }

  // 8. APPROVED: Atomic transition
  return await _confirmPaid(internalRef, tx, provider, options);
}

async function _confirmPaid(internalRef, tx, provider, options) {
  var pool = require('../config/db');
  var conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Lock transaction
    var rows = await conn.query(
      'SELECT * FROM tilopay_transactions WHERE internal_reference = ? FOR UPDATE',
      [internalRef]
    );
    var lockedTx = (rows[0] && rows[0].length) ? rows[0][0] : null;
    if (!lockedTx) {
      await conn.rollback();
      conn.release();
      return { paid: false, pending: false, status: 'unknown', message: 'Transaccion no encontrada.' };
    }

    // Idempotency
    if (lockedTx.status === 'approved' || lockedTx.status === 'paid') {
      await conn.commit();
      conn.release();
      return { paid: true, pending: false, status: 'approved', message: 'Pago ya confirmado.' };
    }

    // Lock order
    rows = await conn.query(
      'SELECT * FROM orders WHERE id = ? FOR UPDATE',
      [tx.order_id]
    );
    var order = (rows[0] && rows[0].length) ? rows[0][0] : null;
    if (!order) {
      await conn.rollback();
      conn.release();
      return { paid: false, pending: false, status: 'unknown', message: 'Orden no encontrada.' };
    }

    // Don't regress
    if (order.payment_status === 'paid') {
      await conn.commit();
      conn.release();
      return { paid: true, pending: false, status: 'approved', message: 'Pago ya confirmado.', orderAlreadyPaid: true };
    }

    // Final amount check
    var expectedAmt = String(Number(order.final_total || order.total || 0).toFixed(2));
    if (provider.amount && Math.abs(Number(provider.amount) - Number(expectedAmt)) > 0.01) {
      await conn.rollback();
      conn.release();
      await _recordMismatch(internalRef, order.id, 'amount_mismatch_final', {
        expectedAmount: expectedAmt,
        receivedAmount: String(provider.amount || '').slice(0, 30),
      }, { actorUserId: options.actorUserId || null, markFailed: true });
      return { paid: false, pending: false, status: 'mismatch', message: 'Inconsistencia en el monto.' };
    }

    if (provider.currency && String(provider.currency).toUpperCase() !== String(lockedTx.currency).toUpperCase()) {
      await conn.rollback();
      conn.release();
      await _recordMismatch(internalRef, order.id, 'currency_mismatch_final', {
        expectedCurrency: lockedTx.currency,
        receivedCurrency: String(provider.currency).slice(0, 10),
      }, { actorUserId: options.actorUserId || null, markFailed: true });
      return { paid: false, pending: false, status: 'mismatch', message: 'Inconsistencia en la moneda.' };
    }

    // PERSIST transaction
    await conn.query(
      `UPDATE tilopay_transactions
          SET status = 'approved',
              provider_transaction_id = COALESCE(NULLIF(?, ''), provider_transaction_id),
              raw_status = ?, confirmed_at = NOW()
        WHERE internal_reference = ?`,
      [provider.id_tilopay ? String(provider.id_tilopay).slice(0, 100) : null,
       String(provider.code || provider.status || '').slice(0, 100), internalRef]
    );

    // PERSIST order
    await conn.query(
      "UPDATE orders SET payment_status = 'paid', order_status = 'payment_confirmed' WHERE id = ?",
      [order.id]
    );

    // INSERT event
    await conn.query(
      `INSERT INTO order_events
        (order_id, actor_user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, 'tilopay_payment_approved', ?, 'payment_confirmed', ?, NOW())`,
      [order.id, options.actorUserId || null, order.order_status,
       JSON.stringify({
         internalRef,
         providerTransactionId: provider.id_tilopay ? String(provider.id_tilopay).slice(0, 100) : null,
         providerOrderNumber: String(provider.orderNumber || '').slice(0, 40),
         providerResponse: String(provider.response || '').slice(0, 200),
         providerAmount: String(provider.amount || '').slice(0, 30),
         trigger: String(options.trigger || 'unknown').slice(0, 30),
       }).slice(0, 4000)]
    );

    await conn.commit();
    conn.release();

    return { paid: true, pending: false, status: 'approved', message: 'Pago confirmado. Gracias por tu compra.' };
  } catch (e) {
    await conn.rollback();
    conn.release();
    console.error('[tilopay] Confirm error:', e.code || e.name || 'CONFIRM_ERROR');
    return { paid: false, pending: true, status: 'pending', message: 'Error al confirmar. Intenta de nuevo.' };
  }
}

async function _recordMismatch(internalRef, orderId, type, detail = {}, options = {}) {
  const eventTypes = {
    order_number_mismatch: 'tilopay_order_number_mismatch',
    amount_mismatch: 'tilopay_amount_mismatch',
    amount_mismatch_final: 'tilopay_amount_mismatch',
    currency_mismatch: 'tilopay_currency_mismatch',
    currency_mismatch_final: 'tilopay_currency_mismatch',
    missing_provider_transaction: 'tilopay_provider_transaction_missing',
    malformed_provider_response: 'tilopay_malformed_response',
    unsupported_provider_status: 'tilopay_unsupported_status',
  };
  const eventType = eventTypes[type] || 'tilopay_verification_mismatch';
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [orders] = await conn.query(
      'SELECT order_status FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    const orderStatus = orders[0] ? orders[0].order_status : null;

    if (options.markFailed) {
      await conn.query(
        `UPDATE tilopay_transactions
            SET status = 'failed', failure_code = ?, failure_message = ?, failed_at = NOW()
          WHERE internal_reference = ? AND status NOT IN ('approved', 'paid')`,
        [String(type).toUpperCase().slice(0, 50),
         JSON.stringify(detail).slice(0, 500), internalRef]
      );
    }

    const metadata = JSON.stringify({
      internalRef,
      mismatchType: type,
      ...detail,
    }).slice(0, 4000);
    const [existing] = await conn.query(
      `SELECT id FROM order_events
        WHERE order_id = ? AND event_type = ?
          AND metadata_json LIKE ? AND metadata_json LIKE ?
        LIMIT 1`,
      [orderId, eventType, `%${internalRef}%`, `%${type}%`]
    );
    if (!existing[0]) {
      await conn.query(
        `INSERT INTO order_events
          (order_id, actor_user_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [orderId, options.actorUserId || null, eventType, orderStatus, orderStatus, metadata]
      );
    }

    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  TilopayError,
  initiateHostedPayment,
  verifyAndConfirmPayment,
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
