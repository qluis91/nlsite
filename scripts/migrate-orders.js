/** Idempotent orders, lifecycle and audit-history migration. */
const pool = require('../config/db');

async function hasColumn(table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function hasIndex(table, index) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
}

async function migrate() {
  console.log('[migrate:orders] Starting orders migration...');
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_reference VARCHAR(24) NOT NULL,
    user_id INT NULL,
    customer_name VARCHAR(120) NOT NULL,
    customer_email VARCHAR(180) NOT NULL,
    customer_phone VARCHAR(30) NOT NULL,
    delivery_method VARCHAR(30) NOT NULL,
    shipping_status VARCHAR(20) NOT NULL DEFAULT 'pending_quote',
    shipping_amount DECIMAL(10,2) NULL,
    payment_method VARCHAR(20) NOT NULL,
    payment_status VARCHAR(10) NOT NULL DEFAULT 'pending',
    order_status VARCHAR(40) NOT NULL DEFAULT 'pending_shipping_quote',
    province VARCHAR(60) NULL, canton VARCHAR(80) NULL, district VARCHAR(80) NULL,
    address_line VARCHAR(300) NULL, address_reference VARCHAR(200) NULL,
    product_subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
    final_total DECIMAL(10,2) NULL,
    idempotency_key VARCHAR(64) NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_orders_reference (order_reference),
    UNIQUE KEY uq_orders_idempotency (idempotency_key),
    INDEX idx_orders_user (user_id),
    INDEX idx_orders_status (payment_status, shipping_status),
    INDEX idx_orders_order_status_created (order_status, created_at),
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, product_id INT NOT NULL,
    product_name VARCHAR(160) NOT NULL, product_slug VARCHAR(180) NOT NULL,
    quantity INT NOT NULL, unit_price DECIMAL(10,2) NOT NULL, line_total DECIMAL(10,2) NOT NULL,
    primary_image VARCHAR(300) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_items_order (order_id), INDEX idx_order_items_product (product_id),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  if (!(await hasColumn('orders', 'order_status'))) {
    await pool.query('ALTER TABLE orders ADD COLUMN order_status VARCHAR(40) NULL AFTER payment_status');
  }
  await pool.query(`UPDATE orders SET order_status = CASE
    WHEN payment_status = 'paid' THEN 'payment_confirmed'
    WHEN shipping_status = 'pending_quote' THEN 'pending_shipping_quote'
    ELSE 'pending_payment' END
    WHERE order_status IS NULL OR order_status = ''`);
  await pool.query("ALTER TABLE orders MODIFY order_status VARCHAR(40) NOT NULL DEFAULT 'pending_shipping_quote'");

  const [[duplicates]] = await pool.query(
    'SELECT COUNT(*) AS total FROM (SELECT idempotency_key FROM orders GROUP BY idempotency_key HAVING COUNT(*) > 1) duplicate_keys'
  );
  if (Number(duplicates.total) > 0) {
    throw new Error('Migration stopped: duplicate order idempotency keys require manual review.');
  }
  if (!(await hasIndex('orders', 'uq_orders_idempotency'))) {
    await pool.query('ALTER TABLE orders ADD UNIQUE KEY uq_orders_idempotency (idempotency_key)');
  }
  if (!(await hasIndex('orders', 'idx_orders_order_status_created'))) {
    await pool.query('ALTER TABLE orders ADD INDEX idx_orders_order_status_created (order_status, created_at)');
  }

  await pool.query(`CREATE TABLE IF NOT EXISTS order_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    actor_user_id INT NULL,
    event_type VARCHAR(50) NOT NULL,
    from_status VARCHAR(40) NULL,
    to_status VARCHAR(40) NULL,
    metadata_json LONGTEXT NULL,
    note VARCHAR(500) NULL,
    migration_key VARCHAR(80) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_order_events_migration (order_id, migration_key),
    INDEX idx_order_events_order_created (order_id, created_at),
    INDEX idx_order_events_actor (actor_user_id),
    CONSTRAINT fk_order_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_events_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`INSERT INTO order_events
    (order_id, event_type, to_status, metadata_json, migration_key, created_at)
    SELECT o.id, 'imported_existing_order', o.order_status,
           '{"source":"migration","version":1}', 'initial-order-backfill-v1', o.created_at
      FROM orders o
      LEFT JOIN order_events e ON e.order_id = o.id AND e.migration_key = 'initial-order-backfill-v1'
     WHERE e.id IS NULL`);
  console.log('[migrate:orders] Orders migration complete.');
}

if (require.main === module) {
  migrate().then(() => pool.end()).then(() => process.exit(0))
    .catch((error) => { console.error('[migrate:orders]', error.message); pool.end().finally(() => process.exit(1)); });
}

module.exports = { migrate };
