const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }

test('generic core: instance, lifecycle, cleanup, reduced-motion', () => {
  const s = read('public/js/ui/circularCarousel.mjs');
  assert.match(s, /ownedItems = items\.slice\(\)/);
  assert.match(s, /safeModulo/);
  assert.match(s, /function pause\(reason/);
  assert.match(s, /function resume\(reason/);
  assert.match(s, /function destroy\(\)/);
  assert.match(s, /cancelAnimationFrame/);
  assert.match(s, /resizeObserver\?\.disconnect/);
  assert.match(s, /intersectionObserver\?\.disconnect/);
  assert.match(s, /data-circ-carousel-generated/);
  assert.match(s, /stage\.remove\(\)/);
  assert.match(s, /reducedMotion/);
  assert.match(s, /angle\.current = angle\.target/);
  assert.match(s, /export function createCircularCarousel/);
  assert.doesNotMatch(s, /let activeInstance/);
  assert.doesNotMatch(s, /React|gsap|three/);
});

test('generic core: input handlers', () => {
  const s = read('public/js/ui/circularCarousel.mjs');
  assert.match(s, /onPointerDown/);
  assert.match(s, /onWheel/);
  assert.match(s, /onKeyDown/);
  assert.match(s, /ArrowRight/);
  assert.match(s, /ArrowLeft/);
  assert.match(s, /IntersectionObserver/);
  assert.match(s, /ResizeObserver/);
});

// ── Geometry: controlled front-facing slots ──

test('geometry: wrapped distance yields five visible desktop cards with six items', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'public/js/ui/circularCarousel.mjs')).href;
  const { wrappedDistance } = await import(moduleUrl);
  const distances = Array.from({ length: 6 }, (_, index) => wrappedDistance(index, 0, 6));
  assert.deepEqual(distances, [0, 1, 2, 3, -2, -1]);
  assert.equal(distances.filter(distance => Math.abs(distance) <= 2).length, 5);
});

test('geometry: desktop uses explicit -2..2 slots without circular projection', () => {
  const s = read('public/js/ui/circularCarousel.mjs');
  ['-2', '-1', '0', '1', '2'].forEach(distance => {
    assert.ok(s.includes(`'${distance}': Object.freeze`), `has desktop slot ${distance}`);
  });
  assert.match(s, /wrappedDistance\(i, frontIndex, totalItems\)/);
  assert.match(s, /stageWidth \* slot\.xRatio/);
  assert.doesNotMatch(s, /Math\.(?:sin|cos)\(/);
  assert.doesNotMatch(s, /radiusX|radiusY|VISIBLE_COS|cardAngle|depth/);
});

test('geometry: desktop side cards stay large and readable', () => {
  const s = read('public/js/ui/circularCarousel.mjs');
  assert.match(s, /scale: 0\.88, opacity: 0\.76/);
  assert.match(s, /scale: 0\.96, opacity: 0\.92/);
  assert.match(s, /scale: 1, opacity: 1/);
});

test('geometry: hidden cards are removed from display and accessibility tree', () => {
  const s = read('public/js/ui/circularCarousel.mjs');
  assert.match(s, /card\.style\.display = 'none'/);
  assert.match(s, /card\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(s, /card\.inert = true/);
  assert.match(s, /card\.removeAttribute\('aria-current'\)/);
  assert.match(s, /distance === 0/);
});

test('geometry: tablet and mobile use three-card slot sets', () => {
  const s = read('public/js/ui/circularCarousel.mjs');
  assert.match(s, /TABLET_SLOTS/);
  assert.match(s, /MOBILE_SLOTS/);
  assert.match(s, /viewportWidth >= 768 && viewportWidth < 1200/);
  assert.match(s, /viewportWidth <= 767/);
  assert.match(s, /tabletCardWidth = 250/);
  assert.match(s, /mobileCardHeight = 430/);
});

// ── Gallery regression ──

test('gallery regression: no service imports in renderer or modes', () => {
  const r = read('public/js/gallery/circularGalleryRenderer.mjs');
  assert.match(r, /WebGL/);
  assert.doesNotMatch(r, /servicesCarousel/);
  assert.doesNotMatch(r, /circularCarousel\.mjs/);
  const m = read('public/js/gallery/galleryModes.mjs');
  assert.match(m, /initCircularGallery/);
  assert.doesNotMatch(m, /servicesCarousel/);
  assert.doesNotMatch(m, /circularCarousel\.mjs/);
});

// ── Home panel ──

test('home panel markup: section, data attributes, valid DOM', () => {
  const h = read('views/pages/home.ejs');
  assert.match(h, /id="servicios-ninjalab"/);
  assert.match(h, /home-panel--services/);
  assert.match(h, /data-services-carousel/);
  assert.match(h, /data-svc-status/);
  assert.doesNotMatch(h, /data-svc-detail-title/);
  assert.doesNotMatch(h, /data-svc-detail-desc/);
  assert.doesNotMatch(h, /data-svc-detail-action/);
  assert.match(h, /data-svc-prev/);
  assert.match(h, /data-svc-next/);
  assert.match(h, /data-panel="3"/);
  assert.match(h, /aria-roledescription="carrusel"/);
  assert.match(h, /<h2 id="services-title"/);
  const mainEnd = h.lastIndexOf('</main>');
  const svcPos = h.indexOf('servicios-ninjalab');
  assert.ok(svcPos > 0 && svcPos < mainEnd, 'inside <main>');
});

test('services module: portrait cards, accessible CTA, and status updates', () => {
  const m = read('public/js/home/servicesCarousel.mjs');
  assert.match(m, /export const SERVICES/);
  assert.match(m, /export function initServicesCarousel/);
  assert.match(m, /createCircularCarousel/);
  assert.match(m, /instanceMap/);
  const titles = ['Diseño 3D', 'Escaneo 3D', 'Diseño Gráfico', 'Desarrollo Web', 'Prendas y Sublimación', 'Impresión 3D'];
  titles.forEach(t => assert.ok(m.includes(t), 'Has service: ' + t));
  const hrefs = m.match(/href:\s*'([^']+)'/g) || [];
  hrefs.forEach(match => {
    const href = match.replace(/href:\s*'/, '').replace(/'$/, '');
    assert.ok(href.startsWith('/'), 'href starts with /: ' + href);
    assert.ok(!href.includes('#'), 'no hash: ' + href);
  });
  assert.ok(hrefs.length >= 6);
  const ids = m.match(/id:\s*'([^']+)'/g)?.map(x => x.replace(/id:\s*'/, '').replace(/'$/, '')) || [];
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);
  assert.doesNotMatch(m, /radiusX|radiusY/);
  // Redesigned card markup: badge, title, description, CTA
  assert.match(m, /svc-card__badge/, 'has badge');
  assert.match(m, /svc-card__desc/, 'has description');
  assert.match(m, /svc-card__cta/, 'has CTA');
  assert.match(m, /VER DETALLE/, 'has CTA text');
  assert.match(m, /<a class="svc-card__cta"/, 'CTA is a real link');
  assert.doesNotMatch(m, /svc-card__cta" aria-hidden="true"/);
  assert.match(m, /data-svc-status/);
  assert.match(m, /cardWidth:\s*280/);
  assert.match(m, /cardHeight:\s*470/);
  assert.match(m, /tabletCardWidth:\s*250/);
  assert.match(m, /mobileCardHeight:\s*430/);
});

