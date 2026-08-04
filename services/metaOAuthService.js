/**
 * Meta OAuth Service — Phase 2E-B (Close).
 *
 * Facebook Login for Business OAuth for Instagram + Facebook.
 * Configurable Graph API version, origin allowlist, session-bound state,
 * HTTPS enforcement, token lifecycle management.
 *
 * Does NOT implement PKCE (code_verifier/challenge).
 * Uses single-use, expiring OAuth state values bound to the admin session.
 */
const crypto = require('node:crypto');
const pool = require('../config/db');
const { storeToken, retrieveToken, deleteToken } = require('./tokenEncryptionService');

// ── Configurable constants ──

function getApiVersion() {
  return process.env.META_GRAPH_API_VERSION || 'v25.0';
}

function getBaseUrl() {
  return `https://graph.facebook.com/${getApiVersion()}`;
}

function getAppId() {
  return process.env.META_APP_ID || '';
}

function getAppSecret() {
  return process.env.META_APP_SECRET || '';
}

function getConfigId() {
  return process.env.META_CONFIG_ID || '';
}

function getSiteUrl() {
  return (process.env.SITE_URL || process.env.CALLBACK_BASE || 'http://localhost:3000').replace(/\/$/, '');
}

function getRedirectUri() {
  return `${getSiteUrl()}/admin/page/integrations/meta-callback`;
}

function isProduction(env) {
  const e = env || process.env.NODE_ENV;
  return e !== 'development' && e !== 'test';
}

// ── Origin allowlist ──

const ALLOWED_ORIGINS = Object.freeze([
  'graph.facebook.com',
  'www.facebook.com',
]);

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

// ── OAuth State (session-bound, expiring, single-use) ──

const STATE_EXPIRY_MS = 10 * 60_000; // 10 minutes

/**
 * Generate a cryptographically random state ID,
 * persist it in DB bound to the admin user's session ID.
 */
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

/**
 * Consume a state: validate existence, expiry, session binding, then delete.
 * Returns { provider } on success, null on failure.
 */
async function consumeState(stateId, expectedSessionId, provider) {
  // Clean expired states first
  await pool.query('DELETE FROM social_oauth_states WHERE expires_at < NOW()');

  const [[row]] = await pool.query(
    'SELECT id, provider, expires_at, session_id FROM social_oauth_states WHERE state_id = ? AND expires_at > NOW()',
    [stateId]
  );
  if (!row) return null;

  // Verify session binding
  if (row.session_id && expectedSessionId && row.session_id !== expectedSessionId) {
    // Cross-session attempt — consume the state to prevent reuse
    await pool.query('DELETE FROM social_oauth_states WHERE state_id = ?', [stateId]);
    return null;
  }

  // Verify provider match
  if (provider && row.provider !== provider) {
    await pool.query('DELETE FROM social_oauth_states WHERE state_id = ?', [stateId]);
    return null;
  }

  // Single-use: delete immediately
  await pool.query('DELETE FROM social_oauth_states WHERE state_id = ?', [stateId]);
  return { provider: row.provider };
}

// ── HTTP transport (mockable in tests) ──

const REQUEST_TIMEOUT_MS = 15000;

let _httpGet = null;
let _httpPost = null;
function setHttpGet(fn) { _httpGet = fn; }
function setHttpPost(fn) { _httpPost = fn; }

async function httpGet(url) {
  // Enforce origin allowlist
  if (process.env.NODE_ENV !== 'test') validateUrlOrigin(url);
  if (_httpGet) return _httpGet(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
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
  const appId = getAppId();
  if (!appId) throw Object.assign(new Error('META_APP_ID no configurada.'), { code: 'NO_APP_ID' });

  const configId = getConfigId();
  if (!configId) throw Object.assign(new Error('META_CONFIG_ID no configurada. Requerida para Facebook Login for Business.'), { code: 'NO_CONFIG_ID' });

  // Enforce HTTPS in production
  const redirectUri = getRedirectUri();
  if (isProduction() && !redirectUri.startsWith('https://')) {
    throw Object.assign(new Error('Callback URI must use HTTPS in production.'), { code: 'HTTPS_REQUIRED' });
  }

  const { id: stateId, sessionId: sid } = generateState(sessionId);

  const scopes = ['instagram_basic', 'pages_show_list', 'pages_read_engagement', 'business_management'];

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state: stateId,
    config_id: configId,
    scope: scopes.join(','),
    response_type: 'code',
  });

  // Persist state for validation (fire-and-forget, error caught in callback)
  persistState(stateId, provider, sid).catch(() => {});

  return { url: `https://www.facebook.com/${getApiVersion()}/dialog/oauth?${params.toString()}`, stateId };
}

