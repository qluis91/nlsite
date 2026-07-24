const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const pool = require('../config/db');
const gallery = require('../services/galleryService');
const media = require('../services/galleryMediaService');
const { migrateGallery } = require('../scripts/migrate-gallery');

const marker = `gallery_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const markerSlug = marker.replace(/_/g, '-');
const adminEmail = `${marker}@example.invalid`;
const userEmail = `${marker}_user@example.invalid`;
const password = `Gallery-${crypto.randomBytes(8).toString('hex')}!`;
const port = 36000 + Math.floor(Math.random() * 500);
const fixture = { adminId: null, userId: null, categoryIds: [], itemIds: [] };
const adminJar = {};
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
          resolve({ status: res.statusCode, data, location: res.headers.location || '' });
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
  assert.ok(match, 'CSRF token should be rendered');
  return match[1];
}

function multipart(fields, files = []) {
  const boundary = `----gallery${crypto.randomBytes(12).toString('hex')}`;
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
  const page = await request('GET', '/admin/login', null, adminJar);
  const response = await request('POST', '/admin/login', {
    email: adminEmail,
    password,
    _csrf: csrf(page.data),
  }, adminJar);
  assert.equal(response.status, 302);
  assert.equal(response.location, '/admin');
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await request('GET', '/galeria')).status === 200) return;
    } catch {
      // Wait for MySQL-backed sessions and the isolated server.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Isolated gallery test server did not start');
}

async function cleanup() {
  const [items] = await pool.query('SELECT * FROM gallery_items WHERE title LIKE ?', [`${marker}%`]);
  for (const item of items) {
    await media.deleteGalleryPaths([item.media_path, item.thumbnail_path, item.poster_path]);
  }
  await pool.query('DELETE FROM gallery_items WHERE title LIKE ?', [`${marker}%`]);
  await pool.query('DELETE FROM gallery_categories WHERE name LIKE ?', [`${marker}%`]);
  await pool.query('DELETE FROM sessions WHERE data LIKE ?', [`%${marker}%`]);
  await pool.query('DELETE FROM users WHERE email IN (?, ?)', [adminEmail, userEmail]);
}

test.before(async () => {
  await migrateGallery();
  await migrateGallery();
  await cleanup();
  const hash = await bcrypt.hash(password, 8);
  const [admin] = await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,?,1)',
    [`Admin ${marker}`, adminEmail, hash, 1]
  );
  const [user] = await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,?,1)',
    [`User ${marker}`, userEmail, hash, 2]
  );
  fixture.adminId = admin.insertId;
  fixture.userId = user.insertId;
  serverProcess = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForServer();
  await loginAdmin();
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  await cleanup();
  await pool.end();
});

test('migration is idempotent, schema-synchronized, indexed, and non-destructive', async () => {
  const [[beforeUsers]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(id),0) sum_ids FROM users');
  const [[beforeOrders]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(id),0) sum_ids FROM orders');
  await migrateGallery();
  await migrateGallery();
  const [[afterUsers]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(id),0) sum_ids FROM users');
  const [[afterOrders]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(id),0) sum_ids FROM orders');
  assert.deepEqual(afterUsers, beforeUsers);
  assert.deepEqual(afterOrders, beforeOrders);
  const [tables] = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('gallery_categories','gallery_items')
      ORDER BY TABLE_NAME`
  );
  assert.deepEqual(tables.map((row) => row.TABLE_NAME), ['gallery_categories', 'gallery_items']);
  const [indexes] = await pool.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gallery_items'`
  );
  for (const name of ['uq_gallery_items_slug', 'idx_gallery_items_category', 'idx_gallery_items_type', 'idx_gallery_items_published_order']) {
    assert.ok(indexes.some((index) => index.INDEX_NAME === name), name);
  }
  const [foreignKeys] = await pool.query(
    `SELECT REFERENCED_TABLE_NAME, DELETE_RULE
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'gallery_items'`
  );
  assert.deepEqual(foreignKeys, [{ REFERENCED_TABLE_NAME: 'gallery_categories', DELETE_RULE: 'SET NULL' }]);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS gallery_categories/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS gallery_items/);
});

