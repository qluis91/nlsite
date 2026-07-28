/**
 * Shared HTTP-test server lifecycle.
 *
 * Each test-file process gets one reference-counted child server on an
 * OS-assigned ephemeral port. The helper owns only that child process; it never
 * closes database handles imported by the parent test process.
 */
const { execFile, spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const HOST = '127.0.0.1';
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 12_000;
const PORT_RELEASE_TIMEOUT_MS = 5_000;
const RETRY_INTERVAL_MS = 50;
const MAX_LOG_LENGTH = 16_000;

let activeServer = null;
let startPromise = null;
let stopPromise = null;
let referenceCount = 0;

function appendLog(current, chunk) {
  current.logs += chunk.toString();
  if (current.logs.length > MAX_LOG_LENGTH) {
    current.logs = current.logs.slice(-MAX_LOG_LENGTH);
  }
}

function reserveEphemeralPort() {
  return new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.unref();
    reservation.once('error', reject);
    reservation.listen({ host: HOST, port: 0, exclusive: true }, () => {
      const address = reservation.address();
      if (!address || typeof address === 'string') {
        reservation.close();
        reject(new Error('Unable to determine the ephemeral test-server port.'));
        return;
      }
      reservation.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function requestHealth(baseUrl) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${baseUrl}/health`, (response) => {
      response.resume();
      if (response.statusCode === 200) resolve();
      else reject(new Error(`Health check returned HTTP ${response.statusCode}.`));
    });
    request.setTimeout(1_000, () => {
      request.destroy(new Error('Health check timed out.'));
    });
    request.once('error', reject);
  });
}

function waitForRetry(intervalMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    timer.unref?.();
  });
}

async function waitForReady(current, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (current.exitResult !== null) {
      const details = current.logs.trim();
      throw new Error(
        `Test server exited before becoming healthy (code ${current.child.exitCode}).`
        + (details ? `\n${details}` : '')
      );
    }
    try {
      await requestHealth(current.baseUrl);
      return;
    } catch (error) {
      lastError = error;
      await waitForRetry(RETRY_INTERVAL_MS);
    }
  }
  throw new Error(
    `Test server did not become healthy within ${timeoutMs}ms at ${current.baseUrl}.`,
    { cause: lastError }
  );
}

function waitForChildExit(current, timeoutMs) {
  if (current.exitResult !== null) return Promise.resolve(current.exitResult);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Test server PID ${current.pid} did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);
    timer.unref?.();
    current.exitPromise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function probePort(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`Timed out while checking release of test-server port ${port}.`));
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(true);
      else reject(error);
    });
  });
}

async function waitForPortRelease(port, timeoutMs = PORT_RELEASE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(port)) return;
    await waitForRetry(RETRY_INTERVAL_MS);
  }
  throw new Error(`Test-server port ${port} remained in use after child exit.`);
}

async function terminateProcessTree(current) {
  if (current.exitResult === null) {
    if (process.platform === 'win32') {
      try {
        await execFileAsync('taskkill', ['/PID', String(current.pid), '/T', '/F'], {
          windowsHide: true,
        });
      } catch (error) {
        if (current.exitResult === null) {
          throw new Error(`Unable to terminate test-server process tree ${current.pid}.`, {
            cause: error,
          });
        }
      }
    } else {
      try {
        process.kill(-current.processGroupId, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH' || current.exitResult === null) throw error;
      }
      try {
        await waitForChildExit(current, STOP_TIMEOUT_MS);
      } catch (error) {
        if (current.exitResult === null) {
          try {
            process.kill(-current.processGroupId, 'SIGKILL');
          } catch (killError) {
            if (killError.code !== 'ESRCH' || current.exitResult === null) throw killError;
          }
        } else {
          throw error;
        }
      }
    }
  }
  await waitForChildExit(current, STOP_TIMEOUT_MS);
  await waitForPortRelease(current.port);
}

async function createTestServer() {
  const port = await reserveEphemeralPort();
  const baseUrl = `http://${HOST}:${port}`;
  const child = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOST, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  const current = {
    child,
    pid: child.pid,
    processGroupId: child.pid,
    port,
    baseUrl,
    logs: '',
    exitResult: null,
    exitPromise: null,
  };
  child.stdout.on('data', (chunk) => appendLog(current, chunk));
  child.stderr.on('data', (chunk) => appendLog(current, chunk));
  current.exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      current.exitResult = { code, signal };
      resolve(current.exitResult);
    });
  });

  try {
    await waitForReady(current);
    return current;
  } catch (error) {
    await terminateProcessTree(current);
    throw error;
  }
}

function publicServerInfo(current) {
  return Object.freeze({
    pid: current.pid,
    processGroupId: current.processGroupId,
    port: current.port,
    baseUrl: current.baseUrl,
  });
}

async function startTestServer() {
  if (stopPromise) await stopPromise;
  if (activeServer?.exitResult === null) {
    referenceCount += 1;
    return publicServerInfo(activeServer);
  }
  if (!startPromise) {
    startPromise = createTestServer()
      .then((current) => {
        activeServer = current;
        return current;
      })
      .finally(() => {
        startPromise = null;
      });
  }
  const current = await startPromise;
  referenceCount += 1;
  return publicServerInfo(current);
}

async function stopTestServer() {
  if (startPromise) await startPromise;
  if (!activeServer) return;
  if (referenceCount > 1) {
    referenceCount -= 1;
    return;
  }
  referenceCount = 0;
  if (!stopPromise) {
    const current = activeServer;
    stopPromise = terminateProcessTree(current)
      .then(() => {
        if (activeServer === current) activeServer = null;
      })
      .finally(() => {
        stopPromise = null;
      });
  }
  await stopPromise;
}

function getTestServer() {
  return activeServer ? publicServerInfo(activeServer) : null;
}

module.exports = {
  getTestServer,
  startTestServer,
  stopTestServer,
};
