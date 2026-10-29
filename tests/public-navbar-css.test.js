/**
 * Guardrails for shared public-navbar.css extraction.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.join(__dirname, '../public/css/public-navbar.css');
const css = fs.readFileSync(cssPath, 'utf8');

describe('public-navbar.css', () => {
  it('contains a real mobile navbar media query with hamburger rules', () => {
    const mediaIdx = css.indexOf('@media (max-width: 1040px)');
    assert.ok(mediaIdx >= 0, 'must include @media (max-width: 1040px)');
    const block = css.slice(mediaIdx, mediaIdx + 2500);
    assert.match(block, /\.hero-nav-toggle\s*\{[^}]*display:\s*block/s);
    assert.match(block, /\.hero-search--desktop\s*\{[^}]*display:\s*none/s);
    assert.match(block, /\.hero-nav\s*\{/);
    assert.match(block, /\.hero-header\.is-menu-open\s+\.hero-nav/);
    assert.match(block, /\.hero-dropdown-panel/);
  });

  it('does not include unrelated Home social/showcase CSS', () => {
    assert.doesNotMatch(css, /\.home-panel--social-feed/);
    assert.doesNotMatch(css, /\.social-public\b/);
    assert.doesNotMatch(css, /\.project-carousel\b/);
    assert.doesNotMatch(css, /\.home-panel--showcase/);
  });
});

describe('service/quote pages load shared navbar assets', () => {
  const pages = [
    'views/pages/soluciones-digitales.ejs',
    'views/pages/fabricacion-3d.ejs',
    'views/pages/quotes/website.ejs',
    'views/pages/quotes/3d.ejs',
    'views/pages/quotes/other.ejs',
  ];

  for (const page of pages) {
    it(`${page} includes home-navbar`, () => {
      const src = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
      assert.match(src, /home-navbar/);
    });
  }

  it('quote/service controllers load public-navbar.css', () => {
    const services = fs.readFileSync(path.join(__dirname, '../controllers/servicesController.js'), 'utf8');
    const quotes = fs.readFileSync(path.join(__dirname, '../controllers/quoteRequestController.js'), 'utf8');
    assert.match(services, /\/css\/public-navbar\.css/);
    assert.match(quotes, /\/css\/public-navbar\.css/);
    assert.match(quotes, /quote-3d\.js/);
  });

  it('quote-3d.js uses preventDefault AJAX and only clears on success', () => {
    const js = fs.readFileSync(path.join(__dirname, '../public/js/quote-3d.js'), 'utf8');
    assert.match(js, /event\.preventDefault\(\)/);
    assert.match(js, /Accept:\s*['"]application\/json['"]/);
    assert.match(js, /!response\.ok\s*\|\|\s*!payload\?\.ok/);
    assert.match(js, /clearFormKeepAuth/);
    const submitIdx = js.indexOf("addEventListener('submit'");
    const clearCallIdx = js.indexOf('clearFormKeepAuth()', submitIdx);
    assert.ok(clearCallIdx > submitIdx);
    // clear/reset only after a successful payload check
    const beforeClear = js.slice(submitIdx, clearCallIdx);
    assert.match(beforeClear, /payload\?\.ok/);
    assert.ok(!beforeClear.includes('form.reset()'));
  });
});
