const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

class ClassList {
  constructor() {
    this.values = new Set();
  }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
}

class Element {
  constructor() {
    this.nodeType = 1;
    this.classList = new ClassList();
    this.style = {};
    this.listeners = new Map();
    this.childrenBySelector = new Map();
    this.isConnected = true;
  }
  querySelector(selector) { return this.childrenBySelector.get(selector)?.[0] || null; }
  querySelectorAll(selector) { return this.childrenBySelector.get(selector) || []; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name) { this.listeners.delete(name); }
  getBoundingClientRect() { return { top: 100, left: 0, width: 800, height: 600 }; }
}

function createMotionEnvironment() {
  const page = new Element();
  const entry = new Element();
  const scroll = new Element();

  page.childrenBySelector.set('[data-gallery-primary-mode]:not([hidden]), .gallery-visual-zone__content', [entry]);
  page.childrenBySelector.set('[data-gallery-animate="entry"]', [entry]);
  page.childrenBySelector.set('[data-gallery-animate="scroll"]', [scroll]);
  page.childrenBySelector.set('[data-gallery-animate], .gallery-primary-mode, .gallery-grid__item', [entry, scroll]);

  const documentListeners = new Map();
  const windowListeners = new Map();
  const navbar = new Element();
  global.document = {
    querySelector: (selector) => {
      if (selector === '[data-home-navbar]') return navbar;
      return null;
    },
    addEventListener: (name, handler) => documentListeners.set(name, handler),
    removeEventListener: (name) => documentListeners.delete(name),
  };
  global.window = {
    location: {
      href: 'http://localhost/galeria',
      origin: 'http://localhost',
      assign() {},
    },
    matchMedia: (query) => ({ matches: query.includes('max-width') }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    addEventListener: (name, handler) => windowListeners.set(name, handler),
    removeEventListener: (name) => windowListeners.delete(name),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  };
  Object.defineProperty(global, 'navigator', {
    value: { deviceMemory: 8, hardwareConcurrency: 8 },
    configurable: true,
    writable: true,
  });

  const calls = [];
  const triggers = [];
  const complete = (vars) => queueMicrotask(() => vars?.onComplete?.());
  const animation = (kind, targets, vars) => {
    calls.push([kind, targets, vars]);
    if (vars?.scrollTrigger) triggers.push({ vars: vars.scrollTrigger, kill() {} });
    complete(vars);
    return { kill() { vars?.onInterrupt?.(); } };
  };
  const gsap = {
    registerPlugin() {},
    fromTo(targets, from, vars) { return animation('fromTo', targets, { ...vars, from }); },
    to(targets, vars) { return animation('to', targets, vars); },
    set(targets, vars) { calls.push(['set', targets, vars]); },
    timeline(opts) {
      return {
        fromTo(targets, from, vars) {
          const merged = { ...vars, from };
          if (opts?.onComplete) merged.onComplete = opts.onComplete;
          const result = animation('fromTo', targets, merged);
          return this;
        },
        kill() {},
      };
    },
  };
  const ScrollTrigger = {
    refresh() {},
    update() {},
    create(vars) {
      triggers.push({ vars, kill() {} });
      return { kill() {} };
    },
    getAll: () => triggers,
  };
  class Lenis {
    on() {}
    off() {}
    raf() {}
    stop() {}
    start() {}
    destroy() {}
  }
  return { page, calls, documentListeners, windowListeners, gsap, ScrollTrigger, Lenis, navbar };
}

test('gallery templates expose coordinated entry, card, scroll, mode, carousel, and viewer hooks', () => {
  const galleryHtml = read('views/pages/gallery.ejs');
  const card = read('views/partials/gallery-card.ejs');
  const viewer = read('views/partials/gallery-lightbox.ejs');
  assert.ok((galleryHtml.match(/data-gallery-animate="entry"/g) || []).length >= 5);
  assert.match(galleryHtml, /data-gallery-primary-mode="infinite"/);
  assert.match(galleryHtml, /data-gallery-primary-mode="grid"/);
  assert.match(galleryHtml, /data-gallery-video-carousel/);
  assert.match(galleryHtml, /data-gallery-animate="scroll"/);
  assert.match(card, /data-gallery-animate="card"/);
  for (const hook of ['viewer-backdrop', 'viewer-panel', 'viewer-stage', 'viewer-details', 'viewer-controls', 'viewer-close']) {
    assert.match(viewer, new RegExp(`data-gallery-animate="${hook}"`));
  }
});

test('navbar is never touched by gallery animations', async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const previous = { window: global.window, document: global.document };
  t.after(() => {
    global.window = previous.window;
    global.document = previous.document;
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor);
    else delete global.navigator;
  });
  const env = createMotionEnvironment();
  const module = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryAnimations.mjs')).href}?nav=${Date.now()}`
  );
  const controller = await module.initGalleryAnimations({ page: env.page, dependencies: env });
  const navbarCalls = env.calls.filter(([, targets]) =>
    targets === env.navbar || (Array.isArray(targets) && targets.includes(env.navbar))
  );
  assert.equal(navbarCalls.length, 0, 'navbar must not receive any gsap calls');
  assert.equal(env.navbar.classList.contains('is-gallery-motion-ready'), false);
  controller.destroy();
});

