/**
 * Navbar compact-state height tests — fixed CSS-driven height.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const homeCss = fs.readFileSync(path.resolve(__dirname, '../public/css/home.css'), 'utf8');
const navbarJs = fs.readFileSync(path.resolve(__dirname, '../public/js/home/navbar.js'), 'utf8');

describe('Navbar compact-state fixed-height correction', () => {
  // ── Measurement code removed ──
  test('navbar JS does NOT use naturalWidth', () => {
    assert.doesNotMatch(navbarJs, /naturalWidth/);
  });

  test('navbar JS does NOT use naturalHeight', () => {
    assert.doesNotMatch(navbarJs, /naturalHeight/);
  });

  test('navbar JS does NOT use getBoundingClientRect for navbar sizing', () => {
    assert.doesNotMatch(navbarJs, /getBoundingClientRect/);
  });

  test('navbar JS has no resize listener for logo measurement', () => {
    assert.doesNotMatch(navbarJs, /listen\(window,\s*['"]resize['"]/);
  });

  // ── Fixed CSS compact height ──
  test('hero-header defines --hero-header-compact-height custom property', () => {
    assert.match(homeCss, /\.hero-header\s*\{[^}]*--hero-header-compact-height\s*:\s*[0-9]+px\s*;/);
  });

  test('scrolled header uses fixed height from custom property', () => {
    assert.match(homeCss, /\.hero-header\.is-scrolled\s*\{[^}]*height:\s*var\(--hero-header-compact-height[^)]*\)/);
  });

  test('scrolled header min-height also uses custom property', () => {
    assert.match(homeCss, /\.hero-header\.is-scrolled\s*\{[^}]*min-height:\s*var\(--hero-header-compact-height[^)]*\)/);
  });

  test('scrolled header has padding-block: 0', () => {
    assert.match(homeCss, /\.hero-header\.is-scrolled\s*\{[^}]*padding-block:\s*0\s*;/);
  });

  test('scrolled header has box-sizing: border-box', () => {
    assert.match(homeCss, /\.hero-header\s*\{[^}]*box-sizing:\s*border-box\s*;/);
  });

  // ── Logo sizing ──
  test('scrolled logo height is fixed 2.25rem (not variable)', () => {
    assert.match(homeCss, /\.hero-header\.is-scrolled\s+\.hero-logo[^-][\s\S]*?\{[^}]*height:\s*2\.25rem\s*;/);
  });

  test('no --hero-compact-logo-height variable remains in CSS', () => {
    assert.doesNotMatch(homeCss, /--hero-compact-logo-height/);
  });

  // ── Overflow visible ──
  test('hero-header default has overflow: visible', () => {
    assert.match(homeCss, /\.hero-header\s*\{[^}]*overflow:\s*visible\s*;/);
  });

  test('scrolled logo-stage has overflow: visible', () => {
    assert.match(homeCss, /\.hero-header\.is-scrolled\s+\.hero-logo-stage\s*\{[^}]*overflow:\s*visible\s*;/);
  });

  // ── Text/control sizing preserved ──
  test('no scrolled-state font-size reduction for nav links', () => {
    // The removed compact-controls block had smaller font-sizes.
    // Verify no .hero-header.is-scrolled .hero-nav-link rule with font-size exists
    const scrolledNavLink = homeCss.match(/\.hero-header\.is-scrolled\s+\.hero-nav-link[^-][\s\S]*?\{[\s\S]*?\}/);
    if (scrolledNavLink) {
      assert.doesNotMatch(scrolledNavLink[0], /font-size/);
    }
  });

  test('no scrolled-state search input font-size reduction', () => {
    const scrolledSearchInput = homeCss.match(/\.hero-header\.is-scrolled\s+\.hero-search__input\s*\{/);
    assert.strictEqual(scrolledSearchInput, null, 'No scrolled search input size rule');
  });

  test('no scrolled-state nav-list gap reduction', () => {
    const scrolledNavList = homeCss.match(/\.hero-header\.is-scrolled\s+\.hero-nav-list\s*\{/);
    assert.strictEqual(scrolledNavList, null, 'No scrolled nav list gap rule');
  });

  // ── Default state preserved ──
  test('default nav links have original font-size', () => {
    assert.match(homeCss, /\.hero-nav-link\s*\{[^}]*font-size:\s*clamp\(0\.9[0-9]rem/);
  });

  test('default hero-header has original min-height', () => {
    assert.match(homeCss, /\.hero-header\s*\{[^}]*min-height:\s*6\.25rem\s*;/);
  });

  test('default hero-header has original padding', () => {
    assert.match(homeCss, /\.hero-header\s*\{[^}]*padding:\s*0\.6rem\s*clamp/);
  });

  // ── Logo swap preserved ──
  test('scrolled compact logo is visible', () => {
    assert.match(homeCss, /\.hero-header\.is-scrolled\s+\.hero-logo-img--compact\s*\{[^}]*opacity:\s*1\s*;/);
  });

  test('scrolled full logo is hidden', () => {
    assert.match(homeCss, /\.hero-header\.is-scrolled\s+\.hero-logo-img--full\s*\{[^}]*opacity:\s*0\s*;/);
  });

  test('logo images use object-fit: contain', () => {
    assert.match(homeCss, /\.hero-logo-img\s*\{[^}]*object-fit:\s*contain\s*;/);
  });

  // ── No hacks ──
  test('no negative-margin hacks in scrolled state', () => {
    const scrolledMatch = homeCss.match(/\.hero-header\.is-scrolled[\s\S]*?(?=\n\.hero-header\.is-scrolled|\n\.hero-logo\s*\{)/g);
    if (scrolledMatch) {
      for (const block of scrolledMatch) {
        // Allow only screen-reader-only margin: -1px
        assert.doesNotMatch(block, /margin\s*:\s*-(?!1px\b)[0-9]/, 'No negative layout margins in scrolled state');
      }
    }
  });

  test('no transform scale hacks on logo in scrolled state', () => {
    const compactLogoBlock = homeCss.match(/\.hero-header\.is-scrolled\s+\.hero-logo-img--compact\s*\{[\s\S]*?\}/);
    if (compactLogoBlock) {
      assert.doesNotMatch(compactLogoBlock[0], /scale\(0\./, 'No scale reduction on compact logo');
    }
  });

  // ── Reduced motion ──
  test('reduced-motion respects hero-header transitions', () => {
    assert.match(homeCss, /prefers-reduced-motion[\s\S]*?\.hero-header[\s\S]*?transition-duration:\s*0\.01ms/);
  });

  // ── Mobile touch target ──
  test('mobile scrolled uses height:auto min-height (touch safe)', () => {
    const mobileScrolled = homeCss.match(/@media\s*\(max-width:\s*1040px\)[\s\S]*?\.hero-header\.is-scrolled\s*\{[\s\S]*?\}/);
    if (mobileScrolled) {
      assert.match(mobileScrolled[0], /height:\s*auto\s*;/);
      assert.match(mobileScrolled[0], /min-height:/);
    }
  });
});
