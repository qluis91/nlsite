const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');

const hostedUrl = 'https://secure.tilopay.com/mock/hosted-session';
const originalLoad = Module._load;
let providerCalls = 0;

Module._load = function loadWithStub(request, parent, isMain) {
  if (request === './tilopayClient'
      && parent
      && path.basename(parent.filename) === 'tilopayService.js') {
    return {
      async processPayment() {
        providerCalls += 1;
        return { url: hostedUrl };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require('../config/db');
const tilopayService = require('../services/tilopayService');

let orderId = null;

test.after(async () => {
  Module._load = originalLoad;
  if (orderId !== null) {
    await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
  }
});

test('hosted initiation persists Stage A and Stage C using the canonical schema', async () => {
  const suffix = crypto.randomBytes(6).toString('hex').toUpperCase();
  const orderReference = `NL-TDB${suffix}`;
  const orderIdempotencyKey = crypto.randomBytes(32).toString('hex');

  const [insert] = await pool.query(
    `INSERT INTO orders
      (order_reference, user_id, customer_name, customer_email, customer_phone,
       delivery_method, shipping_status, shipping_amount, payment_method,
       payment_status, order_status, product_subtotal, final_total, idempotency_key)
     VALUES (?, NULL, ?, ?, ?, 'local_pickup', 'not_required', 0,
             'tilopay', 'pending', 'pending_payment', 1500, 1500, ?)`,
    [
      orderReference,
      'Tilopay DB fixture',
      `${orderReference.toLowerCase()}@example.invalid`,
      '00000000',
      orderIdempotencyKey,
    ]
  );
  orderId = insert.insertId;

  const result = await tilopayService.initiateHostedPayment(orderId, null);

  assert.equal(providerCalls, 1, 'the in-process provider stub should be called exactly once');
  assert.equal(result.redirect, true);
  assert.equal(result.url, hostedUrl);
  assert.match(result.internalRef, /^[0-9a-f-]{36}$/i);

  const [transactions] = await pool.query(
    `SELECT order_id, internal_reference, idempotency_key, status, amount, currency,
            checkout_url, provider_created_at
       FROM tilopay_transactions
      WHERE internal_reference = ?`,
    [result.internalRef]
  );
  assert.equal(transactions.length, 1, 'Stage A should create one Tilopay transaction');
  assert.equal(transactions[0].order_id, orderId);
  assert.equal(transactions[0].status, 'pending', 'Stage C should update the attempt to pending');
  assert.equal(Number(transactions[0].amount), 1500);
  assert.equal(transactions[0].currency, 'CRC');
  assert.equal(transactions[0].checkout_url, hostedUrl);
  assert.ok(transactions[0].idempotency_key, 'the required canonical idempotency key must be persisted');
  assert.ok(transactions[0].provider_created_at, 'hosted-payment metadata timestamp must be persisted');

  const [events] = await pool.query(
    `SELECT event_type, metadata_json
       FROM order_events
      WHERE order_id = ? AND event_type = 'tilopay_payment_created'`,
    [orderId]
  );
  assert.equal(events.length, 1, 'Stage C should insert the relevant order event');
  const metadata = JSON.parse(events[0].metadata_json);
  assert.equal(metadata.internal_ref, result.internalRef);
  assert.equal(metadata.provider_url, hostedUrl);
});
