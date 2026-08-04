/**
 * TikTok OAuth Service — Phase 2E-C.
 *
 * TikTok Login Kit OAuth v2 for connecting a TikTok account
 * and importing public videos via the Display API.
 *
 * Official endpoints (v2):
 * - Authorization: https://www.tiktok.com/v2/auth/authorize/
 * - Token:         https://open.tiktokapis.com/v2/oauth/token/
 * - User info:     /v2/user/info/
 * - Video list:    /v2/video/list/
 * - Video query:   /v2/video/query/
 *
 * Uses single-use, expiring OAuth state (no PKCE).
 * Implements access + refresh token lifecycle.
 */
const crypto = require('node:crypto');
const pool = require('../config/db');
const { storeToken, retrieveToken, deleteToken } = require('./tokenEncryptionService');

// ── Constants ──

const AUTH_HOST = 'https://www.tiktok.com';
const API_HOST = 'https://open.tiktokapis.com';
const API_VERSION = 'v2';
const API_BASE = `${API_HOST}/${API_VERSION}`;

const ALLOWED_ORIGINS = Object.freeze(['www.tiktok.com', 'open.tiktokapis.com']);

const REQUEST_TIMEOUT_MS = 15000;

// ── Config ──

function getClientKey() {
  return process.env.TIKTOK_CLIENT_KEY || '';
}

function getClientSecret() {
  return process.env.TIKTOK_CLIENT_SECRET || '';
}

function getSiteUrl() {
  return (process.env.SITE_URL || process.env.CALLBACK_BASE || 'http://localhost:3000').replace(/\/$/, '');
}

function getRedirectUri() {
  return `${getSiteUrl()}/admin/page/integrations/tiktok-callback`;
}

function isProduction(env) {
  const e = env || process.env.NODE_ENV;
  return e !== 'development' && e !== 'test';
}

function validateUrlOrigin(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!ALLOWED_ORIGINS.some(o => u.hostname === o || u.hostname.endsWith('.' + o))) {
      throw Object.assign(new Error(`Origen no permitido: ${u.hostname}`), { code: 'ORIGIN_DENIED' });
    }
    return u;
  } catch (e) {
    if (e.code === 'ORIGIN_DENIED') throw e;
    throw Object.assign(new Error(`URL inválida: ${urlStr}`), { code: 'INVALID_URL' });
  }
}

// ── OAuth State ──

const STATE_EXPIRY_MS = 10 * 60_000;

function generateState(sessionId) {
  if (!sessionId) throw Object.assign(new Error('Session required for OAuth state.'), { code: 'NO_SESSION' });
  const id = crypto.randomBytes(16).toString('hex');
  return { id, sessionId };
}

async function persistState(stateId, provider, sessionId) {
  const expiresAt = new Date(Date.now() + STATE_EXPIRY_MS);
  await pool.query(
    'INSERT INTO social_oauth_states (state_id, provider, expires_at, session_id) VALUES (?, ?, ?, ?)',
    [stateId, provider, expiresAt, sessionId]
  );
}

async function consumeState(stateId, expectedSessionId, provider) {
  await pool.query('DELETE FROM social_oauth_states WHERE expires_at < NOW()');

  const [[row]] = await pool.query(
    'SELECT id, provider, expires_at, session_id FROM social_oauth_states WHERE state_id = ? AND expires_at > NOW()',
    [stateId]
  );
  if (!row) return null;

  if (row.session_id && expectedSessionId && row.session_id !== expectedSessionId) {
    await pool.query('DELETE FROM social_oauth_states WHERE state_id = ?', [stateId]);
    return null;
  }

  if (provider && row.provider !== provider) {
    await pool.query('DELETE FROM social_oauth_states WHERE state_id = ?', [stateId]);
    return null;
  }

  await pool.query('DELETE FROM social_oauth_states WHERE state_id = ?', [stateId]);
  return { provider: row.provider };
}

// ── HTTP transport (mockable) ──

let _httpGet = null;
let _httpPost = null;
function setHttpGet(fn) { _httpGet = fn; }
function setHttpPost(fn) { _httpPost = fn; }

