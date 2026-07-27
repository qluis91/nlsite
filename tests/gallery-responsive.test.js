const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function galleryLocals(overrides = {}) {
  return {
    site: { name: 'NinjaLab CR' },
    user: null,
    cartItemCount: 0,
    cmsData: null,
    searchQuery: '',
    navbarSearchContext: '',
    filters: { category: 'escultura', type: '', view: 'infinite', page: 1, limit: 12 },
    categories: [
      { slug: 'impresion-3d', name: 'Impresión 3D' },
      { slug: 'escultura', name: 'Escultura' },
    ],
    activeCategory: { slug: 'escultura', name: 'Escultura' },
    invalidCategory: false,
    items: [],
    total: 0,
    totalPages: 1,
    page: 1,
    paginationPages: [1],
    galleryJson: '[]',
    buildGalleryUrl: (next = {}) => {
      const category = Object.hasOwn(next, 'category') ? next.category : 'escultura';
      const view = next.view || 'infinite';
      const params = new URLSearchParams();
      if (category) params.set('categoria', category);
      params.set('view', view);
      return `/galeria?${params}`;
    },
    ...overrides,
  };
}

function projectPoint(point, layout, width, height, renderer, matrix) {
  const camera = renderer.createCameraMatrices(width, height, layout);
  const viewProjection = matrix.mat4.multiply(
    matrix.mat4.create(),
    camera.projection,
    camera.view
  );
  const positioned = renderer.positionSpherePoint(point, layout);
  const clip = matrix.vec4.transformMat4(
    matrix.vec4.create(),
    [positioned[0], positioned[1], positioned[2], 1],
    viewProjection
  );
  return {
    x: clip[0] / clip[3],
    y: clip[1] / clip[3],
    depth: clip[3],
  };
}

