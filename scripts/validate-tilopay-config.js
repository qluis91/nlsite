#!/usr/bin/env node
/**
 * Validate Tilopay configuration.
 * Run: node scripts/validate-tilopay-config.js
 *
 * Checks environment variables and derived settings WITHOUT printing
 * credential values. Reports clear actionable errors.
 *
 * Exit codes:
 *   0 — configuration valid (or Tilopay disabled)
 *   1 — configuration error
 */

require('dotenv').config();

let errors = 0;

function ok(msg) { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.log(`  ⚠ ${msg}`); errors++; }
function err(msg) { console.error(`  ✗ ${msg}`); errors++; }

const enabled = String(process.env.TILOPAY_ENABLED || '').toLowerCase() === 'true';
console.log(`\nTilopay: ${enabled ? 'ENABLED' : 'disabled'}`);

if (!enabled) {
  console.log('  No validation required. Set TILOPAY_ENABLED=true to enable.\n');
  process.exit(0);
}

// Environment
const env = String(process.env.TILOPAY_ENV || 'sandbox').toLowerCase();
if (!['sandbox', 'production'].includes(env)) {
  err(`TILOPAY_ENV must be 'sandbox' or 'production', got '${env}'`);
} else {
  ok(`Environment: ${env}`);
}

// Credentials (existence only)
for (const key of ['TILOPAY_API_KEY', 'TILOPAY_API_USER', 'TILOPAY_API_PASSWORD']) {
  const val = String(process.env[key] || '').trim();
  if (!val) {
    err(`${key} is required`);
  } else {
    ok(`${key} is set`);
  }
}

// Public base URL
const publicUrl = String(process.env.TILOPAY_PUBLIC_BASE_URL || '').trim();
if (!publicUrl) {
  err('TILOPAY_PUBLIC_BASE_URL is required when enabled');
} else {
  try {
    const u = new URL(publicUrl);
    if (env === 'production' && u.protocol !== 'https:') {
      err('TILOPAY_PUBLIC_BASE_URL must use HTTPS in production');
    } else {
      ok(`Public URL: ${u.origin} (${u.protocol}//)`);
    }

    // Derived URLs
    console.log('  Derived URLs:');
    try { const ret = new URL('/pagos/tilopay/retorno', u.origin).href; ok(`  Return: ${ret}`); }
    catch { err('  Could not derive return URL'); }
    try { const cancel = new URL('/pagos/tilopay/cancelado', u.origin).href; ok(`  Cancel: ${cancel}`); }
    catch { err('  Could not derive cancel URL'); }
    try { const wh = new URL('/webhooks/tilopay', u.origin).href; ok(`  Webhook: ${wh}`); }
    catch { err('  Could not derive webhook URL'); }
  } catch {
    err(`TILOPAY_PUBLIC_BASE_URL is not a valid URL: "${publicUrl}"`);
  }
}

// SDK URL check
const sdkUrl = 'https://app.tilopay.com/sdk/v1/sdk.min.js';
try {
  const su = new URL(sdkUrl);
  if (su.protocol !== 'https:') err(`SDK URL must be HTTPS: ${sdkUrl}`);
  else ok(`SDK script: ${sdkUrl.slice(0, 50)}...`);
} catch {
  err(`Invalid SDK URL: ${sdkUrl}`);
}

// Base URL
const baseUrl = 'https://app.tilopay.com';
try {
  const bu = new URL(baseUrl);
  if (bu.protocol !== 'https:') err(`API base URL must be HTTPS`);
  else ok(`API base: ${baseUrl}`);
} catch {
  err(`Invalid API base URL`);
}

// Request timeout
const timeout = parseInt(process.env.TILOPAY_REQUEST_TIMEOUT_MS || '15000', 10);
if (isNaN(timeout) || timeout < 1000) {
  warn(`TILOPAY_REQUEST_TIMEOUT_MS seems low: ${timeout}ms`);
} else {
  ok(`Request timeout: ${timeout}ms`);
}

// Currency
ok(`Currency: CRC (Costa Rican colones)`);

// Mock mode protection
if (env === 'production') {
  const mock = String(process.env.TILOPAY_MOCK || '').toLowerCase();
  if (mock === 'true') {
    err('TILOPAY_MOCK=true is FORBIDDEN in production');
  } else {
    ok('Mock mode disabled (production)');
  }
} else {
  const mock = String(process.env.TILOPAY_MOCK || '').toLowerCase();
  if (mock === 'true') ok('Mock mode enabled (development only)');
  else ok('Mock mode disabled');
}

// Webhook secret (warn if set but not confirmed)
if (process.env.TILOPAY_WEBHOOK_SECRET) {
  warn('TILOPAY_WEBHOOK_SECRET is set but the webhook signature mechanism is not yet confirmed from Tilopay documentation. The webhook route currently uses server-to-server lookup.');
}

// ⚠ Documentation gaps
console.log('\n  ⚠ Known documentation gaps:');
console.log('    - SDK V2 guides require merchant portal login');
console.log('    - Postman API collection requires JavaScript rendering');
console.log('    - Server-side API endpoint URLs unconfirmed');
console.log('    - Webhook signature mechanism unconfirmed');
console.log('    - Real sandbox transaction not yet completed');
console.log('    See docs/TILOPAY_INTEGRATION.md for full details.\n');

if (errors > 0) {
  console.error(`\n${errors} configuration error(s) found.\n`);
  process.exit(1);
}

console.log(`\nTilopay configuration valid for ${env}.\n`);
process.exit(0);
