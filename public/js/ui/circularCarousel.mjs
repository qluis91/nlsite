/**
 * Circular Carousel — Generic DOM-based carousel interaction controller.
 * Uses continuous positions with front-facing visual slots (no WebGL).
 * Supports horizontal drag, keyboard, snap, pause/resume, reduced-motion,
 * seamless wrapping, and a complete destroy lifecycle.
 *
 * Multiple instances can exist independently.
 */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function safeModulo(value, length) {
  if (!length) return 0;
  return ((Math.round(value) % length) + length) % length;
}

function continuousModulo(value, length) {
  if (!length) return 0;
  return ((value % length) + length) % length;
}

export function wrappedDistance(index, position, count) {
  if (!count) return 0;
  let distance = index - position;
  distance -= Math.round(distance / count) * count;
  return distance;
}

const DESKTOP_SLOTS = Object.freeze({
  '-2': Object.freeze({ xRatio: -0.43, y: 12, scale: 0.88, opacity: 0.76, zIndex: 1 }),
  '-1': Object.freeze({ xRatio: -0.22, y: 4, scale: 0.96, opacity: 0.92, zIndex: 2 }),
  '0': Object.freeze({ xRatio: 0, y: 0, scale: 1, opacity: 1, zIndex: 4 }),
  '1': Object.freeze({ xRatio: 0.22, y: 4, scale: 0.96, opacity: 0.92, zIndex: 2 }),
  '2': Object.freeze({ xRatio: 0.43, y: 12, scale: 0.88, opacity: 0.76, zIndex: 1 }),
});

const TABLET_SLOTS = Object.freeze({
  '-1': Object.freeze({ xRatio: -0.31, y: 6, scale: 0.92, opacity: 0.86, zIndex: 2 }),
  '0': DESKTOP_SLOTS['0'],
  '1': Object.freeze({ xRatio: 0.31, y: 6, scale: 0.92, opacity: 0.86, zIndex: 2 }),
});

const MOBILE_SLOTS = Object.freeze({
  '-1': Object.freeze({ xRatio: -0.52, y: 8, scale: 0.9, opacity: 0.8, zIndex: 2 }),
  '0': DESKTOP_SLOTS['0'],
  '1': Object.freeze({ xRatio: 0.52, y: 8, scale: 0.9, opacity: 0.8, zIndex: 2 }),
});

const DESKTOP_EXIT = Object.freeze({
  negative: Object.freeze({ xRatio: -0.54, y: 18, scale: 0.84, opacity: 0 }),
  positive: Object.freeze({ xRatio: 0.54, y: 18, scale: 0.84, opacity: 0 }),
});

const TABLET_EXIT = Object.freeze({
  negative: Object.freeze({ xRatio: -0.46, y: 12, scale: 0.86, opacity: 0 }),
  positive: Object.freeze({ xRatio: 0.46, y: 12, scale: 0.86, opacity: 0 }),
});

const MOBILE_EXIT = Object.freeze({
  negative: Object.freeze({ xRatio: -0.7, y: 14, scale: 0.84, opacity: 0 }),
  positive: Object.freeze({ xRatio: 0.7, y: 14, scale: 0.84, opacity: 0 }),
});

const DESKTOP_LAYOUT = Object.freeze({
  slots: DESKTOP_SLOTS,
  exit: DESKTOP_EXIT,
  maxVisibleDistance: 2,
  fadeBoundary: 2.6,
});

const TABLET_LAYOUT = Object.freeze({
  slots: TABLET_SLOTS,
  exit: TABLET_EXIT,
  maxVisibleDistance: 1,
  fadeBoundary: 1.6,
});

const MOBILE_LAYOUT = Object.freeze({
  slots: MOBILE_SLOTS,
  exit: MOBILE_EXIT,
  maxVisibleDistance: 1,
  fadeBoundary: 1.6,
});

function layoutForMode(mode) {
  if (mode === 'mobile') return MOBILE_LAYOUT;
  if (mode === 'tablet') return TABLET_LAYOUT;
  return DESKTOP_LAYOUT;
}

