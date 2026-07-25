/**
 * Panel-two Antigravity field — Three.js InstancedMesh tetrahedrons.
 *
 * Reimplements React Bits Antigravity visual behavior using the project's
 * existing Three.js dependency.  No React, no React Three Fiber.
 *
 * Behaviour:
 *  - 180–300 tetrahedron particles (fewer on mobile)
 *  - Independent suspended drift across the panel
 *  - Soft cursor repulsion (particles move away, never form a ring)
 *  - Smooth return to suspended targets after the cursor passes
 *  - Depth projection and pulsating scale
 *  - Pause / resume / destroy lifecycle
 *  - Visibility‑aware (IntersectionObserver + page‑hidden)
 *  - Reduced‑motion shortcut
 *  - Single shared geometry + material + InstancedMesh
 */

import * as THREE from 'three';
import { composeParticleTarget, computeRepulsion } from './antigravityForces.mjs';

const instances = new WeakMap();

function inactiveController() {
  return Object.freeze({
    pause() {}, resume() {}, destroy() {}, isActive: () => false,
  });
}

/* ── seeded random ── */
function seeded(index, offset = 0) {
  const v = Math.sin((index + 1) * 9283.31 + offset * 77.17) * 43758.5453;
  return v - Math.floor(v);
}

/* ── lerp ── */
function lerp(a, b, t) { return a + (b - a) * t; }

