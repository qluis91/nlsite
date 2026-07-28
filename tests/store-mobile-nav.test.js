/**
 * Store Mobile Navigation — drawer, trigger, backdrop, focus, accessibility.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { startTestServer, stopTestServer, getTestServer } = require('./testServer');

let BASE = 'http://localhost:3000';

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

const storeJs = fs.readFileSync(path.resolve(__dirname, '../public/js/store/store.js'), 'utf8');
const storeCss = fs.readFileSync(path.resolve(__dirname, '../public/css/store.css'), 'utf8');
const tiendaEjs = fs.readFileSync(path.resolve(__dirname, '../views/pages/tienda.ejs'), 'utf8');
const sidebarEjs = fs.readFileSync(path.resolve(__dirname, '../views/components/store-sidebar.ejs'), 'utf8');
const drawerEjs = fs.readFileSync(path.resolve(__dirname, '../views/components/store-mobile-drawer.ejs'), 'utf8');

describe('Mobile Navigation — Markup', () => {
  test('tienda includes store-mobile-drawer partial', () => {
    assert.match(tiendaEjs, /store-mobile-drawer/);
  });

  test('tienda includes mobile backdrop element', () => {
    assert.match(tiendaEjs, /st-mobile-backdrop/);
    assert.match(tiendaEjs, /id="store-mobile-backdrop"/);
  });

  test('tienda includes menu toggle button', () => {
    assert.match(tiendaEjs, /id="store-menu-toggle"/);
    assert.match(tiendaEjs, /aria-controls="store-mobile-drawer"/);
    assert.match(tiendaEjs, /Menú/);
  });

  test('mobile drawer has Volver al inicio link', () => {
    assert.match(drawerEjs, /href="\/"/);
    assert.match(drawerEjs, /Volver al inicio/);
  });

  test('mobile drawer has Tienda link', () => {
    assert.match(drawerEjs, /href="\/tienda"/);
    assert.match(drawerEjs, /Tienda/);
  });

  test('mobile drawer has Carrito link with badge', () => {
    assert.match(drawerEjs, /href="\/carrito"/);
    assert.match(drawerEjs, /Carrito/);
    assert.match(drawerEjs, /cartItemCount/);
    assert.match(drawerEjs, /st-mobile-drawer__badge/);
  });

  test('mobile drawer has login link for guests', () => {
    assert.match(drawerEjs, /href="\/auth\/login"/);
    assert.match(drawerEjs, /Iniciar sesión/);
  });

  test('mobile drawer has Mi cuenta link for users', () => {
    assert.match(drawerEjs, /href="\/cuenta"/);
    assert.match(drawerEjs, /Mi cuenta/);
  });

  test('mobile drawer has Consultar pedido link', () => {
    assert.match(drawerEjs, /href="\/consultar-pedido"/);
    assert.match(drawerEjs, /Consultar pedido/);
  });

  test('mobile drawer has categories section', () => {
    assert.match(drawerEjs, /Categorías/);
    assert.match(drawerEjs, /Todos los productos/);
    assert.match(drawerEjs, /activeCategory/);
  });

  test('mobile drawer uses same data as sidebar (no logic duplication)', () => {
    // Both reference same variables: user, cartItemCount, categories, activeCategory, csrfToken
    assert.match(drawerEjs, /user/);
    assert.match(drawerEjs, /cartItemCount/);
    assert.match(drawerEjs, /categories/);
    assert.match(drawerEjs, /activeCategory/);
    assert.match(drawerEjs, /csrfToken/);
  });

  test('mobile drawer has close button with aria-label', () => {
    assert.match(drawerEjs, /id="store-mobile-drawer-close"/);
    assert.match(drawerEjs, /Cerrar menú/);
    assert.match(drawerEjs, /aria-label="Cerrar menú"/);
  });

  test('mobile drawer has correct ARIA attributes', () => {
    assert.match(drawerEjs, /role="dialog"/);
    assert.match(drawerEjs, /aria-modal="true"/);
    assert.match(drawerEjs, /aria-hidden="true"/);
    assert.match(drawerEjs, /aria-current="page"/);
  });

  test('mobile drawer has user section with logout for authenticated users', () => {
    assert.match(drawerEjs, /st-mobile-drawer__logout/);
    assert.match(drawerEjs, /Cerrar sesión/);
    assert.match(drawerEjs, /user\.name/);
  });

  test('mobile drawer category links preserve active state', () => {
    assert.match(drawerEjs, /activeCategory\s*&&\s*activeCategory\.slug\s*===\s*cat\.slug/);
    assert.match(drawerEjs, /aria-current="page"/);
  });
});

describe('Mobile Navigation — CSS', () => {
  test('menu trigger hidden by default', () => {
    assert.match(storeCss, /\.st-mobile-menu-trigger\s*\{[\s\S]*display:\s*none/);
  });

  test('menu trigger visible at 767px', () => {
    const mobileBlock = storeCss.match(/@media\s*\(max-width:\s*767px\)[\s\S]*?(?=\n@|$)/);
    assert.ok(mobileBlock, 'Mobile block not found');
    assert.match(mobileBlock[0], /\.st-mobile-menu-trigger\s*\{[\s\S]*display:\s*block/);
  });

  test('sidebar hidden at 767px', () => {
    const mobileBlock = storeCss.match(/@media\s*\(max-width:\s*767px\)[\s\S]*?(?=\n@|$)/);
    assert.ok(mobileBlock, 'Mobile block not found');
    assert.match(mobileBlock[0], /\.st-sidebar\s*\{[\s\S]*display:\s*none/);
  });

  test('drawer has slide transition', () => {
    assert.match(storeCss, /\.st-mobile-drawer\s*\{[\s\S]*transform:\s*translateX\(-100%\)/);
    assert.match(storeCss, /\.st-mobile-drawer\.is-open\s*\{[\s\S]*transform:\s*translateX\(0\)/);
  });

  test('backdrop has opacity transition', () => {
    assert.match(storeCss, /\.st-mobile-backdrop\s*\{[\s\S]*opacity:\s*0/);
    assert.match(storeCss, /\.st-mobile-backdrop\.is-open\s*\{[\s\S]*opacity:\s*1/);
  });

  test('reduced motion disables transitions', () => {
    assert.match(storeCss, /prefers-reduced-motion[\s\S]*\.st-mobile-backdrop/);
    assert.match(storeCss, /prefers-reduced-motion[\s\S]*transition:\s*none/);
  });

  test('drawer links have focus-visible styles', () => {
    assert.match(storeCss, /\.st-mobile-drawer__link:focus-visible/);
  });

  test('drawer close button has focus-visible', () => {
    assert.match(storeCss, /\.st-mobile-drawer__close:focus-visible/);
  });

  test('menu button has focus-visible', () => {
    assert.match(storeCss, /\.st-menu-btn:focus-visible/);
  });

  test('drawer width is constrained (max 320px)', () => {
    assert.match(storeCss, /\.st-mobile-drawer\s*\{[\s\S]*max-width:\s*320px/);
  });
});

describe('Mobile Navigation — JS behavior', () => {
  test('store.js imports initStore as named export', () => {
    assert.match(storeJs, /export function initStore/);
  });

  test('store.js references menu toggle by id', () => {
    assert.match(storeJs, /store-menu-toggle/);
  });

  test('store.js references mobile drawer by id', () => {
    assert.match(storeJs, /store-mobile-drawer/);
  });

  test('store.js references backdrop by id', () => {
    assert.match(storeJs, /store-mobile-backdrop/);
  });

  test('store.js has openDrawer function', () => {
    assert.match(storeJs, /function openDrawer/);
  });

  test('store.js has closeDrawer function', () => {
    assert.match(storeJs, /function closeDrawer/);
  });

  test('store.js opens drawer on toggle click', () => {
    assert.match(storeJs, /listen\(toggle.*click.*openDrawer/);
  });

  test('store.js closes drawer on close button click', () => {
    assert.match(storeJs, /listen\(closeBtn.*click.*closeDrawer/);
  });

  test('store.js closes drawer on backdrop click', () => {
    assert.match(storeJs, /listen\(backdrop.*click.*closeDrawer/);
  });

  test('store.js closes drawer on Escape key', () => {
    assert.match(storeJs, /key\s*===\s*'Escape'/);
    assert.match(storeJs, /closeDrawer/);
  });

  test('store.js traps focus in drawer', () => {
    assert.match(storeJs, /_trapFocus/);
    assert.match(storeJs, /first\.focus/);
    assert.match(storeJs, /last\.focus/);
  });

  test('store.js locks body scroll on open', () => {
    assert.match(storeJs, /_lockBodyScroll/);
    assert.match(storeJs, /position\s*=\s*'fixed'/);
  });

  test('store.js unlocks body scroll on close', () => {
    assert.match(storeJs, /_unlockBodyScroll/);
    assert.match(storeJs, /position\s*=\s*''/);
  });

  test('store.js closes drawer on navigation link click', () => {
    assert.match(storeJs, /drawer\.querySelectorAll\('a\[href\]'\)/);
    assert.match(storeJs, /closeDrawer\(\)/);
  });

  test('store.js closes drawer at >767px on resize', () => {
    assert.match(storeJs, /window\.innerWidth > 767/);
    assert.match(storeJs, /closeDrawer/);
  });

  test('store.js preserves sort binding', () => {
    assert.match(storeJs, /data-store-sort/);
    assert.match(storeJs, /requestSubmit/);
  });
});

describe('Mobile Navigation — Server Rendering', () => {
  before(async () => {
    await startTestServer();
    BASE = `http://127.0.0.1:${getTestServer().port}`;
  });
  after(async () => {
    await stopTestServer();
  });

  test('GET /tienda returns menu toggle in HTML', async () => {
    const r = await httpGet('/tienda');
    assert.strictEqual(r.status, 200);
    assert.match(r.data, /id="store-menu-toggle"/);
    assert.match(r.data, /Menú/);
  });

  test('GET /tienda returns mobile drawer in HTML', async () => {
    const r = await httpGet('/tienda');
    assert.strictEqual(r.status, 200);
    assert.match(r.data, /id="store-mobile-drawer"/);
    assert.match(r.data, /Volver al inicio/);
    assert.match(r.data, /Tienda/);
    assert.match(r.data, /Carrito/);
  });

  test('GET /tienda includes desktop sidebar in HTML', async () => {
    const r = await httpGet('/tienda');
    assert.strictEqual(r.status, 200);
    assert.match(r.data, /st-sidebar/);
    assert.match(r.data, /LogoCompleto/);
  });

  test('GET /tienda loads store.js as page module', async () => {
    const r = await httpGet('/tienda');
    assert.strictEqual(r.status, 200);
    assert.match(r.data, /\/js\/store\/store\.js/);
  });

  test('GET /tienda drawers categories from server', async () => {
    const r = await httpGet('/tienda');
    assert.strictEqual(r.status, 200);
    // Mobile drawer should contain category list
    assert.match(r.data, /Todos los productos/);
  });

  test('GET /tienda has backdrop element initially hidden', async () => {
    const r = await httpGet('/tienda');
    assert.strictEqual(r.status, 200);
    assert.match(r.data, /id="store-mobile-backdrop"/);
    assert.match(r.data, /aria-hidden="true"/);
  });
});

describe('Mobile Navigation — CSS No Regression', () => {
  test('navbar is still not imported in store.js', () => {
    assert.doesNotMatch(storeJs, /initNavbar/);
    assert.doesNotMatch(storeJs, /home\/navbar/);
  });

  test('sidebar still uses semantic aside', () => {
    assert.match(sidebarEjs, /<aside\s/);
  });

  test('sidebar still has logo link', () => {
    assert.match(sidebarEjs, /href="\/"/);
    assert.match(sidebarEjs, /LogoCompleto/);
  });

  test('sidebar still has categories section', () => {
    assert.match(sidebarEjs, /Categorías/);
  });

  test('search form still present in tienda', () => {
    assert.match(tiendaEjs, /st-search/);
    assert.match(tiendaEjs, /name="search"/);
  });

  test('sort select still present', () => {
    assert.match(tiendaEjs, /data-store-sort/);
  });

  test('product grid still present', () => {
    assert.match(tiendaEjs, /st-grid/);
  });

  test('pagination still present', () => {
    assert.match(tiendaEjs, /st-pagination/);
  });
});
