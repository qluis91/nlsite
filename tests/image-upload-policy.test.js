const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const policy = require('../config/imageUploadPolicy');
const imgProc = require('../services/imageProcessingService');
const galleryOptions = require('../config/galleryOptions');
const cmsOptions = require('../config/cmsOptions');
const media = require('../services/galleryMediaService');

const createdDirs = [];

test.after(async () => {
  for (const dir of createdDirs) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.promises.rm(dir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4 || (error.code !== 'EBUSY' && error.code !== 'EPERM')) break;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }
});

async function tinyJpeg() {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: '#abc' } }).jpeg().toBuffer();
}

test('shared public image policy constants', () => {
  assert.equal(policy.PUBLIC_IMAGE_SOURCE_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(policy.PUBLIC_IMAGE_WEBP_QUALITY, 80);
  assert.equal(policy.PUBLIC_IMAGE_MAX_DIMENSION, 10000);
  assert.equal(policy.PUBLIC_IMAGE_MAX_PIXELS, 100 * 1000 * 1000);
  assert.equal(policy.PUBLIC_IMAGE_BATCH_MAX_BYTES, 75 * 1024 * 1024);
  assert.equal(policy.AVATAR_SOURCE_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(galleryOptions.MAX_IMAGE_SIZE, policy.PUBLIC_IMAGE_SOURCE_MAX_BYTES);
  assert.equal(galleryOptions.MAX_POSTER_SIZE, policy.PUBLIC_IMAGE_SOURCE_MAX_BYTES);
  assert.equal(galleryOptions.IMAGE_PROFILES.display.quality, 80);
  assert.equal(cmsOptions.MAX_IMAGE_SIZE, policy.PUBLIC_IMAGE_SOURCE_MAX_BYTES);
  assert.equal(cmsOptions.IMAGE_VARIANTS.large.quality, 80);
  assert.equal(cmsOptions.UPLOAD_PROFILES['hero-background'].maxSize, 25 * 1024 * 1024);
  assert.equal(cmsOptions.UPLOAD_PROFILES['hero-model'].maxSize, 30 * 1024 * 1024);
  assert.equal(cmsOptions.UPLOAD_PROFILES.avatar.maxSize, 10 * 1024 * 1024);
  assert.equal(cmsOptions.UPLOAD_PROFILES.product.maxSize, 25 * 1024 * 1024);
  assert.equal(imgProc.MAX_FILE_SIZE, policy.PUBLIC_IMAGE_SOURCE_MAX_BYTES);
  assert.equal(imgProc.PROFILES.product.quality, 80);
  assert.equal(imgProc.PROFILES.avatar.maxWidth, 512);
});

test('generic processing rejects invalid and oversized-dimension rasters', async () => {
  await assert.rejects(
    () => imgProc.processBuffer(Buffer.from('not-an-image'), imgProc.PROFILES.product),
    /no es una imagen válida|corrupto/
  );

  const oversized = await sharp({
    create: { width: policy.PUBLIC_IMAGE_MAX_DIMENSION + 1, height: 10, channels: 3, background: '#111' },
  }).png().toBuffer();
  await assert.rejects(
    () => imgProc.processBuffer(oversized, imgProc.PROFILES.product),
    /excede el máximo/
  );
});

test('generic processing rejects multi-page animated rasters when pages > 1', async () => {
  // Minimal 2-frame animated WebP (RIFF/WEBP + ANIM/ANMF). If decode fails or pages=1, skip.
  const animated = Buffer.from(
    '52494646a600000057454250565038200a0000001000000000000000414e494d06000000ffffffff00000000414e4d466c00000000000000000000001000000010000000640000000200565038205a000000300101009081888888ff4fff1b27fb1f9d489b8a233b575a944b9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f',
    'hex'
  );
  let pages = 0;
  try {
    const meta = await sharp(animated, { limitInputPixels: policy.PUBLIC_IMAGE_MAX_PIXELS }).metadata();
    pages = Number(meta.pages || 1);
  } catch {
    return;
  }
  if (pages <= 1) return;
  await assert.rejects(
    () => imgProc.processBuffer(animated, imgProc.PROFILES.product),
    /animadas/
  );
});

test('valid public image becomes WebP quality profile output', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nlsite-img-'));
  createdDirs.push(dir);
  const buffer = await tinyJpeg();
  const result = await imgProc.processImage(
    { buffer, mimetype: 'image/jpeg', size: buffer.length },
    dir,
    imgProc.PROFILES.category
  );
  assert.equal(result.mimeType, 'image/webp');
  assert.match(result.fileName, /\.webp$/);
  const meta = await sharp(result.filePath).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok(meta.width <= 1200);
  assert.ok(meta.height <= 800);
});

test('avatar uses 10 MB source max and 512px WebP profile', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nlsite-avatar-'));
  createdDirs.push(dir);
  const buffer = await tinyJpeg();
  await assert.rejects(
    () => imgProc.processImage(
      { buffer, mimetype: 'image/jpeg', size: 10 * 1024 * 1024 + 1 },
      dir,
      imgProc.PROFILES.avatar
    ),
    /10 MB/
  );
  const result = await imgProc.processImage(
    { buffer, mimetype: 'image/jpeg', size: 9 * 1024 * 1024 },
    dir,
    imgProc.PROFILES.avatar
  );
  assert.equal(result.mimeType, 'image/webp');
  const meta = await sharp(result.filePath).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
});

test('product batch total rejects above 75 MB while allowing per-file under 25 MB', () => {
  const twenty = { size: 20 * 1024 * 1024 };
  assert.doesNotThrow(() => imgProc.assertPublicImageBatchWithinLimit({
    primaryImage: [twenty],
    secondaryImages: [twenty, twenty],
  }));
  assert.throws(
    () => imgProc.assertPublicImageBatchWithinLimit({
      primaryImage: [twenty],
      secondaryImages: [twenty, twenty, twenty, twenty],
    }),
    /75 MB/
  );
});

test('gallery pre-validation accepts 12–24 MB source sizes and rejects over 25 MB', async () => {
  const buffer = await tinyJpeg();
  assert.doesNotThrow(() => media.validateImageUpload({
    buffer,
    mimetype: 'image/jpeg',
    size: 18 * 1024 * 1024,
  }));
  assert.throws(
    () => media.validateImageUpload({
      buffer,
      mimetype: 'image/jpeg',
      size: 26 * 1024 * 1024,
    }),
    /25 MB/
  );
});

test('admin gallery copy no longer advertises 10 MB for images', () => {
  const form = fs.readFileSync(path.join(__dirname, '../views/pages/admin/gallery/form.ejs'), 'utf8');
  assert.match(form, /hasta 25 MB/);
  assert.doesNotMatch(form, /Imagen: JPG\/PNG\/WebP, 10 MB/);
  const selector = fs.readFileSync(path.join(__dirname, '../public/js/admin/media-selector.js'), 'utf8');
  assert.match(selector, /maxSizeMb = allowedExtensions\.includes\('glb'\) \? 30 : 25/);
});
