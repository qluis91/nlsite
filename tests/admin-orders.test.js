const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');
const {
  parseMoneyToCents, centsToDecimal, validateNote, validateOrderReference,
  validateOrderStatus, parseOrderFilters,
} = require('../validators/adminOrderValidator');
const {
  initialOrderStatus, getAllowedNextStatuses, canQuoteShipping,
  canConfirmPayment, canCancelOrder,
} = require('../config/orderOptions');

test.after(async () => pool.end());

test('money parsing is exact and rejects malformed or excessive values', () => {
  assert.deepEqual(parseMoneyToCents('1250.5'), { valid: true, cents: 125050n, value: '1250.50' });
  assert.equal(centsToDecimal(125050n), '1250.50');
  for (const value of ['', '-1', '1.234', '1e3', '100000000.00', '1 OR 1=1']) {
    assert.equal(parseMoneyToCents(value).valid, false, value);
  }
});

test('references, notes, statuses and filters are allowlisted and bounded', () => {
  assert.equal(validateOrderReference('nl-abcd1234').valid, true);
  assert.equal(validateOrderReference('../1').valid, false);
  assert.equal(validateNote('x'.repeat(501), true).valid, false);
  assert.equal(validateOrderStatus('completed').valid, true);
  assert.equal(validateOrderStatus('paid; DROP TABLE orders').valid, false);
  const filters = parseOrderFilters({ page: '-2', limit: '999', sort: 'RAND()', orderStatus: 'x', search: 'a'.repeat(150) });
  assert.equal(filters.page, 1);
  assert.equal(filters.limit, 50);
  assert.equal(filters.sort, 'newest');
  assert.equal(filters.orderStatus, '');
  assert.equal(filters.search.length, 100);
});

test('lifecycle rules differ for pickup and delivery', () => {
  assert.equal(initialOrderStatus('pending_quote'), 'pending_shipping_quote');
  assert.equal(initialOrderStatus('not_required'), 'pending_payment');
  assert.deepEqual(getAllowedNextStatuses({ order_status: 'preparing', delivery_method: 'local_pickup' }), ['ready_for_pickup']);
  assert.deepEqual(getAllowedNextStatuses({ order_status: 'preparing', delivery_method: 'uber_flash' }), ['ready_for_dispatch']);
  assert.deepEqual(getAllowedNextStatuses({ order_status: 'ready_for_pickup', delivery_method: 'uber_flash' }), []);
});

test('quotation, manual payment and cancellation gates reject unsafe states', () => {
  const delivery = { delivery_method: 'uber_flash', shipping_status: 'pending_quote', payment_status: 'pending', order_status: 'pending_shipping_quote', payment_method: 'sinpe', final_total: null };
  assert.equal(canQuoteShipping(delivery), true);
  assert.equal(canConfirmPayment(delivery), false);
  assert.equal(canCancelOrder(delivery), true);
  const payable = { ...delivery, shipping_status: 'quoted', order_status: 'pending_payment', final_total: '1500.00' };
  assert.equal(canConfirmPayment(payable), true);
  assert.equal(canQuoteShipping({ ...payable, payment_status: 'paid' }), false);
  assert.equal(canCancelOrder({ ...payable, payment_status: 'paid' }), false);
});

