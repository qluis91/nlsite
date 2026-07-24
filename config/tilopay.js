/**
 * Tilopay configuration — environment-variable validation, base URL selection.
 * Never exposes credential values outside this module.
 *
 * Documentation status (2026-07-23):
 *   SDK V1 PDF:    ✅ Audited (https://app.tilopay.com/sdk/documentation.pdf, v1.2.0)
 *   SDK V2 guides: ❌ Behind merchant portal login
 *   Postman API:   ❌ Requires JavaScript rendering
 *   API docs page: ❌ Marketing content only (https://web.tilopay.com/documentacion/api)
 *   Developer reg:  ✅ Available (https://web.tilopay.com/developers)
 *
 * CONFIRMED:
 *   - SDK script: https://app.tilopay.com/sdk/v1/sdk.min.js
 *   - Credential model: API Key + API User + API Password (from WooCommerce plugin)
 *   - Auth method:      Basic Auth (API_USER:API_PASSWORD) + X-Api-Key header
 *   - GetTokenSdk:      Server-side endpoint exists (exact URL unconfirmed)
 *   - Tilopay.Init({}): Client-side SDK initialization with token
 *   - Tilopay.startPayment(): Client-side payment processing
 *   - redirect param:   Callback URL for payment result
 *
 * UNCONFIRMED (blocking real API calls):
 *   - GetTokenSdk endpoint URL
 *   - Transaction status/verification endpoint URL
 *   - Webhook signature mechanism (algorithm, header names, payload format)
 *   - Webhook endpoint URL registration location (merchant portal)
 *   - Token lifetime and refresh mechanism
 *   - SDK V2 API surface (may differ from V1)
 *
 * Real API calls must NOT be made until the merchant portal documentation
 * confirms all unconfirmed items above.
 */
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

// ── Base URLs ──
// Both environments use the same Tilopay platform domain.
// Merchant credentials determine sandbox vs production behavior.
const SANDBOX_BASE = 'https://app.tilopay.com';
const PRODUCTION_BASE = 'https://app.tilopay.com';
const BASE_URL = ENV === 'production' ? PRODUCTION_BASE : SANDBOX_BASE;

// ── Credentials ──
const API_KEY = String(process.env.TILOPAY_API_KEY || '').trim();
const API_USER = String(process.env.TILOPAY_API_USER || '').trim();
const API_PASSWORD = String(process.env.TILOPAY_API_PASSWORD || '').trim();
const WEBHOOK_SECRET = String(process.env.TILOPAY_WEBHOOK_SECRET || '').trim();

// ── Public base URL (for deriving callback/return/webhook URLs) ──
const PUBLIC_BASE_URL = (() => {
  const raw = String(process.env.TILOPAY_PUBLIC_BASE_URL || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (ENV === 'production' && u.protocol !== 'https:') {
      throw new Error('TILOPAY_PUBLIC_BASE_URL must use HTTPS in production.');
    }
    // Remove trailing slash
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
// Costa Rican colones, ISO 4217: CRC
// Amount format: decimal (e.g. 3500.00) — confirmed by SDK V1 PDF usage
const DEFAULT_CURRENCY = 'CRC';

// ── SDK ──
// Confirmed from SDK V1 PDF: https://app.tilopay.com/sdk/v1/sdk.min.js
const SDK_SCRIPT_URL = 'https://app.tilopay.com/sdk/v1/sdk.min.js';

// ── JQuery requirement ──
// SDK V1 requires jQuery (confirmed by SDK V1 PDF)
const JQUERY_SCRIPT_URL = 'https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js';

// ── Derived URLs (from PUBLIC_BASE_URL) ──
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

  // Warn about unconfirmed endpoints (non-fatal in sandbox)
  if (ENV === 'sandbox') {
    console.warn('[tilopay] ⚠ Running in sandbox mode. API endpoint URLs must be confirmed against the Tilopay merchant portal.');
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
  ENABLED,
  ENV,
  MOCK_MODE,
  BASE_URL,
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
  validateConfig,
  getPublicConfig,
};
