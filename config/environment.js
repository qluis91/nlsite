const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function isTestProcessContext(env = process.env) {
  return env.NODE_ENV === 'test' || typeof env.NODE_TEST_CONTEXT === 'string';
}

function loadEnvironment({ env = process.env, dotenvImpl = dotenv } = {}) {
  const test = isTestProcessContext(env);
  const filename = test ? '.env.test' : '.env';
  const envPath = path.join(PROJECT_ROOT, filename);

  if (fs.existsSync(envPath)) {
    dotenvImpl.config({
      path: envPath,
      override: false,
      processEnv: env,
      quiet: true,
    });
  }

  return Object.freeze({ test, filename, envPath, loaded: fs.existsSync(envPath) });
}

module.exports = {
  PROJECT_ROOT,
  isTestProcessContext,
  loadEnvironment,
};