test('admin routes are protected after global CSRF and all mutation forms carry tokens', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(app.indexOf('app.use(csrfSynchronisedProtection)') < app.indexOf("app.use('/admin', isAuthenticated, isAdmin, adminOrderRoutes)"));
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminOrderRoutes.js'), 'utf8');
  for (const endpoint of ['quote-shipping', 'confirm-payment', 'status', 'notes', 'cancel', 'aprobar', 'rechazar']) assert.match(routes, new RegExp(`router\\.post\\([^\\n]+${endpoint}`));
  const detail = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'order-detail.ejs'), 'utf8');

  // Extract every POST form block from the EJS source.
  // Bracket-counting parser: EJS <%= %> inside attributes contain < and >,
  // so we count depth to find the real form-tag boundary.
  const postForms = [];
  let searchFrom = 0;
  while (true) {
    const start = detail.indexOf('<form', searchFrom);
    if (start === -1) break;

    // Count bracket depth to skip EJS <%= %> inside attributes
    let depth = 0;
    let tagEnd = -1;
    for (let i = start; i < detail.length; i++) {
      if (detail[i] === '<') depth++;
      else if (detail[i] === '>') {
        depth--;
        if (depth === 0) { tagEnd = i; break; }
      }
    }
    if (tagEnd === -1) break;
    const openTag = detail.slice(start, tagEnd + 1);

    const closeTag = detail.indexOf('</form>', tagEnd);
    if (closeTag === -1) break;
    const body = detail.slice(tagEnd + 1, closeTag);

    if (/method\s*=\s*["']post["']/i.test(openTag)) {
      const actionMatch = openTag.match(/action\s*=\s*["']([^"']+)["']/i);
      const action = actionMatch ? actionMatch[1] : '(no action)';
      postForms.push({ action, body, line: (detail.slice(0, start).match(/\n/g) || []).length + 1 });
    }
    searchFrom = closeTag + 7;
  }

  assert.ok(postForms.length >= 7, `Expected at least 7 POST forms, found ${postForms.length}`);

  for (const form of postForms) {
    // Each POST form must have exactly one _csrf hidden input.
    // Check for name="_csrf" (any quote style, any attribute order) within the form body.
    const csrfNameCount = (form.body.match(/name\s*=\s*["']_csrf["']/gi) || []).length;
    assert.equal(
      csrfNameCount,
      1,
      `POST form line ${form.line} (${form.action}) must contain exactly one _csrf input (found ${csrfNameCount})`
    );

    // The _csrf must be type="hidden"
    assert.match(form.body, /type\s*=\s*["']hidden["']/i,
      `_csrf in form line ${form.line} must be type=hidden`);

    // The _csrf must have csrfToken value binding (EJS: value="<%= csrfToken %>")
    assert.match(form.body, /value\s*=\s*["']<%=?\s*csrfToken/,
      `_csrf in form line ${form.line} must have csrfToken value binding`);
  }

  // ── Explicit Tilopay reconciliation-form CSRF assertion ──
  // Use depth-counting to extract the Tilopay form's body correctly despite EJS in attributes
  const tiloStart = detail.indexOf('<form', detail.indexOf('/tilopay/reconcile') - 200);
  if (tiloStart !== -1) {
    let d = 0, tiloEnd = -1;
    for (let i = tiloStart; i < detail.length; i++) {
      if (detail[i] === '<') d++;
      else if (detail[i] === '>') { d--; if (d === 0) { tiloEnd = i; break; } }
    }
    if (tiloEnd !== -1) {
      const tiloClose = detail.indexOf('</form>', tiloEnd);
      const tilopayBlock = detail.slice(tiloStart, tiloClose + 7);
      const tilopayBody = detail.slice(tiloEnd + 1, tiloClose);

      assert.match(tilopayBlock, /method\s*=\s*["']post["']/i, 'Tilopay reconcile form must be POST');
      assert.match(tilopayBlock, /\/tilopay\/reconcile/, 'Tilopay reconcile action is present');

      const tCsrf = (tilopayBody.match(/name\s*=\s*["']_csrf["']/gi) || []).length;
      assert.equal(tCsrf, 1, `Tilopay reconcile form must have exactly one _csrf (found ${tCsrf})`);
      assert.match(tilopayBody, /type\s*=\s*["']hidden["']/i, '_csrf in Tilopay form must be type=hidden');
      assert.match(tilopayBody, /value\s*=\s*["']<%=?\s*csrfToken/, '_csrf in Tilopay form must have csrfToken binding');

      // ── Tilopay form must NOT accept browser-authoritative payment fields ──
      assert.ok(!tilopayBody.match(/name\s*=\s*["']amount["']/i), 'Tilopay form must not have authored amount field');
      assert.ok(!tilopayBody.match(/name\s*=\s*["']status["']/i), 'Tilopay form must not have authored status field');
      assert.ok(!tilopayBody.match(/name\s*=\s*["']providerTransactionId["']/i), 'Tilopay form must not accept provider ID from browser');
    }
  }
  const confirmation = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'checkout-confirmation.ejs'), 'utf8');
  assert.doesNotMatch(confirmation, /internal_note|order_events|event\.note/);
});

test('active database has hardened schema and consistent existing orders', async () => {
  const [[uniqueIndex]] = await pool.query("SELECT COUNT(*) total FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='uq_orders_idempotency' AND NON_UNIQUE=0");
  const [[eventsTable]] = await pool.query("SELECT COUNT(*) total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order_events'");
  const [[anomalies]] = await pool.query("SELECT COUNT(*) total FROM orders WHERE order_status IS NULL OR product_subtotal < 0 OR shipping_amount < 0 OR final_total < 0");
  const [[missingAuditHistory]] = await pool.query('SELECT COUNT(*) total FROM orders o LEFT JOIN order_events e ON e.order_id=o.id WHERE e.id IS NULL');
  assert.equal(Number(uniqueIndex.total), 1);
  assert.equal(Number(eventsTable.total), 1);
  assert.equal(Number(anomalies.total), 0);
  assert.equal(Number(missingAuditHistory.total), 0);
});

test('active unique constraint rejects a duplicate idempotency key without persistence', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM orders ORDER BY id LIMIT 1');
    assert.ok(rows[0], 'fixture order required');
    const o = rows[0];
    await assert.rejects(
      conn.query(`INSERT INTO orders
        (order_reference,user_id,customer_name,customer_email,customer_phone,delivery_method,shipping_status,shipping_amount,payment_method,payment_status,order_status,province,canton,district,address_line,address_reference,product_subtotal,final_total,idempotency_key)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`NL-TEST${Date.now().toString(36).toUpperCase()}`,o.user_id,o.customer_name,o.customer_email,o.customer_phone,o.delivery_method,o.shipping_status,o.shipping_amount,o.payment_method,o.payment_status,o.order_status,o.province,o.canton,o.district,o.address_line,o.address_reference,o.product_subtotal,o.final_total,o.idempotency_key]),
      (error) => error && error.code === 'ER_DUP_ENTRY'
    );
  } finally {
    await conn.rollback();
    conn.release();
  }
});
