const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'admin', 'media-selector.js'),
  'utf8'
);

class ClassList {
  constructor(initial = '') {
    this.values = new Set(initial.split(/\s+/).filter(Boolean));
  }

  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    if (force === undefined ? !this.values.has(value) : force) this.values.add(value);
    else this.values.delete(value);
  }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(name = 'element') {
    this.name = name;
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.children = [];
    this.classList = new ClassList();
    this.value = '';
    this.disabled = false;
    this.open = false;
    this.files = [];
    this.showCount = 0;
    this.closeCount = 0;
    this.focusCount = 0;
    this._innerHTML = '';
    this._textContent = '';
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  emit(type, overrides = {}) {
    const event = {
      target: this,
      currentTarget: this,
      preventDefault() { this.defaultPrevented = true; },
      ...overrides,
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(child => child !== this);
  }

  setAttribute(name, value) {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  querySelector(selector) {
    if (selector === '[data-ms-item]') return this.children[0] || null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '[data-ms-item]') return this.children;
    if (selector === 'option:not(:first-child)') return this.children.slice(1);
    return [];
  }

  showModal() {
    if (this.open) throw new Error('InvalidStateError');
    this.open = true;
    this.showCount += 1;
  }

  close(returnValue = '') {
    if (!this.open) return;
    this.open = false;
    this.returnValue = returnValue;
    this.closeCount += 1;
    this.emit('close');
  }

  focus() { this.focusCount += 1; }
  click() { this.emit('click'); }
  closest(selector) {
    if (selector.includes(`[data-${this.name}]`)) return this;
    return null;
  }

  set textContent(value) {
    this._textContent = String(value);
    this._innerHTML = escapeHtml(this._textContent);
  }
  get textContent() { return this._textContent; }
  set innerHTML(value) {
    this._innerHTML = String(value);
    if (value === '') this.children = [];
  }
  get innerHTML() { return this._innerHTML; }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function createSelector({
  fieldName = 'hero_image',
  allowedTypes = 'image/jpeg,image/png,image/webp',
  allowedCategories = 'hero,background',
  uploadProfile = 'hero-image',
} = {}) {
  const root = new Element('root');
  root.dataset = {
    fieldName,
    allowedTypes,
    allowedCategories,
    uploadProfile,
    kindLabel: allowedTypes.includes('model/') ? 'Modelo' : 'Imagen',
  };

  const nodes = {
    preview: new Element('ms-preview'),
    input: new Element('ms-input'),
    modal: new Element('ms-modal'),
    grid: new Element('ms-grid'),
    pagination: new Element('ms-pagination'),
    search: new Element('ms-search'),
    category: new Element('ms-category-filter'),
    type: new Element('ms-type-filter'),
    confirm: new Element('ms-confirm'),
    searchForm: new Element('ms-search-form'),
    cancel: new Element('ms-cancel'),
    libraryTab: new Element('ms-tab'),
    uploadTab: new Element('ms-tab'),
    libraryPanel: new Element('ms-panel'),
    uploadPanel: new Element('ms-panel'),
    uploadZone: new Element('ms-upload-zone'),
    fileInput: new Element('ms-file-input'),
    uploadFile: new Element('ms-upload-file'),
    uploadFilename: new Element('ms-upload-filename'),
    uploadClear: new Element('ms-upload-clear'),
    uploadProgress: new Element('ms-upload-progress'),
    uploadStatus: new Element('ms-upload-status'),
    uploadError: new Element('ms-upload-error'),
    uploadActions: new Element('ms-upload-actions'),
    uploadButton: new Element('ms-upload-btn'),
    uploadRetry: new Element('ms-upload-retry'),
  };
  nodes.libraryTab.dataset.msTab = 'library';
  nodes.uploadTab.dataset.msTab = 'upload';
  nodes.libraryPanel.dataset.msPanel = 'library';
  nodes.uploadPanel.dataset.msPanel = 'upload';
  nodes.category.appendChild(new Element('option'));
  nodes.type.appendChild(new Element('option'));

  const selectors = new Map([
    ['[data-ms-preview]', nodes.preview],
    ['[data-ms-input]', nodes.input],
    ['[data-ms-modal]', nodes.modal],
    ['[data-ms-grid]', nodes.grid],
    ['[data-ms-pagination]', nodes.pagination],
    ['[data-ms-search]', nodes.search],
    ['[data-ms-category-filter]', nodes.category],
    ['[data-ms-type-filter]', nodes.type],
    ['[data-ms-confirm]', nodes.confirm],
    ['[data-ms-search-form]', nodes.searchForm],
    ['[data-ms-cancel]', nodes.cancel],
    ['[data-ms-upload-zone]', nodes.uploadZone],
    ['[data-ms-file-input]', nodes.fileInput],
    ['[data-ms-upload-file]', nodes.uploadFile],
    ['[data-ms-upload-filename]', nodes.uploadFilename],
    ['[data-ms-upload-clear]', nodes.uploadClear],
    ['[data-ms-upload-progress]', nodes.uploadProgress],
    ['[data-ms-upload-status]', nodes.uploadStatus],
    ['[data-ms-upload-error]', nodes.uploadError],
    ['[data-ms-upload-actions]', nodes.uploadActions],
    ['[data-ms-upload-btn]', nodes.uploadButton],
    ['[data-ms-upload-retry]', nodes.uploadRetry],
  ]);
  root.querySelector = selector => selectors.get(selector) || null;
  root.querySelectorAll = (selector) => {
    if (selector === '[data-ms-tab]') return [nodes.libraryTab, nodes.uploadTab];
    if (selector === '[data-ms-panel]') return [nodes.libraryPanel, nodes.uploadPanel];
    return [];
  };
  return { root, nodes };
}

function createRuntime(selectors, fetchImpl) {
  const timers = [];
  const documentListeners = new Map();
  const document = {
    readyState: 'complete',
    activeElement: null,
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === '[data-media-selector]' ? selectors.map(item => item.root) : [];
    },
    createElement: name => new Element(name),
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
  };
  const sandbox = {
    window: {},
    document,
    console,
    URLSearchParams,
    AbortController,
    FormData: class {
      constructor() { this.entries = []; }
      append(key, value) { this.entries.push([key, value]); }
    },
    fetch: fetchImpl,
    clearTimeout(timer) {
      const entry = timers.find(item => item.id === timer);
      if (entry) entry.cleared = true;
    },
    setTimeout(callback, delay) {
      const entry = { id: timers.length + 1, callback, delay, cleared: false };
      timers.push(entry);
      return entry.id;
    },
  };
  vm.runInNewContext(scriptSource, sandbox, { filename: 'media-selector.js' });
  return {
    sandbox,
    timers,
    runScriptAgain() {
      vm.runInNewContext(scriptSource, sandbox, { filename: 'media-selector.js' });
    },
    flushTimers(delay = Infinity) {
      timers.filter(timer => !timer.cleared && timer.delay <= delay).forEach((timer) => {
        timer.cleared = true;
        timer.callback();
      });
    },
    controller(index = 0) {
      return sandbox.window.NLMediaSelector.getController(selectors[index].root);
    },
  };
}

function jsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => payload,
  };
}

