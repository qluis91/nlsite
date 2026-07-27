const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(view, /type="application\/json"/);
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
  assert.match(modes, /window\.addEventListener\('pagehide'/);
  assert.match(modes, /textContent/);
  assert.match(modes, /activationGeneration/);
  assert.match(modes, /selectVideoGalleryItems\(items\)/);
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
  assert.match(renderer, /this\.container\.addEventListener\('wheel'/);
  assert.match(renderer, /this\.container\.addEventListener\('keydown'/);
  assert.match(renderer, /this\.container\.addEventListener\('pointerdown'/);
  assert.match(renderer, /this\.container\.removeEventListener\('wheel'/);
  assert.match(renderer, /this\.container\.removeEventListener\('keydown'/);
  assert.match(renderer, /document\.addEventListener\('visibilitychange'/);
  assert.match(renderer, /ResizeObserver/);
  assert.match(renderer, /IntersectionObserver/);
  assert.match(renderer, /webglcontextlost/);
  assert.match(renderer, /webglcontextrestored/);
  assert.match(renderer, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.match(renderer, /event\.preventDefault\(\)/);
  assert.match(renderer, /glTextures/);
  assert.match(renderer, /glBuffers/);
  assert.doesNotMatch(renderer, /window\.addEventListener\('wheel'|window\.addEventListener\('keydown'/);
});

test('renderer uses thumbnail-only textures, safe labels, placeholders, and the reference shader behavior', () => {
  const renderer = read('public/js/gallery/circularGalleryRenderer.mjs');
  assert.match(renderer, /item\.thumbnail/);
  assert.doesNotMatch(renderer, /item\.source|item\.poster|\.play\(\)/);
  assert.match(renderer, /Imagen no disponible/);
  assert.match(renderer, /image\.onerror = finish/);
  assert.match(renderer, /window\.setTimeout\(finish, 8000\)/);
  assert.match(renderer, /uniform float uTime/);
  assert.match(renderer, /uniform float uSpeed/);
  assert.match(renderer, /uImageSizes/);
  assert.match(renderer, /uPlaneSizes/);
  assert.match(renderer, /roundedBoxSDF/);
  assert.match(renderer, /this\.options\.bend !== 0/);
  assert.match(renderer, /bend: 0/);
  assert.doesNotMatch(renderer, /crossOrigin|https?:\/\//);
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
  const gallery = read('public/js/gallery.js');
  const modes = read('public/js/gallery/galleryModes.mjs');
  assert.match(gallery, /function openGalleryItemById\(id, origin\)/);
  assert.match(gallery, /Number\(item\.id\) === Number\(id\)/);
  assert.match(gallery, /previousFocus = origin/);
  assert.match(modes, /openGalleryItemById\(item\.id, circular\.action\)/);
  assert.match(modes, /openGalleryItemById\(activeCircularItem\.id, circular\.action\)/);
});
