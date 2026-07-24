const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const animations = read('public/js/home/animations.js');
const home = read('public/js/home/home.js');
const helmet = read('public/js/home/helmet3d.js');
const css = read('public/css/home.css');
const layout = read('views/layouts/main.ejs');
const page = read('views/pages/home.ejs');
const navbar = read('views/components/home-navbar.ejs');

test('hero entrance establishes its hidden state before styles and runs once', () => {
  const pendingIndex = layout.indexOf("classList.add('hero-entrance-pending')");
  const stylesheetIndex = layout.indexOf('<link rel="stylesheet" href="/css/style.css">');

  assert.ok(pendingIndex >= 0 && pendingIndex < stylesheetIndex);
  assert.match(layout, /prefers-reduced-motion: reduce/);
  assert.match(layout, /__heroEntranceSafetyTimer/);
  assert.match(css, /html\.hero-entrance-pending body\.page-home/);
  assert.match(animations, /let heroAnimationPromise = null;/);
  assert.match(animations, /let heroAnimationCompleted = false;/);
  assert.match(animations, /if \(heroAnimationPromise\) return heroAnimationPromise;/);
});

test('master timeline reveals stable server-rendered hero elements without fromTo flicker', () => {
  const entrance = animations.slice(
    animations.indexOf('function runEntrance'),
    animations.indexOf('async function runScrollAnimations')
  );

  assert.doesNotMatch(entrance, /\.fromTo\(/);
  assert.match(entrance, /\.to\('\.hero-header'/);
  assert.match(entrance, /\.to\('\.hero-eyebrow'/);
  assert.match(entrance, /\.to\('\.hero-word'/);
  assert.match(entrance, /\.to\('\.hero-support'/);
  assert.match(entrance, /\.to\('\.hero-btn'/);
  assert.match(entrance, /\.to\('\.hero-social-link'/);
  assert.match(entrance, /\.to\('\.hero-3d'/);
  assert.doesNotMatch(entrance, /data-helmet-canvas|hero-canvas/);
});

test('helmet loading remains early, single, and independent from the entrance timeline', () => {
  assert.ok(
    home.indexOf('void initHelmet3D(canvas, prefersReduced)') <
      home.indexOf('await initHomeAnimations()')
  );
  assert.equal((helmet.match(/^const HELMET_MODEL_URL = /gm) || []).length, 1);
  assert.equal((helmet.match(/\bloader\.load\(/g) || []).length, 1);
  assert.equal((page.match(/data-helmet-canvas/g) || []).length, 1);
  assert.doesNotMatch(animations, /initHelmet3D|GLTFLoader|createElement\(['"]canvas/);
});

test('GSAP failure and reduced motion reveal all hero content immediately', () => {
  assert.match(animations, /catch \(err\) \{[\s\S]*revealHeroImmediately\(\);/);
  assert.match(
    animations,
    /document\.documentElement\.classList\.remove\('hero-entrance-pending'\)/
  );
  assert.match(home, /else \{[\s\S]*revealHeroImmediately\(\);[\s\S]*\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none;/);
  assert.match(css, /will-change: auto;/);
});

test('markup exposes one accessible coordinated first-panel sequence', () => {
  assert.match(navbar, /data-hero-animate="navbar"/);
  assert.match(page, /data-hero-animate="background"/);
  assert.match(page, /data-hero-animate="eyebrow"/);
  assert.match(page, /class="hero-word"/);
  assert.match(page, /class="hero-support"/);
  assert.match(page, /data-hero-animate="button"/);
  assert.match(page, /data-hero-animate="social"/);
  assert.match(page, /data-hero-animate="helmet"/);
  assert.equal((page.match(/<h1\b/g) || []).length, 1);
  assert.doesNotMatch(animations, /page-loader/);
});
