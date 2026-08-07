/**
 * Tilopay HTTP client adapter — official hosted-payment API calls.
 *
 * ARCHITECTURE (Postman Collection — _local/tilopay-official.postman_collection.json):
 *   1. POST /api/v1/login           → { access_token, token_type, expires_in }
 *   2. POST /api/v1/processPayment  → { type: "100", url: validated hosted checkout URL }
 *   3. Redirect customer to hosted URL → Tilopay handles card capture
 *   4. POST /api/v1/consult         → { type: "200", response: [{ id_tilopay, ... }] }
 */

const tilopayConfig = require('../config/tilopay');
const crypto = require('crypto');

const {
  API_BASE_URL, LOGIN_PATH, PROCESS_PAYMENT_PATH, CONSULT_PATH,
  API_KEY, API_USER, API_PASSWORD, REQUEST_TIMEOUT_MS, MOCK_MODE
} = tilopayConfig;

class TilopayProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TilopayProviderError';
    this.code = details.code || 'TILOPAY_PROVIDER_ERROR';
    this.operation = details.operation || null;
    this.httpStatus = Number.isInteger(details.httpStatus) ? details.httpStatus : null;
    this.providerType = details.providerType === undefined || details.providerType === null
      ? null
      : String(details.providerType).slice(0, 30);
    this.providerMessage = details.providerMessage
      ? String(details.providerMessage).replace(/[\r\n\t]+/g, ' ').slice(0, 200)
      : null;
    this.safeCause = details.cause?.code || details.cause?.name || null;
  }
}

function providerError(message, details) {
  return new TilopayProviderError(message, details);
}

function validateHostedCheckoutUrl(hostedUrl, options = {}) {
  const details = {
    operation: 'processPayment',
    code: 'TILOPAY_INVALID_URL',
    httpStatus: options.httpStatus,
    providerType: options.providerType,
  };
  let parsed;
  try {
    parsed = new URL(hostedUrl);
  } catch {
    throw providerError('Tilopay processPayment returned invalid URL', details);
  }
  if (parsed.protocol !== 'https:') {
    throw providerError('Tilopay processPayment returned non-HTTPS URL', details);
  }
  const environment = options.environment || tilopayConfig.ENV;
  if (!tilopayConfig.isAllowedHostedCheckoutHost(parsed.hostname, environment)) {
    throw providerError(`Tilopay processPayment returned unexpected host: ${parsed.hostname}`, details);
  }
  if (parsed.port && parsed.port !== '443') {
    throw providerError(`Tilopay processPayment returned unexpected port: ${parsed.port}`, details);
  }
  if (parsed.username || parsed.password) {
    throw providerError('Tilopay processPayment returned URL with embedded credentials', details);
  }
  return parsed;
}

// ── Internal helpers ──

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Token cache ──

let _cachedToken = null;
let _loginPromise = null;

function clearTokenCache() { _cachedToken = null; }

function isTokenExpired() {
  if (!_cachedToken) return true;
  return Date.now() >= (_cachedToken.expires_at_ms || 0);
}

async function getAccessToken() {
  if (_cachedToken && !isTokenExpired()) return _cachedToken.access_token;
  if (_loginPromise) return _loginPromise;
  _loginPromise = (async () => {
    try {
      const result = await _login();
      _cachedToken = {
        access_token: result.access_token,
        token_type: result.token_type || 'Bearer',
        expires_at_ms: Date.now() + (result.expires_ms || 84000000),
      };
      return _cachedToken.access_token;
    } catch (e) {
      clearTokenCache();
      throw e;
    } finally {
      _loginPromise = null;
    }
  })();
  return _loginPromise;
}

