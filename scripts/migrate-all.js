/**
 * Safe production migration runner.
 * All individual migration scripts must be idempotent.
 *
 * Usage: npm run migrate
 *   or:  node scripts/migrate-all.js
 */
const { migrateUserAddresses } = require('./migrate-user-addresses');
const { migrateCms } = require('./migrate-cms');
const { migrateNavigationItems } = require('./migrate-nav-items');
const { migratePanels } = require('./migrate-panels');
const { migratePublishing } = require('./migrate-publishing');
const { migrateCmsDraftPublish } = require('./migrate-cms-draft-publish');

(async () => {
  try {
    console.log('Running safe migrations...');
    await migrateUserAddresses();
    await migrateCms();
    await migrateNavigationItems();
    await migratePanels();
    await migratePublishing();
    await migrateCmsDraftPublish();
    console.log('All migrations complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
})();
