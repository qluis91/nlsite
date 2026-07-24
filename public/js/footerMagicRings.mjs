/**
 * NinjaLabCR Footer — Magic Rings WebGL2 Background
 *
 * Decorative expanding rings behind the footer panel.
 * Vanilla WebGL 2, no framework dependency.
 *
 * Lifecycle: init → loop (paused off-screen/hidden) → destroy
 */

// ── Constants ──
const MAX_DPR = 2;
const RING_COUNT = 5;
const SPEED = 0.45;
const ATTENUATION = 11;
const LINE_THICKNESS = 1.4;
const OPACITY = 0.38;
const NOISE_AMPLITUDE = 0.02;
const PARALLAX_FACTOR = 0.015;

// ── Vertex shader (fullscreen quad) ──
const VERTEX_SRC = `#version 300 es
precision highp float;
const vec2 positions[4] = vec2[](
  vec2(-1, -1), vec2(1, -1), vec2(-1, 1), vec2(1, 1)
);
out vec2 vUv;
void main() {
  vUv = positions[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}`;

// ── Fragment shader ──
const FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform int uRingCount;
uniform float uSpeed;
uniform float uAttenuation;
uniform float uLineThickness;
uniform float uOpacity;
uniform float uNoise;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 center = vec2(0.5) + uPointer * 0.015;

  vec3 color1 = vec3(0.49, 0.94, 0.24); // ninja green
  vec3 color2 = vec3(0.12, 0.20, 0.09); // dark green

  vec3 result = vec3(0.0);

  for (int i = 0; i < 5; i++) {
    if (i >= uRingCount) break;

    float fi = float(i);
    float phase = fi * 1.3 + hash(vec2(fi, 0.0)) * 6.28;
    float speed = uSpeed * (0.75 + hash(vec2(fi, 1.0)) * 0.5);
    float radius = fract(phase + uTime * speed);
    float dist = length(uv - center);

    float ringDist = abs(dist - radius * 0.75);
    float lineWidth = 1.0 / (uResolution.y * uLineThickness * (0.6 + fi * 0.1));
    float ring = exp(-ringDist * ringDist / (2.0 * lineWidth * lineWidth));

    float attenuation = exp(-radius * uAttenuation * (0.8 + fi * 0.15));
    ring *= attenuation;

    float t = fract(sin(fi * 3.7 + uTime * 0.2) * 0.5 + 0.5);
    vec3 ringColor = mix(color2, color1, t);

    float n = (hash(uv * 1.5 + fi * 0.73 + uTime * 0.08) - 0.5) * uNoise;
    result += ringColor * ring * uOpacity * (0.75 + 0.25 * n);
  }

  fragColor = vec4(result, 1.0);
}`;

// ── Helpers ──
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || 'Shader compilation failed');
  }
  return shader;
}

function linkProgram(gl, vert, frag) {
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || 'Program link failed');
  }
  return program;
}

export class FooterMagicRings {
  constructor(canvas) {
    if (!canvas) throw new Error('FooterMagicRings requires a canvas.');
    this.canvas = canvas;
    this.gl = null;
    this.program = null;
    this.vao = null;
    this.uniforms = {};
    this.rafId = null;
    this.startTime = 0;
    this.pointer = [0, 0];
    this.destroyed = false;
    this.paused = false;
    this.resizeObserver = null;
    this.intersectionObserver = null;

    try {
      this._init();
    } catch (e) {
      this._fail(canvas, e);
      return;
    }

    this._observe();
    this.startTime = performance.now();
    this._schedule();
  }

  _init() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL 2 not available');
    this.gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    this.program = linkProgram(gl, vs, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    this.vao = vao;

    this.uniforms.time = gl.getUniformLocation(this.program, 'uTime');
    this.uniforms.resolution = gl.getUniformLocation(this.program, 'uResolution');
    this.uniforms.pointer = gl.getUniformLocation(this.program, 'uPointer');
    this.uniforms.ringCount = gl.getUniformLocation(this.program, 'uRingCount');
    this.uniforms.speed = gl.getUniformLocation(this.program, 'uSpeed');
    this.uniforms.attenuation = gl.getUniformLocation(this.program, 'uAttenuation');
    this.uniforms.lineThickness = gl.getUniformLocation(this.program, 'uLineThickness');
    this.uniforms.opacity = gl.getUniformLocation(this.program, 'uOpacity');
    this.uniforms.noise = gl.getUniformLocation(this.program, 'uNoise');

    gl.useProgram(this.program);
    gl.uniform1i(this.uniforms.ringCount, RING_COUNT);
    gl.uniform1f(this.uniforms.speed, SPEED);
    gl.uniform1f(this.uniforms.attenuation, ATTENUATION);
    gl.uniform1f(this.uniforms.lineThickness, LINE_THICKNESS);
    gl.uniform1f(this.uniforms.opacity, OPACITY);
    gl.uniform1f(this.uniforms.noise, NOISE_AMPLITUDE);

    this._resize();
  }

  _observe() {
    const footer = this.canvas.closest('[data-nl-footer]');

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(footer || document.documentElement);

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting;
        if (visible) {
          this._resume();
        } else {
          this._pause();
        }
      },
      { threshold: 0.05 }
    );
    this.intersectionObserver.observe(this.canvas);

    this._onPointer = (e) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        const rect = this.canvas.getBoundingClientRect();
        this.pointer[0] = (e.clientX - rect.left) / rect.width - 0.5;
        this.pointer[1] = (e.clientY - rect.top) / rect.height - 0.5;
      }
    };
    this._onVisibilityChange = () => {
      if (document.hidden) this._pause();
      else this._resume();
    };

    document.addEventListener('pointermove', this._onPointer, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _resize() {
    if (this.destroyed || !this.gl || !this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
    if (this.program) {
      this.gl.useProgram(this.program);
      this.gl.uniform2f(this.uniforms.resolution, w, h);
    }
  }

  _render(now) {
    if (this.destroyed || this.paused || !this.gl || !this.program) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.uniforms.time, (now - this.startTime) * 0.001);
    gl.uniform2f(this.uniforms.pointer, this.pointer[0], this.pointer[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this._schedule();
  }

  _schedule() {
    if (this.destroyed || this.paused || this.rafId !== null) return;
    this.rafId = requestAnimationFrame((t) => this._render(t));
  }

  _pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  _resume() {
    if (!this.paused) return;
    this.paused = false;
    this.startTime = performance.now();
    this._schedule();
  }

  _fail(canvas, error) {
    if (canvas) canvas.style.display = 'none';
    if (process.env.NODE_ENV === 'development') {
      console.warn('[FooterMagicRings] Initialization failed:', error?.message || error);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.paused = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    document.removeEventListener('pointermove', this._onPointer);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);

    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
    if (this.gl && this.vao) {
      const ext = this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      this.vao = null;
    }
    this.gl = null;
    this.canvas = null;
    this.uniforms = {};
  }
}

// ── Auto-init ──
const initialized = new WeakSet();

export function initFooterMagicRings() {
  const canvas = document.querySelector('[data-nl-footer-canvas]');
  if (!canvas || initialized.has(canvas)) return null;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return null;

  try {
    const rings = new FooterMagicRings(canvas);
    initialized.add(canvas);
    return rings;
  } catch (e) {
    // CSS fallback handles visual
    return null;
  }
}

// ── Self-init on load ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFooterMagicRings);
} else {
  initFooterMagicRings();
}
