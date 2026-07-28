/**
 * Phase 16C tests — Authorization, validation, upload security, output safety.
 * Run: node --test tests/security-phase16c.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { startTestServer, stopTestServer } = require('./testServer');

const BASE = { hostname: '127.0.0.1', port: 0 };

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

before(async () => {
  const server = await startTestServer();
  BASE.port = server.port;
});

after(async () => {
  http.globalAgent.destroy();
  await stopTestServer();
});

// ──── Authorization: normal user cannot access admin ────
describe('Phase 16C — Authorization: admin-route protection', () => {
  it('unauthenticated GET /admin redirects to /auth/login', async () => {
    const r = await httpReq('GET', '/admin');
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'));
  });

  it('unauthenticated GET /admin/orders redirects to /auth/login', async () => {
    const r = await httpReq('GET', '/admin/orders');
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'));
  });

  it('unauthenticated GET /admin/page redirects to /auth/login', async () => {
    const r = await httpReq('GET', '/admin/page');
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'));
  });

  it('unauthenticated GET /admin/catalogo redirects to /auth/login', async () => {
    const r = await httpReq('GET', '/admin/catalogo/productos');
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'));
  });

  it('unauthenticated GET /cuenta redirects to /auth/login', async () => {
    const r = await httpReq('GET', '/cuenta');
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'));
  });

  it('unauthenticated GET /cuenta/pedidos redirects to /auth/login', async () => {
    const r = await httpReq('GET', '/cuenta/pedidos');
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'));
  });

  it('unauthenticated GET /cuenta/perfil redirects to /auth/login', async () => {
    const r = await httpReq('GET', '/cuenta/perfil');
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'));
  });

  it('unauthenticated GET /cuenta/direcciones redirects to /auth/login', async () => {
    const r = await httpReq('GET', '/cuenta/direcciones');
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'));
  });

  it('unauthenticated GET /cuenta/seguridad redirects to /auth/login', async () => {
    const r = await httpReq('GET', '/cuenta/seguridad');
    assert.equal(r.status, 302);
    assert.ok(r.headers.location.includes('/auth/login'));
  });
});

// ──── CSRF: admin order routes protected ────
describe('Phase 16C — CSRF: admin order routes', () => {
  it('POST /admin/orders/REF/status blocked without CSRF', async () => {
    const r = await httpReq('POST', '/admin/orders/NL-TEST000001/status', { status: 'processing' });
    assert.equal(r.status, 302, 'Should redirect without CSRF (or 403)');
  });

  it('POST /admin/orders/REF/cancel blocked without CSRF', async () => {
    const r = await httpReq('POST', '/admin/orders/NL-TEST000001/cancel');
    assert.equal(r.status, 302);
  });
});

// ──── Secure JSON serialization (safeJsonScript) ────
describe('Phase 16C — safeJsonScript helper', () => {
  const { safeJsonScript } = require('../config/jsonLdHelper');

  it('escapes </script> in values', () => {
    const data = [{ title: '</script><script>alert(1)</script>', desc: 'x' }];
    const json = safeJsonScript(data);
    assert.ok(!json.includes('</script>'));
    assert.ok(json.includes('\\u003c/script\\u003e'));
  });

  it('round-trips parsed values', () => {
    const data = [{ title: 'Hello <world>', desc: 'a & b', count: 42 }];
    const json = safeJsonScript(data);
    const parsed = JSON.parse(json);
    assert.equal(parsed[0].title, 'Hello <world>');
    assert.equal(parsed[0].desc, 'a & b');
    assert.equal(parsed[0].count, 42);
  });

  it('handles nested objects', () => {
    const data = { a: { b: { c: 'x < y & z > w' } } };
    const json = safeJsonScript(data);
    const parsed = JSON.parse(json);
    assert.equal(parsed.a.b.c, 'x < y & z > w');
  });

  it('handles arrays', () => {
    const data = [1, 'a < b', null, true];
    const json = safeJsonScript(data);
    const parsed = JSON.parse(json);
    assert.deepEqual(parsed, [1, 'a < b', null, true]);
  });

  it('handles empty objects', () => {
    const json = safeJsonScript({});
    assert.equal(JSON.parse(json).constructor, Object);
  });
});

// ──── Public homepage services-cms-data block ────
describe('Phase 16C — Homepage services-cms-data block', () => {
  it('homepage services-cms-data does not contain raw </script>', async () => {
    const r = await httpReq('GET', '/');
    assert.equal(r.status, 200);
    const match = r.body.match(/<script type="application\/json" id="services-cms-data">\s*([\s\S]*?)<\/script>/);
    if (match) {
      // If the block exists, it must not contain literal </script>
      assert.ok(!match[1].includes('</script>'),
        'services-cms-data block should not contain raw </script>');
    }
    // If no match, the block is absent (no CMS feature items) — that's OK
  });

  it('homepage has no raw </script> in any JSON block', async () => {
    const r = await httpReq('GET', '/');
    const matches = r.body.match(/<script type="application\/json"[^>]*>\s*([\s\S]*?)<\/script>/g) || [];
    for (const block of matches) {
      const inner = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '').trim();
      assert.ok(!inner.includes('</script>'),
        'No inline JSON block should contain raw </script>');
    }
  });
});

// ──── Redirect safety ────
describe('Phase 16C — Redirect safety', () => {
  it('safeAuthReturnPath rejects unsafe URLs', () => {
    const { safeAuthReturnPath } = require('../middlewares/authMiddleware');
    assert.equal(safeAuthReturnPath('javascript:alert(1)'), '/');
    assert.equal(safeAuthReturnPath('data:text/html,<script>alert(1)</script>'), '/');
    assert.equal(safeAuthReturnPath('//evil.com'), '/');
    assert.equal(safeAuthReturnPath('https://evil.com'), '/');
    assert.equal(safeAuthReturnPath('\\evil.com'), '/');
  });

  it('safeAuthReturnPath allows valid account paths', () => {
    const { safeAuthReturnPath } = require('../middlewares/authMiddleware');
    assert.equal(safeAuthReturnPath('/cuenta'), '/cuenta');
    assert.equal(safeAuthReturnPath('/cuenta/perfil'), '/cuenta/perfil');
    assert.equal(safeAuthReturnPath('/cuenta/pedidos'), '/cuenta/pedidos');
    assert.equal(safeAuthReturnPath('/cuenta/pedidos/NL-ABC123456789'), '/cuenta/pedidos/NL-ABC123456789');
  });
});

// ──── Admin POST routes have explicit CSRF ────
describe('Phase 16C — CMS admin CSRF coverage', () => {
  it('POST /admin/page/navbar/save blocked without CSRF', async () => {
    const r = await httpReq('POST', '/admin/page/navbar/save', { site_name: 'test' });
    assert.equal(r.status, 302, 'Should redirect without CSRF');
  });

  it('POST /admin/page/global-settings/save blocked without CSRF', async () => {
    const r = await httpReq('POST', '/admin/page/global-settings/save', { site_name: 'test' });
    assert.equal(r.status, 302);
  });

  it('POST /admin/catalogo/productos blocked without CSRF', async () => {
    const r = await httpReq('POST', '/admin/catalogo/productos', { name: 'test' });
    // Multipart routes may return 302 (redirect) or error
    assert.ok(r.status === 302 || r.status === 400,
      `Expected 302 or 400, got ${r.status}`);
  });

  it('POST /admin/catalogo/categorias blocked without CSRF', async () => {
    const r = await httpReq('POST', '/admin/catalogo/categorias', { name: 'test' });
    assert.ok(r.status === 302 || r.status === 400);
  });
});

// ──── Validation: pagination and limits ────
describe('Phase 16C — Validation: pagination and limits', () => {
  it('store page rejects invalid sort parameter gracefully', async () => {
    const r = await httpReq('GET', '/tienda?sort=../../etc/passwd');
    assert.equal(r.status, 200);
    // Should not error, should fall back to default sort
  });

  it('store page handles negative page gracefully', async () => {
    const r = await httpReq('GET', '/tienda?page=-1');
    assert.equal(r.status, 200);
  });

  it('store page handles oversized limit gracefully', async () => {
    const r = await httpReq('GET', '/tienda?limit=99999');
    assert.equal(r.status, 200);
  });
});

// ──── Media: GLB validation ────
describe('Phase 16C — GLB upload validation', () => {
  it('inspectGlb rejects empty buffer', () => {
    const { inspectGlb } = require('../services/mediaStorageService');
    assert.throws(() => inspectGlb(Buffer.alloc(10)),
      /incompleto|dañado/);
  });

  it('inspectGlb rejects non-GLB magic bytes', () => {
    const { inspectGlb } = require('../services/mediaStorageService');
    const buf = Buffer.alloc(20);
    buf.writeUInt32LE(0xFFFFFFFF, 0); // invalid magic
    assert.throws(() => inspectGlb(buf),
      /no es un modelo GLB válido/);
  });

  it('inspectGlb rejects wrong version', () => {
    const { inspectGlb } = require('../services/mediaStorageService');
    const buf = Buffer.alloc(20);
    buf.writeUInt32LE(0x46546C67, 0); // glTF magic
    buf.writeUInt32LE(99, 4);         // wrong version
    assert.throws(() => inspectGlb(buf),
      /versión 2/);
  });

  it('inspectGlb rejects mismatched total length', () => {
    const { inspectGlb } = require('../services/mediaStorageService');
    const buf = Buffer.alloc(30);
    buf.writeUInt32LE(0x46546C67, 0); // glTF magic
    buf.writeUInt32LE(2, 4);          // version 2
    buf.writeUInt32LE(99999, 8);      // declared length != actual
    assert.throws(() => inspectGlb(buf),
      /no coincide/);
  });
});

// ──── Input validation: ID handling ────
describe('Phase 16C — Input validation: ID handling', () => {
  it('parsePositiveId rejects non-numeric input', () => {
    const { parsePositiveId } = require('../validators/addressValidator');
    assert.equal(parsePositiveId('abc'), null);
    assert.equal(parsePositiveId('1a2b'), null);
    assert.equal(parsePositiveId(''), null);
    assert.equal(parsePositiveId(null), null);
  });

  it('parsePositiveId rejects zero and negative', () => {
    const { parsePositiveId } = require('../validators/addressValidator');
    assert.equal(parsePositiveId('0'), null);
    assert.equal(parsePositiveId('-1'), null);
  });

  it('parsePositiveId accepts valid positive integers', () => {
    const { parsePositiveId } = require('../validators/addressValidator');
    assert.equal(parsePositiveId('1'), 1);
    assert.equal(parsePositiveId('999'), 999);
  });
});

// ──── Upload: selectorUploadMulter has MIME filter ────
describe('Phase 16C — Selector upload MIME filter', () => {
  it('selectorUploadMulter config includes fileFilter', () => {
    const fs = require('fs');
    const routes = fs.readFileSync(require('path').join(__dirname, '..', 'routes', 'adminPageRoutes.js'), 'utf8');
    assert.ok(routes.includes('fileFilter'), 'selectorUploadMulter should have a fileFilter');
    assert.ok(routes.includes('selectorFileFilter'), 'selectorFileFilter should be defined');
  });
});
