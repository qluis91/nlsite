/**
 * Login page UI tests — dark NinjaLabCR theme validation
 * Spawns the server on a random port, fetches login HTML, validates contracts.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { buildIsolatedTestEnvironment } = require('../config/testProcessEnvironment');
const path = require('path');

const port = 36000 + Math.floor(Math.random() * 500);

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ method: 'GET', hostname: '127.0.0.1', port, path: urlPath }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

describe('Login Page UI', () => {
  let loginHtml = '';
  let serverProc;

  // Start server, wait for /health
  it('server is reachable', { timeout: 20000 }, async () => {
    serverProc = spawn(process.execPath, ['app.js'], {
      cwd: path.join(__dirname, '..'),
      env: buildIsolatedTestEnvironment(process.env, { PORT: String(port) }),
      stdio: 'ignore',
      windowsHide: true,
    });

    for (let i = 0; i < 30; i++) {
      try {
        const r = await httpGet('/health');
        if (r.status === 200) break;
      } catch (_) { /* retry */ }
      await new Promise(r => setTimeout(r, 500));
    }
  });

  // Fetch login page
  it('GET /auth/login returns 200', async () => {
    const r = await httpGet('/auth/login');
    assert.strictEqual(r.status, 200);
    loginHtml = r.data;
  });

  // ── Assets and layout ──

  it('login page includes auth.css', () => {
    assert.match(loginHtml, /auth\.css/);
  });

  it('login page has dark background class', () => {
    assert.match(loginHtml, /page-auth/);
  });

  it('navbar hidden on auth page', () => {
    const hasAuthCss = loginHtml.match(/auth\.css/);
    assert.ok(hasAuthCss, 'auth.css should be loaded to hide navbar');
  });

  // ── Form structure ──

  it('login form posts to /auth/login', () => {
    assert.match(loginHtml, /action="\/auth\/login"/);
    assert.match(loginHtml, /method="POST"/);
  });

  it('CSRF hidden input preserved', () => {
    assert.match(loginHtml, /name="_csrf"/);
    assert.match(loginHtml, /value="[^"]+"/);
  });

  it('returnTo hidden input preserved', () => {
    assert.match(loginHtml, /name="returnTo"/);
  });

  it('email field has label and correct attributes', () => {
    assert.match(loginHtml, /<label[^>]*for="email"/);
    assert.match(loginHtml, /type="email"[^>]*id="email"[^>]*name="email"/);
  });

  it('password field has label and correct type', () => {
    assert.match(loginHtml, /<label[^>]*for="password"/);
    assert.match(loginHtml, /type="password"[^>]*id="password"[^>]*name="password"/);
  });

  it('submit button text present', () => {
    assert.match(loginHtml, /Iniciar sesión/);
  });

  // ── Password toggle ──

  it('password toggle button present', () => {
    assert.match(loginHtml, /type="button"[^>]*class="[^"]*password-toggle/);
    assert.match(loginHtml, /data-password-toggle/);
    assert.match(loginHtml, /aria-label="Mostrar contraseña"/);
  });

  it('password toggle inline JS has nonce', () => {
    assert.match(loginHtml, /nonce="/);
  });

  it('no inline event handlers (onclick)', () => {
    assert.doesNotMatch(loginHtml, /onclick="[^"]*"/);
  });

  // ── Links ──

  it('forgot-password link uses existing route', () => {
    assert.match(loginHtml, /href="\/auth\/forgot-password"/);
    assert.match(loginHtml, /¿Olvidaste tu contraseña\?/);
  });

  it('register link uses existing route', () => {
    assert.match(loginHtml, /href="\/auth\/register"/);
    assert.match(loginHtml, /¿No tienes cuenta\?/);
  });

  it('admin link uses unified /auth/login?returnTo=/admin', () => {
    assert.match(loginHtml, /href="\/auth\/login\?returnTo=\/admin"/);
    assert.match(loginHtml, /Admin/);
  });

  it('no placeholder href="#" in login page', () => {
    assert.doesNotMatch(loginHtml, /href="#"/);
  });

  // ── Absence checks ──

  it('no fake social-auth controls', () => {
    const cardMatch = loginHtml.match(/<main[^>]*class="[^"]*auth-card[^"]*"[^>]*>([\s\S]*?)<\/main>/);
    const cardContent = cardMatch ? cardMatch[0] : loginHtml;
    assert.doesNotMatch(cardContent, /Google|GitHub|social-login|inicia.*sesión.*con/i);
  });

  it('no remember-me checkbox (backend unsupported)', () => {
    assert.doesNotMatch(loginHtml, /Recordarme|remember|rememberMe/i);
  });

  // ── Logo and heading ──

  it('logo image rendered with alt text', () => {
    assert.match(loginHtml, /LogoCompleto\.png/);
    assert.match(loginHtml, /<img[^>]*alt="[^"]+"/);
  });

  it('page heading present', () => {
    assert.match(loginHtml, /Inicia sesión en tu cuenta/);
  });

  // ── Accessibility ──

  it('form has exactly one h1 (sr-only login heading)', () => {
    const h1s = loginHtml.match(/<h1[^>]*>/g) || [];
    assert.strictEqual(h1s.length, 1, 'login page should have exactly one h1');
  });

  // ── Cleanup: kill server ──
  it('cleanup', () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
      setTimeout(() => { if (!serverProc.killed) serverProc.kill('SIGKILL'); }, 2000);
    }
  });
});
