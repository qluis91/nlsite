/**
 * Test bootstrap — loaded via `--require` (npm test) or NODE_OPTIONS (child process).
 *
 * Behaviour:
 *  1. Switches NODE_ENV to "test".
 *  2. Redirects ALL dotenv.config() calls to .env.test.
 *  3. Generates .env.test from .env.test.example if missing.
 *  4. Loads .env.test env vars.
 *  5. Runs the standalone bootstrap script (_runTestBootstrap.js) in a subprocess
 *     to create the test database, run schema.sql, and execute all migrations.
 *     This subprocess blocks until complete, so test files see a ready database.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_ENV_PATH = path.join(PROJECT_ROOT, '.env.test');
const TEST_ENV_EXAMPLE_PATH = path.join(PROJECT_ROOT, '.env.test.example');
const WORKER_SCRIPT = path.resolve(__dirname, '_runTestBootstrap.js');

// ── 1. Switch context ──────────────────────────────────────────────────
const preserveNodeEnv = process.env.NLSITE_TEST_BOOTSTRAP_PRESERVE_NODE_ENV === 'true';
if (!preserveNodeEnv) process.env.NODE_ENV = 'test';
process.env.NLSITE_TEST_BOOTSTRAPPED = 'true';

// ── 2. Redirect dotenv.config → .env.test ────────────────────────────
const originalConfig = dotenv.config.bind(dotenv);

dotenv.config = function testOnlyDotenvConfig(options = {}) {
  return originalConfig({
    ...options,
    path: TEST_ENV_PATH,
    override: false,
    quiet: true,
    processEnv: process.env,
  });
};

// ── 3. Generate .env.test from example if missing ─────────────────────
if (!fs.existsSync(TEST_ENV_PATH) && fs.existsSync(TEST_ENV_EXAMPLE_PATH)) {
  const example = fs.readFileSync(TEST_ENV_EXAMPLE_PATH, 'utf8');
  const generated = example
    .replace(/^TEST_DB_ALLOW_CONNECTION=.*$/m, 'TEST_DB_ALLOW_CONNECTION=true')
    .replace(/^TEST_DB_ALLOW_MUTATIONS=.*$/m, 'TEST_DB_ALLOW_MUTATIONS=true');
  fs.writeFileSync(TEST_ENV_PATH, generated, 'utf8');
}

// ── 4. Load .env.test ─────────────────────────────────────────────────
dotenv.config();

// ── 5. Bootstrap test database (blocks until complete) ────────────────
(function ensureTestDatabaseReady() {
  const dbName = process.env.DB_NAME;

  if (!dbName || (!dbName.endsWith('_test') && dbName !== 'nlsite_test')) {
    if (process.env.NLSITE_TEST_BOOTSTRAP_QUIET !== 'true') {
      console.warn(`[testBootstrap] Refusing unsafe database "${dbName}" (must end in _test).`);
    }
    return;
  }

  // Set the completion flag BEFORE running the subprocess. The subprocess
  // handles the actual work. When db.js later creates the lazy pool, it
  // sees this flag and skips its own bootstrap.
  process.env.__NLSITE_TEST_BOOTSTRAP_COMPLETE = 'true';

  try {
    execSync(`"${process.execPath}" "${WORKER_SCRIPT}"`, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_OPTIONS: '',  // Prevent recursive bootstrap loading
        DB_HOST: process.env.DB_HOST || 'localhost',
        DB_PORT: process.env.DB_PORT || '3306',
        DB_USER: process.env.DB_USER || 'root',
        DB_PASSWORD: process.env.DB_PASSWORD || '',
        DB_NAME: dbName,
        NLSITE_TEST_BOOTSTRAP_QUIET: 'true',
      },
      timeout: 120000,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (err) {
    console.warn(
      `[testBootstrap] Database bootstrap exited with code ${err.status || 'unknown'}.`
      + ' Tests may fail if database is unavailable.'
    );
  }
})();

// ── 6. Global cleanup: close pool and exit gracefully ─────────────────
// When all tests finish, mysql2 connection pools may leave lingering TCP
// sockets that prevent the event loop from draining. beforeExit fires
// when all scheduled work is done but handles remain. We close the pool
// and signal a clean exit — this is the standard Node.js pattern for
// closing persistent database connections in test suites.
(function installGlobalCleanup() {
  let cleaned = false;
  process.on('beforeExit', async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      const poolMod = require('../config/db');
      const pool = poolMod.default || poolMod;
      if (pool && typeof pool.end === 'function') {
        await pool.end().catch(() => {});
      }
    } catch (_) { /* ignore */ }
  });
})();
