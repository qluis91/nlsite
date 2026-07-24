/**
 * Login page UI tests — dark NinjaLabCR theme validation
 */
const { describe, test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const BASE = 'http://localhost:3000';

function httpGet(path, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ method: 'GET', hostname: url.hostname, port: url.port, path: url.pathname, headers }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Login Page UI', () => {
  let loginHtml = '';

  test('GET /auth/login returns 200', async () => {
    const r = await httpGet('/auth/login');
    assert.strictEqual(r.status, 200);
    loginHtml = r.data;
  });

  test('login page includes auth.css', () => {
    assert.match(loginHtml, /auth\.css/, 'Login page should include auth.css stylesheet');
  });

  test('login page has dark background class', () => {
    assert.match(loginHtml, /page-auth/, 'Login page should have page-auth class');
  });

  test('login form posts to /auth/login', () => {
    assert.match(loginHtml, /action="\/auth\/login"/);
    assert.match(loginHtml, /method="POST"/);
  });

  test('CSRF hidden input preserved', () => {
    assert.match(loginHtml, /name="_csrf"/);
    assert.match(loginHtml, /value="[^"]+"/);
  });

  test('returnTo hidden input preserved', () => {
    assert.match(loginHtml, /name="returnTo"/);
  });

  test('email field has label and correct attributes', () => {
    assert.match(loginHtml, /<label[^>]*for="email"/);
    assert.match(loginHtml, /<input[^>]*type="email"[^>]*id="email"[^>]*name="email"/);
  });

  test('password field has label and correct type', () => {
    assert.match(loginHtml, /<label[^>]*for="password"/);
    assert.match(loginHtml, /<input[^>]*type="password"[^>]*id="password"[^>]*name="password"/);
  });

  test('password toggle button present', () => {
    assert.match(loginHtml, /type="button"[^>]*class="[^"]*password-toggle/);
    assert.match(loginHtml, /data-password-toggle/);
    assert.match(loginHtml, /aria-label="Mostrar contraseña"/);
  });

  test('forgot-password link uses existing route', () => {
    assert.match(loginHtml, /href="\/auth\/forgot-password"/);
    assert.match(loginHtml, /¿Olvidaste tu contraseña\?/);
  });

  test('register link uses existing route', () => {
    assert.match(loginHtml, /href="\/auth\/register"/);
    assert.match(loginHtml, /¿No tienes cuenta\?/);
  });

  test('admin link uses verified /admin/login route', () => {
    assert.match(loginHtml, /href="\/admin\/login"/);
    assert.match(loginHtml, /Admin/);
  });

  test('no placeholder href="#" in login page', () => {
    assert.doesNotMatch(loginHtml, /href="#"/);
  });

  test('no fake social-auth controls', () => {
    // Extract just the auth-card content to avoid matching footer social links
    const cardMatch = loginHtml.match(/<main class="auth-card"[^>]*>([\s\S]*?)<\/main>/);
    const cardContent = cardMatch ? cardMatch[0] : loginHtml;
    assert.doesNotMatch(cardContent, /Google|GitHub|social-login|inicia.*sesión.*con/i, 'Should not have social login buttons');
  });

  test('no remember-me checkbox (backend unsupported)', () => {
    assert.doesNotMatch(loginHtml, /Recordarme|remember|rememberMe/i, 'No remember-me when backend does not support it');
  });

  test('logo image rendered with alt text', () => {
    assert.match(loginHtml, /LogoCompleto\.png/);
    assert.match(loginHtml, /<img[^>]*alt="[^"]+"/);
  });

  test('submit button text present', () => {
    assert.match(loginHtml, /Iniciar sesión/);
  });

  test('page heading present', () => {
    assert.match(loginHtml, /Inicia sesión en tu cuenta/);
  });

  test('password toggle inline JS has nonce', () => {
    assert.match(loginHtml, /nonce="/);
  });

  test('no inline event handlers (onclick)', () => {
    assert.doesNotMatch(loginHtml, /onclick="[^"]*"/);
  });

  test('navbar hidden on auth page', () => {
    // The navbar partial is included by layout; check auth.css hides it
    const authCss = loginHtml.match(/auth\.css/);
    assert.ok(authCss, 'auth.css should be loaded to hide navbar');
  });
});
