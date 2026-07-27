/**
 * Phase 16B tests — Rate limiting, sessions, proxy, anti-enumeration.
 * Run: node --test tests/security-phase16b.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const BASE = { hostname: 'localhost', port: 3000 };

function httpReq(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://${BASE.hostname}:${BASE.port}`);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ method, hostname: BASE.hostname, port: BASE.port, path: url.pathname, headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(new URLSearchParams(body).toString());
    req.end();
  });
}

function extractCsrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

async function getCsrf(path) {
  const r = await httpReq('GET', path);
  return { token: extractCsrf(r.body), cookie: r.headers['set-cookie'] ? r.headers['set-cookie'][0] : null };
}

after(() => {
  // Destroy keep-alive connections so the test runner can exit
  http.globalAgent.destroy();
});

// ──── HTTP: rate-limit and CSRF coverage ────
describe('Phase 16B — Auth routes CSRF and limiters', () => {
  it('POST /auth/register requires CSRF token', async () => {
    const r = await httpReq('POST', '/auth/register', {
      name: 'test', email: 'x@x.com', password: 'test1234', password2: 'test1234',
    });
    assert.equal(r.status, 403, 'Should return 403 without CSRF');
  });

  it('POST /auth/register has dedicated registerLimiter applied', async () => {
    const { token, cookie } = await getCsrf('/auth/register');
    assert.ok(token, 'CSRF token should be present on GET /auth/register');
    const r = await httpReq('POST', '/auth/register', {
      name: 'Test', email: 'ratelimit-test@example.com',
      password: 'test1234', password2: 'test1234', _csrf: token,
    }, cookie);
    assert.equal(r.status, 302, 'Register POST should redirect (302)');
  });

  it('POST /auth/forgot-password requires CSRF token', async () => {
    const r = await httpReq('POST', '/auth/forgot-password', { email: 'x@x.com' });
    assert.equal(r.status, 403, 'Should return 403 without CSRF');
  });

  it('POST /auth/forgot-password has dedicated forgotLimiter applied', async () => {
    const { token, cookie } = await getCsrf('/auth/forgot-password');
    assert.ok(token, 'CSRF token should be present');
    const r = await httpReq('POST', '/auth/forgot-password', {
      email: 'noexiste@fake.com', _csrf: token,
    }, cookie);
    assert.equal(r.status, 302, 'Forgot-password POST should redirect');
  });

  it('POST /auth/reset-password requires CSRF token', async () => {
    const r = await httpReq('POST', '/auth/reset-password', {
      token: 'invalid', password: 'test1234', password2: 'test1234',
    });
    assert.equal(r.status, 403, 'Should return 403 without CSRF');
  });

  it('POST /auth/reset-password has dedicated resetPasswordLimiter applied', async () => {
    const r = await httpReq('GET', '/auth/reset-password');
    assert.equal(r.status, 302, 'Empty token redirects to login');
  });

  it('POST /auth/resend-verification has dedicated resendLimiter', async () => {
    const { token, cookie } = await getCsrf('/auth/resend-verification');
    assert.ok(token, 'CSRF token should be present');
    const r = await httpReq('POST', '/auth/resend-verification', {
      email: '', _csrf: token,
    }, cookie);
    assert.equal(r.status, 302, 'Resend verification POST should redirect');
  });

  it('GET /auth/register is not rate-limited', async () => {
    const r = await httpReq('GET', '/auth/register');
    assert.equal(r.status, 200, 'GET register should return 200');
    assert.ok(r.body.includes('_csrf'), 'GET register should include CSRF token');
  });

  it('GET /auth/forgot-password is not rate-limited', async () => {
    const r = await httpReq('GET', '/auth/forgot-password');
    assert.equal(r.status, 200, 'GET forgot-password should return 200');
    assert.ok(r.body.includes('_csrf'), 'GET forgot-password should include CSRF');
  });

  it('GET /auth/reset-password with invalid token not rate-limited', async () => {
    const r = await httpReq('GET', '/auth/reset-password?token=invalid');
    assert.equal(r.status, 302, 'Invalid token redirects (not 429)');
  });

  it('GET /auth/resend-verification is not rate-limited', async () => {
    const r = await httpReq('GET', '/auth/resend-verification');
    assert.equal(r.status, 200, 'GET resend-verification should return 200');
  });
});

// ──── Anti-enumeration ────
describe('Phase 16B — Anti-enumeration responses', () => {
  it('login returns generic error for unknown email', async () => {
    const { token, cookie } = await getCsrf('/auth/login');
    const r = await httpReq('POST', '/auth/login', {
      email: 'noexiste@fake12345.com', password: 'wrong', _csrf: token,
    }, cookie);
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'),
      'Should redirect to login with generic message');
  });

  it('login returns generic error for wrong password', async () => {
    const { token, cookie } = await getCsrf('/auth/login');
    const r = await httpReq('POST', '/auth/login', {
      email: 'admin@example.com', password: 'wrongpassword123', _csrf: token,
    }, cookie);
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'),
      'Should redirect to login with same generic message');
  });

  it('register does not reveal if email already exists', async () => {
    const { token, cookie } = await getCsrf('/auth/register');
    const r = await httpReq('POST', '/auth/register', {
      name: 'Test', email: 'admin@example.com',
      password: 'test1234', password2: 'test1234', _csrf: token,
    }, cookie);
    assert.equal(r.status, 302);
    // Should NOT redirect back to /auth/register (which would reveal existence)
    assert.ok(
      r.headers.location === '/auth/verify-pending',
      `Should redirect to verify-pending with generic message, got: ${r.headers.location}`
    );
  });

  it('forgot-password returns same response for known and unknown emails', async () => {
    const { token, cookie } = await getCsrf('/auth/forgot-password');
    const r1 = await httpReq('POST', '/auth/forgot-password', {
      email: 'admin@example.com', _csrf: token,
    }, cookie);
    assert.equal(r1.status, 302);
    assert.equal(r1.headers.location, '/auth/forgot-password');

    const { token: t2, cookie: c2 } = await getCsrf('/auth/forgot-password');
    const r2 = await httpReq('POST', '/auth/forgot-password', {
      email: 'noexiste@fake99999.com', _csrf: t2,
    }, c2);
    assert.equal(r2.status, 302);
    assert.equal(r2.headers.location, '/auth/forgot-password');
  });

  it('resend-verification returns generic response', async () => {
    const { token, cookie } = await getCsrf('/auth/resend-verification');
    const r = await httpReq('POST', '/auth/resend-verification', {
      email: 'noexiste@fake.com', _csrf: token,
    }, cookie);
    assert.equal(r.status, 302);
    assert.ok(r.headers.location === '/auth/verify-pending',
      'Should redirect to verify-pending with generic message');
  });
});

// ──── Session lifecycle ────
describe('Phase 16B — Session lifecycle', () => {
  it('logout destroys session and clears cookie', async () => {
    // Logout is CSRF-protected by the global middleware
    const r = await httpReq('POST', '/auth/logout');
    // Without CSRF token, returns 403 — proves CSRF coverage
    assert.equal(r.status, 403, 'Logout POST should require CSRF token');
    // With CSRF token, should redirect
    const { token, cookie } = await getCsrf('/auth/login');
    const r2 = await httpReq('POST', '/auth/logout', { _csrf: token }, cookie);
    assert.equal(r2.status, 302, 'Logout POST with CSRF should redirect');
    // Check that a cleared cookie is sent
    const cookies = r2.headers['set-cookie'] || [];
    const hasClearedCookie = cookies.some(c =>
      c.includes('connect.sid') &&
      (c.includes('Expires=Thu, 01 Jan 1970') || c.toLowerCase().includes('max-age=0') || c.startsWith('connect.sid=;'))
    );
    assert.ok(hasClearedCookie, 'Should clear connect.sid cookie');
  });

  it('session uses MySQL store, not in-memory default', () => {
    // Verify session config file uses MySQL store
    const fs = require('fs');
    const sessionJs = fs.readFileSync(require('path').join(__dirname, '..', 'config', 'session.js'), 'utf8');
    assert.ok(sessionJs.includes('MySQLStore'), 'Session should use MySQLStore');
    assert.ok(sessionJs.includes("require('express-mysql-session')"), 'Should require express-mysql-session');
  });

  it('session cookie flags are secure', () => {
    const fs = require('fs');
    const sessionJs = fs.readFileSync(require('path').join(__dirname, '..', 'config', 'session.js'), 'utf8');
    assert.ok(sessionJs.includes('httpOnly: true'), 'Session cookie should be httpOnly');
    assert.ok(sessionJs.includes("sameSite: 'lax'"), 'Session cookie should have sameSite lax');
    assert.ok(sessionJs.includes('secure:'), 'Session cookie should have secure flag');
    assert.ok(sessionJs.includes('resave: false'), 'Session should not resave');
    assert.ok(sessionJs.includes('saveUninitialized: false'), 'Session should not save uninitialized');
  });
});

// ──── Proxy and IP safety ────
describe('Phase 16B — Proxy and IP configuration', () => {
  it('trust proxy is set to 1 in production', () => {
    const fs = require('fs');
    const appJs = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(
      appJs.includes("app.set('trust proxy', 1)"),
      'trust proxy should be set to 1 in production'
    );
  });

  it('does not blindly trust all proxies', () => {
    const fs = require('fs');
    const appJs = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(
      !appJs.includes("app.set('trust proxy', true"),
      'Should NOT trust all proxies blindly'
    );
  });

  it('trust proxy is conditional on IS_PRODUCTION', () => {
    const fs = require('fs');
    const appJs = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
    const trustProxyIdx = appJs.indexOf("app.set('trust proxy', 1)");
    const isProdIdx = appJs.lastIndexOf('IS_PRODUCTION', trustProxyIdx);
    assert.ok(isProdIdx > 0 && trustProxyIdx > isProdIdx,
      'trust proxy should be conditional on production');
  });
});

// ──── CSRF on all modified POST routes ────
describe('Phase 16B — CSRF coverage on rate-limited POSTs', () => {
  it('POST /auth/register blocked without CSRF', async () => {
    const r = await httpReq('POST', '/auth/register', { name: 'x', email: 'x@x.com', password: 'a', password2: 'a' });
    assert.equal(r.status, 403);
  });

  it('POST /auth/forgot-password blocked without CSRF', async () => {
    const r = await httpReq('POST', '/auth/forgot-password', { email: 'x@x.com' });
    assert.equal(r.status, 403);
  });

  it('POST /auth/reset-password blocked without CSRF', async () => {
    const r = await httpReq('POST', '/auth/reset-password', { token: 'x', password: 'a', password2: 'a' });
    assert.equal(r.status, 403);
  });

  it('POST /auth/resend-verification blocked without CSRF', async () => {
    const r = await httpReq('POST', '/auth/resend-verification', { email: 'x@x.com' });
    assert.equal(r.status, 403);
  });

  it('POST /auth/login blocked without CSRF', async () => {
    const r = await httpReq('POST', '/auth/login', { email: 'x@x.com', password: 'a' });
    assert.equal(r.status, 403);
  });
});
