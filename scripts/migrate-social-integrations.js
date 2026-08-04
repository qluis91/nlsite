/**
 * Migration 27 — Social integrations table (Phase 2E-A).
 * Stores provider integration configuration with encrypted secrets.
 */
async function migrateSocialIntegrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_integrations (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      provider        VARCHAR(20)  NOT NULL,
      label           VARCHAR(100) NOT NULL DEFAULT '',
      config_json     JSON         NULL,
      is_connected    TINYINT(1)   NOT NULL DEFAULT 0,
      is_enabled      TINYINT(1)   NOT NULL DEFAULT 0,
      auto_sync       TINYINT(1)   NOT NULL DEFAULT 0,
      require_approval TINYINT(1)  NOT NULL DEFAULT 1,
      last_sync_at    TIMESTAMP    NULL DEFAULT NULL,
      last_sync_status VARCHAR(20) NULL DEFAULT NULL,
      last_sync_error TEXT         NULL,
      imported_count  INT          NOT NULL DEFAULT 0,
      skipped_count   INT          NOT NULL DEFAULT 0,
      updated_count   INT          NOT NULL DEFAULT 0,
      created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_social_int_provider (provider),
      INDEX idx_social_int_enabled (is_enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Insert a default YouTube row so the admin can configure it
  const [[existing]] = await pool.query(
    "SELECT id FROM social_integrations WHERE provider = 'youtube'"
  );
  if (!existing) {
    await pool.query(
      `INSERT INTO social_integrations (provider, label, config_json, is_connected, is_enabled, auto_sync, require_approval)
       VALUES ('youtube', 'YouTube', '{}', 0, 0, 0, 1)`
    );
  }

  console.log('✅ Social integrations migration complete.');
}

module.exports = { migrateSocialIntegrations };
