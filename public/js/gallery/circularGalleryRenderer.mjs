const VERTEX_SHADER = `
  attribute vec2 aPosition;
  attribute vec2 aUv;
  uniform vec2 uResolution;
  uniform vec2 uCenter;
  uniform vec2 uPlaneSizes;
  uniform float uTime;
  uniform float uSpeed;
  varying vec2 vUv;

  void main() {
    vUv = aUv;
    vec3 p = vec3(aPosition, 0.0);
    p.z = (sin(p.x * 4.0 + uTime) * 1.5 + cos(p.y * 2.0 + uTime) * 1.5)
      * (0.1 + min(abs(uSpeed), 1.5) * 0.5);
    float perspective = 1.0 / max(0.82, 1.0 + p.z * 0.035);
    vec2 pixel = uCenter + p.xy * uPlaneSizes * 0.5 * perspective;
    vec2 clip = (pixel / uResolution) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, p.z * 0.001, 1.0);
  }
`;

const IMAGE_FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D tMap;
  uniform vec2 uImageSizes;
  uniform vec2 uPlaneSizes;
  uniform float uBorderRadius;
  varying vec2 vUv;

  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b;
    return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r;
  }

  void main() {
    vec2 imageSizes = max(uImageSizes, vec2(1.0));
    vec2 planeSizes = max(uPlaneSizes, vec2(1.0));
    vec2 ratio = vec2(
      min((planeSizes.x / planeSizes.y) / (imageSizes.x / imageSizes.y), 1.0),
      min((planeSizes.y / planeSizes.x) / (imageSizes.y / imageSizes.x), 1.0)
    );
    vec2 uv = vUv * ratio + (1.0 - ratio) * 0.5;
    vec4 color = texture2D(tMap, uv);
    float radius = clamp(uBorderRadius, 0.0, 0.24);
    float distance = roundedBoxSDF(vUv - 0.5, vec2(0.5 - radius), radius);
    float alpha = 1.0 - smoothstep(-0.003, 0.003, distance);
    gl_FragColor = vec4(color.rgb, color.a * alpha);
  }