test('home.js integration: init and destroy wired', () => {
  const h = read('public/js/home/home.js');
  assert.match(h, /initServicesCarousel/);
  assert.match(h, /destroyServicesCarousel/);
  assert.match(h, /data-services-carousel/);
  assert.match(h, /destroyServicesCarousel\(\)/);
});

// ── CSS ──

test('CSS: portrait glass cards, transparent stage, and responsive sizing', () => {
  const c = read('public/css/home.css');
  assert.match(c, /home-panel--services/);
  assert.match(c, /services-carousel/);
  assert.match(c, /circ-carousel__card/);
  assert.match(c, /circ-carousel__card--active/);
  // Card redesign: badge replaces icon, description and CTA added
  assert.match(c, /svc-card__badge/, 'has badge style');
  assert.match(c, /svc-card__badge-icon/, 'has badge icon style');
  assert.match(c, /svc-card__desc/, 'has description style');
  assert.match(c, /svc-card__cta/, 'has CTA style');
  assert.match(c, /services-status/);
  assert.doesNotMatch(c, /services-detail__title|services-detail__action/);
  assert.match(c, /services-control/);
  // Backdrop blur on supporting browsers
  assert.match(c, /backdrop-filter/);
  assert.match(c, /-webkit-backdrop-filter/);
  // Responsive and motion
  assert.match(c, /@media \(max-width: 1199px\)/);
  assert.match(c, /@media \(max-width: 767px\)/);
  assert.match(c, /prefers-reduced-motion: reduce/);
  assert.match(c, /--service-card-width:\s*280px/);
  assert.match(c, /--service-card-height:\s*470px/);
  assert.match(c, /height:\s*clamp\(520px,\s*42vw,\s*570px\)/);
  assert.match(c, /background:\s*rgba\(17,\s*21,\s*19,\s*0\.68\)/);
  assert.doesNotMatch(c, /\.services-carousel\s*\{[^}]*background:/s);
});

test('accessibility: heading hierarchy, buttons, aria', () => {
  const h = read('views/pages/home.ejs');
  const h1c = (h.match(/<h1\b/g) || []).length;
  assert.equal(h1c, 1);
  assert.match(h, /aria-live="polite"/);
  assert.match(h, /role="status"/);
  assert.match(h, /type="button".*data-svc-prev/);
  assert.match(h, /type="button".*data-svc-next/);
});
