import { initCircularGallery } from './circularGalleryRenderer.mjs';
import { RingGalleryRenderer } from './ringGalleryRenderer.mjs';
import { InfiniteMenuRenderer } from './infiniteMenuRenderer.mjs';

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function supportsCircularGallery(items = []) {
  if (!Array.isArray(items) || items.length === 0) return { supported: false, reason: 'empty' };
  if (prefersReducedMotion()) return { supported: false, reason: 'reduced-motion' };
  if (
    (Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory < 2)
    || (Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency < 2)
  ) {
    return { supported: false, reason: 'performance' };
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return { supported: false, reason: 'webgl' };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return { supported: false, reason: 'webgl' };
  }
  return { supported: true, reason: '' };
}

export function supportsRingGallery(items = []) {
  if (!Array.isArray(items) || items.length === 0) return { supported: false, reason: 'empty' };
  if (prefersReducedMotion()) return { supported: false, reason: 'reduced-motion' };
  if (!window.CSS?.supports?.('transform-style', 'preserve-3d')) {
    return { supported: false, reason: 'css-3d' };
  }
  if (!window.CSS.supports('perspective', '1000px')) {
    return { supported: false, reason: 'css-3d' };
  }
  return { supported: true, reason: '' };
}

export function supportsInfiniteGallery(items = []) {
  if (!Array.isArray(items) || items.length === 0) return { supported: false, reason: 'empty' };
  if (prefersReducedMotion()) return { supported: false, reason: 'reduced-motion' };
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (!gl) return { supported: false, reason: 'webgl2' };
    const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    if (maxTexSize < 1024) return { supported: false, reason: 'texture-size' };
    if (maxAttribs < 8) return { supported: false, reason: 'attributes' };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return { supported: false, reason: 'webgl2' };
  }
  return { supported: true, reason: '' };
}