`;

function lerp(start, end, ease) {
  return start + (end - start) * ease;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Shader compilation failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, fragmentSource) {
  const program = gl.createProgram();
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Program linking failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function createPlaceholderCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#161b18';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#7cf03d';
  context.beginPath();
  context.arc(canvas.width / 2, canvas.height / 2, 72, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#101713';
  context.beginPath();
  context.moveTo(canvas.width / 2 - 18, canvas.height / 2 - 34);
  context.lineTo(canvas.width / 2 + 38, canvas.height / 2);
  context.lineTo(canvas.width / 2 - 18, canvas.height / 2 + 34);
  context.closePath();
  context.fill();
  return canvas;
}

function createTexture(gl, source) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  return texture;
}

const SAFE_LOCAL_THUMBNAIL = /^\/uploads\/gallery\/thumbnails\/[a-zA-Z0-9._-]+$/;
const SAFE_YOUTUBE_THUMBNAIL = /^https:\/\/img\.youtube\.com\/vi\/[a-zA-Z0-9_-]{11}\/(?:hq|mq)default\.jpg$/;
const SAFE_LOCAL_PLACEHOLDER = '/images/gallery-video-placeholder.svg';

export function isSafeThumbnail(value) {
  return typeof value === 'string'
    && (
      SAFE_LOCAL_THUMBNAIL.test(value)
      || SAFE_YOUTUBE_THUMBNAIL.test(value)
      || value === SAFE_LOCAL_PLACEHOLDER
    );
}

export function thumbnailCandidates(item = {}) {
  return [
    item.thumbnail,
    ...(Array.isArray(item.thumbnailFallbacks) ? item.thumbnailFallbacks : []),
    SAFE_LOCAL_PLACEHOLDER,
  ].filter((candidate, index, candidates) => (
    isSafeThumbnail(candidate) && candidates.indexOf(candidate) === index
  ));
}

export function carouselItemKey(item, index = 0) {
  const id = Number(item?.id);
  if (Number.isSafeInteger(id) && id > 0) return `gallery:${id}`;
  const publicId = String(item?.publicId || '').trim();
  if (publicId) return `gallery-public:${publicId}`;
  return `gallery-index:${index}`;
}

export function calculateCarouselPositions(itemCount, spacing, scroll, width) {
  const count = Math.max(0, Math.trunc(itemCount) || 0);
  if (!count) return [];
  const center = width / 2;
  if (count === 1) return [{ index: 0, x: center }];
  const total = spacing * count;
  const phase = count === 2 ? -spacing / 2 : 0;
  return Array.from({ length: count }, (_, index) => {
    const rawOffset = index * spacing - scroll + phase;
    let wrapped = ((rawOffset + total / 2) % total + total) % total - total / 2;
    if (count === 2 && wrapped === -total / 2 && rawOffset > 0) wrapped = total / 2;
    return { index, x: center + wrapped };
  });
}

export function advanceAutoplayTarget(target, spacing, elapsedMs, itemDurationMs = 32000) {
  if (
    !Number.isFinite(target)
    || !Number.isFinite(spacing)
    || !Number.isFinite(elapsedMs)
    || !Number.isFinite(itemDurationMs)
    || spacing <= 0
    || elapsedMs <= 0
    || itemDurationMs <= 0
  ) return target;
  return target + (spacing * elapsedMs) / itemDurationMs;
}

export class CircularGalleryRenderer {
  constructor(container, options = {}) {
    if (!container) throw new Error('Circular Gallery requires a container.');
    this.container = container;
    this.items = Array.isArray(options.items)
      ? options.items.map((item, index) => ({
        ...item,
        key: item?.key || carouselItemKey(item, index),
      }))
      : [];
    if (!this.items.length) throw new Error('Circular Gallery requires at least one item.');
    this.options = {
      bend: 0,
      scrollEase: 0.075,
      scrollSpeed: 1,
      autoplay: true,
      autoplayItemDuration: 32000,
      onActiveChange: () => {},
      onSelect: () => {},
      onContextLost: () => {},
      ...options,
    };
    this.destroyed = false;
    this.rafId = null;
    this.pauseReasons = new Set();
    this.autoplayPauseReasons = new Set();
    this.lastFrameTime = null;
    this.interactionResumeTimer = null;
    this.scroll = { current: 0, target: 0, last: 0 };
    this.activeIndex = -1;
    this.pointer = {
      active: false,
      moved: false,
      id: null,
      axis: null,
      startX: 0,
      startY: 0,
      startTarget: 0,
    };
    this.drawBounds = [];
    this.resources = [];
    this.textureRecords = new Map();
    this.glTextures = new Set();
    this.glBuffers = new Set();
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gallery-circular__canvas';
    this.canvas.setAttribute('data-gallery-renderer-generated', 'circular');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.canvas);
    this.gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL is unavailable.');
    this.createScene();
    this.bindHandlers();
    this.addEventListeners();
    this.resize();
    this.updateActive(true);
    this.ready = this.loadTextures().then(() => {
      if (this.destroyed) return this;
      this.render();
      this.schedule();
      return this;
    });
  }

  createScene() {
    const gl = this.gl;
    this.imageProgram = createProgram(gl, IMAGE_FRAGMENT_SHADER);
    this.resources.push(this.imageProgram);
    this.buffer = gl.createBuffer();
    this.glBuffers.add(this.buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
      -1,  1, 0, 1,
       1, -1, 1, 0,
       1,  1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  bindHandlers() {
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onMouseEnter = this.onMouseEnter.bind(this);
    this.onMouseLeave = this.onMouseLeave.bind(this);
    this.onFocusIn = this.onFocusIn.bind(this);
    this.onFocusOut = this.onFocusOut.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.onContextLost = this.onContextLost.bind(this);
    this.onContextRestored = this.onContextRestored.bind(this);
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
  }

  addEventListeners() {
    this.container.addEventListener('pointerdown', this.onPointerDown);
    this.container.addEventListener('pointermove', this.onPointerMove);
    this.container.addEventListener('pointerup', this.onPointerUp);
    this.container.addEventListener('pointercancel', this.onPointerUp);
    this.container.addEventListener('keydown', this.onKeyDown);
    this.container.addEventListener('mouseenter', this.onMouseEnter);
    this.container.addEventListener('mouseleave', this.onMouseLeave);
    this.container.addEventListener('focusin', this.onFocusIn);
    this.container.addEventListener('focusout', this.onFocusOut);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', this.resize);
    }
    if ('IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) {
          this.resize();
          this.resume('intersection');
        } else {
          this.pause('intersection');
        }
      }, { threshold: 0.08 });
      this.intersectionObserver.observe(this.container);
    }
  }

  async loadTextures() {
    const placeholder = createPlaceholderCanvas();
    const jobs = this.items.map((item) => new Promise((resolve) => {
      const record = {
        image: createTexture(this.gl, placeholder),
        width: placeholder.width,
        height: placeholder.height,
      };
      this.textureRecords.set(item.key, record);
      this.glTextures.add(record.image);
      const candidates = thumbnailCandidates(item);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(record);
      };
      const timeoutId = window.setTimeout(finish, 8000);
      const tryCandidate = (candidateIndex) => {
        if (settled || candidateIndex >= candidates.length) {
          finish();
          return;
        }
        const source = candidates[candidateIndex];
        const image = new Image();
        if (SAFE_YOUTUBE_THUMBNAIL.test(source)) image.crossOrigin = 'anonymous';
        image.onload = () => {
          if (this.destroyed) {
            finish();
            return;
          }
          try {
            this.gl.bindTexture(this.gl.TEXTURE_2D, record.image);
            this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
            this.gl.texImage2D(
              this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA,
              this.gl.UNSIGNED_BYTE, image
            );
            record.width = image.naturalWidth || 1;
            record.height = image.naturalHeight || 1;
            finish();
          } catch {
            tryCandidate(candidateIndex + 1);
          }
        };
        image.onerror = () => tryCandidate(candidateIndex + 1);
        image.src = source;
      };
      tryCandidate(0);
    }));
    await Promise.all(jobs);
    return [...this.textureRecords.values()];
  }

  resize() {
    if (this.destroyed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    const maximumCardHeight = Math.min(height * 0.58, width < 600 ? 300 : 390);
    if (this.items.length === 2) {
      this.cardWidth = Math.min(maximumCardHeight * 0.82, width * 0.4);
      this.cardHeight = this.cardWidth / 0.82;
      this.spacing = Math.max(1, Math.min(
        this.cardWidth + Math.max(24, width * 0.025),
        width - this.cardWidth - 24
      ));
    } else {
      this.cardHeight = maximumCardHeight;
      this.cardWidth = Math.min(this.cardHeight * 0.82, width * 0.72);
      this.spacing = this.cardWidth + Math.max(30, width * 0.035);
    }
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.schedule();
  }

  onPointerDown(event) {
    if (this.destroyed || event.button > 0 || event.target.closest?.('button, a')) return;
    this.pointer.active = true;
    this.pointer.moved = false;
    this.pointer.id = event.pointerId;
    this.pointer.axis = null;
    this.pointer.startX = event.clientX;
    this.pointer.startY = event.clientY;
    this.pointer.startTarget = this.scroll.target;
    this.pauseAutoplay('drag');
    this.container.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.pointer.active || event.pointerId !== this.pointer.id || this.items.length === 1) return;
    const distanceX = event.clientX - this.pointer.startX;
    const distanceY = event.clientY - this.pointer.startY;
    if (!this.pointer.axis && Math.max(Math.abs(distanceX), Math.abs(distanceY)) > 7) {
      this.pointer.axis = Math.abs(distanceX) > Math.abs(distanceY) ? 'horizontal' : 'vertical';
      this.pointer.moved = true;
    }
    if (this.pointer.axis !== 'horizontal') return;
    this.scroll.target = this.pointer.startTarget - distanceX * this.options.scrollSpeed;
    this.schedule();
  }

  onPointerUp(event) {
    if (!this.pointer.active || event.pointerId !== this.pointer.id) return;
    this.container.releasePointerCapture?.(event.pointerId);
    const shouldSelect = !this.pointer.moved
      && this.pointer.axis !== 'vertical'
      && event.type !== 'pointercancel';
    this.pointer.active = false;
    this.pointer.id = null;
    this.pointer.axis = null;
    if (shouldSelect) {
      const rect = this.container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const selected = this.drawBounds
        .filter((bound) => x >= bound.left && x <= bound.right)
        .sort((a, b) => Math.abs(a.center - x) - Math.abs(b.center - x))[0];
      if (selected) {
        this.scroll.target += selected.center - this.width / 2;
        this.updateActive();
        this.options.onSelect(this.items[selected.index], this.container);
      }
    } else {
      this.snap();
    }
    this.resumeAutoplay('drag');
  }

  onKeyDown(event) {
    if (this.items.length === 1 && !['Enter', ' '].includes(event.key)) {
      if (['ArrowRight', 'ArrowLeft', 'Home'].includes(event.key)) event.preventDefault();
      this.scroll.target = 0;
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(1);
      return;
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.step(-1);
      return;
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.scroll.target = 0;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.options.onSelect(this.items[this.normalizedIndex()], this.container);
      return;
    } else {
      return;
    }
    this.snap();
    this.schedule();
  }

  onMouseEnter() {
    this.pauseAutoplay('hover');
  }

  onMouseLeave() {
    this.resumeAutoplay('hover');
  }

  onFocusIn() {
    this.pauseAutoplay('focus');
  }

  onFocusOut(event) {
    if (!this.container.contains(event.relatedTarget)) this.resumeAutoplay('focus');
  }

  step(direction) {
    if (!this.spacing || this.items.length <= 1) return;
    const stepDirection = direction < 0 ? -1 : 1;
    const snappedTarget = Math.round(this.scroll.target / this.spacing) * this.spacing;
    this.scroll.target = snappedTarget + stepDirection * this.spacing;
    this.updateActive();
    this.pauseAutoplayBriefly();
    this.schedule();
  }

  pauseAutoplayBriefly() {
    this.pauseAutoplay('interaction');
    window.clearTimeout(this.interactionResumeTimer);
    this.interactionResumeTimer = window.setTimeout(() => {
      this.interactionResumeTimer = null;
      this.resumeAutoplay('interaction');
    }, 1200);
  }

  pauseAutoplay(reason = 'manual') {
    if (this.destroyed) return;
    this.autoplayPauseReasons.add(reason);
    this.lastFrameTime = null;
  }

  resumeAutoplay(reason = 'manual') {
    if (this.destroyed) return;
    this.autoplayPauseReasons.delete(reason);
    this.lastFrameTime = null;
    this.schedule();
  }

  canAutoplay() {
    return this.options.autoplay
      && this.items.length > 1
      && this.autoplayPauseReasons.size === 0;
  }

  snap() {
    if (!this.spacing) return;
    if (this.items.length === 1) {
      this.scroll.target = 0;
      this.schedule();
      return;
    }
    this.scroll.target = Math.round(this.scroll.target / this.spacing) * this.spacing;
    this.updateActive();
    this.schedule();
  }

  normalizedIndex() {
    const length = this.items.length;
    if (!length || !this.spacing) return 0;
    return ((Math.round(this.scroll.target / this.spacing) % length) + length) % length;
  }

  updateActive(force = false) {
    const index = this.normalizedIndex();
    if (!force && index === this.activeIndex) return;
    this.activeIndex = index;
    this.options.onActiveChange(this.items[index], index, this.items.length);
  }

  useProgram(program, texture, centerX, centerY, width, height, speed, imageSize) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const position = gl.getAttribLocation(program, 'aPosition');
    const uv = gl.getAttribLocation(program, 'aUv');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    const set2 = (name, x, y) => {
      const location = gl.getUniformLocation(program, name);
      if (location) gl.uniform2f(location, x, y);
    };
    set2('uResolution', this.width, this.height);
    set2('uCenter', centerX, centerY);
    set2('uPlaneSizes', width, height);
    const time = gl.getUniformLocation(program, 'uTime');
    if (time) gl.uniform1f(time, performance.now() * 0.001);
    const velocity = gl.getUniformLocation(program, 'uSpeed');
    if (velocity) gl.uniform1f(velocity, speed);
    const border = gl.getUniformLocation(program, 'uBorderRadius');
    if (border) gl.uniform1f(border, 0.045);
    if (imageSize) set2('uImageSizes', imageSize[0], imageSize[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const map = gl.getUniformLocation(program, 'tMap');
    if (map) gl.uniform1i(map, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  render() {
    if (this.destroyed || !this.width || !this.height) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const speed = (this.scroll.current - this.scroll.last) / Math.max(1, this.spacing);
    const centerY = this.height * 0.44;
    this.drawBounds = [];
    calculateCarouselPositions(
      this.items.length,
      this.spacing,
      this.scroll.current,
      this.width
    ).forEach(({ index, x }) => {
        const item = this.items[index];
        if (x + this.cardWidth < 0 || x - this.cardWidth > this.width) return;
        const record = this.textureRecords.get(item.key);
        if (!record) return;
        let curvedY = centerY;
        if (this.options.bend !== 0) {
          const half = this.width / 2;
          const bend = Math.abs(this.options.bend) * this.height * 0.08;
          const radius = (half * half + bend * bend) / (2 * bend);
          const effectiveX = Math.min(Math.abs(x - half), half);
          const arc = radius - Math.sqrt(Math.max(0, radius * radius - effectiveX * effectiveX));
          curvedY += this.options.bend > 0 ? arc : -arc;
        }
        this.useProgram(
          this.imageProgram, record.image, x, curvedY,
          this.cardWidth, this.cardHeight, speed, [record.width, record.height]
        );
        this.drawBounds.push({
          index,
          center: x,
          left: x - this.cardWidth / 2,
          right: x + this.cardWidth / 2,
        });
      });
  }

  frame(timestamp) {
    this.rafId = null;
    if (this.destroyed || this.pauseReasons.size) return;
    const elapsed = this.lastFrameTime === null
      ? 0
      : Math.min(64, Math.max(0, timestamp - this.lastFrameTime));
    this.lastFrameTime = timestamp;
    if (this.canAutoplay()) {
      this.scroll.target = advanceAutoplayTarget(
        this.scroll.target,
        this.spacing,
        elapsed,
        this.options.autoplayItemDuration
      );
    }
    this.scroll.current = lerp(this.scroll.current, this.scroll.target, this.options.scrollEase);
    if (Math.abs(this.scroll.current - this.scroll.target) < 0.02) {
      this.scroll.current = this.scroll.target;
    }
    this.render();
    this.scroll.last = this.scroll.current;
    this.updateActive();
    if (
      this.canAutoplay()
      || Math.abs(this.scroll.current - this.scroll.target) > 0.001
      || this.pointer.active
    ) {
      this.schedule();
    } else {
      this.lastFrameTime = null;
    }
  }

  schedule() {
    if (this.destroyed || this.pauseReasons.size || this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(this.frame);
  }

  pause(reason = 'manual') {
    if (this.destroyed) return;
    this.pauseReasons.add(reason);
    this.lastFrameTime = null;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume(reason = 'manual') {
    if (this.destroyed) return;
    this.pauseReasons.delete(reason);
    this.schedule();
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

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    window.clearTimeout(this.interactionResumeTimer);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerup', this.onPointerUp);
    this.container.removeEventListener('pointercancel', this.onPointerUp);
    this.container.removeEventListener('keydown', this.onKeyDown);
    this.container.removeEventListener('mouseenter', this.onMouseEnter);
    this.container.removeEventListener('mouseleave', this.onMouseLeave);
    this.container.removeEventListener('focusin', this.onFocusIn);
    this.container.removeEventListener('focusout', this.onFocusOut);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);

    // Delete native GL textures via tracked set (never call gl.isTexture on mixed objects)
    const gl = this.gl;
    if (gl) {
      for (const texture of this.glTextures) {
        try { gl.deleteTexture(texture); } catch (_) { /* cleanup is best-effort */ }
      }
      for (const buffer of this.glBuffers) {
        try { gl.deleteBuffer(buffer); } catch (_) { /* cleanup is best-effort */ }
      }
    }
    this.glTextures.clear();
    this.glBuffers.clear();

    // Delete programs from the program-only resources collection.
    for (const resource of this.resources) {
      if (!resource) continue;
      try {
        if (gl) gl.deleteProgram(resource);
      } catch (_) { /* best-effort */ }
    }
    this.resources.length = 0;
    this.textureRecords.clear();
    this.canvas.remove();
    this.container.classList.remove('is-dragging');
    this.container = null;
    this.options.onActiveChange = () => {};
    this.options.onSelect = () => {};
    this.options.onContextLost = () => {};
  }
}

export function initCircularGallery(container, items, options = {}) {
  return new CircularGalleryRenderer(container, { ...options, items, bend: 0 });
}
