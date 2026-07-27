const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

class MockClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }
}

class MockElement {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.hidden = false;
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new MockClassList();
    this.textContent = '';
    this.title = '';
    this.href = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name) {
    this.listeners.delete(name);
  }

  dispatch(name, event = {}) {
    this.listeners.get(name)?.({
      preventDefault() {},
      ...event,
    });
  }

  querySelectorAll() {
    return [];
  }

  focus() {}
}

function createModeEnvironment() {
  const grid = new MockElement();
  const primaryModes = {
    grid: new MockElement({ galleryPrimaryMode: 'grid' }),
    infinite: new MockElement({ galleryPrimaryMode: 'infinite' }),
  };
  const infinite = {
    stage: new MockElement(),
    loader: new MockElement(),
    overlay: new MockElement(),
    title: new MockElement(),
    meta: new MockElement(),
    action: new MockElement(),
    fallback: new MockElement(),
    live: new MockElement(),
  };
  const circular = {
    stage: new MockElement(),
    loader: new MockElement(),
    overlay: new MockElement(),
    title: new MockElement(),
    meta: new MockElement(),
    action: new MockElement(),
    fallback: new MockElement(),
    live: new MockElement(),
  };
  const infiniteLink = new MockElement({ galleryView: 'infinite' });
  infiniteLink.href = 'http://localhost/galeria?view=infinite';
  const gridLink = new MockElement({ galleryView: 'grid' });
  gridLink.href = 'http://localhost/galeria?view=grid';
  const selectors = new Map([
    ['[data-gallery-grid]', grid],
    ['[data-gallery-primary-mode="grid"]', primaryModes.grid],
    ['[data-gallery-primary-mode="infinite"]', primaryModes.infinite],
    ['[data-gallery-circular]', circular.stage],
    ['[data-gallery-circular-loader]', circular.loader],
    ['[data-gallery-circular-overlay]', circular.overlay],
    ['[data-gallery-circular-title]', circular.title],
    ['[data-gallery-circular-meta]', circular.meta],
    ['[data-gallery-circular-action]', circular.action],
    ['[data-gallery-circular-fallback]', circular.fallback],
    ['[data-gallery-circular-live]', circular.live],
    ['[data-gallery-infinite]', infinite.stage],
    ['[data-gallery-infinite-loader]', infinite.loader],
    ['[data-gallery-infinite-overlay]', infinite.overlay],
    ['[data-gallery-infinite-title]', infinite.title],
    ['[data-gallery-infinite-meta]', infinite.meta],
    ['[data-gallery-infinite-action]', infinite.action],
    ['[data-gallery-infinite-fallback]', infinite.fallback],
    ['[data-gallery-infinite-live]', infinite.live],
  ]);
  const page = {
    dataset: { requestedView: 'infinite' },
    querySelector: (selector) => selectors.get(selector) || null,
    querySelectorAll: (selector) => (selector === '[data-gallery-view]' ? [infiniteLink, gridLink] : []),
  };
  return { page, grid, primaryModes, infinite, circular, infiniteLink, gridLink };
}

const flushTransitions = () => new Promise((resolve) => setImmediate(resolve));

test('public gallery renders only Infinite and Grid controls with Infinite active by default', () => {
  const view = read('views/pages/gallery.ejs');
  assert.equal((view.match(/data-gallery-view=/g) || []).length, 2);
  assert.match(view, /data-gallery-view="infinite"[\s\S]*>Menú infinito</);
  assert.match(view, /data-gallery-view="grid"[\s\S]*>Cuadrícula</);
  assert.doesNotMatch(view, /data-gallery-view="(?:circular|ring)"/);
  assert.match(view, /data-gallery-primary-mode="grid"[\s\S]*filters\.view !== 'grid'[\s\S]*hidden/);
  assert.match(view, /data-gallery-primary-mode="infinite"[\s\S]*filters\.view !== 'infinite'[\s\S]*hidden/);
  assert.equal((view.match(/data-gallery-infinite-canvas/g) || []).length, 1);
  const infiniteContainerIndex = view.indexOf('data-gallery-primary-mode="infinite"');
  const gridContainerIndex = view.indexOf('data-gallery-primary-mode="grid"');
  const carouselIndex = view.indexOf('data-gallery-video-carousel');
  assert.ok(infiniteContainerIndex < gridContainerIndex);
  assert.ok(gridContainerIndex < carouselIndex);
});

test('gallery hidden state cannot be overridden by layout display rules', () => {
  const css = read('public/css/gallery.css');
  assert.match(css, /body\.page-gallery \[hidden\] \{\s*display: none !important;\s*\}/);
  const hiddenRules = [...css.matchAll(/([^{}]*\[hidden\][^{}]*)\{([^{}]*)\}/g)];
  assert.ok(hiddenRules.length > 0);
  hiddenRules.forEach(([, selector, declarations]) => {
    const displayValues = [...declarations.matchAll(/display:\s*([^;]+)/g)].map((match) => match[1].trim());
    displayValues.forEach((value) => {
      assert.match(value, /^none(?:\s*!important)?$/, `${selector.trim()} must not display hidden content`);
    });
  });
});