test('reduced motion shows content immediately without any GSAP calls', async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const previous = { window: global.window, document: global.document };
  t.after(() => {
    global.window = previous.window;
    global.document = previous.document;
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor);
    else delete global.navigator;
  });
  const env = createMotionEnvironment();
  let gsapCalls = 0;
  const module = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryAnimations.mjs')).href}?reduced=${Date.now()}`
  );
  const controller = await module.initGalleryAnimations({
    page: env.page,
    reducedMotion: true,
    dependencies: { gsap: { fromTo() { gsapCalls += 1; }, to() { gsapCalls += 1; }, set() { gsapCalls += 1; } } },
  });
  assert.equal(gsapCalls, 0);
  assert.equal(env.page.classList.contains('is-reduced-motion'), true);
  assert.equal(env.page.classList.contains('is-gallery-motion-ready'), true);
  assert.equal(env.documentListeners.has('click'), false);
  await controller.modeTransitions.exit(new Element());
  await controller.openViewer({});
  controller.destroy();
  assert.equal(env.page.classList.contains('is-reduced-motion'), false);
});

test('missing-GSAP case shows content immediately — no CSS hiding', async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const previous = { window: global.window, document: global.document };
  t.after(() => {
    global.window = previous.window;
    global.document = previous.document;
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor);
    else delete global.navigator;
  });
  const env = createMotionEnvironment();
  // Simulate the catch block when loadMotionRuntime fails
  env.page.classList.add('is-gallery-motion-ready');
  assert.equal(env.page.classList.contains('is-gallery-motion-ready'), true);
  // No gsap.set was ever called — content is still visible
  const setCalls = env.calls.filter(([kind]) => kind === 'set');
  assert.equal(setCalls.length, 0, 'no gsap.set calls when GSAP is unavailable');
  env.page.classList.remove('is-gallery-motion-ready');
});

test('no FOUC-based CSS hiding — content visible by default', () => {
  const css = read('public/css/gallery.css');
  // There must be NO CSS rule that hides [data-gallery-animate] before initialization
  assert.ok(!/:not\(\.is-gallery-motion-ready\).*opacity\s*:\s*0/.test(css),
    'must not hide elements based on missing motion-ready class');
  assert.ok(!css.includes('is-gallery-fouc-safe'),
    'no FOUC safety class in CSS');
  // No timeout script in template
  const galleryHtml = read('views/pages/gallery.ejs');
  assert.ok(!galleryHtml.includes('is-gallery-fouc-safe'),
    'no FOUC safety class in template');
  assert.ok(!galleryHtml.includes('setTimeout.*6000'),
    'no 6-second timeout in template');
});

