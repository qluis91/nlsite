/**
 * Página de Inicio — Entry point
 * Coordinates animation and 3D modules.
 * Only initializes when [data-home-page] is present.
 */
import {
  initHomeAnimations,
  revealHeroImmediately,
  revealPanelTransitionImmediately,
} from './animations.js';
import { initAntigravityBackground } from './antigravityBackground.js';
import { initGrainientBackground } from './grainientBackground.js';
import { initHelmet3D, signalHelmetError } from './helmet3d.js';
import { initLogoLoop } from './logoLoop.js';
import { initNavbar } from './navbar.js';
import { initPageLoader } from './pageLoader.js';
import { initProjectCarousel } from './projectCarousel.js';
import { initServicesCarousel } from './servicesCarousel.mjs';
import { initSocialEmbedModal } from './socialEmbedModal.js';
import { initSocialFeedRow } from './socialFeedRow.js';
import { initSplashCursor } from './splashCursor.js';

const homePage = document.querySelector('[data-home-page]');
let destroyLogoLoop = () => {};
let destroyProjectCarousel = () => {};
let destroyServicesCarousel = () => {};
let destroySocialEmbedModal = () => {};
let destroySocialFeedRow = () => {};
let splashCursorController = null;
let antigravityController = null;
let activePanelState = '';
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

function applyPublishedPanelAppearance() {
  document.querySelectorAll('.home-panel[data-cms-background-color]').forEach((panel) => {
    const background = panel.dataset.cmsBackgroundColor;
    const text = panel.dataset.cmsTextColor;
    const accent = panel.dataset.cmsAccentColor;
    if (background) panel.style.backgroundColor = background;
    if (text) panel.style.color = text;
    if (accent) panel.style.setProperty('--cms-panel-accent', accent);
  });
}

function safeLifecycleCall(controller, method, label) {
  if (!controller) return;
  try {
    controller[method]();
  } catch (err) {
    console.warn(`[home] ${label} ${method}() failed:`, err);
  }
}

function setActivePanelState(nextState) {
  if (!homePage || nextState === activePanelState) return;
  activePanelState = nextState;
  homePage.dataset.activePanelState = nextState;
  const panelOneActive = nextState === 'panel1-active';

  if (panelOneActive) {
    safeLifecycleCall(splashCursorController, 'resume', 'cursor');
    safeLifecycleCall(antigravityController, 'pause', 'antigravity');
  } else {
    safeLifecycleCall(splashCursorController, 'pause', 'cursor');
    safeLifecycleCall(antigravityController, 'resume', 'antigravity');
  }

  const helmetCanvas = document.querySelector('[data-helmet-canvas]');
  if (typeof helmetCanvas?._helmetSetActive === 'function') {
    try {
      helmetCanvas._helmetSetActive(panelOneActive);
    } catch (err) {
      console.warn('[home] helmet setActive failed:', err);
    }
  }
}

/**
 * Model state machine — sets data-model-state on the 3D viewer.
 * loading → ready | error
 */
