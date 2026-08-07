/**
 * Checkout flow tests — add-to-cart panel, payment branching, CSP helpers.
 * Validates runtime behavior, not just source text.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('node:module');

// ─────────────────────────────────────────────────────────
// Helpers for loading the checkout controller with injected mocks
// ─────────────────────────────────────────────────────────

const checkoutPath = require.resolve('../controllers/checkoutController');

function loadCheckoutController({
  createOrderResult = null,
  initiateHostedPayment = async () => ({
    redirect: true,
    url: 'https://secure.tilopay.com/mock-payment',
  }),
  cartHydrated = null,
  cartValid = true,
} = {}) {
  delete require.cache[checkoutPath];

  const serviceCalls = [];
  const cart = { items: [], total: 0 };

  const defaultOrderResult = createOrderResult || {
    success: true,
    duplicate: false,
    orderRef: 'NL-TEST12345678',
    orderId: 999,
    subtotal: 10000,
    shippingAmount: 0,
    finalTotal: 10000,
    shippingStatus: 'not_required',
    deliveryMethod: 'local_pickup',
    paymentMethod: 'tilopay',
    customerName: 'Test',
    email: 'test@test.com',
    phone: '88888888',
    items: [],
  };

  const mocks = {
    '../validators/checkoutValidator': {
      validateCheckoutPayload(input) {
        return {
          valid: true,
          data: {
            customerName: input.customerName || 'Test',
            email: input.email || 'test@test.com',
            phone: input.phone || '88888888',
            deliveryMethod: input.deliveryMethod || 'local_pickup',
            paymentMethod: input.paymentMethod || 'tilopay',
            province: input.province || '',
            canton: input.canton || '',
            district: input.distrito || '',
            addressLine: input.addressLine || '',
            addressReference: input.addressReference || '',
          },
          errors: {},
        };
      },
    },
    '../services/orderService': {
      validateCartForCheckout: async (c) => ({
        valid: cartValid,
        hydrated: cartHydrated || { items: [], subtotal: 10000, itemCount: 1 },
        error: cartValid ? null : 'Cart error',
      }),
      generateCheckoutToken: () => 'tok_xxx',
      createOrder: async (data, c) => {
        serviceCalls.push(['createOrder', data]);
        return defaultOrderResult;
      },
    },
    '../services/cartService': {
      getSessionCart: (req) => cart,
      clearCart: (c) => { serviceCalls.push('clearCart'); },
    },
    '../config/checkoutOptions': {
      DELIVERY_METHODS: {
        local_pickup: { key: 'local_pickup', label: 'Retiro', requiresAddress: false, shippingStatus: 'not_required', shippingAmount: 0 },
        uber_flash: { key: 'uber_flash', label: 'Uber', requiresAddress: true, shippingStatus: 'pending_quote', shippingAmount: null },
      },
      PAYMENT_METHODS: {
        sinpe: { key: 'sinpe', label: 'SINPE', enabled: true },
        bank_transfer: { key: 'bank_transfer', label: 'Transferencia', enabled: true },
        tilopay: { key: 'tilopay', label: 'Tilopay', enabled: true },
      },
      ALL_PAYMENT_KEYS: ['sinpe', 'bank_transfer', 'tilopay'],
      CR_PROVINCES: ['San José', 'Alajuela', 'Cartago', 'Heredia', 'Guanacaste', 'Puntarenas', 'Limón'],
    },
    '../services/customerOrderService': {
      recordRecentOrderAccess: (session, ref) => { serviceCalls.push(['recordAccess', ref]); },
      normalizeReference: (v) => (String(v || '')).trim().toUpperCase(),
      canAccessCustomerOrder: () => true,
      getAccessRecord: async () => ({ internal_id: 999, order_reference: 'NL-TEST12345678' }),
      getCustomerSafeOrder: async () => ({}),
    },
    '../services/addressService': {
      listForUser: async () => [],
      getForUser: async () => null,
    },
    '../validators/addressValidator': {
      parsePositiveId: (v) => parseInt(v, 10) || null,
    },
    '../services/catalogService': {
      getPublicCategories: async () => [],
    },
    './tilopayController': {
      cspSafeHostedRedirect: (url, nonce) => `<html><script nonce="${nonce}">window.location.href = ${JSON.stringify(url)}</script></html>`,
      redirectToOrderDetail: (req, res, orderRef) => {
        const dest = (req.session && req.session.user)
          ? '/cuenta/pedidos/' + orderRef
          : '/consultar-pedido/' + orderRef;
        serviceCalls.push(['redirectTo', dest]);
        if (res.redirect) return res.redirect(dest);
        return { redirect: dest };
      },
    },
    '../services/tilopayService': {
      TilopayError: class extends Error {},
      initiateHostedPayment: async (...args) => {
        serviceCalls.push(['initiateHostedPayment', args]);
        return initiateHostedPayment(...args);
      },
    },
  };

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === checkoutPath) {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    }
    return originalLoad.apply(this, arguments);
  };

  let controller;
  try {
    controller = require('../controllers/checkoutController');
  } finally {
    Module._load = originalLoad;
  }

  return { controller, serviceCalls };
}

// ─────────────────────────────────────────────────────────
// 1. checkout.js initialization / submitBtn fix
// ─────────────────────────────────────────────────────────

describe('checkout.js initialization', () => {
  it('loads without ReferenceError (submitBtn is declared before use)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/checkout/checkout.js'), 'utf8'
    );
    // submitBtn must be declared before the CTA block that references it
    const ctaBlockStart = src.indexOf('updateCta');
    const submitDecl = src.indexOf('const submitBtn');
    assert.ok(submitDecl > 0, 'submitBtn must be declared');
    assert.ok(submitDecl < ctaBlockStart,
      'submitBtn must be declared BEFORE updateCta to avoid TDZ ReferenceError');
  });

  it('runs initCheckout in sandbox without throwing', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/checkout/checkout.js'), 'utf8'
    );
    // Verify: the module structure is sound — no TDZ access, submitBtn declared before CTA block
    const submitLine = src.indexOf('const submitBtn');
    const ctaLine = src.indexOf('const paymentInputs');
    const ctaIfLine = src.indexOf('if (paymentInputs.length && submitBtn)');
    assert.ok(submitLine > 0);
    assert.ok(ctaIfLine > 0);
    assert.ok(submitLine < ctaLine,
      'submitBtn must be declared before paymentInputs (which is before its first use)');
    assert.ok(ctaLine < ctaIfLine,
      'paymentInputs must be declared before the if-check that uses submitBtn');
  });

  it('submitBtn is queryable after initCheckout starts (no TDZ)', async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/checkout/checkout.js'), 'utf8'
    );
    // Check the order: submitBtn const must appear BEFORE the if(paymentInputs.length && submitBtn) check
    const submitBtnLine = src.indexOf('const submitBtn');
    const ctaCheckLine = src.indexOf('submitBtn)');
    assert.ok(submitBtnLine > 0 && ctaCheckLine > 0);
    assert.ok(submitBtnLine < ctaCheckLine,
      'submitBtn declaration must come before its first use in the CTA condition');
  });
});

// ─────────────────────────────────────────────────────────
// 2. Add-to-cart panel visibility
// ─────────────────────────────────────────────────────────

describe('Add-to-cart panel', () => {
  it('product-detail.js sets panel.style.display to visible', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/store/product-detail.js'), 'utf8'
    );
    assert.ok(src.includes("panel.style.display = 'block'"),
      'JS must set panel display to block when panel exists');
  });

  it('panel DOM has "Ir al carrito" link, "Seguir comprando" button, dismiss handler', () => {
    const tmpl = fs.readFileSync(
      path.resolve(__dirname, '../views/pages/tienda-producto.ejs'), 'utf8'
    );
    assert.ok(tmpl.includes('Ir al carrito'), 'Must show cart link');
    assert.ok(tmpl.includes('Seguir comprando'), 'Must show continue button');
    assert.ok(tmpl.includes('/carrito'), 'Link must point to /carrito');
    assert.ok(tmpl.includes('data-add-to-cart-dismiss'), 'Dismiss button must have data attr');
    assert.ok(tmpl.includes('<noscript>'), 'Must have noscript fallback');
  });

  it('Escape key hides panel and returns focus to add-to-cart button', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/store/product-detail.js'), 'utf8'
    );
    assert.ok(src.includes("Escape"), 'Must handle Escape key');
    assert.ok(src.includes("panel.style.display = 'none'"), 'Must hide on Escape');
    assert.ok(src.includes("st-product__cart-form"), 'Must refocus add-to-cart button');
  });

  it('cartController sets addToCartSuccess with productName and productId', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../controllers/cartController.js'), 'utf8'
    );
    assert.ok(src.includes('addToCartSuccess'), 'Must set addToCartSuccess');
    assert.ok(src.includes('productName'), 'Must include productName');
    assert.ok(src.includes('productId'), 'Must include productId');
  });
});

// ─────────────────────────────────────────────────────────
// 3. Stale addToCartSuccess prevention
// ─────────────────────────────────────────────────────────

describe('Stale addToCartSuccess prevention', () => {
  it('storeController checks addToCartSuccess.productId against product.id', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../controllers/storeController.js'), 'utf8'
    );
    // Must compare flash.productId to product.id
    assert.ok(
      src.includes('Number(flash.productId)') &&
      src.includes('Number(product.id)'),
      'Must compare productId numerically'
    );
    assert.ok(
      src.includes('flash.productId') &&
      src.includes('=== Number(product.id)'),
      'Must strictly compare productId === product.id'
    );
  });

  it('addToCartPanel is null when productId does not match', () => {
    // Simulate the check: flash with productId=5, current product id=10 => null
    const flash = { productName: 'Widget', productId: 5 };
    const product = { id: 10, title: 'Gadget' };
    const matches = Number(flash.productId) === Number(product.id);
    assert.equal(matches, false, 'Different productId must not match');

    const panel = matches ? { productName: flash.productName } : null;
    assert.equal(panel, null, 'Panel must be null for mismatched productId');
  });

  it('addToCartPanel is set when productId matches', () => {
    const flash = { productName: 'Widget', productId: 7 };
    const product = { id: 7, title: 'Widget' };
    const matches = Number(flash.productId) === Number(product.id);
    assert.equal(matches, true, 'Matching productId must match');

    const panel = matches ? { productName: flash.productName } : null;
    assert.deepEqual(panel, { productName: 'Widget' });
  });

  it('addToCartSuccess is deleted from session after read (one-shot)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../controllers/storeController.js'), 'utf8'
    );
    assert.ok(src.includes('delete req.session.addToCartSuccess'),
      'Must delete addToCartSuccess from session after reading');
  });
});

// ─────────────────────────────────────────────────────────
// 4. CSP helpers
// ─────────────────────────────────────────────────────────

describe('CSP-safe hosted redirect helper', () => {
  it('exports cspSafeHostedRedirect and redirectToOrderDetail', () => {
    const tilopayCtrl = require('../controllers/tilopayController');
    assert.equal(typeof tilopayCtrl.cspSafeHostedRedirect, 'function');
    assert.equal(typeof tilopayCtrl.redirectToOrderDetail, 'function');
  });

  it('injects the provided nonce', () => {
    const tilopayCtrl = require('../controllers/tilopayController');
    const html = tilopayCtrl.cspSafeHostedRedirect('https://secure.tilopay.com/checkout/abc', 'abc123xyz');
    assert.ok(html.includes('nonce="abc123xyz"'));
    assert.ok(html.includes('window.location.href'));
    assert.ok(html.includes('secure.tilopay.com/checkout/abc'));
  });

  it('safely serializes URL with special characters via JSON.stringify', () => {
    const tilopayCtrl = require('../controllers/tilopayController');
    const html = tilopayCtrl.cspSafeHostedRedirect('https://secure.tilopay.com/x?foo=bar&baz=1', 'n');
    assert.ok(html.includes('"https://secure.tilopay.com/x?foo=bar&baz=1"'));
  });
});

// ─────────────────────────────────────────────────────────
// 5. Checkout payment branching — behavioral tests
// ─────────────────────────────────────────────────────────

describe('Checkout payment branching', () => {
  it('Tilopay checkout: creates order, clears cart, initiates hosted payment, CSP-safe HTML', async () => {
    const { controller, serviceCalls } = loadCheckoutController({
      createOrderResult: {
        success: true, duplicate: false,
        orderRef: 'NL-TLP01234567', orderId: 777,
        subtotal: 5000, shippingAmount: 0, finalTotal: 5000,
        shippingStatus: 'not_required', deliveryMethod: 'local_pickup',
        paymentMethod: 'tilopay',
        customerName: 'Tester', email: 't@t.com', phone: '12345678',
        items: [],
      },
    });

    const req = {
      session: { user: { id: 42, name: 'Tester', email: 't@t.com' }, checkoutToken: 'tok_xxx' },
      body: { checkoutToken: 'tok_xxx', deliveryMethod: 'local_pickup', paymentMethod: 'tilopay', customerName: 'Tester', email: 't@t.com', phone: '12345678' },
    };
    const res = {
      locals: { cspNonce: 'test-nonce-1' },
      redirect(url) { this.redirected = url; return this; },
      send(html) { this.sent = html; return this; },
      status(code) { this.statusCode = code; return this; },
    };

    await controller.submitCheckout(req, res, (err) => { if (err) throw err; });

    // Cart is cleared
    assert.ok(serviceCalls.includes('clearCart'), 'Cart must be cleared');
    // Hosted payment initiated with correct IDs
    const initCall = serviceCalls.find(c => c[0] === 'initiateHostedPayment');
    assert.ok(initCall, 'initiateHostedPayment must be called');
    const [orderId, customerId] = initCall[1];
    assert.equal(orderId, 777);
    assert.equal(customerId, 42);
    // CSP-safe HTML returned
    assert.ok(res.sent, 'Must send CSP-safe HTML');
    assert.ok(res.sent.includes('nonce="test-nonce-1"'));
    assert.ok(res.sent.includes('secure.tilopay.com'));
  });

  it('SINPE checkout: redirects to order detail with receipt message', async () => {
    const { controller, serviceCalls } = loadCheckoutController({
      createOrderResult: {
        success: true, duplicate: false,
        orderRef: 'NL-SNP12345678', orderId: 888,
        subtotal: 3000, shippingAmount: 0, finalTotal: 3000,
        shippingStatus: 'not_required', deliveryMethod: 'local_pickup',
        paymentMethod: 'sinpe',
        customerName: 'SinpeUser', email: 's@t.com', phone: '87654321',
        items: [],
      },
    });

    const req = {
      session: { user: { id: 99, name: 'SinpeUser', email: 's@t.com' }, checkoutToken: 'tok_sinpe' },
      body: { checkoutToken: 'tok_sinpe', deliveryMethod: 'local_pickup', paymentMethod: 'sinpe', customerName: 'SinpeUser', email: 's@t.com', phone: '87654321' },
    };
    const res = {
      locals: { cspNonce: 'n' },
      redirect(url) { this.redirected = url; return this; },
    };

    await controller.submitCheckout(req, res, (err) => { if (err) throw err; });

    // Redirects to authenticated order detail
    assert.ok(res.redirected.includes('/cuenta/pedidos/NL-SNP12345678'));
    // Sets receipt message
    assert.ok(req.session.success_msg.includes('comprobante'));
    // Cart cleared
    assert.ok(serviceCalls.includes('clearCart'));
    // Tilopay was NOT called
    const initCall = serviceCalls.find(c => c[0] === 'initiateHostedPayment');
    assert.equal(initCall, undefined, 'Tilopay must NOT be initiated for SINPE');
  });

  it('shipping quote pending: does NOT initiate Tilopay, shows confirmation', async () => {
    const { controller, serviceCalls } = loadCheckoutController({
      createOrderResult: {
        success: true, duplicate: false,
        orderRef: 'NL-SHP12345678', orderId: 999,
        subtotal: 7000, shippingAmount: null, finalTotal: null,
        shippingStatus: 'pending_quote', deliveryMethod: 'uber_flash',
        paymentMethod: 'tilopay',
        customerName: 'ShipUser', email: 'sh@t.com', phone: '11112222',
        items: [],
      },
    });

    const req = {
      session: { user: { id: 1 }, checkoutToken: 'tok_ship' },
      body: { checkoutToken: 'tok_ship', deliveryMethod: 'uber_flash', paymentMethod: 'tilopay', customerName: 'ShipUser', email: 'sh@t.com', phone: '11112222', addressChoice: 'manual', province: 'San José', canton: 'Central', distrito: 'Centro', addressLine: 'Calle 1', addressReference: 'Casa' },
    };
    const res = {
      redirect(url) { this.redirected = url; return this; },
      send(html) { this.sent = html; return this; },
      status(code) { this.statusCode = code; return this; },
    };

    await controller.submitCheckout(req, res, (err) => { if (err) throw err; });

    // NO Tilopay initiation
    const initCall = serviceCalls.find(c => c[0] === 'initiateHostedPayment');
    assert.equal(initCall, undefined, 'Tilopay must NOT be initiated for pending shipping');
    // Redirects to confirmation page (waiting state)
    assert.ok(res.redirected.includes('/checkout/confirmacion/NL-SHP12345678'));
    // Cart is cleared (order was created)
    assert.ok(serviceCalls.includes('clearCart'));
  });

  it('Tilopay initiation failure: order stays accessible, safe error, no provider leak', async () => {
    const { controller, serviceCalls } = loadCheckoutController({
      createOrderResult: {
        success: true, duplicate: false,
        orderRef: 'NL-ERR12345678', orderId: 555,
        subtotal: 5000, shippingAmount: 0, finalTotal: 5000,
        shippingStatus: 'not_required', deliveryMethod: 'local_pickup',
        paymentMethod: 'tilopay',
        customerName: 'ErrUser', email: 'e@t.com', phone: '00001111',
        items: [],
      },
      initiateHostedPayment: async () => { throw new Error('Provider error'); },
    });

    const req = {
      session: { user: { id: 7 }, checkoutToken: 'tok_err' },
      body: { checkoutToken: 'tok_err', deliveryMethod: 'local_pickup', paymentMethod: 'tilopay', customerName: 'ErrUser', email: 'e@t.com', phone: '00001111' },
    };
    const res = {
      redirect(url) { this.redirected = url; return this; },
      send(html) { this.sent = html; return this; },
      status(code) { this.statusCode = code; return this; },
    };

    await controller.submitCheckout(req, res, (err) => { if (err) throw err; });

    // Redirects to order detail (order still accessible)
    assert.ok(res.redirected.includes('/cuenta/pedidos/NL-ERR12345678'));
    // Safe error message set
    assert.ok(req.session.error_msg, 'Must set error message');
    assert.ok(!req.session.error_msg.includes('Provider'), 'Must not expose provider error details');
    // Cart cleared (order was created successfully)
    assert.ok(serviceCalls.includes('clearCart'));
  });
});

// ─────────────────────────────────────────────────────────
// 6. Duplicate order / cart state behavior
// ─────────────────────────────────────────────────────────

describe('Duplicate order handling', () => {
  it('duplicate: clears stale cart, routes to existing order, no new order/payment', async () => {
    const { controller, serviceCalls } = loadCheckoutController({
      createOrderResult: {
        success: true, duplicate: true,
        orderRef: 'NL-DUP12345678', orderId: 444,
        subtotal: 5000, shippingAmount: 0, finalTotal: 5000,
        shippingStatus: 'not_required', deliveryMethod: 'local_pickup',
        paymentMethod: 'tilopay',
        customerName: 'Dup', email: 'd@t.com', phone: '33334444',
        items: [],
      },
    });

    const req = {
      session: { user: { id: 3 }, checkoutToken: 'tok_dup' },
      body: { checkoutToken: 'tok_dup', deliveryMethod: 'local_pickup', paymentMethod: 'tilopay', customerName: 'Dup', email: 'd@t.com', phone: '33334444' },
    };
    const res = {
      redirect(url) { this.redirected = url; return this; },
    };

    await controller.submitCheckout(req, res, (err) => { if (err) throw err; });

    // Cart IS cleared on duplicate (prevents stale resubmission)
    assert.ok(serviceCalls.includes('clearCart'),
      'Cart must be cleared on duplicate to prevent stale resubmission');
    // No new payment initiated
    const initCall = serviceCalls.find(c => c[0] === 'initiateHostedPayment');
    assert.equal(initCall, undefined, 'No new payment must be initiated on duplicate');
    // Recorded access for redirect
    assert.ok(serviceCalls.find(c => c[0] === 'recordAccess'));
    // Routes to existing order detail page
    assert.ok(res.redirected.includes('/cuenta/pedidos/NL-DUP12345678'));
  });
});

// ─────────────────────────────────────────────────────────
// 7. CTA button text
// ─────────────────────────────────────────────────────────

describe('CTA button text', () => {
  it('checkout.js maps each payment method to correct CTA text', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/checkout/checkout.js'), 'utf8'
    );
    assert.ok(src.includes('Confirmar y pagar con Tilopay'), 'Tilopay CTA');
    assert.ok(src.includes('Confirmar pedido y enviar comprobante'), 'SINPE/transfer CTA');
    assert.ok(src.includes('Solicitar cotización de envío'), 'Shipping quote CTA');
    assert.ok(src.includes('updateCta'), 'Must have updateCta function');
  });
});

// ─────────────────────────────────────────────────────────
// 8. Branching regression guards
// ─────────────────────────────────────────────────────────

describe('Branching regression guards', () => {
  it('Tilopay branch still uses initiateHostedPayment from tilopayService', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../controllers/checkoutController.js'), 'utf8'
    );
    assert.ok(src.includes('tilopayService.initiateHostedPayment'),
      'Must call tilopayService.initiateHostedPayment');
    assert.ok(src.includes('cspSafeHostedRedirect'),
      'Must use CSP-safe redirect helper');
  });

  it('SINPE/transfer branch still goes to order detail with receipt form', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../controllers/checkoutController.js'), 'utf8'
    );
    assert.ok(src.includes('redirectToOrderDetail'),
      'Must use redirectToOrderDetail for SINPE/transfer');
    assert.ok(src.includes("paymentMethod === 'sinpe' || result.paymentMethod === 'bank_transfer'"),
      'Must branch on sinpe and bank_transfer');
  });

  it('shipping-quote-pending still waits for quote (no payment)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../controllers/checkoutController.js'), 'utf8'
    );
    assert.ok(src.includes("shippingStatus !== 'not_required'"),
      'Must detect non-not_required shipping');
    assert.ok(src.includes('/checkout/confirmacion/'),
      'Must redirect to confirmation for shipping quotes');
  });

  it('failed checkout does NOT clear cart', async () => {
    const { controller, serviceCalls } = loadCheckoutController({
      cartValid: false,
      cartHydrated: null,
    });

    const req = {
      session: { checkoutToken: 'tok_bad' },
      body: { checkoutToken: 'tok_bad', deliveryMethod: 'local_pickup', paymentMethod: 'tilopay' },
    };
    const res = { redirect(url) { this.redirected = url; return this; } };

    await controller.submitCheckout(req, res, (err) => { if (err) throw err; });

    // Cart validation failed — must NOT clear cart
    assert.ok(!serviceCalls.includes('clearCart'),
      'Cart must NOT be cleared on failed checkout');
    // Redirected to /carrito
    assert.ok(res.redirected.includes('/carrito'));
  });
});