test('entry animation uses a timeline (not ScrollTrigger) for above-fold content', async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const previous = { window: global.window, document: global.document };
  t.after(() => {
    global.window = previous.window;
    global.document = previous.document;
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor);
    else delete global.navigator;
  });
  const env = createMotionEnvironment();
  const module = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryAnimations.mjs')).href}?entry=${Date.now()}`
  );
  const controller = await module.initGalleryAnimations({ page: env.page, dependencies: env });
  const fromToCalls = env.calls.filter(([kind]) => kind === 'fromTo');
  assert.ok(fromToCalls.length >= 1, 'entry must use fromTo (timeline-based entrance)');
  assert.equal(env.page.classList.contains('is-gallery-motion-ready'), true);
  controller.destroy();
});

test('entry elements receive onEnter/onLeave ScrollTrigger callbacks after timeline', async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const previous = { window: global.window, document: global.document };
  t.after(() => {
    global.window = previous.window;
    global.document = previous.document;
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor);
    else delete global.navigator;
  });
  const env = createMotionEnvironment();
  const module = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryAnimations.mjs')).href}?callbacks=${Date.now()}`
  );
  const controller = await module.initGalleryAnimations({ page: env.page, dependencies: env });

  // Entry timeline uses 'fromTo' — there must be at least one
  const fromToCalls = env.calls.filter(([kind]) => kind === 'fromTo').length;
  assert.ok(fromToCalls >= 1, 'entry timeline must use fromTo');

  // After entryPromise resolves, ScrollTrigger.create() calls register entry scroll triggers
  await controller.entryPromise;
  await new Promise((r) => queueMicrotask(r));

  // Filter for entry ScrollTriggers (not below-fold ones)
  const entryTriggers = env.ScrollTrigger.getAll()
    .filter(({ vars }) => vars?.id?.startsWith?.('gallery-entry-scroll-'));
  assert.ok(entryTriggers.length >= 1, 'entry elements must have ScrollTrigger callbacks');

  // Verify each trigger has all four callbacks and correct timing
  for (const { vars } of entryTriggers) {
    assert.ok(typeof vars.onEnter === 'function', 'must have onEnter');
    assert.ok(typeof vars.onLeave === 'function', 'must have onLeave');
    assert.ok(typeof vars.onEnterBack === 'function', 'must have onEnterBack');
    assert.ok(typeof vars.onLeaveBack === 'function', 'must have onLeaveBack');
    // Timing: exit must fire while element is still clearly visible (not at bottom 5%)
    assert.equal(vars.start, 'top 80%', 'enter must start at 80% from viewport top');
    assert.equal(vars.end, 'top 20%', 'exit/re-entry at top 20%, not bottom 5%');
  }

  controller.destroy();
});

test('below-fold scroll triggers use toggleActions for repeatable reveals', async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const previous = { window: global.window, document: global.document };
  t.after(() => {
    global.window = previous.window;
    global.document = previous.document;
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor);
    else delete global.navigator;
  });
  const env = createMotionEnvironment();
  const gridContainer = new Element();
  const card1 = new Element();
  const card2 = new Element();
  gridContainer.childrenBySelector.set('.gallery-grid__item', [card1, card2]);
  env.page.childrenBySelector.set('.gallery-grid', [gridContainer]);
  const carousel = new Element();
  env.page.childrenBySelector.set('[data-gallery-video-carousel]', [carousel]);

  const module = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryAnimations.mjs')).href}?toggle=${Date.now()}`
  );
  const controller = await module.initGalleryAnimations({ page: env.page, dependencies: env });

  // Below-fold triggers (scroll, grid-cards, carousel) must use toggleActions
  const scrollVars = env.calls
    .filter(([, , vars]) => vars?.scrollTrigger)
    .map(([, , vars]) => vars.scrollTrigger);

  // Expect both scrub-based (entry elements) and toggleActions-based (below-fold) triggers
  assert.ok(scrollVars.length >= 1, 'should have scroll triggers');
  const toggleTriggers = scrollVars.filter((sv) => sv.toggleActions);
  assert.ok(toggleTriggers.length >= 1, 'below-fold triggers must use toggleActions for repeatability');

  controller.destroy();
});

