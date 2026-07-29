/**
 * Phase 1D completion tests.
 * Run: node --test tests/phase1d-completion.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const ROOT = path.join(__dirname, '..');
const views = (n) => path.join(ROOT, 'views', 'pages', 'admin', `${n}.ejs`);

// Shared locals that every admin page needs
const L = {
  csrfToken: 'test-csrf',
  site: { name: 'NinjaLab', colors: { primary: '#000', secondary: '#fff' } },
  user: { id: 1, email: 'admin@test.com', role: 'admin' },
  isAuthenticated: true,
  isAdmin: true,
  error: '',
  saved: '',
  safeJsonScript: JSON.stringify,
};

function renderPage(name, extra = {}) {
  return ejs.renderFile(views(name), {
    ...L,
    section: {
      id: 1,
      status: 'published',
      content: {
        isVisible: true, heading: 'H', subheading: 'S', ctaLabel: 'CTA',
        ctaUrl: '#', secondaryLabel: '', secondaryUrl: '',
        modelPosterAlt: 'Alt', modelFallbackAlt: 'Fb', socialAriaLabel: 'Soc',
        modelErrorText: 'Err', retryLabel: 'Retry', eyebrow: 'Eyebrow',
      },
      style: { backgroundColor: '', textColor: '', accentColor: '', model: {} },
    },
    socialItems: [],
    content: { isVisible: true, backgroundColor: '', textColor: '', accentColor: '' },
    style: { backgroundColor: '', textColor: '', accentColor: '' },
    logoItems: [], carouselItems: [], items: [],
    submittedItem: null, submittedNavValues: null,
    settings: {}, navItems: [], mediaList: { items: [] },
    logoPrimary: null, logoLight: null, logoDark: null, favicon: null,
    bgMedia: null,
    modelMedia: null,
    fallbackMedia: null,
    modelList: { items: [] },
    ogImage: null,
    ogMedia: { home: null },
    indexingModes: [{ value: 'index,follow', label: 'Indexar y seguir' }],
    seoData: { home: { title: '', description: '', ogImage: '', canonicalUrl: '', indexing: 'auto' } },
    pages: [{ page_key: 'home', title: 'Inicio' }],
    activePage: 'home',
    products: [], categories: [],
    total: 0, page: 1, totalPages: 1, search: '', categoryFilter: '',
    loadError: null,
    action: '/admin/catalogo/productos/nuevo',
    product: null,
    selectedCategories: [],
    category: null,
    ...extra,
  }, { views: [path.join(ROOT, 'views')] });
}

// ─────────────────────────────────────────
// 1. Sticky action bars
// ─────────────────────────────────────────
describe('Phase 1D: Sticky action bars', () => {
  it('panel1 has one sticky action bar', async () => {
    const html = await renderPage('page/panel1');
    assert.strictEqual((html.match(/sticky-actions/g) || []).length, 1);
  });
  it('panel2 has one sticky bar with save + publish', async () => {
    const html = await renderPage('page/panel2');
    assert.strictEqual((html.match(/sticky-actions/g) || []).length, 1);
    assert.ok(html.includes('btn-save'));
    assert.ok(html.includes('btn-publish'));
  });
  it('panel3 has one sticky bar with save + publish', async () => {
    const html = await renderPage('page/panel3');
    assert.strictEqual((html.match(/sticky-actions/g) || []).length, 1);
    assert.ok(html.includes('btn-save'));
    assert.ok(html.includes('btn-publish'));
  });
  it('navbar has one sticky action bar', async () => {
    const html = await renderPage('page/navbar');
    assert.strictEqual((html.match(/sticky-actions/g) || []).length, 1);
  });
  it('global-settings has one sticky action bar', async () => {
    const html = await renderPage('page/global-settings');
    assert.strictEqual((html.match(/sticky-actions/g) || []).length, 1);
  });
  it('page-seo has one sticky action bar', async () => {
    const html = await renderPage('page/page-seo');
    assert.strictEqual((html.match(/sticky-actions/g) || []).length, 1);
  });
  it('product form has sticky-actions', async () => {
    const html = await renderPage('product-form');
    assert.ok(html.includes('sticky-actions'));
    assert.ok(html.includes('btn-save'));
  });
  it('category form has sticky-actions', async () => {
    const html = await renderPage('category-form', { action: '/admin/catalogo/categorias/nuevo' });
    assert.ok(html.includes('sticky-actions'));
    assert.ok(html.includes('btn-save'));
  });
  it('sticky actions have editor state indicator', async () => {
    const html = await renderPage('page/panel1');
    assert.ok(html.includes('data-cms-editor-status'));
  });
});

// ─────────────────────────────────────────
// 2. Help text aria-describedby
// ─────────────────────────────────────────
describe('Phase 1D: Inline help and field clarity', () => {
  it('panel1 alt fields have aria-describedby help', async () => {
    const html = await renderPage('page/panel1');
    assert.ok(html.includes('aria-describedby="model_poster_alt-help"'));
    assert.ok(html.includes('aria-describedby="model_fallback_alt-help"'));
    assert.ok(html.includes('field-help'));
  });
  it('panel2 logo URL has aria-describedby help', async () => {
    const html = await renderPage('page/panel2');
    assert.ok(html.includes('aria-describedby="logo-url-help"'));
  });
});

// ─────────────────────────────────────────
// 3. Products mobile presentation
// ─────────────────────────────────────────
describe('Phase 1D: Products mobile presentation', () => {
  const sampleProducts = (arr) => renderPage('products', { products: arr, total: arr.length });
  const prod = (id, name, cats) => ({
    id, name, categoryNames: cats || ['Cat1'],
    is_active: true, is_published: true,
    regular_price: 5000, promotional_price: null, web_price: null,
    stock_quantity: 10, primary_image: null,
  });

  it('renders both desktop and mobile sections', async () => {
    const html = await sampleProducts([prod(1, 'Producto A')]);
    assert.ok(html.includes('products-desktop'));
    assert.ok(html.includes('products-mobile'));
  });
  it('mobile card shows all required info', async () => {
    const html = await sampleProducts([{ ...prod(2, 'Producto B', ['Cat1', 'Cat2']),
      promotional_price: 5000, web_price: 7000, stock_quantity: 25 }]);
    assert.ok(html.includes('Producto B'));
    assert.ok(html.includes('Cat1, Cat2'));
    assert.ok(html.includes('Publicado'));
    assert.ok(html.includes('Stock:'));
    assert.ok(html.includes('Precio:'));
    assert.ok(html.includes('Promo:'));
    assert.ok(html.includes('Editar'));
    assert.ok(html.includes('Eliminar'));
  });
  it('no duplicate accessible content', async () => {
    const html = await sampleProducts([prod(3, 'Producto C')]);
    assert.ok(html.includes('products-desktop'));
    assert.ok(html.includes('products-mobile'));
    assert.ok(html.includes('aria-label="Lista de productos"'));
  });
});

// ─────────────────────────────────────────
// 4. Advanced-section disclosure
// ─────────────────────────────────────────
describe('Phase 1D: Advanced-section disclosure', () => {
  const fs = require('fs');
  it('disclosure.js loaded in admin layout', () => {
    const src = fs.readFileSync(path.join(ROOT, 'views', 'layouts', 'admin.ejs'), 'utf-8');
    assert.ok(src.includes('disclosure.js'));
  });
  it('disclosure JS exposes API and manages ARIA', () => {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'disclosure.js'), 'utf-8');
    assert.ok(src.includes('window.NLDisclosure'));
    assert.ok(src.includes('aria-expanded'));
    assert.ok(src.includes('data-advanced-section'));
  });
  it('disclosure auto-opens on errors', () => {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'disclosure.js'), 'utf-8');
    assert.ok(src.includes('aria-invalid') || src.includes('cms-field-errors'));
    assert.ok(src.includes('details.open = true'));
  });
});

// ─────────────────────────────────────────
// 5. Media selector archived warning
// ─────────────────────────────────────────
describe('Phase 1D: Media archived/missing warnings', () => {
  const fs = require('fs');
  it('media-selector checks is_archived and renders warning', () => {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'media-selector.js'), 'utf-8');
    assert.ok(src.includes('is_archived'));
    assert.ok(src.includes('media-archived-warning'));
    assert.ok(src.includes('is-archived'));
  });
  it('remove-reference does not delete file', () => {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'media-selector.js'), 'utf-8');
    assert.ok(src.includes("input.value = ''"));
    assert.ok(!src.includes("DELETE FROM"));
  });
});

// ─────────────────────────────────────────
// 6. Loading and empty states
// ─────────────────────────────────────────
describe('Phase 1D: Loading and empty states', () => {
  const fs = require('fs');
  it('media-selector shows skeleton with aria-hidden', () => {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'media-selector.js'), 'utf-8');
    assert.ok(src.includes('skeleton'));
    assert.ok(src.includes('aria-hidden="true"'));
  });
  it('products load-error shows retry with requestId', async () => {
    const html = await renderPage('products', {
      loadError: { message: 'DB Error', requestId: 'req-123' },
    });
    assert.ok(html.includes('No se pudo abrir'));
    assert.ok(html.includes('req-123'));
    assert.ok(html.includes('Volver a intentar'));
  });
  it('empty products shows creation CTA', async () => {
    const html = await renderPage('products');
    assert.ok(html.includes('No hay productos'));
    assert.ok(html.includes('Crear primer producto'));
  });
});

// ─────────────────────────────────────────
// 7. No regression
// ─────────────────────────────────────────
describe('Phase 1D: No regression', () => {
  it('panel1 has save, no inline window.confirm', async () => {
    const html = await renderPage('page/panel1');
    assert.ok(!html.includes('onsubmit="return confirm'));
    assert.ok(!html.includes('onclick="if(confirm'));
    assert.ok(html.includes('btn-save'));
  });
  it('panel2 has save + publish with correct classes', async () => {
    const html = await renderPage('page/panel2');
    assert.ok(html.includes('btn-save'));
    assert.ok(html.includes('btn-publish'));
    assert.ok(html.includes('data-cms-publish-form'));
  });
  it('panel3 has save + publish with correct classes', async () => {
    const html = await renderPage('page/panel3');
    assert.ok(html.includes('btn-save'));
    assert.ok(html.includes('btn-publish'));
    assert.ok(html.includes('data-cms-publish-form'));
  });
  it('products delete uses data-confirm not inline confirm', async () => {
    const html = await renderPage('products', {
      products: [{ id: 1, name: 'A', categoryNames: ['C'], is_active: true, is_published: true,
        regular_price: 1, promotional_price: null, web_price: null,
        stock_quantity: 0, primary_image: null }], total: 1,
    });
    assert.ok(!html.includes('onclick="if(confirm'));
    assert.ok(html.includes('data-confirm-destructive'));
  });
  it('category delete uses data-confirm', async () => {
    const html = await renderPage('category-form', {
      action: '/admin/catalogo/categorias/1/editar',
      category: { id: 1, name: 'Test', slug: 'test', description: '', parent_id: null },
    });
    assert.ok(html.includes('data-confirm-destructive'));
    assert.ok(!html.includes('onclick="if(confirm'));
  });
});
