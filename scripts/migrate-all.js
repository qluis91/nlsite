/**
 * Manual migration entrypoint. It deliberately uses the same complete,
 * checksum-verified registry and advisory lock as production prestart so
 * `npm run migrate` cannot omit catalog or other registered capabilities.
 */
const pool = require('../config/db');
const { run } = require('./migrate-deploy');

if (require.main === module) {
  run()
    .then(() => pool.end())
    .then(() => {
      console.log('All migrations complete.');
    })
    .catch(async (error) => {
      console.error('Migration failed:', error.message);
      await pool.end().catch(() => {});
      process.exitCode = error.message.startsWith('LOCKED') ? 2 : 1;
    });
}

module.exports = { run };
