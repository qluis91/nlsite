import { mat4, quat, vec3 } from '../../vendor/gl-matrix/index.js';

const MAX_ITEMS = 24;
const MAX_DPR = 2;
const DISC_SEGMENTS = 56;
const SPHERE_POINT_COUNT = 42;
const SPHERE_RADIUS = 4.2;
const DISC_SCALE = 0.68;
const SELECTED_DISC_SCALE = 1.16;
const MAX_FRAME_MS = 50;
const IMAGE_TIMEOUT_MS = 8000;
const INERTIA_FRICTION = 0.91;
const INERTIA_EPSILON = 0.015;
const SNAP_EPSILON = 0.0025;
const POINTER_SENSITIVITY = 0.006;
const SAFE_THUMBNAIL = /^\/uploads\/gallery\/thumbnails\/[a-zA-Z0-9._-]+$/;
const CAMERA_FOV = Math.PI / 3;
const FRAME_MARGIN = 0.86;
const MOBILE_LAYOUT_MAX = 639;
const TABLET_LAYOUT_MAX = 1023;
const MOBILE_DISC_SCALE = 0.5;
const MOBILE_SELECTED_DISC_SCALE = 0.84;
const TABLET_DISC_SCALE = 0.56;
const TABLET_SELECTED_DISC_SCALE = 0.96;
const RESPONSIVE_INFO_START = 0.72;

const CAMERA_POSITION = vec3.fromValues(0, 0, 9.5);
const CAMERA_TARGET = vec3.fromValues(0, 0, 0);
const WORLD_UP = vec3.fromValues(0, 1, 0);
const ALT_UP = vec3.fromValues(1, 0, 0);
const FRONT_DIRECTION = vec3.fromValues(0, 0, 1);
const X_AXIS = vec3.fromValues(1, 0, 0);
const Y_AXIS = vec3.fromValues(0, 1, 0);

const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUv;
layout(location = 3) in mat4 aInstanceMatrix;

uniform mat4 uView;
uniform mat4 uProjection;

out vec2 vUv;
flat out int vInstanceId;

