/**
 * Página de Inicio — Three.js Interactive Helmet
 * Loads external GLB model with idle rotation and pointer interaction.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ── Constants ──
const HELMET_MODEL_URL = 'https://storage.googleapis.com/ninjalab3d/casco-optimized.glb';
const IDLE_ROTATION_SPEED = 0.25;
const INTERACTION_DAMPING = 0.92;
const MAX_PIXEL_RATIO = 2;
const TARGET_MODEL_SIZE = 0.1;
const AUTO_ROTATE_START_DELAY_MS = 500;
const TIMING_DEBUG_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FRONT_ROTATION = Object.freeze({
  x: 0,
  y: -2,
  z: 0,
});

let _cmsModelUrl = null;  // Override set from DOM (Phase 11B CMS)
/** Read model configuration from DOM data attributes (Phase 11B CMS).
 *  When data-model-config is present it's parsed JSON; otherwise defaults apply. */
function readModelConfig() {
  const page = document.querySelector('[data-home-page]');
  if (!page) return null;

  // Model URL override
  const cmsUrl = page.dataset.modelUrl;
  if (cmsUrl) _cmsModelUrl = cmsUrl;

  // Model disabled
  if (page.dataset.modelDisabled === '1') return 'disabled';

  let config = {};
  try {
    if (page.dataset.modelConfig) {
      config = JSON.parse(page.dataset.modelConfig);
    }
  } catch { /* stay with defaults */ }

  return {
    scale: Number.isFinite(Number(config.scale)) ? Number(config.scale) : 1,
    position: {
      x: Number.isFinite(Number(config.position?.x)) ? Number(config.position.x) : 0,
      y: Number.isFinite(Number(config.position?.y)) ? Number(config.position.y) : 0,
      z: Number.isFinite(Number(config.position?.z)) ? Number(config.position.z) : 0,
    },
    rotation: {
      x: Number.isFinite(Number(config.rotation?.x)) ? Number(config.rotation.x) : 0,
      y: Number.isFinite(Number(config.rotation?.y)) ? Number(config.rotation.y) : -2,
      z: Number.isFinite(Number(config.rotation?.z)) ? Number(config.rotation.z) : 0,
    },
    autoRotate: config.autoRotate !== false,
    autoRotateSpeed: Number.isFinite(Number(config.autoRotateSpeed)) ? Number(config.autoRotateSpeed) : IDLE_ROTATION_SPEED,
  };
}

let helmetInitPromise = null;

function logTiming(label) {
  if (!TIMING_DEBUG_HOSTS.has(window.location.hostname)) return;
  console.debug(`[helmet3d] ${label}: ${Math.round(performance.now())} ms`);
}

function dispatchHelmetEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function signalHelmetError() {
  const root = document.documentElement;
  if (root.dataset.helmetReady === 'true' || root.dataset.helmetError === 'true') return;
  root.dataset.helmetError = 'true';
  dispatchHelmetEvent('helmet:error', {
    message: 'El casco 3D no está disponible.',
  });
}

function signalHelmetReady() {
  const root = document.documentElement;
  if (root.dataset.helmetReady === 'true') return;
  root.dataset.helmetReady = 'true';
  dispatchHelmetEvent('helmet:ready', { ready: true });
}

/**
 * Initialize Three.js scene with the helmet model.
 * @param {HTMLCanvasElement} canvas — target canvas element
 * @param {boolean} prefersReduced — whether user prefers reduced motion
 */
export function initHelmet3D(canvas, prefersReduced = false) {
  if (helmetInitPromise) return helmetInitPromise;

  logTiming('init requested');
  helmetInitPromise = initializeHelmet3D(canvas, prefersReduced).catch((error) => {
    helmetInitPromise = null;
    throw error;
  });

  return helmetInitPromise;
}