export function interpolateSlotPresentation(distance, mode = 'desktop', output = {}) {
  const config = layoutForMode(mode);
  const absoluteDistance = Math.abs(distance);
  if (absoluteDistance >= config.fadeBoundary) return false;

  let from;
  let to;
  let progress;

  if (absoluteDistance > config.maxVisibleDistance) {
    const side = distance < 0 ? 'negative' : 'positive';
    from = config.slots[String((distance < 0 ? -1 : 1) * config.maxVisibleDistance)];
    to = config.exit[side];
    progress = (absoluteDistance - config.maxVisibleDistance)
      / (config.fadeBoundary - config.maxVisibleDistance);
  } else {
    const lowerDistance = Math.floor(distance);
    const upperDistance = Math.ceil(distance);
    from = config.slots[String(lowerDistance)];
    to = config.slots[String(upperDistance)];
    progress = distance - lowerDistance;
  }

  output.xRatio = lerp(from.xRatio, to.xRatio, progress);
  output.y = lerp(from.y, to.y, progress);
  output.scale = lerp(from.scale, to.scale, progress);
  output.opacity = lerp(from.opacity, to.opacity, progress);
  output.zIndex = Math.max(1, Math.round((config.fadeBoundary - absoluteDistance) * 100));
  return true;
}

const SETTLE_EPSILON = 0.002;
const POSITION_REBASE_LIMIT = 6000;

