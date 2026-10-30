/**
 * Add electricity/wear printer cost columns to cost_quote_catalog.
 * Backfills existing printers: wear = unit_cost, electricity = 0 (parity).
 * Idempotent: does not overwrite already-configured splits.
 */
'use strict';

require('dotenv').config();
const defaultPool = require('../config/db');

async function columnExists(db, table, column) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row.cnt) > 0;
}

async function ensurePrinterCostColumns(db) {
  const added = [];
  if (!(await columnExists(db, 'cost_quote_catalog', 'electricity_cost_per_hour'))) {
    await db.query(
      `ALTER TABLE cost_quote_catalog
         ADD COLUMN electricity_cost_per_hour DECIMAL(10,2) NOT NULL DEFAULT 0
         AFTER unit_cost`
    );
    added.push('electricity_cost_per_hour');
    console.log('[migrate:cost-quote-printer-costs] Added electricity_cost_per_hour');
  }
  if (!(await columnExists(db, 'cost_quote_catalog', 'machine_wear_cost_per_hour'))) {
    await db.query(
      `ALTER TABLE cost_quote_catalog
         ADD COLUMN machine_wear_cost_per_hour DECIMAL(10,2) NOT NULL DEFAULT 0
         AFTER electricity_cost_per_hour`
    );
    added.push('machine_wear_cost_per_hour');
    console.log('[migrate:cost-quote-printer-costs] Added machine_wear_cost_per_hour');
  }
  return added;
}

/**
 * Backfill only printers that still look like the legacy single-rate model:
 * electricity = 0 AND wear = 0 AND unit_cost > 0.
 * Does not overwrite admin-configured splits.
 */
async function backfillLegacyPrinterSplits(db) {
  const [result] = await db.query(
    `UPDATE cost_quote_catalog
        SET electricity_cost_per_hour = 0,
            machine_wear_cost_per_hour = unit_cost
      WHERE catalog_type = 'printer'
        AND electricity_cost_per_hour = 0
        AND machine_wear_cost_per_hour = 0
        AND unit_cost > 0`
  );
  const affected = Number(result.affectedRows || 0);
  if (affected > 0) {
    console.log(
      '[migrate:cost-quote-printer-costs] Backfilled wear=unit_cost for ' +
        affected +
        ' printer(s)'
    );
  }
  return affected;
}

async function migrateCostQuotePrinterCosts(db = defaultPool) {
  console.log('[migrate:cost-quote-printer-costs] Starting…');
  await ensurePrinterCostColumns(db);
  await backfillLegacyPrinterSplits(db);
  console.log('[migrate:cost-quote-printer-costs] Complete.');
}

if (require.main === module) {
  migrateCostQuotePrinterCosts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate:cost-quote-printer-costs] Failed:', err.message);
      process.exit(1);
    });
}

module.exports = {
  migrateCostQuotePrinterCosts,
  ensurePrinterCostColumns,
  backfillLegacyPrinterSplits,
};
