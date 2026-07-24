const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '..', 'public/js/ui/circularCarousel.mjs')
).href;

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(width = 1440, height = 570) {
    this.clientWidth = width;
    this.clientHeight = height;
    this.offsetWidth = width;
    this.offsetHeight = height;
    this.style = {};
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.className = '';
    this.parentElement = null;
    this.inert = false;
    this.capturedPointer = null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type, event) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }

  setPointerCapture(pointerId) {
    this.capturedPointer = pointerId;
  }

  releasePointerCapture(pointerId) {
    if (this.capturedPointer === pointerId) this.capturedPointer = null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (selector === '[data-circ-carousel-generated]'
          && child.attributes.has('data-circ-carousel-generated')) {
          matches.push(child);
        }
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }
}

function installDomEnvironment() {
  let nextRafId = 1;
  const rafCallbacks = new Map();
  const documentListeners = new Map();

  global.window = { innerWidth: 1440 };
  global.document = {
    hidden: false,
    createElement: () => new FakeElement(),
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      documentListeners.get(type)?.delete(handler);
    },
  };
  global.requestAnimationFrame = (callback) => {
    const id = nextRafId;
    nextRafId += 1;
    rafCallbacks.set(id, callback);
    return id;
  };
  global.cancelAnimationFrame = (id) => {
    rafCallbacks.delete(id);
  };

  return {
    step() {
      const first = rafCallbacks.entries().next().value;
      if (!first) return false;
      rafCallbacks.delete(first[0]);
      first[1](performance.now());
      return true;
    },
    flush(limit = 400) {
      let frames = 0;
      while (rafCallbacks.size && frames < limit) {
        this.step();
        frames += 1;
      }
      assert.ok(frames < limit, 'RAF settles before frame limit');
      return frames;
    },
    get pendingFrames() {
      return rafCallbacks.size;
    },
    documentListeners,
  };
}

function pointerEvent({
  pointerId,
  clientX,
  clientY,
  timeStamp,
  type,
  preventDefault = () => {},
}) {
  return {
    pointerId,
    clientX,
    clientY,
    timeStamp,
    type,
    button: 0,
    target: { closest: () => null },
    preventDefault,
  };
}

test('fractional slot interpolation and wrapped lookup stay continuous', async () => {
  const {
    interpolateSlotPresentation,
    safeModulo,
    wrappedDistance,
  } = await import(moduleUrl);

  const between = {};
  assert.equal(interpolateSlotPresentation(-1.35, 'desktop', between), true);
  assert.ok(between.xRatio < -0.22 && between.xRatio > -0.43);
  assert.ok(between.scale < 0.96 && between.scale > 0.88);
  assert.ok(between.opacity < 0.92 && between.opacity > 0.76);

  const leaving = {};
  assert.equal(interpolateSlotPresentation(2.3, 'desktop', leaving), true);
  assert.ok(leaving.opacity > 0 && leaving.opacity < 0.76);
  assert.equal(interpolateSlotPresentation(2.6, 'desktop', {}), false);

  assert.equal(safeModulo(-1, 6), 5);
  assert.equal(safeModulo(6001, 6), 1);
  assert.ok(Math.abs(wrappedDistance(0, 6000.4, 6) + 0.4) < 1e-9);
});

