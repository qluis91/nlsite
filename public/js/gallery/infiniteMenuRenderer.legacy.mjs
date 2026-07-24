/**
 * Gallery Phase 4 — Infinite Menu Renderer
 *
 * Adapted from InfiniteMenu reference implementation.
 * Vanilla WebGL 2 + gl-matrix. No framework dependency.
 */
// Preserved during the clean renderer replacement for root-cause comparison.
import { mat4, quat, vec2, vec3 } from '/vendor/gl-matrix/index.js';

// ── Constants ──
const MAX_DPR = 2;
const MAX_DT_MS = 50;
const MAX_TEXTURE_SIZE = typeof navigator !== 'undefined' ? 8192 : 4096;
const DISC_SEGMENTS = 56;
const ICOSA_SUBDIVISIONS = 1;
const SPHERE_RADIUS = 3.8;
const INERTIA_DAMPING = 0.94;
const SNAP_SPEED = 0.08;
const SNAP_THRESHOLD = 0.004;
const VELOCITY_CLAMP = 4;

// ── Vertex Shader ──
const VERTEX_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aTexCoord;

layout(location = 3) in mat4 aInstanceMatrix;

uniform mat4 uViewProjection;
uniform float uTime;
uniform float uVelocity;

out vec2 vTexCoord;
out float vDepth;
out float vAlpha;
flat out int vInstanceId;

void main() {
  vec4 worldPos = aInstanceMatrix * vec4(aPosition, 1.0);
  gl_Position = uViewProjection * worldPos;

  // Depth-based alpha for atmospheric effect
  vDepth = gl_Position.z / gl_Position.w;
  vAlpha = 1.0 - smoothstep(2.5, 6.0, vDepth);

  vTexCoord = aTexCoord;
  vInstanceId = gl_InstanceID;
}
`;

// ── Fragment Shader ──
const FRAGMENT_SRC = `#version 300 es
precision highp float;

in vec2 vTexCoord;
in float vAlpha;
flat in int vInstanceId;

uniform sampler2D uAtlas;
uniform float uAtlasGridSize;
uniform float uItemCount;
uniform float uVelocity;
uniform float uTime;
uniform int uDebug;

out vec4 fragColor;

