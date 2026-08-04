/**
 * Migration 33 — Seed TikTok integration (Phase 2E-C).
 * Idempotent: only inserts if the row doesn't already exist.
 * Preserves all historical migration files and checksums.
 */
async function migrateSeedTikTok(pool) {
  const [[existing]] = await pool.query(
    "SELECT id FROM social_integrations WHERE provider = 'tiktok'"
  );
  if (!existing) {
    await pool.query(
      `INSERT INTO social_integrations (provider, label, config_json, is_connected, is_enabled, auto_sync, require_approval)
       VALUES ('tiktok', 'TikTok', '{}', 0, 0, 0, 1)`
    );
  }

  console.log('✅ TikTok integration seed migration complete.');
}

module.exports = { migrateSeedTikTok };
