/**
 * Forward repair: align legacy cost_quotes PK/required columns with the
 * proven Cotización 3D store (VARCHAR ids + payload-first writes).
 *
 * Idempotent. Does not edit historical migrate-cost-quote.js.
 */
require('dotenv').config();
const defaultPool = require('../config/db');
const { ensureCostQuotesColumns } = require('./migrate-cost-quote');

async function columnMeta(db, table, column) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [table, column]
  );
  return rows[0] || null;
}

async function ensureIndex(db, table, indexName, columnsSql) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?`,
    [table, indexName]
  );
  if (Number(row.cnt) > 0) return false;
  await db.query(`ALTER TABLE ?? ADD INDEX ?? (${columnsSql})`, [table, indexName]);
  return true;
}

async function migrateCostQuoteVarcharId(db = defaultPool) {
  console.log('[migrate:cost-quote-varchar-id] Starting…');

  // Guarantee payload-era columns even when migrateCostQuote was previously marked applied.
  await ensureCostQuotesColumns(db);

  const idCol = await columnMeta(db, 'cost_quotes', 'id');
  if (idCol && /int/i.test(String(idCol.DATA_TYPE))) {
    await db.query('ALTER TABLE cost_quotes MODIFY COLUMN id VARCHAR(64) NOT NULL');
    console.log('[migrate:cost-quote-varchar-id] Converted cost_quotes.id to VARCHAR(64)');
  }

  const titleCol = await columnMeta(db, 'cost_quotes', 'title');
  if (titleCol && titleCol.IS_NULLABLE === 'NO' && titleCol.COLUMN_DEFAULT == null) {
    await db.query("ALTER TABLE cost_quotes MODIFY COLUMN title VARCHAR(200) NOT NULL DEFAULT ''");
    console.log('[migrate:cost-quote-varchar-id] Added default for legacy title column');
  }

  const productsCol = await columnMeta(db, 'cost_quotes', 'products');
  if (productsCol && productsCol.IS_NULLABLE === 'NO') {
    // Keep JSON CHECK if present; empty array satisfies json_valid.
    await db.query("ALTER TABLE cost_quotes MODIFY COLUMN products LONGTEXT NULL");
    console.log('[migrate:cost-quote-varchar-id] Made legacy products nullable');
  }

  await ensureIndex(db, 'cost_quotes', 'idx_workflow_status', 'workflow_status');
  await ensureIndex(db, 'cost_quotes', 'idx_public_token', 'public_token');

  console.log('[migrate:cost-quote-varchar-id] Complete.');
}

if (require.main === module) {
  migrateCostQuoteVarcharId()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate:cost-quote-varchar-id] Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { migrateCostQuoteVarcharId };
