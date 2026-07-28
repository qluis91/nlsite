const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const validator = require('../validators/galleryValidator');
const { buildGalleryUrl } = require('../utils/galleryUrl');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('public view values are allowlisted and gallery URLs preserve filters, view, and pagination', () => {
  assert.equal(validator.parsePublicFilters({}).view, 'infinite');
  assert.equal(validator.parsePublicFilters({ view: 'grid' }).view, 'grid');
  assert.equal(validator.parsePublicFilters({ view: 'circular' }).view, 'infinite');
  assert.equal(validator.parsePublicFilters({ view: 'ring' }).view, 'infinite');
  assert.equal(validator.parsePublicFilters({ view: '<script>' }).view, 'infinite');
  assert.equal(validator.parsePublicFilters({ view: '../../admin' }).view, 'infinite');

  assert.equal(
    buildGalleryUrl(
      { category: 'grabado', type: 'video', view: 'circular', page: 3 },
      { page: 2 }
    ),
    '/galeria?categoria=grabado&tipo=video&page=2'
  );
  assert.equal(
    buildGalleryUrl({ category: '', type: '', view: 'grid', page: 1 }),
    '/galeria?view=grid'
  );
});

test('gallery page exposes exactly two primary modes and the bounded circular companion', () => {
  const view = read('views/pages/gallery.ejs');
  assert.match(view, /data-gallery-view="grid"/);
  assert.match(view, /data-gallery-view="infinite"/);
  assert.equal((view.match(/data-gallery-view=/g) || []).length, 2);
  assert.doesNotMatch(view, /data-gallery-view="(?:circular|ring)"/);
  assert.match(view, /data-requested-view="<%= filters\.view %>"/);
  assert.match(view, /data-gallery-grid/);
  assert.match(view, /data-gallery-circular/);
  assert.match(view, /data-gallery-video-carousel/);
  assert.match(view, /role="region"/);
  assert.match(view, /tabindex="0"/);
  assert.match(view, /data-gallery-circular-action/);
  assert.match(view, /data-gallery-circular-previous/);
  assert.match(view, /data-gallery-circular-next/);
  assert.match(view, /aria-label="Video anterior"/);
  assert.match(view, /aria-label="Video siguiente"/);
  assert.match(view, /type="application\/json"/);
  assert.doesNotMatch(view, /Videos solamente/);
  assert.doesNotMatch(view, /React|ReactDOM|InfiniteMenu/);
});

