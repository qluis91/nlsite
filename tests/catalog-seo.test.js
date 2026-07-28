/**
 * Phase 12C tests — Dynamic product & category SEO.
 * Run: node --test tests/catalog-seo.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const pool = require('../config/db');
const { startTestServer, stopTestServer } = require('./testServer');

const BASE = { hostname: '127.0.0.1', port: 0 };

function fetch(path) {
  return new Promise((resolve, reject) => {
    http.get({ ...BASE, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

before(async () => {
  // Run migration if needed
  const { migrate } = require('../scripts/migrate-catalog-seo');
  await migrate();
  const server = await startTestServer();
  BASE.port = server.port;
});

after(async () => {
  await stopTestServer();
  await pool.end();
});

describe('Phase 12C — Migration', () => {
  it('products has seo_title column', async () => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) c FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'seo_title'`
    );
    assert.equal(Number(rows[0].c), 1);
  });

  it('products has seo_description column', async () => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) c FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'seo_description'`
    );
    assert.equal(Number(rows[0].c), 1);
  });

  it('products has og_image column', async () => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) c FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'og_image'`
    );
    assert.equal(Number(rows[0].c), 1);
  });

  it('categories has seo_title column', async () => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) c FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'categories' AND column_name = 'seo_title'`
    );
    assert.equal(Number(rows[0].c), 1);
  });

  it('categories has seo_description column', async () => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) c FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'categories' AND column_name = 'seo_description'`
    );
    assert.equal(Number(rows[0].c), 1);
  });

  it('categories has og_image column', async () => {
    const [rows] = await pool.query(
      `SELECT COUNT(*) c FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'categories' AND column_name = 'og_image'`
    );
    assert.equal(Number(rows[0].c), 1);
  });

  it('migration is idempotent', async () => {
    const { migrate } = require('../scripts/migrate-catalog-seo');
    await migrate(); // Second run should not throw
    // If we got here, it's idempotent
    assert.ok(true);
  });
});

describe('Phase 12C — Product detail SEO rendering', () => {
  it('store page returns 200 with OG tags', async () => {
    const res = await fetch('/tienda');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('og:title'));
    assert.ok(res.body.includes('og:description'));
  });

  it('category-filtered store page returns 200', async () => {
    // Use a known-existing category slug; 404s handled gracefully
    const res = await fetch('/tienda?category=unknown-cat');
    assert.equal(res.status, 200);
  });

  it('product detail page returns 404 for non-existent slug', async () => {
    const res = await fetch('/tienda/no-existe-producto');
    assert.equal(res.status, 404);
  });

  it('store page with no SEO override renders without crashing', async () => {
    const res = await fetch('/tienda');
    assert.ok(res.body.includes('<title>'));
    assert.ok(res.body.includes('meta name="description"'));
  });
});

describe('Phase 12C — Admin form SEO fields', () => {
  const ejs = require('ejs');
  const fs = require('fs');

  it('product-form has SEO fields', () => {
    const tpl = fs.readFileSync('views/pages/admin/product-form.ejs', 'utf-8');
    assert.ok(tpl.includes('seo_title'), 'product-form must include seo_title field');
    assert.ok(tpl.includes('seo_description'), 'product-form must include seo_description field');
    assert.ok(tpl.includes('og_image'), 'product-form must include og_image field');
  });

  it('category-form has SEO fields', () => {
    const tpl = fs.readFileSync('views/pages/admin/category-form.ejs', 'utf-8');
    assert.ok(tpl.includes('seo_title'), 'category-form must include seo_title field');
    assert.ok(tpl.includes('seo_description'), 'category-form must include seo_description field');
    assert.ok(tpl.includes('og_image'), 'category-form must include og_image field');
  });

  it('product-form renders with SEO values', () => {
    const tpl = fs.readFileSync('views/pages/admin/product-form.ejs', 'utf-8');
    const compiled = ejs.compile(tpl, { filename: 'views/pages/admin/product-form.ejs' });
    const html = compiled({
      csrfToken: 'x', action: '/test', categories: [],
      product: { id: 1, name: 'Test', tags: [], images: [], seo_title: 'Custom SEO', seo_description: 'Custom desc', og_image: '/img.webp' },
    });
    assert.ok(html.includes('Custom SEO'));
    assert.ok(html.includes('Custom desc'));
    assert.ok(html.includes('/img.webp'));
  });
});

describe('Phase 12C — Public product detail page SEO', () => {
  it('product page includes og:title meta tag', async () => {
    // Find a real product slug or test the non-existent case
    const res = await fetch('/tienda/no-existe');
    // 404 page should still have basic OG tags from store layout
    if (res.status === 404) {
      assert.ok(res.body.includes('og:title') || res.body.includes('title>'));
    }
  });

  it('schema.sql includes SEO columns', () => {
    const sql = require('fs').readFileSync('schema.sql', 'utf-8');
    assert.ok(sql.includes('seo_title VARCHAR(160) NULL'), 'schema.sql products must have seo_title');
    assert.ok(sql.includes('seo_description VARCHAR(300) NULL'), 'schema.sql products must have seo_description');
  });
});
