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

test('view=infinite is allowlisted and preserved by gallery URLs', () => {
  assert.equal(validator.parsePublicFilters({ view: 'infinite' }).view, 'infinite');
  assert.equal(validator.parsePublicFilters({ view: '<script>' }).view, 'infinite');
  assert.equal(
    buildGalleryUrl({ category: 'demo', view: 'infinite', page: 2 }),
    '/galeria?categoria=demo&view=infinite&page=2'
  );
});

test('gallery page exposes the existing Infinite stage and shared action contract', () => {
  const view = read('views/pages/gallery.ejs');
  for (const marker of [
    'data-gallery-view="infinite"',
    'data-gallery-infinite',
    'data-gallery-infinite-canvas',
    'data-gallery-infinite-loader',
    'data-gallery-infinite-overlay',
    'data-gallery-infinite-title',
    'data-gallery-infinite-meta',
    'data-gallery-infinite-action',
    'data-gallery-infinite-fallback',
    'data-gallery-infinite-live',
  ]) {
    assert.equal(view.includes(marker), true, marker);
  }
  assert.match(view, /role="region"/);
  assert.match(view, /tabindex="0"/);
  assert.match(view, /aria-live="polite"/);
});

test('Infinite CSS remains contained and does not touch responsive navigation', () => {
  const css = read('public/css/gallery.css');
  assert.match(css, /\.gallery-infinite \{/);
  assert.match(css, /height: clamp\(38rem, 78vh, 56rem\)/);
  assert.match(css, /overflow: hidden/);
  assert.match(css, /\.gallery-infinite__canvas \{[\s\S]*position: absolute;[\s\S]*inset: 0;[\s\S]*width: 100%;[\s\S]*height: 100%;/);
  assert.match(css, /touch-action: none/);
  assert.doesNotMatch(css, /html,\s*\nbody\s*\{\s*overflow:\s*hidden/);
  const navbar = read('public/js/home/navbar.js');
  assert.doesNotMatch(navbar, /InfiniteMenuRenderer|gallery-infinite/);
});

test('mode manager preserves the renderer constructor/ready/destroy contract', () => {
  const modes = read('public/js/gallery/galleryModes.mjs');
  assert.match(modes, /new InfiniteMenuRenderer\(stage, rendererItems, options\)/);
  assert.match(modes, /createInfiniteRenderer\(infinite\.stage, items/);
  assert.match(modes, /await candidate\.ready/);
  assert.match(modes, /candidate\.destroy\(\)/);
  assert.match(modes, /activeRenderer = candidate/);
  assert.match(modes, /openGalleryItemById\(item\.id, infinite\.action\)/);
  assert.match(modes, /data-gallery-renderer-generated/);
  assert.match(modes, /getContext\('webgl2'/);
  assert.match(modes, /MAX_TEXTURE_SIZE/);
  assert.match(modes, /MAX_VERTEX_ATTRIBS/);
});

test('active renderer is a clean implementation and the broken renderer is isolated', () => {
  const source = read('public/js/gallery/infiniteMenuRenderer.mjs');
  const legacy = read('public/js/gallery/infiniteMenuRenderer.legacy.mjs');
  assert.match(source, /export class InfiniteMenuRenderer/);
  assert.match(source, /constructor\(container, items, options = \{\}\)/);
  assert.match(source, /this\.ready = this\.init\(\)/);
  assert.match(source, /mat4\.lookAt\(view, cameraPosition, CAMERA_TARGET, WORLD_UP\)/);
  assert.doesNotMatch(source, /mat4\.targetTo/);
  assert.match(legacy, /mat4\.targetTo\(viewMat, camPos/);
  assert.doesNotMatch(
    read('public/js/gallery/galleryModes.mjs'),
    /infiniteMenuRenderer\.legacy/
  );
});

test('minimal WebGL 2 pipeline has explicit attributes, VAO, EBO, and instancing', () => {
  const source = read('public/js/gallery/infiniteMenuRenderer.mjs');
  assert.match(source, /#version 300 es/);
  assert.match(source, /layout\(location = 0\) in vec3 aPosition/);
  assert.match(source, /layout\(location = 1\) in vec2 aUv/);
  assert.match(source, /layout\(location = 3\) in mat4 aInstanceMatrix/);
  assert.match(source, /uniform mat4 uView/);
  assert.match(source, /uniform mat4 uProjection/);
  assert.match(source, /createDiscGeometry/);
  assert.match(source, /new Uint16Array/);
  assert.match(source, /gl\.bindBuffer\(gl\.ELEMENT_ARRAY_BUFFER, this\.indexBuffer\)/);
  assert.match(source, /gl\.vertexAttribDivisor\(location, 1\)/);
  assert.match(source, /gl\.bindVertexArray\(this\.vao\)/);
  assert.match(source, /gl\.drawElementsInstanced/);
  assert.match(source, /gl\.UNSIGNED_SHORT/);
});

test('sphere, billboard, and camera math follows the independently tested path', () => {
  const source = read('public/js/gallery/infiniteMenuRenderer.mjs');
  assert.match(source, /function createSpherePoints/);
  assert.match(source, /SPHERE_POINT_COUNT = 42/);
  assert.match(source, /SPHERE_RADIUS = 4\.2/);
  assert.match(source, /function resolveSphereLayout/);
  assert.match(source, /function positionSpherePoint/);
  assert.match(source, /spreadX = spreadY \* horizontalRatio/);
  assert.match(source, /safeWidth <= MOBILE_LAYOUT_MAX/);
  assert.match(source, /safeWidth <= TABLET_LAYOUT_MAX/);
  assert.match(source, /SELECTED_DISC_SCALE = 1\.16/);
  assert.match(source, /sphereDiscScale\(index, selectedPointIndex, this\.sphereLayout\)/);
  assert.match(source, /function createTranslationMatrix/);
  assert.match(source, /function createBillboardMatrix/);
  assert.match(source, /vec3\.subtract\(vec3\.create\(\), cameraPosition, position\)/);
  assert.match(source, /vec3\.cross\(vec3\.create\(\), referenceUp, toCamera\)/);
  assert.match(source, /WORLD_UP/);
  assert.match(source, /ALT_UP/);
  assert.match(source, /vec3\.transformQuat\(rotated, this\.spherePoints\[index\], this\.orientation\)/);
});

test('arcball, inertia, snapping, and active item use quaternion/sphere math', () => {
  const source = read('public/js/gallery/infiniteMenuRenderer.mjs');
  assert.match(source, /function rotateOrientation/);
  assert.match(source, /deltaY \* sensitivity/);
  assert.match(source, /-deltaX \* sensitivity/);
  assert.match(source, /quat\.normalize/);
  assert.match(source, /function decayAngularVelocity/);
  assert.match(source, /applyInertia\(elapsedMs\)/);
  assert.match(source, /beginSnap\(\)/);
  assert.match(source, /quat\.rotationTo/);
  assert.match(source, /quat\.slerp/);
  assert.match(source, /closestFrontPointIndex/);
  assert.match(source, /pointIndex % this\.items\.length/);
  assert.doesNotMatch(source, /scroll\.current|scroll\.target|translateX/);
});

test('atlas is bounded, same-origin, thumbnail-only, and uploads on texture unit zero', () => {
  const source = read('public/js/gallery/infiniteMenuRenderer.mjs');
  assert.match(source, /SAFE_THUMBNAIL/);
  assert.match(source, /\/uploads\\\/gallery\\\/thumbnails/);
  assert.match(source, /createAtlasLayout/);
  assert.match(source, /Math\.ceil\(Math\.sqrt\(count\)\)/);
  assert.match(source, /drawPlaceholder/);
  assert.match(source, /image\.onload/);
  assert.match(source, /image\.onerror/);
  assert.match(source, /IMAGE_TIMEOUT_MS/);
  assert.match(source, /gl\.pixelStorei\(gl\.UNPACK_FLIP_Y_WEBGL, true\)/);
  assert.match(source, /gl\.activeTexture\(gl\.TEXTURE0\)/);
  assert.match(source, /gl\.uniform1i\(this\.uniforms\.atlas, 0\)/);
  assert.match(source, /flat out int vInstanceId/);
  assert.match(source, /flat in int vInstanceId/);
  assert.doesNotMatch(source, /item\.source|item\.poster|crossOrigin|https?:\/\//);
});

test('final shader masks discs and production defaults to textured output', () => {
  const source = read('public/js/gallery/infiniteMenuRenderer.mjs');
  assert.match(source, /float radius = length\(centered\)/);
  assert.match(source, /if \(radius > 1\.0\)/);
  assert.match(source, /smoothstep\(0\.9, 1\.0, radius\)/);
  assert.match(source, /gl\.enable\(gl\.DEPTH_TEST\)/);
  assert.match(source, /gl\.enable\(gl\.BLEND\)/);
  assert.match(source, /gl\.blendFunc\(gl\.SRC_ALPHA, gl\.ONE_MINUS_SRC_ALPHA\)/);
  assert.match(source, /diagnosticStage: ''/);
  assert.match(source, /this\.options\.diagnosticStage \? 1 : 0/);
});

test('input and lifecycle are scoped, idle, observable, and idempotent', () => {
  const source = read('public/js/gallery/infiniteMenuRenderer.mjs');
  for (const event of [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'lostpointercapture',
  ]) {
    assert.equal(source.includes(`this.canvas.addEventListener('${event}'`), true, `add ${event}`);
    assert.equal(source.includes(`this.canvas.removeEventListener('${event}'`), true, `remove ${event}`);
  }
  assert.match(source, /setPointerCapture/);
  assert.match(source, /releasePointerCapture/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /webglcontextlost/);
  assert.match(source, /if \(this\.destroyed\) return/);
  assert.match(source, /cancelImages\(\)/);
  assert.match(source, /this\.resizeObserver\?\.disconnect/);
  assert.match(source, /this\.intersectionObserver\?\.disconnect/);
  assert.match(source, /data-gallery-renderer-generated/);
  assert.doesNotMatch(source, /gl\.isTexture/);
  assert.doesNotMatch(source, /window\.addEventListener\('pointer|window\.addEventListener\('keydown/);
});

test('safe DOM and dependency boundaries remain intact', () => {
  const source = read('public/js/gallery/infiniteMenuRenderer.mjs');
  assert.match(source, /title\.textContent/);
  assert.match(source, /meta\.textContent/);
  assert.doesNotMatch(source, /innerHTML|React|ReactDOM|THREE|OGL|GSAP/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies['gl-matrix'], '3.4.3');
  assert.equal(fs.existsSync(path.join(root, 'public/vendor/gl-matrix/index.js')), true);
  assert.equal(
    JSON.parse(read('public/vendor/gl-matrix/package.json')).version,
    '3.4.3'
  );
});
