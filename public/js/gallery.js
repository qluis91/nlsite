import { initNavbar } from './home/navbar.js';
import { initAntigravityBackground } from './home/antigravityBackground.js';
import { initGalleryAnimations } from './gallery/galleryAnimations.mjs';
import { createGalleryViewer } from './gallery/galleryViewer.mjs';

const page = document.querySelector('[data-gallery-page]');

if (page) {
  page.classList.add('is-enhanced');
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const cleanupNavbar = initNavbar();
  const visualZone = page.querySelector('[data-gallery-visual-zone]');
  const antigravityController = initAntigravityBackground(
    visualZone?.querySelector('[data-antigravity-canvas]'),
    { reducedMotion: prefersReducedMotion, container: visualZone },
  );
  if (!prefersReducedMotion) antigravityController.resume();

  let cleanupModes = () => {};
  let animationController = null;
  let pageDestroyed = false;

  function parseGalleryData(id) {
    try {
      const parsed = JSON.parse(document.getElementById(id)?.textContent || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const items = parseGalleryData('gallery-data');
  const videoItems = parseGalleryData('gallery-video-data');
  const viewerItems = items.slice();
  const viewerIds = new Set(viewerItems.map((item) => Number(item.id)));
  videoItems.forEach((item) => {
    const id = Number(item.id);
    if (!viewerIds.has(id)) {
      viewerIds.add(id);
      viewerItems.push(item);
    }
  });

  const animationProxy = {
    openViewer: (options) => animationController?.openViewer(options),
    closeViewer: (options) => animationController?.closeViewer(options),
    cancelViewer: () => animationController?.cancelViewer(),
  };
  const viewer = createGalleryViewer({
    page,
    items: viewerItems,
    animations: animationProxy,
  });

  const categoryForm = page.querySelector('[data-gallery-category-form]');
  const categorySelect = page.querySelector('[data-gallery-category-select]');
  const onCategoryChange = () => {
    if (typeof categoryForm?.requestSubmit === 'function') categoryForm.requestSubmit();
    else categoryForm?.submit();
  };
  categorySelect?.addEventListener('change', onCategoryChange);

  Promise.all([
    initGalleryAnimations({ page, reducedMotion: prefersReducedMotion }),
    import('./gallery/galleryModes.mjs'),
  ])
    .then(([animations, { setupGalleryModes }]) => {
      animationController = animations;
      if (pageDestroyed) {
        animations.destroy();
        return;
      }
      cleanupModes = setupGalleryModes({
        page,
        items: items.slice(),
        videoItems: videoItems.slice(),
        openGalleryItemById: viewer.openGalleryItemById,
        dependencies: {
          transitions: animations.modeTransitions,
        },
      });
    })
    .catch((error) => {
      page.classList.add('is-gallery-motion-ready');
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.warn('[Gallery] Enhanced modes could not be loaded.', error?.message || 'Unknown error');
      }
    });

  window.addEventListener('pagehide', () => {
    pageDestroyed = true;
    categorySelect?.removeEventListener('change', onCategoryChange);
    viewer.destroy();
    cleanupModes();
    animationController?.destroy();
    cleanupNavbar();
    antigravityController.destroy();
  }, { once: true });
}