export function initAntigravityBackground(canvas, options = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) return inactiveController();
  if (instances.has(canvas)) return instances.get(canvas);

  const reducedMotion = options.reducedMotion
    ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const compact = window.matchMedia('(max-width: 768px)').matches;
  const tablet = window.matchMedia('(max-width: 1024px)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const panel = canvas.closest('[data-panel="2"]') || canvas;

  /* ── particle count ── */
  const count = compact ? 60 : tablet ? 120 : 180;
  const dprCap = compact ? 1 : 1.5;

  /* ── renderer ── */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch {
    return inactiveController();
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 200);
  camera.position.z = 60;

  /* ── shared geometry & material ── */
  const geometry = new THREE.TetrahedronGeometry(0.42, 0);
  const material = new THREE.MeshBasicMaterial({
    color: 0x27ff5a,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const dummy = new THREE.Object3D();

  /* ── particle state ── */
  const colorGreen = new THREE.Color(0x27ff5a);
  const particles = Array.from({ length: count }, (_, i) => ({
    normalizedX: seeded(i, 0),
    normalizedY: seeded(i, 1),
    homeX: 0,
    homeY: 0,
    homeZ: (seeded(i, 2) - 0.5) * 8,
    cx: 0,
    cy: 0,
    cz: (seeded(i, 2) - 0.5) * 8,
    rx: seeded(i, 3) * Math.PI * 2,
    ry: seeded(i, 4) * Math.PI * 2,
    rz: seeded(i, 5) * Math.PI * 2,
    spinX: (seeded(i, 6) - 0.5) * 0.8,
    spinY: (seeded(i, 7) - 0.5) * 0.8,
    spinZ: (seeded(i, 8) - 0.5) * 0.5,
    scale: 0.34 + seeded(i, 9) * 0.18,
    pulsePhase: seeded(i, 10) * Math.PI * 2,
    driftAngle: seeded(i, 12) * Math.PI * 2,
    driftSpeed: 0.15 + seeded(i, 13) * 0.35,
    driftRadius: 0.18 + seeded(i, 14) * 0.55,
  }));

  /* ── pointer state ── */
  let pointerActive = false;
  const pointer = { x: 0, y: 0 };
  const rawPointer = { x: 0, y: 0 };
  let panelRect = null;
  let visibleWorldWidth = 1;
  let visibleWorldHeight = 1;
  let positionsInitialized = false;

  const POINTER_LERP = 0.18;
  const RETURN_LERP = 0.08;
  const REPEL_RADIUS = 7.5;
  const REPEL_FORCE = 4.2;
  const MAX_REPEL = 3.6;
  const MAX_Z_OFFSET = 1.8;
  const PULSE_SPEED = 3;

  /* ── lifecycle ── */
  let width = 1;
  let height = 1;
  let rafId = null;
  let paused = true;
  let destroyed = false;
  let resizeObserver = null;
  let intersectionObserver = null;
  let sectionVisible = !('IntersectionObserver' in window);

  /* ── pointer listeners bound state ── */
  let pointersBound = false;
  const unprojectedPointer = new THREE.Vector3();
  const pointerRay = new THREE.Vector3();

  function bindPointerListeners() {
    if (pointersBound || coarsePointer) return;
    pointersBound = true;
    panel.addEventListener('pointermove', onPointerMove, { passive: true });
    panel.addEventListener('pointerleave', onPointerLeave);
  }

  function unbindPointerListeners() {
    if (!pointersBound) return;
    pointersBound = false;
    panel.removeEventListener('pointermove', onPointerMove);
    panel.removeEventListener('pointerleave', onPointerLeave);
  }

  /* ── resize ── */
  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.round(rect.width);
    height = Math.round(rect.height);
    panelRect = rect;
    if (width <= 0 || height <= 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    visibleWorldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
      * camera.position.z;
    visibleWorldWidth = visibleWorldHeight * camera.aspect;
    particles.forEach((particle) => {
      particle.homeX = (particle.normalizedX - 0.5) * visibleWorldWidth * 0.92;
      particle.homeY = (particle.normalizedY - 0.5) * visibleWorldHeight * 0.92;
      if (!positionsInitialized) {
        particle.cx = particle.homeX;
        particle.cy = particle.homeY;
        particle.cz = particle.homeZ;
      }
    });
    positionsInitialized = true;
  }

  /* ── pointer tracking ── */
  function onPointerMove(e) {
    panelRect = panel.getBoundingClientRect();
    if (
      e.clientX < panelRect.left || e.clientX > panelRect.right
      || e.clientY < panelRect.top || e.clientY > panelRect.bottom
    ) {
      pointerActive = false;
      return;
    }
    const ndcX = ((e.clientX - panelRect.left) / panelRect.width) * 2 - 1;
    const ndcY = -(((e.clientY - panelRect.top) / panelRect.height) * 2 - 1);
    unprojectedPointer.set(ndcX, ndcY, 0.5).unproject(camera);
    pointerRay.copy(unprojectedPointer).sub(camera.position).normalize();
    const distanceToPlane = -camera.position.z / pointerRay.z;
    rawPointer.x = camera.position.x + pointerRay.x * distanceToPlane;
    rawPointer.y = camera.position.y + pointerRay.y * distanceToPlane;
    pointerActive = true;
  }

  function onPointerLeave() {
    pointerActive = false;
  }

  /* ── schedule ── */
  function schedule() {
    if (
      destroyed || reducedMotion || document.hidden || !sectionVisible
      || rafId !== null
    ) return;
    if (paused) return;
    rafId = requestAnimationFrame(frame);
  }

  let lastTime = 0;
  let elapsed = 0;

  function frame(now) {
    rafId = null;
    if (destroyed || paused || document.hidden) return;

    const dt = Math.min((now - lastTime || 0) / 1000, 1 / 30);
    lastTime = now;
    elapsed += dt;

    /* ── pointer interpolation ── */
    if (pointerActive) {
      pointer.x = lerp(pointer.x, rawPointer.x, POINTER_LERP);
      pointer.y = lerp(pointer.y, rawPointer.y, POINTER_LERP);
    }

    /* ── particle update ── */
    for (let i = 0; i < count; i += 1) {
      const p = particles[i];

      // Suspended base target: home + individual drift (always active)
      const driftAngle = p.driftAngle + elapsed * p.driftSpeed;
      const suspendedPreview = composeParticleTarget(
        p.homeX, p.homeY, p.homeZ, driftAngle, p.driftRadius, null,
      );

      // Soft repulsion offset — only while pointer is actively over Panel 2
      const repel = pointerActive
        ? computeRepulsion(
          suspendedPreview.suspendedX - pointer.x,
          suspendedPreview.suspendedY - pointer.y,
          {
            repelRadius: REPEL_RADIUS,
            repelForce: REPEL_FORCE,
            maxRepel: MAX_REPEL,
            maxZOffset: MAX_Z_OFFSET,
          },
        )
        : { x: 0, y: 0, z: 0 };

      const { targetX, targetY, targetZ } = composeParticleTarget(
        p.homeX, p.homeY, p.homeZ, driftAngle, p.driftRadius, repel,
      );

      p.cx = lerp(p.cx, targetX, RETURN_LERP);
      p.cy = lerp(p.cy, targetY, RETURN_LERP);
      p.cz = lerp(p.cz, targetZ, RETURN_LERP);

      /* rotation */
      p.rx += p.spinX * dt;
      p.ry += p.spinY * dt;
      p.rz += p.spinZ * dt;

      /* pulse scale */
      const pulse = 1 + Math.sin(elapsed * PULSE_SPEED + p.pulsePhase) * 0.07;
      const currentScale = Math.min(0.56, p.scale * pulse);

      dummy.position.set(p.cx, p.cy, p.cz);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.setScalar(currentScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      /* color depth */
      const depthNorm = (p.cz + 6) / 12;
      mesh.setColorAt(i, colorGreen.clone().multiplyScalar(0.7 + depthNorm * 0.5));
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    renderer.render(scene, camera);
    schedule();
  }

  /* ── controller ── */
  function pause() {
    if (destroyed || paused) return;
    paused = true;
    pointerActive = false;
    canvas.classList.add('is-paused');
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    unbindPointerListeners();
  }

  // Idempotent resume: always restarts a dead RAF.
  // Only hard-blocked by destroyed or reducedMotion.
  function resume() {
    if (destroyed || reducedMotion) return;

    const wasPaused = paused;
    paused = false;
    canvas.classList.remove('is-paused');
    lastTime = performance.now();

    if (wasPaused) {
      bindPointerListeners();
    }

    // Cancel any stale RAF and request a fresh one
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    schedule();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    } else {
      lastTime = performance.now();
      schedule();
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    paused = true;
    pointerActive = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    unbindPointerListeners();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    geometry.dispose();
    material.dispose();
    mesh.dispose();
    renderer.dispose();
    if (instances.get(canvas) === controller) instances.delete(canvas);
  }

  const controller = Object.freeze({
    pause, resume, destroy,
    isActive: () => !paused && !destroyed,
  });
  instances.set(canvas, controller);

  /* ── observers ── */
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(panel);
  } else {
    window.addEventListener('resize', resize, { passive: true });
  }

  if ('IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver(([entry]) => {
      sectionVisible = Boolean(entry?.isIntersecting);
      if (!sectionVisible && rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      } else if (sectionVisible && !paused) {
        lastTime = performance.now();
        schedule();
      }
    }, { rootMargin: '12% 0px 12% 0px', threshold: 0 });
    intersectionObserver.observe(panel);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  resize();
  canvas.classList.add('is-paused');

  return controller;
}
