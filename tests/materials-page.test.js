/**
 * Cotización Materiales (/materiales) — CMS page contracts + public rendering.
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const ejs = require('ejs');
const pool = require('../config/db');
const {
  migrateMaterialsPageCms,
  DEFAULT_MATERIALS_CONTENT,
} = require('../scripts/migrate-materials-page-cms');
const {
  validateMaterialsPage,
  safeUrl,
} = require('../controllers/adminMaterialsPageController');
const {
  visibleMaterials,
  safePublicUrl,
  showMaterials,
} = require('../controllers/materialsController');
const cmsContent = require('../services/cmsContentService');
const publicNavbar = require('../services/publicNavbarService');
const {
  ALLOWED_ICONS,
  normalizeIconKey,
  getMaterialIconSvg,
} = require('../services/materialsIconService');
const { CAPABILITIES, hasCapability } = require('../config/capabilities');
const registry = require('../services/moduleRegistry');
const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');
const { resolveNavActiveState } = require('../services/publicNavbarService');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function validBody(overrides = {}) {
  const body = {
    heroTitle: 'Nuestros Materiales',
    heroDescription: 'Intro',
    isVisible: '1',
    seoTitle: 'Materiales | NinjaLabCR',
    seoDescription: 'SEO',
    seoCanonical: '/materiales',
    ariaLabel: 'Materiales',
    material_0_id: 'pla',
    material_0_title: 'PLA (Ácido Poliláctico)',
    material_0_icon: 'atom',
    material_0_description: 'Desc PLA',
    material_0_pros: 'Fácil\nBiodegradable',
    material_0_cons: 'Frágil',
    material_0_visible: '1',
    material_0_order: '10',
    material_1_id: 'abs',
    material_1_title: 'ABS',
    material_1_icon: 'temperature',
    material_1_description: 'Desc ABS',
    material_1_pros: 'Fuerte',
    material_1_cons: 'Olores',
    material_1_visible: '1',
    material_1_order: '20',
  };
  return { ...body, ...overrides };
}

describe('Materials page — wiring & contracts', () => {
  it('public route, sitemap, styles and module are wired', () => {
    const app = read('app.js');
    assert.match(app, /app\.use\('\/materiales', materialsRoutes\)/);
    assert.match(app, /loc: '\/materiales'/);
    assert.match(read('views/pages/materiales.ejs'), /materials-react-grid/);
    assert.match(read('public/css/materials.css'), /\.page-materials/);
    assert.match(read('public/css/materials.css'), /@media \(min-width:\s*768px\)/);
    assert.match(read('public/js/materials.js'), /IntersectionObserver/);
    assert.match(read('public/js/materials.js'), /prefers-reduced-motion/);
  });

  it('migration is appended at end of registry and module is registered', () => {
    const last = MIGRATION_REGISTRY[MIGRATION_REGISTRY.length - 1];
    assert.equal(last.name, 'migrateMaterialsPageCms');
    assert.equal(registry.MODULE_KEYS.MATERIALS_PAGE, 'materiales.materials-content');
    assert.equal(
      registry.getModule(registry.MODULE_KEYS.MATERIALS_PAGE).cacheNamespaces[0],
      'sc_materiales'
    );
  });

  it('capabilities and admin routes are protected', () => {
    assert.equal(hasCapability({ role_id: 2 }, CAPABILITIES.MATERIALS_PAGE_VIEW), false);
    assert.equal(hasCapability({ role_id: 1 }, CAPABILITIES.MATERIALS_PAGE_PUBLISH), true);
    const routes = read('routes/adminPageContentRoutes.js');
    assert.match(routes, /requireCapability\(CAPABILITIES\.MATERIALS_PAGE_VIEW\)/);
    assert.match(routes, /materialsPageController\.saveMaterialsPageDraft/);
    assert.match(read('controllers/adminPageController.js'), /Página Materiales/);
  });

  it('navbar fallback and active state include /materiales', () => {
    const navSrc = read('services/publicNavbarService.js');
    assert.match(navSrc, /url: '\/materiales'/);
    assert.match(navSrc, /path\.startsWith\('\/materiales'\)/);
    const active = resolveNavActiveState('/materiales', {
      url: '/materiales',
      label: 'Materiales',
      children: [],
    });
    assert.equal(active.parentActive, true);
    const store = resolveNavActiveState('/materiales', {
      url: '/tienda',
      label: 'Tienda',
      children: [],
    });
    assert.equal(store.parentActive, false);
  });

  it('showMaterials passes currentPath=/materiales even when req.path is /', async () => {
    assert.match(
      read('controllers/materialsController.js'),
      /currentPath:\s*'\/materiales'/
    );
    assert.doesNotMatch(
      read('controllers/materialsController.js'),
      /currentPath:\s*req\.path/
    );

    const origGet = cmsContent.getPublishedSectionContent;
    const origResolve = cmsContent.resolveMediaReference;
    const origNav = publicNavbar.getNavbarCmsData;
    cmsContent.getPublishedSectionContent = async () => structuredClone(DEFAULT_MATERIALS_CONTENT);
    cmsContent.resolveMediaReference = async () => null;
    publicNavbar.getNavbarCmsData = async () => ({ navItems: [], settings: {}, logos: {} });

    let rendered = null;
    const res = {
      render(_view, locals) {
        rendered = locals;
      },
    };

    try {
      await showMaterials({ path: '/' }, res, (err) => {
        throw err || new Error('unexpected next()');
      });
      assert.ok(rendered);
      assert.equal(rendered.currentPath, '/materiales');
    } finally {
      cmsContent.getPublishedSectionContent = origGet;
      cmsContent.resolveMediaReference = origResolve;
      publicNavbar.getNavbarCmsData = origNav;
    }
  });
});

describe('Materials page — defaults & icons', () => {
  it('seeds PLA ABS PETG Resina with allowlisted icons', () => {
    const ids = DEFAULT_MATERIALS_CONTENT.items.map((i) => i.id);
    assert.deepEqual(ids, ['pla', 'abs', 'petg', 'resina']);
    assert.equal(DEFAULT_MATERIALS_CONTENT.items[0].icon, 'atom');
    assert.equal(DEFAULT_MATERIALS_CONTENT.items[1].icon, 'temperature');
    assert.equal(DEFAULT_MATERIALS_CONTENT.items[2].icon, 'shield');
    assert.equal(DEFAULT_MATERIALS_CONTENT.items[3].icon, 'droplet');
  });

  it('icon allowlist falls back to cube', () => {
    assert.equal(normalizeIconKey('atom'), 'atom');
    assert.equal(normalizeIconKey('nope'), 'cube');
    assert.ok(ALLOWED_ICONS.includes('flex'));
    assert.match(getMaterialIconSvg('unknown'), /<svg /);
    assert.match(getMaterialIconSvg('unknown'), /M12 2/);
    assert.doesNotMatch(getMaterialIconSvg('atom'), /<script/i);
  });
});

describe('Materials page — validation', () => {
  it('accepts a valid collection and normalizes pros/cons lines', () => {
    const result = validateMaterialsPage(validBody());
    assert.equal(result.errors.length, 0);
    assert.equal(result.value.hero.title, 'Nuestros Materiales');
    assert.equal(result.value.items[0].pros.length, 2);
    assert.equal(result.value.items[0].icon, 'atom');
  });

  it('rejects missing title, duplicate ids, bad icon and unsafe canonical', () => {
    const result = validateMaterialsPage(
      validBody({
        heroTitle: '',
        seoCanonical: 'javascript:alert(1)',
        material_1_id: 'pla',
        material_0_icon: 'evil',
        seoOgMedia: 'https://evil.example/x.png',
      })
    );
    assert.ok(result.errors.length >= 3);
    assert.ok(result.errors.some((e) => /título/i.test(e)));
    assert.ok(result.errors.some((e) => /duplicado/i.test(e)));
    assert.ok(result.errors.some((e) => /icono/i.test(e)));
  });

  it('safe URL helpers reject unsafe schemes', () => {
    assert.equal(safeUrl('/materiales'), '/materiales');
    assert.equal(safePublicUrl('/materiales'), '/materiales');
    assert.equal(safeUrl('javascript:alert(1)'), '');
    assert.equal(safePublicUrl('//evil.example'), '');
  });
});

describe('Materials page — public filtering & SSR markup', () => {
  it('filters hidden items and sorts by order', () => {
    const materials = visibleMaterials({
      items: [
        { id: 'b', title: 'B', visible: true, order: 30, icon: 'cube', pros: [], cons: [] },
        { id: 'a', title: 'A', visible: true, order: 10, icon: 'atom', pros: ['x'], cons: [] },
        { id: 'h', title: 'Hidden', visible: false, order: 5, icon: 'cube', pros: [], cons: [] },
      ],
    });
    assert.deepEqual(
      materials.map((m) => m.id),
      ['a', 'b']
    );
    assert.match(materials[0].iconSvg, /<svg /);
  });

  it('public view escapes CMS text fields (not raw HTML)', () => {
    const view = read('views/pages/materiales.ejs');
    assert.doesNotThrow(() =>
      ejs.compile(view, { filename: path.join(ROOT, 'views/pages/materiales.ejs') })
    );
    assert.match(view, /<%= item\.title %>/);
    assert.match(view, /<%= item\.description %>/);
    assert.match(view, /<%= pro %>/);
    assert.match(view, /<%= con %>/);
    assert.match(view, /<%- item\.iconSvg %>/);
    assert.match(view, /Ventajas/);
    assert.match(view, /Desventajas/);
    const cardTpl =
      '<h2><%= item.title %></h2><p><%= item.description %></p>' +
      '<ul><% (item.pros||[]).forEach(function(pro){ %><li><%= pro %></li><% }); %></ul>';
    const html = ejs.render(cardTpl, {
      item: {
        title: '<script>alert(1)</script>PLA',
        description: 'Desc',
        pros: ['Fácil'],
      },
    });
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /PLA/);
  });

  it('admin editor view compiles and exposes add/remove affordances', () => {
    const view = read('views/pages/admin/page/materials.ejs');
    assert.match(view, /Nuevo material/);
    assert.match(view, /data-materials-remove/);
    assert.match(view, /data-cms-publish-form/);
    assert.match(view, /media-selector/);
    assert.doesNotThrow(() =>
      ejs.compile(view, { filename: path.join(ROOT, 'views/pages/admin/page/materials.ejs') })
    );
  });
});

describe('Materials page — migration idempotency', () => {
  it('creates page/section once and keeps seeded defaults', async () => {
    await migrateMaterialsPageCms(pool);
    await migrateMaterialsPageCms(pool);
    const [[page]] = await pool.query(
      "SELECT id, page_key, slug FROM pages WHERE page_key = 'materiales' LIMIT 1"
    );
    assert.ok(page);
    assert.equal(page.slug, 'materiales');
    const [[section]] = await pool.query(
      `SELECT section_key, published_content_json
         FROM page_sections WHERE page_id = ? AND section_key = 'materials-content' LIMIT 1`,
      [page.id]
    );
    assert.ok(section);
    const published =
      typeof section.published_content_json === 'string'
        ? JSON.parse(section.published_content_json)
        : section.published_content_json;
    const ids = (published.items || []).map((i) => i.id);
    assert.ok(ids.includes('pla'));
    assert.ok(ids.includes('abs'));
    assert.ok(ids.includes('petg'));
    assert.ok(ids.includes('resina'));
    const [nav] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM navigation_items
        WHERE location = 'home' AND deleted_at IS NULL AND url = '/materiales'`
    );
    assert.ok(Number(nav[0].cnt) >= 1);
  });
});

after(async () => {
  try {
    await pool.end();
  } catch (_) {}
});