test('admin gallery routes require authentication and category mutations require CSRF', async () => {
  const anonymous = await request('GET', '/admin/galeria');
  assert.equal(anonymous.status, 302);
  assert.match(anonymous.location, /\/auth\/login/);
  const before = await gallery.listCategories();
  const missingCsrf = await request('POST', '/admin/galeria/categorias', {
    name: `${marker} missing`,
    sortOrder: '0',
    isActive: '1',
  }, adminJar);
  assert.equal(missingCsrf.status, 403);
  assert.equal((await gallery.listCategories()).length, before.length);
});

test('admin creates, edits, deactivates, and protects an in-use category', async () => {
  let page = await request('GET', '/admin/galeria/categorias', null, adminJar);
  const created = await request('POST', '/admin/galeria/categorias', {
    _csrf: csrf(page.data),
    name: marker,
    description: '<script>categoría</script>',
    sortOrder: '4',
    isActive: '1',
  }, adminJar);
  assert.equal(created.status, 302);
  const [rows] = await pool.query('SELECT * FROM gallery_categories WHERE slug = ?', [markerSlug]);
  assert.equal(rows.length, 1);
  fixture.categoryIds.push(rows[0].id);
  assert.equal(rows[0].description, '<script>categoría</script>');

  page = await request('GET', '/admin/galeria/categorias', null, adminJar);
  const duplicate = await request('POST', '/admin/galeria/categorias', {
    _csrf: csrf(page.data), name: marker, sortOrder: '0', isActive: '1',
  }, adminJar);
  assert.equal(duplicate.status, 302);
  assert.equal((await pool.query('SELECT COUNT(*) total FROM gallery_categories WHERE slug = ?', [markerSlug]))[0][0].total, 1);
});

