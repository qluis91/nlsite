const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;
let consultHandler = null;
let consultCalls = 0;
let processPaymentCalls = 0;
let deprecatedLookupCalls = 0;

Module._load = function loadWithProviderStub(request, parent, isMain) {
  if (request === './tilopayClient'
      && parent
      && path.basename(parent.filename) === 'tilopayService.js') {
    return {
      async processPayment() {
        processPaymentCalls += 1;
        throw new Error('processPayment must not run in confirmation tests');
      },
      async consultTransaction(orderNumber, expected) {
        consultCalls += 1;
        if (!consultHandler) throw new Error('Missing consult test handler');
        return consultHandler(orderNumber, expected);
      },
      async getTransactionStatus() {
        deprecatedLookupCalls += 1;
        throw new Error('Deprecated lookup must not run');
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require('../config/db');
const tilopayService = require('../services/tilopayService');

const orderIds = [];
const rollbackTrigger = 'tilopay_confirmation_test_fail';

function providerOrderNumber(orderId, internalRef) {
  return `NL-${orderId}-${internalRef.slice(0, 8)}`.slice(0, 40);
}

async function createFixture({
  paymentStatus = 'pending',
  orderStatus = 'pending_payment',
  transactionStatus = 'pending',
  amount = '1500.00',
  currency = 'CRC',
} = {}) {
  const suffix = crypto.randomBytes(6).toString('hex').toUpperCase();
  const orderReference = `NL-TCF${suffix}`;
  const [orderResult] = await pool.query(
    `INSERT INTO orders
      (order_reference, user_id, customer_name, customer_email, customer_phone,
       delivery_method, shipping_status, shipping_amount, payment_method,
       payment_status, order_status, product_subtotal, final_total, idempotency_key)
     VALUES (?, NULL, ?, ?, ?, 'local_pickup', 'not_required', 0,
             'tilopay', ?, ?, 1500, 1500, ?)`,
    [orderReference, 'Tilopay confirmation fixture', `${orderReference.toLowerCase()}@example.invalid`,
      '00000000', paymentStatus, orderStatus, crypto.randomBytes(32).toString('hex')]
  );
  const orderId = orderResult.insertId;
  orderIds.push(orderId);

  const internalRef = crypto.randomUUID();
  await pool.query(
    `INSERT INTO tilopay_transactions
      (order_id, internal_reference, idempotency_key, status, amount, currency,
       checkout_url, provider_created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [orderId, internalRef, crypto.randomBytes(32).toString('hex'), transactionStatus,
      amount, currency, 'https://secure.tilopay.com/mock/confirmation-fixture']
  );

  return {
    orderId,
    internalRef,
    orderNumber: providerOrderNumber(orderId, internalRef),
    amount,
    currency,
  };
}

function approvedConsult(fixture, overrides = {}) {
  return {
    type: '200',
    transaction: {
      id_tilopay: `provider-${fixture.orderId}`,
      orderNumber: fixture.orderNumber,
      amount: fixture.amount,
      currency: fixture.currency,
      code: '1',
      response: 'Transaccion aprobada',
      auth: 'AUTH-MUST-NOT-BE-PERSISTED',
      status: 'approved',
      label: 'Transaccion aprobada',
      terminal: true,
      paid: true,
      ...overrides,
    },
    rawResponse: { type: '200', response: [] },
  };
}

async function getState(fixture) {
  const [[transaction]] = await pool.query(
    `SELECT status, provider_transaction_id, raw_status, confirmed_at,
            failure_code, failure_message
       FROM tilopay_transactions WHERE internal_reference = ?`,
    [fixture.internalRef]
  );
  const [[order]] = await pool.query(
    'SELECT payment_status, order_status FROM orders WHERE id = ?',
    [fixture.orderId]
  );
  const [events] = await pool.query(
    `SELECT event_type, from_status, to_status, metadata_json
       FROM order_events WHERE order_id = ? ORDER BY id`,
    [fixture.orderId]
  );
  return { transaction, order, events };
}

test.after(async () => {
  Module._load = originalLoad;
  await pool.query(`DROP TRIGGER IF EXISTS \`${rollbackTrigger}\``);
  for (const orderId of orderIds) {
    await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
  }
  assert.equal(processPaymentCalls, 0, 'no hosted-payment request may run');
  assert.equal(deprecatedLookupCalls, 0, 'all confirmation callers must use official consult');
});

test('approved consult persists canonical transaction, order, and event fields atomically', async () => {
  const fixture = await createFixture();
  consultHandler = async (orderNumber, expected) => {
    assert.equal(orderNumber, fixture.orderNumber);
    assert.deepEqual(expected, { amount: '1500.00', currency: 'CRC' });
    return approvedConsult(fixture);
  };

  const result = await tilopayService.verifyAndConfirmPayment(fixture.internalRef, {
    trigger: 'return',
    actorUserId: null,
  });
  assert.equal(result.paid, true);
  assert.equal(result.status, 'approved');

  const state = await getState(fixture);
  assert.equal(state.transaction.status, 'approved');
  assert.equal(state.transaction.provider_transaction_id, `provider-${fixture.orderId}`);
  assert.equal(state.transaction.raw_status, '1');
  assert.ok(state.transaction.confirmed_at);
  assert.equal(state.order.payment_status, 'paid');
  assert.equal(state.order.order_status, 'payment_confirmed');
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].event_type, 'tilopay_payment_approved');
  assert.equal(state.events[0].from_status, 'pending_payment');
  assert.equal(state.events[0].to_status, 'payment_confirmed');
  const metadata = JSON.parse(state.events[0].metadata_json);
  assert.equal(metadata.providerTransactionId, `provider-${fixture.orderId}`);
  assert.equal(metadata.providerOrderNumber, fixture.orderNumber);
  assert.equal(metadata.providerResponse, 'Transaccion aprobada');
  assert.equal(Object.hasOwn(metadata, 'providerAuth'), false);
  assert.doesNotMatch(state.events[0].metadata_json, /AUTH-MUST-NOT-BE-PERSISTED/);

  const [schemaRows] = await pool.query("SHOW COLUMNS FROM tilopay_transactions LIKE 'provider_auth'");
  assert.equal(schemaRows.length, 0, 'provider auth has no canonical transaction column');
});

test('duplicate return and admin reconciliation do not consult again or duplicate the approval event', async () => {
  const fixture = await createFixture();
  consultHandler = async () => approvedConsult(fixture);
  const callsBefore = consultCalls;

  const first = await tilopayService.verifyAndConfirmPayment(fixture.internalRef, { trigger: 'return' });
  const second = await tilopayService.verifyAndConfirmPayment(fixture.internalRef, { trigger: 'return' });
  const admin = await tilopayService.reconcileTransaction(fixture.internalRef);

  assert.equal(first.paid, true);
  assert.equal(second.paid, true);
  assert.equal(admin.paid, true);
  assert.equal(consultCalls - callsBefore, 1, 'terminal approval should short-circuit duplicate verification');
  const state = await getState(fixture);
  assert.equal(state.events.filter((event) => event.event_type === 'tilopay_payment_approved').length, 1);
});

test('customer and guest verification entry point uses the same official consult persistence path', async () => {
  const fixture = await createFixture();
  consultHandler = async () => approvedConsult(fixture);

  const result = await tilopayService.verifyTilopayPayment(fixture.internalRef, {
    trigger: 'guest_verify',
    actorUserId: null,
  });

  assert.equal(result.verified, true);
  assert.equal(result.orderPaid, true);
  assert.equal(result.localStatus, 'approved');
  const state = await getState(fixture);
  assert.equal(state.transaction.status, 'approved');
  assert.equal(state.order.payment_status, 'paid');
  assert.equal(state.order.order_status, 'payment_confirmed');
  assert.equal(state.events.length, 1);
});

test('an already-paid order is not regressed or used to duplicate a payment event', async () => {
  const fixture = await createFixture({ paymentStatus: 'paid', orderStatus: 'payment_confirmed' });
  consultHandler = async () => approvedConsult(fixture);

  const result = await tilopayService.verifyAndConfirmPayment(fixture.internalRef, { trigger: 'admin' });
  assert.equal(result.paid, true);
  assert.equal(result.orderAlreadyPaid, true);
  const state = await getState(fixture);
  assert.equal(state.transaction.status, 'pending');
  assert.equal(state.transaction.provider_transaction_id, null);
  assert.equal(state.order.payment_status, 'paid');
  assert.equal(state.order.order_status, 'payment_confirmed');
  assert.equal(state.events.length, 0);
});

test('amount mismatch uses canonical audit columns and leaves the order unpaid', async () => {
  const fixture = await createFixture();
  consultHandler = async () => approvedConsult(fixture, { amount: '1501.00', amountMismatch: true, paid: false });

  const result = await tilopayService.verifyAndConfirmPayment(fixture.internalRef, { trigger: 'return' });
  assert.equal(result.status, 'mismatch');
  const state = await getState(fixture);
  assert.equal(state.transaction.status, 'failed');
  assert.equal(state.transaction.failure_code, 'AMOUNT_MISMATCH');
  assert.equal(state.order.payment_status, 'pending');
  assert.equal(state.order.order_status, 'pending_payment');
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].event_type, 'tilopay_amount_mismatch');
  assert.equal(JSON.parse(state.events[0].metadata_json).mismatchType, 'amount_mismatch');
});

