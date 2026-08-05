const path = require('path');
const dotenv = require('dotenv');

const preserveNodeEnv = process.env.NLSITE_TEST_BOOTSTRAP_PRESERVE_NODE_ENV === 'true';
if (!preserveNodeEnv) process.env.NODE_ENV = 'test';
process.env.NLSITE_TEST_BOOTSTRAPPED = 'true';

const testEnvPath = path.resolve(__dirname, '..', '.env.test');
const originalConfig = dotenv.config.bind(dotenv);

// Legacy migration modules call dotenv.config() directly. During tests, force
// every such call to the isolated test file without modifying those immutable,
// checksum-tracked migration sources.
dotenv.config = function testOnlyDotenvConfig(options = {}) {
  return originalConfig({
    ...options,
    path: testEnvPath,
    override: false,
    quiet: true,
    processEnv: process.env,
  });
};

dotenv.config();
