const pool = require('../config/db');

async function migrate() {
  const conn = await pool.getConnection();
  try {
    const [[col]] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'carrier'"
    );
    if (Number(col.cnt) === 0) {
      await conn.query("ALTER TABLE orders ADD COLUMN carrier VARCHAR(40) NULL COMMENT 'Shipping carrier name' AFTER shipping_amount");
      console.log('Added orders.carrier');
    }
    const [[col2]] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'tracking_number'"
    );
    if (Number(col2.cnt) === 0) {
      await conn.query("ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(120) NULL COMMENT 'Carrier tracking number' AFTER carrier");
      console.log('Added orders.tracking_number');
    }
    const [[col3]] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'tracking_url'"
    );
    if (Number(col3.cnt) === 0) {
      await conn.query("ALTER TABLE orders ADD COLUMN tracking_url VARCHAR(500) NULL COMMENT 'Safe tracking URL' AFTER tracking_number");
      console.log('Added orders.tracking_url');
    }
    console.log('Tracking migration complete.');
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  const pool = require('../config/db');
  migrate()
    .then(() => { pool.end().catch(() => {}); process.exit(0); })
    .catch(err => { console.error(err); pool.end().catch(() => {}); process.exit(1); });
}

module.exports = { migrate };
