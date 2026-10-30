/**
 * Seed quotation emails into cost_quote_catalog (catalog_type = 'email').
 * Idempotent: skips seeding when any email rows already exist.
 * Does not edit historical migrate-cost-quote.js.
 */
'use strict';

require('dotenv').config();
const defaultPool = require('../config/db');

const LEGACY_EMAILS = [
  { email: 'info@ninjalab3d.com', label: 'Info', isDefault: false, sortOrder: 1 },
  { email: 'lquijano@ninjalab3d.com', label: 'Luis Quijano', isDefault: true, sortOrder: 2 },
  { email: 'badilla@ninjalab3d.com', label: 'Badilla', isDefault: false, sortOrder: 3 },
];

async function ensureNameColumnWidth(db) {
  try {
    const [[row]] = await db.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS maxLen
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'cost_quote_catalog'
          AND COLUMN_NAME = 'name'
        LIMIT 1`
    );
    if (row && Number(row.maxLen) > 0 && Number(row.maxLen) < 180) {
      await db.query(
        'ALTER TABLE cost_quote_catalog MODIFY COLUMN name VARCHAR(180) NOT NULL'
      );
      console.log('[migrate:cost-quote-emails] Widened cost_quote_catalog.name to VARCHAR(180)');
    }
  } catch (err) {
    console.warn('[migrate:cost-quote-emails] Could not widen name column:', err.message);
  }
}

async function migrateCostQuoteEmails(db = defaultPool) {
  console.log('[migrate:cost-quote-emails] Starting…');

  await ensureNameColumnWidth(db);

  const [[countRow]] = await db.query(
    "SELECT COUNT(*) AS total FROM cost_quote_catalog WHERE catalog_type = 'email'"
  );
  if (Number(countRow.total) > 0) {
    console.log('[migrate:cost-quote-emails] Email rows already present — skipping seed.');
    return;
  }

  for (const item of LEGACY_EMAILS) {
    await db.query(
      `INSERT INTO cost_quote_catalog
         (catalog_type, name, description, unit_cost, is_default, sort_order)
       VALUES ('email', ?, ?, 0, ?, ?)`,
      [item.email, item.label, item.isDefault ? 1 : 0, item.sortOrder]
    );
  }

  console.log('[migrate:cost-quote-emails] Seeded 3 legacy quotation emails.');
}

if (require.main === module) {
  migrateCostQuoteEmails()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate:cost-quote-emails] Failed:', err.message);
      process.exit(1);
    });
}

module.exports = { migrateCostQuoteEmails, LEGACY_EMAILS };
