const mysql = require('mysql2');
const { isTestProcessContext, loadEnvironment } = require('./environment');
const { resolveValidatedDatabaseConfig } = require('./databaseConfig');

loadEnvironment();

function createPromisePool(config) {
  return mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  }).promise();
}

function createLazyTestPool() {
  let pool = null;

  function getPool() {
    if (pool) return pool;
    const config = resolveValidatedDatabaseConfig({ requireMutationOptIn: true });
    pool = createPromisePool(config);
    return pool;
  }

  return Object.freeze({
    query(...args) {
      return getPool().query(...args);
    },
    getConnection(...args) {
      return getPool().getConnection(...args);
    },
    async end() {
      if (!pool) return;
      const active = pool;
      pool = null;
      await active.end();
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
