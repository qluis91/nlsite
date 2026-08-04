/**
 * Social Sync Admin Controller — Phase 2E-B (Close).
 * List, configure, test, sync, disconnect, and OAuth flow with account selection.
 */
const crypto = require('node:crypto');
const { generateToken } = require('../config/csrf');
const syncService = require('../services/socialSyncService');
const validator = require('../validators/socialIntegrationValidator');
const youtubeService = require('../services/youtubeSyncService');
const metaOAuth = require('../services/metaOAuthService');

const BASE_PATH = '/admin/page/integrations';

function actorId(req) { return req.session?.user?.id || null; }

function csrfFor(req) {
  try { return generateToken(req); } catch { return ''; }
}

function ninja(key, type, text) {
  return { type, title: String(text || ''), id: key };
}

function setAlerts(req, alerts) {
  req.session.cms_alerts = alerts;
}

/**
 * Ensure a persistent session ID exists for OAuth state binding.
 * The session token from express-session isn't guaranteed stable,
 * so we generate a crypto ID stored in the admin session.
 */
function getOrCreateSessionId(req) {
  if (!req.session.metaOAuthSessionId) {
    req.session.metaOAuthSessionId = crypto.randomBytes(16).toString('hex');
  }
  return req.session.metaOAuthSessionId;
}

// ── Token redaction helper ──

function redactTokens(msg) {
  return String(msg)
    .replace(/EAA[0-9A-Za-z]{20,}/g, '[FACEBOOK_TOKEN]')
    .replace(/AIza[0-9A-Za-z\-_]{35}/g, '[API_KEY]')
    .replace(/ya29\.[0-9A-Za-z\-_]+/g, '[TOKEN]')
    .replace(/[0-9]{15,}/g, '[ID]');
}

// ── Structured diagnostic logging ──

function structuredLog(stage, provider, opts) {
  const ts = new Date().toISOString();
  const reqId = opts?.requestId || '';
  const sanitized = redactTokens(opts?.errorMsg || opts?.details || '');
  console.log(JSON.stringify({
    ts, provider: provider || 'meta', stage, reqId,
    status: opts?.success ? 'success' : 'failure',
    httpStatus: opts?.httpStatus || null,
    errorCode: opts?.errorCode || null,
    errorSubcode: opts?.errorSubcode || null,
    errorCategory: opts?.errorCategory || null,
    pages: opts?.pageCount ?? null,
    ig: opts?.igCount ?? null,
    detail: sanitized || undefined,
  }));
}

// ── Session save helper ──
// Express-session with resave:false may not auto-save before redirect.
// Explicit save ensures alerts and OAuth data persist across the redirect.
function saveSession(req) {
  return new Promise((resolve) => {
    req.session.save((err) => {
      if (err) console.error(JSON.stringify({ ts: new Date().toISOString(), stage: 'session_save_error', error: 'session_save_failed' }));
      resolve();
    });
  });
}

// ── Environment readiness helpers ──

function checkMetaEnv() {
  const missing = [];
  if (!process.env.META_APP_ID) missing.push('META_APP_ID');
  if (!process.env.META_APP_SECRET) missing.push('META_APP_SECRET');
  if (!process.env.META_CONFIG_ID) missing.push('META_CONFIG_ID');
  // META_GRAPH_API_VERSION has a default
  return missing;
}

function checkTikTokEnv() {
  const missing = [];
  if (!process.env.TIKTOK_CLIENT_KEY) missing.push('TIKTOK_CLIENT_KEY');
  if (!process.env.TIKTOK_CLIENT_SECRET) missing.push('TIKTOK_CLIENT_SECRET');
  return missing;
}

function checkSchedulerEnv() {
  const interval = parseInt(process.env.SOCIAL_SYNC_INTERVAL_MINUTES, 10);
  return !isNaN(interval) && interval >= 60;
}

function checkEncryptionEnv() {
  return !!process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
}

// ── List integrations ──

