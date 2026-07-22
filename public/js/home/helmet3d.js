/**
 * Página de Inicio — Three.js Interactive Helmet
 * Loads external GLB model with idle rotation and pointer interaction.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ── Constants ──
const HELMET_MODEL_URL = 'https://storage.googleapis.com/ninjalab3d/casco.glb';
const IDLE_ROTATION_SPEED = 0.25;
const INTERACTION_DAMPING = 0.92;
const MAX_PIXEL_RATIO = 2;
const TARGET_MODEL_SIZE = 0.1;

/**
 * Initialize Three.js scene with the helmet model.
 * @param {HTMLCanvasElement} canvas — target canvas element
 * @param {boolean} prefersReduced — whether user prefers reduced motion
 */
export async function initHelmet3D(canvas, prefersReduced = false) {
  if (!canvas) return;

  const stage = canvas.parentElement;
  if (!stage) return;

  // ── Scene setup ──
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);

  if (renderer.outputColorSpace !== undefined) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  if (renderer.toneMapping !== undefined) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  // ── Lighting ──
  const keyLight = new THREE.DirectionalLight(0xfafafa, 2.2);
  keyLight.position.set(3, 2, 3);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xcccccc, 0.8);
  fillLight.position.set(-1, 0.3, 2.5);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0x7cf03d, 1.4);
  rimLight.position.set(-2.5, 1, -2);
  scene.add(rimLight);

  const ambient = new THREE.AmbientLight(0x444444, 0.7);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xddeeff, 0x222222, 0.4);
  scene.add(hemi);

  // ── Model loading ──
  const loaderEl = document.querySelector('[data-helmet-loader]');
  const fallbackEl = document.querySelector('[data-helmet-fallback]');
  const loaderText = loaderEl && loaderEl.querySelector('.hero-loader-text');

  const loader = new GLTFLoader();
  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  let modelLoaded = false;

  try {
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        HELMET_MODEL_URL,
        (result) => resolve(result),
        (event) => {
          if (!event.total || !loaderText) return;
          const pct = Math.round((event.loaded / event.total) * 100);
          loaderText.textContent = 'Cargando modelo 3D\u2026 ' + pct + '%';
        },
        (err) => reject(err)
      );
    });

    const model = gltf.scene;

    // ── Traverse materials ──
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
      if (child.material) {
        child.material.needsUpdate = true;
      }
    });

    // ── Auto-frame: bounding-box centering + scaling ──
    const initialBox = new THREE.Box3().setFromObject(model);
    const initialCenter = initialBox.getCenter(new THREE.Vector3());
    const initialSize = initialBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(initialSize.x, initialSize.y, initialSize.z);

    if (!Number.isFinite(maxDim) || maxDim <= 0) {
      throw new Error('El modelo GLB no tiene dimensiones válidas.');
    }

    model.position.sub(initialCenter);

    const scale = TARGET_MODEL_SIZE / maxDim;
    model.scale.setScalar(scale);

    modelGroup.add(model);

    // ── Fit camera from final bounding box ──
    const finalBox = new THREE.Box3().setFromObject(modelGroup);
    const finalSize = finalBox.getSize(new THREE.Vector3());
    const fittedDim = Math.max(finalSize.x, finalSize.y);

    const fovRadians = THREE.MathUtils.degToRad(camera.fov);
    const cameraDistance = fittedDim / (2 * Math.tan(fovRadians / 2));

    camera.position.set(0, 0.1, cameraDistance * 1.3);
    camera.lookAt(0, 0, 0);

    modelLoaded = true;

    // Dispatch custom event
    canvas.dispatchEvent(new CustomEvent('helmet-loaded', { bubbles: true }));
  } catch (err) {
    // Show fallback, hide loader
    if (loaderEl) loaderEl.style.display = 'none';
    if (fallbackEl) fallbackEl.hidden = false;
    if (stage) stage.classList.add('has-fallback');
    console.error('No se pudo cargar el casco 3D.', err);
    throw err;
  }

  // ── Pointer interaction (click-and-drag only, no hover) ──
  let targetRotationX = 0;
  let targetRotationY = 0;
  let currentRotationX = 0;
  let currentRotationY = 0;
  let isDragging = false;
  let activePointerId = null;
  let prevPointerX = 0;
  let prevPointerY = 0;
  let idleResumeAt = 0;

  function onPointerDown(e) {
    if (!modelLoaded) return;
    if (!e.isPrimary) return;
    isDragging = true;
    idleResumeAt = 0;
    activePointerId = e.pointerId;
    prevPointerX = e.clientX;
    prevPointerY = e.clientY;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
  }

  function onPointerMove(e) {
    if (!modelLoaded || !isDragging) return;
    if (e.pointerId !== activePointerId) return;

    const dx = e.clientX - prevPointerX;
    const dy = e.clientY - prevPointerY;

    targetRotationY += dx * 0.008;
    targetRotationX += dy * 0.004;
    targetRotationX = THREE.MathUtils.clamp(targetRotationX, -0.8, 0.8);

    prevPointerX = e.clientX;
    prevPointerY = e.clientY;
  }

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    stage.classList.remove('is-dragging');
    idleResumeAt = performance.now() + 1800;

    if (activePointerId !== null && stage.hasPointerCapture(activePointerId)) {
      stage.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
  }

  function onPointerUp(e) {
    if (e.pointerId !== activePointerId) return;
    endDrag();
  }

  function onLostPointerCapture() {
    endDrag();
  }

  // Bind events on stage for pointer capture
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('lostpointercapture', onLostPointerCapture);

  // ── Resize ──
  function onResize() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // Defer to ensure DOM layout is settled
  requestAnimationFrame(() => {
    onResize();
  });

  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(canvas.parentElement);

  // ── Visibility pause ──
  let isVisible = true;
  document.addEventListener('visibilitychange', () => {
    isVisible = !document.hidden;
  });

  // ── Render loop ──
  let lastTime = performance.now();
  const idleSpeed = prefersReduced ? 0.05 : IDLE_ROTATION_SPEED;

  function animate(now) {
    requestAnimationFrame(animate);

    if (!isVisible || !modelLoaded) {
      if (isVisible) renderer.render(scene, camera);
      return;
    }

    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Idle rotation: resume after delay if not dragging and not reduced-motion
    if (!isDragging && !prefersReduced) {
      if (idleResumeAt > 0 && now >= idleResumeAt) {
        idleResumeAt = 0;
      }
      if (idleResumeAt === 0) {
        targetRotationY += idleSpeed * dt;
      }
    }

    currentRotationY += (targetRotationY - currentRotationY) * (1 - INTERACTION_DAMPING);
    currentRotationX += (targetRotationX - currentRotationX) * (1 - INTERACTION_DAMPING);

    modelGroup.rotation.y = currentRotationY;
    modelGroup.rotation.x = currentRotationX;

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);

  // ── Cleanup ──
  canvas._helmetCleanup = () => {
    resizeObserver.disconnect();
    scene.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    renderer.dispose();
  };
}