async function _login() {
  const url = `${API_BASE_URL}${LOGIN_PATH}`;
  if (!API_USER || !API_PASSWORD) {
    throw providerError('Tilopay login failed: authentication credentials not configured', {
      operation: 'login', code: 'TILOPAY_CONFIG_ERROR',
    });
  }
  const body = JSON.stringify({ apiuser: API_USER, password: API_PASSWORD });
  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body,
    });
  } catch (e) {
    throw providerError('Tilopay login network error', {
      operation: 'login', code: 'TILOPAY_NETWORK_ERROR', cause: e,
    });
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw providerError(`Tilopay login returned non-JSON: HTTP ${response.status}`, {
      operation: 'login', code: 'TILOPAY_NON_JSON', httpStatus: response.status,
    });
  }
  if (!response.ok) {
    const msg = data.error || data.message || 'Provider rejected login';
    throw providerError(`Tilopay login failed: HTTP ${response.status}`, {
      operation: 'login', code: 'TILOPAY_LOGIN_REJECTED', httpStatus: response.status,
      providerType: data.type, providerMessage: msg,
    });
  }
  const accessToken = data.access_token;
  if (!accessToken || typeof accessToken !== 'string' || accessToken.length === 0) {
    throw providerError('Tilopay login returned empty access_token', {
      operation: 'login', code: 'TILOPAY_INVALID_RESPONSE', httpStatus: response.status,
      providerType: data.type, providerMessage: data.message,
    });
  }
  const expiresIn = parseInt(data.expires_in, 10);
  if (!expiresIn || expiresIn <= 0) {
    throw providerError('Tilopay login returned invalid expires_in', {
      operation: 'login', code: 'TILOPAY_INVALID_RESPONSE', httpStatus: response.status,
      providerType: data.type, providerMessage: data.message,
    });
  }
  return { access_token: accessToken, token_type: data.token_type || 'bearer', expires_ms: expiresIn * 1000 };
}

// ── Official: Process Payment ──

/**
 * Create a hosted payment session via POST /api/v1/processPayment.
 *
 * Official contract (Postman collection):
 *   Request:  POST https://app.tilopay.com/api/v1/processPayment
 *   Headers:  Authorization: bearer <token>, Content-Type: application/json
 *   Body:     { redirect, key, amount, currency, orderNumber, capture,
 *               billToFirstName, billToLastName, billToAddress, billToAddress2,
 *               billToCity, billToState, billToZipPostCode, billToCountry,
 *               billToTelephone, billToEmail,
 *               shipToFirstName, shipToLastName, shipToAddress, shipToAddress2,
 *               shipToCity, shipToState, shipToZipPostCode, shipToCountry,
 *               shipToTelephone, subscription, platform, returnData,
 *               hashVersion, token_version }
 *   Response: { type: "100", url: "https://secure.tilopay.com/..." }
 *   Errors:   { type: "300"|"400"|"402"|"403", message: "..." }
 *
 * @param {object} params — server-authoritative payment data
 * @returns {{ type, url }} — on success (type "100")
 * @throws for provider errors
 */