async function showList(req, res, next) {
  try {
    const integrations = await syncService.listIntegrations();
    const scheduler = require('../services/socialSyncScheduler');
    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;

    // Provider-specific credential warnings
    const credentialWarnings = {};
    for (const int of integrations) {
      if (int.provider === 'instagram' || int.provider === 'facebook') {
        const missing = checkMetaEnv();
        if (missing.length > 0) credentialWarnings[int.provider] = `Faltan variables de entorno: ${missing.join(', ')}`;
        if (!checkEncryptionEnv()) credentialWarnings[int.provider] = (credentialWarnings[int.provider] || '') + ' Falta SOCIAL_TOKEN_ENCRYPTION_KEY.';
      } else if (int.provider === 'tiktok') {
        const missing = checkTikTokEnv();
        if (missing.length > 0) credentialWarnings[int.provider] = `Faltan variables de entorno: ${missing.join(', ')}`;
        if (!checkEncryptionEnv()) credentialWarnings[int.provider] = (credentialWarnings[int.provider] || '') + ' Falta SOCIAL_TOKEN_ENCRYPTION_KEY.';
      } else if (int.provider === 'youtube') {
        if (!youtubeService.getYoutubeApiKey()) credentialWarnings[int.provider] = 'Falta YOUTUBE_API_KEY en las variables de entorno.';
      }
    }

    // Check token expiration for Meta and TikTok integrations
    const expirationWarnings = [];
    for (const int of integrations) {
      if (int.provider === 'instagram' || int.provider === 'facebook') {
        if (int.is_connected) {
          const expCheck = await metaOAuth.checkTokenExpiration(int.provider);
          if (expCheck) {
            int._tokenExpiration = expCheck;
            if (expCheck.warning) expirationWarnings.push(`${int.label}: ${expCheck.message}`);
          }
        }
      } else if (int.provider === 'tiktok' && int.is_connected) {
        const tiktokOAuth = require('../services/tiktokOAuthService');
        const expCheck = await tiktokOAuth.checkTokenExpiration(int.provider);
        if (expCheck) {
          int._tokenExpiration = expCheck;
          if (expCheck.warning) expirationWarnings.push(`${int.label}: ${expCheck.message}`);
        }
      }
    }

    res.render('pages/admin/page/integrations/list', {
      title: 'Integraciones sociales',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      csrfToken: csrfFor(req),
      integrations,
      pageAlerts,
      hasApiKey: !!youtubeService.getYoutubeApiKey(),
      schedulerEnabled: scheduler.isSchedulerEnabled(),
      schedulerIntervalMs: scheduler.effectiveIntervalMs(),
      schedulerRunning: scheduler.isRunning(),
      expirationWarnings,
      credentialWarnings,
    });
  } catch (error) {
    next(error);
  }
}

// ── Edit integration ──

