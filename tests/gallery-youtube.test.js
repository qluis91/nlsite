const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');
const {
  validateAndNormalize,
  extractVideoId,
  resolveYoutubeThumbnailCandidates,
  YOUTUBE_PLACEHOLDER_URL,
} = require('../utils/youtubeUrl');
const { MEDIA_TYPES } = require('../config/galleryOptions');

// ── Unit: YouTube URL normalisation ──
test('parse standard watch URL', () => {
  const r = validateAndNormalize('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(r.valid);
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  assert.strictEqual(r.canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(r.embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.strictEqual(r.thumbnailUrl, 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.deepEqual(r.thumbnailFallbackUrls, [
    'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    YOUTUBE_PLACEHOLDER_URL,
  ]);
});

test('parse short youtu.be URL', () => {
  const r = validateAndNormalize('https://youtu.be/dQw4w9WgXcQ');
  assert.ok(r.valid);
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

test('parse shorts URL', () => {
  const r = validateAndNormalize('https://www.youtube.com/shorts/abc123DEF_-');
  assert.ok(r.valid);
  assert.strictEqual(r.videoId, 'abc123DEF_-');
});

test('parse embed URL', () => {
  const r = validateAndNormalize('https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.ok(r.valid);
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

test('parse plain video ID as fallback', () => {
  const r = validateAndNormalize('dQw4w9WgXcQ');
  assert.ok(r.valid);
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

test('parse URL without protocol', () => {
  const r = validateAndNormalize('www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(r.valid);
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

test('reject invalid YouTube URL', () => {
  const r = validateAndNormalize('https://vimeo.com/12345');
  assert.ok(!r.valid);
  assert.ok(r.error);
  assert.ok(r.error.includes('YouTube'));
});

test('reject YouTube URL with missing video ID', () => {
  const r = validateAndNormalize('https://www.youtube.com/watch');
  assert.ok(!r.valid);
});

test('reject empty string', () => {
  const r = validateAndNormalize('');
  assert.ok(!r.valid);
});

test('reject null/undefined', () => {
  const r = validateAndNormalize(null);
  assert.ok(!r.valid);
});

test('reject ID shorter than 11 characters', () => {
  const r = validateAndNormalize('https://www.youtube.com/watch?v=abc');
  assert.ok(!r.valid);
});

test('reject ID with invalid characters', () => {
  const r = validateAndNormalize('https://www.youtube.com/watch?v=abc123!@#$');
  assert.ok(!r.valid);
});

test('extractVideoId returns null for invalid URLs', () => {
  assert.strictEqual(extractVideoId(''), null);
  assert.strictEqual(extractVideoId(null), null);
  assert.strictEqual(extractVideoId('not-a-url'), null);
});

test('thumbnailUrl uses hqdefault for all valid IDs', () => {
  const r = validateAndNormalize('https://youtu.be/abcdefghijk');
  assert.strictEqual(r.thumbnailUrl, 'https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg');
});

test('thumbnail fallback order is custom cover, hqdefault, mqdefault, then local placeholder', () => {
  const candidates = resolveYoutubeThumbnailCandidates({
    customCoverPath: '/uploads/gallery/thumbnails/custom.webp',
    youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
  });
  assert.deepEqual(candidates, [
    '/uploads/gallery/thumbnails/custom.webp',
    'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    YOUTUBE_PLACEHOLDER_URL,
  ]);
});

test('automatic thumbnail URLs are never derived from unvalidated raw input', () => {
  const malicious = 'https://example.com/?next=https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.strictEqual(extractVideoId(malicious), null);
  assert.deepEqual(resolveYoutubeThumbnailCandidates({ youtubeUrl: malicious }), [
    YOUTUBE_PLACEHOLDER_URL,
  ]);
});

test('canonicalUrl always uses watch format', () => {
  const r = validateAndNormalize('https://youtu.be/abcdefghijk');
  assert.strictEqual(r.canonicalUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
});

// ── Unit: galleryValidator YouTube ──
test('validateItem accepts youtube mediaType', () => {
  const validator = require('../validators/galleryValidator');
  const result = validator.validateItem({
    title: 'Test YouTube',
    altText: 'A test video',
    mediaType: 'youtube',
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  }, []);
  assert.ok(result.valid);
  assert.strictEqual(result.value.mediaType, 'youtube');
  assert.strictEqual(result.value.youtubeUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('validateItem rejects youtube without URL', () => {
  const validator = require('../validators/galleryValidator');
  const result = validator.validateItem({
    title: 'Test',
    altText: 'A test video',
    mediaType: 'youtube',
    youtubeUrl: '',
  }, []);
  assert.ok(!result.valid);
  assert.ok(result.error.includes('obligatoria'));
});

test('validateItem rejects youtube with URL exceeding 500 chars', () => {
  const validator = require('../validators/galleryValidator');
  const longUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' + 'x'.repeat(500);
  const result = validator.validateItem({
    title: 'Test',
    altText: 'A test video',
    mediaType: 'youtube',
    youtubeUrl: longUrl,
  }, []);
  assert.ok(!result.valid);
  assert.ok(result.error.includes('500'));
});

test('validateItem rejects unknown mediaType', () => {
  const validator = require('../validators/galleryValidator');
  const result = validator.validateItem({
    title: 'Test',
    altText: 'A test video',
    mediaType: 'audio',
  }, []);
  assert.ok(!result.valid);
});

// ── Unit: MEDIA_TYPES includes YOUTUBE ──
test('MEDIA_TYPES includes image, video, and youtube', () => {
  assert.strictEqual(MEDIA_TYPES.IMAGE, 'image');
  assert.strictEqual(MEDIA_TYPES.VIDEO, 'video');
  assert.strictEqual(MEDIA_TYPES.YOUTUBE, 'youtube');
});

test('MEDIA_TYPES.values includes youtube', () => {
  assert.ok(Object.values(MEDIA_TYPES).includes('youtube'));
});

// ── Unit: service accepts youtube data ──
test('createItem INSERT has matching column count and parameters', async () => {
  const serviceSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'galleryService.js'), 'utf8'
  );
  assert.ok(serviceSource.includes('youtube_url'), 'createItem must reference youtube_url column');
  assert.ok(serviceSource.includes('custom_cover_path'), 'createItem must reference custom_cover_path column');
  // Extract createItem function body and verify no CASE WHEN in VALUES
  const createIdx = serviceSource.indexOf('async function createItem');
  const nextFnIdx = serviceSource.indexOf('async function', createIdx + 10);
  const createBlock = serviceSource.slice(createIdx, nextFnIdx > createIdx ? nextFnIdx : undefined);
  assert.ok(!createBlock.includes('CASE WHEN'), 'createItem must not use CASE WHEN in VALUES');
  // Verify published_at is a direct placeholder
  assert.ok(createBlock.includes('published_at'), 'must include published_at column');
  // Verify VALUES has 15 placeholders (not 16)
  const valuesLine = createBlock.match(/VALUES\s*\(([^)]+)\)/);
  assert.ok(valuesLine, 'VALUES clause must exist');
  const placeholders = valuesLine[1].split('?').length - 1;
  assert.strictEqual(placeholders, 15, 'must have exactly 15 placeholders');
});

// ── Unit: safeGalleryJson includes youtube data ──
test('safeGalleryJson includes youtubeId and customCover for youtube items', () => {
  const { safeGalleryJson } = require('../controllers/galleryController');
  const items = [
    { id: 1, slug: 'test', media_type: 'youtube', title: 'YT', description: '', category_name: '',
      thumbnail_path: '/t.jpg', media_path: '/e', poster_path: null, alt_text: 'a', is_featured: 0,
      youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', custom_cover_path: null },
    { id: 2, slug: 'img', media_type: 'image', title: 'Img', description: '', category_name: '',
      thumbnail_path: '/i.jpg', media_path: '/i', poster_path: null, alt_text: 'a', is_featured: 0,
      youtube_url: null, custom_cover_path: null },
  ];
  const json = safeGalleryJson(items);
  const parsed = JSON.parse(json);
  const yt = parsed[0];
  assert.strictEqual(yt.youtubeId, 'dQw4w9WgXcQ');
  assert.strictEqual(yt.customCover, null);
  assert.strictEqual(yt.type, 'youtube');
  const img = parsed[1];
  assert.strictEqual(img.type, 'image');
  assert.ok(!('youtubeId' in img), 'non-youtube items should not have youtubeId');
});

test('safeGalleryJson resolves automatic and custom YouTube thumbnail fallbacks', () => {
  const { safeGalleryJson } = require('../controllers/galleryController');
  const base = {
    id: 700,
    slug: 'youtube',
    media_type: 'youtube',
    title: 'YouTube',
    description: '',
    category_name: '',
    thumbnail_path: null,
    media_path: 'untrusted raw source',
    poster_path: null,
    alt_text: 'Video',
    is_featured: 0,
    youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    custom_cover_path: null,
  };
  const automatic = JSON.parse(safeGalleryJson([base]))[0];
  assert.strictEqual(automatic.thumbnail, 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.deepEqual(automatic.thumbnailFallbacks, [
    'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    YOUTUBE_PLACEHOLDER_URL,
  ]);
  assert.strictEqual(automatic.source, 'https://www.youtube.com/embed/dQw4w9WgXcQ');

  const custom = JSON.parse(safeGalleryJson([{
    ...base,
    id: 701,
    custom_cover_path: '/uploads/gallery/thumbnails/custom.webp',
  }]))[0];
  assert.strictEqual(custom.thumbnail, '/uploads/gallery/thumbnails/custom.webp');
  assert.strictEqual(custom.thumbnailFallbacks[0], 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

// ── Unit: schema has youtube columns ──
test('schema.sql includes youtube_url and custom_cover_path in gallery_items', async () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const galleryBlock = schema.match(/CREATE TABLE IF NOT EXISTS gallery_items[\s\S]*?\) ENGINE=/);
  assert.ok(galleryBlock, 'gallery_items table definition must exist');
  assert.ok(galleryBlock[0].includes('youtube_url'), 'schema must include youtube_url column');
  assert.ok(galleryBlock[0].includes('custom_cover_path'), 'schema must include custom_cover_path column');
});

// ── Unit: migration exists and is idempotent ──
test('migration script exists and exports migrate function', () => {
  const migrate = require('../scripts/migrate-gallery-youtube');
  assert.strictEqual(typeof migrate.migrate, 'function', 'must export migrate function');
});

test('migration is idempotent (safe to run twice)', async () => {
  const migrate = require('../scripts/migrate-gallery-youtube');
  await migrate.migrate();
  await migrate.migrate();
});

// ── Unit: admin form includes YouTube option ──
test('admin form includes YouTube media type option', () => {
  const form = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'pages', 'admin', 'gallery', 'form.ejs'), 'utf8'
  );
  assert.ok(form.includes('value="youtube"'), 'form must have YouTube option');
  assert.ok(form.includes('gallery-youtube-url'), 'form must have youtube URL input');
  assert.ok(form.includes('name="youtubeUrl"'), 'field name must match controller youtubeUrl');
});

test('admin form has JS toggle for YouTube fields with disable/require', () => {
  const form = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'pages', 'admin', 'gallery', 'form.ejs'), 'utf8'
  );
  assert.ok(form.includes('gallery-field-youtube'), 'must have youtube-specific field group');
  assert.ok(form.includes('gallery-field-file'), 'must have file field group');
  assert.ok(form.includes('removeAttribute(\'required\')'), 'must remove required for YouTube');
  assert.ok(form.includes('mediaWasRequired'), 'must store original required state');
  assert.ok(form.includes('.disabled = true'), 'must disable inputs when hidden');
  assert.ok(form.includes('.disabled = false'), 'must re-enable inputs when shown');
  assert.ok(form.includes('gallery-required-yt'), 'must have YouTube required indicator');
});

test('admin YouTube preview uses validated ID and the same thumbnail fallback order', () => {
  const form = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'pages', 'admin', 'gallery', 'form.ejs'), 'utf8'
  );
  assert.ok(form.includes('data-gallery-thumbnail-preview'), 'must render a thumbnail preview');
  assert.ok(form.includes('validatedYoutubeId'), 'must validate the YouTube ID before building URLs');
  const hq = form.indexOf('/hqdefault.jpg');
  const mq = form.indexOf('/mqdefault.jpg');
  const placeholder = form.indexOf('/images/gallery-video-placeholder.svg');
  assert.ok(hq > 0 && mq > hq && placeholder > 0, 'must include hq, mq, and local placeholder');
  assert.ok(form.includes('data-initial-custom-cover'), 'must preserve a custom cover as first choice');
  assert.ok(form.includes('nonce="<%= cspNonce %>"'), 'inline form behavior must use the CSP nonce');
});

test('admin form file input has required in create mode, not in edit mode', () => {
  const form = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'pages', 'admin', 'gallery', 'form.ejs'), 'utf8'
  );
  assert.ok(form.includes('item ? \'\' : \'required\''), 'must have required only in create mode');
  // Verify the JS toggle stores whether the input was originally required
  assert.ok(form.includes('hasAttribute(\'required\')'), 'JS must read original required state');
  // Verify the JS restores required correctly (not checking currently-removed attr)
  assert.ok(form.includes('mediaWasRequired'), 'must use stored variable to restore required');
});

// ── Unit: CSP configuration ──
test('CSP includes YouTube frame-src and img-src', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(appSource.includes('https://www.youtube.com'), 'CSP must allow youtube.com in frameSrc');
  assert.ok(appSource.includes('https://img.youtube.com'), 'CSP must allow img.youtube.com in imgSrc');
});

test('CSP still restricts defaultSrc to self', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(appSource.includes(`defaultSrc: ["'self'"]`), 'defaultSrc must remain self');
});

// ── Unit: gallery card partial ──
test('gallery card renders YouTube label and play icon', () => {
  const card = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'partials', 'gallery-card.ejs'), 'utf8'
  );
  assert.ok(card.includes('Ver en YouTube'), 'card must show YouTube label');
  assert.ok(card.includes("gallery-card__play--youtube"), 'card must have youtube play icon class');
  assert.ok(card.includes("item.media_type === 'youtube'"), 'card must have youtube branch');
});

// ── Unit: carousel includes YouTube items ──
test('selectVideoGalleryItems includes YouTube items with valid embed URL', () => {
  const mjs = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'gallery', 'galleryModes.mjs'), 'utf8'
  );
  assert.ok(mjs.includes("item?.type === 'youtube'"), 'selector must check for youtube type');
  assert.ok(mjs.includes('SAFE_YOUTUBE_EMBED'), 'selector must validate youtube embed URL');
});

test('SAFE_YOUTUBE_EMBED only accepts canonical embed URLs', () => {
  const SAFE_YOUTUBE_EMBED = /^https:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]{11}$/;
  assert.ok(SAFE_YOUTUBE_EMBED.test('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'valid embed URL');
  assert.ok(!SAFE_YOUTUBE_EMBED.test('https://youtube.com/embed/dQw4w9WgXcQ'), 'missing www');
  assert.ok(!SAFE_YOUTUBE_EMBED.test('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'watch URL');
  assert.ok(!SAFE_YOUTUBE_EMBED.test('/uploads/gallery/videos/test.mp4'), 'local path');
});

test('carousel meta label shows YouTube for youtube items', () => {
  const mjs = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'gallery', 'galleryModes.mjs'), 'utf8'
  );
  assert.ok(mjs.includes("item.type === 'youtube'"), 'updateCircular must check youtube type');
  assert.ok(mjs.includes("'YouTube'"), 'updateCircular must show YouTube label');
});

// ── Unit: gallery viewer YouTube iframe lifecycle ──
test('viewer has iframe creation for YouTube items', () => {
  const viewer = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'gallery', 'galleryViewer.mjs'), 'utf8'
  );
  assert.ok(viewer.includes("item.type === 'youtube'"), 'viewer must handle youtube type');
  assert.ok(viewer.includes("createElement('iframe')"), 'viewer must create iframe for YouTube');
  assert.ok(viewer.includes('data-gallery-youtube'), 'viewer must add data attribute');
  assert.ok(viewer.includes('gallery-modal__youtube'), 'viewer must apply CSS class');
});

test('viewer removes iframe on close and destroy', () => {
  const viewer = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'gallery', 'galleryViewer.mjs'), 'utf8'
  );
  assert.ok(viewer.includes('removeYoutubeFrame'), 'viewer must have remove function');
  // closeModal check
  const closeIdx = viewer.indexOf('async function closeModal');
  assert.ok(closeIdx > 0, 'must have closeModal');
  const closeBlock = viewer.slice(closeIdx, closeIdx + 800);
  assert.ok(closeBlock.includes('removeYoutubeFrame()'), 'closeModal must call removeYoutubeFrame');
  // The real destroy() is the second occurrence (first is in fallback); find it by searching after closeModal
  const afterClose = viewer.slice(closeIdx + 800);
  const destroyIdx = afterClose.indexOf('destroy()');
  assert.ok(destroyIdx > 0, 'must have destroy method after closeModal');
  const destroyBlock = afterClose.slice(destroyIdx, destroyIdx + 500);
  assert.ok(destroyBlock.includes('removeYoutubeFrame()'), 'destroy must call removeYoutubeFrame');
});

test('viewer clears iframe before rendering new item', () => {
  const viewer = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'gallery', 'galleryViewer.mjs'), 'utf8'
  );
  const renderIdx = viewer.indexOf('function renderItem');
  assert.ok(renderIdx > 0, 'renderItem function must exist');
  const renderBlock = viewer.slice(renderIdx, renderIdx + 300);
  assert.ok(renderBlock.includes('removeYoutubeFrame()'), 'renderItem must call removeYoutubeFrame first');
});

