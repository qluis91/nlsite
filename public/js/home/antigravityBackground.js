/**
 * Panel-two Antigravity field — Three.js InstancedMesh tetrahedrons.
 *
 * Reimplements React Bits Antigravity visual behavior using the project's
 * existing Three.js dependency.  No React, no React Three Fiber.
 *
 * Behaviour:
 *  - 180–300 tetrahedron particles (fewer on mobile)
 *  - Ring formation around an interpolated virtual pointer
 *  - Wave variation around the ring
 *  - Depth projection and pulsating scale
 *  - Auto-animation after pointer inactivity (~2 s)
 *  - Pause / resume / destroy lifecycle
 *  - Visibility‑aware (IntersectionObserver + page‑hidden)
 *  - Reduced‑motion shortcut
 *  - Single shared geometry + material + InstancedMesh
 *  - pointer‑events: none on the canvas (pointer coords via window)
 */

import * as THREE from 'three';

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
  const geometry = new THREE.TetrahedronGeometry(1, 0);
  const material = new THREE.MeshBasicMaterial({
    color: 0x27ff5a,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const dummy = new THREE.Object3D();

  /* ── particle state ── */
  const colorGreen = new THREE.Color(0x27ff5a);
  const particles = Array.from({ length: count }, (_, i) => {
    const angle = seeded(i, 0) * Math.PI * 2;
    const ringRadius = 4.5 + seeded(i, 1) * 3;
    const px = Math.cos(angle) * ringRadius;
    const py = Math.sin(angle) * ringRadius * 0.5;
    const pz = (seeded(i, 2) - 0.5) * 12;
    return {
      homeX: px, homeY: py, homeZ: pz,
      tx: px, ty: py, tz: pz,
      rx: seeded(i, 3) * Math.PI * 2, ry: seeded(i, 4) * Math.PI * 2, rz: seeded(i, 5) * Math.PI * 2,
      spinX: (seeded(i, 6) - 0.5) * 0.8,
      spinY: (seeded(i, 7) - 0.5) * 0.8,
      spinZ: (seeded(i, 8) - 0.5) * 0.5,
      scale: 0.65 + seeded(i, 9) * 0.4,
      pulsePhase: seeded(i, 10) * Math.PI * 2,
      waveOffset: seeded(i, 11) * Math.PI * 2,
    };
  });

  /* ── pointer state ── */
  let pointerActive = false;
  let pointerLastMove = 0;
  const AUTO_ANIMATE_DELAY = 2000;
  let autoAngle = 0;
  const pointer = { x: 0, y: 0 };    // current (lerped)
  const rawPointer = { x: 0, y: 0 }; // raw mouse
  let panelRect = null;
  const LERP_SPEED = 0.04;
  const MAGNET_RADIUS = 5.5;
  const RING_RADIUS = 6.5;
  const FIELD_STRENGTH = 8;
  const WAVE_SPEED = 0.4;
  const WAVE_AMPLITUDE = 0.9;
  const DEPTH_FACTOR = 1;
  const PULSE_SPEED = 3;

  /* ── lifecycle ── */
  let width = 1, height = 1;
  let rafId = null;
  let active = false;
  let destroyed = false;
  let resizeObserver = null;
  let intersectionObserver = null;
  let sectionVisible = false;

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
  }

  /* ── pointer tracking ── */
  function onPointerMove(e) {
    if (!panelRect) return;
    rawPointer.x = ((e.clientX - panelRect.left) / panelRect.width) * 2 - 1;
    rawPointer.y = -((e.clientY - panelRect.top) / panelRect.height) * 2 + 1;
    pointerLastMove = performance.now();
    pointerActive = true;
  }

  function onPointerLeave() {
    pointerActive = false;
  }

  /* ── frame ── */
  function schedule() {
    if (destroyed || !active || !sectionVisible || reducedMotion
      || document.hidden || rafId !== null) return;
    rafId = requestAnimationFrame(frame);
  }

  let lastTime = 0;
  let elapsed = 0;

  function frame(now) {
    rafId = null;
    if (destroyed || !active || !sectionVisible || document.hidden) return;

    const dt = Math.min((now - lastTime || 0) / 1000, 1 / 30);
    lastTime = now;
    elapsed += dt;

    /* ── pointer interpolation ── */
    if (pointerActive) {
      pointer.x = lerp(pointer.x, rawPointer.x, LERP_SPEED);
      pointer.y = lerp(pointer.y, rawPointer.y, LERP_SPEED);
    }

    /* ── auto-animation ── */
    const timeSinceMove = now - pointerLastMove;
    if (timeSinceMove > AUTO_ANIMATE_DELAY) {
      autoAngle += dt * 0.3;
      pointer.x = lerp(pointer.x, Math.cos(autoAngle * 0.7) * 0.35, LERP_SPEED * 0.5);
      pointer.y = lerp(pointer.y, Math.sin(autoAngle * 0.5) * 0.25, LERP_SPEED * 0.5);
      pointerActive = false;
    }

    /* ── particle update ── */
    const magnetX = pointer.x * (width / Math.max(height, 1)) * FIELD_STRENGTH;
    const magnetY = pointer.y * FIELD_STRENGTH;
    const distToMagnet = Math.sqrt(magnetX * magnetX + magnetY * magnetY);

    for (let i = 0; i < count; i += 1) {
      const p = particles[i];
      const angle = Math.atan2(p.ty - magnetY, p.tx - magnetX);
      const dist = Math.sqrt(
        (p.tx - magnetX) ** 2 + (p.ty - magnetY) ** 2 + (p.tz - 0) ** 2 * 0.5,
      );

      const ringR = RING_RADIUS + Math.sin(elapsed * WAVE_SPEED + p.waveOffset) * WAVE_AMPLITUDE;
      if (dist < MAGNET_RADIUS + ringR && distToMagnet < MAGNET_RADIUS + ringR) {
        const targetX = magnetX + Math.cos(angle) * ringR;
        const targetY = magnetY + Math.sin(angle) * ringR * 0.6;
        const targetZ = (Math.sin(angle * 2 + elapsed * 0.5)) * DEPTH_FACTOR * 3;
        p.tx = lerp(p.tx, targetX, LERP_SPEED * 1.2);
        p.ty = lerp(p.ty, targetY, LERP_SPEED * 1.2);
        p.tz = lerp(p.tz, targetZ, LERP_SPEED * 1.2);
      } else {
        p.tx = lerp(p.tx, p.homeX, LERP_SPEED * 0.4);
        p.ty = lerp(p.ty, p.homeY, LERP_SPEED * 0.4);
        p.tz = lerp(p.tz, p.homeZ, LERP_SPEED * 0.4);
      }

      /* rotation */
      p.rx += p.spinX * dt;
      p.ry += p.spinY * dt;
      p.rz += p.spinZ * dt;

      /* pulse scale */
      const pulse = 1 + Math.sin(elapsed * PULSE_SPEED + p.pulsePhase) * 0.12;
      const currentScale = p.scale * pulse;

      dummy.position.set(p.tx, p.ty, p.tz);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.setScalar(currentScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      /* color depth */
      const depthNorm = (p.tz + 6) / 12;
      const alpha = 0.28 + depthNorm * 0.44;
      mesh.setColorAt(i, colorGreen.clone().multiplyScalar(0.7 + depthNorm * 0.5));
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    renderer.render(scene, camera);
    schedule();
  }

  /* ── controller ── */
  function pause() {
    if (destroyed || !active) return;
    active = false;
    canvas.classList.add('is-paused');
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerleave', onPointerLeave);
  }

  function resume() {
    if (destroyed || reducedMotion || active) return;
    active = true;
    canvas.classList.remove('is-paused');
    lastTime = performance.now();
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
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
    active = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerleave', onPointerLeave);
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
    isActive: () => active && sectionVisible && !destroyed,
  });
  instances.set(canvas, controller);

  /* ── observers ── */
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.closest('[data-panel="2"]') || canvas);
  } else {
    window.addEventListener('resize', resize, { passive: true });
  }

  if ('IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver(([entry]) => {
      sectionVisible = Boolean(entry?.isIntersecting);
      if (!sectionVisible && rafId !== null) {
        cancelAnimationFrame(rafId);
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
