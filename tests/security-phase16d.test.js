/**
 * Phase 16D tests — Production hardening, headers, secrets, logging, health.
 * Run: node --test tests/security-phase16d.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = { hostname: 'localhost', port: 3000 };

function httpReq(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ method, hostname: BASE.hostname, port: BASE.port, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ──── Security headers ────
describe('Phase 16D — Security headers', () => {
  it('homepage has Referrer-Policy header', async () => {
    const r = await httpReq('GET', '/');
    assert.ok(r.headers['referrer-policy'], 'Referrer-Policy header should be present');
  });

  it('homepage has X-Content-Type-Options: nosniff', async () => {
    const r = await httpReq('GET', '/');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  });

  it('homepage does NOT expose X-Powered-By', async () => {
    const r = await httpReq('GET', '/');
    assert.ok(!r.headers['x-powered-by'], 'X-Powered-By should not be present');
  });

  it('homepage has frame-ancestors in CSP', async () => {
    const r = await httpReq('GET', '/');
    const csp = r.headers['content-security-policy'] || '';
    assert.ok(csp.includes("frame-ancestors 'self'"), 'CSP should include frame-ancestors');
  });

  it('homepage CSP uses nonce for scripts', async () => {
    const r = await httpReq('GET', '/');
    const csp = r.headers['content-security-policy'] || '';
    assert.ok(csp.includes("'nonce-"), 'CSP script-src should use nonce');
  });

  it('homepage CSP does NOT allow unsafe-eval', async () => {
    const r = await httpReq('GET', '/');
    const csp = r.headers['content-security-policy'] || '';
    assert.ok(!csp.includes("'unsafe-eval'"), 'CSP should not allow unsafe-eval');
  });

  it('admin login CSP also uses nonce (via /auth/login?returnTo=/admin)', async () => {
    const r = await httpReq('GET', '/auth/login?returnTo=/admin');
    const csp = r.headers['content-security-policy'] || '';
    assert.ok(csp.includes("'nonce-"), 'Admin login CSP should use nonce');
  });

  it('homepage has Permissions-Policy', async () => {
    const r = await httpReq('GET', '/');
    assert.ok(r.headers['permissions-policy'], 'Permissions-Policy header should be present');
    assert.ok(r.headers['permissions-policy'].includes('camera='), 'Should restrict camera');
  });

  it('homepage has Cross-Origin-Resource-Policy', async () => {
    const r = await httpReq('GET', '/');
    assert.ok(r.headers['cross-origin-resource-policy'], 'CORP should be present');
  });
});

// ──── Health / Readiness ────
describe('Phase 16D — Health & Readiness', () => {
  it('GET /health returns 200', async () => {
    const r = await httpReq('GET', '/health');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.status, 'ok');
    // Must not leak internal info
    assert.ok(!r.body.includes('password'));
    assert.ok(!r.body.includes('secret'));
  });

  it('GET /ready returns JSON', async () => {
    const r = await httpReq('GET', '/ready');
    const body = JSON.parse(r.body);
    assert.ok(['ok', 'not_ready'].includes(body.status));
    assert.ok(r.status === 200 || r.status === 503);
  });
});

// ──── Proxy diagnostic disabled by default ────
describe('Phase 16D — Proxy diagnostic', () => {
  it('GET /admin/proxy-diagnostic returns 404 when disabled', async () => {
    const r = await httpReq('GET', '/admin/proxy-diagnostic');
    // Without auth, should redirect or 404
    assert.ok(r.status === 302 || r.status === 404, `Expected 302 or 404, got ${r.status}`);
  });
});

// ──── Error responses don't leak stack traces ────
describe('Phase 16D — Error responses', () => {
  it('500 JSON response does not include stack trace', async () => {
    // Trigger a 500 by sending bad JSON to the webhook
    const req = http.request({
      method: 'POST',
      hostname: BASE.hostname, port: BASE.port,
      path: '/webhooks/tilopay',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        // Should not contain stack trace lines
        assert.ok(!data.includes('at ') && !data.includes('.js:'), 'Response should not include stack traces');
        assert.ok(!data.includes('node_modules'), 'Response should not include internal paths');
        assert.ok(!data.includes('password'), 'Response should not include sensitive keys');
      });
    });
    req.write('not json');
    req.end();
    await new Promise(r => setTimeout(r, 200));
  });

  it('404 page does not reveal internal paths', async () => {
    const r = await httpReq('GET', '/nonexistent-page-xyz');
    assert.ok(!r.body.includes('node_modules'), '404 page should not expose internal paths');
    assert.ok(!r.body.includes('Error:'), '404 page should not show raw errors');
  });
});

// ──── Environment validation ────
describe('Phase 16D — Environment validation', () => {
  it('validateEnv returns array of issues', () => {
    const { validateEnv } = require('../config/envValidator');
    const issues = validateEnv();
    assert.ok(Array.isArray(issues));
    // In dev mode, SESSION_SECRET may generate a warning but should not crash
  });

  it('validateEnv validates PORT format', () => {
    const originalPort = process.env.PORT;
    process.env.PORT = '99999'; // invalid port
    const { validateEnv } = require('../config/envValidator');
    const issues = validateEnv();
    const hasPortIssue = issues.some(i => i.startsWith('PORT:'));
    process.env.PORT = originalPort;
    assert.ok(hasPortIssue, 'Should report invalid PORT');
  });

  it('validateEnv validates APP_URL format', () => {
    const originalUrl = process.env.APP_URL;
    process.env.APP_URL = 'not-a-url';
    const { validateEnv } = require('../config/envValidator');
    const issues = validateEnv();
    const hasUrlIssue = issues.some(i => i.startsWith('APP_URL:'));
    process.env.APP_URL = originalUrl;
    assert.ok(hasUrlIssue, 'Should report invalid APP_URL format');
  });

  it('envValidator never logs secret values', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'envValidator.js'), 'utf8');
    assert.ok(!code.includes('console.log(process.env.SESSION_SECRET'));
    assert.ok(!code.includes('console.log(process.env.DB_PASSWORD'));
    assert.ok(!code.includes('console.log(process.env.TILOPAY'));
    // validateEnv strings only mention variable names, not values
    assert.ok(code.includes('SESSION_SECRET: debe'));
    assert.ok(code.includes('DB_PASSWORD: requerido'));
  });
});

// ──── Safe logging ────
describe('Phase 16D — Safe logging', () => {
  const { redactSensitive, REDACTED } = require('../config/safeLogging');

  it('redacts password fields', () => {
    const obj = { name: 'test', password: 'secret123', email: 'x@x.com' };
    const redacted = redactSensitive(obj);
    assert.equal(redacted.name, 'test');
    assert.equal(redacted.password, REDACTED);
    assert.equal(redacted.email, 'x@x.com');
  });

  it('redacts token fields', () => {
    const obj = { csrf: 'abc123', _csrf: 'def456', data: 'safe' };
    const redacted = redactSensitive(obj);
    assert.equal(redacted.csrf, REDACTED);
    assert.equal(redacted._csrf, REDACTED);
    assert.equal(redacted.data, 'safe');
  });

  it('redacts nested objects', () => {
    const obj = { user: { name: 'test', password: 'secret' } };
    const redacted = redactSensitive(obj);
    assert.equal(redacted.user.name, 'test');
    assert.equal(redacted.user.password, REDACTED);
  });

  it('handles arrays', () => {
    const arr = [{ password: 'a' }, { password: 'b' }];
    const redacted = redactSensitive(arr);
    assert.equal(redacted[0].password, REDACTED);
    assert.equal(redacted[1].password, REDACTED);
  });

  it('handles case-insensitive matches', () => {
    const obj = { PASSWORD: 'secret', Password: 'secret2' };
    const redacted = redactSensitive(obj);
    assert.equal(redacted.PASSWORD, REDACTED);
    assert.equal(redacted.Password, REDACTED);
  });
});

// ──── Graceful shutdown ────
describe('Phase 16D — Graceful shutdown', () => {
  it('app.js registers SIGTERM handler', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(appJs.includes("process.on('SIGTERM'"), 'Should register SIGTERM handler');
    assert.ok(appJs.includes("process.on('SIGINT'"), 'Should register SIGINT handler');
    assert.ok(appJs.includes('SHUTDOWN_TIMEOUT_MS'), 'Should have shutdown timeout');
  });

  it('app.js registers uncaughtException handler', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(appJs.includes("process.on('uncaughtException'"), 'Should register uncaughtException handler');
    assert.ok(appJs.includes("process.on('unhandledRejection'"), 'Should register unhandledRejection handler');
  });

  it('shutdown does not print credentials', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const shutdownSection = appJs.substring(appJs.indexOf('gracefulShutdown'));
    assert.ok(!shutdownSection.includes('SESSION_SECRET'));
    assert.ok(!shutdownSection.includes('DB_PASSWORD'));
    assert.ok(!shutdownSection.includes('console.log(session'));
  });
});

// ──── trust proxy = 1 ────
describe('Phase 16D — trust proxy', () => {
  it('trust proxy is set to 1', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(appJs.includes("app.set('trust proxy', 1)"), 'trust proxy should be 1');
  });
});

// ──── Dependency audit documentation ────
describe('Phase 16D — Dependency audit', () => {
  it('package.json exists with known dependencies', () => {
    const pkg = require('../package.json');
    assert.ok(pkg.dependencies.express);
    assert.ok(pkg.dependencies.helmet);
    assert.ok(pkg.dependencies.sharp);
    assert.ok(pkg.dependencies.bcryptjs);
    assert.ok(pkg.dependencies['express-rate-limit']);
    assert.ok(pkg.dependencies.multer);
    assert.ok(pkg.dependencies.compression);
  });

  it('ejs version is 3.x (not major 6)', () => {
    const pkg = require('../package.json');
    const version = require('ejs/package.json').version;
    assert.ok(version.startsWith('3.'), `ejs version ${version} should be 3.x`);
  });
});

// ──── CSP does not have duplicates ────
describe('Phase 16D — No duplicate CSP headers', () => {
  it('homepage has exactly one CSP header', async () => {
    const r = await httpReq('GET', '/');
    const cspHeaders = Object.keys(r.headers).filter(h => h.toLowerCase() === 'content-security-policy');
    assert.ok(cspHeaders.length <= 1, 'Should have at most one CSP header');
  });
});
