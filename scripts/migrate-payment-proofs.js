/**
 * Migration: Payment Proofs — idempotent, safe to run multiple times.
 */
const pool = require('../config/db');

async function migrate() {
  console.log('[migrate:payment-proofs] Starting...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_proofs (
      id BIGINT NOT NULL AUTO_INCREMENT,
      order_id INT NOT NULL,
      submitted_by_user_id INT DEFAULT NULL,
      submission_source VARCHAR(20) NOT NULL COMMENT 'account | guest | recent',
      status VARCHAR(30) NOT NULL DEFAULT 'pending_review'
        COMMENT 'pending_review | approved | rejected',
      original_filename VARCHAR(255) DEFAULT NULL,
      stored_filename VARCHAR(255) NOT NULL,
      storage_path VARCHAR(500) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      file_size_bytes INT NOT NULL,
      image_width INT DEFAULT NULL,
      image_height INT DEFAULT NULL,
      submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP NULL DEFAULT NULL,
      reviewed_by_user_id INT DEFAULT NULL,
      rejection_reason VARCHAR(500) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_payment_proofs_order_created (order_id, created_at),
      KEY idx_payment_proofs_status (status),
      KEY idx_payment_proofs_submitter (submitted_by_user_id),
      KEY idx_payment_proofs_reviewer (reviewed_by_user_id),
      CONSTRAINT fk_payment_proofs_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_payment_proofs_submitter
        FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_payment_proofs_reviewer
        FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('[migrate:payment-proofs] Complete.');
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { migrate };
