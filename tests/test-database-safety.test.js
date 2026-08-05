const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const { loadEnvironment } = require('../config/environment');
const { assertSafeTestDatabase } = require('../config/testDatabaseGuard');
const { buildIsolatedTestEnvironment } = require('../config/testProcessEnvironment');

function optedInTestEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    TEST_DB_ALLOW_CONNECTION: 'true',
    ...overrides,
  };
}

test('test DB guard rejects nlsite_db even in test context', () => {
  assert.throws(
    () => assertSafeTestDatabase(
      { host: 'localhost', database: 'nlsite_db' },
      { env: optedInTestEnv() }
    ),
    (error) => error.code === 'TEST_DB_NAME_UNSAFE'
  );
});

test('test DB guard rejects a missing database name', () => {
  assert.throws(
    () => assertSafeTestDatabase(
      { host: 'localhost', database: '' },
      { env: optedInTestEnv() }
    ),
    (error) => error.code === 'TEST_DB_NAME_REQUIRED'
  );
});

test('test DB guard accepts the approved local nlsite_test database', () => {
  assert.deepEqual(
    assertSafeTestDatabase(
      { host: 'localhost', database: 'nlsite_test' },
      { env: optedInTestEnv() }
    ),
    { host: 'localhost', database: 'nlsite_test' }
  );
});

test('schema-changing tests require a separate mutation opt-in', () => {
  assert.throws(
    () => assertSafeTestDatabase(
      { host: '127.0.0.1', database: 'feature_test' },
      { env: optedInTestEnv(), requireMutationOptIn: true }
    ),
    (error) => error.code === 'TEST_DB_MUTATION_OPT_IN_REQUIRED'
  );
  assert.doesNotThrow(() => assertSafeTestDatabase(
    { host: '127.0.0.1', database: 'feature_test' },
    {
      env: optedInTestEnv({ TEST_DB_ALLOW_MUTATIONS: 'true' }),
      requireMutationOptIn: true,
    }
  ));
});

test('remote test hosts require explicit isolated-CI opt-in', () => {
  assert.throws(
    () => assertSafeTestDatabase(
      { host: 'db.example.test', database: 'nlsite_test' },
      { env: optedInTestEnv() }
    ),
    (error) => error.code === 'TEST_DB_HOST_UNSAFE'
  );
  assert.doesNotThrow(() => assertSafeTestDatabase(
    { host: 'db.example.test', database: 'nlsite_test' },
    { env: optedInTestEnv({ CI: 'true', TEST_DB_ALLOW_REMOTE: 'true' }) }
  ));
});

test('test environment loading selects .env.test and never .env', () => {
  const calls = [];
  const env = { NODE_ENV: 'test' };
  const result = loadEnvironment({
    env,
    dotenvImpl: { config: (options) => calls.push(options) },
  });
  assert.equal(result.filename, '.env.test');
  assert.equal(calls.some((options) => options.path.endsWith('.env')), false);
});

test('child-process isolation strips unsafe inherited DB variables', () => {
  const unsafeParent = {
    ...process.env,
    DB_HOST: 'localhost',
    DB_NAME: 'nlsite_db',
    DB_USER: 'development-user',
    DB_PASSWORD: 'not-forwarded',
    DATABASE_URL: 'mysql://development',
    MYSQL_PWD: 'not-forwarded',
  };
  const env = buildIsolatedTestEnvironment(unsafeParent, {}, { includeBootstrap: false });
  const child = spawnSync(process.execPath, [
    '-e',
    'process.stdout.write(JSON.stringify({nodeEnv:process.env.NODE_ENV,dbName:process.env.DB_NAME||null,dbHost:process.env.DB_HOST||null,databaseUrl:process.env.DATABASE_URL||null,mysqlPwd:process.env.MYSQL_PWD||null}))',
  ], { env, encoding: 'utf8' });

  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    nodeEnv: 'test', dbName: null, dbHost: null, databaseUrl: null, mysqlPwd: null,
  });
});
