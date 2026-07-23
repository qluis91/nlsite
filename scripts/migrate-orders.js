/**
 * Migration: Orders system — idempotent, safe to run multiple times.
 * Creates orders + order_items tables if they don't exist.
 */

const pool = require('../config/db');

async function migrate() {
  console.log('[migrate:orders] Starting orders migration...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_reference VARCHAR(24) NOT NULL UNIQUE COMMENT 'Public order number (NL-XXXXXX)',
      user_id INT NULL,
      customer_name VARCHAR(120) NOT NULL,
      customer_email VARCHAR(180) NOT NULL,
      customer_phone VARCHAR(30) NOT NULL,
      delivery_method VARCHAR(30) NOT NULL COMMENT 'local_pickup | uber_flash | private_courier | correos_cr',
      shipping_status VARCHAR(20) NOT NULL DEFAULT 'pending_quote' COMMENT 'not_required | pending_quote | quoted',
      shipping_amount DECIMAL(10,2) NULL DEFAULT NULL,
      payment_method VARCHAR(20) NOT NULL COMMENT 'sinpe | bank_transfer',
      payment_status VARCHAR(10) NOT NULL DEFAULT 'pending' COMMENT 'pending | paid',
      province VARCHAR(60) NULL,
      canton VARCHAR(80) NULL,
      district VARCHAR(80) NULL,
      address_line VARCHAR(300) NULL,
      address_reference VARCHAR(200) NULL,
      product_subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
      final_total DECIMAL(10,2) NULL DEFAULT NULL,
      idempotency_key VARCHAR(64) NOT NULL COMMENT 'SHA-256 hash for idempotency',
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_orders_reference (order_reference),
      INDEX idx_orders_user (user_id),
      INDEX idx_orders_idempotency (idempotency_key),
      INDEX idx_orders_status (payment_status, shipping_status),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(160) NOT NULL,
      product_slug VARCHAR(180) NOT NULL,
      quantity INT NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      line_total DECIMAL(10,2) NOT NULL,
      primary_image VARCHAR(300) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order_items_order (order_id),
      INDEX idx_order_items_product (product_id),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('[migrate:orders] Orders migration complete.');
}

// Auto-run if called directly
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { migrate };