void main() {
  // ── Development diagnostic: solid magenta override ──
  if (uDebug == 1) { fragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }

  // Each instance is one atlas cell
  int instanceId = vInstanceId;
  int itemIndex = instanceId % int(uItemCount);

  float cellU = float(itemIndex % int(uAtlasGridSize)) / uAtlasGridSize;
  float cellV = float(itemIndex / int(uAtlasGridSize)) / uAtlasGridSize;
  float cellSize = 1.0 / uAtlasGridSize;

  // Sample atlas with coverage
  vec2 atlasUV = vec2(cellU, cellV) + vTexCoord * cellSize;
  vec4 texColor = texture(uAtlas, atlasUV);

  // Disc masking via UV distance — generous cutoff for visible thumbnails
  float discDist = length(vTexCoord - vec2(0.5));
  float discAlpha = 1.0 - smoothstep(0.40, 0.50, discDist);

  // Velocity-based stretching glow
  float stretch = 1.0 + abs(uVelocity) * 0.5;
  float glow = exp(-discDist * stretch * 12.0) * abs(uVelocity) * 0.35;

  float alpha = texColor.a * discAlpha * vAlpha;
  vec3 color = mix(texColor.rgb, vec3(0.49, 0.94, 0.24), glow);

  fragColor = vec4(color, alpha);
}
`;

// ── Geometry helpers ──
function createIcosahedronVertices() {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  return raw.map((v) => vec3.fromValues(v[0], v[1], v[2]));
}

function createIcosahedronFaces() {
  return [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
}

function subdivideVertices(vertices, faces) {
  const map = new Map();
  const midKey = (a, b) => Math.min(a, b) + '_' + Math.max(a, b);

  for (const face of faces) {
    for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3];
      const key = midKey(a, b);
      if (!map.has(key)) {
        const mid = vec3.create();
        vec3.add(mid, vertices[a], vertices[b]);
        vec3.scale(mid, mid, 0.5);
        map.set(key, vertices.length);
        vertices.push(mid);
      }
    }
  }
  return vertices;
}

function projectToSphere(vertices, radius) {
  for (const v of vertices) {
    vec3.normalize(v, v);
    vec3.scale(v, v, radius);
  }
}

function createDiscGeometry(segments) {
  const positions = [];
  const uvs = [];
  const indices = [];

  // Center vertex at (0,0,0)
  positions.push(0, 0, 0);
  uvs.push(0.5, 0.5);

  // Outer ring
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * 0.5 + 0.5;
    const y = Math.sin(angle) * 0.5 + 0.5;
    positions.push(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0);
    uvs.push(x, y);
  }

  // Triangle fan
  for (let i = 0; i < segments; i++) {
    indices.push(0, i + 1, i + 2);
  }

  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

// ── Shader helpers ──
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const typeLabel = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`Shader compilation failed (${typeLabel}): ${log}`);
  }
  return shader;
}

function createProgram(gl, vertSrc, fragSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error('Program linking failed');
  }
  return program;
}

// ── Arcball control ──
class ArcballControl {
  constructor(canvas, radius = 2.5) {
    this.canvas = canvas;
    this.radius = radius;
    this.orientation = quat.create();
    this.snapTarget = null;
    this.snapVelocity = vec2.create();
    this.angularVelocity = vec3.create();
    this.active = false;
    this.pointerId = null;
    this.prevPos = vec2.create();
    this.gestureVel = vec2.create();
    this.lastTime = performance.now();
  }

  project(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((x - rect.left) / rect.width) * 2 - 1;
    const py = -((y - rect.top) / rect.height) * 2 + 1;
    const len = px * px + py * py;
    const r2 = this.radius * this.radius;

    if (len <= r2 * 0.5) {
      // Inside sphere - project onto sphere surface
      const z = Math.sqrt(r2 - len);
      return vec3.fromValues(px, py, z);
    } else {
      // Outside sphere - project onto hyperbolic sheet
      const z = r2 * 0.5 / Math.sqrt(len);
      const s = 1 / Math.sqrt(len + z * z);
      return vec3.fromValues(px * s, py * s, z * s);
    }
  }

  start(x, y, pointerId) {
    this.active = true;
    this.pointerId = pointerId;
    vec2.set(this.prevPos, x, y);
    vec2.set(this.gestureVel, 0, 0);
    this.snapTarget = null;
    vec3.set(this.angularVelocity, 0, 0, 0);
  }

  move(x, y) {
    if (!this.active) return;
    vec2.set(this.gestureVel, x - this.prevPos[0], y - this.prevPos[1]);
    vec2.set(this.prevPos, x, y);

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT_MS / 1000);
    this.lastTime = now;

    const p0 = this.project(x - this.gestureVel[0], y - this.gestureVel[1]);
    const p1 = this.project(x, y);

    const axis = vec3.create();
    vec3.cross(axis, p0, p1);
    const axisLen = vec3.length(axis);
    if (axisLen < 1e-8) return;

    vec3.scale(axis, axis, 1 / axisLen);
    const dot = Math.max(-1, Math.min(1, vec3.dot(p0, p1) / (vec3.length(p0) * vec3.length(p1))));
    const angle = Math.acos(dot);

    if (!Number.isFinite(angle)) return;

    const dq = quat.create();
    quat.setAxisAngle(dq, axis, angle * (1 / dt));
    quat.multiply(this.orientation, dq, this.orientation);
    quat.normalize(this.orientation, this.orientation);

    vec3.copy(this.angularVelocity, axis);
    vec3.scale(this.angularVelocity, this.angularVelocity, angle * (1 / dt));
  }

  end() {
    this.active = false;
    this.pointerId = null;
    this.lastTime = performance.now();
  }

  applyDamping() {
    if (this.active) return;
    const len = vec3.length(this.angularVelocity);
    if (len < 0.0001) {
      vec3.set(this.angularVelocity, 0, 0, 0);
      return;
    }
    vec3.scale(this.angularVelocity, this.angularVelocity, INERTIA_DAMPING);
    const dq = quat.create();
    quat.setAxisAngle(dq, vec3.normalize(vec3.create(), this.angularVelocity), len);
    quat.multiply(this.orientation, dq, this.orientation);
    quat.normalize(this.orientation, this.orientation);
  }
}

// ── Main renderer ──
export class InfiniteMenuRenderer {
  constructor(container, items, options = {}) {
    this.container = container;
    this.items = items.slice(0, 24);
    this.options = options;
    this.destroyed = false;
    this.rafId = null;
    this.isIntersecting = true;
    this._paused = false;
    this._lastActiveIndex = -1;
    this._debug = 0; // Legacy reference only; diagnostic output is disabled.
    this.ready = this._init();
  }

  async _init() {
    await this._setupWebGL();
    if (this.destroyed) return;
    this._createGeometry();
    this._createAtlas();
    await this._loadAtlasTextures();
    if (this.destroyed) return;
    this._setupControls();
    this._setupLifecycle();
    this._startLoop();
    this.container.classList.add('is-ready');

    if (this.items.length > 0) {
      this._updateActiveItem(0);
    }
  }

  async _setupWebGL() {
    const canvas = this.container.querySelector('[data-gallery-infinite-canvas]');
    this.canvas = canvas || document.createElement('canvas');
    this.canvas.setAttribute('data-gallery-renderer-generated', 'infinite');
    if (!canvas) this.container.prepend(this.canvas);

    const context = this.canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    });

    if (!context) throw new Error('WebGL 2 not available');
    this.gl = context;

    this.maxTexSize = context.getParameter(context.MAX_TEXTURE_SIZE);
    const maxAttribs = context.getParameter(context.MAX_VERTEX_ATTRIBS);
    if (maxAttribs < 8) throw new Error('Insufficient vertex attributes for instanced mat4');
    if (this.maxTexSize < 1024) throw new Error('Insufficient texture capability');

    const gl = context;
    try {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      this.program = createProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
      gl.useProgram(this.program);

      this.uViewProjection = gl.getUniformLocation(this.program, 'uViewProjection');
      this.uTime = gl.getUniformLocation(this.program, 'uTime');
      this.uVelocity = gl.getUniformLocation(this.program, 'uVelocity');
      this.uAtlas = gl.getUniformLocation(this.program, 'uAtlas');
      this.uAtlasGridSize = gl.getUniformLocation(this.program, 'uAtlasGridSize');
      this.uItemCount = gl.getUniformLocation(this.program, 'uItemCount');
      this.uDebug = gl.getUniformLocation(this.program, 'uDebug');
    } catch (err) {
      this._deleteGLResources();
      throw err;
    }
  }

  _deleteGLResources() {
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
    if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
    if (this.uvBuffer) gl.deleteBuffer(this.uvBuffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    if (this.texture) gl.deleteTexture(this.texture);
    this.program = null;
    this.vao = null;
  }

  _createGeometry() {
    const gl = this.gl;

    // Icosahedron sphere
    let vertices = createIcosahedronVertices();
    const faces = createIcosahedronFaces();
    for (let s = 0; s < ICOSA_SUBDIVISIONS; s++) {
      vertices = subdivideVertices(vertices, faces);
    }
    projectToSphere(vertices, SPHERE_RADIUS);

    this.sphereVertices = vertices;
    this.instanceCount = vertices.length;

    // Disc geometry
    const disc = createDiscGeometry(DISC_SEGMENTS);

    // Buffers
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // Position
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, disc.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // UV
    this.uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, disc.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    // Index
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, disc.indices, gl.STATIC_DRAW);
    this.indexCount = disc.indices.length;

    // Instance matrix buffer (4 vec4 attributes per instance)
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const instanceData = new Float32Array(this.instanceCount * 16);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);

    const bytesPerMat = 16 * 4;
    for (let i = 0; i < 4; i++) {
      const loc = 3 + i;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, bytesPerMat, i * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
  }

  _createAtlas() {
    const itemCount = this.items.length;
    if (itemCount === 0) return;

    const gridSize = Math.ceil(Math.sqrt(itemCount));
    this.atlasGridSize = gridSize;

    // Responsive cell size
    let cellSize = 256;
    const totalSize = gridSize * cellSize;
    if (totalSize > this.maxTexSize) {
      cellSize = Math.floor(this.maxTexSize / gridSize);
    }
    this.atlasCellSize = cellSize;
    this.atlasSize = gridSize * cellSize;

    this.atlasCanvas = document.createElement('canvas');
    this.atlasCanvas.width = this.atlasSize;
    this.atlasCanvas.height = this.atlasSize;
    this.atlasCtx = this.atlasCanvas.getContext('2d');
  }

  async _loadAtlasTextures() {
    const itemCount = this.items.length;
    if (itemCount === 0) return;

    const promises = this.items.map((item, index) =>
      this._drawCell(item.thumbnail, index).catch(() => this._drawPlaceholder(item, index))
    );

    // Timeout safeguard — tracked so destroy() can cancel it
    const timeout = new Promise((resolve) => {
      this._atlasTimeoutId = window.setTimeout(() => resolve(), 15000);
    });
    await Promise.race([Promise.all(promises), timeout]);
    window.clearTimeout(this._atlasTimeoutId);
    this._atlasTimeoutId = null;

    if (this.destroyed) return;
    this._uploadAtlasTexture();
  }

  _drawCell(src, index) {
    return new Promise((resolve) => {
      // Validate same-origin path
      if (!src || typeof src !== 'string' || !/^\/uploads\//.test(src)) {
        resolve();
        return;
      }
      const img = new Image();
      const col = index % this.atlasGridSize;
      const row = Math.floor(index / this.atlasGridSize);
      const x = col * this.atlasCellSize;
      const y = row * this.atlasCellSize;
      const size = this.atlasCellSize;

      img.onload = () => {
        if (this.destroyed) { resolve(); return; }
        // Aspect-ratio cover
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        if (!iw || !ih) { resolve(); return; }

        const scale = Math.max(size / iw, size / ih);
        const sw = iw * scale;
        const sh = ih * scale;
        const sx = (size - sw) / 2;
        const sy = (size - sh) / 2;

        this.atlasCtx.drawImage(img, sx, sy, sw, sh);
        resolve();
      };

      img.onerror = () => {
        if (this.destroyed) { resolve(); return; }
        this._drawPlaceholder(null, index).then(resolve);
      };

      img.src = src;
    });
  }

  async _drawPlaceholder(item, index) {
    const col = index % this.atlasGridSize;
    const row = Math.floor(index / this.atlasGridSize);
    const x = col * this.atlasCellSize;
    const y = row * this.atlasCellSize;
    const size = this.atlasCellSize;

    // Draw branded placeholder
    const ctx = this.atlasCtx;
    ctx.fillStyle = '#151a1c';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#3a4040';
    ctx.font = `${Math.floor(size * 0.08)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const title = item?.title || 'Proyecto';
    const lines = title.length > 15 ? [title.slice(0, 15) + '…'] : [title];
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x + size / 2, y + size / 2 + i * size * 0.1);
    }
  }

  _uploadAtlasTexture() {
    const gl = this.gl;
    this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.atlasSize, this.atlasSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.atlasCanvas);

    const isPowerOfTwo = (this.atlasSize & (this.atlasSize - 1)) === 0;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, isPowerOfTwo ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (isPowerOfTwo) gl.generateMipmap(gl.TEXTURE_2D);

    // Free canvas reference
    this.atlasCanvas = null;
  }

  _setupControls() {
    const canvas = this.canvas;
    this.arcball = new ArcballControl(canvas);

    // Pointer events
    this._onPointerDown = (e) => {
      if (!e.isPrimary) return;
      e.preventDefault();
      this.arcball.start(e.clientX, e.clientY, e.pointerId);
      canvas.setPointerCapture(e.pointerId);
      this.container.classList.add('is-dragging');
      this._schedule();
    };

    this._onPointerMove = (e) => {
      if (!this.arcball.active || e.pointerId !== this.arcball.pointerId) return;
      e.preventDefault();
      this.arcball.move(e.clientX, e.clientY);
      this._updateActiveFromOrientation();
    };

    this._onPointerUp = (e) => {
      if (e.pointerId !== this.arcball.pointerId) return;
      this.arcball.end();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      this.container.classList.remove('is-dragging');
      this._findSnapTarget();
      this._schedule();
    };

    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointercancel', this._onPointerUp);
    canvas.addEventListener('lostpointercapture', this._onPointerUp);

    // Keyboard — rotate sphere by controlled angles
    this._onKeyDown = (e) => {
      if (document.activeElement !== this.container) return;
      const itemCount = this.items.length;
      if (!itemCount) return;

      const angleStep = 0.35; // radians
      const dq = quat.create();

      switch (e.key) {
        case 'ArrowLeft': {
          e.preventDefault();
          quat.setAxisAngle(dq, vec3.fromValues(0, 1, 0), angleStep);
          quat.multiply(this.arcball.orientation, dq, this.arcball.orientation);
          quat.normalize(this.arcball.orientation, this.arcball.orientation);
          this._findSnapTarget();
          this._schedule();
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          quat.setAxisAngle(dq, vec3.fromValues(0, 1, 0), -angleStep);
          quat.multiply(this.arcball.orientation, dq, this.arcball.orientation);
          quat.normalize(this.arcball.orientation, this.arcball.orientation);
          this._findSnapTarget();
          this._schedule();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          quat.setAxisAngle(dq, vec3.fromValues(1, 0, 0), angleStep);
          quat.multiply(this.arcball.orientation, dq, this.arcball.orientation);
          quat.normalize(this.arcball.orientation, this.arcball.orientation);
          this._findSnapTarget();
          this._schedule();
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          quat.setAxisAngle(dq, vec3.fromValues(1, 0, 0), -angleStep);
          quat.multiply(this.arcball.orientation, dq, this.arcball.orientation);
          quat.normalize(this.arcball.orientation, this.arcball.orientation);
          this._findSnapTarget();
          this._schedule();
          break;
        }
        case 'Home': {
          e.preventDefault();
          // Snap nearest vertex fully to front
          vec3.set(this.arcball.angularVelocity, 0, 0, 0);
          this.arcball.snapTarget = null;
          const vi = this._closestVertexIndex();
          this._setActiveByItemIndex(vi % itemCount);
          this._schedule();
          break;
        }
        case 'End': {
          e.preventDefault();
          // Rotate 180 degrees around Y
          vec3.set(this.arcball.angularVelocity, 0, 0, 0);
          quat.setAxisAngle(dq, vec3.fromValues(0, 1, 0), Math.PI);
          quat.multiply(this.arcball.orientation, dq, this.arcball.orientation);
          quat.normalize(this.arcball.orientation, this.arcball.orientation);
          this._findSnapTarget();
          this._schedule();
          break;
        }
        case 'Enter':
        case ' ': {
          e.preventDefault();
          this._openActive();
          break;
        }
        default: return;
      }
    };

    this.container.addEventListener('keydown', this._onKeyDown);

    // Wheel — rotate sphere around Y axis
    this._onWheel = (e) => {
      if (document.activeElement !== this.container) return;
      e.preventDefault();
      const delta = e.deltaX || e.deltaY;
      const dq = quat.create();
      quat.setAxisAngle(dq, vec3.fromValues(0, 1, 0), Math.sign(delta) * 0.4);
      quat.multiply(this.arcball.orientation, dq, this.arcball.orientation);
      quat.normalize(this.arcball.orientation, this.arcball.orientation);
      this._findSnapTarget();
      this._schedule();
    };
    this.container.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _setupLifecycle() {
    // Resize observer
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.container);

    // Intersection observer
    this._intersectionObserver = new IntersectionObserver(
      (entries) => {
        this.isIntersecting = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.1 }
    );
    this._intersectionObserver.observe(this.container);

    // Visibility
    this._onVisibility = () => {
      if (document.hidden) {
        this._paused = true;
      } else {
        this._paused = false;
        this.arcball.lastTime = performance.now();
        this._schedule();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibility);

    // Context loss
    this._onContextLost = (e) => {
      e.preventDefault();
      this._paused = true;
      this.options.onContextLost?.();
    };
    this._onContextRestored = () => {
      // Do not auto-reinitialize; user must switch back manually
    };
    this.canvas.addEventListener('webglcontextlost', this._onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored);

    this._resize();
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);

    // Guard against ResizeObserver feedback loops
    if (w === this._lastWidth && h === this._lastHeight) return;
    this._lastWidth = w;
    this._lastHeight = h;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Update projection
    const aspect = w / h;
    this.projMatrix = mat4.perspective(
      mat4.create(),
      Math.PI / 3,
      aspect,
      0.1,
      50
    );

    // Responsive scale
    this._sphereScale = Math.min(1, Math.min(w, h) / 600);
  }

  // ── Active item helpers ──
  _frontDirection() {
    // Front direction in world space
    const front = vec3.fromValues(0, 0, -1);
    const qc = quat.create();
    quat.conjugate(qc, this.arcball.orientation);
    vec3.transformQuat(front, front, qc);
    return front;
  }

  _closestVertexIndex() {
    const front = this._frontDirection();
    let closest = 0;
    let maxDot = -Infinity;
    for (let i = 0; i < this.sphereVertices.length; i++) {
      const v = this.sphereVertices[i];
      const dot = vec3.dot(front, v);
      if (dot > maxDot) {
        maxDot = dot;
        closest = i;
      }
    }
    return closest;
  }

  _activeItemIndex() {
    if (!this.items.length || !this.sphereVertices?.length) return 0;
    const vi = this._closestVertexIndex();
    return vi % this.items.length;
  }

  _updateActiveFromOrientation() {
    const idx = this._activeItemIndex();
    if (idx !== this._lastActiveIndex) {
      this._lastActiveIndex = idx;
      this._updateActiveItem(idx);
    }
  }

  _updateActiveItem(index) {
    const item = this.items[index];
    if (!item) return;
    this._lastActiveIndex = index;

    const metaEl = this.container.querySelector('[data-gallery-infinite-meta]');
    const titleEl = this.container.querySelector('[data-gallery-infinite-title]');
    const typeStr = item.type === 'video' ? 'Video' : 'Imagen';
    const details = [item.category, typeStr].filter(Boolean);

    if (metaEl) metaEl.textContent = details.join(' · ');
    if (titleEl) titleEl.textContent = item.title || 'Proyecto';

    // Live region announcement
    const live = this.container.querySelector('[data-gallery-infinite-live]');
    if (live) {
      window.clearTimeout(this._liveTimer);
      this._liveTimer = window.setTimeout(() => {
        live.textContent = `${item.title || 'Proyecto'}, elemento ${index + 1} de ${this.items.length}`;
      }, 240);
    }

    this.options.onActiveChange?.(item, index, this.items.length);
  }

  _findSnapTarget() {
    const vi = this._closestVertexIndex();
    const targetV = this.sphereVertices[vi];
    const targetDir = vec3.normalize(vec3.create(), targetV);

    // Compute quaternion to rotate front (-Z) to target direction
    const front = vec3.fromValues(0, 0, -1);
    const axis = vec3.create();
    vec3.cross(axis, front, targetDir);
    const axisLen = vec3.length(axis);
    if (axisLen < 1e-8) { this.arcball.snapTarget = null; return; }

    vec3.scale(axis, axis, 1 / axisLen);
    const dot = Math.max(-1, Math.min(1, vec3.dot(front, targetDir)));
    const angle = Math.acos(dot);

    this.arcball.snapTarget = quat.create();
    quat.setAxisAngle(this.arcball.snapTarget, axis, angle);
  }

  _setActiveByItemIndex(index) {
    const vi = index % this.sphereVertices.length;
    const targetV = this.sphereVertices[vi];
    const targetDir = vec3.normalize(vec3.create(), targetV);
    const front = vec3.fromValues(0, 0, -1);
    const axis = vec3.create();
    vec3.cross(axis, front, targetDir);
    const axisLen = vec3.length(axis);
    if (axisLen < 1e-8) return;
    vec3.scale(axis, axis, 1 / axisLen);
    const dot = Math.max(-1, Math.min(1, vec3.dot(front, targetDir)));
    const angle = Math.acos(dot);

    this.arcball.snapTarget = quat.create();
    quat.setAxisAngle(this.arcball.snapTarget, axis, angle);
    this.arcball.angularVelocity = vec3.create();
    this._updateActiveItem(index);
  }

  _openActive() {
    const idx = this._activeItemIndex();
    const item = this.items[idx];
    if (!item) return;
    this.options.onSelect?.(item);
  }

  // ── Render loop ──
  _schedule() {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame((t) => this._frame(t));
  }

  _startLoop() {
    this._schedule();
  }

  _frame(now) {
    this.rafId = null;
    if (this.destroyed || this._paused) return;

    const dt = this._deltaTime(now);

    // Skip frame when scrolled out of view, but keep scheduling — don't deadlock
    if (!this.isIntersecting) {
      this._schedule();
      return;
    }

    // Apply damping / snap
    this.arcball.applyDamping();

    if (this.arcball.snapTarget) {
      this._applySnap(dt);
    }

    // Detect velocity for shader effects
    const moving = this.arcball.active || vec3.length(this.arcball.angularVelocity) > 0.001;
    this.container.classList.toggle('is-moving', moving);

    this._render(now);

    // Check if done
    const stillMoving = this.arcball.active || vec3.length(this.arcball.angularVelocity) > 0.0005 || this.arcball.snapTarget;
    if (stillMoving) {
      this._schedule();
    } else {
      this._updateActiveFromOrientation();
    }
  }

  _deltaTime(now) {
    if (!this._lastFrameTime) this._lastFrameTime = now;
    const dt = Math.min(now - this._lastFrameTime, MAX_DT_MS) / 1000;
    this._lastFrameTime = now;
    return dt;
  }

  _applySnap(dt) {
    const current = this.arcball.orientation;
    const target = this.arcball.snapTarget;
    const result = quat.create();

    quat.slerp(result, current, target, Math.min(SNAP_SPEED, 1));
    quat.copy(this.arcball.orientation, result);

    const diff = quat.create();
    quat.conjugate(diff, current);
    quat.multiply(diff, target, diff);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(diff[3])));

    if (angle < SNAP_THRESHOLD) {
      quat.copy(this.arcball.orientation, target);
      this.arcball.snapTarget = null;
    }
  }

  _render(now) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ── Stage A diagnostic: force solid rendering ──
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // Camera zoom during fast movement
    const baseCamZ = 9;
    const velMag = vec3.length(this.arcball.angularVelocity);
    const camZ = this.arcball.active ? baseCamZ + Math.min(velMag * 0.3, 3) : baseCamZ;

    // Update instance matrices — rotate each sphere vertex by arcball orientation
    const instanceData = new Float32Array(this.instanceCount * 16);
    const orientation = this.arcball.orientation;
    const scale = this._sphereScale || 1;

    // Reusable temps
    const rotatedV = vec3.create();
    const camPos = vec3.fromValues(0, 0, camZ);
    const worldUp = vec3.fromValues(0, 1, 0);

    for (let i = 0; i < this.instanceCount; i++) {
      const baseV = this.sphereVertices[i];

      // Apply arcball orientation to rotate the sphere
      vec3.transformQuat(rotatedV, baseV, orientation);

      const m = mat4.create();

      // Disc scale — discs at front appear larger, discs at back smaller
      const zNdc = rotatedV[2] / SPHERE_RADIUS; // approx -1 (back) to +1 (front)
      const depthBoost = 0.65 + 0.35 * ((zNdc + 1) / 2); // 0.65 (back) to 1.0 (front)
      const discScale = 0.85 * scale * depthBoost;
      mat4.fromScaling(m, vec3.fromValues(discScale, discScale, discScale));

      // Billboard: face disc toward camera
      const toCam = vec3.sub(vec3.create(), camPos, rotatedV);
      vec3.normalize(toCam, toCam);

      // Build rotation matrix where disc Z-axis points toward camera
      let right = vec3.create();
      vec3.cross(right, worldUp, toCam);
      const rightLen = vec3.length(right);
      if (rightLen < 1e-8) {
        // Pole: normal is parallel to worldUp → use X axis as right instead
        const altUp = vec3.fromValues(1, 0, 0);
        vec3.cross(right, altUp, toCam);
      }
      vec3.normalize(right, right);
      const up = vec3.create();
      vec3.cross(up, toCam, right); // up = toCam × right (orthonormal)

      const rotMat = mat4.create();
      rotMat[0] = right[0];  rotMat[1] = right[1];  rotMat[2] = right[2];
      rotMat[4] = up[0];     rotMat[5] = up[1];     rotMat[6] = up[2];
      rotMat[8] = toCam[0];  rotMat[9] = toCam[1];   rotMat[10] = toCam[2];
      rotMat[15] = 1;

      mat4.multiply(m, rotMat, m); // rotMat · scaleMat

      // Translate to rotated sphere position
      const tMat = mat4.create();
      mat4.fromTranslation(tMat, rotatedV);
      mat4.multiply(m, tMat, m); // translation · rotation · scale

      const offset = i * 16;
      for (let row = 0; row < 16; row++) {
        instanceData[offset + row] = m[row];
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData);

    // Fixed camera — looking at origin (sphere center)
    const viewMat = mat4.create();
    mat4.targetTo(viewMat, camPos, vec3.fromValues(0, 0, 0), worldUp);

    // View-projection
    const vp = mat4.create();
    mat4.multiply(vp, this.projMatrix, viewMat);

    gl.uniformMatrix4fv(this.uViewProjection, false, vp);
    gl.uniform1f(this.uTime, now * 0.001);
    gl.uniform1f(this.uVelocity, Math.min(VELOCITY_CLAMP, velMag));
    gl.uniform1i(this.uAtlas, 0);
    gl.uniform1f(this.uAtlasGridSize, this.atlasGridSize);
    gl.uniform1f(this.uItemCount, this.items.length);
    gl.uniform1i(this.uDebug, this._debug || 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, this.instanceCount);
  }

  // ── Public API ──
  pause() {
    this._paused = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume() {
    this._paused = false;
    this.arcball.lastTime = performance.now();
    this._lastFrameTime = null;
    this._schedule();
  }

  resize() {
    this._resize();
    this._schedule();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    window.clearTimeout(this._liveTimer);
    window.clearTimeout(this._atlasTimeoutId);

    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this._onPointerDown);
      canvas.removeEventListener('pointermove', this._onPointerMove);
      canvas.removeEventListener('pointerup', this._onPointerUp);
      canvas.removeEventListener('pointercancel', this._onPointerUp);
      canvas.removeEventListener('lostpointercapture', this._onPointerUp);
      canvas.removeEventListener('webglcontextlost', this._onContextLost);
      canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    }

    if (this.container) {
      this.container.removeEventListener('keydown', this._onKeyDown);
      this.container.removeEventListener('wheel', this._onWheel);
    }

    document.removeEventListener('visibilitychange', this._onVisibility);

    this._resizeObserver?.disconnect();
    this._intersectionObserver?.disconnect();

    this._deleteGLResources();

    this.arcball = null;
    this.sphereVertices = null;
    this.items = [];
    this.options = {};
  }
}
