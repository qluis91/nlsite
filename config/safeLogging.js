/**
 * Phase 16D — Safe logging and error helpers.
 *
 * - redactSensitive: strips passwords, tokens, secrets from logged objects
 * - safeServerError: JSON 500 responses that never expose stack traces, SQL, or paths
 */

const SENSITIVE_KEYS = new Set([
  'password', 'password2', 'currentPassword', 'newPassword', 'confirmPassword',
  'token', 'csrf', '_csrf', 'sessionId', 'cookie', 'authorization',
  'secret', 'apiKey', 'api_key', 'apiPassword', 'api_password',
  'smtpPassword', 'smtp_password', 'dbPassword', 'db_password',
]);

const REDACTED = '[REDACTED]';

function redactSensitive(obj, maxDepth = 4) {
  if (maxDepth <= 0 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.map(v => redactSensitive(v, maxDepth - 1));

  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = String(key).toLowerCase();
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lower) || lower.includes('password') || lower.includes('token') || lower.includes('secret')) {
      out[key] = REDACTED;
    } else {
      out[key] = redactSensitive(value, maxDepth - 1);
    }
  }
  return out;
}

/** Safe JSON error response — never includes stack traces, SQL, paths, or environment data. */
function safeServerError(res, err) {
  const isProd = process.env.NODE_ENV === 'production';
  if (!res.headersSent) {
    return res.status(500).json({ error: isProd ? 'Internal server error.' : `Internal server error (${err?.message || 'unknown'}).` });
  }
  return undefined;
}

module.exports = { SENSITIVE_KEYS, REDACTED, redactSensitive, safeServerError };
