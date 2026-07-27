export function createGalleryViewer({
  page,
  items = [],
  animations,
} = {}) {
  const modal = page?.querySelector('[data-gallery-modal]');
  const dialog = page?.querySelector('[data-gallery-dialog]');
  const stage = page?.querySelector('[data-gallery-stage]');
  const status = page?.querySelector('[data-gallery-status]');
  const image = page?.querySelector('[data-gallery-image]');
  const video = page?.querySelector('[data-gallery-video]');
  const title = page?.querySelector('[data-gallery-title]');
  const description = page?.querySelector('[data-gallery-description]');
  const category = page?.querySelector('[data-gallery-category]');
  const position = page?.querySelector('[data-gallery-position]');
  const previous = page?.querySelector('[data-gallery-previous]');
  const next = page?.querySelector('[data-gallery-next]');
  if (!modal || !dialog || !stage || !status || !image || !video) {
    return {
      openGalleryItemById() {},
      close: async () => {},
      destroy() {},
    };
  }

  const viewerAnimations = animations || {
    openViewer: async () => {},
    closeViewer: async () => {},
    cancelViewer() {},
  };
  const removers = [];
  const mediaRemovers = [];
  let currentIndex = -1;
  let previousFocus = null;
  let transitionGeneration = 0;
  let closingPromise = null;
  let destroyed = false;

  function listen(target, name, handler, options) {
    if (!target) return;
    target.addEventListener(name, handler, options);
    removers.push(() => target.removeEventListener(name, handler, options));
  }

  function listenMedia(target, name, handler) {
    target.addEventListener(name, handler, { once: true });
    mediaRemovers.push(() => target.removeEventListener(name, handler));
  }

  function clearMediaListeners() {
    mediaRemovers.splice(0).forEach((remove) => remove());
  }

  function pauseAndClearVideo() {
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.load();
    video.hidden = true;
  }

  function clearImage() {
    image.removeAttribute('src');
    image.alt = '';
    image.hidden = true;
  }

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.hidden = false;
    stage.classList.toggle('has-error', isError);
  }

  function renderItem(index) {
    if (!items.length || destroyed) return;
    clearMediaListeners();
    currentIndex = (index + items.length) % items.length;
    const item = items[currentIndex];
    pauseAndClearVideo();
    clearImage();
    showStatus('Cargando medio…');
    if (title) title.textContent = item.title || '';
    if (description) {
      description.textContent = item.description || '';
      description.hidden = !item.description;
    }
    if (!item.description) dialog.removeAttribute('aria-describedby');
    else dialog.setAttribute('aria-describedby', 'gallery-modal-description');
    if (category) {
      category.textContent = item.category || '';
      category.hidden = !item.category;
    }
    if (position) position.textContent = `${currentIndex + 1} de ${items.length}`;
    if (previous) previous.disabled = items.length < 2;
    if (next) next.disabled = items.length < 2;

    if (item.type === 'video') {
      video.poster = item.poster || item.thumbnail || '';
      video.src = item.source;
      video.hidden = false;
      listenMedia(video, 'loadedmetadata', () => {
        status.hidden = true;
        stage.classList.remove('has-error');
      });
      listenMedia(video, 'error', () => {
        pauseAndClearVideo();
        showStatus('No fue posible cargar este video.', true);
      });
    } else {
      image.alt = item.alt || '';
      image.src = item.source;
      image.hidden = false;
      listenMedia(image, 'load', () => {
        status.hidden = true;
        stage.classList.remove('has-error');
      });
      listenMedia(image, 'error', () => {
        clearImage();
        showStatus('No fue posible cargar esta imagen.', true);
      });
    }
  }

  async function openModal(index, origin) {
    if (destroyed || index < 0 || index >= items.length) return;
    transitionGeneration += 1;
    viewerAnimations.cancelViewer?.();
    closingPromise = null;
    previousFocus = origin || document.activeElement;
    modal.hidden = false;
    document.body.classList.add('is-gallery-modal-open');
    renderItem(index);
    dialog.focus({ preventScroll: true });
    const animationOrigin = previousFocus?.querySelector?.('[data-gallery-thumbnail]')
      || previousFocus;
    await viewerAnimations.openViewer({ modal, dialog, origin: animationOrigin });
  }

  function openGalleryItemById(id, origin) {
    const index = items.findIndex((item) => Number(item.id) === Number(id));
    return openModal(index, origin);
  }

  async function closeModal() {
    if (destroyed || modal.hidden) return;
    if (closingPromise) return closingPromise;
    const generation = ++transitionGeneration;
    const focusTarget = previousFocus;
    video.pause();
    closingPromise = (async () => {
      await viewerAnimations.closeViewer({ modal, dialog, origin: focusTarget });
      if (destroyed || generation !== transitionGeneration) return;
      clearMediaListeners();
      pauseAndClearVideo();
      clearImage();
      modal.hidden = true;
      document.body.classList.remove('is-gallery-modal-open');
      previousFocus = null;
      currentIndex = -1;
      closingPromise = null;
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    })();
    return closingPromise;
  }

  function focusableElements() {
    return [...dialog.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden);
  }

  page.querySelectorAll('[data-gallery-open]').forEach((button) => {
    listen(button, 'click', () => openGalleryItemById(button.dataset.galleryId, button));
    const thumbnail = button.querySelector('[data-gallery-thumbnail]');
    listen(thumbnail, 'error', () => {
      thumbnail.hidden = true;
      button.classList.add('has-broken-thumbnail');
    }, { once: true });
  });
  page.querySelectorAll('[data-gallery-close]').forEach((button) => {
    listen(button, 'click', closeModal);
  });
  listen(previous, 'click', () => renderItem(currentIndex - 1));
  listen(next, 'click', () => renderItem(currentIndex + 1));
  listen(document, 'keydown', (event) => {
    if (modal.hidden) return;
    if (
      document.activeElement?.tagName === 'VIDEO'
      && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      renderItem(currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      renderItem(currentIndex + 1);
    } else if (event.key === 'Tab') {
      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  return {
    openGalleryItemById,
    close: closeModal,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      transitionGeneration += 1;
      viewerAnimations.cancelViewer?.();
      clearMediaListeners();
      removers.splice(0).forEach((remove) => remove());
      pauseAndClearVideo();
      clearImage();
      modal.hidden = true;
      document.body.classList.remove('is-gallery-modal-open');
      previousFocus = null;
      currentIndex = -1;
    },
  };
}
