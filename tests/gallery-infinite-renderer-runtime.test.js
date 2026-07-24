const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
let rendererModule;
let matrixModule;

class MockClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class MockStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, value);
  }

  removeProperty(name) {
    this.values.delete(name);
  }
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.classList = new MockClassList();
    this.style = new MockStyle();
    this.textContent = '';
    this.clientWidth = 800;
    this.clientHeight = 600;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  prepend(child) {
    child.parentNode = this;
    this.children.unshift(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  setPointerCapture(pointerId) {
    this.capturedPointer = pointerId;
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointer === pointerId;
  }

  releasePointerCapture(pointerId) {
    if (this.capturedPointer === pointerId) this.capturedPointer = null;
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }

  matches(selector) {
    const attributeMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (!attributeMatch) return false;
    if (!this.attributes.has(attributeMatch[1])) return false;
    return attributeMatch[2] === undefined
      || this.attributes.get(attributeMatch[1]) === attributeMatch[2];
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelector(selector) {
    return this.descendants().find((element) => element.matches(selector)) || null;
  }

  querySelectorAll(selector) {
    return this.descendants().filter((element) => element.matches(selector));
  }
}

function create2dContext() {
  const calls = [];
  return {
    calls,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    beginPath() { calls.push(['beginPath']); },
    arc(...args) { calls.push(['arc', ...args]); },
    fill() { calls.push(['fill']); },
    fillText(...args) { calls.push(['fillText', ...args]); },
    drawImage(...args) { calls.push(['drawImage', ...args]); },
  };
}

function createRecordingGl() {
  let nextHandle = 1;
  const handle = (type) => ({ type, id: nextHandle++ });
  const calls = [];
  const gl = {
    calls,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    MAX_TEXTURE_SIZE: 0x0d33,
    MAX_VERTEX_ATTRIBS: 0x8869,
    CULL_FACE: 0x0b44,
    DEPTH_TEST: 0x0b71,
    BLEND: 0x0be2,
    LEQUAL: 0x0203,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    CLAMP_TO_EDGE: 0x812f,
    LINEAR: 0x2601,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    createShader: () => handle('shader'),
    shaderSource: (...args) => calls.push(['shaderSource', ...args]),
    compileShader: (...args) => calls.push(['compileShader', ...args]),
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader: (...args) => calls.push(['deleteShader', ...args]),
    createProgram: () => handle('program'),
    attachShader: (...args) => calls.push(['attachShader', ...args]),
    linkProgram: (...args) => calls.push(['linkProgram', ...args]),
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram: (...args) => calls.push(['deleteProgram', ...args]),
    getUniformLocation: (_program, name) => ({ name }),
    createVertexArray: () => handle('vao'),
    bindVertexArray: (...args) => calls.push(['bindVertexArray', ...args]),
    deleteVertexArray: (...args) => calls.push(['deleteVertexArray', ...args]),
    createBuffer: () => handle('buffer'),
    bindBuffer: (...args) => calls.push(['bindBuffer', ...args]),
    bufferData: (...args) => calls.push(['bufferData', ...args]),
    bufferSubData: (...args) => calls.push(['bufferSubData', ...args]),
    deleteBuffer: (...args) => calls.push(['deleteBuffer', ...args]),
    enableVertexAttribArray: (...args) => calls.push(['enableVertexAttribArray', ...args]),
    vertexAttribPointer: (...args) => calls.push(['vertexAttribPointer', ...args]),
    vertexAttribDivisor: (...args) => calls.push(['vertexAttribDivisor', ...args]),
    createTexture: () => handle('texture'),
    activeTexture: (...args) => calls.push(['activeTexture', ...args]),
    bindTexture: (...args) => calls.push(['bindTexture', ...args]),
    pixelStorei: (...args) => calls.push(['pixelStorei', ...args]),
    texParameteri: (...args) => calls.push(['texParameteri', ...args]),
    texImage2D: (...args) => calls.push(['texImage2D', ...args]),
    deleteTexture: (...args) => calls.push(['deleteTexture', ...args]),
    getParameter(parameter) {
      if (parameter === gl.MAX_TEXTURE_SIZE) return 4096;
      if (parameter === gl.MAX_VERTEX_ATTRIBS) return 16;
      return 0;
    },
    disable: (...args) => calls.push(['disable', ...args]),
    enable: (...args) => calls.push(['enable', ...args]),
    depthFunc: (...args) => calls.push(['depthFunc', ...args]),
    blendFunc: (...args) => calls.push(['blendFunc', ...args]),
    viewport: (...args) => calls.push(['viewport', ...args]),
    clearColor: (...args) => calls.push(['clearColor', ...args]),
    clear: (...args) => calls.push(['clear', ...args]),
    useProgram: (...args) => calls.push(['useProgram', ...args]),
    uniformMatrix4fv: (...args) => calls.push(['uniformMatrix4fv', ...args]),
    uniform1i: (...args) => calls.push(['uniform1i', ...args]),
    drawElementsInstanced: (...args) => calls.push(['drawElementsInstanced', ...args]),
  };
  return gl;
}

class MockCanvas extends MockElement {
  constructor(gl) {
    super('canvas');
    this.gl = gl;
    this.context2d = create2dContext();
    this.width = 0;
    this.height = 0;
  }

  getContext(type) {
    if (type === 'webgl2') return this.gl;
    if (type === '2d') return this.context2d;
    return null;
  }
}

class MockImage {
  static instances = [];
  static settle = 'error';

  constructor() {
    this.width = 256;
    this.height = 256;
    this.naturalWidth = 256;
    this.naturalHeight = 256;
    MockImage.instances.push(this);
  }

  set src(value) {
    this.value = value;
    if (MockImage.settle === 'none') return;
    queueMicrotask(() => {
      if (MockImage.settle === 'load') this.onload?.();
      else this.onerror?.();
    });
  }
}

function setupEnvironment({ imageSettle = 'error' } = {}) {
  const gl = createRecordingGl();
  const rafCallbacks = new Map();
  let nextRaf = 1;
  MockImage.instances = [];
  MockImage.settle = imageSettle;

  global.window = {
    devicePixelRatio: 1.5,
    location: { hostname: 'localhost' },
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(callback) {
      const id = nextRaf++;
      rafCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      rafCallbacks.delete(id);
    },
  };
  global.document = {
    hidden: false,
    createElement(tagName) {
      return tagName === 'canvas' ? new MockCanvas(gl) : new MockElement(tagName);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  global.Image = MockImage;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  global.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
  };

  const container = new MockElement('section');
  const title = new MockElement('h3');
  title.setAttribute('data-gallery-infinite-title', '');
  const meta = new MockElement('p');
  meta.setAttribute('data-gallery-infinite-meta', '');
  container.appendChild(title);
  container.appendChild(meta);

  const flushFrame = (timestamp = 16.67) => {
    const entry = rafCallbacks.entries().next().value;
    if (!entry) return false;
    const [id, callback] = entry;
    rafCallbacks.delete(id);
    callback(timestamp);
    return true;
  };
  return { gl, container, title, meta, rafCallbacks, flushFrame };
}

function items() {
  return [
    {
      id: 1,
      title: 'Primero',
      category: 'Demo',
      type: 'image',
      thumbnail: '/uploads/gallery/thumbnails/first.webp',
    },
    {
      id: 2,
      title: 'Segundo',
      category: 'Demo',
      type: 'video',
      thumbnail: '/uploads/gallery/thumbnails/second.webp',
    },
  ];
}

test.before(async () => {
  rendererModule = await import(
    pathToFileURL(path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs')).href
  );
  matrixModule = await import(
    pathToFileURL(path.join(root, 'public/vendor/gl-matrix/index.js')).href
  );
});

test('disc, sphere, translation, billboard, and camera math is finite and independently verifiable', () => {
  const {
    createDiscGeometry,
    createSpherePoints,
    createTranslationMatrix,
    createBillboardMatrix,
    matrixCenter,
    billboardNormal,
    getBillboardReferenceAxes,
    createCameraMatrices,
  } = rendererModule;
  const geometry = createDiscGeometry();
  assert.equal(geometry.positions.every(Number.isFinite), true);
  assert.equal(geometry.uvs.every(Number.isFinite), true);
  assert.ok(geometry.indices instanceof Uint16Array);
  assert.ok(geometry.indices.length > 0);

  const points = createSpherePoints();
  assert.equal(points.length, 42);
  const radii = points.map((point) => Math.hypot(...point));
  radii.forEach((radius) => assert.ok(Math.abs(radius - 3.5) < 1e-5));
  for (const axis of [0, 1, 2]) {
    assert.ok(new Set(points.map((point) => point[axis].toFixed(3))).size > 10);
  }

  const referencesBefore = getBillboardReferenceAxes();
  for (const point of [points[0], points[17], points[41]]) {
    const translation = createTranslationMatrix(point);
    assert.deepEqual(
      Array.from(matrixCenter(translation)).map((value) => value.toFixed(5)),
      Array.from(point).map((value) => value.toFixed(5))
    );
    const billboard = createBillboardMatrix(point);
    assert.equal(Array.from(billboard).every(Number.isFinite), true);
    assert.deepEqual(
      Array.from(matrixCenter(billboard)).map((value) => value.toFixed(5)),
      Array.from(point).map((value) => value.toFixed(5))
    );
    const toCamera = matrixModule.vec3.normalize(
      matrixModule.vec3.create(),
      matrixModule.vec3.subtract(
        matrixModule.vec3.create(),
        [0, 0, 9],
        point
      )
    );
    assert.ok(matrixModule.vec3.dot(billboardNormal(billboard), toCamera) > 0.9999);
  }
  assert.deepEqual(getBillboardReferenceAxes(), referencesBefore);

  const camera = createCameraMatrices(800, 600);
  assert.equal(camera.view[14], -9);
  assert.ok(Math.hypot(...camera.position) > 3.5);
  const viewProjection = matrixModule.mat4.multiply(
    matrixModule.mat4.create(),
    camera.projection,
    camera.view
  );
  const visibleCenters = points.filter((point) => {
    const clip = matrixModule.vec4.transformMat4(
      matrixModule.vec4.create(),
      [point[0], point[1], point[2], 1],
      viewProjection
    );
    return clip[3] > 0
      && Math.abs(clip[0]) <= clip[3]
      && Math.abs(clip[1]) <= clip[3]
      && Math.abs(clip[2]) <= clip[3];
  });
  assert.ok(visibleCenters.length > 0);
});

test('recording WebGL 2 path binds a VAO/EBO and draws nonzero indexed instances', async () => {
  const env = setupEnvironment();
  const renderer = new rendererModule.InfiniteMenuRenderer(env.container, items());
  await renderer.ready;

  const viewport = env.gl.calls.find((call) => call[0] === 'viewport');
  assert.ok(viewport[3] > 0 && viewport[4] > 0);
  assert.ok(env.gl.calls.some((call) => call[0] === 'bindVertexArray' && call[1]));
  assert.ok(env.gl.calls.some(
    (call) => call[0] === 'bindBuffer' && call[1] === env.gl.ELEMENT_ARRAY_BUFFER
  ));
  const draw = env.gl.calls.filter((call) => call[0] === 'drawElementsInstanced').at(-1);
  assert.equal(draw[1], env.gl.TRIANGLES);
  assert.ok(draw[2] > 0);
  assert.equal(draw[3], env.gl.UNSIGNED_SHORT);
  assert.ok(draw[5] > 0);
  assert.equal(env.container.querySelectorAll(
    '[data-gallery-renderer-generated="infinite"]'
  ).length, 1);

  const upload = env.gl.calls.find((call) => call[0] === 'texImage2D');
  assert.ok(upload);
  assert.ok(env.gl.calls.some(
    (call) => call[0] === 'activeTexture' && call[1] === env.gl.TEXTURE0
  ));
  assert.ok(env.gl.calls.some(
    (call) => call[0] === 'uniform1i' && call[1]?.name === 'uAtlas' && call[2] === 0
  ));
  assert.ok(renderer.atlasContext.calls.some((call) => call[0] === 'fillRect'));
  assert.equal(env.title.textContent.length > 0, true);
  renderer.destroy();
});

test('diagnostic milestones use one disc, translated sphere, billboards, then final textures', async () => {
  for (const stage of ['disc', 'sphere', 'billboard', '']) {
    const env = setupEnvironment();
    const renderer = new rendererModule.InfiniteMenuRenderer(
      env.container,
      items(),
      { diagnosticStage: stage }
    );
    await renderer.ready;
    const draw = env.gl.calls.filter((call) => call[0] === 'drawElementsInstanced').at(-1);
    assert.equal(draw[5], stage === 'disc' ? 1 : 42);
    const diagnostic = env.gl.calls
      .filter((call) => call[0] === 'uniform1i' && call[1]?.name === 'uDiagnostic')
      .at(-1);
    assert.equal(diagnostic[2], stage ? 1 : 0);
    if (stage === 'disc') {
      assert.deepEqual(Array.from(renderer.instanceData.slice(12, 15)), [0, 0, 0]);
    }
    if (stage === 'sphere') {
      assert.deepEqual(
        Array.from(renderer.instanceData.slice(12, 15)).map((value) => value.toFixed(5)),
        Array.from(renderer.spherePoints[0]).map((value) => value.toFixed(5))
      );
    }
    if (stage === 'billboard' || stage === '') {
      const normal = rendererModule.billboardNormal(renderer.instanceData.slice(0, 16));
      const point = renderer.spherePoints[0];
      const toCamera = matrixModule.vec3.normalize(
        matrixModule.vec3.create(),
        matrixModule.vec3.subtract(matrixModule.vec3.create(), [0, 0, 9], point)
      );
      assert.ok(matrixModule.vec3.dot(normal, toCamera) > 0.999);
    }
    renderer.destroy();
  }
});

test('arcball changes both axes, stays normalized, schedules rendering, and inertia decays', async () => {
  const { rotateOrientation, decayAngularVelocity } = rendererModule;
  const horizontal = matrixModule.quat.create();
  rotateOrientation(horizontal, 30, 0);
  assert.notEqual(horizontal[1], 0);
  const vertical = matrixModule.quat.create();
  rotateOrientation(vertical, 0, 30);
  assert.notEqual(vertical[0], 0);
  const diagonal = matrixModule.quat.create();
  rotateOrientation(diagonal, 30, 30);
  assert.notEqual(diagonal[0], 0);
  assert.notEqual(diagonal[1], 0);
  assert.ok(Math.abs(matrixModule.quat.length(diagonal) - 1) < 1e-6);

  const velocity = matrixModule.vec3.fromValues(1, 1, 0);
  const before = matrixModule.vec3.length(velocity);
  decayAngularVelocity(velocity, 16.67);
  assert.ok(matrixModule.vec3.length(velocity) < before);

  const env = setupEnvironment();
  const renderer = new rendererModule.InfiniteMenuRenderer(env.container, items());
  await renderer.ready;
  const original = Array.from(renderer.orientation);
  renderer.onPointerDown({
    button: 0,
    isPrimary: true,
    pointerId: 9,
    clientX: 100,
    clientY: 100,
    timeStamp: 10,
    preventDefault() {},
  });
  renderer.onPointerMove({
    pointerId: 9,
    clientX: 140,
    clientY: 125,
    timeStamp: 30,
    preventDefault() {},
  });
  assert.notDeepEqual(Array.from(renderer.orientation), original);
  assert.ok(Math.abs(matrixModule.quat.length(renderer.orientation) - 1) < 1e-5);
  assert.notEqual(renderer.rafId, null);
  const speedBefore = matrixModule.vec3.length(renderer.angularVelocity);
  renderer.onPointerUp({
    pointerId: 9,
    type: 'pointerup',
  });
  renderer.applyInertia(16.67);
  assert.ok(matrixModule.vec3.length(renderer.angularVelocity) < speedBefore);
  renderer.destroy();
});

test('atlas layout and UV bounds are finite for first/final cells', () => {
  const layout = rendererModule.createAtlasLayout(24, 4096);
  assert.ok(layout.width > 0 && layout.height > 0);
  assert.ok(layout.width <= 4096 && layout.height <= 4096);
  for (const index of [0, 23]) {
    const uv = rendererModule.atlasCellUv(index, layout);
    for (const value of Object.values(uv)) {
      assert.ok(value >= 0 && value <= 1);
    }
    assert.ok(uv.minU < uv.maxU);
    assert.ok(uv.minV < uv.maxV);
  }
});

test('destroy is safe before ready, twice, and prevents late image upload', async () => {
  const env = setupEnvironment({ imageSettle: 'none' });
  const renderer = new rendererModule.InfiniteMenuRenderer(env.container, items());
  const pendingImages = [...MockImage.instances];
  renderer.destroy();
  assert.doesNotThrow(() => renderer.destroy());
  pendingImages.forEach((image) => image.onload?.());
  await renderer.ready;
  assert.equal(env.gl.calls.some((call) => call[0] === 'texImage2D'), false);
  assert.equal(env.container.querySelectorAll(
    '[data-gallery-renderer-generated="infinite"]'
  ).length, 0);

  const second = new rendererModule.InfiniteMenuRenderer(env.container, items());
  MockImage.instances.forEach((image) => image.onerror?.());
  await second.ready;
  assert.equal(env.container.querySelectorAll(
    '[data-gallery-renderer-generated="infinite"]'
  ).length, 1);
  second.destroy();
});
