/**
 * Store Phase 2 — product-detail redesign tests.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { startTestServer, stopTestServer, getPort } = require('./testServer');

let BASE = 'http://localhost:3000';

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      { method: 'GET', hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}` },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, data, location: res.headers.location }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const productEjs = fs.readFileSync(path.resolve(__dirname, '../views/pages/tienda-producto.ejs'), 'utf8');
const storeController = fs.readFileSync(path.resolve(__dirname, '../controllers/storeController.js'), 'utf8');
const productJs = fs.readFileSync(path.resolve(__dirname, '../public/js/store/product-detail.js'), 'utf8');
const storeCss = fs.readFileSync(path.resolve(__dirname, '../public/css/store.css'), 'utf8');
const tiendaEjs = fs.readFileSync(path.resolve(__dirname, '../views/pages/tienda.ejs'), 'utf8');
const storeCard = fs.readFileSync(path.resolve(__dirname, '../views/components/store-card.ejs'), 'utf8');

describe('Product detail — layout integration', () => {
  test('showProduct uses layouts/store', () => {
    const showProductBlock = storeController.slice(
      storeController.indexOf('async function showProduct'),
      storeController.indexOf('module.exports')
    );
    assert.match(showProductBlock, /layout:\s*'layouts\/store'/);
    assert.doesNotMatch(showProductBlock, /usesHeroNavbar/);
    assert.doesNotMatch(showProductBlock, /\/css\/home\.css/);
  });

  test('product view includes store sidebar once', () => {
    const matches = productEjs.match(/store-sidebar/g) || [];
    assert.strictEqual(matches.length, 1);
  });

  test('product view has no homepage navbar', () => {
    assert.doesNotMatch(productEjs, /home-navbar/);
    assert.doesNotMatch(productEjs, /hero-header/);
  });

  test('catalog page remains separate from product-detail markup', () => {
    assert.doesNotMatch(tiendaEjs, /st-product__grid/);
    assert.match(tiendaEjs, /store-hero/);
  });
});

describe('Product detail — media and gallery', () => {
  test('thumbnail buttons use type=button and data attributes', () => {
    assert.match(productEjs, /type="button"/);
    assert.match(productEjs, /data-product-thumbnail/);
    assert.match(productEjs, /data-image-src/);
    assert.match(productEjs, /data-image-alt/);
    assert.match(productEjs, /aria-pressed/);
    assert.doesNotMatch(productEjs, /href="#"/);
  });

  test('main image uses data-product-main-image', () => {
    assert.match(productEjs, /data-product-main-image/);
  });

  test('duplicate image paths are deduplicated in view logic', () => {
    assert.match(productEjs, /seenPaths/);
  });

  test('JS updates main image and is idempotent', () => {
    assert.match(productJs, /WeakMap/);
    assert.match(productJs, /mainImage\.src/);
    assert.match(productJs, /aria-pressed/);
    assert.match(productJs, /ArrowDown|ArrowRight/);
    assert.doesNotMatch(productJs, /onclick=/);
  });

  test('CSS has vertical desktop and horizontal mobile thumbs', () => {
    assert.match(storeCss, /\.st-product__thumbs[\s\S]*flex-direction:\s*column/);
    assert.match(storeCss, /@media\s*\(max-width:\s*1024px\)[\s\S]*flex-direction:\s*row/);
  });
});

describe('Product detail — info and forms', () => {
  test('preserves cart form action, method, CSRF and fields', () => {
    assert.match(productEjs, /action="\/carrito\/agregar"/);
    assert.match(productEjs, /method="post"/);
    assert.match(productEjs, /name="_csrf"/);
    assert.match(productEjs, /name="productId"/);
    assert.match(productEjs, /name="quantity"/);
    assert.match(productEjs, /data-cart-quantity/);
  });

  test('has single h1 and availability text', () => {
    assert.match(productEjs, /<h1 class="st-product__title">/);
    assert.match(productEjs, /st-product__availability/);
    assert.match(productEjs, /product\.availability/);
  });

  test('uses existing priceLabel formatter output', () => {
    assert.match(productEjs, /product\.priceLabel/);
  });

  test('related products reuse store-card partial', () => {
    assert.match(productEjs, /store-card/);
    assert.match(storeCard, /st-card/);
  });

  test('WhatsApp secondary action preserved', () => {
    assert.match(productEjs, /whatsappUrl/);
    assert.match(productEjs, /rel="noopener noreferrer"/);
  });
});

describe('Product detail — accessibility and scope', () => {
  test('breadcrumb uses nav semantics', () => {
    assert.match(productEjs, /aria-label="Migas de pan"/);
    assert.match(productEjs, /aria-current="page"/);
  });

  test('no inline event handlers in product view', () => {
    assert.doesNotMatch(productEjs, /\son\w+=/);
  });

  test('focus-visible styles exist for product controls', () => {
    assert.match(storeCss, /\.st-product__thumb:focus-visible/);
    assert.match(storeCss, /\.st-product__btn:focus-visible/);
  });

  test('no schema/API changes in product view', () => {
    assert.doesNotMatch(productEjs, /ALTER TABLE|CREATE TABLE/);
  });
});

describe('Product detail — rendered pages', () => {
  before(async () => {
    await startTestServer();
    BASE = `http://127.0.0.1:${getPort()}`;
  });
  after(() => {
    stopTestServer();
  });

  let sampleSlug = '';

  test('GET /tienda returns product links', async () => {
    const r = await httpGet('/tienda');
    assert.strictEqual(r.status, 200);
    const match = r.data.match(/href="(\/tienda\/[a-z0-9-]+)"/i);
    if (match) sampleSlug = match[1];
  });

  test('product page uses store layout without hero navbar', async () => {
    if (!sampleSlug) {
      const missing = await httpGet('/tienda/producto-inexistente-xyz');
      assert.ok(missing.status === 404 || missing.status === 200);
      assert.match(missing.data, /st-sidebar/);
      assert.doesNotMatch(missing.data, /hero-header/);
      return;
    }
    const r = await httpGet(sampleSlug);
    assert.strictEqual(r.status, 200);
    assert.match(r.data, /st-sidebar/);
    assert.match(r.data, /st-product/);
    assert.match(r.data, /st-product__title/);
    assert.doesNotMatch(r.data, /hero-header/);
    assert.doesNotMatch(r.data, /home-navbar/);
    assert.match(r.data, /Agregar al carrito|Agotado/);
    assert.match(r.data, /name="_csrf"/);
  });

  test('missing product still uses store shell', async () => {
    const r = await httpGet('/tienda/producto-inexistente-phase2-test');
    assert.ok(r.status === 404 || r.status === 200);
    assert.match(r.data, /st-sidebar|Producto no encontrado/);
    assert.doesNotMatch(r.data, /hero-header/);
  });
});
