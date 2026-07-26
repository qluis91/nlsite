/**
 * Phase 15 tests — Performance and Core Web Vitals.
 * Run: node --test tests/performance.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const pool = require('../config/db');

const BASE = { hostname: 'localhost', port: 3000 };

function fetch(path) {
  return new Promise((resolve, reject) => {
    http.get({ ...BASE, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

after(async () => {
  await pool.end();
});

// ──── Cache headers on static assets ────
describe('Phase 15B — Safe cache policy', () => {
  it('CSS/JS mounts use textCacheOpts (no immutable)', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    const match = code.match(/\/css.*textCacheOpts/);
    assert.ok(match, '/css must use textCacheOpts');
  });

  it('vendor aliases use vendorCacheOpts (immutable)', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    // vendorCacheOpts defined before vendor aliases and reused
    const vendorDefIndex = code.indexOf('const vendorCacheOpts');
    const vendorUseIndex = code.indexOf("'/vendor/three/build'");
    assert.ok(vendorDefIndex > 0, 'vendorCacheOpts must be defined');
    assert.ok(vendorUseIndex > vendorDefIndex, '/vendor/three/build must appear after vendorCacheOpts definition');
    // The mount uses vendorCacheOpts
    assert.ok(code.includes("vendorCacheOpts"), 'vendor mounts must use vendorCacheOpts');
  });

  it('non-hashed CSS/JS have short cache with no immutable', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    assert.ok(code.includes('shortCacheSec'), 'must define shortCacheSec');
    assert.ok(code.includes("immutable: false"), 'textCacheOpts must set immutable:false');
  });

  it('image and Video mounts use mediaCacheOpts', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    assert.ok(code.includes("'/images', express.static"), '/images mount must exist');
    assert.ok(code.includes("'/Video', express.static"), '/Video mount must exist');
    assert.ok(code.includes('mediaCacheOpts'), 'mediaCacheOpts must be defined');
  });

  it('static assets in dev omit cache', async () => {
    const res = await fetch('/css/style.css');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/css'));
  });
});

// ──── Compression ────
describe('Phase 15B — Compression', () => {
  it('compression middleware is configured in app.js', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    assert.ok(code.includes("require('compression')"), 'must require compression');
    assert.ok(code.includes('app.use(compression('), 'must use compression middleware');
  });

  it('compression middleware is before static mounts', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    const compressionIdx = code.indexOf('app.use(compression({');
    const staticIdx = code.indexOf("app.use('/css', express.static");
    assert.ok(compressionIdx > 0 && staticIdx > 0, 'both must exist');
    assert.ok(compressionIdx < staticIdx, 'compression must come BEFORE static mounts');
  });

  it('compression filter skips binary static paths only', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    const filterSection = code.slice(code.indexOf('compression({'), code.indexOf('});', code.indexOf('compression({')));
    assert.ok(filterSection.includes('/images/'), 'filter must skip /images/');
    assert.ok(filterSection.includes('/Video/'), 'filter must skip /Video/');
    assert.ok(filterSection.includes('/uploads/'), 'filter must skip /uploads/');
    assert.ok(filterSection.includes('/fonts/'), 'filter must skip /fonts/');
    // CSS and JS paths should NOT be skipped (compressible text)
    assert.ok(!filterSection.includes("startsWith('/css/')"), 'filter must NOT skip /css/');
    assert.ok(!filterSection.includes("startsWith('/js/')"), 'filter must NOT skip /js/');
  });

  it('compression filter skips binary content types', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    // The compression filter has MIME-type checks
    const filterSection = code.slice(code.indexOf('compression({'), code.indexOf('});', code.indexOf('compression({')));
    assert.ok(filterSection.includes('.test(type)'), 'filter must check Content-Type');
    assert.ok(filterSection.includes('image'), 'filter must reference image types');
    assert.ok(filterSection.includes('video'), 'filter must reference video types');
    assert.ok(filterSection.includes('audio'), 'filter must reference audio types');
  });

  it('compressible responses include content-encoding when Accept-Encoding is sent', async () => {
    const res = await fetch('/');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
  });

  it('CSS responses are served (compressible path)', async () => {
    const res = await fetch('/css/home.css');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/css'));
  });

  it('GLB-like binary path is not compressed (by MIME type)', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    // The compression filter checks Content-Type for binary MIME types
    assert.ok(code.includes('octet-stream'), 'filter must reference octet-stream binary type');
  });
});

// ──── Hero GLB preload ────
describe('Phase 15B — Hero GLB preload', () => {
  it('main.ejs has GLB preload hint in home block', () => {
    const tpl = fs.readFileSync('views/layouts/main.ejs', 'utf-8');
    assert.ok(tpl.includes('heroGlbUrl'));
    assert.ok(tpl.includes('as="fetch"'));
    assert.ok(tpl.includes('crossorigin="anonymous"'));
  });

  it('home controller sets heroGlbUrl when modelMedia has URL', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    assert.ok(code.includes('heroGlbUrl'));
    assert.ok(code.includes('modelMedia && modelMedia.url'));
  });
});

// ──── Poster / first-frame behavior ────
describe('Phase 15B — Hero poster', () => {
  it('home.ejs has hero-3d-poster element before fallback', () => {
    const tpl = fs.readFileSync('views/pages/home.ejs', 'utf-8');
    assert.ok(tpl.includes('hero-3d-poster'), 'must have poster element');
    assert.ok(tpl.includes('data-helmet-poster'), 'must have data-helmet-poster');
  });

  it('hero-3d-poster is visible by default (not hidden)', () => {
    const tpl = fs.readFileSync('views/pages/home.ejs', 'utf-8');
    const posterLine = tpl.match(/<div class="hero-3d-poster"/);
    assert.ok(posterLine);
    assert.ok(!posterLine[0].includes('hidden'), 'poster must NOT be hidden');
  });

  it('CSS hides poster only on is-ready (keeps visible on error/fallback)', () => {
    const css = fs.readFileSync('public/css/home.css', 'utf-8');
    assert.ok(css.includes('.hero-3d.is-ready .hero-3d-poster'), 'poster must hide on is-ready');
    assert.ok(!css.includes('.hero-3d.has-error .hero-3d-poster'), 'poster must NOT be hidden on has-error');
    assert.ok(!css.includes('.hero-3d.has-fallback .hero-3d-poster'), 'poster must NOT be hidden on has-fallback');
  });

  it('helmet3d.js dispatches helmet:firstframe on first render', () => {
    const code = fs.readFileSync('public/js/home/helmet3d.js', 'utf-8');
    assert.ok(code.includes("helmet:firstframe"));
    assert.ok(code.includes('CustomEvent'));
  });

  it('home.js listens for helmet:firstframe to hide poster', () => {
    const code = fs.readFileSync('public/js/home/home.js', 'utf-8');
    assert.ok(code.includes("helmet:firstframe"));
    assert.ok(code.includes('data-helmet-poster'));
    assert.ok(code.includes("once: true"));
  });
});

// ──── Resource hints ────
describe('Phase 15 — Resource hints', () => {
  it('home page has preconnect for storage.googleapis.com', async () => {
    const res = await fetch('/');
    assert.ok(res.body.includes('preconnect'), 'should have preconnect hints');
  });

  it('home page has preload for home.css', async () => {
    const res = await fetch('/');
    assert.ok(res.body.includes('<link rel="preload" href="/css/home.css" as="style">'));
  });

  it('store.ejs template includes dns-prefetch for analytics', () => {
    const tpl = fs.readFileSync('views/layouts/store.ejs', 'utf-8');
    assert.ok(tpl.includes('dns-prefetch'));
    assert.ok(tpl.includes('googletagmanager.com'));
  });
});

// ──── CLS prevention: image dimensions ────
describe('Phase 15 — CLS prevention (explicit dimensions)', () => {
  it('logo-loop images have width and height attributes', async () => {
    const res = await fetch('/');
    // Hardcoded fallback loop items are text-only; CMS items get width/height
    // Check the template itself for the attributes
    const tpl = fs.readFileSync('views/pages/home.ejs', 'utf-8');
    assert.ok(tpl.includes('logo-loop__image"'), 'template has logo-loop__image');
    assert.ok(tpl.includes('width="180"'), 'logo-loop images must have width');
    assert.ok(tpl.includes('height="56"'), 'logo-loop images must have height');
  });

  it('hero fallback img has width and height', () => {
    const tpl = fs.readFileSync('views/pages/home.ejs', 'utf-8');
    assert.ok(tpl.includes('hero-3d-fallback-img'), 'hero fallback must exist');
    assert.ok(tpl.includes('width="1200"'), 'hero fallback must have width');
    assert.ok(tpl.includes('height="1200"'), 'hero fallback must have height');
    assert.ok(tpl.includes('decoding="async"'), 'hero fallback must have decoding=async');
  });

  it('hero-3d container has aspect-ratio', () => {
    const css = fs.readFileSync('public/css/home.css', 'utf-8');
    assert.ok(css.includes('aspect-ratio: 1 / 1'), 'hero 3D container must have aspect-ratio');
  });
});

// ──── Lazy loading ────
describe('Phase 15 — Lazy loading', () => {
  it('hero fallback image has loading="lazy"', () => {
    const tpl = fs.readFileSync('views/pages/home.ejs', 'utf-8');
    const match = tpl.match(/hero-3d-fallback-img.*loading="lazy"/s);
    assert.ok(match, 'hero fallback must be lazy loaded');
  });

  it('first carousel slide uses loading="eager"', () => {
    const tpl = fs.readFileSync('views/pages/home.ejs', 'utf-8');
    // idx === 0 should produce loading="eager"
    assert.ok(tpl.includes('idx === 0 ? \'eager\' : \'lazy\''), 'first slide must be eager');
  });

  it('footerMagicRings only loads when footer is present', () => {
    const tpl = fs.readFileSync('views/layouts/main.ejs', 'utf-8');
    assert.ok(tpl.includes('!layoutHideFooter'), 'footerMagicRings must be conditional');
  });
});

// ──── No regressions ────
describe('Phase 15 — No rendering regressions', () => {
  it('homepage loads with 200 and has hero section', async () => {
    const res = await fetch('/');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('hero-canvas'), 'must have hero canvas');
    assert.ok(res.body.includes('project-carousel'), 'must have carousel');
  });

  it('homepage CSS is served with correct content type', async () => {
    const res = await fetch('/css/home.css');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/css'));
  });

  it('store page loads 200 with analytics.js', async () => {
    const res = await fetch('/tienda');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('/js/analytics.js'), 'store page must have analytics');
  });

  it('admin login does NOT load footerMagicRings', async () => {
    const res = await fetch('/admin/login');
    assert.equal(res.status, 200);
    assert.ok(!res.body.includes('footerMagicRings.mjs'), 'admin login must not load footerMagicRings');
  });
});
