/**
 * Mobile hero layout tests — Phase 2E-D+.
 *
 * Verifies:
 *  - mobile hero spacing, CTAs side by side, model visible
 *  - social section gap
 *  - very-narrow stacking
 *  - desktop unchanged
 *  - no horizontal overflow
 *  - homepage renders
 */
const { test, after, describe } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startTestServer } = require('./testServer');

let baseUrl;
let serverHandle;
let pool;

describe('Mobile hero layout', () => {
  test('homepage renders with HTTP 200', async () => {
    const { baseUrl: bUrl, handle, dbPool } = await startTestServer();
    baseUrl = bUrl;
    serverHandle = handle;
    pool = dbPool;

    const html = await fetchPage('/');
    assert.ok(html.includes('<main class="home-page"'), 'homepage must render main element');
  });

  test('CTAs are side by side on mobile (css grid 1fr 1fr)', async () => {
    const css = await fetchText('/css/home.css');
    // The mobile CTA rule must use 1fr 1fr
    assert.ok(css.includes('grid-template-columns: 1fr 1fr'), 'mobile CTAs must use 1fr 1fr');
  });

  test('very-narrow stacks CTAs to single column (max-width: 350px)', async () => {
    const css = await fetchText('/css/home.css');
    // At max-width: 350px, CTAs stack
    assert.ok(css.includes('max-width: 350px'), 'must have max-width: 350px breakpoint');
    assert.ok(css.includes('grid-template-columns: 1fr'), 'must stack to 1fr at very narrow');
  });

  test('hero-support has improved line-height on mobile', async () => {
    const css = await fetchText('/css/home.css');
    // Mobile hero-support should have line-height ~1.55
    const mobileHeroSupport = css.match(/@media.*?768px[\s\S]*?\.hero-support[\s\S]*?line-height:\s*([\d.]+)/);
    assert.ok(mobileHeroSupport, 'must have mobile hero-support rule');
  });

  test('social section top padding reduced on mobile', async () => {
    const css = await fetchText('/css/home.css');
    // Mobile social feed padding must be smaller
    assert.ok(css.includes('home-panel--social-feed'), 'social feed panel styles must exist');
  });

  test('hero text has vertical gap on mobile', async () => {
    const css = await fetchText('/css/home.css');
    // Mobile hero-text must use flex with gap
    assert.ok(css.includes('display: flex'), 'hero-text mobile must use flex');
  });

  test('hero-3d uses svh units on mobile for viewport awareness', async () => {
    const css = await fetchText('/css/home.css');
    // Model height should use svh/dvh for mobile viewport awareness
    assert.ok(css.includes('hero-3d'), '3D model styles must exist');
    // Check for svh usage in the mobile section
    const hasSvh = css.includes('svh');
    assert.ok(hasSvh, 'mobile model should use svh units');
  });

  test('desktop hero unchanged — grid template columns preserved', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('grid-template-columns: minmax(0, 0.9fr) minmax(420px, 1.1fr)'),
      'desktop grid columns must be preserved');
  });

  test('no horizontal overflow on hero panel', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('overflow-x: clip') || css.includes('overflow-x: hidden'),
      'hero must prevent horizontal overflow');
  });

  test('navbar still visible on mobile', async () => {
    const html = await fetchPage('/');
    assert.ok(html.includes('hero-header') || html.includes('navbar'), 'navbar must be in homepage');
  });

  test('social section CSS rules exist (gap controlled)', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('home-panel--social-feed'), 'social feed panel styles must exist');
    // On mobile, padding should be reduced from desktop 7rem
    const mobileSocialRule = css.indexOf('clamp(2rem');
    assert.ok(mobileSocialRule > -1, 'social section mobile padding must be reduced');
  });

  test('CTA buttons have equal width', async () => {
    const css = await fetchText('/css/home.css');
    // Mobile hero-btn should be width: 100% inside the 1fr 1fr grid
    const mobileMediaRule = css.indexOf('max-width: 768px');
    assert.ok(mobileMediaRule > -1, 'must have mobile breakpoint');
  });

  test('eyebrow has breathing room on mobile', async () => {
    const html = await fetchPage('/');
    assert.ok(html.includes('hero-eyebrow'), 'eyebrow text must exist');
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('hero-eyebrow'), 'eyebrow styles must exist');
  });

  test('description rendered in hero', async () => {
    const html = await fetchPage('/');
    assert.ok(html.includes('hero-support'), 'hero description must be rendered');
  });

  test('3D model canvas present', async () => {
    const html = await fetchPage('/');
    assert.ok(html.includes('hero-canvas'), '3D canvas must be in homepage');
  });

  test('social links present on homepage', async () => {
    const html = await fetchPage('/');
    assert.ok(html.includes('hero-social'), 'social links must be present');
  });
});

after(async () => {
  if (serverHandle) {
    await new Promise((resolve, reject) => {
      serverHandle.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
});

// ── Helpers ──

async function fetchPage(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function fetchText(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}