test('mobile/tablet category select mirrors desktop chips and preserves query fields', async () => {
  const html = await ejs.renderFile(
    path.join(root, 'views/pages/gallery.ejs'),
    galleryLocals()
  );
  assert.match(html, /gallery-category-chips/);
  assert.match(html, /class="gallery-category-select"[^>]*method="get"/);
  assert.match(html, /label for="gallery-category-select">Categoría</);
  assert.match(html, /select id="gallery-category-select" name="categoria"/);
  assert.match(html, /option value=""[^>]*>Todos</);
  assert.match(html, /option value="escultura" selected>Escultura</);
  assert.match(html, /input type="hidden" name="view" value="infinite"/);

  const css = read('public/css/gallery.css');
  assert.match(css, /\.gallery-category-select \{\s*display: none;/);
  assert.match(
    css,
    /@media \(max-width: 1023px\)[\s\S]*?\.gallery-category-chips \{\s*display: none;[\s\S]*?\.gallery-category-select \{\s*display: grid;/
  );
  const entry = read('public/js/gallery.js');
  assert.match(entry, /categorySelect\?\.addEventListener\('change', onCategoryChange\)/);
  assert.match(entry, /categoryForm\.requestSubmit\(\)/);
  assert.match(entry, /categorySelect\?\.removeEventListener\('change', onCategoryChange\)/);
});

test('Infinite mobile/tablet geometry uses safe framing, smaller discs, and less overlap', async () => {
  const renderer = await import(
    pathToFileURL(path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs')).href
  );
  const matrix = await import(
    pathToFileURL(path.join(root, 'public/vendor/gl-matrix/index.js')).href
  );
  const points = renderer.createSpherePoints();

  for (const [width, height] of [
    [390, 700],
    [667, 375],
    [768, 1024],
    [900, 700],
  ]) {
    const layout = renderer.resolveSphereLayout(width, height);
    assert.ok(layout.spreadX > layout.spreadY, `${width}x${height} should favor X spread`);
    assert.ok(layout.discScale < 0.68);
    assert.ok(layout.selectedDiscScale > layout.discScale * 1.6);
    const projected = points.map((point) => projectPoint(
      point,
      layout,
      width,
      height,
      renderer,
      matrix
    ));
    assert.ok(Math.max(...projected.map((point) => Math.abs(point.x))) < layout.frameMargin);
    assert.ok(Math.max(...projected.map((point) => Math.abs(point.y))) < layout.frameMargin);

    const nearestDistances = [];
    projected.forEach((point, index) => {
      projected.slice(index + 1).forEach((other) => {
        nearestDistances.push(Math.hypot(
          (point.x - other.x) * width * 0.5,
          (point.y - other.y) * height * 0.5
        ));
      });
    });
    const responsiveDiameter = layout.discScale
      * height / ((layout.cameraDistance - layout.spreadZ) * Math.tan(Math.PI / 6));
    const desktopDiscDiameter = 0.68
      * height / ((layout.cameraDistance - layout.spreadZ) * Math.tan(Math.PI / 6));
    const responsiveOverlaps = nearestDistances.filter(
      (distance) => distance < responsiveDiameter
    ).length;
    const desktopScaleOverlaps = nearestDistances.filter(
      (distance) => distance < desktopDiscDiameter
    ).length;
    assert.ok(responsiveOverlaps < desktopScaleOverlaps);
  }
});

test('responsive information card starts below the selected sphere primary area', async () => {
  const renderer = await import(
    pathToFileURL(path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs')).href
  );
  const matrix = await import(
    pathToFileURL(path.join(root, 'public/vendor/gl-matrix/index.js')).href
  );

  for (const [width, height] of [[390, 700], [667, 375], [768, 1024]]) {
    const layout = renderer.resolveSphereLayout(width, height);
    const activeCenter = projectPoint(
      [0, 0, 4.2],
      layout,
      width,
      height,
      renderer,
      matrix
    );
    const centerFromTop = 0.5 - activeCenter.y * 0.5;
    const selectedRadius = layout.selectedDiscScale
      / ((layout.cameraDistance - layout.spreadZ) * Math.tan(Math.PI / 6))
      * 0.5;
    assert.ok(centerFromTop + selectedRadius < layout.infoCardStartRatio);
  }

  const css = read('public/css/gallery.css');
  assert.match(css, /top: var\(--infinite-info-start, 72%\)/);
  assert.match(css, /max-height: calc\(28% - 0\.75rem\)/);
});

test('Grid columns are one on narrow phones, two where space permits, and unchanged on desktop', () => {
  const css = read('public/css/gallery.css');
  assert.match(
    css,
    /\.gallery-grid \{\s*display: grid;\s*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 17rem\), 1fr\)\)/
  );
  assert.match(
    css,
    /@media \(max-width: 519px\) \{\s*\.gallery-grid \{\s*grid-template-columns: minmax\(0, 1fr\)/
  );
  assert.match(
    css,
    /@media \(min-width: 761px\) and \(max-width: 1023px\) \{[\s\S]*?\.gallery-grid \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.gallery-card__title \{[\s\S]*?white-space: normal;/);
});

test('desktop Infinite geometry remains unchanged while responsive breakpoints stay explicit', async () => {
  const renderer = await import(
    pathToFileURL(path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs')).href
  );
  const desktop = renderer.resolveSphereLayout(1440, 800);
  assert.equal(desktop.spreadX, 5.9535);
  assert.equal(desktop.spreadY, 3.15);
  assert.equal(desktop.spreadZ, 3.05);
  assert.equal(desktop.discScale, 0.68);
  assert.equal(desktop.selectedDiscScale, 1.16);
  assert.equal(desktop.centerOffsetY, 0);
  assert.equal(desktop.infoCardStartRatio, null);

  const source = read('public/js/gallery/infiniteMenuRenderer.mjs');
  assert.match(source, /MOBILE_LAYOUT_MAX = 639/);
  assert.match(source, /TABLET_LAYOUT_MAX = 1023/);
  assert.match(source, /window\.addEventListener\('orientationchange', this\.resize\)/);
  assert.match(source, /query\.addEventListener\?\.\('change', this\.resize\)/);
});
