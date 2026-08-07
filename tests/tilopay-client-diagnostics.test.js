const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const clientPath = require.resolve('../services/tilopayClient');
const originalFetch = global.fetch;

function loadClient(fetchImpl) {
  const originalLoad = Module._load;
  delete require.cache[clientPath];
  global.fetch = fetchImpl;
  Module._load = function loadWithSafeConfig(request, parent, isMain) {
    if (parent?.filename === clientPath && request === '../config/tilopay') {
      return {
        API_BASE_URL: 'https://app.tilopay.com',
        LOGIN_PATH: '/api/v1/login',
        PROCESS_PAYMENT_PATH: '/api/v1/processPayment',
        CONSULT_PATH: '/api/v1/consult',
        API_KEY: 'test-key',
        API_USER: 'test-user',
        API_PASSWORD: 'test-password',
        REQUEST_TIMEOUT_MS: 1000,
        MOCK_MODE: false,
        ENV: 'sandbox',
        isAllowedHostedCheckoutHost(hostname, environment) {
          const allowed = environment === 'production'
            ? ['secure.tilopay.com']
            : ['secure.tilopay.com', 'securepayment.tilopay.com'];
          return allowed.includes(String(hostname).toLowerCase());
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(clientPath);
  } finally {
    Module._load = originalLoad;
  }
}

afterEach(() => {
  global.fetch = originalFetch;
  delete require.cache[clientPath];
});

describe('Tilopay provider diagnostics regression', () => {
  it('preserves safe login HTTP diagnostics without exposing credentials', async () => {
    let calls = 0;
    const client = loadClient(async () => {
      calls += 1;
      return {
        ok: false,
        status: 401,
        async json() { return { type: '401', message: 'Invalid credentials' }; },
      };
    });

    await assert.rejects(
      () => client.getAccessToken(),
      (error) => {
        assert.equal(error.name, 'TilopayProviderError');
        assert.equal(error.code, 'TILOPAY_LOGIN_REJECTED');
        assert.equal(error.operation, 'login');
        assert.equal(error.httpStatus, 401);
        assert.equal(error.providerType, '401');
        assert.equal(error.providerMessage, 'Invalid credentials');
        assert.ok(!error.message.includes('test-user'));
        assert.ok(!error.message.includes('test-password'));
        return true;
      }
    );
    assert.equal(calls, 1);
  });

  it('executes the documented login/processPayment contract with mocks and preserves provider rejection details', async () => {
    const calls = [];
    const client = loadClient(async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/v1/login')) {
        return {
          ok: true,
          status: 200,
          async json() { return { access_token: 'mock-token', token_type: 'bearer', expires_in: 3600 }; },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() { return { type: '400', message: 'Invalid redirect' }; },
      };
    });

    await assert.rejects(
      () => client.processPayment({
        redirect: 'http://localhost:3000/pagos/tilopay/retorno?ref=opaque-reference',
        amount: '2000.00', currency: 'CRC', orderNumber: 'NL10914TEST',
        billToFirstName: 'Test', billToLastName: 'Customer',
        billToAddress: 'San Jose', billToAddress2: '', billToCity: 'San Jose',
        billToState: 'SJ', billToZipPostCode: '10101', billToCountry: 'CR',
        billToTelephone: '00000000', billToEmail: 'customer@example.test',
        shipToFirstName: 'Test', shipToLastName: 'Customer', shipToAddress: 'San Jose',
        shipToAddress2: '', shipToCity: 'San Jose', shipToState: 'SJ',
        shipToZipPostCode: '10101', shipToCountry: 'CR', shipToTelephone: '00000000',
        subscription: '0', returnData: 'opaque-return-data',
      }),
      (error) => {
        assert.equal(error.name, 'TilopayProviderError');
        assert.equal(error.code, 'TILOPAY_PAYMENT_REJECTED');
        assert.equal(error.operation, 'processPayment');
        assert.equal(error.httpStatus, 200);
        assert.equal(error.providerType, '400');
        assert.equal(error.providerMessage, 'Invalid redirect');
        return true;
      }
    );

    assert.equal(calls.length, 2, 'only mocked login and processPayment calls are made');
    assert.equal(calls[0].url, 'https://app.tilopay.com/api/v1/login');
    assert.equal(calls[1].url, 'https://app.tilopay.com/api/v1/processPayment');
    const body = JSON.parse(calls[1].options.body);
    assert.equal(typeof body.redirect, 'string');
    assert.equal(typeof body.key, 'string');
    assert.equal(typeof body.amount, 'string');
    assert.equal(typeof body.currency, 'string');
    assert.equal(typeof body.orderNumber, 'string');
    assert.equal(body.capture, '1');
    assert.equal(body.subscription, '0');
    assert.equal(body.platform, 'api');
    assert.equal(body.hashVersion, 'V2');
    assert.equal(body.token_version, 'v2');
  });

  it('accepts the exact alternate hosted hostname returned by the sandbox', async () => {
    let calls = 0;
    const client = loadClient(async (url) => {
      calls += 1;
      if (url.endsWith('/api/v1/login')) {
        return {
          ok: true,
          status: 200,
          async json() { return { access_token: 'mock-token', token_type: 'bearer', expires_in: 3600 }; },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() { return { type: '100', url: 'https://securepayment.tilopay.com/mock-session' }; },
      };
    });

    const result = await client.processPayment({
      redirect: 'http://localhost:3000/pagos/tilopay/retorno?ref=opaque-reference',
      amount: '2000.00', currency: 'CRC', orderNumber: 'NL10914TEST',
      returnData: 'opaque-return-data',
    });

    assert.deepEqual(result, {
      type: '100',
      url: 'https://securepayment.tilopay.com/mock-session',
    });
    assert.equal(calls, 2);
  });
});
