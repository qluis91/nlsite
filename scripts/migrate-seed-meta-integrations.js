/**
 * Migration 32 — Seed Instagram and Facebook integrations (Phase 2E-B close).
 * Idempotent: only inserts rows that don't already exist.
 * This is additive; does not modify historical migration 27.
 */
async function migrateSeedMetaIntegrations(pool) {
  const providers = [
    { provider: 'instagram', label: 'Instagram' },
    { provider: 'facebook', label: 'Facebook' },
  ];
  for (const { provider, label } of providers) {
    const [[existing]] = await pool.query(
      'SELECT id FROM social_integrations WHERE provider = ?',
      [provider]
    );
    if (!existing) {
      await pool.query(
        `INSERT INTO social_integrations (provider, label, config_json, is_connected, is_enabled, auto_sync, require_approval)
         VALUES (?, ?, '{}', 0, 0, 0, 1)`,
        [provider, label]
      );
    }
  }

  // Add session_id column to social_oauth_states if needed (Phase 2E-B close)
  const [[col]] = await pool.query(
    "SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_oauth_states' AND COLUMN_NAME = 'session_id'"
  );
  if (!col.cnt) {
    await pool.query(
      "ALTER TABLE social_oauth_states ADD COLUMN session_id VARCHAR(64) NULL AFTER provider, ADD INDEX idx_oauth_session (session_id)"
    );
  }

  console.log('✅ Meta integration seeds migration complete.');
}

module.exports = { migrateSeedMetaIntegrations };