async function processPayment(params) {
  if (MOCK_MODE) return _mockProcessPayment(params);

  const token = await getAccessToken();
  const url = `${API_BASE_URL}${PROCESS_PAYMENT_PATH}`;

  const body = {
    redirect: params.redirect,
    key: API_KEY,
    amount: params.amount,
    currency: params.currency,
    orderNumber: params.orderNumber,
    capture: params.capture || '1',
    billToFirstName: params.billToFirstName || '',
    billToLastName: params.billToLastName || '',
    billToAddress: params.billToAddress || '',
    billToAddress2: params.billToAddress2 || '',
    billToCity: params.billToCity || '',
    billToState: params.billToState || '',
    billToZipPostCode: params.billToZipPostCode || '',
    billToCountry: params.billToCountry || 'CR',
    billToTelephone: params.billToTelephone || '',
    billToEmail: params.billToEmail || '',
    shipToFirstName: params.shipToFirstName || '',
    shipToLastName: params.shipToLastName || '',
    shipToAddress: params.shipToAddress || '',
    shipToAddress2: params.shipToAddress2 || '',
    shipToCity: params.shipToCity || '',
    shipToState: params.shipToState || '',
    shipToZipPostCode: params.shipToZipPostCode || '',
    shipToCountry: params.shipToCountry || 'CR',
    shipToTelephone: params.shipToTelephone || '',
    subscription: params.subscription || '0',
    platform: 'api',
    returnData: params.returnData || '',
    hashVersion: 'V2',
    token_version: 'v2',
  };

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw providerError('Tilopay processPayment network error', {
      operation: 'processPayment', code: 'TILOPAY_NETWORK_ERROR', cause: e,
    });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw providerError(`Tilopay processPayment non-JSON: HTTP ${response.status}`, {
      operation: 'processPayment', code: 'TILOPAY_NON_JSON', httpStatus: response.status,
    });
  }

  // ── Validate response ──
  if (!data.type) {
    throw providerError('Tilopay processPayment: missing type field', {
      operation: 'processPayment', code: 'TILOPAY_INVALID_RESPONSE', httpStatus: response.status,
      providerMessage: data.message,
    });
  }

  const respType = String(data.type).trim();

  // Success: type "100" with hosted URL
  if (respType === '100') {
    const hostedUrl = data.url;
    if (!hostedUrl || typeof hostedUrl !== 'string' || hostedUrl.length === 0) {
      throw providerError('Tilopay processPayment type 100 but missing url field', {
        operation: 'processPayment', code: 'TILOPAY_INVALID_RESPONSE', httpStatus: response.status,
        providerType: respType, providerMessage: data.message,
      });
    }
    validateHostedCheckoutUrl(hostedUrl, {
      environment: tilopayConfig.ENV,
      httpStatus: response.status,
      providerType: respType,
    });
    return { type: respType, url: hostedUrl };
  }

  // Error types: 300, 400, 402, 403
  if (['300', '400', '402', '403'].includes(respType)) {
    const msg = data.message || `Tilopay error type ${respType}`;
    throw providerError('Tilopay processPayment was rejected', {
      operation: 'processPayment', code: 'TILOPAY_PAYMENT_REJECTED', httpStatus: response.status,
      providerType: respType, providerMessage: msg,
    });
  }

  // Unknown type
  throw providerError(`Tilopay processPayment unexpected type: ${respType}`, {
    operation: 'processPayment', code: 'TILOPAY_UNEXPECTED_TYPE', httpStatus: response.status,
    providerType: respType, providerMessage: data.message,
  });
}

// NOTE: returnData uses Base64 encoding (not encryption/signing).
// It carries only an opaque random internal payment reference.
// Payment confirmation MUST NOT rely on Base64 integrity.
//
// ── Official: Consult Transaction ──

/**
 * Official Tilopay transaction status mapping.
 *
 * ALL customer-facing status information MUST come from
 * config/tilopayStatusMap.js (mapProviderCode).
 *
 * This map is internal-only: status code → terminal + paid flags.
 * Labels/messages are provided by the centralized statusMap, never
 * by raw provider text.
 *
 * Known consult response codes (from Postman + real sandbox):
 *   "1"  = Approved
 *   "2"  = Declined / Denied
 *   "3"  = Insufficient funds
 *   "4"  = Invalid CVV / Invalid card data
 *   "7"  = 3DS authentication failed
 *   "8"  = Cancelled
 *   "98" = Issuer unreachable (real sandbox 2026-08-07)
 */
const CONSULT_CODE_MAP = {
  '1':  { status: 'approved',  terminal: true,  paid: true },
  '2':  { status: 'declined',  terminal: true,  paid: false },
  '7':  { status: 'declined',  terminal: true,  paid: false },
  '8':  { status: 'cancelled', terminal: true,  paid: false },
  '43': { status: 'declined',  terminal: true,  paid: false },
  '51': { status: 'declined',  terminal: true,  paid: false },
  '82': { status: 'declined',  terminal: true,  paid: false },
  '98': { status: 'declined',  terminal: true,  paid: false },
};

/**
 * Consult a specific transaction via POST /api/v1/consult.
 *
 * Official contract (Postman collection):
 *   POST https://app.tilopay.com/api/v1/consult
 *   Headers:  Authorization: bearer <token>
 *   Body:     { key, orderNumber, merchantId }
 *   Success:  { type: "200", response: [{ ... }] }
 *
 * @param {string} orderNumber - the local persisted orderNumber
 * @param {object} [expected]  - optional { amount, currency } for validation
 * @returns {{ type, transaction, rawResponse }}
 */