async function exchangeCodeForToken(code, receivedState, sessionId) {
  // Validate state (session-bound, single-use, expiry)
  if (!receivedState) throw Object.assign(new Error('Missing state parameter.'), { code: 'INVALID_STATE' });
  const state = await consumeState(receivedState, sessionId);
  if (!state) throw Object.assign(new Error('Estado OAuth inválido, expirado o de otra sesión.'), { code: 'INVALID_STATE' });

  const appId = getAppId();
  const appSecret = getAppSecret();
  if (!appId || !appSecret) {
    throw Object.assign(new Error('META_APP_ID o META_APP_SECRET no configuradas.'), { code: 'NO_CREDENTIALS' });
  }

  const redirectUri = getRedirectUri();
  const { status, data } = await httpPost(`${getBaseUrl()}/oauth/access_token`, {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  if (status !== 200 || data.error) {
    const isAuth = data.error?.code === 190 || data.error?.type === 'OAuthException';
    const isTransient = status >= 500 || status === 429;
    throw Object.assign(new Error(data.error?.message || `OAuth error ${status}`), {
      code: 'OAUTH_ERROR', status, data, isAuthError: isAuth, retryable: !isAuth && isTransient,
    });
  }

  const shortLivedToken = data.access_token;
  if (!shortLivedToken) throw new Error('No access token in response.');

  // Exchange for long-lived token
  const longLived = await httpGet(
    `${getBaseUrl()}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`
  );

  const longToken = longLived.data?.access_token || shortLivedToken;
  const expiresIn = longLived.data?.expires_in || 5184000; // ~60 days default

  return {
    accessToken: longToken,
    expiresIn,
    tokenType: longLived.data?.token_type || 'bearer',
    provider: state.provider,
  };
}

// ── Account discovery ──

/**
 * Read granted and declined permissions from /me/permissions.
 * Returns { granted: string[], declined: string[] } for diagnostics.
 */
async function getGrantedPermissions(accessToken) {
  try {
    const { status, data } = await httpGet(
      `${getBaseUrl()}/me/permissions?access_token=${encodeURIComponent(accessToken)}`
    );
    if (status !== 200) return { granted: [], declined: [] };
    const permissions = data.data || [];
    return {
      granted: permissions.filter(p => p.status === 'granted').map(p => p.permission),
      declined: permissions.filter(p => p.status === 'declined').map(p => p.permission),
    };
  } catch {
    return { granted: [], declined: [] };
  }
}

async function getPages(accessToken) {
  const { status, data } = await httpGet(
    `${getBaseUrl()}/me/accounts?fields=id,name,access_token,picture,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(accessToken)}`
  );
  if (status !== 200) {
    throw Object.assign(new Error(`Page discovery failed: ${data?.error?.message || status}`), {
      code: 'PAGE_DISCOVERY_ERROR', status, authError: status === 401 || status === 403,
    });
  }
  return (data.data || []).map(p => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    picture: p.picture?.data?.url || '',
    instagram_business_account: p.instagram_business_account || null,
  }));
}

/**
 * Try Business-managed asset discovery when /me/accounts returns empty.
 * Only used when business_management permission is granted.
 * Steps:
 *   1. GET /me/businesses to get client business IDs.
 *   2. For each business, GET /BUSINESS_ID/client_pages to list owned pages.
 *   3. Use the same access_token (user token) for page access_token.
 */
async function discoverBusinessPages(accessToken) {
  try {
    // Step 1: Get business portfolios
    const businessRes = await httpGet(
      `${getBaseUrl()}/me/businesses?access_token=${encodeURIComponent(accessToken)}`
    );
    if (businessRes.status !== 200) return [];

    const businesses = businessRes.data?.data || [];
    const allPages = [];

    // Step 2: For each business, get client pages
    for (const biz of businesses) {
      try {
        const pagesRes = await httpGet(
          `${getBaseUrl()}/${biz.id}/client_pages?fields=id,name,access_token,picture,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(accessToken)}`
        );
        if (pagesRes.status === 200 && Array.isArray(pagesRes.data?.data)) {
          for (const p of pagesRes.data.data) {
            allPages.push({
              id: p.id,
              name: p.name,
              accessToken: p.access_token || null,
              picture: p.picture?.data?.url || '',
              instagram_business_account: p.instagram_business_account || null,
            });
          }
        }
      } catch {
        // Skip individual business failures
      }
    }

    return allPages;
  } catch {
    return [];
  }
}