async function showEdit(req, res, next) {
  try {
    const provider = String(req.query.provider || '').trim();
    if (!validator.ALLOWED_PROVIDERS.includes(provider)) {
      return res.redirect(BASE_PATH);
    }

    // Meta/TikTok providers use different config view
    if (provider === 'instagram' || provider === 'facebook' || provider === 'tiktok') {
      const integration = await syncService.getIntegration(provider);
      if (!integration) {
        setAlerts(req, [ninja('nf', 'error', 'Integración no encontrada.')]);
        return res.redirect(BASE_PATH);
      }

      const pageAlerts = req.session?.cms_alerts || [];
      if (req.session?.cms_alerts) delete req.session.cms_alerts;

      // Check token expiration
      let expCheck = null;
      if (integration.is_connected) {
        if (provider === 'tiktok') {
          const tiktokOAuth = require('../services/tiktokOAuthService');
          expCheck = await tiktokOAuth.checkTokenExpiration(provider);
        } else {
          expCheck = await metaOAuth.checkTokenExpiration(provider);
        }
      }

      // Use provider-specific config view
      const viewName = provider === 'tiktok'
        ? 'pages/admin/page/integrations/tiktok-config'
        : 'pages/admin/page/integrations/meta-config';

      const hasCredentials = provider === 'tiktok'
        ? !!require('../services/tiktokOAuthService').getClientKey()
        : !!metaOAuth.getAppId();

      return res.render(viewName, {
        title: `Configurar ${provider === 'instagram' ? 'Instagram' : provider === 'facebook' ? 'Facebook' : 'TikTok'}${provider === 'tiktok' ? '' : ' — Meta'}`,
        layout: 'layouts/admin',
        pageStyles: ['/css/admin-page.css'],
        csrfToken: csrfFor(req),
        provider,
        integration: {
          ...integration,
          config_json: typeof integration.config_json === 'string'
            ? JSON.parse(integration.config_json)
            : (integration.config_json || {}),
        },
        pageAlerts,
        hasCredentials,
        tokenExpiration: expCheck,
      });
    }

    const integration = await syncService.getIntegration(provider);
    if (!integration) {
      setAlerts(req, [ninja('nf', 'error', 'Integración no encontrada.')]);
      return res.redirect(BASE_PATH);
    }

    const config = integration.config_json || {};

    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;

    const formErrors = req.session?.integration_form_errors || [];
    const formData = req.session?.integration_form || {};
    delete req.session.integration_form_errors;
    delete req.session.integration_form;

    res.render('pages/admin/page/integrations/youtube-config', {
      title: 'Configurar YouTube — Integraciones',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      csrfToken: csrfFor(req),
      integration: {
        ...integration,
        config,
      },
      form: formData.channelId ? formData : {
        channelId: config.channelId || '',
        maxVideos: config.maxVideos || youtubeService.DEFAULT_MAX_VIDEOS,
        isEnabled: integration.is_enabled,
        autoSync: integration.auto_sync,
        requireApproval: integration.require_approval,
        defaultPublished: config.defaultPublished || false,
      },
      errors: formErrors,
      pageAlerts,
      hasApiKey: !!youtubeService.getYoutubeApiKey(),
    });
  } catch (error) {
    next(error);
  }
}

// ── Save configuration ──

