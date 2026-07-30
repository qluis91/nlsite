/**
 * Phase 1G — category-specific Store heroes.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_STORE_HERO,
  resolveStoreHero,
  safeHeroButtonUrl,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = require('../services/catalogService');
const {
  validateHeroButtonUrl,
  validateHeroButtonTarget,
  validateHeroMediaReference,
} = require('../validators/catalogValidator');
const {
  CATEGORY_STORE_HERO_COLUMNS,
  migrateCategoryStoreHero,
} = require('../scripts/migrate-category-store-hero');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const PUBLIC_ID = '11111111-1111-4111-8111-111111111111';
const GENERAL_ID = '22222222-2222-4222-8222-222222222222';

function heroDb({ categoryAsset = 'active', generalAsset = 'active' } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes('page_sections')) {
        return [[{
          published_content_json: JSON.stringify({
            eyebrow: 'General',
            title: 'Hero general publicado',
            description: 'Descripción general',
            backgroundMedia: `media://${GENERAL_ID}`,
            imageAlt: 'General alt',
            imagePosition: 'center',
            primaryLabel: '',
            primaryUrl: '',
            buttonTarget: '_self',
            isVisible: true,
          }),
        }]];
      }
      if (sql.includes('media_assets')) {
        const id = params[0];
        const state = id === PUBLIC_ID ? categoryAsset : generalAsset;
        if (state !== 'active') return [[]];
        return [[{ public_url: id === PUBLIC_ID ? '/uploads/media/category.webp' : '/uploads/media/general.webp' }]];
      }
      return [[]];
    },
  };
}

function customCategory(overrides = {}) {
  return {
    name: 'Figuras',
    description: 'Categoría de figuras',
    hero_custom_enabled: 1,
    hero_media_ref: `media://${PUBLIC_ID}`,
    hero_eyebrow: 'Colección',
    hero_title: 'Figuras especiales',
    hero_description: 'Descripción del hero de figuras',
    hero_alt: 'Figuras impresas en 3D',
    hero_position: 'top',
    hero_button_label: 'Explorar',
    hero_button_url: '/tienda?category=figuras',
    hero_button_target: '_self',
    ...overrides,
  };
}

describe('Phase 1G public Store hero selection', () => {
  test('no category uses the published general hero', async () => {
    const hero = await resolveStoreHero({}, heroDb());
    assert.equal(hero.title, 'Hero general publicado');
    assert.equal(hero.imageUrl, '/uploads/media/general.webp');
    assert.equal(hero.source, 'general-cms');
  });

  test('enabled category with active image uses its custom hero', async () => {
    const hero = await resolveStoreHero({ activeCategory: customCategory() }, heroDb());
    assert.equal(hero.title, 'Figuras especiales');
    assert.equal(hero.imageUrl, '/uploads/media/category.webp');
    assert.equal(hero.primaryUrl, '/tienda?category=figuras');
    assert.equal(hero.source, 'category');
  });

  test('disabled category falls back to general hero', async () => {
    const hero = await resolveStoreHero({
      activeCategory: customCategory({ hero_custom_enabled: 0 }),
    }, heroDb());
    assert.equal(hero.title, 'Hero general publicado');
    assert.equal(hero.source, 'general-cms');
  });

  test('missing or archived category media falls back to general hero', async () => {
    for (const categoryAsset of ['missing', 'archived']) {
      const hero = await resolveStoreHero(
        { activeCategory: customCategory() },
        heroDb({ categoryAsset })
      );
      assert.equal(hero.imageUrl, '/uploads/media/general.webp');
      assert.equal(hero.source, 'general-cms');
    }
  });

  test('invalid media reference falls back without querying an unsafe id', async () => {
    const hero = await resolveStoreHero({
      activeCategory: customCategory({ hero_media_ref: 'media://../../secret' }),
    }, heroDb());
    assert.equal(hero.title, 'Hero general publicado');
  });

  test('category fields are optional and safely inherit general content', async () => {
    const hero = await resolveStoreHero({
      activeCategory: customCategory({
        hero_eyebrow: '',
        hero_title: '',
        hero_description: '',
        description: '',
        hero_button_url: 'javascript:alert(1)',
      }),
    }, heroDb());
    assert.equal(hero.eyebrow, 'General');
    assert.equal(hero.title, 'Figuras');
    assert.equal(hero.description, 'Descripción general');
    assert.equal(hero.primaryUrl, '');
    assert.equal(hero.primaryLabel, '');
  });
});

describe('Phase 1G validation and link safety', () => {
  test('accepts safe internal and external HTTP(S) URLs', () => {
    for (const url of ['/tienda?category=figuras', 'https://example.com/store', 'http://example.com']) {
      assert.equal(validateHeroButtonUrl(url).valid, true);
      assert.equal(safeHeroButtonUrl(url), url);
    }
  });

  test('rejects unsafe schemes, protocol-relative URLs and credentials', () => {
    for (const url of ['javascript:alert(1)', '//evil.example/x', 'https://user:pass@example.com', '/safe\\evil']) {
      assert.equal(validateHeroButtonUrl(url).valid, false);
      assert.equal(safeHeroButtonUrl(url), '');
    }
  });

  test('target and Media Library references are allowlisted', () => {
    assert.equal(validateHeroButtonTarget('_self').valid, true);
    assert.equal(validateHeroButtonTarget('_blank').valid, true);
    assert.equal(validateHeroButtonTarget('popup').valid, false);
    assert.equal(validateHeroMediaReference(`media://${PUBLIC_ID}`).valid, true);
    assert.equal(validateHeroMediaReference('media://raw-input').valid, false);
  });
});

describe('Phase 1G category editor and persistence contracts', () => {
  const form = read('views/pages/admin/category-form.ejs');
  const routes = read('routes/adminCatalogRoutes.js');
  const controller = read('controllers/adminCatalogController.js');
  const service = read('services/adminCatalogService.js');
  const app = read('app.js');

  test('existing category editor exposes every Phase 1G field and Media Library selector', () => {
    for (const field of [
      'hero_custom_enabled', 'hero_media_ref', 'hero_alt', 'hero_eyebrow',
      'hero_title', 'hero_description', 'hero_button_label', 'hero_button_url',
      'hero_button_target',
    ]) {
      assert.match(form, new RegExp(field));
    }
    assert.match(form, /components\/media-selector/);
    assert.match(form, /data-advanced-section/);
    assert.match(form, /sticky-actions/);
    assert.match(form, /field-help/);
  });

  test('category writes no longer use direct multipart hero upload', () => {
    assert.doesNotMatch(routes, /categoryHeroUpload/);
    assert.doesNotMatch(form, /multipart\/form-data/);
    assert.doesNotMatch(form, /type="file"[^>]*hero_image/);
    assert.match(controller, /pageScripts:\s*\['\/js\/admin\/media-selector\.js'\]/);
  });

  test('validation failures preserve submitted values and surface NinjaAlerts', () => {
    assert.match(controller, /renderCategoryEditor\(req, res, submitted/);
    assert.match(controller, /status:\s*422/);
    assert.match(controller, /pageAlerts/);
    assert.match(form, /fieldErrors/);
  });

  test('category hero writes and revision record share a transaction', () => {
    assert.match(service, /beginTransaction/);
    assert.match(service, /REVISION_ENTITY_TYPES\.CATEGORY/);
    assert.match(service, /recordRevision\([\s\S]*,\s*conn\)/);
    assert.match(service, /hero_media_ref/);
    assert.match(service, /hero_custom_enabled/);
  });

  test('normal users remain blocked by the existing admin middleware', () => {
    assert.match(app, /app\.use\('\/admin', isAuthenticated, isAdmin, adminCatalogRoutes\)/);
  });
});

describe('Phase 1G additive migration and Store regressions', () => {
  test('migration 22 adds only the six new category columns', () => {
    assert.deepEqual(Object.keys(CATEGORY_STORE_HERO_COLUMNS), [
      'hero_media_ref', 'hero_eyebrow', 'hero_button_label',
      'hero_button_url', 'hero_button_target', 'hero_custom_enabled',
    ]);
    for (const definition of Object.values(CATEGORY_STORE_HERO_COLUMNS)) {
      assert.doesNotMatch(definition, /\bDROP\b|\bRENAME\b/i);
    }
  });

  test('migration is idempotent when every column already exists', async () => {
    const calls = [];
    const fakeDb = {
      async query(sql) {
        calls.push(sql);
        if (sql.includes('information_schema.COLUMNS')) {
          return [Object.keys(CATEGORY_STORE_HERO_COLUMNS).map((COLUMN_NAME) => ({ COLUMN_NAME }))];
        }
        throw new Error('ALTER must not run for an already migrated schema');
      },
    };
    await migrateCategoryStoreHero(fakeDb);
    await migrateCategoryStoreHero(fakeDb);
    assert.equal(calls.length, 2);
  });

  test('registry keeps migration 22 immediately after Phase 1F', () => {
    const registry = require('../scripts/migrationTracker').MIGRATION_REGISTRY;
    assert.equal(registry.length, 25);
    assert.equal(registry[20].name, 'migrateStoreHeroCms');
    assert.equal(registry[21].name, 'migrateCategoryStoreHero');
    assert.equal(registry[22].name, 'migrateAboutPageCms');
  });

  test('Store limits, filters and pagination contracts remain intact', () => {
    const catalog = read('services/catalogService.js');
    assert.equal(DEFAULT_LIMIT, 48);
    assert.equal(MAX_LIMIT, 48);
    assert.match(catalog, /filters\.category/);
    assert.match(catalog, /Math\.ceil\(totalProducts \/ filters\.limit\)/);
    assert.equal(DEFAULT_STORE_HERO.title, 'Ideas creadas en 3D');
  });
});
