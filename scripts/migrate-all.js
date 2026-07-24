/**
 * Safe production migration runner.
 * All individual migration scripts must be idempotent.
 *
 * Usage: npm run migrate
 *   or:  node scripts/migrate-all.js
 */
const { migrateUserAddresses } = require('./migrate-user-addresses');

(async () => {
  try {
    console.log('Running safe migrations...');
    await migrateUserAddresses();
    console.log('All migrations complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
})();
