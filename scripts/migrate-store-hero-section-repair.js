/**
 * Forward repair — ensure tienda st-hero section exists.
 *
 * Some environments recorded migrateStoreHeroCms as ok while the st-hero
 * section row was never inserted. This repair is idempotent and reuses the
 * original store-hero migration logic without rewriting history.
 *
 * Run: node scripts/migrate-store-hero-section-repair.js
 */
require('dotenv').config();
const pool = require('../config/db');
const { migrateStoreHeroCms } = require('./migrate-store-hero-cms');

async function migrateStoreHeroSectionRepair() {
  await migrateStoreHeroCms();
  console.log('✅ Store hero section repair complete.');
}

if (require.main === module) {
  migrateStoreHeroSectionRepair()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Store hero section repair failed:', error.message);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { migrateStoreHeroSectionRepair };
