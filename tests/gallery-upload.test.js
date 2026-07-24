const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const {
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  PUBLIC_PATHS,
  STORAGE_ROOTS,
} = require('../config/galleryOptions');
const media = require('../services/galleryMediaService');
const validator = require('../validators/galleryValidator');

const created = [];

test.after(async () => {
  await media.deleteAbsolutePaths(created);
});

function imageFile(buffer, mimetype, originalname = 'client-name.jpg') {
  return { buffer, mimetype, originalname, size: buffer.length };
}

test('gallery configuration and validation are strictly allowlisted and bounded', () => {
  assert.deepEqual([...IMAGE_MIME_TYPES], ['image/jpeg', 'image/png', 'image/webp']);
  assert.deepEqual([...VIDEO_MIME_TYPES], ['video/mp4', 'video/webm']);
  assert.equal(validator.validateItem({
    title: '<script>alert(1)</script>',
    description: '<img onerror=alert(1)>',
    altText: 'Descripción segura',
    mediaType: 'html',
    sortOrder: '999999999999',
  }, []).valid, false);
  assert.equal(validator.positiveId('-1').valid, false);
  assert.equal(validator.slugify('../../admin'), 'admin');
  assert.equal(validator.parsePublicFilters({ tipo: 'html', page: '-2', limit: '999' }).type, '');
  assert.equal(validator.parsePublicFilters({ tipo: 'video', page: '-2', limit: '999' }).limit, 48);
});

test('JPEG, PNG, and WebP decode to optimized WebP display files and square thumbnails', async () => {
  const fixtures = [
    ['image/jpeg', await sharp({ create: { width: 900, height: 600, channels: 3, background: '#d22' } }).jpeg().toBuffer()],
    ['image/png', await sharp({ create: { width: 480, height: 800, channels: 4, background: '#2d28' } }).png().toBuffer()],
    ['image/webp', await sharp({ create: { width: 700, height: 700, channels: 3, background: '#22d' } }).webp().toBuffer()],
  ];

  for (const [mimetype, buffer] of fixtures) {
    const result = await media.processImagePair(imageFile(buffer, mimetype));
    created.push(...result.createdPaths);
    assert.match(result.mediaPath, /^\/uploads\/gallery\/images\/[a-f0-9-]+\.webp$/);
    assert.match(result.thumbnailPath, /^\/uploads\/gallery\/thumbnails\/[a-f0-9-]+\.webp$/);
    assert.doesNotMatch(result.mediaPath, /client-name/);
    const display = await sharp(media.resolveSafeGalleryPath(result.mediaPath, 'images')).metadata();
    const thumbnail = await sharp(media.resolveSafeGalleryPath(result.thumbnailPath, 'thumbnails')).metadata();
    assert.equal(display.format, 'webp');
    assert.ok(display.width <= 2400 && display.height <= 2400);
    assert.equal(thumbnail.format, 'webp');
    assert.equal(thumbnail.width, 512);
    assert.equal(thumbnail.height, 512);
    assert.equal(display.exif, undefined);
  }
});

test('poster processing creates controlled WebP poster and renderer thumbnail', async () => {
  const buffer = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#111' } }).jpeg().toBuffer();
  const result = await media.processImagePair(imageFile(buffer, 'image/jpeg', 'poster.jpg'), { poster: true });
  created.push(...result.createdPaths);
  assert.match(result.posterPath, /^\/uploads\/gallery\/posters\/[a-f0-9-]+\.webp$/);
  assert.match(result.thumbnailPath, /^\/uploads\/gallery\/thumbnails\/[a-f0-9-]+\.webp$/);
  assert.equal(await media.galleryPathExists(result.posterPath, 'posters'), true);
});

test('malformed, renamed, SVG, HTML, and oversized images are rejected', async () => {
  await assert.rejects(
    media.processImagePair(imageFile(Buffer.from('<svg></svg>'), 'image/svg+xml', 'x.svg')),
    /JPG, PNG o WebP/
  );
  await assert.rejects(
    media.processImagePair(imageFile(Buffer.from('<html>bad</html>'), 'image/jpeg', 'fake.jpg')),
    /no es una imagen válida|corrupto/
  );
  const onePixel = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  await assert.rejects(
    media.processImagePair({ ...imageFile(onePixel, 'image/jpeg'), size: 10 * 1024 * 1024 + 1 }),
    /10 MB/
  );
});

