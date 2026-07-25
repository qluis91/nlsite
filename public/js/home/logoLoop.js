const logoLoopInstances = new WeakMap();

const DEFAULT_OPTIONS = {
  speed: 85,
  direction: 'left',
  gap: 72,
  logoHeight: 56,
  hoverSpeed: 0,
  scaleOnHover: true,
  fadeOut: true,
  fadeOutColor: 'rgba(92, 100, 96, 0.35)',
  smoothTau: 0.22,
};

export function initLogoLoop(root, options = {}) {
  if (!root) return () => {};
  if (logoLoopInstances.has(root)) return logoLoopInstances.get(root);

  const settings = { ...DEFAULT_OPTIONS, ...options };
  const viewport = root.querySelector('.logo-loop__viewport');
  const track = root.querySelector('[data-logo-loop-track]');
  const sequence = root.querySelector('[data-logo-loop-sequence]');

  if (!viewport || !track || !sequence) return () => {};

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const removers = [];
  let resizeObserver = null;
  let rafId = null;
  let lastTime = 0;
  let segmentWidth = 0;
  let offset = 0;
  let velocity = 0;
  let targetVelocity = 0;
  let hovering = false;
  let destroyed = false;

  root.classList.add('is-enhanced');
  root.classList.toggle('logo-loop--scale-on-hover', settings.scaleOnHover);
  root.classList.toggle('logo-loop--fade', settings.fadeOut);
  root.style.setProperty('--logo-loop-fade-color', settings.fadeOutColor);

  function listen(target, event, handler, eventOptions) {
    target.addEventListener(event, handler, eventOptions);
    removers.push(() => target.removeEventListener(event, handler, eventOptions));
  }

  function responsiveFactor() {
    const width = viewport.clientWidth;
    if (width <= 480) return 0.64;
    if (width <= 768) return 0.78;
    if (width <= 1100) return 0.88;
    return 1;
  }

  function signedSpeed(speed) {
    return (settings.direction === 'right' ? 1 : -1) * speed * responsiveFactor();
  }

  function updateTargetVelocity() {
    const speed = hovering ? settings.hoverSpeed : settings.speed;
    targetVelocity = reducedMotion.matches ? 0 : signedSpeed(speed);
  }

  function removeClones() {
    track.querySelectorAll('[data-logo-loop-clone]').forEach((clone) => clone.remove());
  }

  function makeClone() {
    const clone = sequence.cloneNode(true);
    clone.removeAttribute('data-logo-loop-sequence');
    clone.setAttribute('data-logo-loop-clone', '');
    clone.setAttribute('aria-hidden', 'true');
    clone.querySelectorAll('a, button, input, select, textarea, [tabindex]').forEach((element) => {
      element.setAttribute('tabindex', '-1');
    });
    return clone;
  }

  function measure() {
    if (destroyed) return;

    const factor = responsiveFactor();
    const previousWidth = segmentWidth;
    const previousProgress = previousWidth ? offset / previousWidth : 0;
    const gap = Math.max(32, Math.round(settings.gap * factor));
    const height = Math.max(36, Math.round(settings.logoHeight * factor));

    root.style.setProperty('--logo-loop-gap', `${gap}px`);
    root.style.setProperty('--logo-loop-height', `${height}px`);

    removeClones();
    segmentWidth = sequence.getBoundingClientRect().width + gap;
    if (!segmentWidth) return;

    const copies = Math.max(2, Math.ceil(viewport.clientWidth / segmentWidth) + 2);
    const fragment = document.createDocumentFragment();
    for (let index = 1; index < copies; index += 1) fragment.append(makeClone());
    track.append(fragment);

    offset = previousWidth ? previousProgress * segmentWidth : (settings.direction === 'right' ? -segmentWidth : 0);
    track.style.transform = `translate3d(${offset}px, 0, 0)`;
    updateTargetVelocity();
  }

  function normalizeOffset() {
    if (!segmentWidth) return;
    while (offset <= -segmentWidth) offset += segmentWidth;
    while (offset > 0) offset -= segmentWidth;
  }

  function frame(now) {
    rafId = null;
    if (destroyed || reducedMotion.matches || document.hidden) return;

    if (!lastTime) lastTime = now;
    const deltaTime = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const easingFactor = 1 - Math.exp(-deltaTime / settings.smoothTau);
    velocity += (targetVelocity - velocity) * easingFactor;
    offset += velocity * deltaTime;
    normalizeOffset();
    track.style.transform = `translate3d(${offset}px, 0, 0)`;
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (rafId !== null || destroyed || reducedMotion.matches || document.hidden) return;
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    lastTime = 0;
  }

  function onMotionChange() {
    root.classList.toggle('is-reduced-motion', reducedMotion.matches);
    updateTargetVelocity();
    if (reducedMotion.matches) {
      stop();
      velocity = 0;
      offset = 0;
      track.style.transform = 'translate3d(0, 0, 0)';
    } else {
      measure();
      start();
    }
  }

  function onVisibilityChange() {
    if (document.hidden) stop();
    else start();
  }

  listen(root, 'pointerenter', () => {
    hovering = true;
    updateTargetVelocity();
  });
  listen(root, 'pointerleave', () => {
    hovering = false;
    updateTargetVelocity();
  });
  listen(document, 'visibilitychange', onVisibilityChange);
  listen(reducedMotion, 'change', onMotionChange);

  sequence.querySelectorAll('img').forEach((image) => {
    if (!image.complete) listen(image, 'load', measure, { once: true });
  });

  resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(viewport);
  measure();
  onMotionChange();

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    stop();
    resizeObserver?.disconnect();
    removers.splice(0).forEach((remove) => remove());
    removeClones();
    track.style.removeProperty('transform');
    root.classList.remove('is-enhanced', 'logo-loop--scale-on-hover', 'logo-loop--fade', 'is-reduced-motion');
    if (logoLoopInstances.get(root) === cleanup) logoLoopInstances.delete(root);
  }

  logoLoopInstances.set(root, cleanup);
  return cleanup;
}
