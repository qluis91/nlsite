/**
 * Migration 28 — Social sync runs table (Phase 2E-A).
 * Logs each sync execution for auditing and quota tracking.
 */
async function migrateSocialSyncRuns(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_sync_runs (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      provider        VARCHAR(20)  NOT NULL,
      status          VARCHAR(20)  NOT NULL DEFAULT 'started',
      started_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at     TIMESTAMP    NULL DEFAULT NULL,
      imported_count  INT          NOT NULL DEFAULT 0,
      skipped_count   INT          NOT NULL DEFAULT 0,
      updated_count   INT          NOT NULL DEFAULT 0,
      error_message   TEXT         NULL,
      summary_json    JSON         NULL,
      INDEX idx_sync_runs_provider (provider),
      INDEX idx_sync_runs_started (started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('✅ Social sync runs migration complete.');
}

module.exports = { migrateSocialSyncRuns };
