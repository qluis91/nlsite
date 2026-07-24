const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');
const demo = require('../scripts/seed-gallery-demo');

const root = path.join(__dirname, '..');
const prefix = `test-demo-gallery-${crypto.randomBytes(5).toString('hex')}-`;
const categories = [
  { key: 'formas', name: 'Test Demo Formas', order: 9001 },
];
const catalog = [
  { slug: 'forma-uno', title: 'Forma Uno', category: 'formas', theme: 2 },
  { slug: 'forma-dos', title: 'Forma Dos', category: 'formas', theme: 7 },
];
let generatedPaths = [];

test.after(async () => {
  try {
    await demo.cleanGalleryDemo({ prefix, environment: { NODE_ENV: 'test' } });
  } finally {
    await demo.closeDemoPool();
  }
});

test('production CLI execution is blocked before loading database dependencies', () => {
  const result = spawnSync(process.execPath, ['scripts/seed-gallery-demo.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', ALLOW_PRODUCTION_DEMO_SEED: '' },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /blocked in production/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Conexi.n exitosa|database credentials/i);
  assert.throws(
    () => demo.assertDemoEnvironment({ NODE_ENV: 'production' }),
    /blocked in production/
  );
  assert.doesNotThrow(() => demo.assertDemoEnvironment({
    NODE_ENV: 'production',
    ALLOW_PRODUCTION_DEMO_SEED: 'true',
  }));
});

test('controlled SVG artwork becomes a valid local WebP without network access', async () => {
  const buffer = await demo.generateDemoWebpBuffer(catalog[0]);
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.format, 'webp');
  assert.ok(metadata.width >= 900);
  assert.ok(metadata.height >= 900);
  const source = fs.readFileSync(path.join(root, 'scripts', 'seed-gallery-demo.js'), 'utf8');
  assert.doesNotMatch(source, /picsum\.photos|unsplash\.com|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
  assert.doesNotMatch(source, /fetch\(|axios|node-fetch|process\.exit\(/);
});

test('development seed is idempotent and produces published display/thumbnail pairs', async () => {
  const first = await demo.seedGalleryDemo({
    prefix,
    catalog,
    categories,
    environment: { NODE_ENV: 'test' },
  });
  assert.equal(first.itemsCreated, 2);
  assert.equal(first.imagesGenerated, 2);

  const { pool, media } = {
    pool: require('../config/db'),
    media: require('../services/galleryMediaService'),
  };
  const [rows] = await pool.query(
    'SELECT * FROM gallery_items WHERE slug LIKE ? ORDER BY slug',
    [`${prefix}%`]
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.is_published === 1));
  generatedPaths = rows.flatMap((row) => [row.media_path, row.thumbnail_path]);
  for (const row of rows) {
    const display = await sharp(media.resolveSafeGalleryPath(row.media_path, 'images')).metadata();
    const thumbnail = await sharp(media.resolveSafeGalleryPath(row.thumbnail_path, 'thumbnails')).metadata();
    assert.equal(display.format, 'webp');
    assert.equal(thumbnail.format, 'webp');
    assert.equal(thumbnail.width, 512);
    assert.equal(thumbnail.height, 512);
  }

  const second = await demo.seedGalleryDemo({
    prefix,
    catalog,
    categories,
    environment: { NODE_ENV: 'test' },
  });
  assert.equal(second.itemsCreated, 0);
  assert.equal(second.imagesGenerated, 0);
  assert.equal(second.itemsReused, 2);
  const [[count]] = await pool.query(
    'SELECT COUNT(*) total FROM gallery_items WHERE slug LIKE ?',
    [`${prefix}%`]
  );
  assert.equal(count.total, 2);
});

test('a pre-commit failure rolls back rows and compensates every newly generated file', async () => {
  const failingPrefix = `test-demo-failure-${crypto.randomBytes(5).toString('hex')}-`;
  let prepared = [];
  await assert.rejects(
    demo.seedGalleryDemo({
      prefix: failingPrefix,
      catalog: [catalog[0]],
      categories,
      environment: { NODE_ENV: 'test' },
      beforeCommit: (pairs) => {
        prepared = pairs.flatMap((pair) => pair.createdPaths);
        throw new Error('simulated transaction failure');
      },
    }),
    /simulated transaction failure/
  );
  assert.ok(prepared.length > 0);
  assert.ok(prepared.every((filePath) => !fs.existsSync(filePath)));
  const pool = require('../config/db');
  const [[items]] = await pool.query(
    'SELECT COUNT(*) total FROM gallery_items WHERE slug LIKE ?',
    [`${failingPrefix}%`]
  );
  const [[demoCategories]] = await pool.query(
    'SELECT COUNT(*) total FROM gallery_categories WHERE slug LIKE ?',
    [`${failingPrefix}%`]
  );
  assert.equal(items.total, 0);
  assert.equal(demoCategories.total, 0);
});

test('cleanup removes only prefix-owned records and controlled referenced files', async () => {
  const pool = require('../config/db');
  const [[nonDemoBefore]] = await pool.query(
    'SELECT COUNT(*) total FROM gallery_items WHERE slug NOT LIKE ?',
    [`${prefix}%`]
  );
  const cleaned = await demo.cleanGalleryDemo({
    prefix,
    environment: { NODE_ENV: 'test' },
  });
  assert.equal(cleaned.itemsRemoved, 2);
  assert.equal(cleaned.categoriesRemoved, 1);
  const [[remaining]] = await pool.query(
    'SELECT COUNT(*) total FROM gallery_items WHERE slug LIKE ?',
    [`${prefix}%`]
  );
  const [[nonDemoAfter]] = await pool.query(
    'SELECT COUNT(*) total FROM gallery_items WHERE slug NOT LIKE ?',
    [`${prefix}%`]
  );
  assert.equal(remaining.total, 0);
  assert.equal(nonDemoAfter.total, nonDemoBefore.total);
  const media = require('../services/galleryMediaService');
  for (const publicPath of generatedPaths) {
    assert.equal(await media.galleryPathExists(publicPath), false);
  }
  assert.throws(() => demo.validatePrefix('../../gallery-'), /invalid/);
  assert.throws(() => demo.validatePrefix('demo_%_'), /invalid/);
});
