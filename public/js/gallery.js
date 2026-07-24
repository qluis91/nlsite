const page = document.querySelector('[data-gallery-page]');

if (page) {
  page.classList.add('is-enhanced');

  const dataNode = document.getElementById('gallery-data');
  let items = [];
  try {
    const parsed = JSON.parse(dataNode?.textContent || '[]');
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    items = [];
  }

  const modal = page.querySelector('[data-gallery-modal]');
  const dialog = page.querySelector('[data-gallery-dialog]');
  const stage = page.querySelector('[data-gallery-stage]');
  const status = page.querySelector('[data-gallery-status]');
  const image = page.querySelector('[data-gallery-image]');
  const video = page.querySelector('[data-gallery-video]');
  const title = page.querySelector('[data-gallery-title]');
  const description = page.querySelector('[data-gallery-description]');
  const category = page.querySelector('[data-gallery-category]');
  const position = page.querySelector('[data-gallery-position]');
  const previous = page.querySelector('[data-gallery-previous]');
  const next = page.querySelector('[data-gallery-next]');
  const openButtons = [...page.querySelectorAll('[data-gallery-open]')];
  let currentIndex = -1;
  let previousFocus = null;

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
    if (!items.length) return;
    currentIndex = (index + items.length) % items.length;
    const item = items[currentIndex];
    pauseAndClearVideo();
    clearImage();
    showStatus('Cargando medio…');
    title.textContent = item.title || '';
    description.textContent = item.description || '';
    description.hidden = !item.description;
    if (!item.description) dialog.removeAttribute('aria-describedby');
    else dialog.setAttribute('aria-describedby', 'gallery-modal-description');
    category.textContent = item.category || '';
    category.hidden = !item.category;
    position.textContent = `${currentIndex + 1} de ${items.length}`;
    previous.disabled = items.length < 2;
    next.disabled = items.length < 2;

    if (item.type === 'video') {
      video.poster = item.poster || item.thumbnail || '';
      video.src = item.source;
      video.hidden = false;
      video.addEventListener('loadedmetadata', () => {
        status.hidden = true;
        stage.classList.remove('has-error');
      }, { once: true });
      video.addEventListener('error', () => {
        pauseAndClearVideo();
        showStatus('No fue posible cargar este video.', true);
      }, { once: true });
    } else {
      image.alt = item.alt || '';
      image.src = item.source;
      image.hidden = false;
      image.addEventListener('load', () => {
        status.hidden = true;
        stage.classList.remove('has-error');
      }, { once: true });
      image.addEventListener('error', () => {
        clearImage();
        showStatus('No fue posible cargar esta imagen.', true);
      }, { once: true });
    }
  }

  function openModal(index, origin) {
    if (!modal || !dialog || index < 0 || index >= items.length) return;
    previousFocus = origin || document.activeElement;
    modal.hidden = false;
    document.body.classList.add('is-gallery-modal-open');
    renderItem(index);
    dialog.focus({ preventScroll: true });
  }

  function openGalleryItemById(id, origin) {
    const index = items.findIndex((item) => Number(item.id) === Number(id));
    openModal(index, origin);
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    pauseAndClearVideo();
    clearImage();
    modal.hidden = true;
    document.body.classList.remove('is-gallery-modal-open');
    const focusTarget = previousFocus;
    previousFocus = null;
    currentIndex = -1;
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
  }

  function focusableElements() {
    return [...dialog.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden);
  }

  openButtons.forEach((button) => {
    button.addEventListener('click', () => {
      openGalleryItemById(button.dataset.galleryId, button);
    });
  });

  page.querySelectorAll('[data-gallery-close]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });
  previous?.addEventListener('click', () => renderItem(currentIndex - 1));
  next?.addEventListener('click', () => renderItem(currentIndex + 1));

  document.addEventListener('keydown', (event) => {
    if (!modal || modal.hidden) return;
    // Let video player native controls handle arrow keys
    if (document.activeElement?.tagName === 'VIDEO' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      return;
    }
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

  openButtons.forEach((button) => {
    const thumbnail = button.querySelector('[data-gallery-thumbnail]');
    thumbnail?.addEventListener('error', () => {
      thumbnail.hidden = true;
      button.classList.add('has-broken-thumbnail');
    }, { once: true });
  });

  import('./gallery/galleryModes.mjs')
    .then(({ setupGalleryModes }) => {
      setupGalleryModes({ page, items: items.slice(), openGalleryItemById });
    })
    .catch((error) => {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.warn('[Gallery] Enhanced modes could not be loaded.', error?.message || 'Unknown error');
      }
    });
}
