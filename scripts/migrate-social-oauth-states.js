/**
 * Migration 31 — OAuth state management table (Phase 2E-B).
 * Temporarily stores OAuth state parameters for CSRF protection.
 */
async function migrateSocialOAuthStates(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_oauth_states (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      state_id    VARCHAR(64)  NOT NULL,
      provider    VARCHAR(20)  NOT NULL,
      expires_at  TIMESTAMP    NOT NULL,
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_oauth_state (state_id),
      INDEX idx_oauth_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('✅ Social OAuth states migration complete.');
}

module.exports = { migrateSocialOAuthStates };