function setModelState(stage, state) {
  if (!stage) return;
  stage.dataset.modelState = state;

  // Remove all state classes
  stage.classList.remove('is-loading', 'is-ready', 'has-error');

  switch (state) {
    case 'loading':
      stage.classList.add('is-loading');
      stage.setAttribute('aria-busy', 'true');
      break;
    case 'ready':
      stage.classList.add('is-ready');
      stage.setAttribute('aria-busy', 'false');
      break;
    case 'error':
      stage.classList.add('has-error');
      stage.setAttribute('aria-busy', 'false');
      break;
    default:
      break;
  }
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

  // ── Page-loader toggle ──
  // When ENABLE_PAGE_INTRO is false the page renders immediately
  // and only the 3D area shows the localized morphing spinner.
  const ENABLE_PAGE_INTRO = document.querySelector('[data-page-loader]') !== null;

  if (ENABLE_PAGE_INTRO) {
    pageLoader = initPageLoader();
  } else {
    // Dispatch hidden immediately so helmet3d doesn't wait
    const documentRoot = document.documentElement;
    documentRoot.dataset.pageLoaderHidden = 'true';
    window.dispatchEvent(new CustomEvent('page-loader:hidden'));
  }

  // ── 3D model state wiring ──
  const stage = document.querySelector('.hero-3d');
  const loaderEl = document.querySelector('[data-helmet-loader]');
  const errorEl = document.querySelector('[data-helmet-error]');
  const fallbackEl = document.querySelector('[data-helmet-fallback]');
  const retryBtn = document.querySelector('[data-helmet-retry]');

  let helmetInitError = false;

  const onHelmetProgress = (event) => {
    const percent = event.detail && event.detail.percent;
    if (!Number.isFinite(percent)) return;
    const loaderText = loaderEl && loaderEl.querySelector('.hero-loader-text');
    if (loaderText) {
      loaderText.textContent = `Cargando modelo 3D… ${Math.round(percent)}%`;
    }
    if (ENABLE_PAGE_INTRO && pageLoader) {
      pageLoader.setStatus(`Cargando modelo 3D… ${Math.round(percent)}%`);
    }
  };

  const onHelmetReady = () => {
    if (stage) setModelState(stage, 'ready');
    if (ENABLE_PAGE_INTRO && pageLoader) pageLoader.hide();
  };

  const onHelmetError = () => {
    helmetInitError = true;
    if (stage) setModelState(stage, 'error');
    if (loaderEl) loaderEl.style.display = 'none';
    if (errorEl) errorEl.hidden = false;
    if (fallbackEl) fallbackEl.hidden = false;
    if (ENABLE_PAGE_INTRO && pageLoader) {
      pageLoader.setStatus('El modelo 3D no está disponible. Mostrando la página…');
      pageLoader.hide();
    }
  };

  window.addEventListener('helmet:progress', onHelmetProgress);
  window.addEventListener('helmet:ready', onHelmetReady);
  window.addEventListener('helmet:error', onHelmetError);
  removeLoaderListeners = () => {
    window.removeEventListener('helmet:progress', onHelmetProgress);
    window.removeEventListener('helmet:ready', onHelmetReady);
    window.removeEventListener('helmet:error', onHelmetError);
  };

  // ── Retry button ──
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      if (!stage) return;

      // Reset to loading state
      helmetInitError = false;
      if (errorEl) errorEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;
      if (loaderEl) loaderEl.style.display = '';
      const loaderText = loaderEl && loaderEl.querySelector('.hero-loader-text');
      if (loaderText) loaderText.textContent = 'Cargando modelo 3D…';
      setModelState(stage, 'loading');

      // Dispose prior failed renderer if any
      const canvas = document.querySelector('[data-helmet-canvas]');
      if (canvas && canvas._helmetCleanup) {
        canvas._helmetCleanup();
        canvas._helmetCleanup = null;
      }

      // Restart 3D
      const canvasEl = document.querySelector('[data-helmet-canvas]');
      if (canvasEl && supportsWebGL()) {
        try {
          await initHelmet3D(canvasEl, reducedMotion());
        } catch (err) {
          signalHelmetError();
          console.error('[home] Helmet3D retry failed:', err);
        }
      } else {
        signalHelmetError();
      }
    });
  }

  if (document.documentElement.dataset.helmetReady === 'true') {
    if (stage) setModelState(stage, 'ready');
  } else if (document.documentElement.dataset.helmetError === 'true') {
    onHelmetError();
  }

  const prefersReduced = reducedMotion();
  applyPublishedPanelAppearance();

  // ── Reduced-motion: pause SVG SMIL animations ──
  if (prefersReduced) {
    const svgEl = document.querySelector('.hero-loader__spinner-svg');
    if (svgEl && typeof svgEl.pauseAnimations === 'function') {
      svgEl.pauseAnimations();
    }
  }

  // Start the independent GLB request before decorative modules and animations.
  // GSAP still owns the visual reveal of the existing canvas.
  const canvas = document.querySelector('[data-helmet-canvas]');
  if (!canvas || !stage) {
    signalHelmetError();
  } else if (!supportsWebGL()) {
    signalHelmetError();
    if (loaderEl) loaderEl.style.display = 'none';
    if (fallbackEl) fallbackEl.hidden = false;
    stage.classList.add('has-fallback');
  } else {
    // Phase 15B: Hide poster after first successful 3D frame
    if (stage) {
      stage.addEventListener('helmet:firstframe', function hidePoster() {
        const poster = stage.querySelector('[data-helmet-poster]');
        if (poster) poster.style.display = 'none';
        setModelState(stage, 'ready');
      }, { once: true });
    }

    void initHelmet3D(canvas, prefersReduced)
      .then(() => {
        if (stage && !helmetInitError) setModelState(stage, 'ready');
        if (typeof canvas._helmetSetActive === 'function') {
          canvas._helmetSetActive(activePanelState === 'panel1-active');
        }
      })
      .catch((err) => {
        signalHelmetError();
        console.error('[home] Helmet3D init failed:', err);
        if (loaderEl) loaderEl.style.display = 'none';
        if (fallbackEl) fallbackEl.hidden = false;
        if (stage) setModelState(stage, 'error');
      });
  }

  // Homepage navigation remains independent from every visual renderer.
  try {
    initNavbar();
  } catch (err) {
    console.warn('[home] Navbar initialization failed:', err);
  }

  // Panel 2 modules are isolated from the hero renderers.
  initShowcase();
  try {
    antigravityController = initAntigravityBackground(
      document.querySelector('[data-antigravity-canvas]'),
      { reducedMotion: prefersReduced },
    );
  } catch (error) {
    console.warn('[Antigravity] Background initialization failed.', error);
  }

  // Panel 3 — Services circular carousel
  const servicesRoot = document.querySelector('[data-services-carousel]');
  if (servicesRoot) {
    try {
      destroyServicesCarousel = initServicesCarousel(servicesRoot);
    } catch (error) {
      console.warn('[Services] Carousel initialization failed.', error);
    }
  }

  destroySocialFeedRow = initSocialFeedRow(document.querySelector('[data-social-feed]'));
  destroySocialEmbedModal = initSocialEmbedModal(document.querySelector('[data-social-feed]'));

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
      splashCursorController = initSplashCursor({
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
  setActivePanelState('panel1-active');

  // ── Animation system ──
  if (!prefersReduced) {
    try {
      await initHomeAnimations({ onPanelStateChange: setActivePanelState });
    } catch (err) {
      console.error('[home] Animation init failed:', err);
    }
  } else {
    // Show everything immediately when reduced motion is preferred
    revealHeroImmediately();
    revealPanelTransitionImmediately();
    antigravityController?.pause();
  }

}

window.addEventListener('pagehide', () => {
  removeLoaderListeners();
  if (pageLoader) pageLoader.destroy();
  destroyLogoLoop();
  destroyProjectCarousel();
  destroyServicesCarousel();
  destroySocialEmbedModal();
  destroySocialFeedRow();
  splashCursorController?.destroy();
  antigravityController?.destroy();
}, { once: true });

// Auto-initialize
init();
