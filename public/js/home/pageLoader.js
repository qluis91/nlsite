const DEFAULTS = Object.freeze({
  minVisibleMs: 700,
  maxVisibleMs: 12000,
  fadeDurationMs: 550,
});

function safeDuration(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Controls the homepage's fullscreen loading video.
 * @param {{minVisibleMs?: number, maxVisibleMs?: number, fadeDurationMs?: number}} options
 * @returns {{hide: () => void, setStatus: (message: string) => void, destroy: () => void}}
 */
export function initPageLoader(options = {}) {
  const root = document.querySelector('[data-page-loader]');
  const body = document.body;
  const documentRoot = document.documentElement;
  let hiddenEventDispatched = false;

  function dispatchHidden() {
    if (hiddenEventDispatched) return;
    hiddenEventDispatched = true;
    documentRoot.dataset.pageLoaderHidden = 'true';
    window.dispatchEvent(new CustomEvent('page-loader:hidden'));
  }

  if (!root) {
    dispatchHidden();
    return {
      hide() {},
      setStatus() {},
      destroy() {},
    };
  }

  const video = root.querySelector('[data-page-loader-video]');
  const status = root.querySelector('[data-page-loader-status]');
  const minVisibleMs = safeDuration(options.minVisibleMs, DEFAULTS.minVisibleMs);
  const maxVisibleMs = safeDuration(options.maxVisibleMs, DEFAULTS.maxVisibleMs);
  const fadeDurationMs = safeDuration(options.fadeDurationMs, DEFAULTS.fadeDurationMs);
  const startedAt = performance.now();

  let hideRequested = false;
  let destroyed = false;
  let hideTimer = null;
  let removalTimer = null;
  let maxTimer = null;

  delete documentRoot.dataset.pageLoaderHidden;
  body.classList.add('is-page-loading');

  function setStatus(message) {
    if (destroyed || !status || typeof message !== 'string') return;
    status.textContent = message;
  }

  function removeLoader(shouldDispatchHidden = true) {
    if (destroyed) return;
    destroyed = true;
    window.clearTimeout(hideTimer);
    window.clearTimeout(removalTimer);
    window.clearTimeout(maxTimer);
    if (video) {
      video.removeEventListener('error', onVideoError);
      video.pause();
    }
    body.classList.remove('is-page-loading');
    root.remove();
    if (shouldDispatchHidden) dispatchHidden();
  }

  function beginExit() {
    if (destroyed) return;
    root.classList.add('is-hiding');
    removalTimer = window.setTimeout(removeLoader, fadeDurationMs);
  }

  function hide() {
    if (hideRequested || destroyed) return;
    hideRequested = true;
    window.clearTimeout(maxTimer);
    const elapsed = performance.now() - startedAt;
    hideTimer = window.setTimeout(beginExit, Math.max(0, minVisibleMs - elapsed));
  }

  function onVideoError() {
    setStatus('Preparando experiencia 3D…');
  }

  function destroy() {
    if (destroyed) return;
    hideRequested = true;
    removeLoader(false);
  }

  if (video) {
    video.addEventListener('error', onVideoError);
    try {
      const playAttempt = video.play();
      if (playAttempt && typeof playAttempt.catch === 'function') {
        playAttempt.catch(() => {
          setStatus('Preparando experiencia 3D…');
        });
      }
    } catch {
      setStatus('Preparando experiencia 3D…');
    }
  }

  maxTimer = window.setTimeout(() => {
    setStatus('Mostrando la página…');
    hide();
  }, maxVisibleMs);

  return { hide, setStatus, destroy };
}
