const { isTestProcessContext } = require('./environment');

const LOCAL_TEST_HOSTS = Object.freeze(new Set(['localhost', '127.0.0.1', '::1']));
const TEST_DATABASE_PATTERN = /_test$/i;

function safetyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertSafeTestDatabase(config = {}, {
  env = process.env,
  requireConnectionOptIn = true,
  requireMutationOptIn = false,
} = {}) {
  if (!isTestProcessContext(env)) {
    throw safetyError('TEST_DB_CONTEXT_REQUIRED', 'Test database access requires an active test process context.');
  }

  const host = String(config.host || '').trim().toLowerCase();
  const database = String(config.database || '').trim();
  const databaseLower = database.toLowerCase();

  if (!database) {
    throw safetyError('TEST_DB_NAME_REQUIRED', 'Test database name is required; inherited defaults are not allowed.');
  }
  if (databaseLower === 'nlsite_db' || !TEST_DATABASE_PATTERN.test(database)) {
    throw safetyError(
      'TEST_DB_NAME_UNSAFE',
      `Refusing test database "${database}"; the name must be exactly nlsite_test or end in _test.`
    );
  }
  if (!host) {
    throw safetyError('TEST_DB_HOST_REQUIRED', 'Test database host is required.');
  }

  const remoteAllowed = env.CI === 'true' && env.TEST_DB_ALLOW_REMOTE === 'true';
  if (!LOCAL_TEST_HOSTS.has(host) && !remoteAllowed) {
    throw safetyError(
      'TEST_DB_HOST_UNSAFE',
      `Refusing remote test database host "${host}" without CI=true and TEST_DB_ALLOW_REMOTE=true.`
    );
  }
  if (requireConnectionOptIn && env.TEST_DB_ALLOW_CONNECTION !== 'true') {
    throw safetyError(
      'TEST_DB_CONNECTION_OPT_IN_REQUIRED',
      'Test database connections require TEST_DB_ALLOW_CONNECTION=true.'
    );
  }
  if (requireMutationOptIn && env.TEST_DB_ALLOW_MUTATIONS !== 'true') {
    throw safetyError(
      'TEST_DB_MUTATION_OPT_IN_REQUIRED',
      'Schema-changing or destructive tests require TEST_DB_ALLOW_MUTATIONS=true.'
    );
  }

  return Object.freeze({ host, database });
}

module.exports = {
  LOCAL_TEST_HOSTS,
  TEST_DATABASE_PATTERN,
  assertSafeTestDatabase,
};
