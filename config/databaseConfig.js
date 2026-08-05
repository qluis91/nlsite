const { isTestProcessContext } = require('./environment');
const { assertSafeTestDatabase } = require('./testDatabaseGuard');

const DEFAULT_DB_PORT = 3306;

function parseDatabasePort(value, fallback = DEFAULT_DB_PORT) {
  const fallbackPort = Number.isInteger(fallback) && fallback >= 1 && fallback <= 65535
    ? fallback
    : DEFAULT_DB_PORT;
  if (value === undefined || value === null || String(value).trim() === '') return fallbackPort;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallbackPort;
}

function resolveDatabaseConfig(env = process.env) {
  const test = isTestProcessContext(env);
  return {
    host: env.DB_HOST || 'localhost',
    port: parseDatabasePort(env.DB_PORT),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || (test ? '' : 'nlsite_db'),
  };
}

function resolveValidatedDatabaseConfig({
  env = process.env,
  requireMutationOptIn = false,
} = {}) {
  const config = resolveDatabaseConfig(env);
  if (isTestProcessContext(env)) {
    assertSafeTestDatabase(config, {
      env,
      requireConnectionOptIn: true,
      requireMutationOptIn,
    });
  }
  return config;
}

module.exports = {
  DEFAULT_DB_PORT,
  parseDatabasePort,
  resolveDatabaseConfig,
  resolveValidatedDatabaseConfig,
};
