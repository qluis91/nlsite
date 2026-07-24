/**
 * Shared test helper — spawns the app server on a random port, waits for /health.
 * Usage:
 *   const { startTestServer, stopTestServer, PORT } = require('./testServer');
 *   await startTestServer();
 *   // make requests to http://127.0.0.1:${PORT}
 *   stopTestServer();
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

let serverProc = null;
let port = 0;

async function waitForReady(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/health`, (res) => { res.resume(); res.statusCode === 200 ? resolve() : reject(); });
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
      });
      return;
    } catch (_) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function startTestServer() {
  if (serverProc) return port;
  port = 35000 + Math.floor(Math.random() * 500);
  serverProc = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForReady(port);
  return port;
}

function stopTestServer() {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
    setTimeout(() => { if (!serverProc.killed) serverProc.kill('SIGKILL'); serverProc = null; port = 0; }, 2000);
  }
}

module.exports = { startTestServer, stopTestServer, getPort: () => port };