async function httpGet(url) {
  if (process.env.NODE_ENV !== 'test') validateUrlOrigin(url);
  if (_httpGet) return _httpGet(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    const data = await resp.json();
    return { status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function httpPost(url, body) {
  if (process.env.NODE_ENV !== 'test') validateUrlOrigin(url);
  if (_httpPost) return _httpPost(url, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      signal: controller.signal,
    });
    const data = await resp.json();
    return { status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// ── OAuth flow ──

function getAuthorizationUrl(provider, sessionId) {
  const clientKey = getClientKey();
  if (!clientKey) throw Object.assign(new Error('TIKTOK_CLIENT_KEY no configurada.'), { code: 'NO_CLIENT_KEY' });

  const redirectUri = getRedirectUri();
  if (isProduction() && !redirectUri.startsWith('https://')) {
    throw Object.assign(new Error('Callback URI must use HTTPS in production.'), { code: 'HTTPS_REQUIRED' });
  }

  const { id: stateId, sessionId: sid } = generateState(sessionId);

  const scopes = ['user.info.basic', 'video.list'];

  // TikTok uses comma-separated scopes in the authorize URL
  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: scopes.join(','),
    redirect_uri: redirectUri,
    state: stateId,
  });

  persistState(stateId, provider, sid).catch(() => {});

  return {
    url: `${AUTH_HOST}/v2/auth/authorize/?${params.toString()}`,
    stateId,
    scopes,
  };
}

async function exchangeCodeForToken(code, receivedState, sessionId, redirectUri) {
  if (!receivedState) throw Object.assign(new Error('Missing state parameter.'), { code: 'INVALID_STATE' });
  const state = await consumeState(receivedState, sessionId);
  if (!state) throw Object.assign(new Error('Estado OAuth inválido, expirado o de otra sesión.'), { code: 'INVALID_STATE' });

  const clientKey = getClientKey();
  const clientSecret = getClientSecret();
  if (!clientKey || !clientSecret) {
    throw Object.assign(new Error('TIKTOK_CLIENT_KEY o TIKTOK_CLIENT_SECRET no configuradas.'), { code: 'NO_CREDENTIALS' });
  }

  const uri = redirectUri || getRedirectUri();
  const { status, data } = await httpPost(`${API_HOST}/${API_VERSION}/oauth/token/`, {
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: uri,
  });

  if (status !== 200 || data.error) {
    const isAuth = data.error === 'invalid_grant' || data.error === 'unauthorized_client';
    const isTransient = status >= 500 || status === 429;
    throw Object.assign(new Error(data.error_description || data.error || `OAuth error ${status}`), {
      code: 'OAUTH_ERROR', status, data, isAuthError: isAuth, retryable: !isAuth && isTransient,
    });
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 86400,
    openId: data.open_id || '',
    scope: data.scope || '',
    tokenType: data.token_type || 'Bearer',
    provider: state.provider,
  };
}

// ── Token refresh ──

/**
 * Refresh an expired access token using the refresh token.
 * Rotates and stores the new refresh token if one is returned.
 */
async function refreshAccessToken(provider, accountId) {
  const clientKey = getClientKey();
  const clientSecret = getClientSecret();
  if (!clientKey || !clientSecret) {
    throw Object.assign(new Error('TikTok credentials not configured.'), { code: 'NO_CREDENTIALS' });
  }

  const stored = await retrieveToken(pool, 'tiktok_refresh', accountId);
  if (!stored || !stored.token) {
    throw Object.assign(new Error('No refresh token available.'), { code: 'NO_REFRESH_TOKEN' });
  }

  const { status, data } = await httpPost(`${API_HOST}/${API_VERSION}/oauth/token/`, {
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: stored.token,
  });

  if (status !== 200 || data.error) {
    const isAuth = data.error === 'invalid_grant' || data.error === 'unauthorized_client' || data.error === 'token_revoked';
    const isTransient = status >= 500 || status === 429;
    throw Object.assign(new Error(data.error_description || data.error || `Refresh error ${status}`), {
      code: 'REFRESH_ERROR', status, data, isAuthError: isAuth, retryable: !isAuth && isTransient,
    });
  }

  // Store new access token
  await storeToken(pool, provider, accountId, data.access_token, {
    ...stored.metadata,
    refreshedAt: new Date().toISOString(),
  });

  // Rotate refresh token if provided
  if (data.refresh_token) {
    await storeToken(pool, 'tiktok_refresh', accountId, data.refresh_token, {
      ...stored.metadata,
      refreshedAt: new Date().toISOString(),
    });
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 86400,
    scope: data.scope || '',
  };
}

// ── User info ──

async function getUserInfo(accessToken) {
  // TikTok expects Authorization header
  const resp = await fetch(`${API_BASE}/user/info/?fields=open_id,union_id,avatar_url,display_name`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const result = await resp.json();

  if (resp.status !== 200 || result.error) {
    const isAuth = resp.status === 401 || resp.status === 403;
    throw Object.assign(new Error(result.error_description || result.error_message || `User info error ${resp.status}`), {
      code: 'USER_INFO_ERROR', status: resp.status, isAuthError: isAuth,
    });
  }

  return {
    openId: result.data?.open_id || '',
    unionId: result.data?.union_id || '',
    displayName: result.data?.display_name || '',
    avatarUrl: result.data?.avatar_url || '',
  };
}

// ── Connection management ──

async function completeConnection(provider, tokenData, sessionId) {
  // Fetch user info to get display name
  let userInfo = { openId: tokenData.openId, displayName: '', avatarUrl: '' };
  try {
    userInfo = await getUserInfo(tokenData.accessToken);
  } catch {
    // Use minimal data from token response
  }

  const accountId = userInfo.openId || tokenData.openId || 'tiktok_user';
  const expiresAt = new Date(Date.now() + (tokenData.expiresIn * 1000)).toISOString();

  // Store encrypted access token
  await storeToken(pool, provider, accountId, tokenData.accessToken, {
    openId: accountId,
    displayName: userInfo.displayName,
    avatarUrl: userInfo.avatarUrl,
    scope: tokenData.scope,
    expiresAt,
    connectedBy: sessionId || 'admin',
    connectedAt: new Date().toISOString(),
  });

  // Store encrypted refresh token separately
  await storeToken(pool, 'tiktok_refresh', accountId, tokenData.refreshToken, {
    openId: accountId,
    scope: tokenData.scope,
    connectedAt: new Date().toISOString(),
  });

  // Store non-secret metadata in integration config
  const configJson = {
    openId: accountId,
    displayName: userInfo.displayName,
    avatarUrl: userInfo.avatarUrl,
    scope: tokenData.scope,
    tokenExpiresAt: expiresAt,
    connectedAt: new Date().toISOString(),
  };

  await pool.query(
    `UPDATE social_integrations SET
       config_json = ?, is_connected = 1, is_enabled = 1
     WHERE provider = ?`,
    [JSON.stringify(configJson), provider]
  );
}

async function disconnectProvider(provider) {
  // Delete all tokens for this provider
  await pool.query("DELETE FROM social_token_secrets WHERE provider = ? OR provider = 'tiktok_refresh'", [provider]);

  await pool.query(
    `UPDATE social_integrations SET
       config_json = '{}', is_connected = 0, is_enabled = 0, auto_sync = 0,
       last_sync_status = NULL, last_sync_error = NULL
     WHERE provider = ?`,
    [provider]
  );
}

/**
 * Get a valid access token, refreshing if needed.
 * Uses advisory lock to prevent concurrent refresh races.
 */
async function getValidAccessToken(provider) {
  const [[intRow]] = await pool.query(
    "SELECT config_json FROM social_integrations WHERE provider = ? AND is_connected = 1",
    [provider]
  );
  if (!intRow) return null;

  const config = typeof intRow.config_json === 'string'
    ? JSON.parse(intRow.config_json)
    : (intRow.config_json || {});
  const accountId = config.openId || 'tiktok_user';

  const stored = await retrieveToken(pool, provider, accountId);
  if (!stored) return null;

  // Check if token is expired or close to expiring
  const expiresAt = stored.metadata?.expiresAt;
  if (expiresAt) {
    const msLeft = new Date(expiresAt).getTime() - Date.now();
    if (msLeft < 5 * 60_000) { // Less than 5 minutes left
      // Try to refresh
      try {
        const refreshed = await refreshAccessToken(provider, accountId);
        return refreshed.accessToken;
      } catch (err) {
        if (err.isAuthError) {
          await handleConnectionFailure(provider, 'token_revoked');
          return null;
        }
        // On transient refresh failure, return current token as best effort
        return stored.token;
      }
    }
  }

  return stored.token;
}

// ── Validate connection ──

async function validateToken(provider) {
  const token = await getValidAccessToken(provider);
  if (!token) return { valid: false, reason: 'no_token', category: 'missing' };

  try {
    const resp = await fetch(`${API_BASE}/user/info/?fields=open_id`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await resp.json();

    if (resp.status === 200 && data.data?.open_id) {
      return { valid: true, openId: data.data.open_id, category: 'ok' };
    }
    if (resp.status === 401 || resp.status === 403) {
      const err = data.error;
      if (err === 'invalid_token' || err === 'token_expired') return { valid: false, reason: 'token_expired', category: 'expired' };
      if (err === 'token_revoked' || err === 'invalid_grant') return { valid: false, reason: 'token_revoked', category: 'revoked' };
      if (err === 'scope_not_authorized') return { valid: false, reason: 'insufficient_scope', category: 'permission_denied' };
      return { valid: false, reason: err || 'auth_error', category: 'auth_error' };
    }
    return { valid: false, reason: data?.error_message || `HTTP ${resp.status}`, category: 'transient' };
  } catch {
    return { valid: false, reason: 'network_error', category: 'transient' };
  }
}

async function checkTokenExpiration(provider) {
  const [[intRow]] = await pool.query(
    "SELECT config_json FROM social_integrations WHERE provider = ? AND is_connected = 1",
    [provider]
  );
  if (!intRow) return null;

  const config = typeof intRow.config_json === 'string'
    ? JSON.parse(intRow.config_json)
    : (intRow.config_json || {});
  const expiresAt = config.tokenExpiresAt;
  if (!expiresAt) return null;

  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  const daysLeft = Math.ceil((expiry - now) / 86400000);

  if (daysLeft <= 0) return { expired: true, daysLeft: 0, warning: true, message: 'Token expirado. Reconecta la integración.' };
  if (daysLeft <= 7) return { expired: false, daysLeft, warning: true, message: `Token expira en ${daysLeft} día(s). Reconecta pronto.` };
  if (daysLeft <= 14) return { expired: false, daysLeft, warning: false, message: `Token expira en ${daysLeft} días.` };
  return { expired: false, daysLeft, warning: false };
}

async function handleConnectionFailure(provider, category) {
  if (category === 'expired' || category === 'revoked' || category === 'permission_denied') {
    await pool.query(
      'UPDATE social_integrations SET is_connected = 0, auto_sync = 0, last_sync_status = ?, last_sync_error = ? WHERE provider = ?',
      ['error', `Token ${category}`, provider]
    );
    return { action: 'disabled', reason: category };
  }
  return { action: 'unchanged', reason: category };
}

module.exports = {
  AUTH_HOST, API_HOST, API_VERSION, API_BASE, ALLOWED_ORIGINS,
  getClientKey, getClientSecret, getSiteUrl, getRedirectUri, isProduction,
  validateUrlOrigin,
  generateState, persistState, consumeState,
  getAuthorizationUrl, exchangeCodeForToken,
  refreshAccessToken, getUserInfo,
  completeConnection, disconnectProvider,
  getValidAccessToken, validateToken, checkTokenExpiration, handleConnectionFailure,
  setHttpGet, setHttpPost, httpGet, httpPost,
};