function nextTick() {
  return new Promise(resolve => setImmediate(resolve));
}

test('initializes every selector once even if the script executes twice', () => {
  const first = createSelector();
  const second = createSelector({ fieldName: 'mobile_logo' });
  const runtime = createRuntime([first, second], async () => jsonResponse({ assets: [] }));
  assert.equal(first.root.dataset.mediaSelectorInitialized, '1');
  assert.equal(second.root.dataset.mediaSelectorInitialized, '1');
  assert.equal(first.nodes.preview.listeners.get('click').length, 1);
  runtime.runScriptAgain();
  assert.equal(first.nodes.preview.listeners.get('click').length, 1);
  assert.equal(first.nodes.modal.listeners.get('close').length, 1);
  assert.equal(runtime.controller().fieldName, 'hero_image');
});

test('one open produces one visible dialog and one request; rapid repeats are ignored', async () => {
  const selector = createSelector();
  let resolveRequest;
  const requests = [];
  const runtime = createRuntime([selector], (url, options) => {
    requests.push({ url, options });
    return new Promise(resolve => { resolveRequest = resolve; });
  });
  const controller = runtime.controller();
  const opener = new Element('ms-select');
  const firstOpen = controller.open({ preventDefault() {}, currentTarget: opener });
  const secondOpen = controller.open({ preventDefault() {}, currentTarget: opener });
  assert.equal(selector.nodes.modal.showCount, 1);
  assert.equal(requests.length, 1);
  assert.equal(await secondOpen, false);
  resolveRequest(jsonResponse({ assets: [], categories: [] }));
  assert.equal(await firstOpen, true);
  assert.equal(controller.getState().loading, false);
});

