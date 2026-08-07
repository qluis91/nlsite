/**
 * Tilopay configuration — environment-variable validation, base URL selection.
 * Never exposes credential values outside this module.
 *
 * Documentation status (2026-08-06):
 *   Postman collection: _local/tilopay-official.postman_collection.json
 *   Creds:              Validated (real login test pending)
 *
 * OFFICIAL HOSTED PAYMENT FLOW:
 *   POST /api/v1/login          → { access_token, token_type, expires_in }
 *   POST /api/v1/processPayment → { redirect_url (environment-specific exact host allowlist) }
 *   → Redirect customer to hosted URL
 *   → Browser return
 *   → Verify via consultation endpoint
 */

// ── Enabled / Environment ──
const ENABLED = String(process.env.TILOPAY_ENABLED || 'false').toLowerCase() === 'true';
const ENV = String(process.env.TILOPAY_ENV || 'sandbox').toLowerCase();

// Block mock mode in production
const MOCK_MODE = (() => {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const mockEnv = String(process.env.TILOPAY_MOCK || '').toLowerCase();
  if (isProd && mockEnv === 'true') {
    throw new Error('TILOPAY_MOCK=true is forbidden in production (NODE_ENV=production).');
  }
  return !isProd && mockEnv === 'true';
})();

const ALLOWED_ENVS = ['sandbox', 'production'];
if (!ALLOWED_ENVS.includes(ENV)) {
  if (ENABLED) {
    throw new Error(`TILOPAY_ENV must be one of: ${ALLOWED_ENVS.join(', ')}`);
  }
}

const HOSTED_CHECKOUT_HOSTS = Object.freeze({
  sandbox: Object.freeze([
    'secure.tilopay.com',
    'securepayment.tilopay.com',
  ]),
  production: Object.freeze([
    'secure.tilopay.com',
  ]),
});

function getHostedCheckoutHosts(environment = ENV) {
  const normalizedEnvironment = String(environment || '').trim().toLowerCase();
  const hosts = HOSTED_CHECKOUT_HOSTS[normalizedEnvironment];
  return hosts ? [...hosts] : [];
}

function isAllowedHostedCheckoutHost(hostname, environment = ENV) {
  const normalizedHostname = String(hostname || '').trim().toLowerCase();
  return getHostedCheckoutHosts(environment).includes(normalizedHostname);
}

// ── Base URLs ──
const API_BASE_URL = (() => {
  const raw = String(process.env.TILOPAY_API_BASE_URL || '').trim();
  if (raw) {
    try { new URL(raw); return raw.replace(/\/+$/, ''); }
    catch { /* fall through */ }
  }
  return 'https://app.tilopay.com';
})();

// Legacy base URL (same as API_BASE_URL, kept for backward compat)
const BASE_URL = API_BASE_URL;

// ── API Paths ──
const LOGIN_PATH = '/api/v1/login';
const PROCESS_PAYMENT_PATH = '/api/v1/processPayment';
const CONSULT_PATH = '/api/v1/consult';

// ── Credentials ──
const API_KEY = String(process.env.TILOPAY_API_KEY || '').trim();
const API_USER = String(process.env.TILOPAY_API_USER || '').trim();
const API_PASSWORD = String(process.env.TILOPAY_API_PASSWORD || '').trim();
const WEBHOOK_SECRET = String(process.env.TILOPAY_WEBHOOK_SECRET || '').trim();

// ── Public base URL (for deriving callback/return URLs) ──
const PUBLIC_BASE_URL = (() => {
  const raw = String(process.env.TILOPAY_PUBLIC_BASE_URL || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (ENV === 'production' && u.protocol !== 'https:') {
      throw new Error('TILOPAY_PUBLIC_BASE_URL must use HTTPS in production.');
    }
    return u.origin;
  } catch (e) {
    if (ENV === 'production' || ENABLED) {
      throw new Error(`Invalid TILOPAY_PUBLIC_BASE_URL: ${e.message}`);
    }
    return null;
  }
})();

const REQUEST_TIMEOUT_MS = parseInt(process.env.TILOPAY_REQUEST_TIMEOUT_MS || '15000', 10);

// ── Currency ──
const DEFAULT_CURRENCY = 'CRC';

// ── SDK (legacy V1 — pending removal in Phase 2) ──
const SDK_SCRIPT_URL = 'https://app.tilopay.com/sdk/v1/sdk.min.js';
const JQUERY_SCRIPT_URL = 'https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js';

// ── Derived URLs ──
function deriveReturnUrl() {
  if (!PUBLIC_BASE_URL) return null;
  try { return new URL('/pagos/tilopay/retorno', PUBLIC_BASE_URL).href; }
  catch { return null; }
}

function deriveCancelUrl() {
  if (!PUBLIC_BASE_URL) return null;
  try { return new URL('/pagos/tilopay/cancelado', PUBLIC_BASE_URL).href; }
  catch { return null; }
}

function deriveWebhookUrl() {
  if (!PUBLIC_BASE_URL) return null;
  try { return new URL('/webhooks/tilopay', PUBLIC_BASE_URL).href; }
  catch { return null; }
}

// ── Validation ──
function validateConfig() {
  if (!ENABLED && !MOCK_MODE) return;

  const missing = [];
  if (!API_KEY) missing.push('TILOPAY_API_KEY');
  if (!API_USER) missing.push('TILOPAY_API_USER');
  if (!API_PASSWORD) missing.push('TILOPAY_API_PASSWORD');
  if (!PUBLIC_BASE_URL && ENABLED) missing.push('TILOPAY_PUBLIC_BASE_URL');

  if (missing.length > 0) {
    throw new Error(
      `Tilopay is enabled but required variables are missing: ${missing.join(', ')}. ` +
      'Set them in .env or set TILOPAY_ENABLED=false.'
    );
  }

  if (ENV === 'sandbox') {
    console.warn('[tilopay] ⚠ Running in sandbox mode.');
  }
}

// ── Public configuration (non-secret only) ──
function getPublicConfig() {
  return {
    enabled: ENABLED,
    environment: ENV,
    sdkScriptUrl: SDK_SCRIPT_URL,
    jqueryScriptUrl: JQUERY_SCRIPT_URL,
    currency: DEFAULT_CURRENCY,
  };
}

module.exports = {
  CONSULT_PATH,
  ENABLED,
  ENV,
  MOCK_MODE,
  API_BASE_URL,
  BASE_URL,
  LOGIN_PATH,
  PROCESS_PAYMENT_PATH,
  API_KEY,
  API_USER,
  API_PASSWORD,
  WEBHOOK_SECRET,
  PUBLIC_BASE_URL,
  REQUEST_TIMEOUT_MS,
  DEFAULT_CURRENCY,
  SDK_SCRIPT_URL,
  JQUERY_SCRIPT_URL,
  deriveReturnUrl,
  deriveCancelUrl,
  deriveWebhookUrl,
  getHostedCheckoutHosts,
  isAllowedHostedCheckoutHost,
  validateConfig,
  getPublicConfig,
};
