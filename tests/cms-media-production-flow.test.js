/**
 * Production-style CMS media flow:
 * real HTTP upload + real MySQL persistence + published homepage rendering +
 * process restart + reference-aware permanent deletion.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { buildIsolatedTestEnvironment } = require('../config/testProcessEnvironment');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');

const volumeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-cms-volume-'));
process.env.UPLOAD_PUBLIC_DIR = volumeRoot;

const pool = require('../config/db');
const storage = require('../services/mediaStorageService');
const mediaService = require('../services/mediaService');
const repeatable = require('../services/cmsRepeatableService');
const reconciliation = require('../services/mediaReconciliationService');
const { migrateCms } = require('../scripts/migrate-cms');

const marker = `media_prod_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const adminEmail = `${marker}@example.invalid`;
const password = `Media-${crypto.randomBytes(8).toString('hex')}!`;
const port = 37200 + Math.floor(Math.random() * 300);
const jar = {};
let child = null;
let adminId = null;
let section = null;
let previousSection = null;
const createdItemIds = [];
const createdAssetIds = [];

function assertSafeLocalDatabase() {
  const { assertSafeTestDatabase } = require('../config/testDatabaseGuard');
  assertSafeTestDatabase({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || '',
  }, { requireMutationOptIn: true });
}

function request(method, requestPath, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...extraHeaders };
    if (body) headers['Content-Length'] = body.length;
    if (jar.cookie) headers.Cookie = jar.cookie;
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: requestPath, headers, timeout: 5000 },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (res.headers['set-cookie']?.[0]) jar.cookie = res.headers['set-cookie'][0].split(';')[0];
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks),
            text: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
            location: res.headers.location || '',
          });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`request timeout: ${requestPath}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function formBody(fields) {
  return Buffer.from(new URLSearchParams(fields).toString());
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'admin page must expose a CSRF token');
  return match[1];
}

function multipart(fields, file) {
  const boundary = `----nlmedia${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n`
    + `Content-Type: ${file.type}\r\n\r\n`
  ));
  chunks.push(file.buffer, Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function startServer() {
  child = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: buildIsolatedTestEnvironment(process.env, {
      PORT: String(port),
      UPLOAD_PUBLIC_DIR: volumeRoot,
    }),
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`test server exited with ${child.exitCode}`);
    try {
      if ((await request('GET', '/health')).status === 200) return;
    } catch {
      // Server is still opening its database/session store.
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error('production-style test server did not start');
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  child = null;
}

async function login() {
  const page = await request('GET', '/auth/login?returnTo=' + encodeURIComponent('/admin'));
  const payload = formBody({ email: adminEmail, password, _csrf: csrf(page.text), returnTo: '/admin' });
  const response = await request('POST', '/auth/login', payload, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  assert.equal(response.status, 302);
  assert.equal(response.location, '/admin');
}

async function upload(profile, name, color) {
  const panel = await request('GET', '/admin/page/home/panel-2');
  assert.equal(panel.status, 200);
  const image = await sharp({
    create: { width: 960, height: 540, channels: 3, background: color },
  }).png().toBuffer();
  const form = multipart(
    { _csrf: csrf(panel.text), profile },
    { name, type: 'image/png', buffer: image }
  );
  const response = await request('POST', '/admin/api/page/media/upload', form.body, {
    'Content-Type': form.contentType,
  });
  assert.equal(response.status, 200, response.text);
  const json = JSON.parse(response.text);
  assert.equal(json.success, true);
  const [[asset]] = await pool.query('SELECT * FROM media_assets WHERE public_id = ?', [json.asset.public_id]);
  assert.ok(asset);
  createdAssetIds.push(asset.id);
  assert.match(asset.storage_path, /^media\/(logos|carousel)\//);
  assert.equal(asset.public_url, `/uploads/${asset.storage_path}`);
  assert.equal(storage.resolveStoragePath(asset.storage_path).startsWith(path.resolve(volumeRoot) + path.sep), true);
  assert.equal(fs.existsSync(storage.resolveStoragePath(asset.storage_path)), true);
  const served = await request('GET', asset.public_url);
  assert.equal(served.status, 200);
  assert.match(String(served.headers['content-type']), /^image\/webp/);
  return asset;
}

async function publishRoute(route) {
  const panel = await request('GET', '/admin/page/home/panel-2');
  const payload = formBody({ _csrf: csrf(panel.text) });
  const response = await request('POST', route, payload, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  assert.equal(response.status, 302);
}

async function cleanup() {
  await stopServer();
  if (createdItemIds.length) {
    await pool.query(
      `DELETE FROM content_revisions WHERE entity_type IN ('logo_loop_item','carousel_item')
         AND entity_id IN (${createdItemIds.map(() => '?').join(',')})`,
      createdItemIds
    ).catch(() => {});
  }
  await pool.query('DELETE FROM logo_loop_items WHERE text_content LIKE ?', [`${marker}%`]).catch(() => {});
  await pool.query('DELETE FROM home_carousel_items WHERE title LIKE ?', [`${marker}%`]).catch(() => {});
  if (previousSection && section) {
    await pool.query(
      'UPDATE page_sections SET status = ?, is_enabled = ?, content_json = ?, style_json = ? WHERE id = ?',
      [
        previousSection.status,
        previousSection.is_enabled,
        previousSection.content_json,
        previousSection.style_json,
        section.id,
      ]
    ).catch(() => {});
  }
  const [assets] = await pool.query('SELECT * FROM media_assets WHERE original_name LIKE ?', [`${marker}%`]).catch(() => [[]]);
  for (const asset of assets) {
    await storage.removeStoredPaths(storage.ownedPaths(asset)).catch(() => {});
    await pool.query('DELETE FROM content_revisions WHERE entity_type = ? AND entity_id = ?', ['media_asset', asset.id]).catch(() => {});
    await pool.query('DELETE FROM media_assets WHERE id = ?', [asset.id]).catch(() => {});
  }
  await pool.query('DELETE FROM sessions WHERE data LIKE ?', [`%${marker}%`]).catch(() => {});
  await pool.query('DELETE FROM users WHERE email = ?', [adminEmail]).catch(() => {});
  fs.rmSync(volumeRoot, { recursive: true, force: true });
}

test('uploaded LogoLoop and carousel media survive restart, render publicly, and delete safely', { timeout: 90000 }, async () => {
  assertSafeLocalDatabase();
  await migrateCms();
  await cleanup();
  fs.mkdirSync(volumeRoot, { recursive: true });

  const passwordHash = await bcrypt.hash(password, 8);
  const [userResult] = await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,1,1)',
    [`Admin ${marker}`, adminEmail, passwordHash]
  );
  adminId = userResult.insertId;
  const [[sectionRow]] = await pool.query(
    `SELECT s.* FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = 'home' AND s.section_key = 'showcase' LIMIT 1`
  );
  assert.ok(sectionRow, 'home/showcase section must exist');
  section = sectionRow;
  previousSection = { ...sectionRow };

  try {
    await startServer();
    await login();

    const media = await upload('logo-loop', `${marker}-shared.png`, '#ca2a31');

    const logoItem = await repeatable.createItem('logo_loop_items', section.id, {
      item_type: 'image',
      text_content: `${marker} logo`,
      media_public_id: media.public_id,
      url: null,
      link_type: 'internal',
      target: '_self',
      alt_text: `${marker} logo alt`,
      is_visible: 1,
      status: 'draft',
      sort_order: 9998,
    }, { actorId: adminId });
    const carouselItem = await repeatable.createItem('home_carousel_items', section.id, {
      eyebrow: marker,
      title: `${marker} carousel`,
      description: 'production-style persistence check',
      button_label: null,
      button_url: null,
      button_target: '_self',
      media_public_id: media.public_id,
      preview_media_public_id: media.public_id,
      theme_key: 'graphite',
      is_visible: 1,
      status: 'draft',
      sort_order: 9998,
    }, { actorId: adminId });
    createdItemIds.push(logoItem.id, carouselItem.id);

    await pool.query("UPDATE page_sections SET status = 'published', is_enabled = 0, content_json = NULL WHERE id = ?", [section.id]);
    await publishRoute('/admin/page/home/panel-2/logo-loop/items/publish');
    await publishRoute('/admin/page/home/panel-2/carousel/items/publish');

    const [[publishedSection]] = await pool.query('SELECT status, is_enabled FROM page_sections WHERE id = ?', [section.id]);
    assert.equal(publishedSection.status, 'published');
    assert.equal(Number(publishedSection.is_enabled), 1);

    let homepage = await request('GET', '/');
    assert.equal(homepage.status, 200);
    const escapedUrl = media.public_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok((homepage.text.match(new RegExp(escapedUrl, 'g')) || []).length >= 3);

    await stopServer();
    jar.cookie = '';
    await startServer();
    homepage = await request('GET', '/');
    assert.equal(homepage.status, 200);
    const servedAfterRestart = await request('GET', media.public_url);
    assert.equal(servedAfterRestart.status, 200);
    assert.match(String(servedAfterRestart.headers['content-type']), /^image\/webp/);
    await login();

    repeatable.registerPanelUsageSources();
    await assert.rejects(
      () => mediaService.archive(media.public_id, adminId),
      (error) => Array.isArray(error.usages) && error.usages.some((usage) => usage.source === 'logo_loop_items')
    );
    // Active media is now deletable without archiving first, but reference check still blocks
    await assert.rejects(
      () => mediaService.permanentDelete(media.public_id, adminId),
      (error) => error.usages && error.usages.some((usage) => usage.source === 'logo_loop_items')
    );

    const legacy = await reconciliation.inspectAsset({
      ...media,
      storage_path: media.storage_path.replace(/^media\//, ''),
      public_url: media.public_url,
    });
    assert.equal(legacy.classification, reconciliation.CLASSIFICATIONS.RECOVERABLE_LEGACY);
    assert.equal(legacy.requiresReupload, false);
    const missing = await reconciliation.inspectAsset({
      ...media,
      public_id: crypto.randomUUID(),
      storage_path: 'media/logos/missing-production-file.webp',
      public_url: '/uploads/media/logos/missing-production-file.webp',
      thumbnail_path: null,
      variants_json: null,
    });
    assert.equal(missing.classification, reconciliation.CLASSIFICATIONS.MISSING_ORIGINAL);
    assert.equal(missing.requiresReupload, true);

    await repeatable.archiveItem('logo_loop_items', logoItem.public_id, { actorId: adminId });
    await repeatable.archiveItem('home_carousel_items', carouselItem.public_id, { actorId: adminId });
    await publishRoute('/admin/page/home/panel-2/logo-loop/items/publish');
    await publishRoute('/admin/page/home/panel-2/carousel/items/publish');
    await mediaService.archive(media.public_id, adminId);
    await mediaService.permanentDelete(media.public_id, adminId);
    const [[deleted]] = await pool.query('SELECT COUNT(*) total FROM media_assets WHERE public_id = ?', [media.public_id]);
    assert.equal(Number(deleted.total), 0);
    for (const storedPath of storage.ownedPaths(media)) {
      assert.equal(fs.existsSync(storage.resolveStoragePath(storedPath)), false);
    }
    assert.equal((await request('GET', media.public_url)).status, 404);
  } finally {
    await cleanup();
    await pool.end();
  }
});
