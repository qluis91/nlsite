const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  DEFAULT_DB_PORT,
  parseDatabasePort,
  resolveDatabaseConfig,
} = require('../config/databaseConfig');

const root = path.join(__dirname, '..');

function loadCommonJs(relativePath, replacements, context = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const localRequire = (request) => {
    if (!Object.hasOwn(replacements, request)) {
      throw new Error(`Unexpected dependency: ${request}`);
    }
    return replacements[request];
  };
  const sandbox = {
    module,
    exports: module.exports,
    require: localRequire,
    __filename: filename,
    __dirname: path.dirname(filename),
    console: context.console || { log() {}, error() {} },
    process: context.process || { env: {} },
  };
  vm.runInNewContext(
    `(function (exports, require, module, __filename, __dirname) {${source}\n})(exports, require, module, __filename, __dirname);`,
    sandbox,
    { filename }
  );
  return module.exports;
}

test('database port parser preserves valid values and falls back safely', () => {
  const cases = [
    [undefined, DEFAULT_DB_PORT],
    ['', DEFAULT_DB_PORT],
    ['3307', 3307],
    ['invalid', DEFAULT_DB_PORT],
    ['NaN', DEFAULT_DB_PORT],
    [0, DEFAULT_DB_PORT],
    [-1, DEFAULT_DB_PORT],
    [65536, DEFAULT_DB_PORT],
  ];
  for (const [input, expected] of cases) {
    assert.equal(parseDatabasePort(input), expected, `unexpected port for ${String(input)}`);
  }
});

test('development resolution keeps explicit process values without TEST_DB variables', () => {
  const env = {
    NODE_ENV: 'development',
    DB_HOST: 'localhost',
    DB_PORT: '3307',
    DB_USER: 'local-user',
    DB_PASSWORD: 'local-password',
    DB_NAME: 'local-development',
  };
  const original = { ...env };
  assert.deepEqual(resolveDatabaseConfig(env), {
    host: 'localhost',
    port: 3307,
    user: 'local-user',
    password: 'local-password',
    database: 'local-development',
  });
  assert.deepEqual(env, original);
  assert.equal(Object.keys(env).some(key => key.startsWith('TEST_DB_')), false);
});

test('normal config/db export is the native PromisePool returned by mysql2', async () => {
  const state = { creates: 0, probes: 0, releases: 0 };
  const promisePool = {
    async getConnection() {
      state.probes += 1;
      return { release() { state.releases += 1; } };
    },
  };
  const exported = loadCommonJs('config/db.js', {
    mysql2: {
      createPool(options) {
        state.creates += 1;
        assert.equal(options.port, 3306);
        return { promise: () => promisePool };
      },
    },
    './environment': {
      isTestProcessContext: () => false,
      loadEnvironment() {},
    },
    './databaseConfig': {
      resolveValidatedDatabaseConfig: () => ({
        host: 'localhost', port: 3306, user: 'root', password: '', database: 'nlsite_db',
      }),
    },
  });
  assert.equal(exported, promisePool);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state, { creates: 1, probes: 1, releases: 1 });
});

test('test config/db facade stays lazy and forwards common pool operations', async () => {
  const state = { creates: 0, resolves: 0, queries: 0, connections: 0, ends: 0 };
  const promisePool = {
    async query(sql, params) {
      assert.equal(this, promisePool);
      state.queries += 1;
      return [sql, params];
    },
    async getConnection() {
      assert.equal(this, promisePool);
      state.connections += 1;
      return { release() {} };
    },
    async end() {
      assert.equal(this, promisePool);
      state.ends += 1;
    },
  };
  const db = loadCommonJs('config/db.js', {
    mysql2: {
      createPool() {
        state.creates += 1;
        return { promise: () => promisePool };
      },
    },
    './environment': {
      isTestProcessContext: () => true,
      loadEnvironment() {},
    },
    './databaseConfig': {
      resolveValidatedDatabaseConfig(options) {
        state.resolves += 1;
        assert.equal(options.requireMutationOptIn, true);
        assert.equal(Object.keys(options).length, 1);
        return { host: 'localhost', port: 3306, database: 'nlsite_test' };
      },
    },
  });

  assert.equal(state.creates, 0);
  const query = db.query;
  await query('SELECT fake', ['value']);
  await db.getConnection();
  await db.end();
  assert.deepEqual(state, { creates: 1, resolves: 1, queries: 1, connections: 1, ends: 1 });
});

test('test DB guard resolves before any pool is created', async () => {
  let creates = 0;
  const db = loadCommonJs('config/db.js', {
    mysql2: {
      createPool() {
        creates += 1;
        return { promise: () => ({}) };
      },
    },
    './environment': {
      isTestProcessContext: () => true,
      loadEnvironment() {},
    },
    './databaseConfig': {
      resolveValidatedDatabaseConfig() {
        throw new Error('unsafe test target');
      },
    },
  });
  await assert.rejects(() => db.query('SELECT blocked'), /unsafe test target/);
  assert.equal(creates, 0);
});

test('session guard resolves before store creation and normal options remain equivalent', () => {
  const order = [];
  let capturedOptions;
  const sessionModule = loadCommonJs('config/session.js', {
    'express-session': () => ({ middleware: true }),
    'express-mysql-session': () => class FakeStore {
      constructor(options) {
        order.push('store');
        capturedOptions = options;
      }
    },
    './databaseConfig': {
      resolveValidatedDatabaseConfig(options) {
        order.push('guard');
        assert.equal(options.requireMutationOptIn, false);
        assert.equal(Object.keys(options).length, 1);
        return {
          host: 'localhost', port: 3306, user: 'root', password: '', database: 'nlsite_db',
        };
      },
    },
  }, { process: { env: { NODE_ENV: 'development' } } });

  assert.deepEqual(order, ['guard', 'store']);
  assert.equal(sessionModule.sessionMaxAge, 8 * 60 * 60 * 1000);
  assert.deepEqual(JSON.parse(JSON.stringify(capturedOptions)), {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: 'nlsite_db',
    createDatabaseTable: true,
    expiration: 8 * 60 * 60 * 1000,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    schema: {
      tableName: 'sessions',
      columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' },
    },
  });
});

test('session store is not constructed when test database validation fails', () => {
  let stores = 0;
  assert.throws(() => loadCommonJs('config/session.js', {
    'express-session': () => ({}),
    'express-mysql-session': () => class FakeStore {
      constructor() { stores += 1; }
    },
    './databaseConfig': {
      resolveValidatedDatabaseConfig() { throw new Error('unsafe test target'); },
    },
  }, { process: { env: { NODE_ENV: 'test' } } }), /unsafe test target/);
  assert.equal(stores, 0);
});