test('admin image CRUD creates random optimized files and public gallery exposes only safe published data', async () => {
  const form = await request('GET', '/admin/galeria/nuevo', null, adminJar);
  const image = await sharp({ create: { width: 1000, height: 700, channels: 3, background: '#78d22a' } })
    .jpeg()
    .toBuffer();
  const title = `${marker} <script>alert(1)</script>`;
  const payload = multipart({
    _csrf: csrf(form.data),
    title,
    description: '<img src=x onerror=alert(1)>',
    categoryId: String(fixture.categoryIds[0]),
    mediaType: 'image',
    altText: 'Proyecto seguro <script>',
    sortOrder: '2',
    isFeatured: '1',
    isPublished: '1',
  }, [{ field: 'media', name: '../../original-name.jpg', type: 'image/jpeg', buffer: image }]);
  const response = await request('POST', '/admin/galeria', payload.body, adminJar, payload.headers);
  assert.equal(response.status, 302);
  assert.equal(response.location, '/admin/galeria');
  const [rows] = await pool.query('SELECT * FROM gallery_items WHERE title LIKE ?', [`${marker}%`]);
  assert.equal(rows.length, 1);
  const item = rows[0];
  fixture.itemIds.push(item.id);
  assert.match(item.media_path, /^\/uploads\/gallery\/images\/[a-f0-9-]+\.webp$/);
  assert.match(item.thumbnail_path, /^\/uploads\/gallery\/thumbnails\/[a-f0-9-]+\.webp$/);
  assert.doesNotMatch(item.media_path, /original-name/);
  assert.equal(fs.existsSync(media.resolveSafeGalleryPath(item.media_path, 'images')), true);
  assert.equal(fs.existsSync(media.resolveSafeGalleryPath(item.thumbnail_path, 'thumbnails')), true);

  const publicPage = await request('GET', `/galeria?categoria=${markerSlug}&tipo=image`);
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.data, new RegExp(marker));
  assert.match(publicPage.data, /aria-current="true"/);
  assert.match(publicPage.data, new RegExp(item.thumbnail_path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(publicPage.data, /<script>alert\(1\)<\/script>/);
  assert.match(publicPage.data, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(publicPage.data, /type="application\/json"/);
  assert.doesNotMatch(publicPage.data, /public\\uploads|C:\\/);
});

test('admin accepts signed local video with a required processed poster and rejects a missing poster', async () => {
  const form = await request('GET', '/admin/galeria/nuevo', null, adminJar);
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('isom0000')]);
  const poster = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#151515' } })
    .png()
    .toBuffer();
  const videoTitle = `${marker} video`;
  const payload = multipart({
    _csrf: csrf(form.data),
    title: videoTitle,
    description: 'Proceso en video',
    categoryId: String(fixture.categoryIds[0]),
    mediaType: 'video',
    altText: 'Póster del proceso en video',
    sortOrder: '5',
    isPublished: '1',
  }, [
    { field: 'media', name: 'process.mp4', type: 'video/mp4', buffer: mp4 },
    { field: 'poster', name: 'poster.png', type: 'image/png', buffer: poster },
  ]);
  const response = await request('POST', '/admin/galeria', payload.body, adminJar, payload.headers);
  assert.equal(response.status, 302);
  assert.equal(response.location, '/admin/galeria');
  const [rows] = await pool.query('SELECT * FROM gallery_items WHERE title = ?', [videoTitle]);
  assert.equal(rows.length, 1);
  const item = rows[0];
  fixture.itemIds.push(item.id);
  assert.match(item.media_path, /^\/uploads\/gallery\/videos\/[a-f0-9-]+\.mp4$/);
  assert.match(item.poster_path, /^\/uploads\/gallery\/posters\/[a-f0-9-]+\.webp$/);
  assert.match(item.thumbnail_path, /^\/uploads\/gallery\/thumbnails\/[a-f0-9-]+\.webp$/);
  assert.equal(await media.galleryPathExists(item.poster_path, 'posters'), true);

  const publicVideo = await request('GET', '/galeria?tipo=video');
  assert.match(publicVideo.data, /Ver video/);
  assert.match(publicVideo.data, new RegExp(item.poster_path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(publicVideo.data, /<video[^>]*autoplay/);

  const missingPosterForm = await request('GET', '/admin/galeria/nuevo', null, adminJar);
  const missingPoster = multipart({
    _csrf: csrf(missingPosterForm.data),
    title: `${marker} no poster`,
    mediaType: 'video',
    altText: 'Video sin póster',
    sortOrder: '0',
  }, [{ field: 'media', name: 'missing.mp4', type: 'video/mp4', buffer: mp4 }]);
  const rejected = await request('POST', '/admin/galeria', missingPoster.body, adminJar, missingPoster.headers);
  assert.equal(rejected.status, 302);
  assert.equal(rejected.location, '/admin/galeria/nuevo');
  assert.equal((await pool.query('SELECT COUNT(*) total FROM gallery_items WHERE title = ?', [`${marker} no poster`]))[0][0].total, 0);
});

test('edit without replacement preserves media, filters are canonical, and inactive categories hide items', async () => {
  const item = await gallery.getItemById(fixture.itemIds[0]);
  const edit = await request('GET', `/admin/galeria/${item.id}/editar`, null, adminJar);
  const payload = multipart({
    _csrf: csrf(edit.data),
    title: item.title,
    description: 'Descripción actualizada',
    categoryId: String(item.category_id),
    mediaType: 'image',
    altText: item.alt_text,
    sortOrder: '3',
    isPublished: '1',
  });
  const updated = await request('POST', `/admin/galeria/${item.id}`, payload.body, adminJar, payload.headers);
  assert.equal(updated.status, 302);
  const after = await gallery.getItemById(item.id);
  assert.equal(after.media_path, item.media_path);
  assert.equal(after.thumbnail_path, item.thumbnail_path);
  assert.equal(after.description, 'Descripción actualizada');
  assert.equal((await request('GET', '/galeria?tipo=html')).status, 200);
  assert.match((await request('GET', '/galeria?categoria=../../admin')).data, /Mostramos toda la galería/);

  await gallery.updateCategory(item.category_id, {
    name: marker, slug: markerSlug, description: null, sortOrder: 4, isActive: false,
  });
  const hidden = await request('GET', `/galeria?categoria=${markerSlug}`);
  assert.equal(hidden.status, 200);
  assert.doesNotMatch(hidden.data, new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await assert.rejects(gallery.deleteCategory(item.category_id), /elementos asociados/);
  await gallery.updateCategory(item.category_id, {
    name: marker, slug: markerSlug, description: null, sortOrder: 4, isActive: true,
  });
});

test('shared lightbox is singular, accessible, non-autoplaying, and uses safe DOM APIs', async () => {
  const page = await request('GET', '/galeria');
  assert.equal((page.data.match(/data-gallery-modal/g) || []).length, 1);
  assert.match(page.data, /role="dialog"/);
  assert.match(page.data, /aria-modal="true"/);
  assert.match(page.data, /data-gallery-previous/);
  assert.match(page.data, /data-gallery-next/);
  assert.match(page.data, /<video[\s\S]*controls[\s\S]*preload="metadata"[\s\S]*playsinline/);
  assert.doesNotMatch(page.data, /<video[^>]*autoplay/);
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'gallery.js'), 'utf8');
  assert.match(script, /video\.pause\(\)/);
  assert.match(script, /previousFocus/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /event\.key === 'ArrowLeft'/);
  assert.match(script, /event\.key === 'ArrowRight'/);
  assert.match(script, /event\.key === 'Tab'/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
});

test('public gallery recognizes safe visualization URLs and preserves circular mode in filters', async () => {
  for (const requestPath of [
    '/galeria',
    '/galeria?view=grid',
    '/galeria?view=circular',
    '/galeria?view=ring',
    '/galeria?view=infinite',
    '/galeria?view=invalid',
    `/galeria?categoria=${markerSlug}&view=circular`,
    `/galeria?categoria=${markerSlug}&view=ring`,
    `/galeria?categoria=${markerSlug}&view=infinite`,
    '/galeria?tipo=video&view=circular',
    '/galeria?tipo=video&view=ring',
    '/galeria?tipo=video&view=infinite',
    '/galeria?view=%3Cscript%3E',
    '/galeria?view=..%2F..%2Fadmin',
  ]) {
    const response = await request('GET', requestPath);
    assert.equal(response.status, 200, requestPath);
    assert.doesNotMatch(response.data, /<script>[^<]*view=/);
  }
  const circular = await request('GET', `/galeria?categoria=${markerSlug}&tipo=image&view=circular`);
  assert.match(circular.data, /data-requested-view="circular"/);
  assert.match(circular.data, new RegExp(`categoria=${markerSlug}(?:&amp;|&)tipo=image(?:&amp;|&)view=circular`));
  assert.match(circular.data, /data-gallery-view="grid"/);
  assert.match(circular.data, /data-gallery-view="circular"/);
  assert.match(circular.data, /data-gallery-view="ring"/);
  assert.match(circular.data, /data-gallery-view="infinite"/);
  const ring = await request('GET', `/galeria?categoria=${markerSlug}&tipo=image&view=ring`);
  assert.match(ring.data, /data-requested-view="ring"/);
  assert.match(ring.data, new RegExp(`categoria=${markerSlug}(?:&amp;|&)tipo=image(?:&amp;|&)view=ring`));
  assert.match(ring.data, /data-gallery-ring/);
  const infinite = await request('GET', `/galeria?categoria=${markerSlug}&tipo=image&view=infinite`);
  assert.match(infinite.data, /data-requested-view="infinite"/);
  assert.match(infinite.data, new RegExp(`categoria=${markerSlug}(?:&amp;|&)tipo=image(?:&amp;|&)view=infinite`));
  assert.match(infinite.data, /data-gallery-infinite/);
  const invalid = await request('GET', '/galeria?view=javascript%3Aalert(1)');
  assert.match(invalid.data, /data-requested-view="grid"/);
});

test('unpublishing and deletion hide public data and remove only controlled files', async () => {
  const item = await gallery.getItemById(fixture.itemIds[0]);
  let page = await request('GET', '/admin/galeria', null, adminJar);
  const unpublished = await request('POST', `/admin/galeria/${item.id}/publicar`, {
    _csrf: csrf(page.data),
  }, adminJar);
  assert.equal(unpublished.status, 302);
  assert.doesNotMatch(
    (await request('GET', '/galeria')).data,
    new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
  for (const itemId of [...fixture.itemIds]) {
    const current = await gallery.getItemById(itemId);
    page = await request('GET', '/admin/galeria', null, adminJar);
    const deleted = await request('POST', `/admin/galeria/${itemId}/eliminar`, {
      _csrf: csrf(page.data),
    }, adminJar);
    assert.equal(deleted.status, 302);
    assert.equal(await gallery.getItemById(itemId), null);
    for (const publicPath of [current.media_path, current.thumbnail_path, current.poster_path].filter(Boolean)) {
      assert.equal(await media.galleryPathExists(publicPath), false);
    }
  }
  fixture.itemIds = [];
  await gallery.deleteCategory(item.category_id);
  fixture.categoryIds = fixture.categoryIds.filter((id) => id !== item.category_id);
});