test('order-number, missing-transaction, malformed-response, and unsupported-status audits all persist', async (t) => {
  const cases = [
    {
      name: 'order number mismatch',
      eventType: 'tilopay_order_number_mismatch',
      handler: (fixture) => async () => approvedConsult(fixture, { orderNumber: 'WRONG-ORDER', paid: false }),
    },
    {
      name: 'missing provider transaction',
      eventType: 'tilopay_provider_transaction_missing',
      handler: () => async () => ({ type: '200', transaction: null, rawResponse: { type: '200', response: [] } }),
    },
    {
      name: 'malformed provider response',
      eventType: 'tilopay_malformed_response',
      handler: () => async () => { const error = new Error('malformed'); error.code = 'MALFORMED_RESPONSE'; throw error; },
    },
    {
      name: 'unsupported provider status',
      eventType: 'tilopay_unsupported_status',
      handler: (fixture) => async () => approvedConsult(fixture, {
        code: '999', status: 'pending', paid: false, terminal: false, response: 'Unsupported',
      }),
    },
  ];

  for (const auditCase of cases) {
    await t.test(auditCase.name, async () => {
      const fixture = await createFixture();
      consultHandler = auditCase.handler(fixture);
      await tilopayService.verifyAndConfirmPayment(fixture.internalRef, { trigger: 'return' });
      const state = await getState(fixture);
      assert.equal(state.order.payment_status, 'pending');
      assert.equal(state.order.order_status, 'pending_payment');
      assert.equal(state.events.length, 1);
      assert.equal(state.events[0].event_type, auditCase.eventType);
      assert.ok(state.events[0].metadata_json);
    });
  }
});

test('an order-event database failure rolls back transaction and order confirmation updates', async () => {
  const fixture = await createFixture();
  consultHandler = async () => approvedConsult(fixture);
  await pool.query(`DROP TRIGGER IF EXISTS \`${rollbackTrigger}\``);
  await pool.query(
    `CREATE TRIGGER \`${rollbackTrigger}\`
       BEFORE INSERT ON order_events FOR EACH ROW
       SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced confirmation event failure'`
  );

  let result;
  try {
    result = await tilopayService.verifyAndConfirmPayment(fixture.internalRef, { trigger: 'return' });
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS \`${rollbackTrigger}\``);
  }
  assert.equal(result.paid, false);
  assert.equal(result.pending, true);

  const state = await getState(fixture);
  assert.equal(state.transaction.status, 'pending');
  assert.equal(state.transaction.provider_transaction_id, null);
  assert.equal(state.transaction.confirmed_at, null);
  assert.equal(state.order.payment_status, 'pending');
  assert.equal(state.order.order_status, 'pending_payment');
  assert.equal(state.events.length, 0);
});
