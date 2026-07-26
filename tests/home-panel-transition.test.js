const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const animations = read('public/js/home/animations.js');
const antigravity = read('public/js/home/antigravityBackground.js');
const antigravityForces = read('public/js/home/antigravityForces.mjs');
const blurText = read('public/js/home/blurText.js');
const cursor = read('public/js/home/splashCursor.js');
const helmet = read('public/js/home/helmet3d.js');
const home = read('public/js/home/home.js');
const projectCarousel = read('public/js/home/projectCarousel.js');
const css = read('public/css/home.css');
const layout = read('views/layouts/main.ejs');
const page = read('views/pages/home.ejs');
const forcesUrl = pathToFileURL(path.join(root, 'public/js/home/antigravityForces.mjs')).href;

test('one scrubbed timeline coordinates panel-one exit and panel-two entrance', () => {
  const transition = animations.slice(
    animations.indexOf('async function runScrollAnimations'),
    animations.indexOf('async function initializeHomeAnimations'),
  );

  assert.equal((transition.match(/gsap\.timeline\(/g) || []).length, 1);
  assert.match(transition, /id: 'home-panel-1-to-2'/);
  assert.match(transition, /scrub:/);
  assert.doesNotMatch(transition, /pin:/);
  assert.match(transition, /\.to\(\['\.hero-text', '\.hero-ctas'\]/);
  assert.match(transition, /data-panel2-animate="background"/);
  assert.match(transition, /headingTargets/);
  assert.match(transition, /animateBy: 'chars'/);
  assert.match(transition, /animateBy: 'words'/);
  assert.match(transition, /addLabel\('kickerIn', 0\.72\)/);
  assert.match(transition, /addLabel\('headingIn', 0\.78\)/);
  assert.match(transition, /fromTo\(headingTargets/);
  assert.match(transition, /data-panel2-animate="carousel"/);
  assert.match(transition, /data-panel2-animate="card"/);
  assert.match(transition, /data-panel2-animate="controls"/);
  assert.match(transition, /end: 'top top'/);
  assert.match(animations, /if \(heroAnimationPromise\) return heroAnimationPromise;/);
});

test('panel state owns cursor, antigravity, and helmet activity with error isolation', () => {
  const state = home.slice(
    home.indexOf('function setActivePanelState'),
    home.indexOf('/**\n * Model state machine'),
  );

  assert.match(state, /nextState === activePanelState/);
  assert.match(state, /nextState === 'panel1-active'/);

  // Uses safeLifecycleCall wrapper for fault isolation
  assert.match(state, /safeLifecycleCall\(splashCursorController,\s*'resume'/);
  assert.match(state, /safeLifecycleCall\(splashCursorController,\s*'pause'/);
  assert.match(state, /safeLifecycleCall\(antigravityController,\s*'resume'/);
  assert.match(state, /safeLifecycleCall\(antigravityController,\s*'pause'/);

  // safeLifecycleCall is defined and uses try-catch
  assert.match(home, /function safeLifecycleCall\(controller,\s*method,\s*label\)/);
  assert.match(home, /try \{\s*\n\s*controller\[method\]/);

  // Helmet setActive is also try-catch wrapped
  assert.match(state, /try \{\s*\n\s*helmetCanvas\._helmetSetActive/);

  assert.match(state, /_helmetSetActive\(panelOneActive\)/);
  assert.match(animations, /transitioning-to-panel2/);
  assert.match(animations, /transitioning-to-panel1/);
});

test('cursor controller reuses one instance and binds pointer listeners idempotently', () => {
  assert.match(cursor, /const active = new WeakMap\(\)/);
  assert.match(cursor, /if \(active\.has\(canvas\)\) return active\.get\(canvas\)/);
  assert.match(cursor, /if \(pointerListenersBound \|\| dead\) return/);
  assert.match(cursor, /if \(!pointerListenersBound\) return/);
  assert.match(cursor, /unbindPointerListeners\(\);[\s\S]*pointers\.clear\(\)/);
  assert.match(cursor, /window\.matchMedia\('\(pointer: coarse\)'\)/);
  assert.match(cursor, /navigator\.maxTouchPoints/);
  assert.ok(
    cursor.indexOf('if (touchOnly) return inactiveController();')
      < cursor.indexOf('const resolved = resolveCanvas(requested);'),
  );

  // All lifecycle functions are declared as outer-scope no-op stubs,
  // then REASSIGNED (not redeclared) inside the try block so resume()
  // and other controller methods can access them.
  assert.match(cursor, /\blet schedule\s*=\s*\(\)\s*=>\s*\{}/,
    'schedule must be a no-op stub in outer scope');
  assert.match(cursor, /\blet frame\s*=\s*\(\)\s*=>\s*\{}/,
    'frame must be a no-op stub in outer scope');
  assert.match(cursor, /\blet visibility\s*=\s*\(\)\s*=>\s*\{}/,
    'visibility must be a no-op stub in outer scope');
  assert.match(cursor, /\blet queueResize\s*=\s*\(\)\s*=>\s*\{}/,
    'queueResize must be a no-op stub in outer scope');

  // Inside try block: assignment, not redeclaration
  const tryStart = cursor.indexOf('  try {');
  const scheduleAssign = cursor.indexOf('schedule=function schedule()', tryStart);
  assert.ok(scheduleAssign > tryStart,
    'schedule must be reassigned inside try block via assignment, not declared as function');

  // frame, visibility, queueResize are also reassigned (not redeclared) in try block
  const frameAssign = cursor.indexOf('frame=function frame(now)', tryStart);
  assert.ok(frameAssign > tryStart, 'frame must be reassigned via assignment');
  const visibilityAssign = cursor.indexOf('visibility=function visibility()', tryStart);
  assert.ok(visibilityAssign > tryStart, 'visibility must be reassigned via assignment');
  const queueResizeAssign = cursor.indexOf('queueResize=function queueResize()', tryStart);
  assert.ok(queueResizeAssign > tryStart, 'queueResize must be reassigned via assignment');

  // resume() can access schedule via outer scope
  assert.match(cursor, /function resume\(\)[\s\S]*?schedule\(\)/);

  // last variable in outer scope (before try block)
  assert.match(cursor, /\blet last\s*=\s*performance\.now\(\)/);
  assert.ok(cursor.indexOf('let last = performance.now()') < tryStart,
    'let last must be declared in outer scope before the try block');

  // resume resets last to avoid large delta
  assert.match(cursor, /function resume\(\)[\s\S]*?\blast\s*=\s*performance\.now\(\)/m);

  // pause() is idempotent
  assert.match(cursor, /function pause\(\)[\s\S]*?if \(dead \|\| paused\) return/);
  // resume() is idempotent
  assert.match(cursor, /function resume\(\)[\s\S]*?if \(dead \|\| !paused\) return/);
  // Only one RAF loop after repeated resume
  assert.match(cursor, /raf\s*===\s*null/);
});

test('panel-state error isolation: controller failure does not block sibling updates', () => {
  // safeLifecycleCall catch-report pattern
  assert.match(home, /console\.warn\(`\[home\] \$\{label\} \$\{method\}\(\) failed:/);
  // Helmet active is also try-catch wrapped
  const setActive = home.slice(
    home.indexOf('function setActivePanelState'),
    home.indexOf('/**\n * Model state machine'),
  );
  assert.match(setActive, /try \{\s*\n\s*helmetCanvas\._helmetSetActive/);

  // State guard prevents repeated execution when panel state hasn't changed
  assert.match(setActive, /nextState === activePanelState\) return/);
});

test('panel-two canvas and prepaint states are singular and fail open', () => {
  assert.equal((page.match(/data-antigravity-canvas/g) || []).length, 1);
  assert.match(page, /data-panel2-animate="background"/);
  assert.match(layout, /panel-transition-pending/);
  assert.ok(
    layout.indexOf('panel-transition-pending')
      < layout.indexOf('<link rel="stylesheet" href="/css/style.css">'),
  );
  assert.match(css, /html\.panel-transition-pending body\.page-home/);
  assert.match(css, /html\.panel-transition-ready body\.page-home/);
  assert.match(animations, /catch \(err\) \{[\s\S]*revealPanelTransitionImmediately\(\)/);
  assert.match(home, /revealPanelTransitionImmediately\(\)/);
  assert.doesNotMatch(animations, /page-loader/);
});

test('particle renderer uses Three.js InstancedMesh with tetrahedrons, pausable, and duplicate-safe', () => {
  assert.match(antigravity, /const instances = new WeakMap\(\)/);
  assert.match(antigravity, /if \(instances\.has\(canvas\)\) return instances\.get\(canvas\)/);
  // Three.js WebGL renderer, not Canvas 2D
  assert.match(antigravity, /new THREE\.WebGLRenderer/);
  assert.match(antigravity, /new THREE\.TetrahedronGeometry\(0\.42, 0\)/);
  // InstancedMesh for shared rendering
  assert.match(antigravity, /new THREE\.InstancedMesh/);
  assert.match(antigravity, /\bmesh\.instanceMatrix\.needsUpdate\b/);
  // No per-particle DOM nodes
  assert.doesNotMatch(antigravity, /createElement\(['"]canvas/);
  // DPR capped
  assert.match(antigravity, /Math\.min\(window\.devicePixelRatio \|\| 1, dprCap\)/);
  // Visibility-aware
  assert.match(antigravity, /document\.addEventListener\('visibilitychange'/);
  assert.match(antigravity, /document\.removeEventListener\('visibilitychange'/);
  // Pause/resume lifecycle
  assert.match(antigravity, /function pause\(\)/);
  assert.match(antigravity, /function resume\(\)/);
  // #27ff5a color
  assert.match(antigravity, /0x27ff5a/);
  // Attraction / ring targeting removed
  assert.doesNotMatch(antigravity, /MAGNET_RADIUS|RING_RADIUS|AUTO_ANIMATE_DELAY/);
  assert.doesNotMatch(antigravityForces, /MAGNET_RADIUS|RING_RADIUS|ringR\b|targetX = magnet/);
  // Soft repulsion + suspended drift
  assert.match(antigravity, /REPEL_RADIUS/);
  assert.match(antigravity, /RETURN_LERP/);
  assert.match(antigravity, /pointerActive/);
  assert.match(antigravity, /from '\.\/antigravityForces\.mjs'/);
  assert.match(antigravity, /driftRadius/);
  assert.match(antigravity, /composeParticleTarget\(/);
  assert.match(antigravity, /computeRepulsion\(/);
  // Particle count tiers
  assert.match(antigravity, /compact \? 60 : tablet \? 120 : 180/);
  assert.match(antigravity, /Math\.min\(0\.56, p\.scale \* pulse\)/);
  // Shared geometry + material
  assert.match(antigravity, /geometry\.dispose\(\)/);
  assert.match(antigravity, /material\.dispose\(\)/);
});

test('antigravity maps panel CSS pixels through camera world space and scopes pointer input', () => {
  assert.match(antigravity, /const ndcX = \(\(e\.clientX - panelRect\.left\) \/ panelRect\.width\) \* 2 - 1/);
  assert.match(antigravity, /const ndcY = -\(\(\(e\.clientY - panelRect\.top\) \/ panelRect\.height\) \* 2 - 1\)/);
  assert.match(antigravity, /\.unproject\(camera\)/);
  assert.match(antigravity, /distanceToPlane = -camera\.position\.z \/ pointerRay\.z/);
  assert.match(antigravity, /panel\.addEventListener\('pointermove'/);
  assert.match(antigravity, /e\.clientX < panelRect\.left[\s\S]*e\.clientY > panelRect\.bottom/);
  assert.match(antigravity, /pointerActive = false/);
  assert.match(antigravity, /function onPointerLeave\(\)[\s\S]*pointerActive = false/);
  assert.match(antigravity, /if \(pointersBound \|\| coarsePointer\) return/);
  assert.doesNotMatch(antigravity, /window\.addEventListener\('pointermove'/);
});

test('repulsion force points away from the cursor and fades with distance', async () => {
  const { computeRepulsion, composeParticleTarget } = await import(forcesUrl);

  const near = computeRepulsion(1, 0, { repelRadius: 7.5, repelForce: 4.2, maxRepel: 3.6 });
  const mid = computeRepulsion(3.5, 0, { repelRadius: 7.5, repelForce: 4.2, maxRepel: 3.6 });
  const far = computeRepulsion(8, 0, { repelRadius: 7.5, repelForce: 4.2, maxRepel: 3.6 });
  const left = computeRepulsion(-2, 0, { repelRadius: 7.5, repelForce: 4.2, maxRepel: 3.6 });

  assert.ok(near.x > 0, 'repulsion pushes particle away along +x when dx > 0');
  assert.ok(left.x < 0, 'repulsion pushes particle away along -x when dx < 0');
  assert.ok(near.strength > mid.strength, 'strength decreases with distance');
  assert.equal(far.x, 0);
  assert.equal(far.y, 0);
  assert.equal(far.strength, 0);

  const clamped = computeRepulsion(0.05, 0, {
    repelRadius: 7.5, repelForce: 40, maxRepel: 3.6, maxZOffset: 1.8,
  });
  assert.ok(Math.hypot(clamped.x, clamped.y) <= 3.6 + 1e-9);
  assert.ok(clamped.z <= 1.8 + 1e-9);

  const driftOnly = composeParticleTarget(10, 4, -1, Math.PI / 2, 2, null);
  assert.ok(Math.abs(driftOnly.suspendedX - 10) < 1e-9);
  assert.ok(Math.abs(driftOnly.suspendedY - (4 + 2 * 0.6)) < 1e-9);
  assert.equal(driftOnly.targetX, driftOnly.suspendedX);
  assert.equal(driftOnly.targetY, driftOnly.suspendedY);

  const withRepel = composeParticleTarget(10, 4, -1, 0, 2, { x: 1.5, y: -0.5, z: 0.8 });
  assert.equal(withRepel.targetX, withRepel.suspendedX + 1.5);
  assert.equal(withRepel.targetY, withRepel.suspendedY - 0.5);
  assert.equal(withRepel.targetZ, -1 + 0.8);
  assert.ok(withRepel.suspendedX !== withRepel.targetX, 'repulsion is additive, not a substitute');
});

test('blur text splits words/chars, preserves accessibility, and restores text', async (t) => {
  const originalHTMLElement = global.HTMLElement;
  const originalDocument = global.document;

  class FakeElement {
    constructor() {
      this.dataset = {};
      this.children = [];
      this.attributes = new Map();
      this.style = {
        removeProperty(name) { delete this[name]; },
      };
      this.className = '';
      this._text = '';
    }

    get textContent() {
      return this.children.length
        ? this.children.map((child) => child.textContent).join('')
        : this._text;
    }

    set textContent(value) {
      this.children = [];
      this._text = String(value);
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) { this.children.push(child); return child; }

    querySelectorAll(selector) {
      const all = [];
      const visit = (node) => {
        if (!(node instanceof FakeElement)) return;
        if (
          selector.includes('.blur-text__word') && node.className === 'blur-text__word'
        ) all.push(node);
        if (
          selector.includes('.blur-text__char') && node.className === 'blur-text__char'
        ) all.push(node);
        node.children.forEach(visit);
      };
      this.children.forEach(visit);
      return all;
    }
  }

  global.HTMLElement = FakeElement;
  global.document = {
    createElement: () => new FakeElement(),
    createTextNode: (text) => ({ textContent: text }),
  };
  t.after(() => {
    global.HTMLElement = originalHTMLElement;
    global.document = originalDocument;
  });

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(blurText).toString('base64')}`;
  const { splitBlurText } = await import(moduleUrl);

  const wordsEl = new FakeElement();
  wordsEl.textContent = 'Texto accesible completo';
  const wordsSplit = splitBlurText(wordsEl, { animateBy: 'words', direction: 'top', blur: 12, y: -40 });
  assert.equal(wordsSplit.words.length, 3);
  assert.equal(wordsSplit.targets.length, 3);
  assert.equal(wordsEl.getAttribute('aria-label'), 'Texto accesible completo');
  wordsSplit.words.forEach((word) => {
    assert.equal(word.getAttribute('aria-hidden'), 'true');
    assert.match(word.style.filter, /blur\(12px\)/);
    assert.equal(word.style.opacity, '0');
    assert.match(word.style.transform, /translate3d\(0, -40px/);
  });
  assert.equal(splitBlurText(wordsEl).words.length, 3, 'idempotent word split');
  wordsSplit.destroy();
  assert.equal(wordsEl.textContent, 'Texto accesible completo');
  assert.equal(wordsEl.getAttribute('aria-label'), null);

  const charsEl = new FakeElement();
  charsEl.textContent = 'Hola mundo';
  const charsSplit = splitBlurText(charsEl, { animateBy: 'chars', direction: 'top', blur: 13, y: -48 });
  assert.equal(charsSplit.words.length, 2);
  assert.equal(charsSplit.chars.length, 9);
  assert.equal(charsSplit.targets.length, 9);
  assert.ok(charsSplit.words[0].children.every((child) => child.className === 'blur-text__char'));
  assert.equal(charsEl.getAttribute('aria-label'), 'Hola mundo');
  charsSplit.chars.forEach((char) => {
    assert.equal(char.getAttribute('aria-hidden'), 'true');
    assert.match(char.style.filter, /blur\(13px\)/);
    assert.equal(char.style.opacity, '0');
    assert.match(char.style.transform, /translate3d\(0, -48px/);
  });
  charsSplit.destroy();
  assert.equal(charsEl.textContent, 'Hola mundo');
});

test('panel-two text and carousel use visible scroll-owned animation layers', () => {
  assert.match(css, /\.home-panel--showcase\s*\{[\s\S]*#cfd2d0/);
  assert.match(css, /\.showcase-heading\s*\{[\s\S]*color: #151817/);
  assert.match(page, /class="showcase-support" data-panel2-animate="support"/);
  assert.equal((page.match(/class="project-carousel__card" data-panel2-animate="card"/g) || []).length, 5);
  assert.doesNotMatch(
    page,
    /<li(?:(?!>).)*class="project-carousel__slide"(?:(?!>).)*data-panel2-animate="card"/s,
  );
  assert.match(animations, /gsap\.set\(\[kickerEl, headingEl, supportEl\]/);
  assert.match(animations, /fromTo\(headingTargets[\s\S]*y: fallY/);
  assert.match(animations, /settle\.heading/);
  assert.match(animations, /filter: 'blur\(0px\)'/);
  assert.match(animations, /addLabel\('carouselIn', 0\.9\)/);
  assert.match(animations, /rotationX: 0/);
  assert.match(css, /\[data-blur-text-split="true"\]/);
  assert.match(css, /\.blur-text__char/);
  assert.equal((page.match(/data-carousel-(?:prev|next)/g) || []).length, 2);
});

test('project carousel hierarchy favors a clearer active slide over softer previews', () => {
  assert.match(css, /--preview-width: clamp\(160px, 13vw, 205px\)/);
  assert.match(css, /--preview-height: clamp\(225px, 22vw, 305px\)/);
  assert.match(css, /rgba\(0, 0, 0, 0\.58\)/);
  assert.doesNotMatch(css, /rgba\(0, 0, 0, 0\.84\)/);
  assert.match(
    css,
    /\.project-carousel__slide\.is-active \.project-carousel__image[\s\S]*brightness\(1\.08\)/,
  );
  assert.match(css, /\.is-preview-near\s*\{[\s\S]*top: calc\(50% \+ 52px\)[\s\S]*opacity: 0\.94/);
  assert.match(css, /\.is-preview-rear\s*\{[\s\S]*top: calc\(50% \+ 72px\)[\s\S]*opacity: 0\.82/);
  assert.match(css, /\.project-carousel__face\s*\{[\s\S]*--preview-scale/);
  assert.match(css, /\.is-preview-near \.project-carousel__face\s*\{[\s\S]*--preview-scale: 0\.96/);
  assert.match(css, /\.is-preview-rear \.project-carousel__face\s*\{[\s\S]*--preview-scale: 0\.9/);
  assert.match(css, /\.is-preview\s*\{[\s\S]*overflow: visible/);
  assert.match(css, /\.is-preview\s*\{[\s\S]*pointer-events: auto/);
  assert.match(css, /rgba\(42, 50, 54, 0\.42\)/);
  assert.match(css, /backdrop-filter: blur\(4px\)/);
  assert.match(css, /\.project-carousel__image\s*\{[\s\S]*pointer-events: none/);
  assert.match(css, /is-active::after[\s\S]*pointer-events: none/);
  assert.match(
    css,
    /\.is-preview-near \.project-carousel__image\s*\{[\s\S]*opacity: 0\.96[\s\S]*brightness\(1\.02\)/,
  );
  assert.match(
    css,
    /\.is-preview-rear \.project-carousel__image\s*\{[\s\S]*opacity: 0\.9[\s\S]*brightness\(0\.99\)/,
  );
  assert.match(css, /@keyframes project-carousel-kenburns/);
  assert.match(css, /animation: project-carousel-kenburns 32s/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(
    css,
    /is-preview-near:hover \.project-carousel__face[\s\S]*--preview-hover-scale: 1\.035/,
  );
  assert.match(
    css,
    /is-preview-rear:hover \.project-carousel__face[\s\S]*--preview-hover-scale: 1\.025/,
  );
  assert.doesNotMatch(
    css,
    /is-preview-near:hover \.project-carousel__card\s*\{[\s\S]*transform:/,
  );
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  assert.match(projectCarousel, /inert', !\(isActive \|\| isPreview\)/);
  assert.match(projectCarousel, /is-preview-near/);
  assert.match(projectCarousel, /is-preview-rear/);
  assert.match(page, /project-carousel__face/);
  assert.match(animations, /data-panel2-animate="carousel"/);
  assert.match(animations, /data-panel2-animate="card"/);
  assert.equal((page.match(/data-carousel-(?:prev|next)/g) || []).length, 2);
});

test('antigravity controller has idempotent pause/resume/destroy lifecycle', () => {
  // Instance reuse via WeakMap
  assert.match(antigravity, /if \(instances\.has\(canvas\)\) return instances\.get\(canvas\)/);
  // Idempotent pause (uses `paused` guard)
  assert.match(antigravity, /function pause\(\)[\s\S]*?if \(destroyed \|\| paused\) return/);
  // Idempotent resume (only blocked by destroyed/reducedMotion, not active)
  assert.match(antigravity, /function resume\(\)[\s\S]*?if \(destroyed \|\| reducedMotion\) return/);
  // resume always kicks a fresh RAF (stale-state recovery)
  assert.match(antigravity, /rafId = null;[ \t\n}]*schedule\(\)/);
  // Idempotent destroy
  assert.match(antigravity, /function destroy\(\)[\s\S]*?if \(destroyed\) return/);
  // resume resets lastTime
  assert.match(antigravity, /lastTime = performance\.now\(\)/);
  // Pause removes pointer listeners
  assert.match(antigravity, /removeEventListener\('pointermove', onPointerMove\)/);
  // Resume adds pointer listeners
  assert.match(antigravity, /addEventListener\('pointermove', onPointerMove/);
  // Initial state is paused
  assert.match(antigravity, /canvas\.classList\.add\('is-paused'\)/);
  // IntersectionObserver for visibility
  assert.match(antigravity, /IntersectionObserver/);
  // schedule guards: no double RAF
  assert.match(antigravity, /\|\| rafId !== null\s*\n\s*\) return/);
});

test('helmet keeps one GLB/canvas while pausing its existing render loop', () => {
  assert.equal((helmet.match(/^const HELMET_MODEL_URL = /gm) || []).length, 1);
  assert.equal((helmet.match(/\bloader\.load\(/g) || []).length, 1);
  assert.equal((page.match(/data-helmet-canvas/g) || []).length, 1);
  assert.match(helmet, /canvas\._helmetSetActive = \(active\)/);
  assert.match(helmet, /scheduleRender\(\)/);
  assert.doesNotMatch(animations, /initHelmet3D|GLTFLoader|createElement\(['"]canvas/);
});

test('reduced motion and coarse pointers expose content without nonessential loops', () => {
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*\.splash-cursor-layer[\s\S]*display: none/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*html\.panel-transition-pending body\.page-home \[data-panel2-animate\][\s\S]*opacity: 1/,
  );
  assert.match(
    antigravity,
    /destroyed \|\| reducedMotion \|\| document\.hidden \|\| !sectionVisible[\s\S]*rafId !== null/,
  );
  assert.match(home, /if \(!prefersReduced\) \{[\s\S]*splashCursorController = initSplashCursor/);
  assert.match(home, /revealPanelTransitionImmediately\(\)/);
});
