/**
 * Forward-only schema repair helpers for Cotización 3D cost_quotes.
 * Kept separate from the historical scripts/migrate-cost-quote.js.
 */
/** Columns that modern Cotización 3D persistence requires. */
const COST_QUOTES_REQUIRED_COLUMNS = Object.freeze([
  ['product_name', "VARCHAR(200) NOT NULL DEFAULT '' AFTER id"],
  ['payload', 'JSON NULL AFTER product_name'],
  ['workflow_status', "VARCHAR(20) NOT NULL DEFAULT 'pendiente' AFTER payload"],
  ['public_token', "VARCHAR(64) NOT NULL DEFAULT '' AFTER workflow_status"],
  ['client_email', 'VARCHAR(180) NULL AFTER public_token'],
  ['client_name', 'VARCHAR(150) NULL AFTER client_email'],
  ['total_crc', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER client_name'],
  ['linked_order_id', 'VARCHAR(64) NULL AFTER total_crc'],
  ['pdf_filename', 'VARCHAR(200) NULL AFTER linked_order_id'],
  ['workflow_data', 'JSON NULL AFTER pdf_filename'],
  ['created_by', 'INT NULL AFTER workflow_data'],
  ['created_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER created_by'],
  ['updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
]);

async function ensureColumn(db, table, col, def) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  if (row.cnt === 0) {
    await db.query(`ALTER TABLE ?? ADD COLUMN ?? ${def}`, [table, col]);
    console.log(`[migrate:cost-quote-repair] Added column ${col} to ${table}`);
    return true;
  }
  return false;
}

async function ensureCostQuotesColumns(db) {
  const added = [];
  for (const [col, def] of COST_QUOTES_REQUIRED_COLUMNS) {
    try {
      if (await ensureColumn(db, 'cost_quotes', col, def)) added.push(col);
    } catch (e) {
      console.warn(`[migrate:cost-quote-repair] Could not add column ${col}:`, e.message);
    }
  }
  return added;
}

module.exports = {
  COST_QUOTES_REQUIRED_COLUMNS,
  ensureColumn,
  ensureCostQuotesColumns,
};