export function setupGalleryModes({ page, items, openGalleryItemById }) {
  const grid = page.querySelector('[data-gallery-grid]');
  const circular = {
    stage: page.querySelector('[data-gallery-circular]'),
    loader: page.querySelector('[data-gallery-circular-loader]'),
    overlay: page.querySelector('[data-gallery-circular-overlay]'),
    title: page.querySelector('[data-gallery-circular-title]'),
    meta: page.querySelector('[data-gallery-circular-meta]'),
    action: page.querySelector('[data-gallery-circular-action]'),
    fallback: page.querySelector('[data-gallery-circular-fallback]'),
    live: page.querySelector('[data-gallery-circular-live]'),
  };
  const ring = {
    stage: page.querySelector('[data-gallery-ring]'),
    loader: page.querySelector('[data-gallery-ring-loader]'),
    overlay: page.querySelector('[data-gallery-ring-overlay]'),
    title: page.querySelector('[data-gallery-ring-title]'),
    meta: page.querySelector('[data-gallery-ring-meta]'),
    action: page.querySelector('[data-gallery-ring-action]'),
    fallback: page.querySelector('[data-gallery-ring-fallback]'),
    live: page.querySelector('[data-gallery-ring-live]'),
  };
  const infinite = {
    stage: page.querySelector('[data-gallery-infinite]'),
    loader: page.querySelector('[data-gallery-infinite-loader]'),
    overlay: page.querySelector('[data-gallery-infinite-overlay]'),
    title: page.querySelector('[data-gallery-infinite-title]'),
    meta: page.querySelector('[data-gallery-infinite-meta]'),
    action: page.querySelector('[data-gallery-infinite-action]'),
    fallback: page.querySelector('[data-gallery-infinite-fallback]'),
    live: page.querySelector('[data-gallery-infinite-live]'),
  };
  const viewLinks = [...page.querySelectorAll('[data-gallery-view]')];
  if (!grid || !circular.stage || !ring.stage || !infinite.stage || !viewLinks.length) return () => {};

  let activeRenderer = null;
  let activeMode = 'grid';
  let activeItems = { circular: items[0] || null, ring: items[0] || null, infinite: items[0] || null };
  let destroyed = false;
  let activationGeneration = 0;
  let transitionChain = Promise.resolve();
  const liveTimers = { circular: null, ring: null, infinite: null };

  function updateSelector(view) {
    viewLinks.forEach((link) => {
      if (link.dataset.galleryView === view) {
        link.setAttribute('aria-current', 'true');
        link.removeAttribute('aria-disabled');
        link.removeAttribute('title');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function updateActive(mode, elements, item, index, length) {
    if (!item) return;
    activeItems[mode] = item;
    elements.title.textContent = item.title || 'Proyecto';
    const details = [item.category, item.type === 'video' ? 'Video' : 'Imagen'].filter(Boolean);
    elements.meta.textContent = details.join(' · ');
    window.clearTimeout(liveTimers[mode]);
    liveTimers[mode] = window.setTimeout(() => {
      elements.live.textContent = `${item.title || 'Proyecto'}, elemento ${index + 1} de ${length}`;
    }, 240);
  }

  function resetStage(elements) {
    elements.stage.hidden = true;
    elements.stage.classList.remove('is-ready', 'is-fallback');
    elements.loader.hidden = false;
    elements.overlay.hidden = true;
    elements.fallback.hidden = true;
  }

  async function destroyActiveRenderer() {
    const renderer = activeRenderer;
    activeRenderer = null;
    if (!renderer) {
      _cleanupGeneratedDom();
      return;
    }
    try {
      await Promise.resolve(renderer.destroy());
    } catch (error) {
      logDevelopmentFailure('cleanup', error);
    }
    _cleanupGeneratedDom();
  }

  function _cleanupGeneratedDom() {
    circular.stage.querySelectorAll('[data-gallery-renderer-generated]').forEach((el) => el.remove());
    ring.stage.querySelector('[data-gallery-ring-track]')?.replaceChildren();
    infinite.stage.querySelectorAll('[data-gallery-renderer-generated]').forEach((el) => el.remove());
  }

  async function showGrid(generation) {
    if (generation !== activationGeneration) return;
    await destroyActiveRenderer();
    _cleanupGeneratedDom();
    resetStage(circular);
    resetStage(ring);
    resetStage(infinite);
    grid.hidden = false;
    activeMode = 'grid';
    updateSelector('grid');
  }

  async function restoreGridFallback(generation, error) {
    if (generation !== activationGeneration) return;
    await destroyActiveRenderer();
    _cleanupGeneratedDom();
    resetStage(circular);
    resetStage(ring);
    resetStage(infinite);
    grid.hidden = false;
    activeMode = 'grid';
    updateSelector('grid');
    if (error) logDevelopmentFailure('fallback', error);
  }

  async function showCircular(generation) {
    if (generation !== activationGeneration) return;
    const capability = supportsCircularGallery(items);
    if (!capability.supported) {
      disableModeLink('circular', capability.reason);
      await restoreGridFallback(generation);
      return;
    }
    await destroyActiveRenderer();
    resetStage(ring);
    resetStage(infinite);
    if (generation !== activationGeneration) return;
    activeMode = 'circular';
    circular.stage.hidden = false;
    circular.loader.hidden = false;
    circular.overlay.hidden = true;
    circular.fallback.hidden = true;
    let candidate = null;
    try {
      candidate = initCircularGallery(circular.stage, items, {
        bend: 0,
        onActiveChange: (item, index, length) => updateActive('circular', circular, item, index, length),
        onSelect: (item) => openGalleryItemById(item.id, circular.action),
        onContextLost: () => {
          transitionChain = transitionChain.then(() => restoreGridFallback(activationGeneration));
        },
      });
      await candidate.ready;
      if (destroyed || generation !== activationGeneration) {
        candidate.destroy();
        return;
      }
      activeRenderer = candidate;
      circular.loader.hidden = true;
      circular.overlay.hidden = false;
      circular.stage.classList.add('is-ready');
      grid.hidden = true;
      activeMode = 'circular';
      updateSelector('circular');
      circular.stage.focus({ preventScroll: true });
    } catch (error) {
      if (candidate) candidate.destroy();
      if (generation === activationGeneration) {
        logDevelopmentFailure('Circular', error);
        await restoreGridFallback(generation);
      }
    }
  }

  async function showRing(generation) {
    if (generation !== activationGeneration) return;
    const capability = supportsRingGallery(items);
    if (!capability.supported) {
      disableModeLink('ring', capability.reason);
      await restoreGridFallback(generation);
      return;
    }
    await destroyActiveRenderer();
    resetStage(circular);
    resetStage(infinite);
    if (generation !== activationGeneration) return;
    activeMode = 'ring';
    ring.stage.hidden = false;
    ring.loader.hidden = false;
    ring.overlay.hidden = true;
    ring.fallback.hidden = true;
    let candidate = null;
    try {
      candidate = new RingGalleryRenderer(ring.stage, items, {
        onActiveChange: (item, index, length) => updateActive('ring', ring, item, index, length),
        onSelect: (item) => openGalleryItemById(item.id, ring.action),
      });
      await candidate.ready;
      if (destroyed || generation !== activationGeneration) {
        candidate.destroy();
        return;
      }
      activeRenderer = candidate;
      ring.loader.hidden = true;
      ring.overlay.hidden = false;
      ring.stage.classList.add('is-ready');
      grid.hidden = true;
      activeMode = 'ring';
      updateSelector('ring');
      ring.stage.focus({ preventScroll: true });
    } catch (error) {
      if (candidate) candidate.destroy();
      if (generation === activationGeneration) {
        logDevelopmentFailure('Ring', error);
        await restoreGridFallback(generation);
      }
    }
  }

  async function showInfinite(generation) {
    if (generation !== activationGeneration) return;
    const capability = supportsInfiniteGallery(items);
    if (!capability.supported) {
      disableModeLink('infinite', capability.reason);
      await restoreGridFallback(generation);
      return;
    }
    await destroyActiveRenderer();
    resetStage(circular);
    resetStage(ring);
    if (generation !== activationGeneration) return;
    activeMode = 'infinite';
    infinite.stage.hidden = false;
    infinite.loader.hidden = false;
    infinite.overlay.hidden = true;
    infinite.fallback.hidden = true;
    let candidate = null;
    try {
      candidate = new InfiniteMenuRenderer(infinite.stage, items, {
        onActiveChange: (item, index, length) => updateActive('infinite', infinite, item, index, length),
        onSelect: (item) => openGalleryItemById(item.id, infinite.action),
        onContextLost: () => {
          transitionChain = transitionChain.then(() => restoreGridFallback(activationGeneration));
        },
      });
      await candidate.ready;
      if (destroyed || generation !== activationGeneration) {
        candidate.destroy();
        return;
      }
      activeRenderer = candidate;
      infinite.loader.hidden = true;
      infinite.overlay.hidden = false;
      infinite.stage.classList.add('is-ready');
      grid.hidden = true;
      activeMode = 'infinite';
      updateSelector('infinite');
      infinite.stage.focus({ preventScroll: true });
    } catch (error) {
      if (candidate) candidate.destroy();
      if (generation === activationGeneration) {
        logDevelopmentFailure('Infinite', error);
        await restoreGridFallback(generation);
      }
    }
  }

  function disableModeLink(mode, reason) {
    const link = viewLinks.find((candidate) => candidate.dataset.galleryView === mode);
    if (link) {
      link.setAttribute('aria-disabled', 'true');
      link.title = reason === 'reduced-motion'
        ? 'La cuadrícula respeta tu preferencia de movimiento reducido.'
        : 'Esta visualización no está disponible en este dispositivo.';
    }
  }

  function logDevelopmentFailure(mode, error) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.warn(`[Gallery] ${mode} renderer initialization failed.`, error?.message || 'Unknown error');
    }
  }

  async function activateMode(mode) {
    if (destroyed) return;
    if (mode === activeMode && activeRenderer) return;

    const generation = ++activationGeneration;

    transitionChain = transitionChain
      .catch((error) => {
        logDevelopmentFailure('transition', error);
      })
      .then(async () => {
        if (generation !== activationGeneration) return;
        if (mode === 'circular') await showCircular(generation);
        else if (mode === 'ring') await showRing(generation);
        else if (mode === 'infinite') await showInfinite(generation);
        else await showGrid(generation);
      });

    return transitionChain;
  }

  function setUrlFromLink(link) {
    const url = new URL(link.href, window.location.href);
    window.history.pushState({ galleryView: link.dataset.galleryView }, '', url);
  }

  viewLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setUrlFromLink(link);
      activateMode(link.dataset.galleryView);
    });
  });

  circular.action?.addEventListener('click', () => {
    if (activeItems.circular) openGalleryItemById(activeItems.circular.id, circular.action);
  });
  ring.action?.addEventListener('click', () => {
    if (activeItems.ring) openGalleryItemById(activeItems.ring.id, ring.action);
  });
  infinite.action?.addEventListener('click', () => {
    if (activeItems.infinite) openGalleryItemById(activeItems.infinite.id, infinite.action);
  });

  const onPopState = () => {
    const requested = new URLSearchParams(window.location.search).get('view');
    activateMode(['circular', 'ring', 'infinite'].includes(requested) ? requested : 'grid');
  };
  const onPageHide = () => {
    destroyed = true;
    destroyActiveRenderer();
  };
  window.addEventListener('popstate', onPopState);
  window.addEventListener('pagehide', onPageHide, { once: true });

  activateMode(['circular', 'ring', 'infinite'].includes(page.dataset.requestedView)
    ? page.dataset.requestedView
    : 'grid');

  return () => {
    destroyed = true;
    Object.values(liveTimers).forEach((timer) => window.clearTimeout(timer));
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('pagehide', onPageHide);
    destroyActiveRenderer();
  };
}