async function consultTransaction(orderNumber, expected = {}) {
  if (MOCK_MODE) return _mockConsultTransaction(orderNumber, expected);

  let token;
  try {
    token = await getAccessToken();
  } catch (e) {
    throw new Error('Tilopay consult: could not obtain access token');
  }

  const url = API_BASE_URL + CONSULT_PATH;

  const body = {
    key: API_KEY,
    orderNumber: String(orderNumber),
    merchantId: '',
  };

  let data;
  try {
    data = await _consultCall(url, token, body);
  } catch (e) {
    // 401: refresh token once and retry
    if (e.statusCode === 401) {
      clearTokenCache();
      token = await getAccessToken();
      data = await _consultCall(url, token, body);
    } else {
      throw e;
    }
  }

  // Validate top-level type
  if (!data || !data.type) {
    throw new Error('Tilopay consult: missing type field in response');
  }

  if (data.type !== '200') {
    throw new Error('Tilopay consult returned type=' + data.type + ': ' + (data.message || 'unknown'));
  }

  // Validate response array
  if (!Array.isArray(data.response)) {
    throw new Error('Tilopay consult: response is not an array');
  }

  if (data.response.length === 0) {
    return { type: '200', transaction: null, rawResponse: data };
  }

  // Find matching transaction by orderNumber
  // Tilopay prepends a merchant/business prefix (e.g. PFC027223-) to the orderNumber.
  // Match by endsWith to handle this. Also try exact match as fallback.
  const exactMatch = data.response.filter(function(tx) {
    return String(tx.orderNumber) === String(orderNumber);
  });
  const suffixMatch = exactMatch.length > 0 ? exactMatch :
    data.response.filter(function(tx) {
      return String(tx.orderNumber).endsWith(String(orderNumber));
    });
  const txs = suffixMatch;

  if (txs.length === 0) {
    return { type: '200', transaction: null, rawResponse: data };
  }

  const tx = txs[0];

  // Normalize provider fields using centralized status map.
  // NEVER use raw provider text (tx.response) as customer-facing label.
  const statusMap = require('../config/tilopayStatusMap');
  const providerCode = String(tx.code || '').trim();
  const mappedCode = statusMap.mapProviderCode(providerCode, tx.response || '');
  const mapped = {
    ...mappedCode,
    // Preserve backward-compatible fields expected by callers
    status: mappedCode.status,
    label: mappedCode.label,
    terminal: mappedCode.terminal,
    paid: mappedCode.paid,
  };

  // Validate optional expected amount/currency
  if (expected.amount !== undefined && expected.amount !== null) {
    const expAmt = String(expected.amount);
    const provAmt = String(tx.amount || '');
    if (expAmt !== provAmt) {
      mapped.amountMismatch = true;
      mapped.paid = false;
    }
  }

  if (expected.currency !== undefined && expected.currency !== null) {
    const expCur = String(expected.currency);
    const provCur = String(tx.currency || '');
    if (expCur !== provCur) {
      mapped.currencyMismatch = true;
      mapped.paid = false;
    }
  }

  return {
    type: '200',
    transaction: Object.assign({
      id_tilopay: tx.id_tilopay,
      orderNumber: tx.orderNumber,
      amount: tx.amount,
      currency: tx.currency,
      code: providerCode,
      response: tx.response || '',
      auth: tx.auth || '',
      card: tx.card || '',
      last: tx.last || '',
      environment: tx.environment || '',
      date: tx.date || '',
    }, mapped),
    rawResponse: data,
  };
}

/**
 * Internal: makes the HTTP request to /api/v1/consult.
 * Returns parsed JSON or throws with statusCode for 401.
 */
