const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('ring geometry and dataset normalization remain finite for one, two, and many items', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'public/js/gallery/ringGalleryRenderer.mjs')).href;
  const {
    normalizeRingItems,
    calculateRingGeometry,
    closestRingIndex,
  } = await import(moduleUrl);
  assert.deepEqual(normalizeRingItems([]), []);
  assert.equal(normalizeRingItems([{ id: 1 }]).length, 1);
  const two = normalizeRingItems([{ id: 1 }, { id: 2 }]);
  assert.equal(two.length, 4);
  assert.deepEqual(two.map((entry) => entry.originalIndex), [0, 1, 0, 1]);
  assert.equal(normalizeRingItems(Array.from({ length: 24 }, (_, id) => ({ id }))).length, 24);
  for (const count of [1, 2, 3, 12, 24]) {
    const geometry = calculateRingGeometry(240, count === 2 ? 4 : count);
    assert.equal(Number.isFinite(geometry.angleStep), true);
    assert.equal(Number.isFinite(geometry.radius), true);
    assert.ok(geometry.radius >= 0 && geometry.radius <= 1400);
  }
  assert.equal(closestRingIndex(0, 8), 0);
  assert.equal(closestRingIndex(-45, 8), 1);
  assert.equal(closestRingIndex(360, 8), 0);
});

test('RingGalleryRenderer owns scoped input, idle RAF, pause, resume, and idempotent cleanup', () => {
  const source = read('public/js/gallery/ringGalleryRenderer.mjs');
  assert.match(source, /export class RingGalleryRenderer/);
  assert.match(source, /constructor\(container, items, options = \{\}\)/);
  assert.match(source, /destroy\(\) \{/);
  assert.match(source, /if \(this\.destroyed\) return/);
  assert.match(source, /this\.rafId = window\.requestAnimationFrame\(this\.frame\)/);
  assert.match(source, /window\.cancelAnimationFrame\(this\.rafId\)/);
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'wheel', 'keydown']) {
    assert.equal(source.includes(`this.container.addEventListener('${event}'`), true, `add ${event}`);
    assert.equal(source.includes(`this.container.removeEventListener('${event}'`), true, `remove ${event}`);
  }
  assert.doesNotMatch(source, /window\.addEventListener\('(?:pointer|wheel|keydown)/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /releasePointerCapture/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /resizeObserver\?\.disconnect/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /intersectionObserver\?\.disconnect/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /document\.removeEventListener\('visibilitychange'/);
  assert.match(source, /if \(moving \|\| this\.pointer\.active \|\| this\.snapTarget !== null\) this\.schedule\(\)/);
});

test('ring interaction includes velocity smoothing, delta-time inertia, snapping, and click suppression', () => {
  const source = read('public/js/gallery/ringGalleryRenderer.mjs');
  assert.match(source, /this\.pointer\.distance < 7/);
  assert.match(source, /instantaneousVelocity/);
  assert.match(source, /clamp\(instantaneousVelocity, -0\.8, 0\.8\)/);
  assert.match(source, /Math\.pow\(this\.options\.friction, elapsed \/ 16\.67\)/);
  assert.match(source, /Math\.round\(this\.rotation \/ this\.angleStep\) \* this\.angleStep/);
  assert.match(source, /event\.key === 'ArrowRight'/);
  assert.match(source, /event\.key === 'ArrowLeft'/);
  assert.match(source, /event\.key === 'Home'/);
  assert.match(source, /event\.key === 'End'/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
});

test('ring cards use safe DOM APIs and thumbnail-only same-origin paths', () => {
  const source = read('public/js/gallery/ringGalleryRenderer.mjs');
  assert.match(source, /document\.createElement\('div'\)/);
  assert.match(source, /document\.createElement\('img'\)/);
  assert.match(source, /item\.thumbnail/);
  assert.match(source, /SAFE_THUMBNAIL\.test/);
  assert.match(source, /textContent = 'Video'/);
  assert.doesNotMatch(source, /innerHTML|item\.source|item\.poster|https?:\/\//);
  assert.doesNotMatch(source, /\bgsap\b|Draggable|React|ReactDOM|WebGL|THREE|ogl/);
});

test('removed ring mode is isolated from the public gallery lifecycle', () => {
  const modes = read('public/js/gallery/galleryModes.mjs');
  assert.match(modes, /function destroyActiveRenderer\(\)/);
  assert.match(modes, /renderer\.destroy\(\)/);
  assert.match(modes, /function activateMode\(requestedMode\)/);
  assert.doesNotMatch(modes, /RingGalleryRenderer|ringGalleryRenderer|data-gallery-ring/);
  assert.doesNotMatch(modes, /mode === 'circular'|mode === 'ring'/);
  assert.doesNotMatch(modes, /innerHTML/);
});

test('removed ring mode has no public markup or selector control', () => {
  const view = read('views/pages/gallery.ejs');
  assert.doesNotMatch(view, /data-gallery-view="ring"/);
  assert.doesNotMatch(view, /data-gallery-ring/);
  assert.doesNotMatch(view, /gallery-ring-hint/);
});