async function getInstagramAccount(pageAccessToken, pageId) {
  // Now handled inline via instagram_business_account in getPages.
  // Kept for backward compatibility with discoverAccountOptions fallback.
  try {
    const { status, data } = await httpGet(
      `${getBaseUrl()}/${pageId}?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(pageAccessToken)}`
    );
    if (status !== 200) return null;
    const ig = data?.instagram_business_account;
    if (!ig) return null;
    return {
      id: ig.id,
      username: ig.username || '',
      name: ig.name || '',
      profilePicture: ig.profile_picture_url || '',
    };
  } catch {
    return null;
  }
}

/**
 * Discover all valid Page + Instagram options after OAuth.
 *
 * Flow:
 *   1. Try /me/accounts (works for personal-page grants or business with config_id).
 *   2. If empty and business_management is granted, try Business-managed asset discovery.
 *   3. Inline instagram_business_account from getPages to avoid extra API calls.
 */
async function discoverAccountOptions(accessToken) {
  const permissions = await getGrantedPermissions(accessToken);

  // Method 1: /me/accounts
  let pages = await getPages(accessToken);

  // Method 2: Business-managed asset discovery (fallback)
  if (pages.length === 0 && permissions.granted.includes('business_management')) {
    pages = await discoverBusinessPages(accessToken);
  }

  // Build options: inline IG data from getPages/discoverBusinessPages
  const options = [];
  for (const page of pages) {
    let ig = null;
    const igb = page.instagram_business_account;
    if (igb) {
      ig = {
        id: igb.id,
        username: igb.username || '',
        name: igb.name || '',
        profilePicture: igb.profile_picture_url || '',
      };
    } else if (page.accessToken) {
      // Fallback to separate API call only for pages from getPages
      ig = await getInstagramAccount(page.accessToken, page.id);
    }
    // Clone page without instagram_business_account raw object
    const cleanPage = {
      id: page.id, name: page.name, accessToken: page.accessToken, picture: page.picture,
    };
    options.push({ page: cleanPage, instagram: ig || null });
  }

  return options;
}

// ── Token management ──

