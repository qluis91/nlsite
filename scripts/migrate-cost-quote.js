/** Idempotent Cotización 3D migration. */
const pool = require('../config/db');

async function migrate() {
  console.log('[migrate:cost-quote] Starting cost-quote migration...');

  // Quote catalog (printers, materials, additionals)
  await pool.query(`CREATE TABLE IF NOT EXISTS cost_quote_catalog (
    id INT AUTO_INCREMENT PRIMARY KEY,
    catalog_type VARCHAR(20) NOT NULL COMMENT 'printer, material, additional',
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    unit_label VARCHAR(40) NULL,
    unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
    price DECIMAL(10,2) NULL,
    is_resin TINYINT(1) NOT NULL DEFAULT 0,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_catalog_type (catalog_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Saved quotes
  await pool.query(`CREATE TABLE IF NOT EXISTS cost_quotes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT 'draft, sent, approved',
    client_name VARCHAR(150) NULL,
    client_email VARCHAR(180) NULL,
    client_phone VARCHAR(30) NULL,
    delivery_days INT NULL,
    validity_days INT NULL DEFAULT 15,
    shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
    payment_terms VARCHAR(500) NULL DEFAULT '50% anticipo, 50% contra entrega.',
    warranty VARCHAR(500) NULL DEFAULT '30 días por defectos de fabricación.',
    extra_notes TEXT NULL,
    include_iva TINYINT(1) NOT NULL DEFAULT 0,
    quote_email VARCHAR(200) NULL,
    global_discount_enabled TINYINT(1) NOT NULL DEFAULT 0,
    global_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
    wholesale_enabled TINYINT(1) NOT NULL DEFAULT 0,
    wholesale_tiers JSON NULL COMMENT '[{min,max,pct}]',
    wholesale_scenario_qty INT NULL,
    design_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
    profit_pct DECIMAL(5,2) NOT NULL DEFAULT 100.00,
    alex_pct DECIMAL(5,2) NOT NULL DEFAULT 30.00,
    luis_pct DECIMAL(5,2) NOT NULL DEFAULT 70.00,
    hour_rate DECIMAL(10,2) NOT NULL DEFAULT 300.00,
    kg_price DECIMAL(10,2) NOT NULL DEFAULT 20500.00,
    selected_printer_id INT NULL,
    selected_material_id INT NULL,
    products JSON NOT NULL COMMENT 'Array of product line items',
    computed_totals JSON NULL COMMENT 'Cached computed totals for PDF',
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_created_by (created_by)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Seed default catalog entries if empty
  const [printers] = await pool.query("SELECT COUNT(*) AS cnt FROM cost_quote_catalog WHERE catalog_type='printer'");
  if (printers[0].cnt === 0) {
    await pool.query(`INSERT INTO cost_quote_catalog (catalog_type, name, unit_label, unit_cost, is_default, sort_order) VALUES
      ('printer', 'Ender 3', 'hora', 300.00, 1, 1),
      ('printer', 'Resina (SLA)', 'hora', 400.00, 0, 2),
      ('material', 'PLA', 'kg', 20500.00, 1, 1),
      ('material', 'PETG', 'kg', 22000.00, 0, 2),
      ('material', 'Resina Standard', 'kg', 30000.00, 0, 3)`);
  }

  const [additionals] = await pool.query("SELECT COUNT(*) AS cnt FROM cost_quote_catalog WHERE catalog_type='additional'");
  if (additionals[0].cnt === 0) {
    await pool.query(`INSERT INTO cost_quote_catalog (catalog_type, name, description, unit_label, unit_cost, price, sort_order) VALUES
      ('additional', 'Post-procesado', 'Lijado y acabado básico', 'unidad', 0, 500.00, 1),
      ('additional', 'Pintura', 'Pintura base + acabado', 'unidad', 0, 2000.00, 2)`);
  }

  console.log('[migrate:cost-quote] Complete.');
}

module.exports = { migrate };