test('search is debounced; filters, rendering, and pagination issue only intended loads', async () => {
  const selector = createSelector();
  const requests = [];
  const runtime = createRuntime([selector], async (url) => {
    requests.push(url);
    return jsonResponse({
      assets: [{ public_id: 'asset-1', title: 'Hero', mime_type: 'image/webp' }],
      categories: ['hero'],
      totalPages: 2,
    });
  });
  await runtime.controller().open({ preventDefault() {}, currentTarget: new Element('ms-select') });
  assert.equal(requests.length, 1);
  assert.equal(selector.nodes.pagination.children.length, 2);
  selector.nodes.search.value = 'ninjalab';
  selector.nodes.search.emit('input');
  selector.nodes.search.emit('input');
  assert.equal(requests.length, 1);
  runtime.flushTimers(300);
  await nextTick();
  assert.equal(requests.length, 2);
  selector.nodes.category.value = 'hero';
  selector.nodes.category.emit('change');
  await nextTick();
  assert.equal(requests.length, 3);
  selector.nodes.pagination.children[1].click();
  await nextTick();
  assert.equal(requests.length, 4);
  assert.match(requests[3], /page=2/);
});

test('forced load aborts the old request and loading clears after success and failure', async () => {
  const selector = createSelector();
  const calls = [];
  const runtime = createRuntime([selector], (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Promise(() => {});
    if (calls.length === 2) return Promise.resolve(jsonResponse({ assets: [] }));
    return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
  });
  const controller = runtime.controller();
  void controller.load(1);
  assert.equal(controller.getState().loading, true);
  await controller.load(2, { force: true });
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(controller.getState().loading, false);
  assert.equal(controller.getState().loaded, true);
  assert.equal(await controller.load(1, { force: true }), false);
  assert.equal(controller.getState().loading, false);
  assert.match(selector.nodes.grid.innerHTML, /No se pudo cargar la biblioteca/);
});

test('modal close aborts, restores focus, and backdrop handling ignores internal clicks', async () => {
  const selector = createSelector();
  let requestSignal;
  const runtime = createRuntime([selector], (_url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  });
  const opener = new Element('ms-select');
  void runtime.controller().open({ preventDefault() {}, currentTarget: opener });
  selector.nodes.modal.emit('click', { target: new Element('inside') });
  assert.equal(selector.nodes.modal.open, true);
  selector.nodes.modal.emit('click', { target: selector.nodes.modal });
  assert.equal(selector.nodes.modal.open, false);
  assert.equal(requestSignal.aborted, true);
  runtime.flushTimers(0);
  assert.equal(opener.focusCount, 1);
  assert.equal(runtime.controller().getState().loading, false);
});

