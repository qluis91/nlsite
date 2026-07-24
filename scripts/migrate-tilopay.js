/**
 * Idempotent migration: create tilopay_transactions table.
 *
 * Run: node scripts/migrate-tilopay.js
 */
const pool = require('../config/db');

async function migrate() {
  console.log('[migrate:tilopay] Starting...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tilopay_transactions (
      id BIGINT NOT NULL AUTO_INCREMENT,
      order_id INT NOT NULL,
      internal_reference VARCHAR(36) NOT NULL COMMENT 'UUID v4 for this payment attempt',
      idempotency_key VARCHAR(64) NOT NULL COMMENT 'SHA-256 of unique attempt payload',
      provider_transaction_id VARCHAR(100) DEFAULT NULL COMMENT 'Tilopay transaction identifier from API response',
      provider_session_token VARCHAR(500) DEFAULT NULL COMMENT 'SDK token from GetTokenSdk (ephemeral, not persisted beyond payment window)',
      status VARCHAR(20) NOT NULL DEFAULT 'creating'
        COMMENT 'creating | pending | approved | declined | cancelled | expired | failed | unknown',
      amount DECIMAL(10,2) NOT NULL COMMENT 'Server-authoritative amount at time of creation',
      currency VARCHAR(3) NOT NULL DEFAULT 'CRC' COMMENT 'ISO 4217 currency code',
      checkout_url VARCHAR(1000) DEFAULT NULL COMMENT 'Tilopay-hosted checkout/redirect URL',
      provider_created_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When the provider transaction was created',
      confirmed_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When payment was authoritatively confirmed',
      failed_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When payment definitively failed',
      failure_code VARCHAR(50) DEFAULT NULL COMMENT 'Sanitized failure category from provider',
      failure_message VARCHAR(500) DEFAULT NULL COMMENT 'Bounded sanitized failure description',
      raw_status VARCHAR(100) DEFAULT NULL COMMENT 'Last known raw provider status string (bounded)',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_tilopay_internal_ref (internal_reference),
      UNIQUE KEY idx_tilopay_idempotency (idempotency_key),
      UNIQUE KEY idx_tilopay_provider_id (provider_transaction_id),
      KEY idx_tilopay_order_created (order_id, created_at),
      KEY idx_tilopay_status (status),
      CONSTRAINT fk_tilopay_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Tilopay payment transaction attempts — one per initiation, reused on retry with new internal_reference'
  `);

  console.log('[migrate:tilopay] Complete.');
}

if (require.main === module) {
  migrate()
    .then(() => { console.log('Migration finished.'); process.exit(0); })
    .catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
}

module.exports = { migrate };
