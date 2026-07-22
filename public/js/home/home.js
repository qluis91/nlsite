/**
 * Página de Inicio — Entry point
 * Coordinates animation and 3D modules.
 * Only initializes when [data-home-page] is present.
 */
import { initHomeAnimations } from './animations.js';
import { initHelmet3D } from './helmet3d.js';

const homePage = document.querySelector('[data-home-page]');
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

/**
 * Main initialization
 */
async function init() {
  if (!homePage) return;

  const prefersReduced = reducedMotion();

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

  if (!canvas || !stage) return;

  if (!supportsWebGL()) {
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
    console.error('[home] Helmet3D init failed:', err);
    if (loader) loader.style.display = 'none';
    if (fallback) fallback.hidden = false;
    if (stage) stage.classList.add('has-fallback');
  }
}

// Auto-initialize
init();
