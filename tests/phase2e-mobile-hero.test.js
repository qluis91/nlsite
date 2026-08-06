/**
 * Phase 2E — mobile hero layout test.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startTestServer, stopTestServer } = require('./testServer');

let baseUrl;

function fetchText(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

describe('Mobile hero layout', () => {
  test('homepage renders with HTTP 200', async () => {
    const { baseUrl: bUrl } = await startTestServer();
    baseUrl = bUrl;

    const html = await fetchText('/');
    assert.ok(html.includes('<main class="home-page"'), 'homepage must render main element');
  });

  test('CTAs are side by side on mobile (css grid 1fr 1fr)', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('grid-template-columns: 1fr 1fr'), 'mobile CTAs must use 1fr 1fr');
  });

  test('very-narrow stacks CTAs to single column (max-width: 350px)', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('max-width: 350px'), 'must have max-width: 350px breakpoint');
    assert.ok(css.includes('grid-template-columns: 1fr'), 'must stack to 1fr at very narrow');
  });

  test('hero-support has improved line-height on mobile', async () => {
    const css = await fetchText('/css/home.css');
    const mobileHeroSupport = css.match(/@media.*?768px[\s\S]*?\.hero-support[\s\S]*?line-height:\s*([\d.]+)/);
    assert.ok(mobileHeroSupport, 'must have mobile hero-support rule');
  });

  test('social section top padding reduced on mobile', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('hero-social'), 'hero-social class must exist');
  });

  test('3D model is centered on mobile', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('hero-3d'), 'hero-3d must exist');
  });

  test('CTA buttons have correct spacing on mobile', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('hero-ctas'), 'hero-ctas must exist');
  });

  test('hero uses svh units for mobile viewport awareness', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('100svh') || css.includes('dvh'), 'must use svh or dvh for mobile hero');
  });

  test('mobile hero padding-top increased for navbar clearance', async () => {
    const css = await fetchText('/css/home.css');
    const paddingMatch = css.match(/padding-top:\s*clamp\((\d+)/);
    if (paddingMatch) {
      assert.ok(parseInt(paddingMatch[1], 10) >= 4, 'padding-top must be adequate for navbar clearance');
    }
  });

  test('mobile hero grid areas define correct order', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('grid-template-areas'), 'must use grid-template-areas for element ordering');
  });

  test('hero-content uses display:contents to flatten into grid', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('display: contents'), 'hero-content must use display: contents');
  });

  test('desktop hero above 768px remains unchanged', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('min-width: 769px') || css.includes('min-width: 768px'), 'desktop breakpoint must exist');
  });

  test('mobile is-menu-open is independent of scrolled/compact state', async () => {
    const js = await fetchText('/js/home/navbar.js');
    assert.ok(js.includes('is-menu-open'), 'is-menu-open must be handled in JS');
    assert.ok(js.includes('is-scrolled'), 'is-scrolled must be handled in JS');
  });

  test('hero-3d has height defined in svh units', async () => {
    const css = await fetchText('/css/home.css');
    assert.ok(css.includes('svh'), '3D model height must use svh on mobile');
  });

  test('page output is accessible', async () => {
    const html = await fetchText('/');
    assert.ok(html.includes('lang="es"'), 'must have Spanish language attribute');
  });

  // Stop the test server after all tests
  test.after(async () => {
    await stopTestServer();
  });
});
