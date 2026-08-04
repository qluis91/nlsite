/**
 * Social Sync Service — Phase 2E-A.
 *
 * Orchestrates synchronization across social providers.
 * Handles advisory locks, sync-run logging, and manual/triggered syncs.
 */

const pool = require('../config/db');
const youtube = require('./youtubeSyncService');

const SYNC_LOCK_NAME = 'social_sync';
const SYNC_LOCK_TIMEOUT_SEC = 60;

// ── Lock helpers ──

async function acquireSyncLock(connection) {
  const [[{ locked }]] = await connection.query(
    'SELECT GET_LOCK(?, ?) AS locked',
    [SYNC_LOCK_NAME, SYNC_LOCK_TIMEOUT_SEC]
  );
  return locked === 1;
}

async function releaseSyncLock(connection) {
  await connection.query('SELECT RELEASE_LOCK(?)', [SYNC_LOCK_NAME]);
}

// ── Sync run logging ──

async function createSyncRun(conn, provider) {
  const [result] = await conn.query(
    'INSERT INTO social_sync_runs (provider, status) VALUES (?, ?)',
    [provider, 'started']
  );
  return result.insertId;
}

async function completeSyncRun(conn, runId, { status = 'completed', imported = 0, skipped = 0, updated = 0, error = null } = {}) {
  await conn.query(
    `UPDATE social_sync_runs
       SET status = ?, finished_at = NOW(), imported_count = ?, skipped_count = ?, updated_count = ?,
           error_message = COALESCE(?, error_message)
     WHERE id = ?`,
    [status, imported, skipped, updated, error ? String(error).slice(0, 65535) : null, runId]
  );
}

// ── Integration helpers ──

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function getIntegration(provider) {
  const [[row]] = await pool.query(
    'SELECT * FROM social_integrations WHERE provider = ?',
    [provider]
  );
  if (!row) return null;
  row.config_json = parseConfig(row.config_json);
  return row;
}

async function updateIntegrationCounts(conn, provider, { imported, skipped, updated }) {
  await conn.query(
    `UPDATE social_integrations SET
       imported_count = imported_count + ?, skipped_count = skipped_count + ?,
       updated_count = updated_count + ?, last_sync_at = NOW(), last_sync_status = 'success',
       last_sync_error = NULL
     WHERE provider = ?`,
    [imported, skipped, updated, provider]
  );
}

async function updateIntegrationError(conn, provider, error) {
  await conn.query(
    `UPDATE social_integrations SET
       last_sync_at = NOW(), last_sync_status = 'error',
       last_sync_error = ?
     WHERE provider = ?`,
    [String(error).slice(0, 65535), provider]
  );
}

// ── Sync dispatcher ──

async function executeProviderSync(conn, provider) {
  const intRow = await getIntegration(provider);
  if (!intRow || !intRow.is_enabled) {
    throw new Error(`Integración ${provider} no habilitada.`);
  }

  let result;
  let runId;
  try {
    runId = await createSyncRun(conn, provider);
    switch (provider) {
      case 'youtube':
        result = await youtube.syncYoutube(intRow);
        break;
      case 'instagram': {
        const ig = require('./instagramSyncService');
        result = await ig.syncInstagram(intRow);
        break;
      }
      case 'facebook': {
        const fb = require('./facebookSyncService');
        result = await fb.syncFacebook(intRow);
        break;
      }
      case 'tiktok': {
        const tk = require('./tiktokSyncService');
        result = await tk.syncTikTok(intRow);
        break;
      }
      default:
        throw new Error(`Proveedor no soportado: ${provider}`);
    }
    await updateIntegrationCounts(conn, provider, result);
    await completeSyncRun(conn, runId, {
      imported: result.imported,
      skipped: result.skipped,
      updated: result.updated,
    });
    return result;
  } catch (error) {
    if (runId) {
      await completeSyncRun(conn, runId, {
        status: 'failed',
        error: error.message,
        imported: result?.imported || 0,
        skipped: result?.skipped || 0,
        updated: result?.updated || 0,
      });
    }
    await updateIntegrationError(conn, provider, error.message);
    throw error;
  }
}

/**
 * Run sync for a provider. Uses advisory lock to prevent overlapping runs.
 */
async function syncProvider(provider) {
  const conn = await pool.getConnection();
  try {
    const locked = await acquireSyncLock(conn);
    if (!locked) {
      throw Object.assign(new Error('Ya hay una sincronización en curso.'), { code: 'SYNC_IN_PROGRESS' });
    }
    return await executeProviderSync(conn, provider);
  } finally {
    try { await releaseSyncLock(conn); } catch {}
    conn.release();
  }
}

/**
 * Test connection to a provider (without importing).
 */
