/**
 * Página de Inicio — Entry point
 * Coordinates animation and 3D modules.
 * Only initializes when [data-home-page] is present.
 */
import { initHomeAnimations } from './animations.js';
import { initGrainientBackground } from './grainientBackground.js';
import { initHelmet3D, signalHelmetError } from './helmet3d.js';
import { initLogoLoop } from './logoLoop.js';
import { initNavbar } from './navbar.js';
import { initPageLoader } from './pageLoader.js';
import { initProjectCarousel } from './projectCarousel.js';
import { initSplashCursor } from './splashCursor.js';

const homePage = document.querySelector('[data-home-page]');
let destroyLogoLoop = () => {};
let destroyProjectCarousel = () => {};
let pageLoader = null;
let removeLoaderListeners = () => {};
if (!homePage) {
  // Not on the homepage — skip all initialization
  console.warn('[home] data-home-page not found; skipping homepage init.');
}

/**
 * Feature detection helpers
 */
function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function initShowcase() {
  const logoLoopRoot = document.querySelector('[data-logo-loop]');
  const carouselRoot = document.querySelector('[data-project-carousel]');

  if (logoLoopRoot) {
    try {
      destroyLogoLoop = initLogoLoop(logoLoopRoot, {
        speed: 85,
        direction: 'left',
        gap: 72,
        logoHeight: 56,
        hoverSpeed: 0,
        scaleOnHover: true,
        fadeOut: true,
      });
    } catch (error) {
      console.warn('[LogoLoop] Initialization failed.', error);
    }
  }

  if (carouselRoot) {
    try {
      destroyProjectCarousel = initProjectCarousel(carouselRoot);
    } catch (error) {
      console.warn('[ProjectCarousel] Initialization failed.', error);
    }
  }
}

/**
 * Main initialization
 */
async function init() {
  if (!homePage) return;

  pageLoader = initPageLoader();

  const onHelmetProgress = (event) => {
    const percent = event.detail && event.detail.percent;
    if (!Number.isFinite(percent)) return;
    pageLoader.setStatus(`Cargando modelo 3D… ${Math.round(percent)}%`);
  };
  const onHelmetReady = () => pageLoader.hide();
  const onHelmetError = () => {
    pageLoader.setStatus('El modelo 3D no está disponible. Mostrando la página…');
    pageLoader.hide();
  };

  window.addEventListener('helmet:progress', onHelmetProgress);
  window.addEventListener('helmet:ready', onHelmetReady);
  window.addEventListener('helmet:error', onHelmetError);
  removeLoaderListeners = () => {
    window.removeEventListener('helmet:progress', onHelmetProgress);
    window.removeEventListener('helmet:ready', onHelmetReady);
    window.removeEventListener('helmet:error', onHelmetError);
  };

  if (document.documentElement.dataset.helmetReady === 'true') {
    pageLoader.hide();
  } else if (document.documentElement.dataset.helmetError === 'true') {
    onHelmetError();
  }

  const prefersReduced = reducedMotion();

  // Homepage navigation remains independent from every visual renderer.
  try {
    initNavbar();
  } catch (err) {
    console.warn('[home] Navbar initialization failed:', err);
  }

  // Panel 2 modules are isolated from the hero renderers.
  initShowcase();

  // Grainient background. Its failure must not affect the other visual systems.
  if (!prefersReduced) {
    try {
      initGrainientBackground({
        canvas: document.querySelector('[data-grainient-canvas]'),
        color1: '#b1bac6', color2: '#73767a', color3: '#000000',
        timeSpeed: 0.25, colorBalance: 0,
        warpStrength: 1.7, warpFrequency: 3.5, warpSpeed: 3.3, warpAmplitude: 80,
        blendAngle: 120, blendSoftness: 0.12, rotationAmount: 0,
        noiseScale: 0.65, grainAmount: 0, grainScale: 0.7, grainAnimated: false,
        contrast: 1.3, gamma: 1.55, saturation: 0.75,
        centerX: -0.36, centerY: 0.09, zoom: 0.95,
      });
    } catch (err) {
      console.warn('[Grainient] Background initialization failed.', err);
    }
  }

  // Decorative fluid cursor. Failure is isolated from animations and Helmet3D.
  if (!prefersReduced) {
    try {
      initSplashCursor({
        canvas: document.querySelector('[data-splash-cursor]'),
        SIM_RESOLUTION: 128,
        DYE_RESOLUTION: 1440,
        CAPTURE_RESOLUTION: 512,
        DENSITY_DISSIPATION: 5.5,
        VELOCITY_DISSIPATION: 1.5,
        PRESSURE: 0.2,
        PRESSURE_ITERATIONS: 20,
        CURL: 3,
        SPLAT_RADIUS: 0.2,
        SPLAT_FORCE: 6000,
        SHADING: true,
        COLOR_UPDATE_SPEED: 10,
        BACK_COLOR: { r: 0, g: 0, b: 0 },
        TRANSPARENT: true,
        RAINBOW_MODE: false,
        COLOR: '#93eb0d',
      });
    } catch (err) {
      console.warn('[home] Splash cursor init failed:', err);
    }
  }

  // ── Animation system ──
  if (!prefersReduced) {
    try {
      await initHomeAnimations();
    } catch (err) {
      console.error('[home] Animation init failed:', err);
    }
  } else {
    // Show everything immediately when reduced motion is preferred
    homePage.classList.add('is-motion-ready');
  }

  // ── 3D Helmet ──
  const canvas = document.querySelector('[data-helmet-canvas]');
  const loader = document.querySelector('[data-helmet-loader]');
  const fallback = document.querySelector('[data-helmet-fallback]');
  const stage = document.querySelector('.hero-3d');

  if (!canvas || !stage) {
    signalHelmetError();
    return;
  }

  if (!supportsWebGL()) {
    signalHelmetError();
    // WebGL not available — show fallback
    if (loader) loader.style.display = 'none';
    if (fallback) fallback.hidden = false;
    if (stage) stage.classList.add('has-fallback');
    return;
  }

  try {
    await initHelmet3D(canvas, prefersReduced);
    if (loader) loader.style.display = 'none';
    if (stage) stage.classList.add('is-loaded');
  } catch (err) {
    signalHelmetError();
    console.error('[home] Helmet3D init failed:', err);
    if (loader) loader.style.display = 'none';
    if (fallback) fallback.hidden = false;
    if (stage) stage.classList.add('has-fallback');
  }
}

window.addEventListener('pagehide', () => {
  removeLoaderListeners();
  if (pageLoader) pageLoader.destroy();
  destroyLogoLoop();
  destroyProjectCarousel();
}, { once: true });

// Auto-initialize
init();
