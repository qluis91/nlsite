const { execFileSync } = require('child_process');
const { buildIsolatedTestEnvironment } = require('./config/testProcessEnvironment');
try {
  const result = execFileSync(process.execPath, ['--test', '--test-concurrency=1'], {
    cwd: __dirname,
    env: buildIsolatedTestEnvironment(process.env),
    timeout: 600000,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('Exit code: 0');
  console.log('STDOUT length:', result.length);
} catch (e) {
  console.log('Exit code:', e.status);
  console.log('Signal:', e.signal);
  console.log('STDERR (last 2KB):', e.stderr?.toString().slice(-2048));
  console.log('STDOUT (last 2KB):', e.stdout?.toString().slice(-2048));
}