void main() {
  vUv = aUv;
  vInstanceId = gl_InstanceID;
  gl_Position =
    uProjection *
    uView *
    aInstanceMatrix *
    vec4(aPosition, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
flat in int vInstanceId;

uniform sampler2D uAtlas;
uniform int uAtlasColumns;
uniform int uAtlasRows;
uniform int uItemCount;
uniform int uDiagnostic;

out vec4 outColor;

void main() {
  if (uDiagnostic == 1) {
    outColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }

  int itemIndex = vInstanceId % uItemCount;
  int column = itemIndex % uAtlasColumns;
  int row = itemIndex / uAtlasColumns;
  vec2 atlasUv = vec2(
    (float(column) + vUv.x) / float(uAtlasColumns),
    (float(row) + vUv.y) / float(uAtlasRows)
  );
  vec4 texColor = texture(uAtlas, atlasUv);

  vec2 centered = vUv * 2.0 - 1.0;
  float radius = length(centered);
  if (radius > 1.0) {
    discard;
  }

  float edgeAlpha = 1.0 - smoothstep(0.9, 1.0, radius);
  outColor = vec4(texColor.rgb, texColor.a * edgeAlpha);
}
`;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isFiniteArray(values) {
  return values.every(Number.isFinite);
}

export function createDiscGeometry(segments = DISC_SEGMENTS) {
  const boundedSegments = clamp(Math.trunc(segments) || DISC_SEGMENTS, 3, 512);
  const positions = [0, 0, 0];
  const uvs = [0.5, 0.5];
  const indices = [];

  for (let index = 0; index <= boundedSegments; index += 1) {
    const angle = (index / boundedSegments) * Math.PI * 2;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    positions.push(x, y, 0);
    uvs.push(x * 0.5 + 0.5, y * 0.5 + 0.5);
  }
  for (let index = 0; index < boundedSegments; index += 1) {
    indices.push(0, index + 1, index + 2);
  }

  const geometry = {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
  if (
    !isFiniteArray(geometry.positions)
    || !isFiniteArray(geometry.uvs)
    || geometry.indices.length === 0
  ) {
    throw new Error('Infinite Menu disc geometry is invalid.');
  }
  return geometry;
}

export function createSpherePoints(count = SPHERE_POINT_COUNT, radius = SPHERE_RADIUS) {
  const safeCount = clamp(Math.trunc(count) || SPHERE_POINT_COUNT, 1, 512);
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : SPHERE_RADIUS;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const points = [];

  for (let index = 0; index < safeCount; index += 1) {
    const y = 1 - ((index + 0.5) / safeCount) * 2;
    const horizontalRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * goldenAngle;
    points.push(vec3.fromValues(
      Math.cos(angle) * horizontalRadius * safeRadius,
      y * safeRadius,
      Math.sin(angle) * horizontalRadius * safeRadius
    ));
  }
  return points;
}

export function resolveSphereLayout(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const aspect = clamp(safeWidth / safeHeight, 0.55, 2.4);
  let spreadY;
  let spreadZ;
  let horizontalRatio;
  let discScale;
  let selectedDiscScale;
  let centerOffsetY;
  let infoCardStartRatio;

  if (safeWidth <= MOBILE_LAYOUT_MAX) {
    const isLandscape = aspect > 1;
    spreadY = isLandscape ? 2.5 : 2.55;
    spreadZ = isLandscape ? 2.3 : 2.25;
    horizontalRatio = clamp(aspect * 1.25, 1.05, 1.52);
    discScale = isLandscape ? 0.53 : MOBILE_DISC_SCALE;
    selectedDiscScale = isLandscape ? 0.9 : MOBILE_SELECTED_DISC_SCALE;
    centerOffsetY = isLandscape ? 0.42 : 0.55;
    infoCardStartRatio = RESPONSIVE_INFO_START;
  } else if (safeWidth <= TABLET_LAYOUT_MAX) {
    spreadY = 2.85;
    spreadZ = 2.55;
    horizontalRatio = clamp(aspect * 1.12, 1.25, 1.75);
    discScale = TABLET_DISC_SCALE;
    selectedDiscScale = TABLET_SELECTED_DISC_SCALE;
    centerOffsetY = 0.45;
    infoCardStartRatio = RESPONSIVE_INFO_START;
  } else {
    spreadY = 3.15;
    spreadZ = 3.05;
    horizontalRatio = clamp(aspect * 1.05, 1.65, 2);
    discScale = DISC_SCALE;
    selectedDiscScale = SELECTED_DISC_SCALE;
    centerOffsetY = 0;
    infoCardStartRatio = null;
  }

  const spreadX = spreadY * horizontalRatio;
  const tangent = Math.tan(CAMERA_FOV / 2);
  const paddedX = spreadX + selectedDiscScale;
  const paddedY = spreadY + Math.abs(centerOffsetY) + selectedDiscScale;
  const horizontalDistance = Math.sqrt(
    spreadZ ** 2 + (paddedX / (tangent * aspect * FRAME_MARGIN)) ** 2
  );
  const verticalDistance = Math.sqrt(
    spreadZ ** 2 + (paddedY / (tangent * FRAME_MARGIN)) ** 2
  );
  const cameraDistance = Math.max(CAMERA_POSITION[2], horizontalDistance, verticalDistance);

  return {
    aspect,
    spreadX,
    spreadY,
    spreadZ,
    scaleX: spreadX / SPHERE_RADIUS,
    scaleY: spreadY / SPHERE_RADIUS,
    scaleZ: spreadZ / SPHERE_RADIUS,
    discScale,
    selectedDiscScale,
    centerOffsetY,
    infoCardStartRatio,
    cameraDistance,
    frameMargin: FRAME_MARGIN,
  };
}

export function positionSpherePoint(point, layout, out = vec3.create()) {
  const safeLayout = layout || { scaleX: 1, scaleY: 1, scaleZ: 1 };
  return vec3.set(
    out,
    point[0] * safeLayout.scaleX,
    point[1] * safeLayout.scaleY + (safeLayout.centerOffsetY || 0),
    point[2] * safeLayout.scaleZ
  );
}

export function createTranslationMatrix(position, scale = DISC_SCALE) {
  const matrix = mat4.create();
  mat4.translate(matrix, matrix, position);
  mat4.scale(matrix, matrix, [scale, scale, scale]);
  return matrix;
}

export function sphereDiscScale(pointIndex, activePointIndex, layout) {
  const normalScale = layout?.discScale ?? DISC_SCALE;
  const activeScale = layout?.selectedDiscScale ?? SELECTED_DISC_SCALE;
  return pointIndex === activePointIndex ? activeScale : normalScale;
}

export function createBillboardMatrix(
  position,
  cameraPosition = CAMERA_POSITION,
  scale = DISC_SCALE
) {
  const toCamera = vec3.subtract(vec3.create(), cameraPosition, position);
  vec3.normalize(toCamera, toCamera);
  const referenceUp = Math.abs(vec3.dot(WORLD_UP, toCamera)) > 0.985 ? ALT_UP : WORLD_UP;
  const right = vec3.cross(vec3.create(), referenceUp, toCamera);
  vec3.normalize(right, right);
  const up = vec3.cross(vec3.create(), toCamera, right);
  vec3.normalize(up, up);

  const matrix = mat4.create();
  matrix[0] = right[0] * scale;
  matrix[1] = right[1] * scale;
  matrix[2] = right[2] * scale;
  matrix[3] = 0;
  matrix[4] = up[0] * scale;
  matrix[5] = up[1] * scale;
  matrix[6] = up[2] * scale;
  matrix[7] = 0;
  matrix[8] = toCamera[0] * scale;
  matrix[9] = toCamera[1] * scale;
  matrix[10] = toCamera[2] * scale;
  matrix[11] = 0;
  matrix[12] = position[0];
  matrix[13] = position[1];
  matrix[14] = position[2];
  matrix[15] = 1;
  return matrix;
}

export function matrixCenter(matrix) {
  return vec3.transformMat4(vec3.create(), [0, 0, 0], matrix);
}

export function billboardNormal(matrix) {
  return vec3.normalize(vec3.create(), [matrix[8], matrix[9], matrix[10]]);
}

export function getBillboardReferenceAxes() {
  return {
    worldUp: Array.from(WORLD_UP),
    alternateUp: Array.from(ALT_UP),
  };
}

export function createCameraMatrices(width, height, layout = resolveSphereLayout(width, height)) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const cameraPosition = vec3.fromValues(0, 0, layout.cameraDistance);
  const view = mat4.create();
  const projection = mat4.create();
  mat4.lookAt(view, cameraPosition, CAMERA_TARGET, WORLD_UP);
  mat4.perspective(projection, CAMERA_FOV, safeWidth / safeHeight, 0.1, 50);
  return {
    view,
    projection,
    position: cameraPosition,
    target: vec3.clone(CAMERA_TARGET),
  };
}

export function createAtlasLayout(itemCount, maxTextureSize, preferredCellSize = 256) {
  const count = clamp(Math.trunc(itemCount) || 1, 1, MAX_ITEMS);
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const maximum = Math.max(1, Math.trunc(maxTextureSize) || 1);
  const cellSize = Math.max(
    1,
    Math.min(preferredCellSize, Math.floor(maximum / Math.max(columns, rows)))
  );
  return {
    columns,
    rows,
    cellSize,
    width: columns * cellSize,
    height: rows * cellSize,
  };
}

export function atlasCellUv(index, layout) {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    minU: column / layout.columns,
    maxU: (column + 1) / layout.columns,
    minV: row / layout.rows,
    maxV: (row + 1) / layout.rows,
  };
}

export function rotateOrientation(orientation, deltaX, deltaY, sensitivity = POINTER_SENSITIVITY) {
  const pitch = quat.setAxisAngle(quat.create(), X_AXIS, deltaY * sensitivity);
  const yaw = quat.setAxisAngle(quat.create(), Y_AXIS, -deltaX * sensitivity);
  const delta = quat.multiply(quat.create(), yaw, pitch);
  quat.multiply(orientation, delta, orientation);
  quat.normalize(orientation, orientation);
  return orientation;
}

export function decayAngularVelocity(velocity, elapsedMs, friction = INERTIA_FRICTION) {
  const factor = Math.pow(friction, clamp(elapsedMs, 0, MAX_FRAME_MS) / (1000 / 60));
  vec3.scale(velocity, velocity, factor);
  return velocity;
}

export function closestFrontPointIndex(points, orientation) {
  if (!points.length) return -1;
  let closestIndex = 0;
  let closestDot = -Infinity;
  const rotated = vec3.create();
  for (let index = 0; index < points.length; index += 1) {
    vec3.transformQuat(rotated, points[index], orientation);
    const dot = vec3.dot(rotated, FRONT_DIRECTION);
    if (dot > closestDot) {
      closestDot = dot;
      closestIndex = index;
    }
  }
  return closestIndex;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Infinite Menu could not create a shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader error';
    gl.deleteShader(shader);
    throw new Error(`Infinite Menu shader compilation failed: ${message}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error('Infinite Menu could not create a shader program.');
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown program error';
    gl.deleteProgram(program);
    throw new Error(`Infinite Menu program linking failed: ${message}`);
  }
  return program;
}

