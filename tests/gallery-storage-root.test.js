/**
 * Gallery persistent-storage contract.
 *
 * Gallery physical files must live under the canonical upload root
 * (config/uploadPaths.js UPLOAD_PUBLIC_ROOT), not under a hardcoded
 * public/uploads path. Public URLs must remain /uploads/gallery/...
 *
 * These tests spawn a fresh Node process with UPLOAD_PUBLIC_DIR set so path
 * resolution is verified against an isolated temporary root. No DB or network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildIsolatedTestEnvironment } = require('../config/testProcessEnvironment');

const projectRoot = path.join(__dirname, '..');

function runScript(script, volumeRoot) {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    env: buildIsolatedTestEnvironment(process.env, { UPLOAD_PUBLIC_DIR: volumeRoot }),
    encoding: 'utf8',
  });
}

test('STORAGE_ROOTS resolve under UPLOAD_PUBLIC_ROOT, not hardcoded public/uploads', () => {
  const configuredRoot = path.join(os.tmpdir(), `nl-gallery-root-${process.pid}`);
  const script = [
    "const g=require('./config/galleryOptions')",
    "process.stdout.write(JSON.stringify({gallery:g.STORAGE_ROOTS.gallery,images:g.STORAGE_ROOTS.images,thumbnails:g.STORAGE_ROOTS.thumbnails,videos:g.STORAGE_ROOTS.videos,posters:g.STORAGE_ROOTS.posters,publicPaths:g.PUBLIC_PATHS}))",
  ].join(';');
  const result = runScript(script, configuredRoot);
  assert.equal(result.status, 0, result.stderr);
  const resolved = JSON.parse(result.stdout);
  const root = path.resolve(configuredRoot);

  assert.equal(resolved.gallery, path.join(root, 'gallery'));
  assert.equal(resolved.images, path.join(root, 'gallery', 'images'));
  assert.equal(resolved.thumbnails, path.join(root, 'gallery', 'thumbnails'));
  assert.equal(resolved.videos, path.join(root, 'gallery', 'videos'));
  assert.equal(resolved.posters, path.join(root, 'gallery', 'posters'));

  for (const key of ['gallery', 'images', 'thumbnails', 'videos', 'posters']) {
    assert.ok(
      path.resolve(resolved[key]) === root
        || path.resolve(resolved[key]).startsWith(`${root}${path.sep}`),
      `${key} must live beneath the configured upload root`
    );
  }

  // Must NOT be derived from the hardcoded ephemeral location.
  for (const key of ['gallery', 'images', 'thumbnails', 'videos', 'posters']) {
    assert.doesNotMatch(
      resolved[key].replace(/\\/g, '/'),
      /public[\\/]uploads/,
      `${key} must not resolve under public/uploads`
    );
  }
});

test('public URLs remain /uploads/gallery/* and are not physical filesystem paths', () => {
  const script = [
    "const g=require('./config/galleryOptions')",
    "process.stdout.write(JSON.stringify(g.PUBLIC_PATHS))",
  ].join(';');
  const result = runScript(script, path.join(os.tmpdir(), `nl-gallery-url-${process.pid}`));
  assert.equal(result.status, 0, result.stderr);
  const publicPaths = JSON.parse(result.stdout);

  assert.equal(publicPaths.images, '/uploads/gallery/images/');
  assert.equal(publicPaths.thumbnails, '/uploads/gallery/thumbnails/');
  assert.equal(publicPaths.videos, '/uploads/gallery/videos/');
  assert.equal(publicPaths.posters, '/uploads/gallery/posters/');

  for (const value of Object.values(publicPaths)) {
    assert.doesNotMatch(value, /[A-Za-z]:[\\/]/);
    assert.doesNotMatch(value, /\/tmp\/|\/Users\/|\/data\//);
  }
});

test('a processed image is written beneath the custom root with a /uploads/gallery/ URL', () => {
  const volumeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-gallery-write-'));
  const script = `
    const sharp = require('sharp');
    const media = require('./services/galleryMediaService');
    const { STORAGE_ROOTS } = require('./config/galleryOptions');
    (async () => {
      const buffer = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#0af' } }).jpeg().toBuffer();
      const r = await media.processImagePair({ buffer, mimetype: 'image/jpeg', originalname: 'x.jpg', size: buffer.length });
      process.stdout.write(JSON.stringify({ ...r, images: STORAGE_ROOTS.images, gallery: STORAGE_ROOTS.gallery }));
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const result = runScript(script, volumeRoot);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);

  // Public URLs keep the canonical /uploads/gallery/ prefix.
  assert.match(out.mediaPath, /^\/uploads\/gallery\/images\/[a-f0-9-]+\.webp$/);
  assert.match(out.thumbnailPath, /^\/uploads\/gallery\/thumbnails\/[a-f0-9-]+\.webp$/);

  // Physical files are under the temporary root, not under public/uploads.
  assert.ok(path.resolve(out.images).startsWith(path.resolve(volumeRoot)), 'images root under volume');
  for (const created of out.createdPaths) {
    assert.ok(fs.existsSync(created), `created file must exist: ${created}`);
    assert.ok(
      path.resolve(created).startsWith(path.resolve(volumeRoot) + path.sep),
      `file must live beneath the volume root: ${created}`
    );
    assert.doesNotMatch(path.resolve(created).replace(/\\/g, '/'), /public[\\/]uploads/);
  }
});
