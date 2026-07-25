const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const fixturePath = path.join(__dirname, 'fixtures', 'spinner-morph-original.txt');
const partialPath = path.join(root, 'views', 'partials', 'spinner-morph.ejs');
const homePath = path.join(root, 'views', 'pages', 'home.ejs');
const layoutPath = path.join(root, 'views', 'layouts', 'main.ejs');
const homeJsPath = path.join(root, 'public', 'js', 'home', 'home.js');
const helmetJsPath = path.join(root, 'public', 'js', 'home', 'helmet3d.js');
const EXPECTED_HASH = '1b6198d3e502c25b2b119e5258ebf6e9a079945ce6d607f7995a00b0e145b37c';

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('SpinnerMorph renders the exact canonical path sequence and first state', () => {
  const canonical = fs.readFileSync(fixturePath, 'utf8').trimEnd();
  const partial = fs.readFileSync(partialPath, 'utf8');
  const rendered = ejs.render(partial, { cspNonce: 'test-nonce' });
  const installedMatch = rendered.match(/<animate\s+attributeName="d"[\s\S]*?values="([^"]+)"/);
  const pathMatch = rendered.match(/<path[\s\S]*?\sd="([^"]+)"/);
  assert.ok(canonical, 'Canonical SpinnerMorph source must not be empty.');
  assert.ok(installedMatch?.[1], 'Installed SpinnerMorph sequence must not be empty.');
  assert.equal(installedMatch[1], canonical, 'SpinnerMorph path sequence differs from canonical source.');
  const states = canonical.split(';');
  assert.equal(states.length, 3, 'Canonical SpinnerMorph state count changed.');
  assert.equal(states.filter(Boolean).length, states.length, 'Canonical sequence contains an empty state.');
  assert.equal(pathMatch?.[1], states[0], 'Initial path must equal the first canonical state.');
  assert.equal(states[0], states.at(-1), 'Canonical sequence must close on its first state.');
  assert.equal(hash(canonical), EXPECTED_HASH, 'Canonical SpinnerMorph hash changed.');
  assert.doesNotMatch(partial, /M 120 40 C 155 70|7-keyframe|organic shapes/i);
});

test('SpinnerMorph preserves rotation, timing, accessibility, and loader lifecycle wiring', () => {
  const partial = fs.readFileSync(partialPath, 'utf8');
  const home = fs.readFileSync(homePath, 'utf8');
  const homeJs = fs.readFileSync(homeJsPath, 'utf8');
  const helmetJs = fs.readFileSync(helmetJsPath, 'utf8');
  assert.match(partial, /viewBox="0 0 240 240"/);
  assert.match(partial, /from="0 120 120"/);
  assert.match(partial, /to="-360 120 120"/);
  assert.match(partial, /dur="<%= rotDur %>"/);
  assert.match(partial, /dur="<%= morDur %>"/);
  assert.match(partial, /fill="<%= svgFill %>"/);
  assert.match(partial, /aria-hidden="true"/);
  assert.match(home, /const ENABLE_PAGE_INTRO = false;/);
  assert.match(home, /class="hero-3d is-loading"/);
  assert.match(home, /data-helmet-loader/);
  assert.match(home, /data-helmet-error hidden/);
  assert.match(home, /data-helmet-retry/);
  assert.match(homeJs, /svgEl\.pauseAnimations\(\)/);
  assert.match(homeJs, /window\.addEventListener\('helmet:ready'/);
  assert.match(homeJs, /window\.addEventListener\('helmet:error'/);
  assert.match(helmetJs, /dispatchHelmetEvent\('helmet:ready'/);
  assert.match(helmetJs, /dispatchHelmetEvent\('helmet:error'/);
});

test('helmet preconnect and initialization start early without duplicate scenes', () => {
  const layout = fs.readFileSync(layoutPath, 'utf8');
  const homeJs = fs.readFileSync(homeJsPath, 'utf8');
  const helmetJs = fs.readFileSync(helmetJsPath, 'utf8');
  const modelUrl = helmetJs.match(/^const HELMET_MODEL_URL = '([^']+)'/m)?.[1];

  // No cross-origin GLB preload (triggers CORS error in Incognito/Safe mode)
  assert.doesNotMatch(layout, /rel="preload"[^>]*casco-optimized\.glb/,
    'Cross-origin GLB preload must be absent — causes CORS block in Incognito mode.');

  // Safe preconnect to the storage origin
  assert.match(layout, /rel="preconnect"\s+href="https:\/\/storage\.googleapis\.com"\s+crossorigin/,
    'Homepage must preconnect to the storage origin for faster GLB delivery.');

  assert.ok(
    homeJs.indexOf('void initHelmet3D(canvas, prefersReduced)') <
      homeJs.indexOf('await initHomeAnimations({ onPanelStateChange: setActivePanelState })'),
    'Helmet initialization must start before nonessential homepage animations.'
  );
  assert.match(helmetJs, /let helmetInitPromise = null;/);
  assert.match(helmetJs, /if \(helmetInitPromise\) return helmetInitPromise;/);
  assert.match(helmetJs, /helmetInitPromise = null;/);
  assert.match(helmetJs, /loader\.setCrossOrigin\('anonymous'\)/);
  assert.match(helmetJs, /logTiming\('GLB request started'\)/);
  assert.match(helmetJs, /logTiming\('first render completed'\)/);
});
