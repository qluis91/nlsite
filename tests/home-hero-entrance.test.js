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
  const pendingIndex = layout.indexOf("classList.add('hero-entrance-pending'");
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
      home.indexOf('await initHomeAnimations({ onPanelStateChange: setActivePanelState })')
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

test('social icons markup is unconditionally rendered in Panel 1', () => {
  // Social block must be present and not gated by a CMS conditional
  assert.match(page, /hero-social-link.*aria-label="Instagram"/);
  assert.match(page, /hero-social-link.*aria-label="Facebook"/);
  assert.match(page, /hero-social-link.*aria-label="TikTok"/);
  assert.match(page, /hero-social-link.*aria-label="WhatsApp"/);
});

test('desktop Panel 1 uses position:relative containing block for social icons', () => {
  const heroPanelRules = css.slice(
    css.indexOf('.home-panel--hero {'),
    css.indexOf('/* ── 4. Header integration ── */')
  );
  assert.match(heroPanelRules, /position:\s*relative/);

  const socialBase = css.slice(
    css.indexOf('/* ── 7. Social links ── */'),
    css.indexOf('.hero-social-link {')
  );
  assert.match(socialBase, /position:\s*absolute/);
});

test('desktop hero-text uses flex column with gap for text spacing', () => {
  const heroTextBlock = css.slice(
    css.indexOf('.hero-text {'),
    css.indexOf('.hero-eyebrow {')
  );
  assert.match(heroTextBlock, /display:\s*flex/);
  assert.match(heroTextBlock, /flex-direction:\s*column/);
  assert.match(heroTextBlock, /gap:/);
});

test('desktop hero-eyebrow and hero-support have zero margins (gap controls spacing)', () => {
  const eyebrowBlock = css.slice(
    css.indexOf('.hero-eyebrow {'),
    css.indexOf('.hero-eyebrow::after {')
  );
  assert.match(eyebrowBlock, /margin-top:\s*0/);
  assert.match(eyebrowBlock, /margin-bottom:\s*clamp\(0\.4rem,\s*0\.8vh,\s*0\.7rem\)/);

  // .hero-support block: slice from selector through its closing brace (found after text-wrap)
  const supportStart = css.indexOf('.hero-support {');
  const textWrapPos = css.indexOf('text-wrap', supportStart);
  const supportEnd = css.indexOf('}', textWrapPos) + 1;
  const supportBlock = css.slice(supportStart, supportEnd);
  assert.match(supportBlock, /margin:\s*0/);
});

test('mobile restores flow layout for hero-social', () => {
  const mobileBlock = css.slice(css.indexOf('@media (max-width: 768px)'));
  const mobileSocial = mobileBlock.slice(mobileBlock.indexOf('.hero-social {'));
  assert.match(mobileSocial, /position:\s*static/);
});

test('desktop Panel 1 constrains height to viewport', () => {
  const heroPanelRules = css.slice(
    css.indexOf('.home-panel--hero {'),
    css.indexOf('/* ── 3.1 Background layers ── */')
  );
  assert.match(heroPanelRules, /height:\s*100dvh/);
  assert.match(heroPanelRules, /max-height:\s*100dvh/);
  assert.match(heroPanelRules, /overflow:\s*hidden/);
});
