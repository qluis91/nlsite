/**
 * Store layout tests — Phase 1 sidebar + grid redesign.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const BASE = 'http://localhost:3000';

function httpGet(path, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    const req = http.request({ method: 'GET', hostname: url.hostname, port: url.port, path: url.pathname, headers }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const storeCss = fs.readFileSync(path.resolve(__dirname, '../public/css/store.css'), 'utf8');
const storeLayout = fs.readFileSync(path.resolve(__dirname, '../views/layouts/store.ejs'), 'utf8');
const sidebarEjs = fs.readFileSync(path.resolve(__dirname, '../views/components/store-sidebar.ejs'), 'utf8');
const storeCardEjs = fs.readFileSync(path.resolve(__dirname, '../views/components/store-card.ejs'), 'utf8');
const tiendaEjs = fs.readFileSync(path.resolve(__dirname, '../views/pages/tienda.ejs'), 'utf8');
const storeController = fs.readFileSync(path.resolve(__dirname, '../controllers/storeController.js'), 'utf8');
const storeJs = fs.readFileSync(path.resolve(__dirname, '../public/js/store/store.js'), 'utf8');

describe('Store Layout — Phase 1', () => {
  let storeHtml = '';

  test('GET /tienda returns 200', async () => {
    const r = await httpGet('/tienda');
    assert.strictEqual(r.status, 200);
    storeHtml = r.data;
  });

  // ── Layout ──
  test('store uses layouts/store layout', () => {
    assert.match(storeController, /layout:\s*'layouts\/store'/);
  });

  test('store layout has no usesHeroNavbar reference', () => {
    assert.doesNotMatch(storeLayout, /usesHeroNavbar/);
  });

  test('store layout includes footer', () => {
    assert.match(storeLayout, /include\('..\/components\/footer'\)/);
  });

  test('store layout loads footerMagicRings script', () => {
    assert.match(storeLayout, /footerMagicRings/);
  });

  // ── Sidebar ──
  test('store sidebar uses semantic <aside>', () => {
    assert.match(sidebarEjs, /<aside\s/);
    assert.match(sidebarEjs, /Navegaci/);
  });

  test('sidebar logo links to /', () => {
    assert.match(sidebarEjs, /href="\/"/);
    assert.match(sidebarEjs, /LogoCompleto\.png/);
  });

  test('sidebar has Tienda link with verified route', () => {
    assert.match(sidebarEjs, /href="\/tienda"/);
  });

  test('sidebar has Carrito link', () => {
    assert.match(sidebarEjs, /href="\/carrito"/);
  });

  test('sidebar has Consultar pedido link', () => {
    assert.match(sidebarEjs, /href="\/consultar-pedido"/);
  });

  test('sidebar has login link for guests', () => {
    assert.match(sidebarEjs, /href="\/auth\/login"/);
  });

  test('sidebar has categories section', () => {
    assert.match(sidebarEjs, /Categorías/);
    assert.match(sidebarEjs, /Todos los productos/);
  });

  test('sidebar has no placeholder href="#"', () => {
    assert.doesNotMatch(sidebarEjs, /href="#"/);
  });

  test('sidebar has aria-label on nav elements', () => {
    assert.match(sidebarEjs, /aria-label="Navegación de la tienda"/);
    assert.match(sidebarEjs, /aria-label="Páginas principales"/);
    assert.match(sidebarEjs, /aria-label="Categorías de productos"/);
  });

  test('sidebar uses aria-current for active category', () => {
    assert.match(sidebarEjs, /aria-current="page"/);
  });

  // ── Store header ──
  test('store header has search form', () => {
    assert.match(tiendaEjs, /action="\/tienda"/);
    assert.match(tiendaEjs, /name="search"/);
  });

  test('store header has result count', () => {
    assert.match(tiendaEjs, /st-header__count/);
  });

  test('store header has sort select', () => {
    assert.match(tiendaEjs, /name="sort"/);
  });

  test('store includes dynamic hero partial', () => {
    assert.match(tiendaEjs, /store-hero/);
  });

  test('sort has no inline onchange', () => {
    assert.doesNotMatch(tiendaEjs, /onchange=/);
    assert.match(tiendaEjs, /data-store-sort/);
  });

  test('store JS binds sort control', () => {
    assert.match(storeJs, /data-store-sort/);
    assert.match(storeJs, /requestSubmit/);
  });

  // ── Product cards ──
  test('product cards show category', () => {
    assert.match(storeCardEjs, /st-card__category/);
  });

  test('product cards show title', () => {
    assert.match(storeCardEjs, /st-card__title/);
  });

  test('product cards show price', () => {
    assert.match(storeCardEjs, /st-card__price/);
    assert.match(storeCardEjs, /product\.priceLabel/);
  });

  test('product cards show availability', () => {
    assert.match(storeCardEjs, /st-card__availability/);
    assert.match(storeCardEjs, /product\.availability/);
  });

  test('product cards link to product-detail URL', () => {
    assert.match(storeCardEjs, /href="<%= product\.url %>"/);
  });

  test('product cards have image fallback', () => {
    assert.match(storeCardEjs, /NINJALAB/);
  });

  test('product card has no description field', () => {
    assert.doesNotMatch(storeCardEjs, /description/);
  });

  // ── CSS checks ──
  test('store CSS has sidebar sticky with viewport height', () => {
    assert.match(storeCss, /\.st-sidebar\s*\{/);
    assert.match(storeCss, /position:\s*sticky/);
    assert.match(storeCss, /height:\s*100vh/);
  });

  test('store CSS has responsive grid', () => {
    assert.match(storeCss, /grid-template-columns:\s*repeat\(auto-fill/);
  });

  test('store CSS has mobile collapse breakpoint', () => {
    assert.match(storeCss, /@media\s*\(max-width:\s*767px\)/);
    assert.match(storeCss, /flex-direction:\s*column/);
  });

  test('store CSS defines dark theme variables', () => {
    assert.match(storeCss, /--store-sidebar-bg:\s*#[0-9a-fA-F]{6}/);
  });

  test('store CSS light main gradient present', () => {
    assert.match(storeCss, /#f4f6f3/);
  });

  test('store JS has no navbar import', () => {
    assert.doesNotMatch(storeJs, /initNavbar/);
    assert.doesNotMatch(storeJs, /home\/navbar/);
  });

  test('store JS has no filter toggle DOM references', () => {
    assert.doesNotMatch(storeJs, /data-store-filter/);
  });
});

describe('Store Layout — Server rendering', () => {
  test('/tienda renders without hero navbar', () => {
    // The store layout does not include hero-header or home-navbar
    assert.doesNotMatch(storeLayout, /hero-header/);
    assert.doesNotMatch(storeLayout, /home-navbar/);
  });

  test('/tienda uses store layout not main layout', () => {
    // Layout file doesn't include hero-header or usesHeroNavbar
    assert.doesNotMatch(storeLayout, /hero-header/);
    assert.doesNotMatch(storeLayout, /home-navbar/);
    assert.doesNotMatch(storeLayout, /usesHeroNavbar/);
    assert.match(storeLayout, /footer/);
  });

  test('/tienda page includes store-sidebar partial', () => {
    assert.match(tiendaEjs, /include\('..\/components\/store-sidebar'\)/);
  });

  test('/tienda page includes store-card partial', () => {
    assert.match(tiendaEjs, /include\('..\/components\/store-card'/);
  });

  test('/tienda page loads store.css', () => {
    assert.match(storeController, /\/css\/store\.css/);
  });

  test('/tienda page does NOT load home.css', () => {
    const showStoreRender = storeController.match(/showStore[\s\S]*?res\.render[\s\S]*?pageStyles/);
    if (showStoreRender) {
      assert.doesNotMatch(showStoreRender[0], /\/css\/home\.css/);
    }
  });
});
