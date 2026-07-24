/**
 * Tilopay HTTP client adapter — provider API calls.
 *
 * ⚠️ BLOCKED: Tilopay server-side API endpoints (GetTokenSdk URL, transaction
 *    status endpoint, webhook signature mechanism) are not publicly documented.
 *    SDK V2 guides require merchant portal login. Postman collection requires
 *    JavaScript rendering.
 *
 *    Real provider API calls are IMPLEMENTED BUT UNTESTED against live Tilopay.
 *    They use the best-known endpoint patterns from SDK V1 PDF + WooCommerce plugin.
 *    Until a real sandbox transaction completes, these must be considered
 *    PROVISIONAL and pending confirmation from the Tilopay merchant portal.
 *
 *    Mock functions are available for automated testing only.
 *    TILOPAY_MOCK=true in development enables mock responses.
 *    TILOPAY_MOCK=true is BLOCKED in production (config enforces this).
 *
 * Known confirmed facts (from SDK V1 PDF v1.2.0 + WooCommerce plugin):
 *   - Auth: Basic Auth (API_USER:API_PASSWORD) + X-Api-Key header
 *   - GetTokenSdk exists as a server-side API method
 *   - Token from GetTokenSdk is required by Tilopay.Init({})
 *   - SDK script: https://app.tilopay.com/sdk/v1/sdk.min.js
 *   - Base domain: https://app.tilopay.com
 *
 * Endpoint path assumptions (from WooCommerce plugin source + SDK V1 PDF):
 *   - GetTokenSdk: POST /api/v1/token_sdk
 *   - Transaction lookup: GET /api/v1/transactions/:id
 *   These paths are the best-known estimates but MUST be verified against
 *   the Tilopay merchant portal documentation before production use.
 */
const tilopayConfig = require('../config/tilopay');
const crypto = require('crypto');

const { BASE_URL, API_KEY, API_USER, API_PASSWORD, REQUEST_TIMEOUT_MS, MOCK_MODE } = tilopayConfig;

// ── Internal helpers ──
function authHeaders() {
  const auth = Buffer.from(`${API_USER}:${API_PASSWORD}`).toString('base64');
  return {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Api-Key': API_KEY,
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ── Provider operations ──

/**
 * Get SDK token for initializing the client-side Tilopay SDK.
 *
 * Endpoint: POST /api/v1/token_sdk (best-known estimate — verify against merchant portal)
 */
async function getSdkToken(params) {
  if (!tilopayConfig.ENABLED && !MOCK_MODE) {
    throw new Error('Tilopay is not enabled');
  }

  // MOCK MODE: return safe test token
  if (MOCK_MODE) return _mockSdkToken(params);

  const url = `${BASE_URL}/api/v1/token_sdk`;

  const body = {
    currency: params.currency,
    amount: Number(params.amount),
    orderNumber: String(params.orderNumber),
    billToEmail: String(params.billToEmail || ''),
    capture: 1,
  };
  // Optional fields — only include when present
  if (params.billToFirstName) body.billToFirstName = String(params.billToFirstName);
  if (params.billToLastName) body.billToLastName = String(params.billToLastName);
  if (params.billToTelephone) body.billToTelephone = String(params.billToTelephone);

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Tilopay GetTokenSdk failed: HTTP ${response.status} — ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  return {
    token: data.token || data.sdk_token,
    methods: data.methods || [],
    message: data.message || 'Success',
  };
}

/**
 * Query current status of a provider transaction.
 *
 * Endpoint: GET /api/v1/transactions/:id (best-known estimate — verify against merchant portal)
 */
async function getTransactionStatus(providerTransactionId) {
  if (!tilopayConfig.ENABLED && !MOCK_MODE) {
    throw new Error('Tilopay is not enabled');
  }

  if (MOCK_MODE) return _mockTransactionStatus(providerTransactionId);

  const url = `${BASE_URL}/api/v1/transactions/${encodeURIComponent(providerTransactionId)}`;

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Tilopay status lookup failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    transactionId: data.transaction_id || data.id || providerTransactionId,
    status: data.status || 'unknown',
    amount: data.amount || null,
    currency: data.currency || null,
  };
}

// ── Webhook / callback — NOT YET CONFIRMED ──

/**
 * Webhook signature verification is NOT IMPLEMENTED because the Tilopay
 * webhook security mechanism is not publicly documented.
 *
 * Until the Tilopay merchant portal or Postman collection confirms:
 *   - Whether webhooks exist for SDK payments
 *   - Signature algorithm (HMAC algorithm, header name, canonical payload format)
 *   - Whether server-to-server lookup is the intended verification method
 *
 * The webhook route uses this fallback architecture:
 *   1. Accept the notification body
 *   2. Extract the provider transaction reference
 *   3. Perform an authenticated server-to-server lookup via getTransactionStatus()
 *   4. Use the lookup result as authoritative
 *   5. Never mark paid based solely on unsigned callback body
 */
function isWebhookSignatureSupported() {
  return false; // Not yet confirmed from provider documentation
}

// ── Mock implementations (testing only, gated by TILOPAY_MOCK=true) ──

const _mockStore = new Map();

function _mockSdkToken(params) {
  const token = `mock_tkn_${crypto.randomBytes(16).toString('hex')}`;
  _mockStore.set(token, {
    token,
    amount: params.amount,
    currency: params.currency,
    orderNumber: params.orderNumber,
    status: 'created',
    createdAt: new Date().toISOString(),
  });
  return {
    token,
    methods: [
      { id: '452:3:15', name: 'Tarjeta Crédito / Débito', type: 'card' },
      { id: '362:3:18', name: 'Tasa cero 3 Meses', type: 'card' },
    ],
    message: 'Success (mock)',
  };
}

function _mockTransactionStatus(tid) {
  const entry = _mockStore.get(tid);
  return entry
    ? { transactionId: tid, status: entry.status, amount: entry.amount, currency: entry.currency }
    : { transactionId: tid, status: 'unknown', amount: null, currency: null };
}

// Test helpers — used ONLY by automated tests, never in production paths
function mockCreateTransaction(params) {
  const tid = `mock_tx_${crypto.randomBytes(8).toString('hex')}`;
  _mockStore.set(tid, {
    transactionId: tid,
    status: 'pending',
    amount: params.amount,
    currency: params.currency,
    createdAt: new Date().toISOString(),
  });
  return { transactionId: tid, status: 'pending' };
}

function mockSetStatus(tid, status) {
  const entry = _mockStore.get(tid);
  if (entry) entry.status = status;
}

function mockApprovedTransaction(tid) {
  mockSetStatus(tid, 'approved');
}

function mockDeclinedTransaction(tid) {
  mockSetStatus(tid, 'declined');
}

module.exports = {
  getSdkToken,
  getTransactionStatus,
  isWebhookSignatureSupported,
  // Mock helpers for automated tests
  mockCreateTransaction,
  mockApprovedTransaction,
  mockDeclinedTransaction,
};