test('mode coordinator has safe reduced-motion, WebGL, initialization, and context-loss fallbacks', () => {
  const modes = read('public/js/gallery/galleryModes.mjs');
  assert.match(modes, /prefers-reduced-motion: reduce/);
  assert.match(modes, /getContext\('webgl'\)/);
  assert.match(modes, /navigator\.deviceMemory/);
  assert.match(modes, /navigator\.hardwareConcurrency/);
  assert.match(modes, /'reduced-motion'/);
  assert.match(modes, /catch \(error\)/);
  assert.match(modes, /setPrimaryModeVisibility\('grid'\)/);
  assert.match(modes, /restoreGridFallback/);
  assert.match(modes, /renderer\.destroy\(\)/);
  assert.match(modes, /data-gallery-renderer-generated/);
  assert.match(modes, /listen\(window, 'pagehide'/);
  assert.match(modes, /textContent/);
  assert.match(modes, /activationGeneration/);
  assert.match(modes, /selectVideoGalleryItems\(carouselSourceItems\)/);
  assert.match(modes, /createCircularRenderer\(circular\.stage, videoItems/);
  assert.match(modes, /Todavía no hay proyectos con video disponibles/);
  assert.doesNotMatch(modes, /innerHTML|React|ReactDOM|gsap|gl-matrix/);
});

test('renderer keeps input scoped and owns a complete idempotent lifecycle', () => {
  const renderer = read('public/js/gallery/circularGalleryRenderer.mjs');
  assert.match(renderer, /destroy\(\) \{/);
  assert.match(renderer, /if \(this\.destroyed\) return/);
  assert.match(renderer, /this\.rafId = window\.requestAnimationFrame/);
  assert.match(renderer, /window\.cancelAnimationFrame\(this\.rafId\)/);
  assert.match(renderer, /this\.container\.addEventListener\('keydown'/);
  assert.match(renderer, /this\.container\.addEventListener\('pointerdown'/);
  assert.match(renderer, /this\.container\.removeEventListener\('keydown'/);
  assert.doesNotMatch(renderer, /addEventListener\('wheel'|removeEventListener\('wheel'|onWheel\(/);
  assert.doesNotMatch(renderer, /wheelTimer/);
  assert.match(renderer, /document\.addEventListener\('visibilitychange'/);
  assert.match(renderer, /ResizeObserver/);
  assert.match(renderer, /IntersectionObserver/);
  assert.match(renderer, /webglcontextlost/);
  assert.match(renderer, /webglcontextrestored/);
  assert.match(renderer, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.match(renderer, /glTextures/);
  assert.match(renderer, /glBuffers/);
  assert.doesNotMatch(renderer, /window\.addEventListener\('wheel'|window\.addEventListener\('keydown'/);
});

test('renderer uses thumbnail-only textures, fallback images, and the reference shader behavior', () => {
  const renderer = read('public/js/gallery/circularGalleryRenderer.mjs');
  assert.match(renderer, /item\.thumbnail/);
  assert.doesNotMatch(renderer, /item\.source|item\.poster|\.play\(\)/);
  assert.match(renderer, /gallery-video-placeholder\.svg/);
  assert.match(renderer, /thumbnailFallbacks/);
  assert.match(renderer, /tryCandidate\(candidateIndex \+ 1\)/);
  assert.match(renderer, /window\.setTimeout\(finish, 8000\)/);
  assert.match(renderer, /uniform float uTime/);
  assert.match(renderer, /uniform float uSpeed/);
  assert.match(renderer, /uImageSizes/);
  assert.match(renderer, /uPlaneSizes/);
  assert.match(renderer, /roundedBoxSDF/);
  assert.match(renderer, /this\.options\.bend !== 0/);
  assert.match(renderer, /bend: 0/);
  assert.match(renderer, /crossOrigin = 'anonymous'/);
  assert.doesNotMatch(renderer, /fillText|createLabelCanvas|labelProgram|LABEL_FRAGMENT_SHADER/);
});

test('WebGL thumbnails keep source orientation and use a centered aspect-ratio crop', () => {
  const renderer = read('public/js/gallery/circularGalleryRenderer.mjs');
  assert.match(renderer, /UNPACK_FLIP_Y_WEBGL, false/);
  assert.doesNotMatch(renderer, /UNPACK_FLIP_Y_WEBGL, true/);
  assert.match(renderer, /vUv = aUv/);
  assert.match(renderer, /vec2 uv = vUv \* ratio \+ \(1\.0 - ratio\) \* 0\.5/);
  assert.doesNotMatch(renderer, /scaleX\(-1\)|scaleY\(-1\)|rotate[XYZ]?\(/);
});

test('arrow stepping moves exactly one item and preserves circular wrapping coordinates', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'public/js/gallery/circularGalleryRenderer.mjs')).href;
  const { CircularGalleryRenderer } = await import(`${moduleUrl}?step=${Date.now()}`);
  const calls = [];
  const state = {
    spacing: 300,
    items: [{}, {}, {}],
    scroll: { target: 18 },
    updateActive: () => calls.push('active'),
    pauseAutoplayBriefly: () => calls.push('pause'),
    schedule: () => calls.push('schedule'),
  };
  CircularGalleryRenderer.prototype.step.call(state, 1);
  assert.equal(state.scroll.target, 300);
  CircularGalleryRenderer.prototype.step.call(state, -1);
  assert.equal(state.scroll.target, 0);
  assert.deepEqual(calls, ['active', 'pause', 'schedule', 'active', 'pause', 'schedule']);
});

test('autoplay advances slowly, pauses by reason, and is disabled for one item or reduced motion', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'public/js/gallery/circularGalleryRenderer.mjs')).href;
  const { CircularGalleryRenderer, advanceAutoplayTarget } = await import(
    `${moduleUrl}?autoplay=${Date.now()}`
  );
  assert.equal(advanceAutoplayTarget(0, 320, 1000, 32000), 10);
  assert.equal(advanceAutoplayTarget(75, 320, 0, 32000), 75);

  const canAutoplay = CircularGalleryRenderer.prototype.canAutoplay;
  assert.equal(canAutoplay.call({
    options: { autoplay: true },
    items: [{}, {}],
    autoplayPauseReasons: new Set(),
  }), true);
  assert.equal(canAutoplay.call({
    options: { autoplay: true },
    items: [{}, {}],
    autoplayPauseReasons: new Set(['hover']),
  }), false);
  assert.equal(canAutoplay.call({
    options: { autoplay: false },
    items: [{}, {}],
    autoplayPauseReasons: new Set(),
  }), false);
  assert.equal(canAutoplay.call({
    options: { autoplay: true },
    items: [{}],
    autoplayPauseReasons: new Set(),
  }), false);

  const modes = read('public/js/gallery/galleryModes.mjs');
  assert.match(modes, /autoplay: !prefersReducedMotion\(\)/);
});

test('autoplay lifecycle pauses for hover, focus, drag, and the open viewer without duplicate loops', () => {
  const renderer = read('public/js/gallery/circularGalleryRenderer.mjs');
  const modes = read('public/js/gallery/galleryModes.mjs');
  assert.match(renderer, /pauseAutoplay\('hover'\)/);
  assert.match(renderer, /resumeAutoplay\('hover'\)/);
  assert.match(renderer, /pauseAutoplay\('focus'\)/);
  assert.match(renderer, /resumeAutoplay\('focus'\)/);
  assert.match(renderer, /pauseAutoplay\('drag'\)/);
  assert.match(renderer, /resumeAutoplay\('drag'\)/);
  assert.match(renderer, /this\.rafId !== null/);
  assert.match(renderer, /removeEventListener\('mouseenter'/);
  assert.match(renderer, /removeEventListener\('focusin'/);
  assert.match(modes, /pauseAutoplay\('viewer'\)/);
  assert.match(modes, /resumeAutoplay\('viewer'\)/);
  assert.match(modes, /viewerObserver\?\.disconnect\(\)/);
});

test('video selection preserves order and two distinct stable IDs even when content matches', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'public/js/gallery/galleryModes.mjs')).href;
  const { selectVideoGalleryItems } = await import(`${moduleUrl}?selection=${Date.now()}`);
  const shared = {
    type: 'youtube',
    title: 'Mismo título',
    source: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    thumbnail: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  };
  const selected = selectVideoGalleryItems([
    { ...shared, id: 401 },
    { ...shared, id: 402 },
  ]);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map((item) => item.id), [401, 402]);
  assert.deepEqual(selected.map((item) => item.key), ['gallery:401', 'gallery:402']);
});

test('one-item, two-item, and many-item circular layouts keep unique visible positions', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'public/js/gallery/circularGalleryRenderer.mjs')).href;
  const { calculateCarouselPositions } = await import(`${moduleUrl}?layout=${Date.now()}`);

  assert.deepEqual(calculateCarouselPositions(0, 300, 0, 1000), []);
  assert.deepEqual(calculateCarouselPositions(1, 300, 0, 1000), [{ index: 0, x: 500 }]);

  const pair = calculateCarouselPositions(2, 300, 0, 1000);
  assert.deepEqual(pair, [{ index: 0, x: 350 }, { index: 1, x: 650 }]);
  assert.equal(new Set(pair.map(({ x }) => x)).size, 2);
  assert.deepEqual(
    calculateCarouselPositions(2, 300, 300, 1000),
    [{ index: 0, x: 650 }, { index: 1, x: 350 }]
  );

  const many = calculateCarouselPositions(5, 180, 0, 1000);
  assert.equal(many.length, 5);
  assert.equal(new Set(many.map(({ x }) => x)).size, 5);
});

test('circular renderer accepts only canonical thumbnail candidates in fallback order', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'public/js/gallery/circularGalleryRenderer.mjs')).href;
  const { thumbnailCandidates } = await import(`${moduleUrl}?thumbnails=${Date.now()}`);
  assert.deepEqual(thumbnailCandidates({
    thumbnail: '/uploads/gallery/thumbnails/custom.webp',
    thumbnailFallbacks: [
      'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
      'https://example.com/untrusted.jpg',
    ],
  }), [
    '/uploads/gallery/thumbnails/custom.webp',
    'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    '/images/gallery-video-placeholder.svg',
  ]);
});

