import { initCircularGallery } from './circularGalleryRenderer.mjs';
import { InfiniteMenuRenderer } from './infiniteMenuRenderer.mjs';

const galleryModeInstances = new WeakMap();

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

const SAFE_VIDEO_SOURCE = /^\/uploads\/gallery\/videos\/[a-zA-Z0-9._-]+$/;

export function normalizeGalleryView(value) {
  return value === 'grid' ? 'grid' : 'infinite';
}

export function selectVideoGalleryItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => (
    item?.type === 'video'
    && typeof item.source === 'string'
    && SAFE_VIDEO_SOURCE.test(item.source)
  ));
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

export function setupGalleryModes({
  page,
  items,
  openGalleryItemById,
  dependencies = {},
}) {
  if (galleryModeInstances.has(page)) return galleryModeInstances.get(page);
  const videoItems = selectVideoGalleryItems(items);
  const grid = page.querySelector('[data-gallery-grid]');
  const primaryModes = {
    grid: page.querySelector('[data-gallery-primary-mode="grid"]'),
    infinite: page.querySelector('[data-gallery-primary-mode="infinite"]'),
  };
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
  if (
    !grid
    || !primaryModes.grid
    || !primaryModes.infinite
    || !circular.stage
    || !infinite.stage
    || viewLinks.length !== 2
  ) return () => {};

  const createInfiniteRenderer = dependencies.createInfiniteRenderer
    || ((stage, rendererItems, options) => new InfiniteMenuRenderer(stage, rendererItems, options));
  const createCircularRenderer = dependencies.createCircularRenderer || initCircularGallery;
  const canUseInfinite = dependencies.supportsInfiniteGallery || supportsInfiniteGallery;
  const canUseCircular = dependencies.supportsCircularGallery || supportsCircularGallery;
  const transitions = dependencies.transitions || {
    exit: async () => {},
    enter: async () => {},
    reset() {},
    revealCarousel: async () => {},
  };

  let activeRenderer = null;
  let circularRenderer = null;
  let activeMode = null;
  let destroyed = false;
  let activationGeneration = 0;
  let transitionChain = Promise.resolve();
  let circularLiveTimer = null;
  let infiniteLiveTimer = null;
  let activeCircularItem = videoItems[0] || null;
  let activeInfiniteItem = items[0] || null;
  const removers = [];

  function listen(target, name, handler, options) {
    if (!target) return;
    target.addEventListener(name, handler, options);
    removers.push(() => target.removeEventListener(name, handler, options));
  }

  function updateSelector(view) {
    viewLinks.forEach((link) => {
      if (link.dataset.galleryView === view) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  function setPrimaryModeVisibility(view) {
    Object.entries(primaryModes).forEach(([mode, container]) => {
      const isActive = mode === view;
      container.hidden = !isActive;
      container.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      container.classList.remove(isActive ? 'is-inactive' : 'is-active');
      container.classList.add(isActive ? 'is-active' : 'is-inactive');
    });
  }

  function announce(elements, timerName, item, index, length) {
    const timer = timerName === 'circular' ? circularLiveTimer : infiniteLiveTimer;
    window.clearTimeout(timer);
    const nextTimer = window.setTimeout(() => {
      elements.live.textContent = `${item.title || 'Proyecto'}, elemento ${index + 1} de ${length}`;
    }, 240);
    if (timerName === 'circular') circularLiveTimer = nextTimer;
    else infiniteLiveTimer = nextTimer;
  }

  function updateCircular(item, index, length) {
    if (!item) return;
    activeCircularItem = item;
    circular.title.textContent = item.title || 'Proyecto';
    circular.meta.textContent = [item.category, 'Video'].filter(Boolean).join(' · ');
    announce(circular, 'circular', item, index, length);
  }

  function updateInfinite(item, index, length) {
    if (!item) return;
    activeInfiniteItem = item;
    infinite.title.textContent = item.title || 'Proyecto';
    infinite.meta.textContent = [
      item.category,
      item.type === 'video' ? 'Video' : 'Imagen',
    ].filter(Boolean).join(' · ');
    announce(infinite, 'infinite', item, index, length);
  }

  function cleanupInfiniteDom() {
    infinite.stage.querySelectorAll('[data-gallery-renderer-generated]').forEach((element) => {
      element.remove();
    });
  }

  function resetInfiniteStage() {
    infinite.stage.classList.remove('is-ready', 'is-fallback', 'is-dragging', 'is-moving');
    infinite.loader.hidden = false;
    infinite.overlay.hidden = true;
    infinite.fallback.hidden = true;
  }

  async function destroyActiveRenderer() {
    const renderer = activeRenderer;
    activeRenderer = null;
    if (renderer) {
      try {
        await Promise.resolve(renderer.destroy());
      } catch (error) {
        logDevelopmentFailure('cleanup', error);
      }
    }
    cleanupInfiniteDom();
  }

  async function destroyCircularRenderer() {
    const renderer = circularRenderer;
    circularRenderer = null;
    if (renderer) {
      try {
        await Promise.resolve(renderer.destroy());
      } catch (error) {
        logDevelopmentFailure('video carousel cleanup', error);
      }
    }
    circular.stage.querySelectorAll('[data-gallery-renderer-generated]').forEach((element) => {
      element.remove();
    });
  }

  function showCircularFallback(message) {
    circular.stage.hidden = false;
    circular.stage.classList.remove('is-ready');
    circular.stage.classList.add('is-fallback');
    circular.loader.hidden = true;
    circular.overlay.hidden = true;
    circular.fallback.hidden = false;
    circular.fallback.textContent = message;
    transitions.revealCarousel(circular.stage);
  }

  async function ensureVideoCarousel(generation) {
    if (generation !== activationGeneration || destroyed) return false;
    circular.stage.hidden = false;
    if (!videoItems.length) {
      showCircularFallback('Todavía no hay proyectos con video disponibles.');
      return false;
    }
    const capability = canUseCircular(videoItems);
    if (!capability.supported) {
      showCircularFallback(capability.reason === 'reduced-motion'
        ? 'La lista de proyectos permanece disponible con movimiento reducido.'
        : 'El carrusel de video no está disponible en este dispositivo.');
      return false;
    }
    if (circularRenderer) {
      await transitions.revealCarousel(circular.stage);
      return true;
    }

    circular.stage.classList.remove('is-fallback');
    circular.loader.hidden = false;
    circular.overlay.hidden = true;
    circular.fallback.hidden = true;
    let candidate = null;
    try {
      candidate = createCircularRenderer(circular.stage, videoItems, {
        bend: 0,
        onActiveChange: updateCircular,
        onSelect: (item) => openGalleryItemById(item.id, circular.action),
        onContextLost: () => {
          transitionChain = transitionChain.then(async () => {
            await destroyCircularRenderer();
            showCircularFallback('El carrusel de video se detuvo. Los proyectos siguen disponibles.');
          });
        },
      });
      await candidate.ready;
      if (destroyed || generation !== activationGeneration) {
        candidate.destroy();
        return false;
      }
      circularRenderer = candidate;
      circular.loader.hidden = true;
      circular.overlay.hidden = false;
      circular.stage.classList.add('is-ready');
      await transitions.revealCarousel(circular.stage);
      return true;
    } catch (error) {
      if (candidate) candidate.destroy();
      if (generation === activationGeneration) {
        logDevelopmentFailure('Circular video', error);
        showCircularFallback('El carrusel de video no pudo iniciarse. Los proyectos siguen disponibles.');
      }
      return false;
    }
  }

  async function showGrid(generation) {
    if (generation !== activationGeneration) return;
    setPrimaryModeVisibility('grid');
    activeMode = 'grid';
    updateSelector('grid');
    await destroyActiveRenderer();
    if (generation !== activationGeneration) return;
    resetInfiniteStage();
    await ensureVideoCarousel(generation);
  }

  async function restoreGridFallback(generation, error) {
    if (generation !== activationGeneration) return;
    setPrimaryModeVisibility('grid');
    activeMode = 'grid';
    updateSelector('grid');
    await destroyActiveRenderer();
    if (generation !== activationGeneration) return;
    resetInfiniteStage();
    await ensureVideoCarousel(generation);
    if (error) logDevelopmentFailure('fallback', error);
  }

  async function showInfinite(generation) {
    if (generation !== activationGeneration) return;
    const capability = canUseInfinite(items);
    if (!capability.supported) {
      disableInfiniteLink(capability.reason);
      await restoreGridFallback(generation);
      return;
    }

    await destroyActiveRenderer();
    if (generation !== activationGeneration) return;
    setPrimaryModeVisibility('infinite');
    activeMode = 'infinite';
    updateSelector('infinite');
    infinite.loader.hidden = false;
    infinite.overlay.hidden = true;
    infinite.fallback.hidden = true;
    let candidate = null;
    try {
      candidate = createInfiniteRenderer(infinite.stage, items, {
        onActiveChange: updateInfinite,
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
      await ensureVideoCarousel(generation);
      if (destroyed || generation !== activationGeneration) return;
      infinite.stage.focus({ preventScroll: true });
    } catch (error) {
      if (candidate) candidate.destroy();
      if (generation === activationGeneration) await restoreGridFallback(generation, error);
    }
  }

  function disableInfiniteLink(reason) {
    const link = viewLinks.find((candidate) => candidate.dataset.galleryView === 'infinite');
    if (!link) return;
    link.setAttribute('aria-disabled', 'true');
    link.title = reason === 'reduced-motion'
      ? 'La cuadrícula respeta tu preferencia de movimiento reducido.'
      : 'Esta visualización no está disponible en este dispositivo.';
  }

  function logDevelopmentFailure(mode, error) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      console.warn(`[Gallery] ${mode} renderer initialization failed.`, error?.message || 'Unknown error');
    }
  }

  async function activateMode(requestedMode) {
    if (destroyed) return;
    const mode = normalizeGalleryView(requestedMode);
    const generation = ++activationGeneration;
    transitionChain = transitionChain
      .catch((error) => logDevelopmentFailure('transition', error))
      .then(async () => {
        if (generation !== activationGeneration) return;
        const outgoingMode = activeMode;
        const outgoingContainer = outgoingMode ? primaryModes[outgoingMode] : null;
        if (outgoingMode === mode && (mode === 'grid' || activeRenderer)) {
          transitions.reset(outgoingContainer);
          updateSelector(mode);
          await transitions.enter(outgoingContainer, mode);
          return;
        }
        if (outgoingContainer) {
          await transitions.exit(outgoingContainer, outgoingMode);
          if (generation !== activationGeneration || destroyed) {
            transitions.reset(outgoingContainer);
            return;
          }
        }
        if (mode === 'grid') await showGrid(generation);
        else await showInfinite(generation);
        if (generation !== activationGeneration || destroyed) return;
        if (outgoingContainer && outgoingContainer !== primaryModes[activeMode]) {
          transitions.reset(outgoingContainer);
        }
        await transitions.enter(primaryModes[activeMode], activeMode);
      });
    return transitionChain;
  }

  function setUrlFromLink(link) {
    const url = new URL(link.href, window.location.href);
    window.history.pushState({ galleryView: link.dataset.galleryView }, '', url);
  }

  viewLinks.forEach((link) => {
    listen(link, 'click', (event) => {
      event.preventDefault();
      setUrlFromLink(link);
      activateMode(link.dataset.galleryView);
    });
    listen(link, 'keydown', (event) => {
      if (event.key !== ' ') return;
      event.preventDefault();
      setUrlFromLink(link);
      activateMode(link.dataset.galleryView);
    });
  });

  listen(circular.action, 'click', () => {
    if (activeCircularItem) openGalleryItemById(activeCircularItem.id, circular.action);
  });
  listen(infinite.action, 'click', () => {
    if (activeInfiniteItem) openGalleryItemById(activeInfiniteItem.id, infinite.action);
  });

  const onPopState = () => {
    const requested = new URLSearchParams(window.location.search).get('view');
    activateMode(normalizeGalleryView(requested));
  };
  const onPageHide = () => cleanup();
  listen(window, 'popstate', onPopState);
  listen(window, 'pagehide', onPageHide, { once: true });

  activateMode(normalizeGalleryView(page.dataset.requestedView));

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    activationGeneration += 1;
    window.clearTimeout(circularLiveTimer);
    window.clearTimeout(infiniteLiveTimer);
    removers.splice(0).forEach((remove) => remove());
    Object.values(primaryModes).forEach((container) => transitions.reset(container));
    destroyActiveRenderer();
    destroyCircularRenderer();
    if (galleryModeInstances.get(page) === cleanup) galleryModeInstances.delete(page);
  }

  galleryModeInstances.set(page, cleanup);
  return cleanup;
}