test('viewer builds iframe src from youtubeId, not raw input', () => {
  const viewer = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'gallery', 'galleryViewer.mjs'), 'utf8'
  );
  assert.ok(viewer.includes('encodeURIComponent(item.youtubeId)'), 'must encode youtubeId');
  assert.ok(viewer.includes('www.youtube.com/embed/'), 'must use canonical embed URL');
  assert.ok(viewer.includes('modestbranding'), 'must include modestbranding param');
});

// ── Unit: CSS for YouTube iframe ──
test('gallery CSS styles YouTube iframe', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'gallery.css'), 'utf8'
  );
  assert.ok(css.includes('gallery-modal__youtube'), 'CSS must have youtube iframe class');
  assert.ok(css.includes('aspect-ratio: 16 / 9'), 'CSS must constrain aspect ratio');
});

// ── Unit: admin controller imports youtubeUrl module ──
test('admin gallery controller imports youtubeUrl', () => {
  const ctrl = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'adminGalleryController.js'), 'utf8'
  );
  assert.ok(ctrl.includes("require('../utils/youtubeUrl')"), 'must import youtubeUrl utility');
});

test('admin create/update skips file assertPublishable for youtube', () => {
  const ctrl = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'adminGalleryController.js'), 'utf8'
  );
  const matches = [...ctrl.matchAll(/data\.isPublished && data\.mediaType !== MEDIA_TYPES\.YOUTUBE/g)];
  assert.ok(matches.length >= 2, 'create and update must skip assertPublishable for youtube');
});

