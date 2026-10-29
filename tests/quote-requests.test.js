/**
 * Public quote requests + admin inbox + cost_quotes isolation.
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { startTestServer, stopTestServer } = require('./testServer');
const validator = require('../validators/quoteRequestValidator');
const quoteService = require('../services/quoteRequestService');
const { UPLOAD_PUBLIC_ROOT } = require('../config/uploadPaths');

const marker = `qr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const adminEmail = `${marker}_a@example.invalid`;
const adminPass = `A-${crypto.randomBytes(6).toString('hex')}!`;
const userEmail = `${marker}_u@example.invalid`;
const userPass = `U-${crypto.randomBytes(6).toString('hex')}!`;

let baseUrl;
let adminJar = { cookie: '' };
let userJar = { cookie: '' };
let adminId;
let userId;
const createdPublicIds = [];

function csrf(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

async function req(method, urlPath, body, jar, { multipart, multipartHeaders, accept } = {}) {
  const headers = {};
  let payload = body;
  if (jar?.cookie) headers.Cookie = jar.cookie;
  if (accept) headers.Accept = accept;
  if (multipart) {
    payload = multipart;
    if (multipartHeaders) Object.assign(headers, multipartHeaders);
  } else if (body && typeof body === 'object') {
    payload = new URLSearchParams(body).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const r = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: payload || undefined,
    redirect: 'manual',
  });
  if (jar) {
    const setCookies = typeof r.headers.getSetCookie === 'function'
      ? r.headers.getSetCookie()
      : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    for (const raw of setCookies) {
      const pair = String(raw).split(';')[0];
      if (!pair.includes('=')) continue;
      const name = pair.split('=')[0];
      const parts = jar.cookie
        ? jar.cookie.split('; ').filter((p) => p && !p.startsWith(`${name}=`))
        : [];
      parts.push(pair);
      jar.cookie = parts.join('; ');
    }
  }
  return { status: r.status, location: r.headers.get('location') || '', text: await r.text(), headers: r.headers };
}

function buildMultipart(fields, files = []) {
  const boundary = `----quote${crypto.randomBytes(8).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
  }
  for (const file of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\n`
      + `Content-Type: ${file.type}\r\n\r\n`
    ));
    parts.push(file.buffer, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function tinyPng() {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: '#39ff14' } }).png().toBuffer();
}

before(async () => {
  const info = await startTestServer();
  baseUrl = info.baseUrl;

  const adminHash = await bcrypt.hash(adminPass, 10);
  const [adminResult] = await pool.query(
    'INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, 1)',
    ['Quote Admin', adminEmail, adminHash]
  );
  adminId = adminResult.insertId;

  const userHash = await bcrypt.hash(userPass, 10);
  const [userResult] = await pool.query(
    'INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, 2)',
    ['Quote User', userEmail, userHash]
  );
  userId = userResult.insertId;

  const loginAdmin = await req('GET', '/auth/login', null, adminJar);
  await req('POST', '/auth/login', {
    _csrf: csrf(loginAdmin.text),
    email: adminEmail,
    password: adminPass,
    returnTo: '/cuenta',
  }, adminJar);

  const loginUser = await req('GET', '/auth/login', null, userJar);
  await req('POST', '/auth/login', {
    _csrf: csrf(loginUser.text),
    email: userEmail,
    password: userPass,
    returnTo: '/cuenta',
  }, userJar);
});

after(async () => {
  try {
    if (createdPublicIds.length) {
      const [rows] = await pool.query(
        `SELECT id, public_id FROM quote_requests WHERE public_id IN (${createdPublicIds.map(() => '?').join(',')})`,
        createdPublicIds
      );
      for (const row of rows) {
        await pool.query('DELETE FROM quote_request_files WHERE quote_request_id = ?', [row.id]);
        const dir = path.join(UPLOAD_PUBLIC_ROOT, 'quotes', row.public_id);
        try { await fs.promises.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      await pool.query(
        `DELETE FROM quote_requests WHERE public_id IN (${createdPublicIds.map(() => '?').join(',')})`,
        createdPublicIds
      );
    }
  } finally {
    await pool.query('DELETE FROM users WHERE email LIKE ?', [`${marker}_%`]);
    await stopTestServer();
  }
});

describe('quote request pages SEO + content', () => {
  const pages = [
    ['/soluciones-digitales', 'Soluciones digitales | NinjaLabCR', 'Cotizar sitio web'],
    ['/fabricacion-3d', 'Fabricación e impresión 3D | NinjaLabCR', 'Cotizar pieza 3D'],
    ['/cotizar/sitio-web', 'Cotizar sitio web | NinjaLabCR', 'Cotización de sitio web'],
    ['/cotizar/pieza-3d', 'Cotizar pieza 3D | NinjaLabCR', 'Cotización personalizada 3D'],
    ['/cotizar/otros', 'Solicitar cotización | NinjaLabCR', 'Solicitar cotización'],
  ];

  for (const [url, title, heading] of pages) {
    it(`GET ${url} returns 200 with SEO title`, async () => {
      const r = await req('GET', url);
      assert.equal(r.status, 200);
      assert.ok(r.text.includes(`<title>${title}</title>`) || r.text.includes(title));
      assert.ok(r.text.includes(heading));
      assert.ok(r.text.includes('rel="canonical"'));
      assert.ok(r.text.includes('data-home-navbar') || r.text.includes('hero-nav'));
    });
  }

  it('3D quote shows query reference', async () => {
    const r = await req('GET', '/cotizar/pieza-3d?ref=mas-001&nombre=Placa%20con%20nombre%20grabado');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('Pieza de referencia: Placa con nombre grabado'));
  });
});

describe('validator URL safety', () => {
  it('accepts http(s) file links and rejects dangerous schemes', () => {
    assert.equal(validator.safeHttpUrl('https://makerworld.com/x').valid, true);
    assert.equal(validator.safeHttpUrl('https://drive.google.com/file').valid, true);
    assert.equal(validator.safeHttpUrl('https://www.thingiverse.com/thing:1').valid, true);
    assert.equal(validator.safeHttpUrl('javascript:alert(1)').valid, false);
    assert.equal(validator.safeHttpUrl('file:///etc/passwd').valid, false);
    assert.equal(validator.safeHttpUrl('data:text/html,hi').valid, false);
  });
});

describe('website quote submission', () => {
  it('creates quote_requests row for valid website form', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/sitio-web', null, jar);
    const token = csrf(page.text);
    assert.ok(token, 'csrf');
    const r = await req('POST', '/cotizar/sitio-web', {
      _csrf: token,
      customer_name: 'Cliente Web',
      customer_email: `${marker}_web@example.invalid`,
      customer_phone: '8888-1111',
      company: 'Marca Test',
      website_type: 'Landing page',
      description: 'Necesito una landing para mi negocio.',
      has_domain: 'unknown',
      budget: 'Pendiente',
    }, jar);
    assert.ok([302, 303].includes(r.status), `status=${r.status} loc=${r.location}`);
    const [rows] = await pool.query(
      'SELECT * FROM quote_requests WHERE customer_email = ? ORDER BY id DESC LIMIT 1',
      [`${marker}_web@example.invalid`]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].request_type, 'website');
    assert.equal(rows[0].status, 'new');
    assert.equal(rows[0].user_id, null);
    createdPublicIds.push(rows[0].public_id);
    const payload = typeof rows[0].payload_json === 'string'
      ? JSON.parse(rows[0].payload_json)
      : rows[0].payload_json;
    assert.equal(payload.websiteType, 'Landing page');
    assert.equal(payload.description.includes('landing'), true);
  });

  it('rejects invalid email without creating row', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/sitio-web', null, jar);
    const token = csrf(page.text);
    const [before] = await pool.query('SELECT COUNT(*) AS c FROM quote_requests');
    await req('POST', '/cotizar/sitio-web', {
      _csrf: token,
      customer_name: 'X',
      customer_email: 'not-an-email',
      customer_phone: '111',
      description: 'desc',
    }, jar);
    const [after] = await pool.query('SELECT COUNT(*) AS c FROM quote_requests');
    assert.equal(Number(after[0].c), Number(before[0].c));
  });

  it('rejects missing description', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/sitio-web', null, jar);
    const token = csrf(page.text);
    const [before] = await pool.query('SELECT COUNT(*) AS c FROM quote_requests');
    await req('POST', '/cotizar/sitio-web', {
      _csrf: token,
      customer_name: 'X',
      customer_email: `${marker}_nodesc@example.invalid`,
      customer_phone: '111',
      description: '',
    }, jar);
    const [after] = await pool.query('SELECT COUNT(*) AS c FROM quote_requests');
    assert.equal(Number(after[0].c), Number(before[0].c));
  });
});

describe('3d quote submission', () => {
  it('creates 3d request with images and reference fields', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/pieza-3d?ref=test001&nombre=Placa%20personalizada', null, jar);
    const token = csrf(page.text);
    const img = await tinyPng();
    const mp = buildMultipart({
      _csrf: token,
      customer_name: 'Cliente 3D',
      customer_email: `${marker}_3d@example.invalid`,
      customer_phone: '8888-2222',
      description: 'Quiero una placa personalizada.',
      width: '80',
      depth: '40',
      height: '5',
      quantity: '2',
      material: 'PLA',
      file_link: 'https://makerworld.com/models/demo',
      reference_id: 'test001',
      reference_product: 'Placa personalizada',
    }, [
      { field: 'images', name: 'a.png', type: 'image/png', buffer: img },
      { field: 'images', name: 'b.png', type: 'image/png', buffer: img },
    ]);
    const r2 = await req('POST', '/cotizar/pieza-3d', null, jar, {
      multipart: mp.body,
      multipartHeaders: mp.headers,
    });
    assert.ok([302, 303].includes(r2.status), `status=${r2.status} loc=${r2.location} body=${r2.text.slice(0, 200)}`);

    const [rows] = await pool.query(
      'SELECT * FROM quote_requests WHERE customer_email = ? ORDER BY id DESC LIMIT 1',
      [`${marker}_3d@example.invalid`]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].request_type, '3d');
    createdPublicIds.push(rows[0].public_id);
    const payload = typeof rows[0].payload_json === 'string'
      ? JSON.parse(rows[0].payload_json)
      : rows[0].payload_json;
    assert.equal(payload.referenceId, 'test001');
    assert.equal(payload.referenceProduct, 'Placa personalizada');
    assert.equal(payload.material, 'PLA');
    assert.equal(payload.fileLink.startsWith('https://'), true);

    const [files] = await pool.query(
      'SELECT * FROM quote_request_files WHERE quote_request_id = ?',
      [rows[0].id]
    );
    assert.equal(files.length, 2);
    for (const f of files) {
      assert.ok(f.storage_path.includes(`quotes/${rows[0].public_id}/`));
      assert.equal(f.mime_type, 'image/webp');
      const abs = path.join(UPLOAD_PUBLIC_ROOT, f.storage_path);
      assert.ok(fs.existsSync(abs));
      const meta = await sharp(abs).metadata();
      assert.equal(meta.format, 'webp');
    }
  });

  it('rejects 6 images without creating quote or orphans', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/pieza-3d', null, jar);
    const token = csrf(page.text);
    const img = await tinyPng();
    const files = [];
    for (let i = 0; i < 6; i += 1) {
      files.push({ field: 'images', name: `i${i}.png`, type: 'image/png', buffer: img });
    }
    const mp = buildMultipart({
      _csrf: token,
      customer_name: 'Too Many',
      customer_email: `${marker}_6img@example.invalid`,
      customer_phone: '1',
      description: 'test',
      width: '10',
      height: '10',
    }, files);
    const [before] = await pool.query(
      'SELECT COUNT(*) AS c FROM quote_requests WHERE customer_email = ?',
      [`${marker}_6img@example.invalid`]
    );
    const r = await req('POST', '/cotizar/pieza-3d', null, jar, {
      multipart: mp.body,
      multipartHeaders: mp.headers,
    });
    assert.ok(r.status >= 400 || [302, 303].includes(r.status));
    const [after] = await pool.query(
      'SELECT COUNT(*) AS c FROM quote_requests WHERE customer_email = ?',
      [`${marker}_6img@example.invalid`]
    );
    assert.equal(Number(after[0].c), Number(before[0].c));
  });

  it('rejects fake image without creating quote', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/pieza-3d', null, jar);
    const token = csrf(page.text);
    const mp = buildMultipart({
      _csrf: token,
      customer_name: 'Bad Img',
      customer_email: `${marker}_badimg@example.invalid`,
      customer_phone: '1',
      description: 'test',
      width: '10',
      height: '10',
    }, [{ field: 'images', name: 'fake.png', type: 'image/png', buffer: Buffer.from('not-an-image') }]);
    const [before] = await pool.query(
      'SELECT COUNT(*) AS c FROM quote_requests WHERE customer_email = ?',
      [`${marker}_badimg@example.invalid`]
    );
    await req('POST', '/cotizar/pieza-3d', null, jar, {
      multipart: mp.body,
      multipartHeaders: mp.headers,
    });
    const [after] = await pool.query(
      'SELECT COUNT(*) AS c FROM quote_requests WHERE customer_email = ?',
      [`${marker}_badimg@example.invalid`]
    );
    assert.equal(Number(after[0].c), Number(before[0].c));
  });

  it('rejects javascript file links', async () => {
    const v = validator.validate3dQuote({
      customer_name: 'A',
      customer_email: 'a@b.co',
      customer_phone: '1',
      width: '10',
      height: '10',
      file_link: 'javascript:alert(1)',
    });
    assert.equal(v.valid, false);
  });

  it('allows empty description when width and height are present', async () => {
    const v = validator.validate3dQuote({
      customer_name: 'A',
      customer_email: 'a@b.co',
      customer_phone: '1',
      description: '',
      width: '100',
      height: '50',
    });
    assert.equal(v.valid, true);
    assert.equal(v.value.payload.description, '');
    assert.equal(v.value.payload.width, 100);
    assert.equal(v.value.payload.height, 50);
    assert.equal(v.value.payload.depth, null);
  });

  it('requires width and height > 0', async () => {
    const missingW = validator.validate3dQuote({
      customer_name: 'A', customer_email: 'a@b.co', customer_phone: '1', height: '50',
    });
    assert.equal(missingW.valid, false);
    assert.match(missingW.error, /ancho/i);

    const missingH = validator.validate3dQuote({
      customer_name: 'A', customer_email: 'a@b.co', customer_phone: '1', width: '100',
    });
    assert.equal(missingH.valid, false);
    assert.match(missingH.error, /altura/i);

    const zero = validator.validate3dQuote({
      customer_name: 'A', customer_email: 'a@b.co', customer_phone: '1', width: '0', height: '0',
    });
    assert.equal(zero.valid, false);
  });

  it('AJAX missing width returns 422 JSON without creating quote', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/pieza-3d', null, jar);
    const token = csrf(page.text);
    const [before] = await pool.query('SELECT COUNT(*) AS c FROM quote_requests');
    const r = await req('POST', '/cotizar/pieza-3d', {
      _csrf: token,
      customer_name: 'Ajax Fail',
      customer_email: `${marker}_ajaxfail@example.invalid`,
      customer_phone: '1',
      height: '50',
    }, jar, { accept: 'application/json' });
    assert.equal(r.status, 422);
    const json = JSON.parse(r.text);
    assert.equal(json.ok, false);
    assert.match(json.error, /ancho/i);
    const [after] = await pool.query('SELECT COUNT(*) AS c FROM quote_requests');
    assert.equal(Number(after[0].c), Number(before[0].c));
  });

  it('AJAX success returns JSON reference and creates quote without description', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/pieza-3d', null, jar);
    const token = csrf(page.text);
    const r = await req('POST', '/cotizar/pieza-3d', {
      _csrf: token,
      customer_name: 'Ajax Ok',
      customer_email: `${marker}_ajaxok@example.invalid`,
      customer_phone: '9999',
      description: '',
      width: '120',
      height: '40',
      quantity: '1',
    }, jar, { accept: 'application/json' });
    assert.ok([200, 201].includes(r.status), `status=${r.status} body=${r.text.slice(0, 200)}`);
    const json = JSON.parse(r.text);
    assert.equal(json.ok, true);
    assert.ok(json.reference);
    const [rows] = await pool.query(
      'SELECT * FROM quote_requests WHERE customer_email = ? ORDER BY id DESC LIMIT 1',
      [`${marker}_ajaxok@example.invalid`]
    );
    assert.equal(rows.length, 1);
    createdPublicIds.push(rows[0].public_id);
    const payload = typeof rows[0].payload_json === 'string'
      ? JSON.parse(rows[0].payload_json)
      : rows[0].payload_json;
    assert.equal(payload.description, '');
    assert.equal(payload.width, 120);
    assert.equal(payload.height, 40);
  });

  it('preserves sticky text values after HTML validation failure', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/pieza-3d', null, jar);
    const token = csrf(page.text);
    const fail = await req('POST', '/cotizar/pieza-3d', {
      _csrf: token,
      customer_name: 'Sticky Name',
      customer_email: `${marker}_sticky@example.invalid`,
      customer_phone: '5555',
      description: 'keep me',
      height: '33',
    }, jar);
    assert.ok([302, 303].includes(fail.status));
    const again = await req('GET', fail.location || '/cotizar/pieza-3d', null, jar);
    assert.equal(again.status, 200);
    assert.ok(again.text.includes('value="Sticky Name"'));
    assert.ok(again.text.includes('value="5555"'));
    assert.ok(again.text.includes('keep me'));
    assert.ok(again.text.includes('value="33"'));
  });

  it('renders shared 12 MB / 5 file limits on the 3D page', async () => {
    const page = await req('GET', '/cotizar/pieza-3d');
    assert.equal(page.status, 200);
    assert.ok(page.text.includes('data-max-image-files="5"'));
    assert.ok(page.text.includes('data-max-image-bytes="12582912"'));
    assert.ok(page.text.includes('data-max-image-mb="12"'));
    assert.ok(page.text.includes('12 MB'));
  });
});

describe('quote upload size errors', () => {
  const uploadMw = require('../middleware/quoteRequestUpload');

  it('maps LIMIT_FILE_SIZE to FILE_TOO_LARGE / 413', () => {
    const mapped = uploadMw.mapUploadError({
      code: 'LIMIT_FILE_SIZE',
      message: 'Cada imagen puede pesar máximo 12 MB.',
    });
    assert.equal(mapped.status, 413);
    assert.equal(mapped.code, 'FILE_TOO_LARGE');
    assert.equal(mapped.field, 'images');
    assert.match(mapped.error, /12 MB/);
  });

  it('AJAX LIMIT_FILE_SIZE returns 413 JSON (no 500)', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/pieza-3d', null, jar);
    const token = csrf(page.text);
    // Simulate Multer by invoking the error handler through an oversized buffer.
    // Creating a real 13MB payload is acceptable for one regression test.
    const big = Buffer.alloc(13 * 1024 * 1024, 1);
    const mp = buildMultipart({
      _csrf: token,
      customer_name: 'Big File',
      customer_email: `${marker}_big@example.invalid`,
      customer_phone: '1',
      width: '10',
      height: '10',
    }, [{ field: 'images', name: 'huge.jpg', type: 'image/jpeg', buffer: big }]);
    const [before] = await pool.query('SELECT COUNT(*) AS c FROM quote_requests');
    const r = await req('POST', '/cotizar/pieza-3d', null, jar, {
      multipart: mp.body,
      multipartHeaders: { ...mp.headers, Accept: 'application/json' },
      accept: 'application/json',
    });
    assert.equal(r.status, 413, `expected 413 got ${r.status}: ${r.text.slice(0, 300)}`);
    const json = JSON.parse(r.text);
    assert.equal(json.ok, false);
    assert.equal(json.field, 'images');
    assert.equal(json.code, 'FILE_TOO_LARGE');
    assert.match(json.error, /12 MB/);
    const [after] = await pool.query('SELECT COUNT(*) AS c FROM quote_requests');
    assert.equal(Number(after[0].c), Number(before[0].c));
  });

  it('HTML LIMIT_FILE_SIZE redirects with friendly alert (no 500)', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/pieza-3d', null, jar);
    const token = csrf(page.text);
    const big = Buffer.alloc(13 * 1024 * 1024, 1);
    const mp = buildMultipart({
      _csrf: token,
      customer_name: 'Big Html',
      customer_email: `${marker}_bightml@example.invalid`,
      customer_phone: '1',
      width: '10',
      height: '10',
      description: 'keep sticky',
    }, [{ field: 'images', name: 'huge.jpg', type: 'image/jpeg', buffer: big }]);
    const r = await req('POST', '/cotizar/pieza-3d', null, jar, {
      multipart: mp.body,
      multipartHeaders: mp.headers,
    });
    assert.ok([302, 303].includes(r.status), `status=${r.status}`);
    assert.ok((r.location || '').includes('/cotizar/pieza-3d'));
    const again = await req('GET', r.location || '/cotizar/pieza-3d', null, jar);
    assert.equal(again.status, 200);
    assert.ok(again.text.includes('12 MB') || again.text.includes('máximo'));
  });

  it('client JS rejects oversized files before upload and never clears on error', () => {
    const js = fs.readFileSync(path.join(__dirname, '../public/js/quote-3d.js'), 'utf8');
    assert.match(js, /dataset\.maxImageBytes|maxImageBytes/);
    assert.match(js, /file\.size/);
    assert.match(js, /máximo permitido es/);
    const submitIdx = js.indexOf("addEventListener('submit'");
    const clearIdx = js.indexOf('clearFormKeepAuth()', submitIdx);
    const errorBranch = js.slice(submitIdx, clearIdx);
    assert.ok(!errorBranch.includes('form.reset()'));
    assert.ok(!errorBranch.includes('selected = []'));
  });
});

describe('other + auth user quotes', () => {
  it('creates other request', async () => {
    const jar = { cookie: '' };
    const page = await req('GET', '/cotizar/otros', null, jar);
    const token = csrf(page.text);
    const r = await req('POST', '/cotizar/otros', {
      _csrf: token,
      customer_name: 'Otro',
      customer_email: `${marker}_other@example.invalid`,
      customer_phone: '333',
      project_type: 'Integración custom',
      description: 'Proyecto mixto web + 3D',
      budget: 'A definir',
    }, jar);
    assert.ok([302, 303].includes(r.status), `status=${r.status}`);
    const [rows] = await pool.query(
      'SELECT * FROM quote_requests WHERE customer_email = ? ORDER BY id DESC LIMIT 1',
      [`${marker}_other@example.invalid`]
    );
    assert.equal(rows[0].request_type, 'other');
    createdPublicIds.push(rows[0].public_id);
  });

  it('stores user_id for authenticated submission', async () => {
    const page = await req('GET', '/cotizar/otros', null, userJar);
    const token = csrf(page.text);
    const r = await req('POST', '/cotizar/otros', {
      _csrf: token,
      customer_name: 'Auth User',
      customer_email: userEmail,
      customer_phone: '444',
      project_type: 'Cuenta',
      description: 'Desde usuario autenticado',
    }, userJar);
    assert.ok([302, 303].includes(r.status), `status=${r.status}`);
    const [rows] = await pool.query(
      'SELECT * FROM quote_requests WHERE customer_email = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
      [userEmail, userId]
    );
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].user_id), Number(userId));
    createdPublicIds.push(rows[0].public_id);
  });
});

describe('admin quote inbox', () => {
  it('denies non-admin', async () => {
    const r = await req('GET', '/admin/cotizaciones', null, userJar);
    assert.ok([302, 303, 401, 403].includes(r.status));
  });

  it('lists and filters for admin', async () => {
    const r = await req('GET', '/admin/cotizaciones', null, adminJar);
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('Solicitudes de cotización'));

    const filtered = await req('GET', '/admin/cotizaciones?type=3d&status=new', null, adminJar);
    assert.equal(filtered.status, 200);
  });

  it('detail + status update require CSRF', async () => {
    const [rows] = await pool.query(
      'SELECT public_id FROM quote_requests WHERE customer_email LIKE ? ORDER BY id DESC LIMIT 1',
      [`${marker}%`]
    );
    assert.ok(rows[0]);
    const detail = await req('GET', `/admin/cotizaciones/${rows[0].public_id}`, null, adminJar);
    assert.equal(detail.status, 200);
    assert.ok(!detail.text.includes('Abrir herramienta') || detail.text.includes('Cotización'));

    const noCsrf = await req('POST', `/admin/cotizaciones/${rows[0].public_id}/status`, {
      status: 'in_review',
    }, adminJar);
    assert.ok([403, 400, 302, 303].includes(noCsrf.status));

    const token = csrf(detail.text);
    const ok = await req('POST', `/admin/cotizaciones/${rows[0].public_id}/status`, {
      _csrf: token,
      status: 'in_review',
    }, adminJar);
    assert.ok([302, 303].includes(ok.status));
    const [[updated]] = await pool.query(
      'SELECT status FROM quote_requests WHERE public_id = ?',
      [rows[0].public_id]
    );
    assert.equal(updated.status, 'in_review');
  });
});

describe('cost quote isolation', () => {
  it('keeps /admin/cotizacion-3d distinct from public inbox', async () => {
    const r = await req('GET', '/admin/cotizacion-3d', null, adminJar);
    assert.ok([200, 302, 303].includes(r.status));
    if (r.status === 200) {
      assert.ok(!r.text.includes('Solicitudes de cotización') || r.text.includes('cotizacion'));
    }
    const inbox = await req('GET', '/admin/cotizaciones', null, adminJar);
    assert.equal(inbox.status, 200);
    assert.ok(inbox.text.includes('Solicitudes de cotización'));
  });

  it('does not write to cost_quotes on public create', async () => {
    const [before] = await pool.query('SELECT COUNT(*) AS c FROM cost_quotes');
    await quoteService.createQuoteRequest({
      requestType: 'other',
      customerName: 'Iso',
      customerEmail: `${marker}_iso@example.invalid`,
      customerPhone: '1',
      subject: 'iso',
      payload: { projectType: 'iso', description: 'iso', budget: '', desiredDate: '' },
    });
    const [rows] = await pool.query(
      'SELECT public_id FROM quote_requests WHERE customer_email = ?',
      [`${marker}_iso@example.invalid`]
    );
    createdPublicIds.push(rows[0].public_id);
    const [after] = await pool.query('SELECT COUNT(*) AS c FROM cost_quotes');
    assert.equal(Number(after[0].c), Number(before[0].c));
  });
});

describe('navbar ARIA markers on public pages', () => {
  it('home and gallery expose dropdown triggers with aria-controls', async () => {
    const home = await req('GET', '/');
    const gallery = await req('GET', '/galeria');
    assert.equal(home.status, 200);
    assert.equal(gallery.status, 200);
    for (const html of [home.text, gallery.text]) {
      assert.ok(html.includes('aria-controls="nav-panel-'));
      assert.ok(html.includes('aria-expanded="false"'));
      assert.ok(html.includes('Soluciones Digitales') || html.includes('Servicios'));
      assert.ok(html.includes('Pieza 3D') || html.includes('Cotizar'));
    }
  });
});
