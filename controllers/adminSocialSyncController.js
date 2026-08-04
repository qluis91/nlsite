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
  return { type, text, id: key };
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

// ── List integrations ──

async function showList(req, res, next) {
  try {
    const integrations = await syncService.listIntegrations();
    const scheduler = require('../services/socialSyncScheduler');
    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;

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
  try {
    const provider = String(req.query.provider || 'instagram').trim();
    const sessionId = getOrCreateSessionId(req);
    const { url } = metaOAuth.getAuthorizationUrl(provider, sessionId);
    return res.redirect(url);
  } catch (error) {
    const safeMsg = redactTokens(error.message || 'Error OAuth');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    return res.redirect(BASE_PATH);
  }
}

async function metaOAuthCallback(req, res, next) {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      setAlerts(req, [ninja('oauth', 'error', `Meta rechazó la conexión: ${error_description || error}`)]);
      return res.redirect(BASE_PATH);
    }

    if (!code) {
      setAlerts(req, [ninja('oauth', 'error', 'No se recibió código de autorización.')]);
      return res.redirect(BASE_PATH);
    }

    // Exchange code for token with session-bound state validation
    const sessionId = req.session?.metaOAuthSessionId;
    const tokenData = await metaOAuth.exchangeCodeForToken(code, state, sessionId);

    // Discover all Page + Instagram options
    const options = await metaOAuth.discoverAccountOptions(tokenData.accessToken);
    const validOptions = options.filter(o => o.page); // Must have at least a Page

    if (validOptions.length === 0) {
      setAlerts(req, [ninja('oauth', 'error', 'No se encontraron Facebook Pages asociadas a esta cuenta.')]);
      return res.redirect(BASE_PATH);
    }

    // Store token data and options in session for selection screen
    req.session.metaOAuthToken = tokenData.accessToken;
    req.session.metaOAuthExpiresIn = tokenData.expiresIn;
    req.session.metaOAuthOptions = validOptions;
    req.session.metaOAuthProvider = tokenData.provider;

    return res.redirect(`${BASE_PATH}/select-account`);
  } catch (error) {
    if (error.code === 'INVALID_STATE') {
      setAlerts(req, [ninja('oauth', 'error', 'Solicitud OAuth inválida, expirada o de otra sesión. Intenta conectar nuevamente.')]);
      return res.redirect(BASE_PATH);
    }
    const safeMsg = redactTokens(error.message || 'Error en callback OAuth');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
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
  try {
    const pageId = String(req.body.pageId || '').trim();
    const provider = req.session?.metaOAuthProvider;
    const accessToken = req.session?.metaOAuthToken;
    const expiresIn = req.session?.metaOAuthExpiresIn;
    const options = req.session?.metaOAuthOptions || [];

    if (!pageId || !accessToken || !provider) {
      setAlerts(req, [ninja('oauth', 'error', 'Selección inválida o sesión expirada.')]);
      return res.redirect(BASE_PATH);
    }

    const selected = options.find(o => o.page.id === pageId);
    if (!selected) {
      setAlerts(req, [ninja('oauth', 'error', 'Página no encontrada en las opciones disponibles.')]);
      return res.redirect(BASE_PATH);
    }

    const sessionId = req.session?.metaOAuthSessionId;
    await metaOAuth.completeConnection(provider, accessToken, expiresIn, selected.page, selected.instagram, sessionId);

    const pageDesc = selected.page.name ? ` (${selected.page.name})` : '';
    const igDesc = selected.instagram ? ` — Instagram: @${selected.instagram.username}` : '';
    setAlerts(req, [ninja('oauth', 'success', `Conectado a Meta${pageDesc}${igDesc}.`)]);

    // Clean up OAuth session data
    delete req.session.metaOAuthToken;
    delete req.session.metaOAuthExpiresIn;
    delete req.session.metaOAuthOptions;
    delete req.session.metaOAuthProvider;

    return res.redirect(BASE_PATH);
  } catch (error) {
    const safeMsg = redactTokens(error.message || 'Error al confirmar selección.');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    return res.redirect(BASE_PATH);
  }
}

// ── TikTok OAuth Flow ──

async function startTikTokOAuth(req, res, next) {
  try {
    const tiktokOAuth = require('../services/tiktokOAuthService');
    const provider = 'tiktok';
    const sessionId = getOrCreateSessionId(req);
    const { url } = tiktokOAuth.getAuthorizationUrl(provider, sessionId);
    return res.redirect(url);
  } catch (error) {
    const safeMsg = redactTokens(error.message || 'Error OAuth TikTok');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    return res.redirect(BASE_PATH);
  }
}

async function tiktokOAuthCallback(req, res, next) {
  try {
    const tiktokOAuth = require('../services/tiktokOAuthService');
    const { code, state, error, error_description } = req.query;

    if (error) {
      const desc = error_description || error;
      setAlerts(req, [ninja('oauth', 'error', `TikTok rechazó la conexión: ${desc}`)]);
      return res.redirect(BASE_PATH);
    }

    if (!code) {
      setAlerts(req, [ninja('oauth', 'error', 'No se recibió código de autorización.')]);
      return res.redirect(BASE_PATH);
    }

    // Exchange code for token with session-bound state validation
    const sessionId = req.session?.metaOAuthSessionId;
    const tokenData = await tiktokOAuth.exchangeCodeForToken(code, state, sessionId);

    // Complete connection (stores tokens and fetches user info)
    await tiktokOAuth.completeConnection('tiktok', tokenData, sessionId);

    const displayName = tokenData.openId || 'TikTok';
    setAlerts(req, [ninja('oauth', 'success', `Conectado a TikTok (${displayName}).`)]);

    return res.redirect(BASE_PATH);
  } catch (error) {
    if (error.code === 'INVALID_STATE') {
      setAlerts(req, [ninja('oauth', 'error', 'Solicitud OAuth inválida, expirada o de otra sesión. Intenta conectar nuevamente.')]);
      return res.redirect(BASE_PATH);
    }
    const safeMsg = redactTokens(error.message || 'Error en callback TikTok OAuth');
    setAlerts(req, [ninja('oauth', 'error', safeMsg)]);
    return res.redirect(BASE_PATH);
  }
}

module.exports = {
  redactTokens,
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
  startTikTokOAuth,
  tiktokOAuthCallback,
};