test('runtime navigation animates, wraps, axis-locks, settles, and cleans up', async () => {
  const { createCircularCarousel } = await import(moduleUrl);
  const env = installDomEnvironment();
  const root = new FakeElement();
  const cards = [];
  const activeChanges = [];

  const carousel = createCircularCarousel({
    root,
    items: Array.from({ length: 6 }, (_, index) => ({ index })),
    renderItem(item) {
      const card = new FakeElement();
      card.item = item;
      cards.push(card);
      return card;
    },
    onActiveChange(_item, index) {
      activeChanges.push(index);
    },
  });

  assert.equal(activeChanges.at(-1), 0);
  assert.equal(cards.filter(card => card.style.display !== 'none').length, 5);
  assert.equal(root.listeners.has('wheel'), false);

  const initialTransform = cards[0].style.transform;
  carousel.next();
  assert.equal(carousel.currentPosition, 0);
  assert.equal(carousel.targetPosition, 1);
  env.step();
  assert.ok(carousel.currentPosition > 0 && carousel.currentPosition < 1);
  assert.notEqual(cards[0].style.transform, initialTransform);
  assert.equal(carousel.activeIndex, 0, 'live status waits for settle');
  env.flush();
  assert.equal(carousel.activeIndex, 1);
  assert.equal(carousel.isSettled, true);
  assert.equal(env.pendingFrames, 0);

  carousel.next();
  carousel.next();
  carousel.next();
  assert.equal(carousel.targetPosition, 4);
  env.flush();
  assert.equal(carousel.activeIndex, 4);

  carousel.next();
  env.flush();
  assert.equal(carousel.activeIndex, 5);
  assert.equal(carousel.targetPosition, 5);
  carousel.next();
  assert.equal(carousel.targetPosition, 6, 'last to first advances one unbounded step');
  env.flush();
  assert.equal(carousel.activeIndex, 0);

  carousel.prev();
  assert.equal(carousel.targetPosition, 5, 'first to last reverses one unbounded step');
  env.flush();
  assert.equal(carousel.activeIndex, 5);

  for (let index = 0; index < 30; index += 1) carousel.next();
  assert.equal(carousel.targetPosition, 35);
  env.flush();
  assert.equal(carousel.activeIndex, 5);

  carousel.goTo(0);
  assert.equal(carousel.targetPosition, 36, 'goTo chooses adjacent forward wrap');
  env.flush();
  carousel.goTo(5);
  assert.equal(carousel.targetPosition, 35, 'goTo chooses adjacent reverse wrap');
  env.flush();

  let verticalPrevented = false;
  root.emit('pointerdown', pointerEvent({
    pointerId: 1, clientX: 100, clientY: 100, timeStamp: 0, type: 'pointerdown',
  }));
  root.emit('pointermove', pointerEvent({
    pointerId: 1,
    clientX: 103,
    clientY: 140,
    timeStamp: 16,
    type: 'pointermove',
    preventDefault: () => { verticalPrevented = true; },
  }));
  assert.equal(verticalPrevented, false);
  assert.equal(root.capturedPointer, null);
  assert.equal(carousel.targetPosition, 35);

  let horizontalPrevented = false;
  root.emit('pointerdown', pointerEvent({
    pointerId: 2, clientX: 220, clientY: 100, timeStamp: 20, type: 'pointerdown',
  }));
  root.emit('pointermove', pointerEvent({
    pointerId: 2,
    clientX: 20,
    clientY: 103,
    timeStamp: 40,
    type: 'pointermove',
    preventDefault: () => { horizontalPrevented = true; },
  }));
  assert.equal(horizontalPrevented, true);
  assert.equal(root.capturedPointer, 2);
  assert.ok(carousel.targetPosition > 35);
  root.emit('pointerup', pointerEvent({
    pointerId: 2, clientX: 20, clientY: 103, timeStamp: 48, type: 'pointerup',
  }));
  assert.equal(root.capturedPointer, null);
  assert.equal(carousel.targetPosition, Math.round(carousel.targetPosition));
  env.flush();

  carousel.next();
  carousel.pause('test');
  const pausedPosition = carousel.currentPosition;
  assert.equal(env.pendingFrames, 0);
  assert.equal(env.step(), false);
  assert.equal(carousel.currentPosition, pausedPosition);
  carousel.resume('test');
  env.flush();

  carousel.destroy();
  assert.equal(env.pendingFrames, 0);
  assert.equal(root.children.length, 0);
  for (const listeners of root.listeners.values()) assert.equal(listeners.size, 0);
  for (const listeners of env.documentListeners.values()) assert.equal(listeners.size, 0);
});

test('reduced motion reaches adjacent wrapped services without inertia', async () => {
  const { createCircularCarousel } = await import(moduleUrl);
  const env = installDomEnvironment();
  const root = new FakeElement();
  const carousel = createCircularCarousel({
    root,
    items: Array.from({ length: 6 }, (_, index) => ({ index })),
    renderItem: () => new FakeElement(),
    reducedMotion: true,
  });

  carousel.prev();
  env.flush();
  assert.equal(carousel.currentPosition, -1);
  assert.equal(carousel.targetPosition, -1);
  assert.equal(carousel.activeIndex, 5);
  carousel.destroy();
});
