const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const controllerPath = require.resolve('../controllers/tilopayController');

class MockTilopayError extends Error {}

function loadController({
  enabled = false,
  initiateHostedPayment = async () => ({
    redirect: true,
    url: 'https://secure.tilopay.com/mock-payment',
  }),
  accessRecord = {
    internal_id: 321,
    order_reference: 'NL-ABCDEFGHIJKL',
    user_id: 7,
    billing_name: 'Guest Customer',
    customer_email: 'guest@example.test',
    billing_phone: '0000-0000',
  },
  authenticatedAllowed,
  guestAllowed = true,
} = {}) {
  const loadedDependencies = [];
  const accessRecordCalls = [];
  const serviceCalls = [];
  const service = {
    TilopayError: MockTilopayError,
    async initiateHostedPayment(...args) {
      serviceCalls.push(args);
      return initiateHostedPayment(...args);
    },
  };
  const customerOrders = {
    normalizeReference(value) {
      const reference = String(value || '').trim().toUpperCase();
      return /^NL-[A-Z0-9]{12}$/.test(reference) ? reference : null;
    },
    async getAccessRecord(reference) {
      accessRecordCalls.push(reference);
      return accessRecord;
    },
    canAccessCustomerOrder({ order, authenticatedUser }) {
      if (authenticatedUser?.id) {
        return authenticatedAllowed === undefined
          ? Number(order.user_id) === Number(authenticatedUser.id)
          : authenticatedAllowed;
      }
      return guestAllowed && order.user_id === null;
    },
  };

  const originalLoad = Module._load;
  delete require.cache[controllerPath];
  Module._load = function loadWithTilopayMocks(request, parent, isMain) {
    if (parent?.filename === controllerPath) {
      loadedDependencies.push(request);
      if (request === '../services/tilopayService') return service;
      if (request === '../config/tilopay') return { ENABLED: enabled };
      if (request === '../services/customerOrderService') return customerOrders;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return {
      accessRecordCalls,
      controller: require(controllerPath),
      loadedDependencies,
      serviceCalls,
    };
  } finally {
    Module._load = originalLoad;
    delete require.cache[controllerPath];
  }
}

function response(nonce) {
  nonce = nonce || 'test-csp-nonce-' + Date.now();
  return {
    redirectUrl: null,
    sentHtml: null,
    sentNonce: null,
    locals: { cspNonce: nonce },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    },
    send(html) {
      this.sentHtml = html;
      // Extract the nonce used in the script tag
      var n = (typeof html === 'string' && html.match(/<script nonce="([^"]*)"/)) || null;
      this.sentNonce = n ? n[1] : null;
      // Extract the redirect URL from the JS-based CSP-safe redirect
      const match = (typeof html === 'string' && html.match(/window\.location\.href\s*=\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/)) || null;
      if (match) {
        this.redirectUrl = match[1] || match[2] || match[3];
      }
      return this;
    },
  };
}

