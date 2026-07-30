/**
 * Phase 11A — "Administrar página" HTTP behavior: authorization, CSRF,
 * navigation, media library rendering, uploads and public serving.
 * Spawns an isolated server on a random port, mirroring tests/gallery.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');

const pool = require('../config/db');
const storage = require('../services/mediaStorageService');
const { migrateCms } = require('../scripts/migrate-cms');
const { REVISION_ENTITY_TYPES } = require('../config/cmsOptions');

const marker = `cmsadmin_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const adminEmail = `${marker}@example.invalid`;
const userEmail = `${marker}_user@example.invalid`;
const password = `Cms-${crypto.randomBytes(8).toString('hex')}!`;
const port = 36600 + Math.floor(Math.random() * 300);
const adminJar = {};
const userJar = {};
let serverProcess;

function request(method, requestPath, body, jar = {}, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let payload = null;
    const headers = { ...extraHeaders };
    if (body && !Buffer.isBuffer(body)) {
      payload = Buffer.from(new URLSearchParams(body).toString());
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (Buffer.isBuffer(body)) {
      payload = body;
    }
    if (payload) headers['Content-Length'] = payload.length;
    if (jar.cookie) headers.Cookie = jar.cookie;
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: requestPath, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.headers['set-cookie']?.[0]) jar.cookie = res.headers['set-cookie'][0].split(';')[0];
          resolve({
            status: res.statusCode,
            data,
            headers: res.headers,
            location: res.headers.location || '',
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'la vista debe renderizar un token CSRF');
  return match[1];
}

function multipart(fields, files = []) {
  const boundary = `----cms${crypto.randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
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

async function loginAdmin() {
  const page = await request('GET', '/auth/login?returnTo=' + encodeURIComponent('/admin'), null, adminJar);
  const response = await request('POST', '/auth/login', {
    email: adminEmail,
    password,
    _csrf: csrf(page.data),
    returnTo: '/admin',
  }, adminJar);
  assert.equal(response.status, 302);
  assert.equal(response.location, '/admin');
}

async function loginUser() {
  const page = await request('GET', '/auth/login', null, userJar);
  const response = await request('POST', '/auth/login', {
    email: userEmail,
    password,
    _csrf: csrf(page.data),
  }, userJar);
  assert.equal(response.status, 302);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await request('GET', '/health')).status === 200) return;
    } catch {
      // The isolated server is still booting (session store + database probe).
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('El servidor de pruebas del CMS no inició');
}

async function cleanup() {
  // Delete all stale test artifacts (any marker, not just current run).
  await pool.query("DELETE FROM content_revisions WHERE entity_type = ? AND entity_id IN (SELECT id FROM media_assets WHERE title LIKE 'cmsadmin_%')", [
    REVISION_ENTITY_TYPES.MEDIA_ASSET,
  ]);
  const [assets] = await pool.query("SELECT * FROM media_assets WHERE title LIKE 'cmsadmin_%'");
  for (const asset of assets) {
    await storage.removeStoredPaths(storage.ownedPaths(asset));
  }
  await pool.query("DELETE FROM media_assets WHERE title LIKE 'cmsadmin_%'");
  await pool.query('DELETE FROM sessions WHERE data LIKE ?', [`%${marker}%`]);
  await pool.query('DELETE FROM users WHERE email IN (?, ?)', [adminEmail, userEmail]);
}

test.before(async () => {
  await migrateCms();
  await cleanup();
  const hash = await bcrypt.hash(password, 8);
  await pool.query('INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,1,1)', [
    `Admin ${marker}`, adminEmail, hash,
  ]);
  await pool.query('INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,2,1)', [
    `User ${marker}`, userEmail, hash,
  ]);
  serverProcess = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForServer();
  await loginAdmin();
  await loginUser();
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  await cleanup();
  await pool.end();
});

// ── Authorization ──

test('anonymous visitors cannot reach any CMS admin route', async () => {
  for (const route of ['/admin/page', '/admin/page/media', '/admin/page/media/upload']) {
    const response = await request('GET', route);
    assert.equal(response.status, 302);
    assert.match(response.location, /\/auth\/login/);
  }
});

test('authenticated non-admin users cannot reach the CMS admin routes', async () => {
  for (const route of ['/admin/page', '/admin/page/media']) {
    const response = await request('GET', route, null, userJar);
    assert.equal(response.status, 302);
    assert.equal(response.location, '/');
  }
});

test('admin sees "Administrar página" in the navigation and opens the overview', async () => {
  const overview = await request('GET', '/admin/page', null, adminJar);
  assert.equal(overview.status, 200);
  assert.match(overview.data, /Administrar página/);
  assert.match(overview.data, /Biblioteca multimedia/);
  assert.match(overview.data, /Publicación e historial/);
  // Active CMS modules must link to their editors.
  assert.match(overview.data, /href="\/admin\/page\/navbar"/);
  assert.match(overview.data, /href="\/admin\/page\/home\/panel-1"/);
  assert.match(overview.data, /href="\/admin\/page\/home\/panel-2"/);
  assert.match(overview.data, /href="\/admin\/page\/home\/panel-3"/);
  assert.match(overview.data, /href="\/admin\/page\/publishing"/);
  assert.doesNotMatch(overview.data, /href="\/admin\/page\/panel/);
  assert.match(overview.data, /href="\/admin\/page"/);

  const panel3 = await request('GET', '/admin/page/home/panel-3', null, adminJar);
  assert.equal(panel3.status, 200);
  assert.match(panel3.data, /name="media_public_id" value=""/);
  assert.match(panel3.data, /data-ms-tab="library"/);
  assert.match(panel3.data, /data-ms-tab="upload"/);

  const preview = await request('GET', '/admin/page/preview', null, adminJar);
  assert.equal(preview.status, 200);
  assert.match(preview.data, /Vista previa/);
  assert.equal(preview.headers['x-robots-tag'], 'noindex, nofollow');

  const library = await request('GET', '/admin/page/media', null, adminJar);
  assert.equal(library.status, 200);
  assert.match(library.data, /Biblioteca multimedia/);
  assert.match(library.data, /Cargar archivos/);
});

// ── CSRF ──

test('CMS write routes reject requests without a CSRF token', async () => {
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#0af' } }).png().toBuffer();
  const form = multipart(
    { category: 'site', title: `${marker} sin csrf`, altText: 'Sin CSRF' },
    [{ field: 'files', name: `${marker}-nocsrf.png`, type: 'image/png', buffer: png }]
  );
  const response = await request('POST', '/admin/page/media', form.body, adminJar, form.headers);
  assert.equal(response.status, 403);
  const [[after]] = await pool.query('SELECT COUNT(*) total FROM media_assets WHERE title = ?', [`${marker} sin csrf`]);
  assert.equal(Number(after.total), 0);

  const archive = await request('POST', `/admin/page/media/${crypto.randomUUID()}/archive`, {}, adminJar);
  assert.equal(archive.status, 403);
});

// ── Upload flow ──

test('admin uploads a valid image and the library renders its thumbnail', async () => {
  const page = await request('GET', '/admin/page/media/upload', null, adminJar);
  assert.equal(page.status, 200);
  const token = csrf(page.data);
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2f6' } }).png().toBuffer();
  const form = multipart(
    { _csrf: token, category: 'site', title: `${marker} imagen`, altText: 'Imagen de prueba', description: 'Prueba' },
    [{ field: 'files', name: `${marker}-valida.png`, type: 'image/png', buffer: png }]
  );

  const response = await request('POST', '/admin/page/media', form.body, adminJar, form.headers);
  assert.equal(response.status, 302);
  assert.equal(response.location, '/admin/page/media');

  const [rows] = await pool.query('SELECT * FROM media_assets WHERE title = ?', [`${marker} imagen`]);
  assert.equal(rows.length, 1);
  const asset = rows[0];
  assert.equal(asset.mime_type, 'image/webp');
  assert.ok(asset.thumbnail_path);
  assert.ok(asset.created_by, 'debe registrar quién cargó el archivo');

  const library = await request('GET', `/admin/page/media?search=${encodeURIComponent(`${marker} imagen`)}`, null, adminJar);
  assert.equal(library.status, 200);
  assert.match(library.data, new RegExp(asset.thumbnail_path.replace(/[/.]/g, '\\$&')));
  assert.match(library.data, /loading="lazy"/);
  // The grid must not embed the full-size original.
  assert.doesNotMatch(library.data, new RegExp(`src="${asset.public_url.replace(/[/.]/g, '\\$&')}"`));

  const detail = await request('GET', `/admin/page/media/${asset.public_id}`, null, adminJar);
  assert.equal(detail.status, 200);
  assert.match(detail.data, /Uso en el sitio/);
  assert.match(detail.data, /media:\/\//);
});

test('renamed executables and unsupported types are rejected without creating records', async () => {
  const page = await request('GET', '/admin/page/media/upload', null, adminJar);
  const token = csrf(page.data);
  const form = multipart(
    { _csrf: token, category: 'site', title: `${marker} ejecutable`, altText: 'Malicioso' },
    [{ field: 'files', name: `${marker}-virus.png`, type: 'image/png', buffer: Buffer.from('MZ\x90\x00 fake exe payload') }]
  );
  const response = await request('POST', '/admin/page/media', form.body, adminJar, form.headers);
  assert.equal(response.status, 302);
  assert.equal(response.location, '/admin/page/media/upload');

  const [rows] = await pool.query('SELECT id FROM media_assets WHERE title = ?', [`${marker} ejecutable`]);
  assert.equal(rows.length, 0);

  const follow = await request('GET', '/admin/page/media/upload', null, adminJar);
  assert.match(follow.data, /no es una imagen válida|dañado/);
});

test('an unknown media id returns a safe error instead of a stack trace', async () => {
  const response = await request('GET', `/admin/page/media/${crypto.randomUUID()}`, null, adminJar);
  assert.equal(response.status, 302);
  assert.equal(response.location, '/admin/page/media');
  const follow = await request('GET', '/admin/page/media', null, adminJar);
  assert.match(follow.data, /no existe en la biblioteca/);
  assert.doesNotMatch(follow.data, /at Object\.|node_modules|C:\\/);
});

// ── Public serving ──

test('public media URLs serve the file with safe headers and hide the filesystem root', async () => {
  const [rows] = await pool.query('SELECT * FROM media_assets WHERE title = ?', [`${marker} imagen`]);
  const asset = rows[0];
  assert.ok(asset, 'la imagen cargada debe existir');

  const response = await request('GET', asset.public_url);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /image\/webp/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['content-disposition'], undefined);

  // No directory listing anywhere under the media root.
  const listing = await request('GET', '/uploads/media/');
  assert.equal(listing.status, 404);
  assert.doesNotMatch(listing.data, new RegExp(asset.filename));

  const traversal = await request('GET', '/uploads/media/site/../../../app.js');
  assert.notEqual(traversal.status, 200);
});

// ── Regression ──

test('existing admin sections and the public homepage keep working', async () => {
  const dashboard = await request('GET', '/admin', null, adminJar);
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.data, /Administrar página/);
  assert.match(dashboard.data, /Galería/);

  for (const route of ['/admin/galeria', '/admin/catalogo/productos', '/admin/orders', '/admin/users']) {
    const response = await request('GET', route, null, adminJar);
    assert.equal(response.status, 200, `${route} debe seguir disponible`);
  }

  const home = await request('GET', '/');
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.data, /media:\/\//);
  assert.doesNotMatch(home.data, /uploads\\/);

  const gallery = await request('GET', '/galeria');
  assert.equal(gallery.status, 200);
});

test('public 404 and global HTML error rendering preserve the original status', async () => {
  const notFound = await request('GET', '/ruta-publica-que-no-existe', null, {}, { Accept: 'text/html' });
  assert.equal(notFound.status, 404);
  assert.match(notFound.data, /<h1>404<\/h1>/);
  assert.doesNotMatch(notFound.data, /site is not defined|ReferenceError/);

  const serverError = await request(
    'POST',
    '/auth/login',
    Buffer.from('{'),
    {},
    { 'Content-Type': 'application/json', Accept: 'text/html' }
  );
  assert.equal(serverError.status, 500);
  assert.match(serverError.data, /Error del servidor/);
  assert.doesNotMatch(serverError.data, /site is not defined|ReferenceError/);

  const login = await request('GET', '/auth/login');
  assert.equal(login.status, 200);
  assert.match(login.data, /action="\/auth\/login"/);
});
