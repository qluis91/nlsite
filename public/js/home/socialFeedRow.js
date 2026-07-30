const FALLBACK = '/images/social-feed-fallback.svg';

export function initSocialFeedRow(root) {
  if (!root) return () => {};
  const viewport = root.querySelector('[data-social-feed-viewport]');
  const cards = [...root.querySelectorAll('[data-social-feed-card]')];
  const previous = root.querySelector('[data-social-feed-prev]');
  const next = root.querySelector('[data-social-feed-next]');
  const status = root.querySelector('[data-social-feed-status]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cleanups = [];

  root.querySelectorAll('[data-social-feed-thumbnail]').forEach((image) => {
    const onError = () => {
      if (image.dataset.fallbackApplied === 'true') return;
      image.dataset.fallbackApplied = 'true';
      image.src = image.dataset.fallbackSrc || FALLBACK;
    };
    image.addEventListener('error', onError);
    cleanups.push(() => image.removeEventListener('error', onError));
  });

  function currentIndex() {
    if (!viewport || !cards.length) return 0;
    const left = viewport.getBoundingClientRect().left;
    let closest = 0;
    let distance = Infinity;
    cards.forEach((card, index) => {
      const nextDistance = Math.abs(card.getBoundingClientRect().left - left);
      if (nextDistance < distance) {
        closest = index;
        distance = nextDistance;
      }
    });
    return closest;
  }

  function go(delta) {
    if (!viewport || !cards.length) return;
    const targetIndex = Math.min(cards.length - 1, Math.max(0, currentIndex() + delta));
    cards[targetIndex].scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'start',
    });
    if (status) status.textContent = `Publicación ${targetIndex + 1} de ${cards.length}`;
  }

  const onPrevious = () => go(-1);
  const onNext = () => go(1);
  const onKeydown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    go(event.key === 'ArrowLeft' ? -1 : 1);
  };
  previous?.addEventListener('click', onPrevious);
  next?.addEventListener('click', onNext);
  viewport?.addEventListener('keydown', onKeydown);

  return () => {
    previous?.removeEventListener('click', onPrevious);
    next?.removeEventListener('click', onNext);
    viewport?.removeEventListener('keydown', onKeydown);
    cleanups.forEach((cleanup) => cleanup());
  };
}
