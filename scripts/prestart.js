/**
 * Phase 13 — Pre-start hook: runs migrations automatically in production.
 *
 * In production, awaits migrate:deploy before the app starts.
 * If migration fails, the process exits non-zero, preventing app start.
 *
 * In development, does nothing (migrations run manually via npm run migrate).
 *
 * Wired as the "prestart" script in package.json.
 */
if (process.env.NODE_ENV === 'production') {
  const { run } = require('./migrate-deploy');
  run()
    .then(() => {
      console.log('[prestart] Migrations complete. Starting application...');
      process.exit(0);
    })
    .catch(err => {
      console.error('[prestart] Migration failed — application will not start:', err.message);
      process.exit(1);
    });
} else {
  process.exit(0);
}
