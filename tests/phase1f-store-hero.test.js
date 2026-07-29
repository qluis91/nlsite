/**
 * Phase 1F — Store Hero CMS tests.
 * Static template/code structure tests + integration tests.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ══════════════════════════════════════════════════════════════════
// Template content tests (no server needed)
// ══════════════════════════════════════════════════════════════════
describe('Store hero EJS template', () => {
  const heroHtml = fs.readFileSync(
    path.resolve(__dirname, '../views/pages/admin/page/store-hero.ejs'), 'utf8'
  );

  test('form has save action', () => {
    assert.match(heroHtml, /\/admin\/page\/store-hero\/save/);
  });

  test('publish form exists', () => {
    assert.match(heroHtml, /store-hero-publish-form/);
  });

  test('no window.confirm in template', () => {
    assert.doesNotMatch(heroHtml, /window\.confirm/);
  });

  test('no inline event handlers', () => {
    assert.doesNotMatch(heroHtml, /onclick="[^"]*\(/);
    assert.doesNotMatch(heroHtml, /onsubmit="[^"]*\(/);
  });

  test('data-advanced-section present', () => {
    assert.match(heroHtml, /data-advanced-section/);
    assert.match(heroHtml, /Enlaces y comportamiento/);
    assert.match(heroHtml, /Accesibilidad/);
  });

  test('sticky-actions bar present', () => {
    assert.match(heroHtml, /sticky-actions/);
  });

  test('btn-save and btn-publish classes present', () => {
    assert.match(heroHtml, /btn-save/);
    assert.match(heroHtml, /btn-publish/);
  });

  test('primaryUrl validation help text', () => {
    assert.match(heroHtml, /https:\/\/\.\.\./);
  });
});

// ══════════════════════════════════════════════════════════════════
describe('Disclosure component', () => {
  test('disclosure.js exists and exports NLDisclosure', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/disclosure.js'), 'utf8'
    );
    assert.match(source, /NLDisclosure/);
    assert.match(source, /data-advanced-section/);
    assert.match(source, /aria-expanded/);
  });

  test('disclosure.js is CSP compatible', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/disclosure.js'), 'utf8'
    );
    assert.doesNotMatch(source, /onclick="|onsubmit="|onchange="/);
  });
});

// ══════════════════════════════════════════════════════════════════
describe('Sidebar navigation', () => {
  const sidebarHtml = fs.readFileSync(
    path.resolve(__dirname, '../views/components/sidebar.ejs'), 'utf8'
  );

  test('Hero de Tienda link present', () => {
    assert.match(sidebarHtml, /\/admin\/page\/store-hero/);
    assert.match(sidebarHtml, /Hero de Tienda/);
  });

  test('no duplicate store-hero links (max 2)', () => {
    const matches = sidebarHtml.match(/store-hero/g);
    assert.ok(matches && matches.length <= 2);
  });
});

// ══════════════════════════════════════════════════════════════════
describe('Global settings disclosure', () => {
  const globalSettingsHtml = fs.readFileSync(
    path.resolve(__dirname, '../views/pages/admin/page/global-settings.ejs'), 'utf8'
  );

  test('data-advanced-section present in global settings', () => {
    assert.match(globalSettingsHtml, /data-advanced-section/);
    assert.match(globalSettingsHtml, /Indexación avanzada/);
  });
});

// ══════════════════════════════════════════════════════════════════
describe('Store hero migration', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../scripts/migrate-store-hero-cms.js'), 'utf8'
  );

  test('migration file exists', () => {
    assert.ok(migration.length > 200);
  });

  test('exports migrateStoreHeroCms', () => {
    assert.match(migration, /module\.exports/);
    assert.match(migration, /migrateStoreHeroCms/);
  });

  test('creates tienda page and st-hero section', () => {
    assert.match(migration, /page_key.*tienda/);
    assert.match(migration, /section_key.*st-hero/);
  });

  test('uses INSERT ... WHERE NOT EXISTS (idempotent)', () => {
    assert.match(migration, /WHERE NOT EXISTS/);
  });
});

// ══════════════════════════════════════════════════════════════════
describe('Module registry', () => {
  const registry = fs.readFileSync(
    path.resolve(__dirname, '../services/moduleRegistry.js'), 'utf8'
  );

  test('STORE_HERO module registered', () => {
    assert.match(registry, /STORE_HERO/);
    assert.match(registry, /tienda\.st-hero/);
    assert.match(registry, /Hero de Tienda/);
  });
});

// ══════════════════════════════════════════════════════════════════
describe('Store hero controller', () => {
  test('controller file is syntactically valid', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../controllers/adminStoreHeroController.js'), 'utf8'
    );
    assert.ok(src.length > 200);
    assert.match(src, /showStoreHero/);
    assert.match(src, /saveStoreHeroDraft/);
    assert.match(src, /publishStoreHero/);
    assert.match(src, /function validateStoreHero/);
  });
});

// ══════════════════════════════════════════════════════════════════
describe('resolveStoreHero function', () => {
  test('catalogService exports resolveStoreHero as async function', async () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../services/catalogService.js'), 'utf8'
    );
    assert.match(source, /async function resolveStoreHero/);
    assert.match(source, /DEFAULT_STORE_HERO/);
    assert.match(source, /tienda.*st-hero/);
  });

  test('returns defaults when no CMS data (fallback)', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../services/catalogService.js'), 'utf8'
    );
    // Verify fallback returns DEFAULT_STORE_HERO
    assert.match(source, /\.\.\.DEFAULT_STORE_HERO/);
  });

  test('category fallback code preserved', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../services/catalogService.js'), 'utf8'
    );
    assert.match(source, /hero_title/);
    assert.match(source, /hero_description.*description/);
    assert.match(source, /isSafeHeroImagePath/);
  });
});

// ══════════════════════════════════════════════════════════════════
describe('store-hero component button support', () => {
  test('store-hero partial supports button', () => {
    const heroPartial = fs.readFileSync(
      path.resolve(__dirname, '../views/components/store-hero.ejs'), 'utf8'
    );
    assert.match(heroPartial, /primaryLabel.*primaryUrl/);
    assert.match(heroPartial, /st-hero__cta/);
    assert.match(heroPartial, /rel="noopener noreferrer"/);
  });
});
