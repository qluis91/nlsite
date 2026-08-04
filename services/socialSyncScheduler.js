/**
 * Social Sync Scheduler — Phase 2E-A auto-sync loop.
 *
 * Starts after the HTTP server is listening. Disabled by default.
 * Enable with environment variable SOCIAL_SYNC_INTERVAL_MINUTES (min 60).
 *
 * Railway-safe: advisory lock per sync run prevents duplicate imports
 * across multiple instances. No overlapping ticks in the same process.
 */

const pool = require('../config/db');

const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 60;
const INITIAL_DELAY_MS = 30_000; // 30s after startup

let _timer = null;
let _initialTimer = null;
let _running = false;
let _tickRunning = false;
let _unrefTimers = false; // tests set this so process exits cleanly

// ── Configuration ──

function getIntervalMinutes() {
  const raw = process.env.SOCIAL_SYNC_INTERVAL_MINUTES;
  if (!raw) return null; // disabled
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_INTERVAL_MINUTES) return MIN_INTERVAL_MINUTES;
  return n;
}

function isSchedulerEnabled() {
  return getIntervalMinutes() !== null;
}

function effectiveIntervalMs() {
  const min = getIntervalMinutes();
  if (!min) return null;
  return min * 60_000;
}

// ── Tick ──

async function tick() {
  if (_tickRunning) return; // overlapping guard
  _tickRunning = true;
  try {
    const [rows] = await pool.query(
      "SELECT provider FROM social_integrations WHERE is_enabled = 1 AND auto_sync = 1"
    );
    for (const { provider } of rows) {
      try {
        // Lazy-require so tests can mock without side effects
        const { syncProvider } = require('./socialSyncService');
        // Redact any keys from logs
        const result = await syncProvider(provider);
        const parts = [];
        if (result.imported) parts.push(`${result.imported} imported`);
        if (result.updated) parts.push(`${result.updated} updated`);
        if (result.skipped) parts.push(`${result.skipped} skipped`);
        console.log(`[social-sync] ${provider} completed: ${parts.join(', ') || 'no changes'}.`);
      } catch (err) {
        const safeMsg = String(err.message || err.code || 'unknown')
          .replace(/AIza[0-9A-Za-z\-_]{35}/g, '[REDACTED]')
          .replace(/ya29\.[0-9A-Za-z\-_]+/g, '[REDACTED]');
        console.error(`[social-sync] ${provider} failed: ${safeMsg}`);
      }
    }
  } catch (err) {
    // DB query failure: log but never crash
    console.error('[social-sync] DB error:', err.message);
  } finally {
    _tickRunning = false;
  }
}

// ── Start / stop ──

function start() {
  if (_running) return;
  const intervalMs = effectiveIntervalMs();
  if (!intervalMs) {
    console.log('[social-sync] Scheduler disabled (SOCIAL_SYNC_INTERVAL_MINUTES not set or below minimum).');
    return;
  }

  _running = true;
  const intervalMin = Math.round(intervalMs / 60_000);
  console.log(`[social-sync] Scheduler started. Interval: ${intervalMin} min. First check in ${INITIAL_DELAY_MS / 1000}s.`);

  // First tick after a safe delay (ensure DB, sessions, etc. are fully ready)
  _initialTimer = setTimeout(() => {
    if (!_running) return;
    tick().catch(() => {});

    // Then recurring
    _timer = setInterval(() => {
      if (!_running) return;
      tick().catch(() => {});
    }, intervalMs);
  }, INITIAL_DELAY_MS);
  if (_unrefTimers && _initialTimer) _initialTimer.unref();
}

function stop() {
  _running = false;
  if (_initialTimer) {
    clearTimeout(_initialTimer);
    _initialTimer = null;
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  console.log('[social-sync] Scheduler stopped.');
}

function isRunning() {
  return _running;
}

/**
 * For tests: mark timers as unref'd so the Node process exits cleanly
 * without waiting for the interval.
 */
function setUnrefTimers(unref) {
  _unrefTimers = Boolean(unref);
}

module.exports = {
  start,
  stop,
  isRunning,
  tick,
  isSchedulerEnabled,
  effectiveIntervalMs,
  getIntervalMinutes,
  setUnrefTimers,
  MIN_INTERVAL_MINUTES,
  DEFAULT_INTERVAL_MINUTES,
  INITIAL_DELAY_MS,
};
