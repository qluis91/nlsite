const DATABASE_ENV_KEYS = Object.freeze([
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'DATABASE_URL', 'MYSQL_PWD', 'TEST_DB_ALLOW_CONNECTION',
  'TEST_DB_ALLOW_MUTATIONS', 'TEST_DB_ALLOW_REMOTE',
]);
const path = require('path');
const TEST_BOOTSTRAP_PATH = path.resolve(__dirname, 'testBootstrap.js');

function buildIsolatedTestEnvironment(base = process.env, overrides = {}, {
  includeBootstrap = true,
} = {}) {
  const isolated = { ...base };
  for (const key of DATABASE_ENV_KEYS) delete isolated[key];
  delete isolated.NODE_OPTIONS;
  Object.assign(isolated, overrides, { NODE_ENV: 'test' });
  if (includeBootstrap) {
    const bootstrapPath = TEST_BOOTSTRAP_PATH.replace(/\\/g, '/');
    isolated.NODE_OPTIONS = `--require="${bootstrapPath}"`;
  }
  return isolated;
}

module.exports = { DATABASE_ENV_KEYS, TEST_BOOTSTRAP_PATH, buildIsolatedTestEnvironment };