async function initializeHelmet3D(canvas, prefersReduced = false) {
  if (!canvas) {
    signalHelmetError();
    return;
  }

  const stage = canvas.parentElement;
  if (!stage) {
    signalHelmetError();
    return;
  }

  // Read Phase 11B CMS model configuration from DOM
  const modelConfig = readModelConfig();
  if (modelConfig === 'disabled') {
    // Model disabled by CMS — show fallback immediately
    if (stage) stage.classList.add('has-fallback');
    const fallbackEl = document.querySelector('[data-helmet-fallback]');
    if (fallbackEl) fallbackEl.hidden = false;
    return;
  }

  // ── Scene setup ──
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (error) {
    signalHelmetError();
    throw error;
  }
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
  loader.setCrossOrigin('anonymous');
  loader.setMeshoptDecoder(MeshoptDecoder);
  scene.add(modelGroup);

  let modelLoaded = false;
  let presentationStarted = false;
  let autoRotateEnabled = false;
  let autoRotateStartTimer = null;
  let destroyed = false;
  let useAutoRotateSpeed = (modelConfig && modelConfig.autoRotateSpeed) || IDLE_ROTATION_SPEED;
  const initialRot = modelConfig ? modelConfig.rotation : FRONT_ROTATION;
  let targetRotationX = initialRot.x;
  let targetRotationY = initialRot.y;
  let currentRotationX = initialRot.x;
  let currentRotationY = initialRot.y;
  let isDragging = false;
  let activePointerId = null;
  let prevPointerX = 0;
  let prevPointerY = 0;
  let idleResumeAt = 0;

  function disposeSceneResources() {
    scene.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    renderer.dispose();
  }

  function clearAutoRotateStartTimer() {
    if (autoRotateStartTimer === null) return;
    window.clearTimeout(autoRotateStartTimer);
    autoRotateStartTimer = null;
  }

  function resetHelmetToFront() {
    if (!modelLoaded || !modelGroup || destroyed) return;

    isDragging = false;
    autoRotateEnabled = false;
    idleResumeAt = 0;
    stage.classList.remove('is-dragging');

    if (activePointerId !== null && stage.hasPointerCapture(activePointerId)) {
      stage.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    prevPointerX = 0;
    prevPointerY = 0;

    targetRotationX = initialRot.x;
    targetRotationY = initialRot.y;
    currentRotationX = initialRot.x;
    currentRotationY = initialRot.y;
    modelGroup.rotation.set(
      initialRot.x,
      initialRot.y,
      initialRot.z
    );
  }

  function tryStartHelmetPresentation() {
    if (!modelLoaded || presentationStarted || destroyed) return;

    presentationStarted = true;
    clearAutoRotateStartTimer();
    resetHelmetToFront();

    if (prefersReduced) return;
    if (modelConfig && !modelConfig.autoRotate) return;

    autoRotateStartTimer = window.setTimeout(() => {
      autoRotateStartTimer = null;
      if (destroyed || isDragging) return;
      autoRotateEnabled = true;
    }, AUTO_ROTATE_START_DELAY_MS);
  }

  try {
    const gltf = await new Promise((resolve, reject) => {
      logTiming('GLB request started');
      loader.load(
        _cmsModelUrl || HELMET_MODEL_URL,
        (result) => {
          logTiming('GLB loaded/parsed');
          resolve(result);
        },
        (event) => {
          if (!Number.isFinite(event.total) || event.total <= 0) return;
          const loaded = Number.isFinite(event.loaded) ? Math.max(0, event.loaded) : 0;
          const percent = Math.min(100, Math.max(0, (loaded / event.total) * 100));
          const roundedPercent = Math.round(percent);
          if (loaderText) {
            loaderText.textContent = 'Cargando modelo 3D\u2026 ' + roundedPercent + '%';
          }
          dispatchHelmetEvent('helmet:progress', {
            loaded,
            total: event.total,
            percent,
          });
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

    // Apply CMS model configuration (scale, position, rotation)
    if (modelConfig) {
      const cmsScale = modelConfig.scale;
      const cmsPos = modelConfig.position;
      const cmsRot = modelConfig.rotation;
      if (cmsScale && cmsScale !== 1) {
        modelGroup.scale.setScalar(cmsScale);
      }
      modelGroup.position.set(cmsPos.x, cmsPos.y, cmsPos.z);
      modelGroup.rotation.set(cmsRot.x, cmsRot.y, cmsRot.z);
    }

    logTiming('model added to scene');

    // ── Fit camera from final bounding box ──
    const finalBox = new THREE.Box3().setFromObject(modelGroup);
    const finalSize = finalBox.getSize(new THREE.Vector3());
    const fittedDim = Math.max(finalSize.x, finalSize.y);

    const fovRadians = THREE.MathUtils.degToRad(camera.fov);
    const cameraDistance = fittedDim / (2 * Math.tan(fovRadians / 2));

    camera.position.set(0, 0.1, cameraDistance * 1.3);
    camera.lookAt(0, 0, 0);

    modelLoaded = true;
    tryStartHelmetPresentation();
    signalHelmetReady();

    // Dispatch custom event
    canvas.dispatchEvent(new CustomEvent('helmet-loaded', { bubbles: true }));
  } catch (err) {
    destroyed = true;
    clearAutoRotateStartTimer();
    disposeSceneResources();
    signalHelmetError();
    // Show fallback, hide loader
    if (loaderEl) loaderEl.style.display = 'none';
    if (fallbackEl) fallbackEl.hidden = false;
    if (stage) stage.classList.add('has-fallback');
    console.error('No se pudo cargar el casco 3D.', err);
    throw err;
  }

  // ── Pointer interaction (click-and-drag only, no hover) ──
  function onPointerDown(e) {
    if (!modelLoaded) return;
    if (!e.isPrimary) return;
    clearAutoRotateStartTimer();
    autoRotateEnabled = false;
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
  const resizeFrameId = requestAnimationFrame(() => {
    onResize();
  });

  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(canvas.parentElement);

  // ── Visibility pause ──
  let isVisible = true;
  let isPanelActive = true;
  function onVisibilityChange() {
    isVisible = !document.hidden;
    if (!isVisible && animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    } else {
      scheduleRender();
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ── Render loop ──
  let lastTime = performance.now();
  const idleSpeed = prefersReduced ? 0.05 : IDLE_ROTATION_SPEED;
  let animationFrameId = null;
  let firstRenderCompleted = false;

  function scheduleRender() {
    if (destroyed || !isVisible || !isPanelActive || animationFrameId !== null) return;
    animationFrameId = requestAnimationFrame(animate);
  }

  function renderScene() {
    renderer.render(scene, camera);
    if (firstRenderCompleted) return;
    firstRenderCompleted = true;
    logTiming('first render completed');
    // Phase 15B: Signal first frame so poster can be hidden
    try { stage.dispatchEvent(new CustomEvent('helmet:firstframe', { bubbles: true })); } catch (_) {}
  }

  function animate(now) {
    animationFrameId = null;
    if (destroyed || !isVisible || !isPanelActive) return;

    if (!modelLoaded) {
      renderScene();
      scheduleRender();
      return;
    }

    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Idle rotation: begin after loader exit, then resume after drag delay.
    if (!isDragging && !prefersReduced) {
      if (!autoRotateEnabled && idleResumeAt > 0 && now >= idleResumeAt) {
        autoRotateEnabled = true;
        idleResumeAt = 0;
      }
      if (autoRotateEnabled && idleResumeAt === 0) {
        targetRotationY += useAutoRotateSpeed * dt;
      }
    }

    currentRotationY += (targetRotationY - currentRotationY) * (1 - INTERACTION_DAMPING);
    currentRotationX += (targetRotationX - currentRotationX) * (1 - INTERACTION_DAMPING);

    modelGroup.rotation.y = currentRotationY;
    modelGroup.rotation.x = currentRotationX;

    renderScene();
    scheduleRender();
  }

  canvas._helmetSetActive = (active) => {
    if (destroyed || isPanelActive === Boolean(active)) return;
    isPanelActive = Boolean(active);
    if (!isPanelActive && animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    } else {
      lastTime = performance.now();
      scheduleRender();
    }
  };
  scheduleRender();

  // ── Cleanup ──
  canvas._helmetCleanup = () => {
    if (destroyed) return;
    destroyed = true;
    clearAutoRotateStartTimer();
    autoRotateEnabled = false;
    idleResumeAt = 0;
    window.removeEventListener('pagehide', canvas._helmetCleanup);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerup', onPointerUp);
    stage.removeEventListener('pointercancel', onPointerUp);
    stage.removeEventListener('lostpointercapture', onLostPointerCapture);
    window.cancelAnimationFrame(resizeFrameId);
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    resizeObserver.disconnect();
    canvas._helmetSetActive = null;
    disposeSceneResources();
  };
  window.addEventListener('pagehide', canvas._helmetCleanup, { once: true });
}
