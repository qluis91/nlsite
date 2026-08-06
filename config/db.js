const mysql = require('mysql2');
const { isTestProcessContext, loadEnvironment } = require('./environment');
const { resolveValidatedDatabaseConfig } = require('./databaseConfig');

loadEnvironment();

// ── Production safety: detect tests running without test context ──────────
// When the process is a Node test runner but NODE_ENV is not 'test' and the
// bootstrap didn't run, abort immediately rather than silently hitting nlsite_db.
// Skip when loaded via unit-test mocks (NLSITE_TEST_SAFETY_CHECK_SKIP set).
(function assertSafeTestExecution() {
  if (process.env.NLSITE_TEST_SAFETY_CHECK_SKIP === 'true') return;

  // Guard against VM sandboxes where process is a mock without argv
  const argv = Array.isArray(process.argv) ? process.argv : [];
  const isTestRunner = argv.some(
    (arg) => typeof arg === 'string' && (arg.endsWith('.test.js') || arg.endsWith('.test.mjs'))
  ) || argv.includes('--test');

  if (!isTestRunner) return;

  if (!isTestProcessContext()) {
    console.error(
      '❌ SAFETY: Tests detected but NODE_ENV is not "test".\n'
      + '   Use: node --require ./config/testBootstrap.js --test tests/*.test.js\n'
      + '   Or set NODE_ENV=test and TEST_DB_ALLOW_CONNECTION=true.'
    );
    process.exit(1);
  }

  if (!process.env.NLSITE_TEST_BOOTSTRAPPED) {
    console.error(
      '❌ SAFETY: Tests detected but test bootstrap did not run.\n'
      + '   Use: node --require ./config/testBootstrap.js --test tests/*.test.js'
    );
    process.exit(1);
  }

  if (process.env.DB_NAME === 'nlsite_db') {
    console.error(
      '❌ SAFETY: Refusing to run tests against nlsite_db.\n'
      + '   Ensure .env.test sets DB_NAME=nlsite_test.'
    );
    process.exit(1);
  }
})();

// ── Pool factories ────────────────────────────────────────────────────────

function createPromisePool(config) {
  return mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  }).promise();
}

// ── Test-specific pool: minimal connections ──
function createTestPromisePool(config) {
  return mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
  }).promise();
}

// ── Lazy test pool (in-process tests) ────────────────────────────────────

function createLazyTestPool() {
  let pool = null;

  async function getPool() {
    if (pool) return pool;
    const config = resolveValidatedDatabaseConfig({ requireMutationOptIn: true });

    // If the global testBootstrap already completed (ran schema + migrations),
    // skip re-bootstrapping. This prevents deadlocks when migration modules
    // import the lazy pool during their execution.
    if (process.env.__NLSITE_TEST_BOOTSTRAP_COMPLETE === 'true') {
      pool = createTestPromisePool(config);
      return pool;
    }

    // If we're currently inside the bootstrap migration runner, return a
    // direct pool immediately to prevent deadlock. Migration modules import
    // 'pool' from db.js and call pool.getConnection() — the lazy pool must
    // not trigger a nested bootstrap.
    if (process.env.__NLSITE_TEST_BOOTSTRAP_RUNNING === 'true') {
      return createTestPromisePool(config);
    }

    pool = createTestPromisePool(config);
    return pool;
  }

  return Object.freeze({
    async query(...args) {
      const active = await getPool();
      return active.query(...args);
    },
    async getConnection(...args) {
      const active = await getPool();
      return active.getConnection(...args);
    },
    async end() {
      if (!pool) return;
      const active = pool;
      try {
        await active.end();
      } finally {
        pool = null;
      }
    },
  });
}

if (isTestProcessContext()) {
  // Pure test imports receive a lazy, guarded facade. No pool exists until a
  // test explicitly requests a database operation.
  module.exports = createLazyTestPool();
} else {
  // Preserve the original development/production contract: export the native
  // mysql2 PromisePool and eagerly probe the configured connection.
  const db = createPromisePool(resolveValidatedDatabaseConfig());
  db.getConnection()
    .then((connection) => {
      console.log('✅ Conexión exitosa a MySQL (nlsite_db)');
      connection.release();
    })
    .catch((error) => {
      console.error('❌ Error al conectar a la base de datos en XAMPP:', error.message);
    });
  module.exports = db;
}