async function completeConnection(provider, accessToken, expiresIn, pageData, igAccount, sessionId) {
  const accountId = pageData?.id || 'user';
  const expiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();

  // Store encrypted token with expiration metadata
  await storeToken(pool, provider, accountId, accessToken, {
    expiresAt,
    pageId: pageData?.id || null,
    pageName: pageData?.name || null,
    pageAccessToken: pageData?.accessToken || null,
    igUserId: igAccount?.id || null,
    igUsername: igAccount?.username || null,
    igName: igAccount?.name || null,
    connectedBy: sessionId || 'admin',
    connectedAt: new Date().toISOString(),
  });

  // Also store the Page access token under its own key for Facebook API calls
  if (pageData?.accessToken && pageData.id) {
    await storeToken(pool, 'facebook_page', pageData.id, pageData.accessToken, {
      expiresAt,
      pageId: pageData.id,
      pageName: pageData.name,
      connectedBy: sessionId || 'admin',
      connectedAt: new Date().toISOString(),
    });
  }

  // Store non-secret metadata in integration config
  const configJson = {
    pageId: pageData?.id || '',
    pageName: pageData?.name || '',
    pagePicture: pageData?.picture || '',
    igUserId: igAccount?.id || '',
    igUsername: igAccount?.username || '',
    igName: igAccount?.name || '',
    igProfilePicture: igAccount?.profilePicture || '',
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

/**
 * Switch the selected Page/account without re-OAuth.
 */
async function switchAccount(provider, accessToken, pageData, igAccount, sessionId) {
  const configJson = {
    pageId: pageData?.id || '',
    pageName: pageData?.name || '',
    pagePicture: pageData?.picture || '',
    igUserId: igAccount?.id || '',
    igUsername: igAccount?.username || '',
    igName: igAccount?.name || '',
    igProfilePicture: igAccount?.profilePicture || '',
    connectedAt: new Date().toISOString(),
  };

  await pool.query(
    `UPDATE social_integrations SET config_json = ?, is_connected = 1
     WHERE provider = ?`,
    [JSON.stringify(configJson), provider]
  );
}

async function disconnectProvider(provider, accountId = null) {
  if (accountId) {
    await deleteToken(pool, provider, accountId);
  } else {
    await pool.query('DELETE FROM social_token_secrets WHERE provider = ? OR provider = ?',
      [provider, 'facebook_page']);
  }

  await pool.query(
    `UPDATE social_integrations SET
       config_json = '{}', is_connected = 0, is_enabled = 0, auto_sync = 0,
       last_sync_status = NULL, last_sync_error = NULL
     WHERE provider = ?`,
    [provider]
  );
}

/**
 * Get the correct user access token for a provider.
 * For Facebook: uses the encrypted user token from social_token_secrets.
 * For Instagram: uses the same user token.
 */
async function getUserAccessToken(provider) {
  const [[intRow]] = await pool.query(
    'SELECT config_json FROM social_integrations WHERE provider = ? AND is_connected = 1',
    [provider]
  );
  if (!intRow) return null;

  const config = typeof intRow.config_json === 'string' ? JSON.parse(intRow.config_json) : (intRow.config_json || {});
  const accountId = config.pageId || 'user';

  const result = await retrieveToken(pool, provider, accountId);
  return result?.token || null;
}

/**
 * Get the Page access token for Facebook Page API calls.
 * Stored separately under provider='facebook_page'.
 */
async function getPageAccessToken(pageId) {
  if (!pageId) return null;
  const result = await retrieveToken(pool, 'facebook_page', pageId);
  return result?.token || null;
}

/**
 * Get the correct access token for the intended API call:
 * - Instagram media calls use the user token
 * - Facebook Page feed calls use the Page access token
 */
async function getAccessTokenForCall(provider, config) {
  if (provider === 'facebook') {
    const pageId = config?.pageId;
    if (pageId) {
      const pageToken = await getPageAccessToken(pageId);
      if (pageToken) return pageToken;
    }
  }
  return getUserAccessToken(provider);
}

// ── Token lifecycle ──

/**
 * Validate a token and categorize the result.
 */
async function validateToken(provider) {
  const token = await getUserAccessToken(provider);
  if (!token) return { valid: false, reason: 'no_token', category: 'missing' };

  try {
    const { status, data } = await httpGet(
      `${getBaseUrl()}/me?access_token=${encodeURIComponent(token)}`
    );
    if (status === 200 && data.id) {
      return { valid: true, userId: data.id, category: 'ok' };
    }
    if (status === 401 || status === 403) {
      const code = data?.error?.code;
      if (code === 190) {
        const subcode = data?.error?.error_subcode;
        if (subcode === 463 || subcode === 464) return { valid: false, reason: 'token_expired', category: 'expired' };
        if (subcode === 458 || subcode === 459 || subcode === 460) return { valid: false, reason: 'token_revoked', category: 'revoked' };
        return { valid: false, reason: 'auth_error', category: 'auth_error' };
      }
      if (code === 10 || code === 200) return { valid: false, reason: 'permission_denied', category: 'permission_denied' };
      return { valid: false, reason: data?.error?.message || 'auth_error', category: 'auth_error' };
    }
    return { valid: false, reason: data?.error?.message || `HTTP ${status}`, category: 'transient' };
  } catch {
    return { valid: false, reason: 'network_error', category: 'transient' };
  }
}

/**
 * Check token expiration and return warning if close.
 */
async function checkTokenExpiration(provider) {
  const [[intRow]] = await pool.query(
    'SELECT config_json FROM social_integrations WHERE provider = ? AND is_connected = 1',
    [provider]
  );
  if (!intRow) return null;

  const config = typeof intRow.config_json === 'string' ? JSON.parse(intRow.config_json) : (intRow.config_json || {});
  const expiresAt = config.tokenExpiresAt || config.connectedAt;
  if (!expiresAt) return null;

  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  const daysLeft = Math.ceil((expiry - now) / 86400000);

  if (daysLeft <= 0) return { expired: true, daysLeft: 0, warning: true, message: 'Token expirado. Reconecta la integración.' };
  if (daysLeft <= 7) return { expired: false, daysLeft, warning: true, message: `Token expira en ${daysLeft} día(s). Reconecta pronto.` };
  if (daysLeft <= 14) return { expired: false, daysLeft, warning: false, message: `Token expira en ${daysLeft} días.` };
  return { expired: false, daysLeft, warning: false };
}

/**
 * Handle a failed connection: disable auto-sync for expired/revoked tokens.
 */
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

// ── Exports ──

module.exports = {
  getApiVersion,
  getBaseUrl,
  getAppId,
  getAppSecret,
  getConfigId,
  getSiteUrl,
  getRedirectUri,
  isProduction,
  ALLOWED_ORIGINS,
  validateUrlOrigin,
  generateState,
  persistState,
  consumeState,
  getAuthorizationUrl,
  exchangeCodeForToken,
  getGrantedPermissions,
  getPages,
  discoverBusinessPages,
  getInstagramAccount,
  discoverAccountOptions,
  completeConnection,
  switchAccount,
  disconnectProvider,
  getUserAccessToken,
  getPageAccessToken,
  getAccessTokenForCall,
  validateToken,
  checkTokenExpiration,
  handleConnectionFailure,
  setHttpGet,
  setHttpPost,
  httpGet,
  httpPost,
};
