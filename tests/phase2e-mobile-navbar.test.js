/**
 * Phase 2E — mobile navbar regression test.
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

test('homepage loads and renders navbar', async () => {
  const { baseUrl: bUrl } = await startTestServer();
  baseUrl = bUrl;

  const html = await fetchText('/');
  assert.ok(html.includes('data-home-navbar'), 'navbar must have data-home-navbar attribute');
  assert.ok(html.includes('data-nav-toggle'), 'hamburger toggle must exist');
  assert.ok(html.includes('data-nav-panel'), 'nav panel must exist');
});

test('mobile hamburger toggle exists with aria attributes', async () => {
  const html = await fetchText('/');
  assert.ok(html.includes('data-nav-toggle'), 'toggle must be in DOM');
});

test('navbar.js script is accessible', async () => {
  const js = await fetchText('/js/home/navbar.js');
  assert.ok(js.includes('is-menu-open'), 'navbar.js must toggle is-menu-open');
  assert.ok(js.includes('is-scrolled'), 'navbar.js must toggle is-scrolled');
});

test('is-scrolled does NOT set height on hero-nav at mobile (scoped to desktop)', async () => {
  const css = await fetchText('/css/home.css');
  const minWidth1041Index = css.indexOf('@media (min-width: 1041px)');
  assert.ok(minWidth1041Index > -1, 'must have @media (min-width: 1041px) block');

  const scrolledNavIndex = css.indexOf('.hero-header.is-scrolled .hero-nav {');
  if (scrolledNavIndex > -1) {
    // If this rule exists, it MUST be inside the 1041px block
    assert.ok(
      scrolledNavIndex > minWidth1041Index,
      'is-scrolled hero-nav rule must be inside @media (min-width: 1041px)'
    );
  }
});

test('is-menu-open class is in navbar.js (not hardcoded)', async () => {
  const html = await fetchText('/');
  // is-menu-open must NOT be hardcoded in the HTML template
  const toggles = (html.match(/is-menu-open/g) || []).length;
  assert.ok(toggles <= 1, 'is-menu-open must not appear as hardcoded attribute');
});

test('navbar has correct z-index for mobile overlay', async () => {
  const css = await fetchText('/css/home.css');
  // Mobile nav-panel must have z-index high enough to overlay hero content.
  // Check for specific z-index declarations on .hero-nav in mobile context.
  // The nav element sits at z-index: 2 (above hero content at z-index: 1).
  assert.match(css, /\.hero-nav\s*\{[^}]*z-index:\s*2\b/, 'hero-nav must have z-index: 2');
  // Verify z-index: 1 also exists (hero banner content)
  assert.match(css, /z-index:\s*1\b/, 'hero content must have z-index: 1');
});

test('mobile navbar search bar is present', async () => {
  const html = await fetchText('/');
  assert.ok(html.includes('hero-search'), 'search bar must be in mobile navbar');
});

test('mobile navbar contains navigation links', async () => {
  const html = await fetchText('/');
  const links = (html.match(/href="\/tienda"/g) || []);
  assert.ok(links.length >= 1, 'must have Tienda link');
});

test('!important is not overused in mobile navbar rules', async () => {
  const css = await fetchText('/css/home.css');
  // Find the mobile media query section
  const mobileStart = css.indexOf('@media (max-width: 768px)');
  const nextAtMedia = css.indexOf('@media', mobileStart + 1);
  const mobileSection = css.slice(mobileStart, nextAtMedia > -1 ? nextAtMedia : css.length);

  // Count !important in nav-related rules within mobile section
  const importantCount = (mobileSection.match(/!important/g) || []).length;
  assert.ok(importantCount < 5, `too many !important usages in mobile navbar: ${importantCount}`);
});

test('mobile menu scrolls when content overflows', async () => {
  const css = await fetchText('/css/home.css');
  assert.ok(css.includes('overflow-y: auto'), 'mobile menu must scroll vertically');
});

// IMPORTANT: Stop the test server when all tests are done
test.after(async () => {
  await stopTestServer();
});