async function _consultCall(url, token, body) {
  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': 'bearer ' + token,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Tilopay consult network error: ' + e.message);
  }

  if (response.status === 401) {
    var err = new Error('Tilopay consult: unauthorized');
    err.statusCode = 401;
    throw err;
  }

  if (!response.ok) {
    var text = '';
    try { text = await response.text(); } catch (e2) { text = '<unreadable>'; }
    throw new Error('Tilopay consult HTTP ' + response.status + ': ' + text.slice(0, 200));
  }

  try {
    return await response.json();
  } catch (e) {
    var rawText = '';
    try { rawText = await response.text(); } catch (e2) { rawText = '<unreadable>'; }
    throw new Error('Tilopay consult non-JSON response: ' + rawText.slice(0, 200));
  }
}

// ── Diagnostic ──

async function diagnosticLogin() {
  try {
    const result = await _login();
    return {
      endpoint: `${API_BASE_URL}${LOGIN_PATH}`,
      httpStatus: 200,
      success: true,
      tokenReceived: !!result.access_token,
      tokenType: result.token_type,
      expiresInDetected: result.expires_ms > 0,
    };
  } catch (e) {
    return {
      endpoint: `${API_BASE_URL}${LOGIN_PATH}`,
      httpStatus: e.httpStatus || 0,
      success: false,
      tokenReceived: false,
      tokenType: null,
      expiresInDetected: false,
      error: e.message.slice(0, 200),
      code: e.code || null,
      providerType: e.providerType || null,
      providerMessage: e.providerMessage || null,
    };
  }
}

// ── DEPRECATED: SDK V1 ──

/**
 * @deprecated SDK V1 removed. See processPayment() for hosted flow.
 */
async function getSdkToken() {
  throw new Error('SDK V1 is deprecated. Use processPayment() for the hosted payment flow.');
}

/**
 * @deprecated Use consultTransaction() for the official lookup.
 */
async function getTransactionStatus() {
  throw new Error('Transaction lookup deprecated. Use consultTransaction().');
}

function isWebhookSignatureSupported() { return false; }

// ── MOCK implementations (TILOPAY_MOCK=true) ──

const _mockStore = new Map();

function _mockProcessPayment(params) {
  const mockUrl = `https://secure.tilopay.com/htmls/${params.orderNumber}_mock.html`;
  return { type: '100', url: mockUrl };
}

function _mockConsultTransaction(orderNumber, expected) {
  return {
    type: '200',
    response: [{
      id_tilopay: 999999,
      orderNumber: String(orderNumber),
      amount: '1.00',
      currency: 'CRC',
      code: '1',
      response: 'Transacción aprobada',
      auth: '123456',
      capture: 'Capture',
      card: '5400',
      last: '0000',
      environment: 'Test',
      type: 'Payment',
      date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    }],
  };
}

function _mockSdkToken(params) {
  const token = `mock_tkn_${crypto.randomBytes(16).toString('hex')}`;
  _mockStore.set(token, { token, amount: params.amount, currency: params.currency, orderNumber: params.orderNumber, status: 'created' });
  return { token, methods: [], message: 'Success (mock)' };
}

function _mockTransactionStatus(tid) {
  const e = _mockStore.get(tid);
  return e ? { transactionId: tid, status: e.status, amount: e.amount, currency: e.currency } : { transactionId: tid, status: 'unknown', amount: null, currency: null };
}

function mockCreateTransaction(params) {
  const tid = `mock_tx_${crypto.randomBytes(8).toString('hex')}`;
  _mockStore.set(tid, { transactionId: tid, status: 'pending', amount: params.amount, currency: params.currency });
  return { transactionId: tid, status: 'pending' };
}
function mockSetStatus(tid, status) { const e = _mockStore.get(tid); if (e) e.status = status; }
function mockApprovedTransaction(tid) { mockSetStatus(tid, 'approved'); }
function mockDeclinedTransaction(tid) { mockSetStatus(tid, 'declined'); }

module.exports = {
  // Official hosted payment flow
  getAccessToken,
  processPayment,
  validateHostedCheckoutUrl,
  consultTransaction,
  diagnosticLogin,
  // Legacy (deprecated)
  getSdkToken,
  getTransactionStatus,
  isWebhookSignatureSupported,
  // Test helpers
  mockCreateTransaction,
  mockApprovedTransaction,
  mockDeclinedTransaction,
};