test('3D carousel keeps title and type metadata only in the front-facing DOM overlay', () => {
  const renderer = read('public/js/gallery/circularGalleryRenderer.mjs');
  const modes = read('public/js/gallery/galleryModes.mjs');
  const view = read('views/pages/gallery.ejs');
  assert.doesNotMatch(renderer, /fillText|createLabelCanvas|labelProgram|LABEL_FRAGMENT_SHADER/);
  assert.match(modes, /circular\.title\.textContent/);
  assert.match(modes, /item\.type === 'youtube' \? 'YouTube' : 'Video'/);
  assert.match(view, /data-gallery-circular-title/);
  assert.match(view, /data-gallery-circular-action/);
});

test('carousel data is separate from paginated gallery data and has a clear zero-item state', () => {
  const controller = read('controllers/galleryController.js');
  const service = read('services/galleryService.js');
  const page = read('views/pages/gallery.ejs');
  const browser = read('public/js/gallery.js');
  const modes = read('public/js/gallery/galleryModes.mjs');

  assert.match(controller, /listPublishedVideoItems\(\)/);
  assert.match(controller, /videoGalleryJson/);
  assert.match(service, /media_type IN \('video', 'youtube'\)/);
  assert.match(service, /ORDER BY i\.is_featured DESC, i\.sort_order ASC, i\.published_at DESC, i\.id DESC/);
  assert.doesNotMatch(
    service.slice(service.indexOf('async function listPublishedVideoItems')),
    /LIMIT \? OFFSET \?/
  );
  assert.match(page, /id="gallery-video-data"/);
  assert.match(browser, /videoItems: videoItems\.slice\(\)/);
  assert.match(modes, /Todavía no hay proyectos con video disponibles/);
});

test('circular styles are namespaced and preserve vertical touch scrolling', () => {
  const css = read('public/css/gallery.css');
  assert.match(css, /\.gallery-circular \{/);
  assert.match(css, /touch-action: pan-y/);
  assert.match(css, /height: clamp\(28rem, 65vh, 44rem\)/);
  assert.match(css, /\.gallery-circular__canvas/);
  assert.match(css, /\.gallery-view-switcher/);
  assert.doesNotMatch(css, /html,\s*\nbody\s*\{\s*overflow:\s*hidden/);
  assert.doesNotMatch(css, /(?:^|\n)div\s*\{/);
});

test('the circular action reuses the Phase 1 modal by stable item ID and restores focus there', () => {
  const gallery = read('public/js/gallery/galleryViewer.mjs');
  const modes = read('public/js/gallery/galleryModes.mjs');
  assert.match(gallery, /function openGalleryItemById\(id, origin\)/);
  assert.match(gallery, /Number\(item\.id\) === Number\(id\)/);
  assert.match(gallery, /previousFocus = origin/);
  assert.match(modes, /openGalleryItemById\(item\.id, circular\.action\)/);
  assert.match(modes, /openGalleryItemById\(activeCircularItem\.id, circular\.action\)/);
});
