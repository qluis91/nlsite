/**
 * Production upload-path contract. This suite is self-contained: it never
 * assumes that a development server is already listening on port 3000.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildIsolatedTestEnvironment } = require('../config/testProcessEnvironment');

const projectRoot = path.join(__dirname, '..');

test('UPLOAD_PUBLIC_DIR is resolved once as the canonical absolute upload root', () => {
  const configuredRoot = path.join(os.tmpdir(), `nl-upload-contract-${process.pid}`);
  const script = [
    "const p=require('./config/uploadPaths')",
    'process.stdout.write(JSON.stringify({root:p.UPLOAD_PUBLIC_ROOT,media:p.MEDIA_ROOT,prefix:p.UPLOAD_PUBLIC_URL_PREFIX}))',
  ].join(';');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    env: buildIsolatedTestEnvironment(process.env, { UPLOAD_PUBLIC_DIR: configuredRoot }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const resolved = JSON.parse(result.stdout);
  assert.equal(resolved.root, path.resolve(configuredRoot));
  assert.equal(resolved.media, path.join(path.resolve(configuredRoot), 'media'));
  assert.equal(resolved.prefix, '/uploads/');
});

test('canonical DB path, physical path, and public URL are derived from one value', () => {
  const paths = require('../config/uploadPaths');
  const storagePath = 'media/logos/example.webp';
  assert.equal(paths.publicUrlForStoragePath(storagePath), '/uploads/media/logos/example.webp');
  assert.equal(paths.storagePathFromPublicUrl('/uploads/media/logos/example.webp'), storagePath);
  assert.equal(paths.resolveUploadStoragePath(storagePath), path.join(paths.UPLOAD_PUBLIC_ROOT, 'media', 'logos', 'example.webp'));
});

test('legacy media-root-relative records resolve without creating /uploads/uploads', () => {
  const storage = require('../services/mediaStorageService');
  const inspected = storage.inspectStoredPath('logos/legacy.webp');
  assert.equal(inspected.canonicalPath, 'media/logos/legacy.webp');
  assert.equal(inspected.publicUrl, '/uploads/media/logos/legacy.webp');
  assert.equal(inspected.isLegacy, true);
  assert.doesNotMatch(inspected.publicUrl, /\/uploads\/uploads\//);
});

test('absolute and traversal paths outside the configured root are rejected', () => {
  const paths = require('../config/uploadPaths');
  assert.throws(() => paths.resolveUploadStoragePath('../outside.webp'), /Ruta (?:de medio|de almacenamiento)/);
  assert.throws(() => paths.storagePathFromAbsolute(path.resolve(paths.UPLOAD_PUBLIC_ROOT, '..', 'outside.webp')), /Ruta de medio/);
});

test('app mounts the canonical upload root before the generic public directory', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
  const uploadMount = source.indexOf("app.use('/uploads'");
  const publicMount = source.indexOf("app.use(express.static(path.join(__dirname, 'public')");
  assert.ok(uploadMount >= 0, 'the /uploads mount must exist');
  assert.ok(publicMount >= 0, 'the public static mount must exist');
  assert.ok(uploadMount < publicMount, 'the Railway volume must not be shadowed by public/uploads');
  assert.equal((source.match(/app\.use\('\/uploads'/g) || []).length, 1);
  assert.match(source.slice(uploadMount - 1000, uploadMount + 500), /UPLOAD_PUBLIC/);
});