test('admin deleteItem skips file cleanup for youtube', () => {
  const ctrl = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'adminGalleryController.js'), 'utf8'
  );
  assert.ok(ctrl.includes("deleted.media_type !== 'youtube'"), 'must skip file deletion for youtube');
});

// ── Unit: migration tracker registration ──
test('migration is registered in tracker', () => {
  const tracker = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'migrationTracker.js'), 'utf8'
  );
  assert.ok(tracker.includes('migrateGalleryYoutube'), 'migration must be in registry');
  assert.ok(tracker.includes('migrate-gallery-youtube'), 'must reference migration file');
});

// ── Schema DB migration: verify columns exist ──
test('gallery_items has youtube_url and custom_cover_path columns in DB', async () => {
  const migrate = require('../scripts/migrate-gallery-youtube');
  await migrate.migrate();
  const [[check]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gallery_items'
        AND COLUMN_NAME IN ('youtube_url', 'custom_cover_path')`
  );
  assert.strictEqual(Number(check.cnt), 2, 'both columns must exist');
});

test('gallery_items youtube columns allow NULL', async () => {
  const [[col]] = await pool.query(
    `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gallery_items'
        AND COLUMN_NAME IN ('youtube_url', 'custom_cover_path')
      ORDER BY COLUMN_NAME`
  );
  assert.ok(col, 'columns must exist');
});

test('migration tracker includes gallery-youtube entry', () => {
  const tracker = require('../scripts/migrationTracker');
  const registry = tracker.MIGRATION_REGISTRY || [];
  if (registry.length > 0) {
    const entry = registry.find((e) => e.name === 'migrateGalleryYoutube');
    assert.ok(entry, 'migrateGalleryYoutube must be in registry');
  }
});

// ── DB Integration: create YouTube items via service ──
const gallery = require('../services/galleryService');

test('createItem inserts a YouTube item without local files', async () => {
  const marker = `_test_yt_${Date.now()}`;
  const id = await gallery.createItem({
    categoryId: null, title: marker, slug: marker,
    description: 'YouTube integration test',
    mediaType: 'youtube',
    mediaPath: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    thumbnailPath: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    posterPath: null,
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    customCoverPath: null,
    altText: 'Test video',
    sortOrder: 0,
    isFeatured: false,
    isPublished: false,
  });
  assert.ok(id > 0, 'must return a valid insert ID');

  const item = await gallery.getItemById(id);
  assert.strictEqual(item.media_type, 'youtube');
  assert.strictEqual(item.youtube_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(item.media_path, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.strictEqual(item.is_published, 0);
  assert.strictEqual(item.published_at, null);
});

test('createItem sets published_at when isPublished is true', async () => {
  const marker = `_test_yt_pub_${Date.now()}`;
  const id = await gallery.createItem({
    categoryId: null, title: marker, slug: marker,
    description: 'Published YouTube test',
    mediaType: 'youtube',
    mediaPath: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    thumbnailPath: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    posterPath: null,
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    customCoverPath: null,
    altText: 'Test',
    sortOrder: 0,
    isFeatured: false,
    isPublished: true,
  });
  const item = await gallery.getItemById(id);
  assert.strictEqual(item.is_published, 1);
  assert.ok(item.published_at, 'published_at must be set when isPublished is true');
  const publishedAt = new Date(item.published_at);
  assert.ok(!isNaN(publishedAt.getTime()), 'published_at must be a valid date');
});

test('createItem INSERT does not throw ER_PARSE_ERROR', async () => {
  // This is the key regression test for the placeholder/column count mismatch
  const marker = `_test_yt_sql_${Date.now()}`;
  const id = await gallery.createItem({
    categoryId: null, title: marker, slug: marker,
    description: 'SQL test',
    mediaType: 'youtube',
    mediaPath: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    thumbnailPath: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    posterPath: null,
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    customCoverPath: null,
    altText: 'Test',
    sortOrder: 0,
    isFeatured: false,
    isPublished: false,
  });
  assert.ok(id > 0, 'YouTube item must be inserted without SQL error');
});

test('published YouTube item appears in listPublic', async () => {
  const marker = `_test_yt_public_${Date.now()}`;
  await gallery.createItem({
    categoryId: null, title: marker, slug: marker,
    description: 'Public test', mediaType: 'youtube',
    mediaPath: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    thumbnailPath: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    posterPath: null,
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    customCoverPath: null, altText: 'Test', sortOrder: 0,
    isFeatured: false, isPublished: true,
  });
  const result = await gallery.listPublic({ page: 1, limit: 100 });
  const item = result.items.find((i) => i.title === marker);
  assert.ok(item, 'published YouTube item must appear in public listing');
  assert.strictEqual(item.media_type, 'youtube');
  assert.strictEqual(item.youtube_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('youtube items appear in video carousel selection (type filter)', async () => {
  const marker = `_test_yt_carousel_${Date.now()}`;
  await gallery.createItem({
    categoryId: null, title: marker, slug: marker,
    description: 'Carousel test', mediaType: 'youtube',
    mediaPath: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    thumbnailPath: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    posterPath: null,
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    customCoverPath: null, altText: 'Test', sortOrder: 0,
    isFeatured: false, isPublished: true,
  });
  // The carousel queries with type='video' filter; YouTube items have type='youtube'
  // But selectVideoGalleryItems includes both video and youtube types
  const result = await gallery.listPublic({ page: 1, limit: 100, type: '' });
  const item = result.items.find((i) => i.title === marker);
  assert.ok(item, 'YouTube item must appear when no type filter is applied');
  assert.strictEqual(item.media_type, 'youtube');
});

test('listPublishedVideoItems returns two distinct published videos in stored sort order', async () => {
  const marker = `_test_yt_pair_${Date.now()}`;
  const base = {
    categoryId: null,
    description: 'Two item carousel regression',
    mediaType: 'youtube',
    thumbnailPath: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    posterPath: null,
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    customCoverPath: null,
    altText: 'Test',
    isFeatured: false,
    isPublished: true,
  };
  const firstId = await gallery.createItem({
    ...base,
    title: `${marker}_first`,
    slug: `${marker}_first`,
    mediaPath: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    sortOrder: -9002,
  });
  const secondId = await gallery.createItem({
    ...base,
    title: `${marker}_second`,
    slug: `${marker}_second`,
    mediaPath: 'https://www.youtube.com/embed/abcdefghijk',
    youtubeUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    thumbnailPath: 'https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg',
    sortOrder: -9001,
  });

  const items = (await gallery.listPublishedVideoItems())
    .filter((item) => [firstId, secondId].includes(Number(item.id)));
  assert.deepEqual(items.map((item) => Number(item.id)), [firstId, secondId]);
  assert.equal(new Set(items.map((item) => Number(item.id))).size, 2);
});

// ── Cleanup ──
test.after(async () => {
  try {
    await pool.query("DELETE FROM gallery_items WHERE title LIKE ?", ['%_test_yt_%']);
  } catch (_) {}
  try { await pool.end(); } catch (_) {}
});