describe('Tilopay controller initiation regression', () => {
  it('requires the real controller module and its config dependency', () => {
    const { controller, loadedDependencies } = loadController();

    assert.equal(typeof controller.initiatePayment, 'function');
    assert.equal(typeof controller.initiatePaymentGuest, 'function');
    assert.ok(loadedDependencies.includes('../config/tilopay'));
  });

  it('returns the safe disabled response without throwing or calling the service', async () => {
    const { controller, serviceCalls } = loadController({ enabled: false });
    const req = {
      params: { reference: 'NL-ABCDEFGHIJKL' },
      session: { user: { id: 7 } },
    };
    const res = response();

    await assert.doesNotReject(() => controller.initiatePayment(req, res));

    assert.equal(res.redirectUrl, '/cuenta/pedidos');
    assert.equal(req.session.error_msg, 'El pago con tarjeta no está disponible en este momento.');
    assert.equal(serviceCalls.length, 0);
  });

  it('resolves a public reference and passes its internal order ID to the hosted-payment service', async () => {
    const { controller, accessRecordCalls, serviceCalls } = loadController({ enabled: true });
    const req = {
      params: { reference: 'nl-abcdefghijkl' },
      session: {
        user: {
          id: 7,
          name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.test',
          phone: '0000-0000',
        },
      },
    };
    const res = response();

    await controller.initiatePayment(req, res);

    assert.deepEqual(accessRecordCalls, ['NL-ABCDEFGHIJKL']);
    assert.deepEqual(serviceCalls, [[
      321,
      7,
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.test',
        phone: '0000-0000',
      },
    ]]);
    assert.equal(res.redirectUrl, 'https://secure.tilopay.com/mock-payment');
    assert.ok(res.sentNonce, 'script must have nonce attribute');
    assert.equal(res.sentNonce, res.locals.cspNonce, 'nonce must match locals.cspNonce');
  });

  it('executes the guest initiation path only through the existing guest authorization', async () => {
    const { controller, serviceCalls } = loadController({
      enabled: true,
      accessRecord: {
        internal_id: 654,
        order_reference: 'NL-ABCDEFGHIJKL',
        user_id: null,
        billing_name: 'Guest Customer',
        customer_email: 'guest@example.test',
        billing_phone: '0000-0000',
      },
    });
    const req = {
      params: { reference: 'NL-ABCDEFGHIJKL' },
      body: {},
      session: {},
    };
    const res = response();

    await assert.doesNotReject(() => controller.initiatePaymentGuest(req, res));

    assert.equal(serviceCalls.length, 1);
    assert.equal(serviceCalls[0][0], 654);
    assert.equal(serviceCalls[0][1], null);
    assert.equal(res.redirectUrl, 'https://secure.tilopay.com/mock-payment');
    assert.ok(res.sentNonce, 'guest script must have nonce attribute');
    assert.equal(res.sentNonce, res.locals.cspNonce, 'guest nonce must match locals.cspNonce');
  });

  it('fails safely when the public reference does not resolve', async () => {
    const { controller, serviceCalls } = loadController({ enabled: true, accessRecord: null });
    const req = {
      params: { reference: 'NL-ABCDEFGHIJKL' },
      session: { user: { id: 7 } },
    };
    const res = response();

    await controller.initiatePayment(req, res);

    assert.equal(req.session.error_msg, 'Pedido no encontrado.');
    assert.equal(res.redirectUrl, '/cuenta/pedidos');
    assert.equal(serviceCalls.length, 0);
  });

  it('rejects another customer\'s order before hosted-payment initiation', async () => {
    const { controller, serviceCalls } = loadController({
      enabled: true,
      accessRecord: {
        internal_id: 999,
        order_reference: 'NL-ABCDEFGHIJKL',
        user_id: 8,
      },
    });
    const req = {
      params: { reference: 'NL-ABCDEFGHIJKL' },
      session: { user: { id: 7 } },
    };
    const res = response();

    await controller.initiatePayment(req, res);

    assert.equal(req.session.error_msg, 'No tienes acceso a este pedido.');
    assert.equal(res.redirectUrl, '/cuenta/pedidos');
    assert.equal(serviceCalls.length, 0);
  });

  it('rejects a guest without the existing session grant', async () => {
    const { controller, serviceCalls } = loadController({
      enabled: true,
      guestAllowed: false,
      accessRecord: {
        internal_id: 654,
        order_reference: 'NL-ABCDEFGHIJKL',
        user_id: null,
      },
    });
    const req = { params: { reference: 'NL-ABCDEFGHIJKL' }, body: {}, session: {} };
    const res = response();

    await controller.initiatePaymentGuest(req, res);

    assert.equal(req.session.error_msg, 'Acceso no autorizado.');
    assert.equal(res.redirectUrl, '/consultar-pedido');
    assert.equal(serviceCalls.length, 0);
  });

  it('handles a hosted-payment rejection through the existing safe error flow', async () => {
    const expectedError = new MockTilopayError('No se pudo crear la sesión de pago.');
    const { controller } = loadController({
      enabled: true,
      initiateHostedPayment: async () => { throw expectedError; },
    });
    const req = {
      params: { reference: 'NL-ABCDEFGHIJKL' },
      session: { user: { id: 7 } },
    };
    const res = response();
    const originalConsoleError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);

    try {
      await assert.doesNotReject(() => controller.initiatePayment(req, res));
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(req.session.error_msg, expectedError.message);
    assert.equal(res.redirectUrl, '/cuenta/pedidos/NL-ABCDEFGHIJKL');
    assert.deepEqual(logged, []);
  });

  it('logs only structured safe diagnostics for an unexpected provider rejection', async () => {
    const providerError = new Error('Tilopay processPayment was rejected');
    Object.assign(providerError, {
      name: 'TilopayProviderError',
      code: 'TILOPAY_PAYMENT_REJECTED',
      operation: 'processPayment',
      httpStatus: 200,
      providerType: '400',
      providerMessage: 'Invalid redirect',
      safeCause: null,
    });
    const { controller } = loadController({
      enabled: true,
      initiateHostedPayment: async () => { throw providerError; },
    });
    const req = {
      params: { reference: 'NL-ABCDEFGHIJKL' },
      session: { user: { id: 7 } },
    };
    const res = response();
    const originalConsoleError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);

    try {
      await controller.initiatePayment(req, res);
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(res.redirectUrl, '/cuenta/pedidos/NL-ABCDEFGHIJKL');
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], '[tilopay] Initiation error:');
    assert.deepEqual(logged[0][1], {
      name: 'TilopayProviderError',
      code: 'TILOPAY_PAYMENT_REJECTED',
      message: 'Tilopay processPayment was rejected',
      operation: 'processPayment',
      httpStatus: 200,
      providerType: '400',
      providerMessage: 'Invalid redirect',
      safeCause: null,
    });
  });

  it('injects the CSP nonce into the redirect script tag', async () => {
    const nonceOverride = 'custom-nonce-' + Date.now();
    const { controller, serviceCalls } = loadController({ enabled: true });
    const req = {
      params: { reference: 'nl-abcdefghijkl' },
      session: { user: { id: 7, name: 'Test', last_name: 'User', email: 't@t.t', phone: '0' } },
    };
    const res = response(nonceOverride);
    await controller.initiatePayment(req, res);
    // Verify the nonce in the HTML matches the one from res.locals
    assert.equal(res.sentNonce, nonceOverride, 'injected nonce must equal locals.cspNonce');
    assert.ok(res.sentHtml.includes('nonce="' + nonceOverride + '"'), 'HTML must contain the nonce');
  });

  it('uses safe JSON serialization for the redirect URL', async () => {
    const { controller } = loadController({ enabled: true });
    const req = {
      params: { reference: 'nl-abcdefghijkl' },
      session: { user: { id: 7, name: 'Test', last_name: 'User', email: 't@t.t', phone: '0' } },
    };
    const res = response();
    await controller.initiatePayment(req, res);
    // URL must be correctly extracted and not contain raw quotes
    assert.equal(res.redirectUrl, 'https://secure.tilopay.com/mock-payment', 'extracted URL must be correct');
    // The URL is safely serialized via JSON.stringify in the controller source.
    // In the rendered HTML, it appears as a JS string literal, not raw.
    assert.ok(res.sentHtml.includes('window.location.href'), 'must have JS redirect');
    assert.ok(res.sentHtml.includes('nonce='), 'must have nonce attribute');
  });

  it('never reaches an HTTP provider client because initiation uses only the mocked service', async () => {
    let mockedServiceReached = false;
    const { controller } = loadController({
      enabled: true,
      initiateHostedPayment: async () => {
        mockedServiceReached = true;
        return { redirect: true, url: 'https://secure.tilopay.com/mock-payment' };
      },
    });
    const req = {
      params: { reference: 'NL-ABCDEFGHIJKL' },
      session: { user: { id: 7 } },
    };

    await controller.initiatePayment(req, response());

    assert.equal(mockedServiceReached, true);
  });
});