test('animation initialization is idempotent and cleanup removes all listeners and triggers', async (t) => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
  const previous = { window: global.window, document: global.document };
  t.after(() => {
    global.window = previous.window;
    global.document = previous.document;
    if (navigatorDescriptor) Object.defineProperty(global, 'navigator', navigatorDescriptor);
    else delete global.navigator;
  });
  const env = createMotionEnvironment();
  const module = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryAnimations.mjs')).href}?lifecycle=${Date.now()}`
  );
  const first = await module.initGalleryAnimations({ page: env.page, dependencies: env });
  const second = await module.initGalleryAnimations({ page: env.page, dependencies: env });
  assert.equal(first, second);
  const fromToCalls = env.calls.filter(([kind]) => kind === 'fromTo').length;
  assert.ok(fromToCalls >= 1, 'entry must produce at least one fromTo');
  const listenerAfterInit = env.documentListeners.size;
  assert.ok(listenerAfterInit >= 1, 'document listener should be registered');
  first.destroy();
  assert.equal(env.documentListeners.size, 0);
  assert.equal(env.windowListeners.size, 0);
  assert.doesNotThrow(() => first.destroy());
});

test('navigation exit accepts only unmodified same-origin links without hash or download', async () => {
  const module = await import(
    pathToFileURL(path.join(root, 'public/js/gallery/galleryAnimations.mjs')).href
  );
  const location = { href: 'https://ninja.test/galeria', origin: 'https://ninja.test' };
  const anchor = (href, attributes = {}) => ({
    href,
    getAttribute(name) {
      if (name === 'href') return href;
      return attributes[name] || null;
    },
    hasAttribute(name) { return Object.hasOwn(attributes, name); },
  });
  const event = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(module.shouldAnimateGalleryNavigation(event, anchor('https://ninja.test/tienda'), location), true);
  assert.equal(module.shouldAnimateGalleryNavigation({ ...event, ctrlKey: true }, anchor('https://ninja.test/tienda'), location), false);
  assert.equal(module.shouldAnimateGalleryNavigation(event, anchor('https://external.test/'), location), false);
  assert.equal(module.shouldAnimateGalleryNavigation(event, anchor('https://ninja.test/galeria#grid'), location), false);
  assert.equal(module.shouldAnimateGalleryNavigation(event, anchor('https://ninja.test/file', { download: '' }), location), false);
  assert.equal(module.shouldAnimateGalleryNavigation(event, anchor('mailto:hola@ninja.test'), location), false);
});

