const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.isConnected = true;
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = new ClassList();
    this.children = new Map();
    this.textContent = '';
    this.focused = false;
    this.pauseCount = 0;
    this.loadCount = 0;
  }
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
  }
  removeEventListener(name, handler) { this.listeners.get(name)?.delete(handler); }
  dispatch(name, event = {}) {
    this.listeners.get(name)?.forEach((handler) => handler({
      preventDefault() {},
      target: this,
      ...event,
    }));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'src' || name === 'poster') this[name] = '';
  }
  querySelector(selector) { return this.children.get(selector)?.[0] || null; }
  querySelectorAll(selector) { return this.children.get(selector) || []; }
  focus() { this.focused = true; }
  pause() { this.pauseCount += 1; }
  load() { this.loadCount += 1; }
}

function createEnvironment() {
  const elements = {
    modal: new Element(),
    dialog: new Element('section'),
    stage: new Element(),
    status: new Element('p'),
    image: new Element('img'),
    video: new Element('video'),
    title: new Element('h2'),
    description: new Element('p'),
    category: new Element('p'),
    position: new Element('span'),
    previous: new Element('button'),
    next: new Element('button'),
    open: new Element('button'),
    close: new Element('button'),
  };
  elements.modal.hidden = true;
  elements.image.hidden = true;
  elements.video.hidden = true;
  elements.open.dataset.galleryId = '2';
  const thumbnail = new Element('img');
  elements.open.children.set('[data-gallery-thumbnail]', [thumbnail]);
  elements.dialog.children.set(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    [elements.close, elements.previous, elements.next]
  );
  const selectors = new Map([
    ['[data-gallery-modal]', elements.modal],
    ['[data-gallery-dialog]', elements.dialog],
    ['[data-gallery-stage]', elements.stage],
    ['[data-gallery-status]', elements.status],
    ['[data-gallery-image]', elements.image],
    ['[data-gallery-video]', elements.video],
    ['[data-gallery-title]', elements.title],
    ['[data-gallery-description]', elements.description],
    ['[data-gallery-category]', elements.category],
    ['[data-gallery-position]', elements.position],
    ['[data-gallery-previous]', elements.previous],
    ['[data-gallery-next]', elements.next],
  ]);
  const page = {
    querySelector: (selector) => selectors.get(selector) || null,
    querySelectorAll(selector) {
      if (selector === '[data-gallery-open]') return [elements.open];
      if (selector === '[data-gallery-close]') return [elements.close];
      return [];
    },
  };
  const documentListeners = new Map();
  global.document = {
    activeElement: null,
    body: { classList: new ClassList() },
    addEventListener(name, handler) { documentListeners.set(name, handler); },
    removeEventListener(name) { documentListeners.delete(name); },
  };
  return { page, elements, documentListeners };
}

test('viewer animates open/close, pauses video, clears media listeners, and restores focus', async (t) => {
  const previousDocument = global.document;
  t.after(() => { global.document = previousDocument; });
  const env = createEnvironment();
  let resolveClose;
  const calls = [];
  const animations = {
    cancelViewer() { calls.push('cancel'); },
    async openViewer() { calls.push('open'); },
    closeViewer() {
      calls.push('close');
      return new Promise((resolve) => { resolveClose = resolve; });
    },
  };
  const module = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryViewer.mjs')).href}?viewer=${Date.now()}`
  );
  const viewer = module.createGalleryViewer({
    page: env.page,
    items: [
      { id: 1, type: 'image', source: '/uploads/gallery/images/a.webp', title: 'Imagen' },
      { id: 2, type: 'video', source: '/uploads/gallery/videos/a.mp4', title: 'Video', category: 'Demo' },
    ],
    animations,
  });

  await viewer.openGalleryItemById(2, env.elements.open);
  assert.equal(env.elements.modal.hidden, false);
  assert.equal(env.elements.dialog.focused, true);
  assert.equal(env.elements.video.hidden, false);
  assert.equal(env.elements.video.src, '/uploads/gallery/videos/a.mp4');
  assert.deepEqual(calls, ['cancel', 'open']);

  const closePromise = viewer.close();
  assert.equal(env.elements.video.pauseCount > 0, true);
  assert.equal(env.elements.modal.hidden, false, 'modal remains mounted during exit animation');
  resolveClose();
  await closePromise;
  assert.equal(env.elements.modal.hidden, true);
  assert.equal(env.elements.video.src, '');
  assert.equal(env.elements.open.focused, true);
  assert.equal(document.body.classList.values.has('is-gallery-modal-open'), false);
  assert.deepEqual(calls, ['cancel', 'open', 'close']);
  viewer.destroy();
  assert.equal(env.documentListeners.size, 0);
});

test('viewer keeps Escape, backdrop close, focus trap, arrows, and native video keys', async (t) => {
  const previousDocument = global.document;
  t.after(() => { global.document = previousDocument; });
  const env = createEnvironment();
  const module = await import(
    `${pathToFileURL(path.join(root, 'public/js/gallery/galleryViewer.mjs')).href}?keys=${Date.now()}`
  );
  const viewer = module.createGalleryViewer({
    page: env.page,
    items: [{ id: 2, type: 'video', source: '/uploads/gallery/videos/a.mp4', title: 'Video' }],
  });
  await viewer.openGalleryItemById(2, env.elements.open);
  const keydown = env.documentListeners.get('keydown');
  document.activeElement = env.elements.video;
  keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(env.elements.position.textContent, '1 de 1');
  document.activeElement = env.elements.close;
  keydown({ key: 'Tab', shiftKey: true, preventDefault() {} });
  assert.equal(env.elements.next.focused, true);
  keydown({ key: 'Escape', preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.elements.modal.hidden, true);
  viewer.destroy();
});