test('mode lifecycle initializes one primary renderer and preserves one video companion', async (t) => {
  const previousWindow = global.window;
  const listeners = new Map();
  global.window = {
    location: { href: 'http://localhost/galeria', hostname: 'localhost', search: '' },
    history: { pushState() {} },
    setTimeout,
    clearTimeout,
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  t.after(() => {
    global.window = previousWindow;
  });

  const modes = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryModes.mjs')).href}?two-modes=${Date.now()}`
  );
  const env = createModeEnvironment();
  const counts = {
    infiniteCreated: 0,
    infiniteDestroyed: 0,
    circularCreated: 0,
    circularDestroyed: 0,
    infiniteLive: 0,
    infinitePeak: 0,
  };
  const transitionEvents = [];
  let resolveFirstExit;
  let holdFirstExit = true;
  const transitions = {
    exit(container, mode) {
      transitionEvents.push(`exit:${mode}`);
      if (!holdFirstExit) return Promise.resolve();
      return new Promise((resolve) => {
        resolveFirstExit = () => {
          holdFirstExit = false;
          resolve();
        };
      });
    },
    enter(container, mode) {
      transitionEvents.push(`enter:${mode}`);
      return Promise.resolve();
    },
    reset() {},
    revealCarousel() { return Promise.resolve(); },
  };
  const renderer = (kind) => {
    counts[`${kind}Created`] += 1;
    if (kind === 'infinite') {
      counts.infiniteLive += 1;
      counts.infinitePeak = Math.max(counts.infinitePeak, counts.infiniteLive);
    }
    return {
      ready: Promise.resolve(),
      destroy() {
        counts[`${kind}Destroyed`] += 1;
        if (kind === 'infinite') counts.infiniteLive -= 1;
      },
    };
  };
  const cleanup = modes.setupGalleryModes({
    page: env.page,
    items: [{
      id: 1,
      title: 'Video',
      category: 'Demo',
      type: 'video',
      source: '/uploads/gallery/videos/demo.mp4',
    }],
    openGalleryItemById() {},
    dependencies: {
      createInfiniteRenderer: () => renderer('infinite'),
      createCircularRenderer: () => renderer('circular'),
      supportsInfiniteGallery: () => ({ supported: true, reason: '' }),
      supportsCircularGallery: () => ({ supported: true, reason: '' }),
      transitions,
    },
  });

  await flushTransitions();
  await flushTransitions();
  assert.equal(env.primaryModes.infinite.hidden, false);
  assert.equal(env.primaryModes.grid.hidden, true);
  assert.equal(env.primaryModes.infinite.attributes.get('aria-hidden'), 'false');
  assert.equal(env.primaryModes.grid.attributes.get('aria-hidden'), 'true');
  assert.equal(Number(!env.primaryModes.infinite.hidden) + Number(!env.primaryModes.grid.hidden), 1);
  assert.equal(counts.infiniteCreated - counts.infiniteDestroyed, 1);
  assert.equal(counts.infinitePeak, 1);
  assert.equal(counts.circularCreated - counts.circularDestroyed, 1);
  assert.equal(env.infiniteLink.attributes.get('aria-current'), 'true');
  assert.deepEqual(transitionEvents, ['enter:infinite']);

  const duplicateCleanup = modes.setupGalleryModes({
    page: env.page,
    items: [],
    openGalleryItemById() {},
  });
  assert.equal(duplicateCleanup, cleanup);
  assert.equal(counts.infiniteCreated, 1);

  env.gridLink.dispatch('click');
  await flushTransitions();
  assert.equal(env.primaryModes.infinite.hidden, false, 'outgoing mode remains visible during exit');
  assert.equal(env.primaryModes.grid.hidden, true);
  assert.equal(counts.infiniteDestroyed, 0, 'renderer remains alive until exit finishes');
  assert.equal(typeof resolveFirstExit, 'function');
  resolveFirstExit();
  await flushTransitions();
  await flushTransitions();
  assert.equal(env.primaryModes.infinite.hidden, true);
  assert.equal(env.primaryModes.grid.hidden, false);
  assert.equal(env.primaryModes.infinite.attributes.get('aria-hidden'), 'true');
  assert.equal(env.primaryModes.grid.attributes.get('aria-hidden'), 'false');
  assert.equal(Number(!env.primaryModes.infinite.hidden) + Number(!env.primaryModes.grid.hidden), 1);
  assert.equal(counts.infiniteCreated - counts.infiniteDestroyed, 0);
  assert.equal(counts.circularCreated, 1);
  assert.equal(counts.circularDestroyed, 0);
  assert.equal(env.gridLink.attributes.get('aria-current'), 'true');
  assert.deepEqual(transitionEvents.slice(1, 3), ['exit:infinite', 'enter:grid']);

  env.infiniteLink.dispatch('keydown', { key: ' ' });
  await flushTransitions();
  await flushTransitions();
  assert.equal(env.primaryModes.infinite.hidden, false);
  assert.equal(env.primaryModes.grid.hidden, true);
  assert.equal(Number(!env.primaryModes.infinite.hidden) + Number(!env.primaryModes.grid.hidden), 1);
  assert.equal(counts.infiniteCreated - counts.infiniteDestroyed, 1);
  assert.equal(counts.infinitePeak, 1);
  assert.equal(counts.circularCreated, 1);
  assert.equal(counts.circularDestroyed, 0);

  cleanup();
  assert.equal(counts.infiniteCreated, counts.infiniteDestroyed);
  assert.equal(counts.circularCreated, counts.circularDestroyed);
});

test('legacy and invalid values cannot select or initialize removed modes', async () => {
  const modes = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryModes.mjs')).href}?legacy=${Date.now()}`
  );
  for (const value of [undefined, '', 'circular', 'ring', 'invalid', '<script>']) {
    assert.equal(modes.normalizeGalleryView(value), 'infinite');
  }
  const source = read('public/js/gallery/galleryModes.mjs');
  assert.doesNotMatch(source, /RingGalleryRenderer|ringGalleryRenderer|data-gallery-ring/);
  assert.doesNotMatch(source, /mode === 'circular'|mode === 'ring'/);
});