function drawPlaceholder(context, item, index, layout) {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  const x = column * layout.cellSize;
  const y = row * layout.cellSize;
  const size = layout.cellSize;
  context.fillStyle = index % 2 ? '#202822' : '#151a1c';
  context.fillRect(x, y, size, size);
  context.fillStyle = '#7cf03d';
  context.beginPath();
  context.arc(x + size * 0.5, y + size * 0.42, size * 0.19, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#f4f6f3';
  context.font = `700 ${Math.max(12, Math.floor(size * 0.07))}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const title = String(item?.title || 'Proyecto');
  context.fillText(
    title.length > 22 ? `${title.slice(0, 21)}...` : title,
    x + size * 0.5,
    y + size * 0.73,
    size * 0.82
  );
}

export class InfiniteMenuRenderer {
  constructor(container, items, options = {}) {
    if (!container) throw new Error('Infinite Menu requires a container.');
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Infinite Menu requires at least one gallery item.');
    }
    this.container = container;
    this.items = items.slice(0, MAX_ITEMS);
    this.options = {
      onActiveChange: () => {},
      onSelect: () => {},
      onContextLost: () => {},
      diagnosticStage: '',
      ...options,
    };
    this.destroyed = false;
    this.pauseReasons = new Set();
    this.isIntersecting = true;
    this.rafId = null;
    this.lastFrameTime = 0;
    this.activePointIndex = -1;
    this.activeItemIndex = -1;
    this.orientation = quat.create();
    this.angularVelocity = vec3.create();
    this.snapTarget = null;
    this.pointer = {
      active: false,
      id: null,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      lastTime: 0,
      distance: 0,
    };
    this.imageRecords = new Set();
    this.buffers = new Set();
    this.vertexArrays = new Set();
    this.programs = new Set();
    this.textures = new Set();
    this.boundHandlers = false;
    this.ready = this.init();
  }

  async init() {
    try {
      this.setupCanvas();
      this.setupWebGL();
      this.createScene();
      this.bindHandlers();
      this.addEventListeners();
      this.resize();
      this.createAtlas();
      await this.loadAtlasImages();
      if (this.destroyed) return this;
      this.uploadAtlasTexture();
      this.render();
      this.container.classList.add('is-ready');
      return this;
    } catch (error) {
      if (!this.destroyed) this.releaseResources();
      throw error;
    }
  }

  setupCanvas() {
    const existing = this.container.querySelector('[data-gallery-infinite-canvas]');
    this.canvas = existing || document.createElement('canvas');
    this.canvas.className = 'gallery-infinite__canvas';
    this.canvas.setAttribute('data-gallery-infinite-canvas', '');
    this.canvas.setAttribute('data-gallery-renderer-generated', 'infinite');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.container.querySelectorAll?.('[data-gallery-renderer-generated="infinite"]')
      .forEach((candidate) => {
        if (candidate !== this.canvas) candidate.remove();
      });
    if (!existing) this.container.prepend(this.canvas);
  }

  setupWebGL() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    });
    if (!gl) throw new Error('WebGL 2 is unavailable.');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    if (this.maxTextureSize < 1024 || maxAttributes < 8) {
      throw new Error('WebGL 2 capabilities are insufficient.');
    }
    gl.disable(gl.CULL_FACE);
  }

  createScene() {
    const gl = this.gl;
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.programs.add(this.program);
    this.uniforms = {
      view: gl.getUniformLocation(this.program, 'uView'),
      projection: gl.getUniformLocation(this.program, 'uProjection'),
      atlas: gl.getUniformLocation(this.program, 'uAtlas'),
      columns: gl.getUniformLocation(this.program, 'uAtlasColumns'),
      rows: gl.getUniformLocation(this.program, 'uAtlasRows'),
      itemCount: gl.getUniformLocation(this.program, 'uItemCount'),
      diagnostic: gl.getUniformLocation(this.program, 'uDiagnostic'),
    };

    const geometry = createDiscGeometry();
    this.indexCount = geometry.indices.length;
    this.spherePoints = createSpherePoints();
    this.instanceCount = this.options.diagnosticStage === 'disc' ? 1 : this.spherePoints.length;
    this.instanceData = new Float32Array(this.spherePoints.length * 16);

    this.vao = gl.createVertexArray();
    this.vertexArrays.add(this.vao);
    gl.bindVertexArray(this.vao);

    this.positionBuffer = gl.createBuffer();
    this.buffers.add(this.positionBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    this.uvBuffer = gl.createBuffer();
    this.buffers.add(this.uvBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    this.indexBuffer = gl.createBuffer();
    this.buffers.add(this.indexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

    this.instanceBuffer = gl.createBuffer();
    this.buffers.add(this.instanceBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData, gl.DYNAMIC_DRAW);
    const stride = 16 * Float32Array.BYTES_PER_ELEMENT;
    for (let column = 0; column < 4; column += 1) {
      const location = 3 + column;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        4,
        gl.FLOAT,
        false,
        stride,
        column * 4 * Float32Array.BYTES_PER_ELEMENT
      );
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
  }

  createAtlas() {
    this.atlasLayout = createAtlasLayout(this.items.length, this.maxTextureSize);
    this.atlasCanvas = document.createElement('canvas');
    this.atlasCanvas.width = this.atlasLayout.width;
    this.atlasCanvas.height = this.atlasLayout.height;
    this.atlasContext = this.atlasCanvas.getContext('2d', { alpha: true });
    if (!this.atlasContext) throw new Error('Infinite Menu could not create its image atlas.');
    this.items.forEach((item, index) => {
      drawPlaceholder(this.atlasContext, item, index, this.atlasLayout);
    });
  }

  loadAtlasImages() {
    return Promise.all(this.items.map((item, index) => this.loadAtlasImage(item, index)));
  }

  loadAtlasImage(item, index) {
    return new Promise((resolve) => {
      if (!SAFE_THUMBNAIL.test(item.thumbnail || '')) {
        resolve(false);
        return;
      }
      const image = new Image();
      const record = {
        image,
        timeoutId: null,
        settled: false,
        settle: null,
      };
      const settle = (loaded) => {
        if (record.settled) return;
        record.settled = true;
        window.clearTimeout(record.timeoutId);
        image.onload = null;
        image.onerror = null;
        this.imageRecords.delete(record);
        resolve(loaded);
      };
      record.settle = settle;
      this.imageRecords.add(record);
      record.timeoutId = window.setTimeout(() => settle(false), IMAGE_TIMEOUT_MS);
      image.onload = () => {
        if (!this.destroyed) this.drawAtlasImage(image, index);
        settle(!this.destroyed);
      };
      image.onerror = () => settle(false);
      image.src = item.thumbnail;
    });
  }

  drawAtlasImage(image, index) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return;
    const { columns, cellSize } = this.atlasLayout;
    const x = (index % columns) * cellSize;
    const y = Math.floor(index / columns) * cellSize;
    const sourceSize = Math.min(width, height);
    const sourceX = (width - sourceSize) / 2;
    const sourceY = (height - sourceSize) / 2;
    this.atlasContext.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      x,
      y,
      cellSize,
      cellSize
    );
  }

  uploadAtlasTexture() {
    if (this.destroyed) return;
    const gl = this.gl;
    this.texture = gl.createTexture();
    this.textures.add(this.texture);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.atlasCanvas
    );
  }

  bindHandlers() {
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onLostPointerCapture = this.onLostPointerCapture.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.onContextLost = this.onContextLost.bind(this);
    this.onContextRestored = this.onContextRestored.bind(this);
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    this.boundHandlers = true;
  }

  addEventListeners() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
    this.container.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', this.resize);
    }
    window.addEventListener('orientationchange', this.resize);
    this.breakpointQueries = [
      window.matchMedia?.(`(max-width: ${MOBILE_LAYOUT_MAX}px)`),
      window.matchMedia?.(`(max-width: ${TABLET_LAYOUT_MAX}px)`),
    ].filter(Boolean);
    this.breakpointQueries.forEach((query) => query.addEventListener?.('change', this.resize));
    if ('IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.isIntersecting = entries[0]?.isIntersecting ?? true;
        if (this.isIntersecting) {
          this.resize();
          this.resume('intersection');
        } else {
          this.pause('intersection');
        }
      }, { threshold: 0.08 });
      this.intersectionObserver.observe(this.container);
    }
  }

  resize() {
    if (this.destroyed || !this.canvas || !this.gl) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.container.clientWidth || 1));
    const height = Math.max(1, Math.round(rect.height || this.container.clientHeight || 1));
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    this.width = width;
    this.height = height;
    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
    this.sphereLayout = resolveSphereLayout(width, height);
    if (this.sphereLayout.infoCardStartRatio) {
      this.container.style.setProperty(
        '--infinite-info-start',
        `${this.sphereLayout.infoCardStartRatio * 100}%`
      );
    } else {
      this.container.style.removeProperty('--infinite-info-start');
    }
    const camera = createCameraMatrices(width, height, this.sphereLayout);
    this.viewMatrix = camera.view;
    this.projectionMatrix = camera.projection;
    this.cameraPosition = camera.position;
    if (this.texture) this.requestFrame();
  }

  onPointerDown(event) {
    if (this.destroyed || event.button > 0 || event.isPrimary === false) return;
    event.preventDefault();
    this.pointer.active = true;
    this.pointer.id = event.pointerId;
    this.pointer.startX = event.clientX;
    this.pointer.startY = event.clientY;
    this.pointer.lastX = event.clientX;
    this.pointer.lastY = event.clientY;
    this.pointer.lastTime = event.timeStamp || performance.now();
    this.pointer.distance = 0;
    vec3.set(this.angularVelocity, 0, 0, 0);
    this.snapTarget = null;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.container.classList.add('is-dragging');
    this.requestFrame();
  }

  onPointerMove(event) {
    if (!this.pointer.active || event.pointerId !== this.pointer.id) return;
    event.preventDefault();
    const deltaX = event.clientX - this.pointer.lastX;
    const deltaY = event.clientY - this.pointer.lastY;
    const now = event.timeStamp || performance.now();
    const elapsedSeconds = clamp(now - this.pointer.lastTime, 8, 64) / 1000;
    rotateOrientation(this.orientation, deltaX, deltaY);
    this.angularVelocity[0] = clamp(
      this.angularVelocity[0] * 0.55 + (deltaY * POINTER_SENSITIVITY / elapsedSeconds) * 0.45,
      -4,
      4
    );
    this.angularVelocity[1] = clamp(
      this.angularVelocity[1] * 0.55 + (-deltaX * POINTER_SENSITIVITY / elapsedSeconds) * 0.45,
      -4,
      4
    );
    this.pointer.distance += Math.hypot(deltaX, deltaY);
    this.pointer.lastX = event.clientX;
    this.pointer.lastY = event.clientY;
    this.pointer.lastTime = now;
    this.requestFrame();
  }

  onPointerUp(event) {
    if (!this.pointer.active || event.pointerId !== this.pointer.id) return;
    const shouldSelect = this.pointer.distance < 6 && event.type !== 'pointercancel';
    this.releasePointer();
    if (shouldSelect) {
      const item = this.items[this.activeItemIndex];
      if (item) this.options.onSelect(item);
    }
    if (vec3.length(this.angularVelocity) < INERTIA_EPSILON) this.beginSnap();
    this.requestFrame();
  }

  onLostPointerCapture(event) {
    if (!this.pointer.active || event.pointerId !== this.pointer.id) return;
    this.releasePointer(false);
    this.beginSnap();
    this.requestFrame();
  }

  releasePointer(releaseCapture = true) {
    if (
      releaseCapture
      && this.pointer.id !== null
      && this.canvas.hasPointerCapture?.(this.pointer.id)
    ) {
      this.canvas.releasePointerCapture(this.pointer.id);
    }
    this.pointer.active = false;
    this.pointer.id = null;
    this.container.classList.remove('is-dragging');
  }

  onKeyDown(event) {
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === 'ArrowLeft') deltaX = 50;
    else if (event.key === 'ArrowRight') deltaX = -50;
    else if (event.key === 'ArrowUp') deltaY = 50;
    else if (event.key === 'ArrowDown') deltaY = -50;
    else if (event.key === 'Home') {
      event.preventDefault();
      quat.identity(this.orientation);
      vec3.set(this.angularVelocity, 0, 0, 0);
      this.beginSnap();
      this.requestFrame();
      return;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = this.items[this.activeItemIndex];
      if (item) this.options.onSelect(item);
      return;
    } else {
      return;
    }
    event.preventDefault();
    rotateOrientation(this.orientation, deltaX, deltaY);
    vec3.set(this.angularVelocity, 0, 0, 0);
    this.beginSnap();
    this.requestFrame();
  }

  beginSnap() {
    if (!this.spherePoints?.length) return;
    const pointIndex = closestFrontPointIndex(this.spherePoints, this.orientation);
    const rotated = vec3.transformQuat(
      vec3.create(),
      this.spherePoints[pointIndex],
      this.orientation
    );
    vec3.normalize(rotated, rotated);
    const correction = quat.rotationTo(quat.create(), rotated, FRONT_DIRECTION);
    this.snapTarget = quat.multiply(quat.create(), correction, this.orientation);
    quat.normalize(this.snapTarget, this.snapTarget);
  }

  applyInertia(elapsedMs) {
    const speed = vec3.length(this.angularVelocity);
    if (speed < INERTIA_EPSILON) {
      vec3.set(this.angularVelocity, 0, 0, 0);
      return false;
    }
    const elapsedSeconds = elapsedMs / 1000;
    const pitch = quat.setAxisAngle(
      quat.create(),
      X_AXIS,
      this.angularVelocity[0] * elapsedSeconds
    );
    const yaw = quat.setAxisAngle(
      quat.create(),
      Y_AXIS,
      this.angularVelocity[1] * elapsedSeconds
    );
    const delta = quat.multiply(quat.create(), yaw, pitch);
    quat.multiply(this.orientation, delta, this.orientation);
    quat.normalize(this.orientation, this.orientation);
    decayAngularVelocity(this.angularVelocity, elapsedMs);
    return true;
  }

  applySnap(elapsedMs) {
    if (!this.snapTarget) return false;
    const amount = 1 - Math.exp(-elapsedMs * 0.012);
    quat.slerp(this.orientation, this.orientation, this.snapTarget, amount);
    quat.normalize(this.orientation, this.orientation);
    const dot = Math.abs(
      this.orientation[0] * this.snapTarget[0]
      + this.orientation[1] * this.snapTarget[1]
      + this.orientation[2] * this.snapTarget[2]
      + this.orientation[3] * this.snapTarget[3]
    );
    if (1 - dot < SNAP_EPSILON) {
      quat.copy(this.orientation, this.snapTarget);
      this.snapTarget = null;
      return false;
    }
    return true;
  }

  frame(timestamp) {
    this.rafId = null;
    if (this.destroyed || this.pauseReasons.size || !this.isIntersecting) return;
    const elapsed = this.lastFrameTime
      ? clamp(timestamp - this.lastFrameTime, 1, MAX_FRAME_MS)
      : 1000 / 60;
    this.lastFrameTime = timestamp;
    let moving = this.pointer.active;
    if (!this.pointer.active && !this.snapTarget) {
      moving = this.applyInertia(elapsed);
      if (!moving) this.beginSnap();
    }
    if (!this.pointer.active && this.snapTarget) {
      moving = this.applySnap(elapsed) || moving;
    }
    this.render();
    if (moving || this.pointer.active || this.snapTarget) this.requestFrame();
  }

  buildInstanceMatrices() {
    if (this.options.diagnosticStage === 'disc') {
      const matrix = mat4.create();
      mat4.scale(matrix, matrix, [1.5, 1.5, 1.5]);
      this.instanceData.set(matrix, 0);
      this.instanceCount = 1;
      return;
    }

    this.instanceCount = this.spherePoints.length;
    const rotated = vec3.create();
    const positioned = vec3.create();
    const selectedPointIndex = closestFrontPointIndex(this.spherePoints, this.orientation);
    this.activePointIndex = selectedPointIndex;
    for (let index = 0; index < this.spherePoints.length; index += 1) {
      vec3.transformQuat(rotated, this.spherePoints[index], this.orientation);
      positionSpherePoint(rotated, this.sphereLayout, positioned);
      const scale = sphereDiscScale(index, selectedPointIndex, this.sphereLayout);
      const matrix = this.options.diagnosticStage === 'sphere'
        ? createTranslationMatrix(positioned, scale)
        : createBillboardMatrix(positioned, this.cameraPosition, scale);
      this.instanceData.set(matrix, index * 16);
    }
  }

  render() {
    if (
      this.destroyed
      || !this.gl
      || !this.program
      || !this.vao
      || !this.viewMatrix
      || !this.projectionMatrix
    ) return;
    const gl = this.gl;
    this.buildInstanceMatrices();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    if (this.options.diagnosticStage) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
    } else {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.uniforms.view, false, this.viewMatrix);
    gl.uniformMatrix4fv(this.uniforms.projection, false, this.projectionMatrix);
    gl.uniform1i(this.uniforms.atlas, 0);
    gl.uniform1i(this.uniforms.columns, this.atlasLayout.columns);
    gl.uniform1i(this.uniforms.rows, this.atlasLayout.rows);
    gl.uniform1i(this.uniforms.itemCount, this.items.length);
    gl.uniform1i(this.uniforms.diagnostic, this.options.diagnosticStage ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawElementsInstanced(
      gl.TRIANGLES,
      this.indexCount,
      gl.UNSIGNED_SHORT,
      0,
      this.instanceCount
    );
    this.emitActive();
  }

  emitActive(force = false) {
    const pointIndex = closestFrontPointIndex(this.spherePoints || [], this.orientation);
    if (pointIndex < 0) return;
    const itemIndex = pointIndex % this.items.length;
    if (!force && itemIndex === this.activeItemIndex) return;
    this.activePointIndex = pointIndex;
    this.activeItemIndex = itemIndex;
    const item = this.items[itemIndex];
    const title = this.container.querySelector('[data-gallery-infinite-title]');
    const meta = this.container.querySelector('[data-gallery-infinite-meta]');
    if (title) title.textContent = item.title || 'Proyecto';
    if (meta) {
      meta.textContent = [item.category, item.type === 'video' ? 'Video' : 'Imagen']
        .filter(Boolean)
        .join(' · ');
    }
    this.options.onActiveChange(item, itemIndex, this.items.length);
  }

  requestFrame() {
    if (
      this.destroyed
      || this.pauseReasons.size
      || !this.isIntersecting
      || this.rafId !== null
    ) return;
    this.rafId = window.requestAnimationFrame(this.frame);
  }

  pause(reason = 'manual') {
    if (this.destroyed) return;
    this.pauseReasons.add(reason);
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastFrameTime = 0;
  }

  resume(reason = 'manual') {
    if (this.destroyed) return;
    this.pauseReasons.delete(reason);
    this.lastFrameTime = 0;
    this.requestFrame();
  }

  onVisibilityChange() {
    if (document.hidden) this.pause('visibility');
    else this.resume('visibility');
  }

  onContextLost(event) {
    event.preventDefault();
    this.pause('context');
    this.options.onContextLost();
  }

  onContextRestored() {
    this.pause('context');
  }

  cancelImages() {
    for (const record of [...this.imageRecords]) record.settle(false);
    this.imageRecords.clear();
  }

  releaseResources() {
    const gl = this.gl;
    if (!gl) return;
    for (const texture of this.textures) gl.deleteTexture(texture);
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    for (const vao of this.vertexArrays) gl.deleteVertexArray(vao);
    for (const program of this.programs) gl.deleteProgram(program);
    this.textures.clear();
    this.buffers.clear();
    this.vertexArrays.clear();
    this.programs.clear();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
    window.clearTimeout(this.liveTimer);
    this.cancelImages();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    this.breakpointQueries?.forEach(
      (query) => query.removeEventListener?.('change', this.resize)
    );
    this.breakpointQueries = [];
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.canvas && this.boundHandlers) {
      this.canvas.removeEventListener('pointerdown', this.onPointerDown);
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerup', this.onPointerUp);
      this.canvas.removeEventListener('pointercancel', this.onPointerUp);
      this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    }
    if (this.container && this.boundHandlers) {
      this.container.removeEventListener('keydown', this.onKeyDown);
    }
    if (this.pointer.active) this.releasePointer();
    this.releaseResources();
    this.canvas?.remove();
    this.container?.classList.remove('is-ready', 'is-dragging');
    this.items = [];
    this.spherePoints = null;
    this.instanceData = null;
    this.atlasCanvas = null;
    this.atlasContext = null;
    this.options.onActiveChange = () => {};
    this.options.onSelect = () => {};
    this.options.onContextLost = () => {};
    this.canvas = null;
    this.gl = null;
    this.container = null;
  }
}
