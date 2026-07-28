/**
 * Phase 12B tests — Page-specific SEO.
 * Run: node --test tests/page-seo.test.js
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
  const server = await startTestServer();
  BASE.port = server.port;
});

after(async () => {
  await stopTestServer();
  await pool.end();
});

describe('Phase 12B — Admin card registration', () => {
  it('CMS_MODULES includes page-seo card', () => {
    const { CMS_MODULES } = require('../controllers/adminPageController');
    const card = CMS_MODULES.find(m => m.key === 'page-seo');
    assert.ok(card, 'page-seo module must exist');
    assert.equal(card.title, 'SEO por página');
    assert.equal(card.status, 'active');
    assert.equal(card.href, '/admin/page/page-seo');
  });
});

describe('Phase 12B — Controller structure', () => {
  const ctrl = require('../controllers/adminPageSeoController');

  it('PAGES has home, store, gallery', () => {
    assert.equal(ctrl.PAGES.length, 3);
    const keys = ctrl.PAGES.map(p => p.key);
    assert.ok(keys.includes('home'));
    assert.ok(keys.includes('store'));
    assert.ok(keys.includes('gallery'));
  });

  it('pageSettingKey builds correct key', () => {
    assert.equal(ctrl.pageSettingKey('home', 'title'), 'seo.home.title');
    assert.equal(ctrl.pageSettingKey('store', 'og_image'), 'seo.store.og_image');
    assert.equal(ctrl.pageSettingKey('gallery', 'robots'), 'seo.gallery.robots');
  });

  it('allKeys returns 15 keys (3 pages x 5 fields)', () => {
    const keys = ctrl.allKeys();
    assert.equal(keys.length, 15);
    assert.ok(keys.includes('seo.home.title'));
    assert.ok(keys.includes('seo.store.description'));
    assert.ok(keys.includes('seo.gallery.canonical'));
  });
});

describe('Phase 12B — Page SEO persistence', () => {
  after(async () => {
    await pool.query("DELETE FROM site_settings WHERE setting_key LIKE 'seo.%'");
  });

  it('upserts seo.home.title', async () => {
    const publishing = require('../services/cmsPublishingService');
    await publishing.upsertSetting('seo.home.title', 'PageSEO Home Title', 'string', {
      settingGroup: 'seo', isPublic: true, actorId: null,
    });
    const settings = await publishing.getPublishedSettings(['seo.home.title']);
    assert.equal(settings['seo.home.title'], 'PageSEO Home Title');
  });

  it('upserts seo.store.description', async () => {
    const publishing = require('../services/cmsPublishingService');
    await publishing.upsertSetting('seo.store.description', 'Store Desc', 'string', {
      settingGroup: 'seo', isPublic: true, actorId: null,
    });
    const settings = await publishing.getPublishedSettings(['seo.store.description']);
    assert.equal(settings['seo.store.description'], 'Store Desc');
  });

  it('upserts seo.gallery.robots', async () => {
    const publishing = require('../services/cmsPublishingService');
    await publishing.upsertSetting('seo.gallery.robots', 'noindex,nofollow', 'string', {
      settingGroup: 'seo', isPublic: true, actorId: null,
    });
    const settings = await publishing.getPublishedSettings(['seo.gallery.robots']);
    assert.equal(settings['seo.gallery.robots'], 'noindex,nofollow');
  });

  it('upserts seo.home.canonical', async () => {
    const publishing = require('../services/cmsPublishingService');
    await publishing.upsertSetting('seo.home.canonical', 'https://mysite.com', 'string', {
      settingGroup: 'seo', isPublic: true, actorId: null,
    });
    const settings = await publishing.getPublishedSettings(['seo.home.canonical']);
    assert.equal(settings['seo.home.canonical'], 'https://mysite.com');
  });

  it('all 15 seo keys can be loaded at once', async () => {
    const { allKeys } = require('../controllers/adminPageSeoController');
    const publishing = require('../services/cmsPublishingService');
    const settings = await publishing.getPublishedSettings(allKeys());
    assert.equal(typeof settings, 'object');
  });
});

describe('Phase 12B — Public HTML rendering', () => {
  it('homepage returns 200 with SEO tags', async () => {
    const res = await fetch('/');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('og:title'));
    assert.ok(res.body.includes('og:description'));
    assert.ok(res.body.includes('twitter:card'));
    assert.ok(res.body.includes('name="description"'));
  });

  it('store page returns 200 with SEO tags', async () => {
    const res = await fetch('/tienda');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('og:title'));
    assert.ok(res.body.includes('og:description'));
    assert.ok(res.body.includes('twitter:card'));
  });

  it('gallery page returns 200 with SEO tags', async () => {
    const res = await fetch('/galeria');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('og:title'));
    assert.ok(res.body.includes('og:description'));
    assert.ok(res.body.includes('twitter:card'));
  });

  it('store page has page-specific title from controller (not overwritten)', async () => {
    const res = await fetch('/tienda');
    // Controller passes title: 'Tienda de impresión 3D', so <title> should include it
    assert.ok(res.body.includes('Tienda de impresión 3D'), 'Store page title from controller');
  });

  it('non-existent path renders 404 without crashing', async () => {
    const res = await fetch('/nonexistent-page');
    assert.equal(res.status, 404);
  });
});

describe('Phase 12B — View compilation', () => {
  const ejs = require('ejs');
  const fs = require('fs');

  it('page-seo.ejs renders with minimal data', () => {
    const tpl = fs.readFileSync('views/pages/admin/page/page-seo.ejs', 'utf-8');
    const compiled = ejs.compile(tpl, { filename: 'views/pages/admin/page/page-seo.ejs' });
    const html = compiled({
      csrfToken: 'x',
      pages: [
        { key: 'home', label: 'Inicio', path: '/' },
        { key: 'store', label: 'Tienda', path: '/tienda' },
        { key: 'gallery', label: 'Galería', path: '/galeria' },
      ],
      activePage: 'home',
      settings: { 'seo.home.title': '', 'seo.home.description': '', 'seo.home.og_image': '', 'seo.home.canonical': '', 'seo.home.robots': '' },
      ogMedia: { home: null, store: null, gallery: null },
      indexingModes: [
        { value: 'index,follow', label: 'Indexar y seguir' },
        { value: 'noindex,nofollow', label: 'No indexar' },
      ],
    });
    assert.ok(html.includes('SEO por página'));
    assert.ok(html.includes('Inicio'));
    assert.ok(html.includes('Tienda'));
    assert.ok(html.includes('Galería'));
    assert.ok(html.includes('page_key'));
  });

  it('page-seo.ejs shows active tab for store page', () => {
    const tpl = fs.readFileSync('views/pages/admin/page/page-seo.ejs', 'utf-8');
    const compiled = ejs.compile(tpl, { filename: 'views/pages/admin/page/page-seo.ejs' });
    const html = compiled({
      csrfToken: 'x',
      pages: [
        { key: 'home', label: 'Inicio', path: '/' },
        { key: 'store', label: 'Tienda', path: '/tienda' },
        { key: 'gallery', label: 'Galería', path: '/galeria' },
      ],
      activePage: 'store',
      settings: { 'seo.store.title': '', 'seo.store.description': '', 'seo.store.og_image': '', 'seo.store.canonical': '', 'seo.store.robots': '' },
      ogMedia: { home: null, store: null, gallery: null },
      indexingModes: [
        { value: 'index,follow', label: 'Indexar y seguir' },
      ],
    });
    assert.ok(html.includes('page-seo/save'));
    // The hidden page_key input should be 'store'
    assert.ok(html.includes('value="store"'));
  });
});
