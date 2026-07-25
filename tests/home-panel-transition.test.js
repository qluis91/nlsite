const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const animations = read('public/js/home/animations.js');
const antigravity = read('public/js/home/antigravityBackground.js');
const cursor = read('public/js/home/splashCursor.js');
const helmet = read('public/js/home/helmet3d.js');
const home = read('public/js/home/home.js');
const css = read('public/css/home.css');
const layout = read('views/layouts/main.ejs');
const page = read('views/pages/home.ejs');

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
  assert.match(transition, /data-panel2-animate="heading"/);
  assert.match(transition, /data-panel2-animate="carousel"/);
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

test('particle renderer is lightweight, pausable, visibility-aware, and duplicate-safe', () => {
  assert.match(antigravity, /const instances = new WeakMap\(\)/);
  assert.match(antigravity, /if \(instances\.has\(canvas\)\) return instances\.get\(canvas\)/);
  assert.match(antigravity, /getContext\('2d'/);
  assert.match(antigravity, /const VERTICES = Object\.freeze/);
  assert.match(antigravity, /const EDGES = Object\.freeze/);
  assert.doesNotMatch(antigravity, /createElement\(['"]canvas/);
  assert.match(antigravity, /Math\.min\(window\.devicePixelRatio \|\| 1, compact \? 1 : 1\.5\)/);
  assert.match(antigravity, /document\.addEventListener\('visibilitychange'/);
  assert.match(antigravity, /document\.removeEventListener\('visibilitychange'/);
  assert.match(antigravity, /function pause\(\)/);
  assert.match(antigravity, /function resume\(\)/);
  assert.match(antigravity, /#27ff5a|39, 255, 90/);
});

test('particle controller reuses its instance and stops RAF offscreen or hidden', async (t) => {
  const original = {
    window: global.window,
    document: global.document,
    canvas: global.HTMLCanvasElement,
    resizeObserver: global.ResizeObserver,
    intersectionObserver: global.IntersectionObserver,
  };
  t.after(() => Object.assign(global, {
    window: original.window,
    document: original.document,
    HTMLCanvasElement: original.canvas,
    ResizeObserver: original.resizeObserver,
    IntersectionObserver: original.intersectionObserver,
  }));

  const frames = new Map();
  const documentListeners = new Map();
  let frameId = 0;
  let intersectionCallback;

  class FakeCanvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.classList = { add() {}, remove() {} };
    }
    getContext() {
      return {
        setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {},
        lineTo() {}, stroke() {}, closePath() {}, fill() {},
      };
    }
    getBoundingClientRect() { return { width: 900, height: 700 }; }
    closest() { return { dataset: { panel: '2' } }; }
  }

  global.HTMLCanvasElement = FakeCanvas;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  global.IntersectionObserver = class {
    constructor(callback) { intersectionCallback = callback; }
    observe() {}
    disconnect() {}
  };
  global.document = {
    hidden: false,
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    removeEventListener(type) { documentListeners.delete(type); },
  };
  global.window = {
    devicePixelRatio: 2,
    ResizeObserver: global.ResizeObserver,
    IntersectionObserver: global.IntersectionObserver,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame(callback) {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener() {},
    removeEventListener() {},
  };

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(antigravity).toString('base64')}`;
  const { initAntigravityBackground } = await import(moduleUrl);
  const canvas = new FakeCanvas();
  const first = initAntigravityBackground(canvas);
  const second = initAntigravityBackground(canvas);

  assert.equal(first, second);
  first.resume();
  assert.equal(frames.size, 0, 'offscreen panel does not schedule a frame');

  intersectionCallback([{ isIntersecting: true }]);
  assert.equal(frames.size, 1, 'visible panel schedules one frame');

  global.document.hidden = true;
  documentListeners.get('visibilitychange')();
  assert.equal(frames.size, 0, 'hidden tab cancels the scheduled frame');

  first.destroy();
  assert.equal(first.isActive(), false);
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
  assert.match(antigravity, /destroyed \|\| !active \|\| !sectionVisible \|\| reducedMotion/);
  assert.match(home, /if \(!prefersReduced\) \{[\s\S]*splashCursorController = initSplashCursor/);
  assert.match(home, /revealPanelTransitionImmediately\(\)/);
});
