/**
 * Auth register route test — verifies register uses same dark auth layout as login.
 * Run: node --test tests/auth-register-layout.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { startTestServer, stopTestServer } = require('./testServer');

const OPTIONS = { hostname: '127.0.0.1', port: 0 };

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ ...OPTIONS, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

describe('Auth register layout matches login', () => {
  let login = null;
  let register = null;

  before(async () => {
    const server = await startTestServer();
    OPTIONS.port = server.port;
    login = await get('/auth/login');
    register = await get('/auth/register');
  });

  after(async () => {
    await stopTestServer();
  });

  it('both return 200', () => {
    assert.equal(login.status, 200);
    assert.equal(register.status, 200);
  });

  it('both have page-auth body class', () => {
    assert.match(login.body, /<body[^>]*class="[^"]*\bpage-auth\b/);
    assert.match(register.body, /<body[^>]*class="[^"]*\bpage-auth\b/);
  });

  it('both load auth.css', () => {
    assert.ok(login.body.includes('/css/auth.css'), 'login loads auth.css');
    assert.ok(register.body.includes('/css/auth.css'), 'register loads auth.css');
  });

  it('both render auth-card', () => {
    assert.ok(login.body.includes('auth-card'), 'login has auth-card');
    assert.ok(register.body.includes('auth-card'), 'register has auth-card');
  });

  it('both render auth-logo', () => {
    assert.ok(login.body.includes('auth-logo'), 'login has auth-logo');
    assert.ok(register.body.includes('auth-logo'), 'register has auth-logo');
  });
});