test('two selectors keep fields, restrictions, selection, and clear state independent', async () => {
  const imageSelector = createSelector({
    fieldName: 'desktop_image',
    allowedTypes: 'image/jpeg,image/png,image/webp',
  });
  const modelSelector = createSelector({
    fieldName: 'hero_model',
    allowedTypes: 'model/gltf-binary,application/octet-stream',
    allowedCategories: 'model',
    uploadProfile: 'hero-model',
  });
  const requests = [];
  const runtime = createRuntime([imageSelector, modelSelector], async (url) => {
    requests.push(url);
    return jsonResponse({ assets: [] });
  });
  const image = runtime.controller(0);
  const model = runtime.controller(1);
  await image.open({ preventDefault() {}, currentTarget: new Element('ms-select') });
  image.close();
  await model.open({ preventDefault() {}, currentTarget: new Element('ms-select') });
  assert.equal(image.fieldName, 'desktop_image');
  assert.equal(model.fieldName, 'hero_model');
  assert.equal(image.allowedTypes.includes('model/gltf-binary'), false);
  assert.equal(model.allowedTypes.some(type => type.startsWith('image/')), false);
  assert.match(requests[0], /allowed_types=image%2Fjpeg/);
  assert.match(requests[1], /allowed_types=model%2Fgltf-binary/);
  image.select({ public_id: 'image-1', title: 'Image' });
  image.applySelection();
  assert.equal(imageSelector.nodes.input.value, 'media://image-1');
  assert.equal(modelSelector.nodes.input.value, '');
  model.clear();
  assert.equal(imageSelector.nodes.input.value, 'media://image-1');
});

test('upload tab does not reload; direct upload updates only its originating selector', async () => {
  const first = createSelector();
  const second = createSelector({ fieldName: 'secondary_image' });
  let libraryRequests = 0;
  let uploadRequests = 0;
  const runtime = createRuntime([first, second], async (url) => {
    if (url.includes('/upload')) {
      uploadRequests += 1;
      return jsonResponse({
        success: true,
        asset: { public_id: 'uploaded-1', title: 'Uploaded', mime_type: 'image/webp' },
      });
    }
    libraryRequests += 1;
    return jsonResponse({ assets: [] });
  });
  const controller = runtime.controller();
  await controller.open({ preventDefault() {}, currentTarget: new Element('ms-select') });
  controller.switchTab('upload');
  controller.switchTab('upload');
  assert.equal(libraryRequests, 1);
  controller.handleFile({ name: 'upload.webp', size: 100 });
  assert.equal(await controller.upload(), true);
  assert.equal(uploadRequests, 1);
  assert.equal(first.nodes.input.value, 'media://uploaded-1');
  assert.equal(second.nodes.input.value, '');
  assert.equal(first.nodes.modal.open, false);
});

test('all action controls rendered by the selector are non-submitting buttons', async () => {
  const selector = createSelector();
  const runtime = createRuntime([selector], async () => jsonResponse({
    assets: [{ public_id: 'asset-1', title: 'Asset' }],
    totalPages: 2,
  }));
  await runtime.controller().open({ preventDefault() {}, currentTarget: new Element('ms-select') });
  assert.equal(selector.nodes.grid.children[0].type, 'button');
  assert.equal(selector.nodes.pagination.children[0].type, 'button');
  runtime.controller().select({ public_id: 'asset-1', title: 'Asset' });
  runtime.controller().applySelection();
  assert.match(selector.nodes.preview.innerHTML, /button type="button"/);
});

test('Navbar and Panels 1-3 each render initialized, independent selector markup', () => {
  const ejs = require('ejs');
  const pages = ['navbar', 'panel1', 'panel2', 'panel3'];
  for (const page of pages) {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', `${page}.ejs`),
      'utf8'
    );
    assert.doesNotThrow(() => ejs.compile(source, { filename: `${page}.ejs` }));
    assert.match(source, /media-selector|components\/media-selector/);
  }
});