export function createCircularCarousel(options = {}) {
  const {
    root,
    items = [],
    renderItem,
    onActiveChange = () => {},
    cardWidth = 280,
    cardHeight = 470,
    tabletCardWidth = 250,
    tabletCardHeight = 440,
    mobileCardWidth = 280,
    mobileCardHeight = 430,
    snapAngle = true,
    reducedMotion = false,
    positionEase = 0.1,
  } = options;

  if (!root) throw new Error('CircularCarousel requires a root element.');
  if (!Array.isArray(items) || items.length === 0)
    throw new Error('CircularCarousel requires at least one item.');
  if (typeof renderItem !== 'function')
    throw new Error('CircularCarousel requires a renderItem function.');

  // Copies — no shared mutation with caller
  const ownedItems = items.slice();

  // ── State ──
  let destroyed = false;
  let rafId = null;
  const pauseReasons = new Set();
  let currentPosition = 0;
  let targetPosition = 0;
  let lastPosition = 0;
  let activeIndex = -1;
  let dragPixelsPerItem = cardWidth * 0.8;
  const pointer = {
    active: false,
    axis: null,
    moved: false,
    id: null,
    startX: 0,
    startY: 0,
    startPosition: 0,
    lastPosition: 0,
    lastTime: 0,
    velocity: 0,
  };
  let resizeObserver = null;
  let intersectionObserver = null;
  const allRemovers = [];

  // ── DOM ──
  const cardElements = [];
  const presentationStates = [];

  const stage = document.createElement('div');
  stage.className = 'circ-carousel__stage';
  stage.setAttribute('data-circ-carousel-generated', '');
  root.appendChild(stage);

  const track = document.createElement('div');
  track.className = 'circ-carousel__track';
  track.setAttribute('data-circ-carousel-generated', '');
  stage.appendChild(track);

  ownedItems.forEach((item, index) => {
    const card = renderItem(item, index);
    const existing = card.className || '';
    card.className = `${existing} circ-carousel__card`.trim();
    card.setAttribute('data-circ-carousel-generated', '');
    card.setAttribute('data-circ-index', String(index));
    track.appendChild(card);
    cardElements.push(card);
    presentationStates.push({ xRatio: 0, y: 0, scale: 1, opacity: 0, zIndex: 1 });
  });

  // ── Helpers ──
  function listen(target, event, handler, eventOptions) {
    target.addEventListener(event, handler, eventOptions);
    allRemovers.push(() => target.removeEventListener(event, handler, eventOptions));
  }

  function normalizedIndex(position = targetPosition) {
    return safeModulo(position, ownedItems.length);
  }

  function setCardVisibility(card, visible) {
    if (card.__circVisible === visible) return;
    card.__circVisible = visible;
    if (visible) {
      card.style.display = '';
      card.removeAttribute('aria-hidden');
      card.inert = false;
      return;
    }

    card.style.display = 'none';
    card.setAttribute('aria-hidden', 'true');
    card.inert = true;
    card.removeAttribute('aria-current');
    card.classList.remove('circ-carousel__card--active');
  }

  function updateActive(force = false) {
    if (!force) {
      if (pointer.active || Math.abs(currentPosition - targetPosition) > SETTLE_EPSILON) return;
      if (Math.abs(targetPosition - Math.round(targetPosition)) > SETTLE_EPSILON) return;
    }
    const nextIndex = normalizedIndex(targetPosition);
    if (!force && nextIndex === activeIndex) return;
    activeIndex = nextIndex;
    for (let index = 0; index < cardElements.length; index += 1) {
      const card = cardElements[index];
      if (index === activeIndex) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    }
    onActiveChange(ownedItems[activeIndex], activeIndex, ownedItems.length);
  }

  function rebasePositionIfIdle() {
    if (pointer.active || Math.abs(currentPosition - targetPosition) > SETTLE_EPSILON) return;
    if (Math.abs(targetPosition) < POSITION_REBASE_LIMIT) return;
    const offset = Math.trunc(targetPosition / ownedItems.length) * ownedItems.length;
    currentPosition -= offset;
    targetPosition -= offset;
    lastPosition -= offset;
  }

  // ── Layout ──
  function layout() {
    if (destroyed || ownedItems.length === 0) return;

    const stageWidth = stage.offsetWidth || root.clientWidth || 1;
    const stageHeight = stage.offsetHeight || root.clientHeight || 1;
    const viewportWidth = window.innerWidth || stageWidth;

    const isMobile = viewportWidth <= 767;
    const isTablet = viewportWidth >= 768 && viewportWidth < 1200;
    const mode = isMobile ? 'mobile' : (isTablet ? 'tablet' : 'desktop');
    const currentCardWidth = isMobile
      ? Math.min(mobileCardWidth, Math.max(220, stageWidth - 64))
      : (isTablet ? tabletCardWidth : cardWidth);
    const currentCardHeight = isMobile
      ? mobileCardHeight
      : (isTablet ? tabletCardHeight : cardHeight);
    const totalItems = ownedItems.length;
    dragPixelsPerItem = Math.max(160, currentCardWidth * 0.82);

    for (let i = 0; i < cardElements.length; i += 1) {
      const card = cardElements[i];
      const distance = wrappedDistance(i, currentPosition, totalItems);
      const presentation = presentationStates[i];
      if (!interpolateSlotPresentation(distance, mode, presentation)) {
        setCardVisibility(card, false);
        continue;
      }

      const x = stageWidth / 2 + stageWidth * presentation.xRatio - currentCardWidth / 2;
      const y = stageHeight / 2 - currentCardHeight / 2 + presentation.y;
      setCardVisibility(card, true);
      card.style.position = 'absolute';
      card.style.left = '0';
      card.style.top = '0';
      card.style.width = `${currentCardWidth}px`;
      card.style.height = `${currentCardHeight}px`;
      card.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${presentation.scale})`;
      card.style.opacity = String(presentation.opacity);
      card.style.zIndex = String(presentation.zIndex);

      if (Math.abs(distance) < 0.5) {
        card.classList.add('circ-carousel__card--active');
      } else {
        card.classList.remove('circ-carousel__card--active');
      }

      if (i === activeIndex) {
        card.setAttribute('aria-current', 'true');
      } else {
        card.removeAttribute('aria-current');
      }
    }
  }

  // ── Snap ──
  function snap() {
    if (ownedItems.length <= 1) targetPosition = 0;
    else targetPosition = Math.round(targetPosition);
    scheduleRAF();
  }

  function moveBy(delta) {
    if (!Number.isFinite(delta) || ownedItems.length <= 1) return;
    targetPosition += delta;
    scheduleRAF();
  }

  function goTo(index, direction = 0) {
    if (!Number.isFinite(index) || ownedItems.length <= 1) return;
    const destination = safeModulo(index, ownedItems.length);
    const origin = continuousModulo(targetPosition, ownedItems.length);
    let delta = destination - origin;

    if (direction > 0 && delta <= 0) delta += ownedItems.length;
    else if (direction < 0 && delta >= 0) delta -= ownedItems.length;
    else if (direction === 0) {
      if (delta > ownedItems.length / 2) delta -= ownedItems.length;
      if (delta < -ownedItems.length / 2) delta += ownedItems.length;
    }

    targetPosition += delta;
    scheduleRAF();
  }

  // ── Frame ──
  function frame() {
    rafId = null;
    if (destroyed || pauseReasons.size) return;

    if (reducedMotion) {
      currentPosition = targetPosition;
    } else {
      const ease = pointer.active && pointer.axis === 'horizontal'
        ? Math.max(positionEase, 0.22)
        : positionEase;
      currentPosition = lerp(currentPosition, targetPosition, ease);
      if (Math.abs(currentPosition - targetPosition) < SETTLE_EPSILON) {
        currentPosition = targetPosition;
      }
    }

    layout();
    lastPosition = currentPosition;
    updateActive();
    rebasePositionIfIdle();

    if (Math.abs(currentPosition - targetPosition) > SETTLE_EPSILON
      || (pointer.active && pointer.axis === 'horizontal')) {
      scheduleRAF();
    }
  }

  function scheduleRAF() {
    if (destroyed || pauseReasons.size || rafId !== null) return;
    rafId = requestAnimationFrame(frame);
  }

  // ── Input handlers ──
  function onPointerDown(event) {
    if (destroyed || event.button > 0 || event.target.closest?.('button, a')) return;
    if (ownedItems.length <= 1) return;
    pointer.active = true;
    pointer.axis = null;
    pointer.moved = false;
    pointer.id = event.pointerId;
    pointer.startX = event.clientX;
    pointer.startY = event.clientY;
    targetPosition = currentPosition;
    pointer.startPosition = currentPosition;
    pointer.lastPosition = currentPosition;
    pointer.lastTime = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
    pointer.velocity = 0;
  }

  function onPointerMove(event) {
    if (!pointer.active || event.pointerId !== pointer.id || ownedItems.length <= 1) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;

    if (pointer.axis === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 7) return;
      if (Math.abs(dx) <= Math.abs(dy) + 5) {
        pointer.active = false;
        pointer.axis = 'vertical';
        pointer.id = null;
        return;
      }
      pointer.axis = 'horizontal';
      pointer.moved = true;
      root.setPointerCapture?.(event.pointerId);
      root.classList.add('circ-carousel--dragging');
    }

    if (pointer.axis !== 'horizontal') return;
    event.preventDefault?.();
    targetPosition = pointer.startPosition - dx / dragPixelsPerItem;
    const now = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
    const elapsed = Math.max(1, now - pointer.lastTime);
    const instantVelocity = (targetPosition - pointer.lastPosition) / elapsed;
    pointer.velocity = lerp(pointer.velocity, instantVelocity, 0.35);
    pointer.lastPosition = targetPosition;
    pointer.lastTime = now;
    scheduleRAF();
  }

  function onPointerUp(event) {
    if (!pointer.active || event.pointerId !== pointer.id) return;
    const wasHorizontal = pointer.axis === 'horizontal';
    if (wasHorizontal) root.releasePointerCapture?.(event.pointerId);
    pointer.active = false;
    pointer.id = null;
    pointer.axis = null;
    root.classList.remove('circ-carousel--dragging');
    if (wasHorizontal && pointer.moved) {
      if (!reducedMotion && event.type !== 'pointercancel') {
        const momentum = Math.max(-0.45, Math.min(0.45, pointer.velocity * 180));
        targetPosition += momentum;
      }
      if (snapAngle) snap();
      else scheduleRAF();
    }
  }

  function onKeyDown(event) {
    if (ownedItems.length <= 1) return;
    let handled = true;
    if (event.key === 'ArrowRight') moveBy(1);
    else if (event.key === 'ArrowLeft') moveBy(-1);
    else if (event.key === 'Home') goTo(0);
    else { handled = false; }

    if (handled) {
      event.preventDefault();
    }
  }

  function onVisibilityChange() {
    if (document.hidden) pause('visibility');
    else resume('visibility');
  }

  // ── Lifecycle ──
  function pause(reason = 'manual') {
    if (destroyed) return;
    pauseReasons.add(reason);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function resume(reason = 'manual') {
    if (destroyed) return;
    pauseReasons.delete(reason);
    scheduleRAF();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;

    if (rafId !== null) cancelAnimationFrame(rafId);

    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();

    allRemovers.forEach((remove) => { try { remove(); } catch (_) { /* best-effort */ } });
    allRemovers.length = 0;

    stage.querySelectorAll('[data-circ-carousel-generated]').forEach((el) => el.remove());
    stage.remove();
    cardElements.length = 0;
    presentationStates.length = 0;

    root.classList.remove('circ-carousel--dragging');
  }

  // ── Event listeners ──
  listen(root, 'pointerdown', onPointerDown);
  listen(root, 'pointermove', onPointerMove);
  listen(root, 'pointerup', onPointerUp);
  listen(root, 'pointercancel', onPointerUp);
  listen(root, 'keydown', onKeyDown);
  listen(document, 'visibilitychange', onVisibilityChange);

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(() => {
      if (!destroyed && !pauseReasons.size) {
        layout();
        scheduleRAF();
      }
    });
    resizeObserver.observe(root);
  }

  if ('IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        layout();
        resume('intersection');
      } else {
        pause('intersection');
      }
    }, { threshold: 0.08 });
    intersectionObserver.observe(root);
  }

  // ── Initial layout ──
  updateActive(true);
  scheduleRAF();
  layout();

  return {
    pause,
    resume,
    destroy,
    get activeIndex() { return activeIndex; },
    get currentPosition() { return currentPosition; },
    get targetPosition() { return targetPosition; },
    get isSettled() {
      return rafId === null && Math.abs(currentPosition - targetPosition) <= SETTLE_EPSILON;
    },
    goTo,
    next() { moveBy(1); },
    prev() { moveBy(-1); },
  };
}