async function saveConfig(req, res, next) {
  try {
    const provider = String(req.body.provider || '').trim();
    if (!validator.ALLOWED_PROVIDERS.includes(provider)) {
      return res.redirect(BASE_PATH);
    }

    // Meta providers handle config differently (OAuth-based connection)
    if (provider === 'instagram' || provider === 'facebook') {
      const isEnabled = req.body.isEnabled === '1' || req.body.isEnabled === true;
      const autoSync = req.body.autoSync === '1' || req.body.autoSync === true;
      const requireApproval = req.body.requireApproval === '0' ? false : true;
      const defaultPublished = req.body.defaultPublished === '1';
      const maxPosts = Math.min(100, Math.max(1, Number(req.body.maxPosts) || 25));

      // Merge with existing config_json to preserve page/IG IDs
      const integration = await syncService.getIntegration(provider);
      const existingConfig = typeof integration?.config_json === 'string'
        ? JSON.parse(integration.config_json)
        : (integration?.config_json || {});

      await syncService.saveIntegration(provider, {
        configJson: { ...existingConfig, maxPosts, defaultPublished },
        isEnabled,
        autoSync,
        requireApproval,
        isConnected: integration?.is_connected || false,
      });

      setAlerts(req, [ninja('ok', 'success', 'Configuración guardada.')]);
      return res.redirect(BASE_PATH);
    }

    const validation = validator.validateIntegrationConfig(provider, req.body);
    if (!validation.valid) {
      req.session.integration_form_errors = validation.errors;
      req.session.integration_form = validation.sanitized;
      return res.redirect(`${BASE_PATH}/edit?provider=${provider}`);
    }

    const configJson = {
      channelId: validation.sanitized.channelId,
      maxVideos: validation.sanitized.maxVideos,
      defaultPublished: validation.sanitized.defaultPublished,
    };

    const apiKey = youtubeService.getYoutubeApiKey();
    const isConnected = apiKey && validation.sanitized.channelId;

    await syncService.saveIntegration(provider, {
      configJson,
      isEnabled: validation.sanitized.isEnabled,
      autoSync: validation.sanitized.autoSync,
      requireApproval: validation.sanitized.requireApproval,
      isConnected: isConnected && validation.sanitized.isEnabled,
    });

    setAlerts(req, [ninja('ok', 'success', 'Configuración guardada.')]);
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Test connection ──

async function testConnection(req, res, next) {
  try {
    const provider = String(req.body.provider || '').trim();
    if (!validator.ALLOWED_PROVIDERS.includes(provider)) {
      return res.redirect(BASE_PATH);
    }

    const result = await syncService.testConnection(provider);
    let msg = `Conexión con ${provider} exitosa.`;
    if (result.expirationWarning) msg += ` ⚠ ${result.expiresInDays ? `Token expira en ${result.expiresInDays} días.` : 'Reconecta pronto.'}`;
    setAlerts(req, [ninja('ok', 'success', msg)]);
    return res.redirect(BASE_PATH);
  } catch (error) {
    const safeMsg = redactTokens(error.message || 'Error al probar la conexión.');
    setAlerts(req, [ninja('err', 'error', safeMsg)]);
    return res.redirect(BASE_PATH);
  }
}

// ── Sync now ──

async function syncNow(req, res, next) {
  try {
    const provider = String(req.body.provider || '').trim();
    if (!validator.ALLOWED_PROVIDERS.includes(provider)) {
      return res.redirect(BASE_PATH);
    }

    const result = await syncService.syncProvider(provider);
    const parts = [];
    if (result.imported) parts.push(`${result.imported} importado(s)`);
    if (result.updated) parts.push(`${result.updated} actualizado(s)`);
    if (result.skipped) parts.push(`${result.skipped} omitido(s)`);
    if (result.errors?.length) parts.push(`${result.errors.length} error(es)`);

    setAlerts(req, [ninja('sync', result.errors?.length ? 'warning' : 'success',
      `Sincronización completada: ${parts.join(', ') || 'sin cambios'}.`
    )]);
    return res.redirect(BASE_PATH);
  } catch (error) {
    if (error.code === 'SYNC_IN_PROGRESS') {
      setAlerts(req, [ninja('lock', 'warning', error.message)]);
      return res.redirect(BASE_PATH);
    }
    const safeMsg = redactTokens(error.message || 'Error al sincronizar.');
    setAlerts(req, [ninja('err', 'error', safeMsg)]);
    return res.redirect(BASE_PATH);
  }
}

// ── Disconnect ──

async function disconnect(req, res, next) {
  try {
    const provider = String(req.body.provider || '').trim();
    if (!validator.ALLOWED_PROVIDERS.includes(provider)) {
      return res.redirect(BASE_PATH);
    }

    await syncService.disconnectProvider(provider);
    setAlerts(req, [ninja('dc', 'success', `Integración ${provider} desconectada.`)]);

    // Clear session-bound OAuth state
    delete req.session.metaOAuthSessionId;

    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Meta OAuth Flow ──

async function startMetaOAuth(req, res, next) {
  const reqId = crypto.randomBytes(6).toString('hex');
  try {
    const provider = String(req.query.provider || 'instagram').trim();
    structuredLog('oauth_start', provider, { requestId: reqId, success: true });
    const sessionId = getOrCreateSessionId(req);
    const { url } = metaOAuth.getAuthorizationUrl(provider, sessionId);
    return res.redirect(url);
  } catch (error) {
    structuredLog('oauth_start', 'meta', { requestId: reqId, errorMsg: error.message, errorCode: error.code || 'UNKNOWN' });
    const safeMsg = redactTokens(error.message || 'Error al iniciar OAuth con Meta.');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    await saveSession(req);
    return res.redirect(BASE_PATH);
  }
}

async function metaOAuthCallback(req, res, next) {
  const reqId = crypto.randomBytes(6).toString('hex');
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      structuredLog('callback_provider_error', 'meta', { requestId: reqId, errorMsg: error_description || error });
      setAlerts(req, [ninja('oauth', 'error', `Meta rechazó la conexión: ${error_description || 'Error del proveedor'}`)]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    if (!code) {
      structuredLog('callback_no_code', 'meta', { requestId: reqId, errorCategory: 'missing_code' });
      setAlerts(req, [ninja('oauth', 'error', 'No se recibió código de autorización.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    // Stage 1: Validate OAuth state
    const sessionId = req.session?.metaOAuthSessionId;
    structuredLog('callback_validate_state', 'meta', { requestId: reqId, success: true });

    // Stage 2: Exchange code for token
    const tokenData = await metaOAuth.exchangeCodeForToken(code, state, sessionId);
    structuredLog('callback_token_exchange', 'meta', { requestId: reqId, success: true });

    // Stage 3: Check granted permissions for diagnostics
    const permissions = await metaOAuth.getGrantedPermissions(tokenData.accessToken);
    structuredLog('callback_permissions', 'meta', {
      requestId: reqId, success: true,
      details: `granted:${permissions.granted.join(',') || 'none'}; declined:${permissions.declined.join(',') || 'none'}`,
    });

    // Stage 4: Discover Page + Instagram options
    const options = await metaOAuth.discoverAccountOptions(tokenData.accessToken);
    const validOptions = options.filter(o => o.page);
    structuredLog('callback_account_discovery', 'meta', {
      requestId: reqId, success: true,
      pageCount: options.length, igCount: options.filter(o => o.instagram).length,
    });

    if (validOptions.length === 0) {
      structuredLog('callback_no_pages', 'meta', { requestId: reqId, errorCategory: 'no_pages_found' });
      setAlerts(req, [ninja('oauth', 'error', 'No se encontraron Facebook Pages asociadas a esta cuenta. Verificá que la configuración de negocio (config_id) sea correcta y que hayás concedido todos los permisos solicitados.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    // Store token data and options in session for selection screen
    req.session.metaOAuthToken = tokenData.accessToken;
    req.session.metaOAuthExpiresIn = tokenData.expiresIn;
    req.session.metaOAuthOptions = validOptions;
    req.session.metaOAuthProvider = tokenData.provider;

    await saveSession(req);
    return res.redirect(`${BASE_PATH}/select-account`);
  } catch (error) {
    if (error.code === 'INVALID_STATE') {
      structuredLog('callback_invalid_state', 'meta', { requestId: reqId, errorCategory: 'invalid_state' });
      setAlerts(req, [ninja('oauth', 'error', 'Solicitud OAuth inválida, expirada o de otra sesión. Intenta conectar nuevamente.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }
    structuredLog('callback_error', 'meta', {
      requestId: reqId,
      errorMsg: error.message,
      errorCode: error.code || 'UNKNOWN',
      errorCategory: error.code || 'unknown',
      httpStatus: error.status || null,
      errorSubcode: error.data?.error?.error_subcode || null,
    });
    const safeMsg = redactTokens(error.message || 'Error al procesar la autorización de Meta.');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    await saveSession(req);
    return res.redirect(BASE_PATH);
  }
}

// ── Account selection screen ──

async function showSelectAccount(req, res, next) {
  try {
    const options = req.session?.metaOAuthOptions;
    const provider = req.session?.metaOAuthProvider;

    if (!options || options.length === 0) {
      setAlerts(req, [ninja('oauth', 'error', 'Sesión de selección expirada. Conecta nuevamente.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;

    return res.render('pages/admin/page/integrations/select-account', {
      title: 'Seleccionar cuenta — Meta',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      csrfToken: csrfFor(req),
      provider,
      options,
      pageAlerts,
    });
  } catch (error) {
    next(error);
  }
}

async function confirmSelection(req, res, next) {
  const reqId = crypto.randomBytes(6).toString('hex');
  try {
    const pageId = String(req.body.pageId || '').trim();
    const provider = req.session?.metaOAuthProvider;
    const accessToken = req.session?.metaOAuthToken;
    const expiresIn = req.session?.metaOAuthExpiresIn;
    const options = req.session?.metaOAuthOptions || [];

    if (!pageId || !accessToken || !provider) {
      setAlerts(req, [ninja('oauth', 'error', 'Selección inválida o sesión expirada.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    const selected = options.find(o => o.page.id === pageId);
    if (!selected) {
      setAlerts(req, [ninja('oauth', 'error', 'Página no encontrada en las opciones disponibles.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    // Environment readiness check before persistence
    const missingEnv = checkMetaEnv();
    if (missingEnv.length > 0) {
      structuredLog('account_selection_missing_env', 'meta', { requestId: reqId, errorMsg: missingEnv.join(', ') });
      setAlerts(req, [ninja('oauth', 'error', `Faltan variables de entorno requeridas: ${missingEnv.join(', ')}.`)]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }
    if (!checkEncryptionEnv()) {
      structuredLog('account_selection_missing_encryption', 'meta', { requestId: reqId, errorCategory: 'missing_encryption_key' });
      setAlerts(req, [ninja('oauth', 'error', 'Falta SOCIAL_TOKEN_ENCRYPTION_KEY en las variables de entorno.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    const sessionId = req.session?.metaOAuthSessionId;
    await metaOAuth.completeConnection(provider, accessToken, expiresIn, selected.page, selected.instagram, sessionId);
    structuredLog('account_selection_complete', provider, { requestId: reqId, success: true, pages: 1, ig: selected.instagram ? 1 : 0 });

    const pageDesc = selected.page.name ? ` (${selected.page.name})` : '';
    const igDesc = selected.instagram ? ` — Instagram: @${selected.instagram.username}` : '';
    setAlerts(req, [ninja('oauth', 'success', `Conectado a Meta${pageDesc}${igDesc}.`)]);

    // Clean up OAuth session data
    delete req.session.metaOAuthToken;
    delete req.session.metaOAuthExpiresIn;
    delete req.session.metaOAuthOptions;
    delete req.session.metaOAuthProvider;
    await saveSession(req);
    return res.redirect(BASE_PATH);
  } catch (error) {
    structuredLog('account_selection_error', 'meta', { requestId: reqId, errorMsg: error.message, errorCode: error.code || 'UNKNOWN', errorCategory: error.code || 'unknown' });
    const safeMsg = redactTokens(error.message || 'Error al confirmar selección de cuenta.');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    await saveSession(req);
    return res.redirect(BASE_PATH);
  }
}

// ── Switch Meta account (without re-OAuth) ──

async function switchMetaAccount(req, res, next) {
  const reqId = crypto.randomBytes(6).toString('hex');
  try {
    const pageId = String(req.body.pageId || '').trim();
    const provider = req.session?.metaOAuthProvider;
    const accessToken = req.session?.metaOAuthToken;
    const options = req.session?.metaOAuthOptions || [];

    if (!pageId || !accessToken || !provider) {
      setAlerts(req, [ninja('oauth', 'error', 'Selección inválida o sesión expirada.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    const selected = options.find(o => o.page.id === pageId);
    if (!selected) {
      setAlerts(req, [ninja('oauth', 'error', 'Página no encontrada en las opciones disponibles.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    const sessionId = req.session?.metaOAuthSessionId;
    await metaOAuth.completeConnection(provider, accessToken,
      req.session?.metaOAuthExpiresIn, selected.page, selected.instagram, sessionId);
    structuredLog('account_switch', provider, { requestId: reqId, success: true, pages: 1, ig: selected.instagram ? 1 : 0 });

    const igDesc = selected.instagram ? ` — Instagram: @${selected.instagram.username}` : '';
    setAlerts(req, [ninja('oauth', 'success', `Cuenta cambiada a ${selected.page.name}${igDesc}.`)]);

    delete req.session.metaOAuthToken;
    delete req.session.metaOAuthExpiresIn;
    delete req.session.metaOAuthOptions;
    delete req.session.metaOAuthProvider;
    await saveSession(req);
    return res.redirect(BASE_PATH);
  } catch (error) {
    structuredLog('account_switch_error', 'meta', { requestId: reqId, errorMsg: error.message, errorCode: error.code || 'UNKNOWN' });
    const safeMsg = redactTokens(error.message || 'Error al cambiar de cuenta.');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    await saveSession(req);
    return res.redirect(BASE_PATH);
  }
}

// ── TikTok OAuth Flow ──

async function startTikTokOAuth(req, res, next) {
  const reqId = crypto.randomBytes(6).toString('hex');
  try {
    const tiktokOAuth = require('../services/tiktokOAuthService');
    const provider = 'tiktok';
    structuredLog('tiktok_oauth_start', provider, { requestId: reqId, success: true });
    const sessionId = getOrCreateSessionId(req);
    const { url } = tiktokOAuth.getAuthorizationUrl(provider, sessionId);
    return res.redirect(url);
  } catch (error) {
    structuredLog('tiktok_oauth_start_error', 'tiktok', { requestId: reqId, errorMsg: error.message, errorCode: error.code || 'UNKNOWN' });
    const safeMsg = redactTokens(error.message || 'Error al iniciar OAuth con TikTok.');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    await saveSession(req);
    return res.redirect(BASE_PATH);
  }
}

async function tiktokOAuthCallback(req, res, next) {
  const reqId = crypto.randomBytes(6).toString('hex');
  try {
    const tiktokOAuth = require('../services/tiktokOAuthService');
    const { code, state, error, error_description } = req.query;

    if (error) {
      structuredLog('tiktok_callback_provider_error', 'tiktok', { requestId: reqId, errorMsg: error_description || error });
      setAlerts(req, [ninja('oauth', 'error', `TikTok rechazó la conexión: ${error_description || 'Error del proveedor'}`)]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    if (!code) {
      structuredLog('tiktok_callback_no_code', 'tiktok', { requestId: reqId, errorCategory: 'missing_code' });
      setAlerts(req, [ninja('oauth', 'error', 'No se recibió código de autorización.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }

    // Exchange code for token with session-bound state validation
    const sessionId = req.session?.metaOAuthSessionId;
    const tokenData = await tiktokOAuth.exchangeCodeForToken(code, state, sessionId);
    structuredLog('tiktok_token_exchange', 'tiktok', { requestId: reqId, success: true });

    // Complete connection (stores tokens and fetches user info)
    await tiktokOAuth.completeConnection('tiktok', tokenData, sessionId);
    structuredLog('tiktok_connection_complete', 'tiktok', { requestId: reqId, success: true });

    const displayName = tokenData.openId || 'TikTok';
    setAlerts(req, [ninja('oauth', 'success', `Conectado a TikTok (${displayName}).`)]);
    await saveSession(req);
    return res.redirect(BASE_PATH);
  } catch (error) {
    if (error.code === 'INVALID_STATE') {
      structuredLog('tiktok_callback_invalid_state', 'tiktok', { requestId: reqId, errorCategory: 'invalid_state' });
      setAlerts(req, [ninja('oauth', 'error', 'Solicitud OAuth inválida, expirada o de otra sesión. Intenta conectar nuevamente.')]);
      await saveSession(req);
      return res.redirect(BASE_PATH);
    }
    structuredLog('tiktok_callback_error', 'tiktok', {
      requestId: reqId, errorMsg: error.message, errorCode: error.code || 'UNKNOWN',
      errorCategory: error.code || 'unknown', httpStatus: error.status || null,
    });
    const safeMsg = redactTokens(error.message || 'Error al procesar la autorización de TikTok.');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    await saveSession(req);
    return res.redirect(BASE_PATH);
  }
}

module.exports = {
  redactTokens,
  structuredLog,
  saveSession,
  ninja,
  showList,
  showEdit,
  saveConfig,
  testConnection,
  syncNow,
  disconnect,
  startMetaOAuth,
  metaOAuthCallback,
  showSelectAccount,
  confirmSelection,
  switchMetaAccount,
  startTikTokOAuth,
  tiktokOAuthCallback,
  checkMetaEnv,
  checkTikTokEnv,
  checkEncryptionEnv,
};
