/**
 * Production npm prestart hook. A successful process exit allows npm to launch
 * the separate `node app.js` start process with a fresh database pool.
 */
async function runPrestart({
  environment = process.env.NODE_ENV,
  migrate,
  closeMigrationPool,
} = {}) {
  if (environment !== 'production') {
    console.log('[prestart] Non-production environment; deploy migrations skipped.');
    return { skipped: true };
  }

  const deploy = migrate && closeMigrationPool
    ? { run: migrate, closePool: closeMigrationPool }
    : require('./migrate-deploy');
  let migrationError;

  try {
    console.log('[prestart] Production migration lifecycle beginning.');
    await deploy.run();
    console.log('[prestart] Migrations complete; application startup may begin.');
    return { skipped: false };
  } catch (error) {
    migrationError = error;
    console.error('[prestart] Migration failed — application will not start:', error.message);
    throw error;
  } finally {
    try {
      await deploy.closePool();
      console.log('[prestart] Migration database pool closed.');
    } catch (closeError) {
      if (!migrationError) throw closeError;
      console.error('[prestart] Migration pool cleanup also failed:', closeError.message);
    }
  }
}

if (require.main === module) {
  runPrestart().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = { runPrestart };
