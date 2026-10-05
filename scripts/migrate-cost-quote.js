/** Idempotent Cotización 3D migration (legacy parity). */
const pool = require('../config/db');

async function migrate() {
  console.log('[migrate:cost-quote] Starting cost-quote migration...');

  // Quote catalog (printers, materials, additionals) — legacy format
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

  // Base quotes table (with legacy-compatible columns)
  await pool.query(`CREATE TABLE IF NOT EXISTS cost_quotes (
    id VARCHAR(64) PRIMARY KEY,
    product_name VARCHAR(200) NOT NULL DEFAULT '',
    payload JSON NOT NULL COMMENT 'Full state snapshot (costs, discounts, products, export, etc.)',
    workflow_status VARCHAR(20) NOT NULL DEFAULT 'pendiente' COMMENT 'pendiente, enviada, pendiente_aprobacion, aprobada, sin_respuesta, cancelada',
    public_token VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'Unguessable public access token',
    client_email VARCHAR(180) NULL,
    client_name VARCHAR(150) NULL,
    total_crc DECIMAL(12,2) NOT NULL DEFAULT 0,
    linked_order_id VARCHAR(64) NULL,
    pdf_filename VARCHAR(200) NULL,
    workflow_data JSON NULL COMMENT 'Timestamps, proof metadata, email errors',
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_workflow_status (workflow_status),
    INDEX idx_public_token (public_token),
    INDEX idx_created_by (created_by)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── Add columns to existing table if they don't exist (safe migration) ──
  const ensureColumn = async (table, col, def) => {
    try {
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, col]
      );
      if (row.cnt === 0) {
        await pool.query(`ALTER TABLE ?? ADD COLUMN ?? ${def}`, [table, col]);
        console.log(`[migrate:cost-quote] Added column ${col} to ${table}`);
      }
    } catch (e) {
      console.warn(`[migrate:cost-quote] Could not add column ${col}:`, e.message);
    }
  };

  // Ensure legacy-parity columns exist (additive)
  await ensureColumn('cost_quotes', 'product_name', "VARCHAR(200) NOT NULL DEFAULT '' AFTER id");
  await ensureColumn('cost_quotes', 'payload', 'JSON NULL AFTER product_name');
  await ensureColumn('cost_quotes', 'workflow_status', "VARCHAR(20) NOT NULL DEFAULT 'pendiente' AFTER payload");
  await ensureColumn('cost_quotes', 'public_token', "VARCHAR(64) NOT NULL DEFAULT '' AFTER workflow_status");
  await ensureColumn('cost_quotes', 'linked_order_id', 'VARCHAR(64) NULL');
  await ensureColumn('cost_quotes', 'pdf_filename', 'VARCHAR(200) NULL');
  await ensureColumn('cost_quotes', 'workflow_data', 'JSON NULL');
  await ensureColumn('cost_quotes', 'client_name', 'VARCHAR(150) NULL');

  // ── Seed catalog: only if completely empty ──
  const [counts] = await pool.query("SELECT catalog_type, COUNT(*) AS cnt FROM cost_quote_catalog GROUP BY catalog_type");
  const countMap = {};
  counts.forEach(r => { countMap[r.catalog_type] = r.cnt; });

  if (!countMap.printer) {
    await pool.query(`INSERT INTO cost_quote_catalog (catalog_type, name, unit_cost, is_default, sort_order)
      VALUES ('printer', 'Impresora principal', 300, 1, 1)`);
    console.log('[migrate:cost-quote] Seeded default printer.');
  }
  if (!countMap.material) {
    await pool.query(`INSERT INTO cost_quote_catalog (catalog_type, name, unit_cost, is_default, sort_order)
      VALUES ('material', 'PLA estándar', 20500, 1, 1)`);
    console.log('[migrate:cost-quote] Seeded default material.');
  }

  // Migrate existing quotes from old schema to new schema if data exists
  try {
    const [existing] = await pool.query("SELECT id, title, status, products FROM cost_quotes WHERE payload IS NULL AND products IS NOT NULL LIMIT 1");
    if (existing.length > 0) {
      console.log('[migrate:cost-quote] Migrating legacy quotes to new payload format...');
      const [legacy] = await pool.query("SELECT id, title AS product_name, products, status FROM cost_quotes WHERE payload IS NULL");
      for (const row of legacy) {
        const productsArr = typeof row.products === 'string' ? JSON.parse(row.products) : (row.products || []);
        const payload = {
          costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100, designCost: 0 },
          discounts: { range10_50: 5, range50_100: 10, range100plus: 15 },
          discountRanges: { range10_50: { min: 10, max: 50 }, range50_100: { min: 50, max: 100 }, range100plus: { min: 100, max: null } },
          products: productsArr,
          export: { clientName: '', clientEmail: '', paymentTerms: 'Forma de pago: 50% de adelanto y 50% contra entrega.', warranty: 'Garantía: 3 meses por defectos de fabricación.' },
        };
        const status = normalizeStatus(row.status || 'draft');
        await pool.query(
          'UPDATE cost_quotes SET payload=?, workflow_status=?, public_token=? WHERE id=?',
          [JSON.stringify(payload), status, cryptoFake(16), row.id]
        );
      }
      console.log(`[migrate:cost-quote] Migrated ${legacy.length} legacy quotes.`);
    }
  } catch (e) {
    console.warn('[migrate:cost-quote] Legacy migration note:', e.message);
  }

  console.log('[migrate:cost-quote] Complete.');
}

function normalizeStatus(s) {
  const raw = String(s || 'pendiente').trim().toLowerCase().replace(/\s+/g, '_');
  if (raw === 'sent') return 'enviada';
  if (raw === 'approved') return 'aprobada';
  if (raw === 'draft') return 'pendiente';
  return (['pendiente', 'enviada', 'pendiente_aprobacion', 'aprobada', 'sin_respuesta', 'cancelada'].includes(raw)) ? raw : 'pendiente';
}

function cryptoFake(len) {
  return require('crypto').randomBytes(len).toString('hex');
}

module.exports = { migrate };