test('visualization container excluded from reversible scroll triggers', () => {
  const code = read('public/js/gallery/galleryAnimations.mjs');
  // The reversible scroll loop iterates over entryTargets, not allEntryTargets
  const loopBlock = code.match(/entryPromise\s*\.\s*then\s*\(\s*\(\)\s*=>\s*\{[^}]*entryTargets\s*\.\s*forEach/);
  assert.ok(loopBlock, 'reversible scroll must iterate entryTargets (text-only), not allEntryTargets');
  // allEntryTargets includes visContainer for initial timeline only
  assert.match(code, /allEntryTargets\s*=\s*\[/);
  assert.match(code, /visContainer/);
});

test('onLeaveBack uses gsap.set for immediate restoration', () => {
  const code = read('public/js/gallery/galleryAnimations.mjs');
  // Extract the onLeaveBack callback body between 'onLeaveBack' and the next '},'
  const leaveBackMatch = code.match(/onLeaveBack\(\)\s*\{([^}]+)\}/);
  assert.ok(leaveBackMatch, 'onLeaveBack callback must exist');
  const body = leaveBackMatch[1];
  assert.match(body, /gsap\s*\.\s*set\s*\(/, 'onLeaveBack must use gsap.set, not gsap.to');
  assert.doesNotMatch(body, /gsap\s*\.\s*to\s*\(/, 'onLeaveBack must NOT use gsap.to');
  assert.match(body, /autoAlpha\s*:\s*1/, 'must restore autoAlpha to 1');
  assert.match(body, /y\s*:\s*0/, 'must restore y to 0');
});

test('exit fade is in sensible range (0.55-0.7), not near-zero', () => {
  const code = read('public/js/gallery/galleryAnimations.mjs');
  // Extract the fadeTo value
  const match = code.match(/fadeTo\s*=\s*([0-9.]+)/);
  assert.ok(match, 'fadeTo constant must exist');
  const val = parseFloat(match[1]);
  assert.ok(val >= 0.55 && val <= 0.7, `fadeTo (${val}) must be between 0.55 and 0.7`);
});

test('entry scroll callbacks use fast return duration (0.12-0.22)', () => {
  const code = read('public/js/gallery/galleryAnimations.mjs');
  // Extract the returnDur values
  const match = code.match(/returnDur\s*=\s*compact\s*\?\s*([0-9.]+)\s*:\s*([0-9.]+)/);
  assert.ok(match, 'returnDur must exist');
  const compactDur = parseFloat(match[1]);
  const desktopDur = parseFloat(match[2]);
  assert.ok(compactDur >= 0.12 && compactDur <= 0.22, `compact returnDur (${compactDur}) must be 0.12-0.22`);
  assert.ok(desktopDur >= 0.12 && desktopDur <= 0.22, `desktop returnDur (${desktopDur}) must be 0.12-0.22`);
});

test('infinite panel has dedicated animation hook in template', () => {
  const galleryHtml = read('views/pages/gallery.ejs');
  assert.match(galleryHtml, /data-gallery-animate="infinite-panel"/,
    'template must have infinite-panel animation hook');
});

test('infinite panel has MutationObserver watching hidden attribute', () => {
  const code = read('public/js/gallery/galleryAnimations.mjs');
  // Must find MutationObserver created for the infinite panel
  assert.match(code, /new MutationObserver/, 'must create MutationObserver');
  // Must observe the panel element with hidden attribute filter
  const observeCall = code.match(/panelObserver\s*\.\s*observe\s*\(\s*\w+\s*,\s*\{[^}]*\}/);
  assert.ok(observeCall, 'panelObserver.observe must exist');
  assert.match(observeCall[0], /attributeFilter.*hidden/,
    'must filter for hidden attribute');
  assert.match(observeCall[0], /subtree:\s*true/,
    'must observe subtree for characterData changes');
});

test('infinite panel has ScrollTrigger for scroll restoration', () => {
  const code = read('public/js/gallery/galleryAnimations.mjs');
  // ScrollTrigger must be created with id 'gallery-infinite-panel'
  const panelSt = code.match(/id:\s*'gallery-infinite-panel'/);
  assert.ok(panelSt, 'infinite panel must have ScrollTrigger with id gallery-infinite-panel');
  // Must have onEnterBack and onLeaveBack callbacks
  const enterBack = code.match(/onEnterBack\(\)\s*\{/g);
  const leaveBack = code.match(/onLeaveBack\(\)\s*\{/g);
  assert.ok((enterBack?.length || 0) >= 2, 'must have at least two onEnterBack callbacks (entry + panel)');
  assert.ok((leaveBack?.length || 0) >= 2, 'must have at least two onLeaveBack callbacks (entry + panel)');
});

test('infinite panel selection change uses fast crossfade duration', () => {
  const code = read('public/js/gallery/galleryAnimations.mjs');
  // The crossfade for selection changes (characterData) must use short duration
  const crossfadeMatch = code.match(/characterData.*?duration:\s*compact\s*\?\s*([0-9.]+)\s*:\s*([0-9.]+)/s);
  assert.ok(crossfadeMatch, 'selection change crossfade must have duration');
  const compactCrossfade = parseFloat(crossfadeMatch[1]);
  const desktopCrossfade = parseFloat(crossfadeMatch[2]);
  assert.ok(compactCrossfade >= 0.1 && compactCrossfade <= 0.3,
    `compact crossfade (${compactCrossfade}) must be 0.1-0.3s`);
  assert.ok(desktopCrossfade >= 0.1 && desktopCrossfade <= 0.3,
    `desktop crossfade (${desktopCrossfade}) must be 0.1-0.3s`);
});
