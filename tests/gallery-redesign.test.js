const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('gallery reuses the homepage navbar and removes only the requested content', () => {
  const gallery = read('views/pages/gallery.ejs');
  assert.match(gallery, /include\('\.\.\/components\/home-navbar', \{ navbarOnHome: false \}\)/);
  assert.doesNotMatch(gallery, /PROYECTOS NINJALAB|Nuestra galería|Explora algunos de los proyectos/);
  assert.match(gallery, />Explora galería</);
  assert.doesNotMatch(gallery, />Formato<|aria-label="Tipo de medio"/);

  const entry = read('public/js/gallery.js');
  assert.match(entry, /import \{ initNavbar \} from '\.\/home\/navbar\.js'/);
  assert.match(entry, /const cleanupNavbar = initNavbar\(\)/);
  assert.match(entry, /cleanupNavbar\(\)/);
});

test('default view, selected sphere, and responsive visual-zone contracts are explicit', () => {
  const validator = require('../validators/galleryValidator');
  assert.equal(validator.parsePublicFilters({}).view, 'infinite');

  const renderer = read('public/js/gallery/infiniteMenuRenderer.mjs');
  assert.match(renderer, /SPHERE_RADIUS = 4\.2/);
  assert.match(renderer, /SELECTED_DISC_SCALE = 1\.16/);
  assert.match(renderer, /sphereDiscScale\(index, selectedPointIndex, this\.sphereLayout\)/);

  const css = read('public/css/gallery.css');
  assert.match(css, /\.gallery-visual-zone__content \{[\s\S]*flex-direction: column/);
  assert.match(css, /\.gallery-primary-mode \{\s*order: 1/);
  assert.match(css, /\.gallery-visual-zone \.gallery-circular \{\s*order: 2/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.gallery-infinite \{/);
  assert.match(css, /\.gallery-infinite \{[\s\S]*background: transparent/);
  assert.match(css, /body\.page-gallery \{[\s\S]*overflow-x: hidden/);
});

test('circular carousel accepts safe video items only', async () => {
  const modes = await import(
    pathToFileURL(path.join(root, 'public/js/gallery/galleryModes.mjs')).href
  );
  const selected = modes.selectVideoGalleryItems([
    { id: 1, type: 'image', source: '/uploads/gallery/images/a.webp' },
    { id: 2, type: 'video', source: '/uploads/gallery/videos/a.mp4' },
    { id: 3, type: 'video', source: 'https://example.com/a.mp4' },
    { id: 4, type: 'video', source: '/uploads/gallery/images/not-video.mp4' },
  ]);
  assert.deepEqual(selected.map((item) => item.id), [2]);
  const source = read('public/js/gallery/galleryModes.mjs');
  assert.match(source, /createCircularRenderer\(circular\.stage, videoItems/);
  assert.doesNotMatch(source, /createCircularRenderer\(circular\.stage, items/);
});

test('homepage and gallery render the same Panel 2 background component and implementation', async () => {
  const home = read('views/pages/home.ejs');
  const gallery = read('views/pages/gallery.ejs');
  const component = read('views/components/panel2-antigravity.ejs');
  const galleryEntry = read('public/js/gallery.js');
  const homeEntry = read('public/js/home/home.js');

  assert.match(home, /include\('\.\.\/components\/panel2-antigravity'\)/);
  assert.match(gallery, /include\('\.\.\/components\/panel2-antigravity'\)/);
  assert.equal((component.match(/data-antigravity-canvas/g) || []).length, 1);
  assert.match(galleryEntry, /initAntigravityBackground/);
  assert.match(homeEntry, /initAntigravityBackground/);
  assert.doesNotMatch(galleryEntry, /TetrahedronGeometry|InstancedMesh|requestAnimationFrame\(frame\)/);

  const html = await ejs.renderFile(path.join(root, 'views/pages/gallery.ejs'), {
    site: { name: 'NinjaLab CR' },
    user: { name: 'Ada', avatar_path: null },
    cartItemCount: 2,
    cmsData: null,
    searchQuery: '',
    navbarSearchContext: '',
    filters: { category: '', type: '', view: 'infinite', page: 1, limit: 12 },
    categories: [],
    activeCategory: null,
    invalidCategory: false,
    items: [{
      id: 9,
      title: 'Video demo',
      description: '',
      category_name: 'Demo',
      media_type: 'video',
      thumbnail_path: '/uploads/gallery/thumbnails/demo.webp',
      alt_text: 'Demo',
    }],
    total: 1,
    totalPages: 1,
    page: 1,
    paginationPages: [1],
    galleryJson: '[]',
    buildGalleryUrl: () => '/galeria?view=infinite',
  });
  assert.equal((html.match(/data-home-navbar/g) || []).length, 1);
  assert.equal((html.match(/data-antigravity-canvas/g) || []).length, 1);
  assert.equal((html.match(/data-gallery-infinite/g) || []).length > 1, true);
  assert.equal((html.match(/data-gallery-video-carousel/g) || []).length, 1);
});
