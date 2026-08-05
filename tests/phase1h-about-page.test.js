const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const {
  safeUrl,
  validateAboutPage,
} = require('../controllers/adminAboutPageController');
const { safePublicUrl } = require('../controllers/aboutController');
const { CAPABILITIES, hasCapability } = require('../config/capabilities');
const registry = require('../services/moduleRegistry');
const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function validBody(overrides = {}) {
  const body = {
    heroEyebrow: 'NinjaLab',
    heroTitle: 'Nosotros',
    heroDescription: 'Descripción',
    isVisible: '1',
    ctaHeading: 'Contacto',
    ctaText: 'Texto',
    ctaLabel: 'Contactar',
    ctaUrl: '/#contacto',
    ctaTarget: '_self',
    ctaVisible: '1',
    seoTitle: 'Nosotros | NinjaLab',
    seoDescription: 'Descripción SEO',
    seoCanonical: '/nosotros',
    ariaLabel: 'Página Nosotros',
  };
  for (const [index, key] of ['history', 'mission', 'capabilities', 'values', 'process'].entries()) {
    body[`section_${key}_heading`] = key;
    body[`section_${key}_text`] = `Texto ${key}`;
    body[`section_${key}_visible`] = '1';
    body[`section_${key}_order`] = String((index + 1) * 10);
  }
  return { ...body, ...overrides };
}

describe('Phase 1H — Página Nosotros contracts', () => {
  test('public route, desktop/mobile navbar and active state are wired', () => {
    const app = read('app.js');
    const heroNavbar = read('views/components/home-navbar.ejs');
    const standardNavbar = read('views/components/navbar.ejs');
    assert.match(app, /app\.use\('\/nosotros', aboutRoutes\)/);
    for (const navbar of [heroNavbar, standardNavbar]) {
      assert.match(navbar, /href="\/nosotros"/);
      assert.match(navbar, /aria-current="page"/);
    }
    assert.match(heroNavbar, /navbarCurrentPath\.startsWith\('\/nosotros'\)/);
  });

  test('admin editor exposes all required sections, media, SEO and separate sticky actions', () => {
    const view = read('views/pages/admin/page/about.ejs');
    const seededContent = read('scripts/migrate-about-page-cms.js');
    for (const token of ['Hero', 'Historia', 'Misión', 'Servicios', 'Valores', 'Proceso', 'CTA final']) {
      assert.match(`${view}\n${seededContent}`, new RegExp(token, 'i'));
    }
    assert.match(view, /data-cms-editor-form/);
    assert.match(view, /data-cms-publish-form/);
    assert.match(view, /Guardar cambios/);
    assert.match(view, />Publicar</);
    assert.match(view, /sticky-actions/);
    assert.match(view, /media-selector/);
    assert.match(view, /SEO/);
    assert.match(view, /Accesibilidad/);
    assert.match(view, /Visibilidad/);
    assert.match(view, /name="version"/);
    assert.doesNotThrow(() => ejs.compile(view, { filename: path.join(ROOT, 'views/pages/admin/page/about.ejs') }));
  });

  test('validation preserves normalized submitted values and rejects unsafe URLs/media', () => {
    const result = validateAboutPage(validBody({
      ctaUrl: 'javascript:alert(1)',
      seoCanonical: '//evil.example/path',
      heroMedia: 'https://evil.example/image.jpg',
    }));
    assert.equal(result.value.hero.title, 'Nosotros');
    assert.equal(result.value.sections[0].text, 'Texto history');
    assert.equal(result.value.cta.url, 'javascript:alert(1)');
    assert.ok(result.errors.length >= 3);
  });

  test('safe URL policy accepts internal and external HTTP(S) only', () => {
    assert.equal(safeUrl('/contacto'), '/contacto');
    assert.equal(safePublicUrl('/nosotros'), '/nosotros');
    assert.match(safeUrl('https://example.com/about'), /^https:\/\/example\.com/);
    for (const unsafe of ['javascript:alert(1)', '//evil.example', '/\\evil', 'https://user:pass@example.com']) {
      assert.equal(safeUrl(unsafe), '');
      assert.equal(safePublicUrl(unsafe), '');
    }
  });

  test('normal users lack About capabilities while administrators receive them', () => {
    assert.equal(hasCapability({ role_id: 2 }, CAPABILITIES.ABOUT_PAGE_VIEW), false);
    assert.equal(hasCapability({ role_id: 2 }, CAPABILITIES.ABOUT_PAGE_EDIT), false);
    assert.equal(hasCapability({ role_id: 1 }, CAPABILITIES.ABOUT_PAGE_PUBLISH), true);
    const routes = read('routes/adminPageContentRoutes.js');
    assert.match(routes, /requireCapability\(CAPABILITIES\.ABOUT_PAGE_VIEW\)/);
    assert.match(routes, /csrfSynchronisedProtection, aboutPageController\.saveAboutPageDraft/);
  });

  test('module, migration, history and concurrency reuse Phase 1C infrastructure', () => {
    assert.equal(registry.MODULE_KEYS.ABOUT_PAGE, 'nosotros.about-content');
    assert.equal(registry.getModule(registry.MODULE_KEYS.ABOUT_PAGE).revisionEntityTypes[0], 'page_section');
    assert.equal(MIGRATION_REGISTRY.length, 35);
    assert.equal(MIGRATION_REGISTRY[22].name, 'migrateAboutPageCms');
    assert.match(read('services/cmsPublishingService.js'), /CMS_VERSION_CONFLICT/);
    assert.match(read('controllers/adminPublishingController.js'), /restorePageSection/);
    assert.match(read('controllers/adminPublishingController.js'), /sc_nosotros/);
  });

  test('public rendering uses published snapshots, safe media fallback and SEO output', () => {
    const service = read('services/cmsContentService.js');
    const controller = read('controllers/aboutController.js');
    const page = read('views/pages/nosotros.ejs');
    assert.match(service, /published_content_json AS content_json/);
    assert.match(controller, /getPublishedSectionContent/);
    assert.match(controller, /resolveMediaReference/);
    assert.match(controller, /ogImage/);
    assert.match(controller, /canonical/);
    assert.match(page, /rel="<%= ctaRel %>"/);
    assert.doesNotMatch(page, /<%-\s*content/);
  });

  test('responsive public styles and CSP-compatible module script exist', () => {
    const css = read('public/css/about.css');
    const js = read('public/js/about.js');
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /overflow-x: clip/);
    assert.doesNotMatch(read('views/pages/nosotros.ejs'), /<script/);
    assert.match(js, /initNavbar/);
  });
});
