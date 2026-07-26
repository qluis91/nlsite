/**
 * Phase 11D — Publication batches migration.
 *
 * Creates publication_batches and publication_batch_items tables.
 * Idempotent, additive, never overwrites existing data.
 *
 * Run: node scripts/migrate-publishing.js
 */
require('dotenv').config();
const pool = require('../config/db');

const TABLES_SQL = [
`CREATE TABLE IF NOT EXISTS publication_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'selected' COMMENT 'selected | homepage | module | restore',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | validating | published | failed | cancelled',
  summary VARCHAR(500) NULL,
  created_by INT NULL,
  published_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL,
  failed_at TIMESTAMP NULL,
  failure_reason VARCHAR(1000) NULL,
  UNIQUE KEY uq_publication_batches_public_id (public_id),
  INDEX idx_pb_scope (scope),
  INDEX idx_pb_status (status),
  INDEX idx_pb_created_by (created_by),
  INDEX idx_pb_created_at (created_at),
  CONSTRAINT fk_pb_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_pb_published_by FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

`CREATE TABLE IF NOT EXISTS publication_batch_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  module_key VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NULL,
  entity_id INT NULL,
  source_revision_id BIGINT NULL,
  published_revision_id BIGINT NULL,
  previous_published_snapshot JSON NULL,
  new_published_snapshot JSON NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | validated | published | failed | skipped',
  error_message VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pbi_batch_id (batch_id),
  INDEX idx_pbi_module_key (module_key),
  INDEX idx_pbi_status (status),
  CONSTRAINT fk_pbi_batch_id FOREIGN KEY (batch_id) REFERENCES publication_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_pbi_source_revision FOREIGN KEY (source_revision_id) REFERENCES content_revisions(id) ON DELETE SET NULL,
  CONSTRAINT fk_pbi_published_revision FOREIGN KEY (published_revision_id) REFERENCES content_revisions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

async function migratePublishing() {
  const connection = await pool.getConnection();
  try {
    for (const sql of TABLES_SQL) {
      await connection.query(sql);
    }
    console.log('  ✅ publication_batches, publication_batch_items');
  } finally {
    connection.release();
  }
}

module.exports = { migratePublishing };

if (require.main === module) {
  (async () => {
    try {
      await migratePublishing();
      console.log('Publishing migration complete.');
      process.exit(0);
    } catch (err) {
      console.error('Migration failed:', err.message);
      process.exit(1);
    }
  })();
}
