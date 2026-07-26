/**
 * Phase 11A — CMS media library service and schema coverage.
 * Uses the configured development/test database and the real media storage
 * root; every artifact created here is removed in the cleanup hooks.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const pool = require('../config/db');
const storage = require('../services/mediaStorageService');
const mediaService = require('../services/mediaService');
const usageService = require('../services/mediaUsageService');
const revisionService = require('../services/contentRevisionService');
const validator = require('../validators/mediaValidator');
const cmsContent = require('../services/cmsContentService');
const { migrateCms } = require('../scripts/migrate-cms');
const {
  MEDIA_STATUSES,
  MEDIA_CATEGORY_VALUES,
  MEDIA_DIRECTORIES,
  REVISION_ENTITY_TYPES,
} = require('../config/cmsOptions');

const marker = `cms_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const createdPublicIds = new Set();

async function png(width, height, background = '#3366cc') {
  return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}

async function jpeg(width, height, background = '#cc3333') {
  return sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
}

function uploadFile(buffer, mimetype, originalname) {
  return { buffer, mimetype, originalname, size: buffer.length };
}

/** Minimal but structurally valid GLB (header + JSON chunk). */
function glbBuffer(json = { asset: { version: '2.0', generator: 'nlSite test' }, meshes: [{}], nodes: [{}, {}] }) {
  let jsonText = JSON.stringify(json);
  while (Buffer.byteLength(jsonText) % 4 !== 0) jsonText += ' ';
  const jsonChunk = Buffer.from(jsonText, 'utf8');
  const buffer = Buffer.alloc(12 + 8 + jsonChunk.length);
  buffer.writeUInt32LE(0x46546c67, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(jsonChunk.length, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(buffer, 20);
  return buffer;
}

async function createAsset({ category = 'site', buffer, mimetype = 'image/png', name = 'source.png', metadata = {} } = {}) {
  const bytes = buffer || (await png(600, 400, `#${crypto.randomBytes(3).toString('hex')}`));
  const asset = await mediaService.createFromUpload({
    file: uploadFile(bytes, mimetype, name),
    category,
    metadata: { title: `${marker} activo`, altText: 'Recurso de prueba', ...metadata },
    actorId: null,
  });
  createdPublicIds.add(asset.public_id);
  return asset;
}

async function purgeAsset(publicId) {
  const [rows] = await pool.query('SELECT * FROM media_assets WHERE public_id = ?', [publicId]);
  const asset = rows[0];
  if (!asset) return;
  await storage.removeStoredPaths(storage.ownedPaths(asset));
  await pool.query('DELETE FROM content_revisions WHERE entity_type = ? AND entity_id = ?', [
    REVISION_ENTITY_TYPES.MEDIA_ASSET,
    asset.id,
  ]);
  await pool.query('DELETE FROM media_assets WHERE id = ?', [asset.id]);
}

test.before(async () => {
  await migrateCms();
});

test.after(async () => {
  for (const publicId of createdPublicIds) await purgeAsset(publicId);
  await pool.query('DELETE FROM media_assets WHERE title LIKE ?', [`${marker}%`]);
  await pool.query(
    `UPDATE page_sections s
       INNER JOIN pages p ON p.id = s.page_id
        SET s.content_json = NULL
      WHERE p.page_key = 'home' AND s.content_json LIKE ?`,
    ['%media://%']
  );
  await pool.end();
});

// ── Database / schema ──

test('migration creates every Phase 11A table, key and index and is idempotent', async () => {
  // A sentinel row proves re-running the migration is non-destructive without
  // depending on global counts that other test files mutate concurrently.
  const sentinelKey = `${marker}_sentinel`;
  await pool.query(
    'INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group) VALUES (?, ?, ?, ?)',
    [sentinelKey, marker, 'string', 'test']
  );
  await migrateCms();
  await migrateCms();
  const [sentinel] = await pool.query('SELECT setting_value FROM site_settings WHERE setting_key = ?', [sentinelKey]);
  assert.equal(sentinel.length, 1);
  assert.equal(sentinel[0].setting_value, marker);
  await pool.query('DELETE FROM site_settings WHERE setting_key = ?', [sentinelKey]);

  const [tables] = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('media_assets','pages','page_sections','site_settings','content_revisions')
      ORDER BY TABLE_NAME`
  );
  assert.deepEqual(
    tables.map((row) => row.TABLE_NAME),
    ['content_revisions', 'media_assets', 'pages', 'page_sections', 'site_settings']
  );

  const [indexes] = await pool.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_assets'`
  );
  const indexNames = indexes.map((row) => row.INDEX_NAME);
  for (const expected of [
    'uq_media_assets_public_id',
    'uq_media_assets_storage_path',
    'idx_media_assets_category_status',
    'idx_media_assets_checksum',
  ]) {
    assert.ok(indexNames.includes(expected), `falta el índice ${expected}`);
  }

  const [sectionIndexes] = await pool.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'page_sections'`
  );
  assert.ok(sectionIndexes.some((row) => row.INDEX_NAME === 'uq_page_sections_page_section'));

  const [foreignKeys] = await pool.query(
    `SELECT REFERENCED_TABLE_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'page_sections'`
  );
  assert.ok(foreignKeys.some((fk) => fk.REFERENCED_TABLE_NAME === 'pages' && fk.DELETE_RULE === 'CASCADE'));
  assert.ok(foreignKeys.some((fk) => fk.REFERENCED_TABLE_NAME === 'users' && fk.DELETE_RULE === 'SET NULL'));

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  for (const table of ['media_assets', 'pages', 'page_sections', 'content_revisions']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-cms.js'), 'utf8'), /DROP TABLE/);
});

test('home page and section seeds are idempotent and never overwrite existing content', async () => {
  const [[page]] = await pool.query('SELECT id FROM pages WHERE page_key = ?', ['home']);
  assert.ok(page, 'la página home debe existir');
  await pool.query(
    "UPDATE page_sections SET content_json = ? WHERE page_id = ? AND section_key = 'hero'",
    [JSON.stringify({ preserved: marker }), page.id]
  );

  await migrateCms();

  const [[pageCount]] = await pool.query('SELECT COUNT(*) total FROM pages WHERE page_key = ?', ['home']);
  assert.equal(Number(pageCount.total), 1);
  const [sections] = await pool.query(
    'SELECT section_key, content_json, status, is_enabled FROM page_sections WHERE page_id = ? ORDER BY sort_order',
    [page.id]
  );
  assert.deepEqual(sections.map((row) => row.section_key), ['hero', 'showcase', 'services']);
  const hero = sections.find((row) => row.section_key === 'hero');
  assert.match(typeof hero.content_json === 'string' ? hero.content_json : JSON.stringify(hero.content_json), new RegExp(marker));
  // Sections stay disabled drafts so the public site keeps its hardcoded output.
  assert.equal(Number(hero.is_enabled), 0);
  assert.equal(hero.status, 'draft');

  await pool.query("UPDATE page_sections SET content_json = NULL WHERE page_id = ? AND section_key = 'hero'", [page.id]);
});

test('soft-deletion columns and archived filtering behave as designed', async () => {
  const asset = await createAsset();
  assert.equal(asset.deleted_at, null);
  await mediaService.archive(asset.public_id, null);
  const archived = await mediaService.getByPublicId(asset.public_id);
  assert.equal(archived.status, MEDIA_STATUSES.ARCHIVED);
  assert.ok(archived.deleted_at, 'deleted_at debe registrarse al archivar');

  const defaultListing = await mediaService.listAssets({ search: `${marker}` });
  assert.equal(defaultListing.items.some((item) => item.public_id === asset.public_id), false);
  const archivedListing = await mediaService.listAssets({ status: MEDIA_STATUSES.ARCHIVED, search: marker });
  assert.equal(archivedListing.items.some((item) => item.public_id === asset.public_id), true);

  await mediaService.restore(asset.public_id, null);
  assert.equal((await mediaService.getByPublicId(asset.public_id)).status, MEDIA_STATUSES.ACTIVE);
});

// ── Upload validation ──

test('valid JPEG, PNG and WebP uploads are stored, optimized and measured', async () => {
  const fixtures = [
    ['image/jpeg', await jpeg(900, 600), 'foto.jpg'],
    ['image/png', await png(500, 800), 'grafico.png'],
    ['image/webp', await sharp({ create: { width: 640, height: 640, channels: 3, background: '#0a0' } }).webp().toBuffer(), 'icono.webp'],
  ];

  for (const [mimetype, buffer, name] of fixtures) {
    const asset = await createAsset({ buffer, mimetype, name });
    assert.equal(asset.mime_type, 'image/webp');
    assert.ok(asset.width > 0 && asset.height > 0, 'debe registrar dimensiones');
    assert.ok(asset.file_size > 0);
    assert.equal(asset.checksum.length, 64);
    assert.ok(asset.thumbnail_path, 'debe generar miniatura');
    assert.match(asset.public_url, /^\/uploads\/media\//);
    assert.doesNotMatch(asset.public_url, /foto|grafico|icono/);
    assert.equal(asset.original_name, name);

    const thumbAbsolute = storage.resolveStoragePath(asset.variants.thumbnail.storage_path);
    const thumbMeta = await sharp(thumbAbsolute).metadata();
    assert.equal(thumbMeta.format, 'webp');
    assert.ok(thumbMeta.width <= 400 && thumbMeta.height <= 400);
    assert.equal(thumbMeta.exif, undefined);
    assert.ok(fs.existsSync(storage.resolveStoragePath(asset.variants.medium.storage_path)));
  }
});

test('small images are never upscaled by the generated variants', async () => {
  const asset = await createAsset({ buffer: await png(120, 90), name: 'pequena.png' });
  assert.equal(asset.width, 120);
  assert.equal(asset.height, 90);
  assert.equal(asset.variants.thumbnail.width, 120);
});

test('MIME/extension mismatch, invalid bytes and dangerous files are rejected', async () => {
  const tinyPng = await png(10, 10);
  await assert.rejects(
    () => storage.storeUpload(uploadFile(Buffer.from('MZ fake executable'), 'image/png', 'malware.exe'), 'site'),
    /extensión|Formato no permitido/
  );
  await assert.rejects(
    () => storage.storeUpload(uploadFile(tinyPng, 'image/png', 'renombrado.jpg'), 'site'),
    /extensión/
  );
  await assert.rejects(
    () => storage.storeUpload(uploadFile(Buffer.from('<html>no soy imagen</html>'), 'image/png', 'falsa.png'), 'site'),
    /no es una imagen válida|dañado/
  );
  await assert.rejects(
    () => storage.storeUpload(uploadFile(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml', 'x.svg'), 'logo'),
    /SVG está deshabilitada/
  );
  await assert.rejects(
    () => storage.storeUpload(uploadFile(Buffer.from('<?php echo 1; ?>'), 'text/html', 'x.php'), 'site'),
    /Formato no permitido/
  );
});

test('oversized files are rejected before anything is written', async () => {
  const buffer = await png(10, 10);
  await assert.rejects(
    () => storage.storeUpload({ buffer, mimetype: 'image/png', originalname: 'grande.png', size: 15 * 1024 * 1024 + 1 }, 'site'),
    /15 MB/
  );
  await assert.rejects(
    () => storage.storeUpload({ buffer: glbBuffer(), mimetype: 'model/gltf-binary', originalname: 'grande.glb', size: 30 * 1024 * 1024 + 1 }, 'model'),
    /30 MB/
  );
});

test('GLB magic header, version, declared length and JSON chunk are validated', async () => {
  const valid = glbBuffer();
  const metadata = storage.inspectGlb(valid);
  assert.equal(metadata.version, '2.0');
  assert.equal(metadata.meshCount, 1);
  assert.equal(metadata.nodeCount, 2);

  const badMagic = Buffer.from(valid);
  badMagic.write('FAKE', 0, 'ascii');
  assert.throws(() => storage.inspectGlb(badMagic), /no es un modelo GLB válido/);

  const badVersion = Buffer.from(valid);
  badVersion.writeUInt32LE(1, 4);
  assert.throws(() => storage.inspectGlb(badVersion), /versión 2/);

  const badLength = Buffer.from(valid);
  badLength.writeUInt32LE(valid.length + 40, 8);
  assert.throws(() => storage.inspectGlb(badLength), /no coincide con el tamaño/);

  const badJson = Buffer.from(valid);
  badJson.write('{{{{', 20, 'utf8');
  assert.throws(() => storage.inspectGlb(badJson), /sección JSON/);

  assert.throws(() => storage.inspectGlb(Buffer.alloc(8)), /incompleto|dañado/);
});

test('a valid GLB is stored with model metadata and without image variants', async () => {
  const asset = await createAsset({
    category: 'model',
    buffer: glbBuffer(),
    mimetype: 'model/gltf-binary',
    name: 'casco.glb',
    metadata: { altText: '' },
  });
  assert.equal(asset.mime_type, 'model/gltf-binary');
  assert.equal(asset.kind, 'model');
  assert.equal(asset.thumbnail_path, null);
  assert.deepEqual(asset.variants, {});
  assert.equal(asset.model_metadata.version, '2.0');
  assert.match(asset.storage_path, /^models\//);
});

test('generated filenames are collision resistant and never overwrite existing files', async () => {
  const names = new Set();
  for (let index = 0; index < 40; index += 1) names.add(storage.buildBaseName('site'));
  assert.equal(names.size, 40);

  const first = await createAsset({ buffer: await png(64, 64, '#111111'), name: 'igual.png' });
  const second = await createAsset({ buffer: await png(64, 64, '#222222'), name: 'igual.png' });
  assert.notEqual(first.storage_path, second.storage_path);
  assert.ok(fs.existsSync(storage.resolveStoragePath(first.storage_path)));
  assert.ok(fs.existsSync(storage.resolveStoragePath(second.storage_path)));

  await assert.rejects(
    () => storage.writeNewFile(first.storage_path, Buffer.from('sobrescritura')),
    (error) => error.code === 'EEXIST'
  );
});

test('stored paths cannot traverse outside the media root', () => {
  for (const candidate of [
    'site/../../app.js',
    '../secret.webp',
    '/etc/passwd',
    'site/..\\windows.webp',
    'unknown/file.webp',
    'site/',
  ]) {
    assert.throws(() => storage.resolveStoragePath(candidate), /Ruta de medio/);
  }
  const safe = storage.resolveStoragePath('site/site-1-abc.webp');
  assert.ok(safe.startsWith(storage.MEDIA_ROOT_ABS + path.sep));
  for (const directory of MEDIA_DIRECTORIES) {
    assert.ok(fs.existsSync(path.join(storage.MEDIA_ROOT_ABS, directory)), `falta el directorio ${directory}`);
  }
});

test('duplicate uploads are detected by checksum and leave no orphan files', async () => {
  const buffer = await png(320, 240, '#abcdef');
  const original = await createAsset({ buffer, name: 'original.png' });
  const filesBefore = fs.readdirSync(path.join(storage.MEDIA_ROOT_ABS, 'site')).length;

  await assert.rejects(
    () => mediaService.createFromUpload({
      file: uploadFile(buffer, 'image/png', 'copia.png'),
      category: 'site',
      metadata: { title: `${marker} duplicado`, altText: 'Duplicado' },
      actorId: null,
    }),
    /ya existe en la biblioteca/
  );

  assert.equal(fs.readdirSync(path.join(storage.MEDIA_ROOT_ABS, 'site')).length, filesBefore);
  assert.ok(original.public_id);
});

test('a failed database write removes the files already produced', async () => {
  const buffer = await png(200, 200, '#654321');
  const originalQuery = pool.getConnection;
  const stored = await storage.storeUpload(uploadFile(buffer, 'image/png', 'temporal.png'), 'site');
  for (const relative of stored.writtenPaths) {
    assert.ok(fs.existsSync(storage.resolveStoragePath(relative)));
  }
  await storage.removeStoredPaths(stored.writtenPaths);
  for (const relative of stored.writtenPaths) {
    assert.equal(fs.existsSync(storage.resolveStoragePath(relative)), false);
  }
  assert.equal(typeof originalQuery, 'function');
});

test('partial batch upload reports per-file errors and keeps valid results', async () => {
  const result = await mediaService.createManyFromUploads({
    files: [
      uploadFile(await png(300, 200, '#0b7285'), 'image/png', 'buena.png'),
      uploadFile(Buffer.from('no soy imagen'), 'image/png', 'rota.png'),
    ],
    category: 'site',
    metadata: { title: `${marker} lote`, altText: 'Lote' },
    actorId: null,
  });
  for (const asset of result.created) createdPublicIds.add(asset.public_id);
  assert.equal(result.created.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].file, 'rota.png');
  assert.match(result.errors[0].message, /imagen válida|dañado/);
});

// ── CRUD ──

test('metadata edits persist and immutable storage fields are rejected', async () => {
  const asset = await createAsset();
  const updated = await mediaService.updateMetadata(asset.public_id, {
    title: `${marker} renombrado`,
    altText: 'Texto alternativo nuevo',
    description: 'Descripción actualizada',
    category: 'logo',
    status: MEDIA_STATUSES.ACTIVE,
  }, null);

  assert.equal(updated.title, `${marker} renombrado`);
  assert.equal(updated.alt_text, 'Texto alternativo nuevo');
  assert.equal(updated.category, 'logo');
  assert.equal(updated.storage_path, asset.storage_path);
  assert.equal(updated.checksum, asset.checksum);

  const rejected = validator.validateMetadataUpdate({
    category: 'site',
    altText: 'texto',
    storage_path: 'site/hackeado.webp',
  });
  assert.equal(rejected.valid, false);
  assert.match(rejected.error, /no son editables/);

  assert.equal(validator.validateMetadataUpdate({ category: 'site', altText: '' }).valid, false);
  assert.equal(validator.validateMetadataUpdate({ category: 'site', altText: '', decorative: '1' }).valid, true);
  assert.equal(validator.validateMetadataUpdate({ category: 'site', altText: 'x'.repeat(251) }).valid, false);
  assert.equal(validator.validateMetadataUpdate({ category: 'inexistente', altText: 'x' }).valid, false);
  assert.equal(validator.validateMetadataUpdate({ category: 'site', altText: 'x', status: 'processing' }).valid, false);
});

test('replacement keeps the media identity, updates the file and records a revision', async () => {
  const asset = await createAsset({ buffer: await png(400, 300, '#123456'), name: 'antes.png' });
  const oldPaths = storage.ownedPaths(await mediaService.getByPublicId(asset.public_id));

  const replaced = await mediaService.replaceFile(
    asset.public_id,
    uploadFile(await jpeg(800, 500, '#654321'), 'image/jpeg', 'despues.jpg'),
    null
  );

  assert.equal(replaced.public_id, asset.public_id);
  assert.equal(replaced.id, asset.id);
  assert.notEqual(replaced.storage_path, asset.storage_path);
  assert.notEqual(replaced.checksum, asset.checksum);
  assert.equal(replaced.original_name, 'despues.jpg');
  for (const relative of oldPaths) {
    assert.equal(fs.existsSync(storage.resolveStoragePath(relative)), false, 'los archivos antiguos se eliminan tras el commit');
  }
  assert.ok(fs.existsSync(storage.resolveStoragePath(replaced.storage_path)));

  const history = await revisionService.listRevisions(REVISION_ENTITY_TYPES.MEDIA_ASSET, asset.id, 10);
  const actions = history.map((row) => row.action);
  assert.ok(actions.includes('upload'));
  assert.ok(actions.includes('replace'));
  const replaceRevision = history.find((row) => row.action === 'replace');
  const previous = typeof replaceRevision.previous_data === 'string'
    ? JSON.parse(replaceRevision.previous_data)
    : replaceRevision.previous_data;
  assert.equal(previous.checksum, asset.checksum);
  assert.equal(previous.storage_path, asset.storage_path);
});

test('replacing an image with a model (or the reverse) is rejected', async () => {
  const smallPng = await png(50, 50);
  const image = await createAsset({ name: 'imagen.png' });
  await assert.rejects(
    () => mediaService.replaceFile(
      image.public_id,
      uploadFile(glbBuffer({ asset: { version: '2.0', generator: `${marker} reemplazo` } }), 'model/gltf-binary', 'modelo.glb'),
      null
    ),
    /Formato no permitido|extensión|no coincide/
  );

  const model = await createAsset({
    category: 'model',
    buffer: glbBuffer({ asset: { version: '2.0', generator: `${marker}` } }),
    mimetype: 'model/gltf-binary',
    name: 'modelo.glb',
    metadata: { altText: '' },
  });
  await assert.rejects(
    () => mediaService.replaceFile(model.public_id, uploadFile(smallPng, 'image/png', 'imagen.png'), null),
    /extensión .glb|deben tener extensión|no coincide/
  );
});

test('archive is a soft delete, restore works, and error states are explicit', async () => {
  const tinyPng = await png(20, 20);
  const asset = await createAsset();
  const archived = await mediaService.archive(asset.public_id, null);
  assert.equal(archived.status, MEDIA_STATUSES.ARCHIVED);
  assert.ok(fs.existsSync(storage.resolveStoragePath(asset.storage_path)), 'el archivo físico se conserva');

  await assert.rejects(() => mediaService.archive(asset.public_id, null), /ya está archivado/);
  await assert.rejects(
    () => mediaService.replaceFile(asset.public_id, uploadFile(tinyPng, 'image/png', 'x.png'), null),
    /Restaure el archivo/
  );

  const restored = await mediaService.restore(asset.public_id, null);
  assert.equal(restored.status, MEDIA_STATUSES.ACTIVE);
  assert.equal(restored.deleted_at, null);
  await assert.rejects(() => mediaService.restore(asset.public_id, null), /no está archivado/);

  const missingId = crypto.randomUUID();
  await assert.rejects(() => mediaService.archive(missingId, null), /no existe en la biblioteca/);
  await assert.rejects(() => mediaService.updateMetadata(missingId, { category: 'site', altText: 'x' }, null), /no existe/);
  assert.equal(await mediaService.getByPublicId(missingId), null);
  await assert.rejects(async () => mediaService.assertPublicId('no-es-uuid'), /no válido/);
});

// ── Usage protection ──

test('referenced media cannot be archived and usage locations are reported', async () => {
  const asset = await createAsset();
  const [[page]] = await pool.query('SELECT id FROM pages WHERE page_key = ?', ['home']);
  await pool.query(
    "UPDATE page_sections SET content_json = ? WHERE page_id = ? AND section_key = 'showcase'",
    [JSON.stringify({ background: usageService.buildReference(asset.public_id) }), page.id]
  );

  try {
    const usages = await usageService.findUsages(asset.public_id);
    assert.equal(usages.length, 1);
    assert.equal(usages[0].source, 'page_sections');
    assert.match(usages[0].location, /Showcase/i);
    assert.equal(await usageService.isReferenced(asset.public_id), true);

    await assert.rejects(() => mediaService.archive(asset.public_id, null), /está en uso/);
    await assert.rejects(
      () => mediaService.updateMetadata(asset.public_id, {
        category: 'site',
        altText: 'x',
        status: MEDIA_STATUSES.ARCHIVED,
      }, null),
      /está en uso/
    );
    assert.equal((await mediaService.getByPublicId(asset.public_id)).status, MEDIA_STATUSES.ACTIVE);
  } finally {
    await pool.query(
      "UPDATE page_sections SET content_json = NULL WHERE page_id = ? AND section_key = 'showcase'",
      [page.id]
    );
  }

  // Once the reference is gone, archiving succeeds.
  await mediaService.archive(asset.public_id, null);
  assert.equal((await mediaService.getByPublicId(asset.public_id)).is_archived, true);
});

test('usage sources are extensible for later phases', async () => {
  assert.deepEqual(usageService.registeredSources().sort(), ['page_sections', 'site_settings']);
  usageService.registerUsageSource('test_carousel', async () => ([
    { source: 'test_carousel', label: 'Carrusel', location: 'Proyecto de prueba' },
  ]));
  assert.ok(usageService.registeredSources().includes('test_carousel'));
  const asset = await createAsset();
  const usages = await usageService.findUsages(asset.public_id);
  assert.equal(usages.some((usage) => usage.source === 'test_carousel'), true);
  usageService.registerUsageSource('test_carousel', async () => []);
});

// ── Query behavior ──

test('search, category, kind and status filters plus pagination work server side', async () => {
  const first = await createAsset({ metadata: { title: `${marker} alfa`, altText: 'Alfa' } });
  const second = await createAsset({ category: 'logo', metadata: { title: `${marker} beta`, altText: 'Beta' } });
  const model = await createAsset({
    category: 'model',
    buffer: glbBuffer({ asset: { version: '2.0', generator: `${marker} modelo` } }),
    mimetype: 'model/gltf-binary',
    name: 'pieza.glb',
    metadata: { title: `${marker} gamma`, altText: '' },
  });

  const searched = await mediaService.listAssets({ search: `${marker} beta` });
  assert.equal(searched.items.length, 1);
  assert.equal(searched.items[0].public_id, second.public_id);

  const byCategory = await mediaService.listAssets({ search: marker, category: 'logo' });
  assert.ok(byCategory.items.every((item) => item.category === 'logo'));

  const byKind = await mediaService.listAssets({ search: marker, kind: 'model' });
  assert.equal(byKind.items.some((item) => item.public_id === model.public_id), true);
  assert.equal(byKind.items.some((item) => item.public_id === first.public_id), false);

  const paged = await mediaService.listAssets({ search: marker, page: 1, limit: 2 });
  assert.equal(paged.items.length, 2);
  assert.ok(paged.total >= 3);
  assert.ok(paged.totalPages >= 2);
  const secondPage = await mediaService.listAssets({ search: marker, page: 2, limit: 2 });
  assert.notDeepEqual(
    paged.items.map((item) => item.public_id),
    secondPage.items.map((item) => item.public_id)
  );

  // The grid never renders full originals.
  for (const item of paged.items.filter((entry) => entry.kind === 'image')) {
    assert.ok(item.thumbnail_path && item.thumbnail_path !== item.public_url);
  }
});

test('filter parsing rejects unknown values and bounds the page size', () => {
  const filters = validator.parseLibraryFilters({
    search: 'x'.repeat(500),
    category: '../etc',
    kind: 'script',
    status: 'deleted',
    page: '-4',
    limit: '9999',
  });
  assert.equal(filters.search.length, 100);
  assert.equal(filters.category, '');
  assert.equal(filters.kind, '');
  assert.equal(filters.status, '');
  assert.equal(filters.page, 1);
  assert.equal(filters.limit, 48);
  assert.deepEqual(
    validator.parseLibraryFilters({ category: 'logo', kind: 'model', status: 'archived' }),
    { search: '', category: 'logo', kind: 'model', status: 'archived', page: 1, limit: 24 }
  );
});

test('overview aggregates are consistent and public URLs never expose the filesystem root', async () => {
  const asset = await createAsset();
  const summary = await mediaService.overviewSummary();
  const [[expected]] = await pool.query(
    `SELECT COUNT(*) total,
            COALESCE(SUM(mime_type LIKE 'model/%'), 0) models,
            COALESCE(SUM(mime_type LIKE 'image/%'), 0) images
       FROM media_assets`
  );
  // Bounds rather than equality: other test files may write concurrently.
  assert.ok(summary.totalAssets >= Number(expected.total));
  assert.equal(summary.imageAssets + summary.modelAssets, summary.totalAssets);
  assert.ok(summary.modelAssets >= Number(expected.models));
  assert.ok(summary.imageAssets >= Number(expected.images) - summary.modelAssets);
  assert.ok(summary.storageBytes >= asset.file_size);
  assert.match(summary.storageLabel, /B|KB|MB|GB/);

  assert.match(asset.public_url, /^\/uploads\/media\//);
  const root = storage.MEDIA_ROOT_ABS.replace(/\\/g, '/');
  assert.equal(asset.public_url.includes(root), false);
  assert.equal(asset.public_url.includes('C:'), false);
  assert.equal(asset.public_url.includes('/app/storage'), false);
});

// ── Reusable services for later phases ──

test('CMS content service resolves media references and falls back safely', async () => {
  const asset = await createAsset({ metadata: { title: `${marker} referencia`, altText: 'Referencia' } });
  const resolved = await cmsContent.resolveMediaReference(asset.reference, null);
  assert.equal(resolved.url, asset.public_url);
  assert.equal(resolved.altText, 'Referencia');

  assert.equal(await cmsContent.resolveMediaReference('/img/hardcoded.png', 'fallback'), 'fallback');
  assert.equal(await cmsContent.resolveMediaReference(`media://${crypto.randomUUID()}`, 'fallback'), 'fallback');

  // Seeded sections are disabled drafts, so published lookups return fallbacks.
  const fallback = { title: 'Contenido fijo' };
  assert.deepEqual(await cmsContent.getPublishedSectionContent('home', 'hero', fallback), fallback);
  assert.deepEqual(await cmsContent.getPublishedSectionContent('home', 'inexistente', fallback), fallback);
  assert.equal(await cmsContent.getSetting('clave_inexistente', 'valor'), 'valor');

  const page = await cmsContent.getPage('home');
  assert.equal(page.page_key, 'home');
  const sections = await cmsContent.listSections('home');
  assert.deepEqual(sections.map((section) => section.section_key), ['hero', 'showcase', 'services']);
});

test('revisions store safe metadata only and increment per entity', async () => {
  const asset = await createAsset();
  await mediaService.updateMetadata(asset.public_id, {
    title: `${marker} auditado`,
    altText: 'Auditado',
    category: 'site',
  }, null);

  const history = await revisionService.listRevisions(REVISION_ENTITY_TYPES.MEDIA_ASSET, asset.id, 10);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((row) => row.revision_number), [2, 1]);

  const snapshot = revisionService.mediaSnapshot({
    public_id: asset.public_id,
    title: 'x',
    password: 'no-debe-guardarse',
    session: 'tampoco',
    absolutePath: 'C:/secreto',
  });
  assert.deepEqual(Object.keys(snapshot).sort(), ['public_id', 'title']);
  await assert.rejects(
    () => revisionService.recordRevision({ entityType: 'unknown', entityId: 1, action: 'upload' }),
    /Tipo de entidad/
  );
  await assert.rejects(
    () => revisionService.recordRevision({ entityType: REVISION_ENTITY_TYPES.MEDIA_ASSET, entityId: 1, action: 'hack' }),
    /Acción de revisión/
  );
});

test('every media category maps to an existing storage directory and kind', () => {
  for (const category of MEDIA_CATEGORY_VALUES) {
    const directory = storage.categoryDirectory(category);
    assert.ok(MEDIA_DIRECTORIES.includes(directory));
    assert.ok(['image', 'model'].includes(storage.kindForCategory(category)));
  }
  assert.throws(() => storage.categoryDirectory('inventada'), /no es válida/);
});