async function testConnection(provider) {
  const intRow = await getIntegration(provider);
  if (!intRow) throw new Error(`Integración ${provider} no encontrada.`);

  switch (provider) {
    case 'youtube': {
      const apiKey = youtube.getYoutubeApiKey();
      if (!apiKey) throw new Error('YOUTUBE_API_KEY no configurada.');
      const channelId = youtube.getChannelId(intRow.config_json);
      if (!channelId) throw new Error('Channel ID no configurado.');
      // Resolve uploads playlist to verify credentials work
      const playlistId = await youtube.resolveUploadsPlaylistId(channelId, apiKey);
      return { provider, connected: true, playlistId };
    }
    case 'tiktok': {
      const tk = require('./tiktokOAuthService');
      const validation = await tk.validateToken(provider);
      const expiration = await tk.checkTokenExpiration(provider);
      return {
        provider, connected: validation.valid,
        ...validation,
        expirationWarning: expiration?.warning || false,
        expiresInDays: expiration?.daysLeft || null,
      };
    }
    case 'instagram':
    case 'facebook': {
      const meta = require('./metaOAuthService');
      const validation = await meta.validateToken(provider);
      const expiration = await meta.checkTokenExpiration(provider);
      return {
        provider, connected: validation.valid,
        ...validation,
        expirationWarning: expiration?.warning || false,
        expiresInDays: expiration?.daysLeft || null,
      };
    }
    default:
      throw new Error(`Proveedor no soportado: ${provider}`);
  }
}

/**
 * Disconnect a provider (clear config, no deletion).
 */
async function disconnectProvider(provider) {
  // For Meta/TikTok providers, also remove encrypted tokens
  if (provider === 'instagram' || provider === 'facebook' || provider === 'tiktok') {
    if (provider === 'tiktok') {
      const tk = require('./tiktokOAuthService');
      await tk.disconnectProvider(provider);
    } else {
      const meta = require('./metaOAuthService');
      await meta.disconnectProvider(provider);
    }
  } else {
    await pool.query(
      `UPDATE social_integrations SET
         config_json = '{}', is_connected = 0, is_enabled = 0, auto_sync = 0,
         last_sync_status = NULL, last_sync_error = NULL
       WHERE provider = ?`,
      [provider]
    );
  }
}

/**
 * Save integration configuration.
 */
async function saveIntegration(provider, config) {
  const intRow = await getIntegration(provider);
  if (!intRow) throw new Error(`Integración ${provider} no encontrada.`);

  const configJson = typeof config.configJson === 'object' ? config.configJson : {};

  // NEVER store secrets in config_json — they live in env vars only
  // The config_json only stores non-secret settings like channelId, maxVideos, etc.
  const safeConfig = { ...configJson };
  delete safeConfig.apiKey;
  delete safeConfig.clientSecret;
  delete safeConfig.accessToken;
  delete safeConfig.refreshToken;

  await pool.query(
    `UPDATE social_integrations SET
       config_json = ?, is_enabled = ?, auto_sync = ?, require_approval = ?, is_connected = ?
     WHERE provider = ?`,
    [
      JSON.stringify(safeConfig),
      config.isEnabled ? 1 : 0,
      config.autoSync ? 1 : 0,
      config.requireApproval ? 1 : 0,
      config.isConnected ? 1 : 0,
      provider,
    ]
  );
}

/**
 * List all integrations with status.
 */
async function listIntegrations() {
  const [rows] = await pool.query(
    'SELECT * FROM social_integrations ORDER BY provider ASC'
  );
  return rows.map(r => ({
    id: r.id,
    provider: r.provider,
    label: r.label,
    config: parseConfig(r.config_json),
    isConnected: Boolean(r.is_connected),
    isEnabled: Boolean(r.is_enabled),
    autoSync: Boolean(r.auto_sync),
    requireApproval: Boolean(r.require_approval),
    lastSyncAt: r.last_sync_at,
    lastSyncStatus: r.last_sync_status,
    lastSyncError: r.last_sync_error,
    importedCount: r.imported_count,
    skippedCount: r.skipped_count,
    updatedCount: r.updated_count,
  }));
}

/**
 * Get sync run history for a provider.
 */
async function getSyncRunHistory(provider, limit = 20) {
  const [rows] = await pool.query(
    'SELECT * FROM social_sync_runs WHERE provider = ? ORDER BY started_at DESC LIMIT ?',
    [provider, Math.min(100, Math.max(1, limit))]
  );
  return rows;
}

module.exports = {
  listIntegrations,
  getIntegration,
  saveIntegration,
  syncProvider,
  testConnection,
  disconnectProvider,
  getSyncRunHistory,
  executeProviderSync,
  acquireSyncLock,
  releaseSyncLock,
  SYNC_LOCK_NAME,
};
