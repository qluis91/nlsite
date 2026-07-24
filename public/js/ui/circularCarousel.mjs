/**
 * Circular Carousel — Generic DOM-based circular/ring carousel.
 * Shares interaction model with Circular Gallery but uses DOM cards
 * (no WebGL, no textures). Supports drag, wheel, keyboard, inertia,
 * snap, pause/resume, reduced-motion, and full destroy lifecycle.
 *
 * Multiple instances can exist independently.
 */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function safeModulo(value, length) {
  if (!length) return 0;
  return ((Math.round(value) % length) + length) % length;
}

export function wrappedDistance(index, activeIndex, count) {
  let distance = index - activeIndex;
  if (distance > count / 2) distance -= count;
  if (distance < -count / 2) distance += count;
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
  let angle = { current: 0, target: 0, last: 0 };
  let activeIndex = -1;
  const pointer = { active: false, moved: false, id: null, startX: 0, startAngle: 0 };
  let wheelTimer = null;
  let resizeObserver = null;
  let intersectionObserver = null;
  const allRemovers = [];

  // ── DOM ──
  const cardElements = [];

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
  });

  // ── Helpers ──
  function listen(target, event, handler, eventOptions) {
    target.addEventListener(event, handler, eventOptions);
    allRemovers.push(() => target.removeEventListener(event, handler, eventOptions));
  }

  function normalizedIndex(rawAngle) {
    return safeModulo(rawAngle, ownedItems.length);
  }

  function setCardVisibility(card, visible) {
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

  // ── Layout ──
  function layout() {
    if (destroyed || ownedItems.length === 0) return;

    const stageWidth = stage.offsetWidth || root.clientWidth || 1;
    const stageHeight = stage.offsetHeight || root.clientHeight || 1;
    const viewportWidth = window.innerWidth || stageWidth;

    const isMobile = viewportWidth <= 767;
    const isTablet = viewportWidth >= 768 && viewportWidth < 1200;
    const slots = isMobile ? MOBILE_SLOTS : (isTablet ? TABLET_SLOTS : DESKTOP_SLOTS);
    const currentCardWidth = isMobile
      ? Math.min(mobileCardWidth, Math.max(220, stageWidth - 64))
      : (isTablet ? tabletCardWidth : cardWidth);
    const currentCardHeight = isMobile
      ? mobileCardHeight
      : (isTablet ? tabletCardHeight : cardHeight);
    const frontIndex = normalizedIndex(angle.current);
    const totalItems = ownedItems.length;

    cardElements.forEach((card, i) => {
      const distance = wrappedDistance(i, frontIndex, totalItems);
      const slot = slots[String(distance)];
      if (!slot) {
        setCardVisibility(card, false);
        return;
      }

      const x = stageWidth / 2 + stageWidth * slot.xRatio - currentCardWidth / 2;
      const y = stageHeight / 2 - currentCardHeight / 2 + slot.y;
      setCardVisibility(card, true);
      card.style.position = 'absolute';
      card.style.left = '0';
      card.style.top = '0';
      card.style.width = `${currentCardWidth}px`;
      card.style.height = `${currentCardHeight}px`;
      card.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${slot.scale})`;
      card.style.opacity = String(slot.opacity);
      card.style.zIndex = String(slot.zIndex);

      if (distance === 0) {
        card.classList.add('circ-carousel__card--active');
        card.setAttribute('aria-current', 'true');
      } else {
        card.classList.remove('circ-carousel__card--active');
        card.removeAttribute('aria-current');
      }
    });

    const newActive = normalizedIndex(angle.current);
    if (newActive !== activeIndex) {
      activeIndex = newActive;
      onActiveChange(ownedItems[activeIndex], activeIndex, ownedItems.length);
    }
  }

  // ── Snap ──
  function snap() {
    if (ownedItems.length <= 1) angle.target = 0;
    else angle.target = Math.round(angle.target);
  }

  // ── Frame ──
  function frame() {
    rafId = null;
    if (destroyed || pauseReasons.size) return;

    if (reducedMotion) {
      angle.current = angle.target;
    } else {
      const ease = ownedItems.length > 3 ? 0.12 : 0.18;
      angle.current = lerp(angle.current, angle.target, ease);
      if (Math.abs(angle.current - angle.target) < 0.005) {
        angle.current = angle.target;
      }
    }

    layout();
    angle.last = angle.current;

    if (Math.abs(angle.current - angle.target) > 0.001 || pointer.active) {
      scheduleRAF();
    }
  }

  function scheduleRAF() {
    if (destroyed || pauseReasons.size || rafId !== null) return;
    rafId = requestAnimationFrame(frame);
  }

  // ── Input handlers ──
  function onPointerDown(event) {
    if (destroyed || event.button > 0 || event.target.closest('button, a')) return;
    if (ownedItems.length <= 1) return;
    pointer.active = true;
    pointer.moved = false;
    pointer.id = event.pointerId;
    pointer.startX = event.clientX;
    pointer.startAngle = angle.target;
    root.setPointerCapture?.(event.pointerId);
    root.classList.add('circ-carousel--dragging');
  }

  function onPointerMove(event) {
    if (!pointer.active || event.pointerId !== pointer.id || ownedItems.length <= 1) return;
    const dx = event.clientX - pointer.startX;
    if (Math.abs(dx) > 3) pointer.moved = true;
    const sensitivity = reducedMotion ? 0.012 : 0.008;
    angle.target = pointer.startAngle + dx * sensitivity;
    scheduleRAF();
  }

  function onPointerUp(event) {
    if (!pointer.active || event.pointerId !== pointer.id) return;
    root.releasePointerCapture?.(event.pointerId);
    pointer.active = false;
    pointer.id = null;
    root.classList.remove('circ-carousel--dragging');
    if (pointer.moved && snapAngle) {
      snap();
      scheduleRAF();
    }
  }

  function onWheel(event) {
    if (ownedItems.length <= 1) return;
    const isFocused = root.contains(document.activeElement);
    const isHovered = event.target === root || root.contains(event.target);
    if (!isFocused && !isHovered) return;

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!Number.isFinite(delta) || delta === 0) return;

    event.preventDefault();
    const step = reducedMotion ? 1 : 0.4;
    angle.target += Math.sign(delta) * step;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      if (snapAngle) snap();
      scheduleRAF();
    }, 180);
    scheduleRAF();
  }

  function onKeyDown(event) {
    if (ownedItems.length <= 1) return;
    let handled = true;
    if (event.key === 'ArrowRight') { angle.target += 1; }
    else if (event.key === 'ArrowLeft') { angle.target -= 1; }
    else if (event.key === 'Home') { angle.target = 0; }
    else { handled = false; }

    if (handled) {
      event.preventDefault();
      if (snapAngle) snap();
      scheduleRAF();
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
    clearTimeout(wheelTimer);

    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();

    allRemovers.forEach((remove) => { try { remove(); } catch (_) { /* best-effort */ } });
    allRemovers.length = 0;

    stage.querySelectorAll('[data-circ-carousel-generated]').forEach((el) => el.remove());
    stage.remove();
    cardElements.length = 0;

    root.classList.remove('circ-carousel--dragging');
  }

  // ── Event listeners ──
  listen(root, 'pointerdown', onPointerDown);
  listen(root, 'pointermove', onPointerMove);
  listen(root, 'pointerup', onPointerUp);
  listen(root, 'pointercancel', onPointerUp);
  listen(root, 'wheel', onWheel, { passive: false });
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
  scheduleRAF();
  layout();

  return {
    pause,
    resume,
    destroy,
    get activeIndex() { return activeIndex; },
    goTo(index) {
      angle.target = safeModulo(index, ownedItems.length);
      if (snapAngle) snap();
      scheduleRAF();
    },
    next() { this.goTo(activeIndex + 1); },
    prev() { this.goTo(activeIndex - 1); },
  };
}
