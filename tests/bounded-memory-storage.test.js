const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const {
  boundedMemoryStorage,
  ERROR_CODES,
} = require('../middleware/boundedMemoryStorage');
const { resolveGalleryMaxFileBytes } = require('../middleware/galleryUpload');
const { resolveCmsMaxFileBytes } = require('../middleware/mediaUpload');
const {
  PUBLIC_IMAGE_SOURCE_MAX_BYTES,
  PUBLIC_IMAGE_BATCH_MAX_BYTES,
  AVATAR_SOURCE_MAX_BYTES,
  CMS_MEDIA_BATCH_MAX_BYTES,
  GALLERY_REQUEST_MAX_BYTES,
} = require('../config/imageUploadPolicy');
const { MAX_VIDEO_SIZE } = require('../config/galleryOptions');
const { MAX_MODEL_SIZE } = require('../config/cmsOptions');

function handleWithStream(storage, req, fileMeta, chunks) {
  return new Promise((resolve) => {
    const stream = new PassThrough();
    const file = { ...fileMeta, stream };
    let calls = 0;
    let result;

    storage._handleFile(req, file, (error, info) => {
      calls += 1;
      result = { error, info, calls };
      setImmediate(() => resolve({ ...result, calls }));
    });

    Promise.resolve()
      .then(async () => {
        for (const chunk of chunks) {
          if (stream.destroyed || result) break;
          try {
            const ok = stream.write(chunk);
            if (!ok) await new Promise((r) => stream.once('drain', r));
          } catch {
            break;
          }
          await new Promise((r) => setImmediate(r));
        }
        if (!stream.destroyed && !result) stream.end();
      })
      .catch(() => {
        // Stream may error after an intentional limit abort; callback is authoritative.
      });
  });
}

test('file under limit returns complete buffer and size', async () => {
  const storage = boundedMemoryStorage({
    resolveMaxFileBytes: () => 100,
    maxRequestBytes: 200,
  });
  const payload = Buffer.from('abcdefghij');
  const outcome = await handleWithStream(
    storage,
    {},
    { fieldname: 'image', mimetype: 'image/jpeg' },
    [payload]
  );
  assert.equal(outcome.error, null);
  assert.ok(outcome.info.buffer.equals(payload));
  assert.equal(outcome.info.size, payload.length);
  assert.equal(outcome.calls, 1);
});

test('file over limit rejects while streaming without keeping oversized buffer', async () => {
  const storage = boundedMemoryStorage({
    resolveMaxFileBytes: () => 20,
    maxRequestBytes: 1000,
  });
  const outcome = await handleWithStream(
    storage,
    {},
    { fieldname: 'image', mimetype: 'image/jpeg' },
    [Buffer.alloc(15, 1), Buffer.alloc(10, 2)]
  );
  assert.equal(outcome.error.code, ERROR_CODES.PUBLIC_FILE_TOO_LARGE);
  assert.equal(outcome.info, undefined);
  assert.equal(outcome.calls, 1);
  assert.ok(outcome.error.receivedBytes > 20);
});

test('aggregate request limit rejects after accumulated bytes cross maximum', async () => {
  const storage = boundedMemoryStorage({
    resolveMaxFileBytes: () => 50,
    maxRequestBytes: 60,
  });
  const req = {};
  const first = await handleWithStream(
    storage,
    req,
    { fieldname: 'a', mimetype: 'image/jpeg' },
    [Buffer.alloc(40, 1)]
  );
  assert.equal(first.error, null);
  assert.equal(first.info.size, 40);

  const second = await handleWithStream(
    storage,
    req,
    { fieldname: 'b', mimetype: 'image/jpeg' },
    [Buffer.alloc(30, 2)]
  );
  assert.equal(second.error.code, ERROR_CODES.UPLOAD_BATCH_TOO_LARGE);
  assert.equal(second.calls, 1);
});

test('overflow callback fires only once', async () => {
  const storage = boundedMemoryStorage({
    resolveMaxFileBytes: () => 8,
    maxRequestBytes: 100,
  });
  const outcome = await handleWithStream(
    storage,
    {},
    { fieldname: 'image', mimetype: 'image/png' },
    [Buffer.alloc(4, 1), Buffer.alloc(4, 2), Buffer.alloc(4, 3), Buffer.alloc(4, 4)]
  );
  assert.equal(outcome.error.code, ERROR_CODES.PUBLIC_FILE_TOO_LARGE);
  assert.equal(outcome.calls, 1);
});

test('Gallery policy resolves raster/poster to 25 MB and video to 100 MB', () => {
  assert.equal(
    resolveGalleryMaxFileBytes({}, { fieldname: 'media', mimetype: 'image/jpeg' }),
    PUBLIC_IMAGE_SOURCE_MAX_BYTES
  );
  assert.equal(
    resolveGalleryMaxFileBytes({}, { fieldname: 'poster', mimetype: 'image/webp' }),
    PUBLIC_IMAGE_SOURCE_MAX_BYTES
  );
  assert.equal(
    resolveGalleryMaxFileBytes({}, { fieldname: 'media', mimetype: 'video/mp4' }),
    MAX_VIDEO_SIZE
  );
  assert.equal(
    resolveGalleryMaxFileBytes({}, { fieldname: 'media', mimetype: 'video/webm' }),
    MAX_VIDEO_SIZE
  );
  assert.equal(GALLERY_REQUEST_MAX_BYTES, 125 * 1024 * 1024);
});

test('Products policy: individual 25 MB and aggregate 75 MB', () => {
  assert.equal(PUBLIC_IMAGE_SOURCE_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(PUBLIC_IMAGE_BATCH_MAX_BYTES, 75 * 1024 * 1024);
});

test('CMS policy: raster 25 MB, GLB 30 MB, batch 90 MB', () => {
  assert.equal(
    resolveCmsMaxFileBytes({}, { mimetype: 'image/png' }),
    PUBLIC_IMAGE_SOURCE_MAX_BYTES
  );
  assert.equal(
    resolveCmsMaxFileBytes({}, { mimetype: 'model/gltf-binary' }),
    MAX_MODEL_SIZE
  );
  assert.equal(
    resolveCmsMaxFileBytes({}, { mimetype: 'application/octet-stream' }),
    MAX_MODEL_SIZE
  );
  assert.equal(CMS_MEDIA_BATCH_MAX_BYTES, 90 * 1024 * 1024);
  assert.equal(MAX_MODEL_SIZE, 30 * 1024 * 1024);
});

test('Avatar source max remains 10 MB', () => {
  assert.equal(AVATAR_SOURCE_MAX_BYTES, 10 * 1024 * 1024);
});
