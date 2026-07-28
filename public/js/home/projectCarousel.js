const carouselInstances = new WeakMap();

const DEFAULT_OPTIONS = {
  transitionDuration: 760,
  swipeThreshold: 48,
};

export function initProjectCarousel(root, options = {}) {
  if (!root) return () => {};
  if (carouselInstances.has(root)) return carouselInstances.get(root);

  const settings = { ...DEFAULT_OPTIONS, ...options };
  const slidesContainer = root.querySelector('[data-carousel-slides]');
  const previousButton = root.querySelector('[data-carousel-prev]');
  const nextButton = root.querySelector('[data-carousel-next]');
  const status = root.querySelector('[data-carousel-status]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (!slidesContainer || !previousButton || !nextButton) return () => {};

  const removers = [];
  let transitionTimer = null;
  let transitioning = false;
  let pointerId = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let destroyed = false;

  root.classList.add('is-enhanced');

  function listen(target, event, handler, eventOptions) {
    target.addEventListener(event, handler, eventOptions);
    removers.push(() => target.removeEventListener(event, handler, eventOptions));
  }

  function slides() {
    return [...slidesContainer.querySelectorAll('[data-project-slide]')];
  }

  function setControlsDisabled(disabled) {
    previousButton.disabled = disabled;
    nextButton.disabled = disabled;
    root.setAttribute('aria-busy', String(disabled));
  }

  function syncState(announce = false) {
    const currentSlides = slides();
    const activeSlide = currentSlides[1] || currentSlides[0];

    currentSlides.forEach((slide, index) => {
      const isActive = slide === activeSlide;
      const isUnderlay = index === 0 && !isActive;
      const isPreview = index >= 2;
      const previewIndex = Math.max(0, index - 2);
      slide.classList.toggle('is-active', isActive);
      slide.classList.toggle('is-underlay', isUnderlay);
      slide.classList.toggle('is-preview', isPreview);
      slide.classList.toggle('is-preview-near', index === 2);
      slide.classList.toggle('is-preview-rear', index > 2);
      slide.style.setProperty('--preview-index', previewIndex);
      slide.setAttribute('aria-hidden', String(!isActive));
      slide.setAttribute('aria-label', `${index + 1} de ${currentSlides.length}`);
      // Keep previews interactive for hover; only underlay/off-stack stay inert.
      slide.toggleAttribute('inert', !(isActive || isPreview));

      const image = slide.querySelector('img');
      if (image) {
        if (isActive || isUnderlay) {
          // Restore main image
          const mainSrc = image.dataset.mainSrc;
          if (mainSrc && image.src !== mainSrc) image.src = mainSrc;
          if (image.dataset.mainAlt) image.alt = image.dataset.mainAlt;
          if (isActive || index === 2) image.loading = 'eager';
        } else if (isPreview) {
          // Swap to preview image if available
          const previewSrc = slide.dataset.projectPreviewImage;
          if (previewSrc && image.src !== previewSrc) image.src = previewSrc;
          if (slide.dataset.projectPreviewAlt) image.alt = slide.dataset.projectPreviewAlt;
        }
      }
    });

    if (status && activeSlide) {
      const title = activeSlide.dataset.projectTitle || 'Proyecto';
      status.textContent = announce ? `${title}. Proyecto activo.` : title;
    }
  }

  function finishTransition() {
    if (destroyed) return;
    transitionTimer = null;
    transitioning = false;
    root.classList.remove('is-transitioning');
    setControlsDisabled(false);
  }

  function move(direction) {
    if (transitioning || destroyed) return;
    const currentSlides = slides();
    if (currentSlides.length < 2) return;

    transitioning = true;
    root.classList.add('is-transitioning');
    setControlsDisabled(true);

    if (direction === 'next') slidesContainer.append(currentSlides[0]);
    else slidesContainer.prepend(currentSlides[currentSlides.length - 1]);

    syncState(true);

    const duration = reducedMotion.matches ? 60 : settings.transitionDuration;
    transitionTimer = window.setTimeout(finishTransition, duration);

    // Reset autoplay after manual navigation
    if (!reducedMotion.matches && !autoplayPaused) startAutoplay();
  }

  function onKeydown(event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move('previous');
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      move('next');
    }
  }

  function onPointerDown(event) {
    if (!event.isPrimary || transitioning) return;
    pointerId = event.pointerId;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
  }

  function resetPointer() {
    pointerId = null;
    pointerStartX = 0;
    pointerStartY = 0;
  }

  function promotePreview(targetIndex) {
    if (transitioning || destroyed) return;
    const count = targetIndex - 1;
    if (count <= 0) return;

    transitioning = true;
    root.classList.add('is-transitioning');
    setControlsDisabled(true);

    for (let i = 0; i < count; i++) {
      const s = slides();
      if (s.length < 2) break;
      slidesContainer.append(s[0]);
    }

    syncState(true);

    const duration = reducedMotion.matches ? 60 : settings.transitionDuration;
    transitionTimer = window.setTimeout(finishTransition, duration);

    if (!reducedMotion.matches && !autoplayPaused) startAutoplay();
  }

  function onPointerUp(event) {
    if (event.pointerId !== pointerId) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    const dragged = Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5;
    resetPointer();

    // Swipe
    if (Math.abs(deltaX) >= settings.swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      move(deltaX < 0 ? 'next' : 'previous');
      return;
    }

    // Preview click (only if pointer barely moved — not a drag)
    if (!dragged) {
      const slide = event.target.closest('.project-carousel__slide.is-preview');
      if (slide) {
        const currentSlides = slides();
        const previewIndex = currentSlides.indexOf(slide);
        if (previewIndex >= 2) promotePreview(previewIndex);
      }
    }
  }

  function onMotionChange() {
    root.classList.toggle('is-reduced-motion', reducedMotion.matches);
  }

  // ── Autoplay ──────────────────────────────────────────────
  const AUTOPLAY_INTERVAL = 5500;
  let autoplayTimer = null;
  let autoplayPaused = false;

  function stopAutoplay() {
    if (autoplayTimer !== null) {
      clearInterval(autoplayTimer);
      autoplayTimer = null;
    }
  }

  function startAutoplay() {
    if (destroyed) return;
    if (reducedMotion.matches) return;
    if (autoplayPaused) return;
    stopAutoplay();
    autoplayTimer = setInterval(() => move('next'), AUTOPLAY_INTERVAL);
  }

  function pauseAutoplay() {
    autoplayPaused = true;
    stopAutoplay();
  }

  function resumeAutoplay() {
    if (!autoplayPaused) return;
    autoplayPaused = false;
    startAutoplay();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      pauseAutoplay();
    } else {
      resumeAutoplay();
    }
  }

  listen(previousButton, 'click', () => move('previous'));
  listen(nextButton, 'click', () => move('next'));
  listen(root, 'keydown', onKeydown);
  listen(root, 'pointerdown', onPointerDown, { passive: true });
  listen(root, 'pointerup', onPointerUp, { passive: true });
  listen(root, 'pointercancel', resetPointer, { passive: true });
  listen(reducedMotion, 'change', onMotionChange);
  listen(root, 'pointerenter', pauseAutoplay);
  listen(root, 'pointerleave', resumeAutoplay);
  listen(document, 'visibilitychange', onVisibilityChange);

  syncState();
  onMotionChange();
  setControlsDisabled(false);
  startAutoplay();

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    stopAutoplay();
    if (transitionTimer !== null) clearTimeout(transitionTimer);
    removers.splice(0).forEach((remove) => remove());
    slides().forEach((slide) => {
      slide.classList.remove(
        'is-active',
        'is-underlay',
        'is-preview',
        'is-preview-near',
        'is-preview-rear',
      );
      slide.style.removeProperty('--preview-index');
      slide.removeAttribute('aria-hidden');
      slide.removeAttribute('inert');
    });
    root.classList.remove('is-enhanced', 'is-transitioning', 'is-reduced-motion');
    root.removeAttribute('aria-busy');
    previousButton.disabled = false;
    nextButton.disabled = false;
    if (carouselInstances.get(root) === cleanup) carouselInstances.delete(root);
  }

  carouselInstances.set(root, cleanup);
  return cleanup;
}
