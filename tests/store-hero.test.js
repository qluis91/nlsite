/**
 * Store Phase 1.5 — light theme, dynamic hero, CSP sort binding.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const {
  resolveStoreHero,
  DEFAULT_STORE_HERO,
  isSafeHeroImagePath,
  normalizeHeroPosition,
  HERO_POSITIONS,
} = require('../services/catalogService');
const {
  validateHeroTitle,
  validateHeroDescription,
  validateHeroAlt,
  validateHeroPosition,
  validateCategoryDescription,
} = require('../validators/catalogValidator');
const { HERO_COLUMNS } = require('../scripts/migrate-category-hero');

const { startTestServer, stopTestServer } = require('./testServer');

let BASE = '';

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      { method: 'GET', hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}` },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const storeCss = fs.readFileSync(path.resolve(__dirname, '../public/css/store.css'), 'utf8');
const storeJs = fs.readFileSync(path.resolve(__dirname, '../public/js/store/store.js'), 'utf8');
const tiendaEjs = fs.readFileSync(path.resolve(__dirname, '../views/pages/tienda.ejs'), 'utf8');
const heroEjs = fs.readFileSync(path.resolve(__dirname, '../views/components/store-hero.ejs'), 'utf8');
const categoryForm = fs.readFileSync(path.resolve(__dirname, '../views/pages/admin/category-form.ejs'), 'utf8');
const schemaSql = fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8');
const productDetail = fs.readFileSync(path.resolve(__dirname, '../views/pages/tienda-producto.ejs'), 'utf8');

describe('resolveStoreHero fallbacks', () => {
  const categoryDb = {
    async query(sql) {
      if (sql.includes('page_sections')) return [[{}]];
      if (sql.includes('media_assets')) return [[{ public_url: '/uploads/media/category.webp' }]];
      return [[]];
    },
  };
  const categoryFields = {
    hero_custom_enabled: 1,
    hero_media_ref: 'media://11111111-1111-4111-8111-111111111111',
  };

  test('default hero without category', async () => {
    const hero = await resolveStoreHero({});
    assert.strictEqual(hero.title, DEFAULT_STORE_HERO.title);
    assert.strictEqual(hero.description, DEFAULT_STORE_HERO.description);
    assert.strictEqual(hero.imageUrl, DEFAULT_STORE_HERO.imageUrl);
    assert.strictEqual(hero.contextText, '');
  });

  test('search-only uses default hero with context line', async () => {
    const hero = await resolveStoreHero({ search: 'figura' });
    assert.strictEqual(hero.title, DEFAULT_STORE_HERO.title);
    assert.match(hero.contextText, /figura/);
    assert.doesNotMatch(hero.title, /figura/);
  });

  test('category hero_title preferred over name', async () => {
    const hero = await resolveStoreHero({
      activeCategory: {
        ...categoryFields,
        name: 'Figuras',
        hero_title: 'Figuras coleccionables',
        hero_description: '',
        description: 'Desc genérica',
      },
    }, categoryDb);
    assert.strictEqual(hero.title, 'Figuras coleccionables');
  });

  test('category name fallback when hero_title missing', async () => {
    const hero = await resolveStoreHero({
      activeCategory: { ...categoryFields, name: 'Llaveros', hero_title: '', description: '' },
    }, categoryDb);
    assert.strictEqual(hero.title, 'Llaveros');
  });

  test('description fallback: hero_description → description → default', async () => {
    assert.strictEqual(
      (await resolveStoreHero({
        activeCategory: { ...categoryFields, name: 'A', hero_description: 'Hero desc', description: 'Cat desc' },
      }, categoryDb)).description,
      'Hero desc'
    );
    assert.strictEqual(
      (await resolveStoreHero({
        activeCategory: { ...categoryFields, name: 'A', hero_description: '', description: 'Cat desc' },
      }, categoryDb)).description,
      'Cat desc'
    );
    assert.strictEqual(
      (await resolveStoreHero({
        activeCategory: { ...categoryFields, name: 'A', hero_description: '', description: '' },
      }, categoryDb)).description,
      DEFAULT_STORE_HERO.description
    );
  });

  test('unsafe hero_image falls back to default', async () => {
    const hero = await resolveStoreHero({
      activeCategory: {
        name: 'X',
        hero_image: '../../../etc/passwd',
      },
    });
    assert.strictEqual(hero.imageUrl, DEFAULT_STORE_HERO.imageUrl);
  });

  test('enabled category Media Library image accepted', async () => {
    const hero = await resolveStoreHero({
      activeCategory: {
        ...categoryFields,
        name: 'X',
        hero_alt: 'Alt personalizado',
      },
    }, categoryDb);
    assert.strictEqual(hero.imageUrl, '/uploads/media/category.webp');
    assert.strictEqual(hero.imageAlt, 'Alt personalizado');
  });

  test('alt fallback includes category name', async () => {
    const hero = await resolveStoreHero({
      activeCategory: { ...categoryFields, name: 'Prototipos', hero_alt: '' },
    }, categoryDb);
    assert.match(hero.imageAlt, /Prototipos/);
  });

  test('invalid position normalized to center', () => {
    assert.strictEqual(normalizeHeroPosition('evil'), 'center');
    assert.strictEqual(normalizeHeroPosition('top'), 'top');
    assert.ok(HERO_POSITIONS.has('left'));
  });

  test('isSafeHeroImagePath allowlist', () => {
    assert.strictEqual(isSafeHeroImagePath('/uploads/categories/1/a.webp'), true);
    assert.strictEqual(isSafeHeroImagePath('/images/LogoCompleto.png'), true);
    assert.strictEqual(isSafeHeroImagePath('/uploads/products/1/a.webp'), false);
    assert.strictEqual(isSafeHeroImagePath('https://evil.com/x.png'), false);
  });
});

describe('hero validators', () => {
  test('optional fields accept empty', () => {
    assert.strictEqual(validateHeroTitle('').valid, true);
    assert.strictEqual(validateHeroDescription('').valid, true);
    assert.strictEqual(validateHeroAlt('').valid, true);
    assert.strictEqual(validateCategoryDescription('').valid, true);
  });

  test('invalid position rejected', () => {
    assert.strictEqual(validateHeroPosition('center').valid, true);
    assert.strictEqual(validateHeroPosition('zoom').valid, false);
  });

  test('length limits enforced', () => {
    assert.strictEqual(validateHeroTitle('x'.repeat(161)).valid, false);
    assert.strictEqual(validateHeroDescription('x'.repeat(501)).valid, false);
    assert.strictEqual(validateHeroAlt('x'.repeat(201)).valid, false);
  });
});

describe('migration and schema are additive', () => {
  test('HERO_COLUMNS are additive nullable fields', () => {
    assert.ok(HERO_COLUMNS.hero_title);
    assert.ok(HERO_COLUMNS.hero_image);
    assert.match(HERO_COLUMNS.hero_position, /NULL/);
  });

  test('schema.sql includes hero columns', () => {
    assert.match(schemaSql, /hero_title/);
    assert.match(schemaSql, /hero_description/);
    assert.match(schemaSql, /hero_image/);
    assert.match(schemaSql, /hero_alt/);
    assert.match(schemaSql, /hero_position/);
  });
});

describe('admin category form', () => {
  test('Media Library hero fields and CSRF', () => {
    assert.doesNotMatch(categoryForm, /enctype="multipart\/form-data"/);
    assert.match(categoryForm, /name="_csrf"/);
    assert.match(categoryForm, /name="hero_custom_enabled"/);
    assert.match(categoryForm, /fieldName:\s*'hero_media_ref'/);
    assert.match(categoryForm, /name="hero_eyebrow"/);
    assert.match(categoryForm, /name="hero_title"/);
    assert.match(categoryForm, /name="hero_description"/);
    assert.match(categoryForm, /name="hero_alt"/);
    assert.match(categoryForm, /name="hero_position"/);
    assert.match(categoryForm, /name="hero_button_label"/);
    assert.match(categoryForm, /name="hero_button_url"/);
    assert.match(categoryForm, /name="hero_button_target"/);
  });

  test('position allowlist options present', () => {
    assert.match(categoryForm, /\['center','Centro'\]/);
    assert.match(categoryForm, /\['top','Arriba'\]/);
    assert.match(categoryForm, /\['bottom','Abajo'\]/);
    assert.match(categoryForm, /\['left','Izquierda'\]/);
    assert.match(categoryForm, /\['right','Derecha'\]/);
  });
});

describe('store hero markup and CSP', () => {
  test('tienda includes store-hero partial', () => {
    assert.match(tiendaEjs, /store-hero/);
  });

  test('hero partial has no database logic', () => {
    assert.doesNotMatch(heroEjs, /pool|SELECT|INSERT|require\(/);
    assert.match(heroEjs, /storeHero\.title/);
  });

  test('no inline onchange on sort', () => {
    assert.doesNotMatch(tiendaEjs, /onchange=/);
    assert.match(tiendaEjs, /data-store-sort/);
    assert.match(tiendaEjs, /data-store-sort-form/);
  });

  test('store.js binds sort change idempotently', () => {
    assert.match(storeJs, /data-store-sort/);
    assert.match(storeJs, /requestSubmit/);
    assert.match(storeJs, /WeakMap/);
    assert.doesNotMatch(storeJs, /onchange/);
  });

  test('product-detail uses store layout classes', () => {
    assert.match(productDetail, /st-layout/);
    assert.match(productDetail, /store-sidebar/);
    assert.doesNotMatch(productDetail, /home-navbar/);
  });
});

describe('light theme CSS contract', () => {
  test('main area uses light gray gradient', () => {
    assert.match(storeCss, /#f4f6f3/);
    assert.match(storeCss, /radial-gradient/);
    assert.match(storeCss, /\.st-main\s*\{[\s\S]*linear-gradient/);
  });

  test('sidebar remains dark', () => {
    assert.match(storeCss, /--store-sidebar-bg:\s*#0d1110/);
    assert.match(storeCss, /\.st-sidebar\s*\{[\s\S]*background:\s*var\(--store-sidebar-bg\)/);
  });

  test('product cards use light surfaces and dark text', () => {
    assert.match(storeCss, /--store-card-bg:\s*#ffffff/);
    assert.match(storeCss, /--store-main-text:\s*#1a2218/);
    assert.match(storeCss, /\.st-card__title[\s\S]*var\(--store-main-text\)/);
  });

  test('prices retain green emphasis', () => {
    assert.match(storeCss, /\.st-card__price[\s\S]*var\(--store-green\)/);
  });

  test('responsive hero rules exist', () => {
    assert.match(storeCss, /\.st-hero\s*\{/);
    assert.match(storeCss, /@media\s*\(max-width:\s*767px\)/);
    assert.match(storeCss, /grid-template-columns:\s*1fr/);
  });

  test('no global body theme override', () => {
    assert.doesNotMatch(storeCss, /body\s*\{[\s\S]*background:\s*#f4f6f3/);
  });
});

describe('rendered /tienda hero behavior', () => {
  let pool = null;
  before(async () => {
    const server = await startTestServer();
    BASE = server.baseUrl;
    // Remove any stale published store-hero entry so the default hero renders.
    try {
      pool = require('../config/db');
      await pool.query(
        "DELETE FROM page_sections WHERE section_key = 'st-hero' AND page_id = (SELECT id FROM pages WHERE page_key = 'tienda' LIMIT 1)"
      );
    } catch (_) { /* database not available */ }
  });
  after(async () => {
    await stopTestServer();
    if (pool) { try { await pool.end(); } catch (_) {} }
  });

  test('GET /tienda renders default hero', async () => {
    const r = await httpGet('/tienda');
    assert.strictEqual(r.status, 200);
    assert.match(r.data, /st-hero/);
    assert.match(r.data, /Ideas creadas en 3D/);
    assert.match(r.data, /Tienda NinjaLabCR/);
    assert.doesNotMatch(r.data, /onchange=/);
  });

  test('GET /tienda?search= uses context without replacing title', async () => {
    const r = await httpGet('/tienda?search=ninja');
    assert.strictEqual(r.status, 200);
    assert.match(r.data, /Ideas creadas en 3D/);
    assert.match(r.data, /Resultados para/);
    assert.match(r.data, /ninja/);
  });
});