test('MP4 and WebM require matching extensions, signatures, and random filenames', async () => {
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('isom0000')]);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('webm')]);
  const mp4Saved = await media.saveVideo({ buffer: mp4, size: mp4.length, mimetype: 'video/mp4', originalname: '../../upload.mp4' });
  const webmSaved = await media.saveVideo({ buffer: webm, size: webm.length, mimetype: 'video/webm', originalname: 'upload.webm' });
  created.push(...mp4Saved.createdPaths, ...webmSaved.createdPaths);
  assert.match(mp4Saved.mediaPath, /^\/uploads\/gallery\/videos\/[a-f0-9-]+\.mp4$/);
  assert.match(webmSaved.mediaPath, /^\/uploads\/gallery\/videos\/[a-f0-9-]+\.webm$/);
  assert.notEqual(path.posix.basename(mp4Saved.mediaPath), 'upload.mp4');
  await assert.rejects(
    media.saveVideo({ buffer: mp4, size: mp4.length, mimetype: 'video/mp4', originalname: 'bad.webm' }),
    /extensión/
  );
  await assert.rejects(
    media.saveVideo({ buffer: Buffer.from('not-video'), size: 9, mimetype: 'video/mp4', originalname: 'fake.mp4' }),
    /firma/
  );
  await assert.rejects(
    media.saveVideo({ buffer: mp4, size: 100 * 1024 * 1024 + 1, mimetype: 'video/mp4', originalname: 'large.mp4' }),
    /100 MB/
  );
  await assert.rejects(
    media.saveVideo({ buffer: mp4, size: mp4.length, mimetype: 'image/jpeg', originalname: 'image.jpg' }),
    /MP4 o WebM/
  );
});

test('a video cannot be published without existing video, poster, and thumbnail files', async () => {
  await assert.rejects(
    media.assertPublishable({
      title: 'Video',
      alt_text: 'Póster del video',
      media_type: 'video',
      media_path: '/uploads/gallery/videos/11111111-1111-4111-8111-111111111111.mp4',
      poster_path: null,
      thumbnail_path: '/uploads/gallery/thumbnails/11111111-1111-4111-8111-111111111111.webp',
    }),
    /video, póster y miniatura/
  );
});

test('safe path resolution blocks traversal, absolute, wrong-root, and uncontrolled paths', () => {
  const valid = `${PUBLIC_PATHS.images}11111111-1111-4111-8111-111111111111.webp`;
  assert.equal(path.dirname(media.resolveSafeGalleryPath(valid, 'images')), path.resolve(STORAGE_ROOTS.images));
  for (const candidate of [
    '/uploads/gallery/images/../../app.js',
    '/uploads/gallery/images/C:\\secret.webp',
    '/uploads/gallery/images/not random.webp',
    '/uploads/products/file.webp',
    'C:\\absolute.webp',
  ]) {
    assert.throws(() => media.resolveSafeGalleryPath(candidate), /Ruta|Nombre/);
  }
  assert.throws(() => media.resolveSafeGalleryPath(valid, 'posters'), /almacenamiento esperado/);
});

test('compensation cleanup removes only newly generated controlled files', async () => {
  const buffer = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#0f0' } }).png().toBuffer();
  const result = await media.processImagePair(imageFile(buffer, 'image/png'));
  for (const absolutePath of result.createdPaths) assert.equal(fs.existsSync(absolutePath), true);
  await media.deleteAbsolutePaths(result.createdPaths);
  for (const absolutePath of result.createdPaths) assert.equal(fs.existsSync(absolutePath), false);
});

test('controller source preserves old media until DB success and compensates new files on failure', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminGalleryController.js'), 'utf8');
  const updateIndex = source.indexOf('async function updateItem');
  const updateBlock = source.slice(updateIndex, source.indexOf('async function deleteItem', updateIndex));
  assert.ok(updateBlock.indexOf('await gallery.updateItem') < updateBlock.indexOf('await media.deleteGalleryPaths'));
  assert.match(updateBlock, /catch \(error\)[\s\S]*await media\.deleteAbsolutePaths\(createdPaths\)/);
  assert.doesNotMatch(source, /req\.body\.(mediaPath|thumbnailPath|posterPath)/);
});
