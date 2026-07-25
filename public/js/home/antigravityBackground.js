/**
 * Lightweight panel-two antigravity field.
 * Projects shared tetrahedron vertices onto one 2D canvas to avoid another
 * WebGL context and per-particle geometry/material allocations.
 */
const instances = new WeakMap();
const TAU = Math.PI * 2;
const VERTICES = Object.freeze([
  [1, 1, 1],
  [-1, -1, 1],
  [-1, 1, -1],
  [1, -1, -1],
]);
const EDGES = Object.freeze([
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
]);

function inactiveController() {
  return Object.freeze({
    pause() {},
    resume() {},
    destroy() {},
    isActive: () => false,
  });
}

function seeded(index, offset = 0) {
  const value = Math.sin((index + 1) * 9283.31 + offset * 77.17) * 43758.5453;
  return value - Math.floor(value);
}

function rotateVertex([x, y, z], rx, ry, rz) {
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const y1 = y * cosX - z * sinX;
  const z1 = y * sinX + z * cosX;
  const x2 = x * cosY + z1 * sinY;
  const z2 = -x * sinY + z1 * cosY;
  return [
    x2 * cosZ - y1 * sinZ,
    x2 * sinZ + y1 * cosZ,
    z2,
  ];
}

export function initAntigravityBackground(canvas, options = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) return inactiveController();
  if (instances.has(canvas)) return instances.get(canvas);

  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return inactiveController();

  const reducedMotion = options.reducedMotion
    ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const compact = window.matchMedia('(max-width: 768px)').matches;
  const particleCount = compact ? 12 : 26;
  const particles = Array.from({ length: particleCount }, (_, index) => ({
    x: seeded(index, 1),
    y: seeded(index, 2),
    depth: 0.25 + seeded(index, 3) * 0.75,
    size: 0.55 + seeded(index, 4) * 0.5,
    rx: seeded(index, 5) * TAU,
    ry: seeded(index, 6) * TAU,
    rz: seeded(index, 7) * TAU,
    drift: 0.012 + seeded(index, 8) * 0.022,
    spin: (seeded(index, 9) - 0.5) * 0.35,
    sway: seeded(index, 10) * TAU,
  }));

  let width = 1;
  let height = 1;
  let rafId = null;
  let lastTime = 0;
  let elapsed = 0;
  let active = false;
  let destroyed = false;
  let resizeObserver = null;
  let intersectionObserver = null;
  let sectionVisible = !('IntersectionObserver' in window);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, compact ? 1 : 1.5);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function drawTetrahedron(particle) {
    const depthScale = 0.55 + particle.depth * 0.7;
    const radius = (compact ? 13 : 18) * particle.size * depthScale;
    const centerX = particle.x * width
      + Math.sin(elapsed * 0.35 + particle.sway) * (compact ? 8 : 18);
    const centerY = particle.y * height;
    const points = VERTICES.map((vertex) => {
      const [x, y, z] = rotateVertex(vertex, particle.rx, particle.ry, particle.rz);
      const perspective = 1 / (1.35 - z * 0.16);
      return [centerX + x * radius * perspective, centerY + y * radius * perspective];
    });

    context.beginPath();
    EDGES.forEach(([from, to]) => {
      context.moveTo(points[from][0], points[from][1]);
      context.lineTo(points[to][0], points[to][1]);
    });
    context.strokeStyle = `rgba(39, 255, 90, ${0.12 + particle.depth * 0.24})`;
    context.lineWidth = 0.65 + particle.depth * 0.8;
    context.stroke();

    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    context.lineTo(points[1][0], points[1][1]);
    context.lineTo(points[2][0], points[2][1]);
    context.closePath();
    context.fillStyle = `rgba(39, 255, 90, ${0.012 + particle.depth * 0.026})`;
    context.fill();
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    particles.forEach(drawTetrahedron);
  }

  function schedule() {
    if (
      destroyed || !active || !sectionVisible || reducedMotion
      || document.hidden || rafId !== null
    ) return;
    rafId = window.requestAnimationFrame(frame);
  }

  function frame(time) {
    rafId = null;
    if (destroyed || !active || !sectionVisible || document.hidden) return;
    const delta = Math.min((time - (lastTime || time)) / 1000, 1 / 30);
    lastTime = time;
    elapsed += delta;
    particles.forEach((particle) => {
      particle.y -= particle.drift * delta;
      if (particle.y < -0.08) particle.y = 1.08;
      particle.rx += particle.spin * delta;
      particle.ry += particle.spin * 0.72 * delta;
      particle.rz -= particle.spin * 0.38 * delta;
    });
    draw();
    schedule();
  }

  function pause() {
    if (destroyed || !active) return;
    active = false;
    canvas.classList.add('is-paused');
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    rafId = null;
  }

  function resume() {
    if (destroyed || reducedMotion || active) return;
    active = true;
    canvas.classList.remove('is-paused');
    lastTime = performance.now();
    schedule();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = null;
    } else {
      lastTime = performance.now();
      schedule();
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    active = false;
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    rafId = null;
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    context.clearRect(0, 0, width, height);
    if (instances.get(canvas) === controller) instances.delete(canvas);
  }

  const controller = Object.freeze({
    pause,
    resume,
    destroy,
    isActive: () => active && sectionVisible && !destroyed,
  });
  instances.set(canvas, controller);

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener('resize', resize, { passive: true });
  }
  if ('IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver(([entry]) => {
      sectionVisible = Boolean(entry?.isIntersecting);
      if (!sectionVisible && rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      } else {
        lastTime = performance.now();
        schedule();
      }
    }, { rootMargin: '12% 0px 12% 0px', threshold: 0 });
    intersectionObserver.observe(canvas.closest('[data-panel="2"]') || canvas);
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  resize();
  canvas.classList.add('is-paused');

  return controller;
}