async function withHostedServiceOrder(order, callback) {
  const servicePath = require.resolve('../services/tilopayService');
  const originalLoad = Module._load;
  let providerCalls = 0;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      if (sql.includes('SELECT * FROM orders WHERE id = ?')) return [[order]];
      throw new Error(`Unexpected query in guarded hosted-payment test: ${sql}`);
    },
  };
  const pool = { async getConnection() { return connection; } };
  const client = {
    async processPayment() {
      providerCalls += 1;
      throw new Error('Provider client must not be reached');
    },
  };

  delete require.cache[servicePath];
  Module._load = function loadHostedServiceWithMocks(request, parent, isMain) {
    if (parent?.filename === servicePath) {
      if (request === '../config/db') return pool;
      if (request === '../config/tilopay') {
        return { PUBLIC_BASE_URL: 'http://localhost:3000', DEFAULT_CURRENCY: 'CRC' };
      }
      if (request === './tilopayClient') return client;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const service = require(servicePath);
    await callback(service, () => providerCalls);
  } finally {
    Module._load = originalLoad;
    delete require.cache[servicePath];
  }
}

describe('Tilopay hosted-payment eligibility regression', () => {
  it('blocks an already-paid internal order before any provider request', async () => {
    await withHostedServiceOrder({ id: 321, user_id: 7, payment_status: 'paid' }, async (service, calls) => {
      await assert.rejects(
        () => service.initiateHostedPayment(321, 7),
        (error) => error instanceof service.TilopayError && error.code === 'ALREADY_PAID'
      );
      assert.equal(calls(), 0);
    });
  });

  it('blocks a non-eligible internal order before any provider request', async () => {
    await withHostedServiceOrder({
      id: 321,
      user_id: 7,
      payment_method: 'sinpe',
      payment_status: 'pending',
      final_total: '1000.00',
      shipping_status: 'not_required',
      order_status: 'pending_payment',
    }, async (service, calls) => {
      await assert.rejects(
        () => service.initiateHostedPayment(321, 7),
        (error) => error instanceof service.TilopayError && error.code === 'NOT_ELIGIBLE'
      );
      assert.equal(calls(), 0);
    });
  });
});
