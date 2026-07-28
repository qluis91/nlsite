const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const {
  getTestServer,
  startTestServer,
  stopTestServer,
} = require('./testServer');

function expectPortRefused(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`Unexpected listener remained on port ${port}.`));
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });
}

test('shared test server is reference counted and releases its ephemeral port', async (t) => {
  t.after(async () => {
    while (getTestServer()) await stopTestServer();
  });

  const first = await startTestServer();
  const second = await startTestServer();
  assert.equal(first.pid, second.pid);
  assert.equal(first.port, second.port);
  assert.equal(first.baseUrl, `http://127.0.0.1:${first.port}`);
  assert.ok(first.port > 0);

  await stopTestServer();
  assert.equal(getTestServer()?.pid, first.pid, 'first release keeps the shared child alive');

  await stopTestServer();
  assert.equal(getTestServer(), null);
  await expectPortRefused(first.port);
});

test('shared server helper never closes the parent database pool or exits the process', () => {
  const source = fs.readFileSync(path.join(__dirname, 'testServer.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\.\/config\/db['"]\)/);
  assert.doesNotMatch(source, /process\.exit\(/);
  assert.doesNotMatch(source, /35000|Math\.random\(\)/);
});
