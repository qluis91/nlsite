/**
 * Forward migration — public customer quote requests (separate from admin cost_quotes).
 * Idempotent.
 */
'use strict';

async function tableExists(pool, name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(rows[0].cnt) > 0;
}

async function migrateQuoteRequests(pool) {
  if (!(await tableExists(pool, 'quote_requests'))) {
    await pool.query(`
      CREATE TABLE quote_requests (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        public_id CHAR(36) NOT NULL,
        request_type VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        user_id INT NULL,
        customer_name VARCHAR(150) NOT NULL,
        customer_email VARCHAR(180) NOT NULL,
        customer_phone VARCHAR(80) NOT NULL DEFAULT '',
        subject VARCHAR(200) NOT NULL DEFAULT '',
        payload_json JSON NOT NULL,
        source_url VARCHAR(500) NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_quote_requests_public_id (public_id),
        KEY idx_quote_requests_type (request_type),
        KEY idx_quote_requests_status (status),
        KEY idx_quote_requests_created (created_at),
        KEY idx_quote_requests_user (user_id),
        CONSTRAINT fk_quote_requests_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await tableExists(pool, 'quote_request_files'))) {
    await pool.query(`
      CREATE TABLE quote_request_files (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quote_request_id BIGINT UNSIGNED NOT NULL,
        storage_path VARCHAR(500) NOT NULL,
        original_filename VARCHAR(255) NOT NULL DEFAULT '',
        mime_type VARCHAR(120) NOT NULL DEFAULT '',
        file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_quote_request_files_request (quote_request_id),
        CONSTRAINT fk_quote_request_files_request
          FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  console.log('✅ Quote requests migration complete.');
}

module.exports = { migrateQuoteRequests };
