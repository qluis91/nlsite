/**
 * Migration 30 — Encrypted token secrets table (Phase 2E-B).
 * Stores AES-256-GCM encrypted OAuth tokens for Meta integrations.
 * Plaintext tokens NEVER touch disk.
 */
async function migrateSocialTokenSecrets(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_token_secrets (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      provider        VARCHAR(20)  NOT NULL,
      account_id      VARCHAR(100) NOT NULL,
      encrypted_data  BLOB         NOT NULL,
      iv              BINARY(12)   NOT NULL,
      auth_tag        BINARY(16)   NOT NULL,
      metadata_json   JSON         NULL,
      created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_token_secrets (provider, account_id),
      INDEX idx_token_provider (provider)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('✅ Social token secrets migration complete.');
}

module.exports = { migrateSocialTokenSecrets };
