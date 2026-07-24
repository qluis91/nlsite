const SAFE_THUMBNAIL = /^\/uploads\/gallery\/thumbnails\/[a-zA-Z0-9._-]+$/;

function normalizeAngle(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeRingItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (items.length === 1) return [{ item: items[0], originalIndex: 0, visualIndex: 0 }];
  const source = items.length === 2 ? [...items, ...items] : items;
  return source.map((item, visualIndex) => ({
    item,
    originalIndex: visualIndex % items.length,
    visualIndex,
  }));
}

export function calculateRingGeometry(cardWidth, visualCount) {
  if (visualCount <= 1) {
    return { angleStep: 0, radius: 0 };
  }
  const angleStep = 360 / visualCount;
  const geometricRadius = cardWidth / (2 * Math.tan(Math.PI / visualCount));
  return {
    angleStep,
    radius: clamp(geometricRadius * 1.08, cardWidth * 1.05, 1400),
  };
}

export function closestRingIndex(rotation, visualCount) {
  if (visualCount <= 1) return 0;
  const angleStep = 360 / visualCount;
  let closest = 0;
  let distance = Infinity;
  for (let index = 0; index < visualCount; index += 1) {
    const candidate = Math.abs(normalizeAngle(index * angleStep + rotation));
    if (candidate < distance) {
      closest = index;
      distance = candidate;
    }
  }
  return closest;
}

export class RingGalleryRenderer {
  constructor(container, items, options = {}) {
    if (!container) throw new Error('Ring Gallery requires a container.');
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Ring Gallery requires at least one item.');
    }
    this.container = container;
    this.items = items;
    this.visualItems = normalizeRingItems(items);
    this.options = {
      dragSensitivity: 0.17,
      friction: 0.93,
      snapEase: 0.012,
      onActiveChange: () => {},
      onSelect: () => {},
      ...options,
    };
    this.viewport = container.querySelector('[data-gallery-ring-viewport]');
    this.track = container.querySelector('[data-gallery-ring-track]');
    if (!this.viewport || !this.track) throw new Error('Ring Gallery stage is incomplete.');
    this.cards = [];
    this.rotation = 0;
    this.velocity = 0;
    this.snapTarget = null;
    this.rafId = null;
    this.lastFrameTime = 0;
    this.activeOriginalIndex = -1;
    this.destroyed = false;
    this.pauseReasons = new Set();
    this.pointer = {
      active: false,
      id: null,
      startX: 0,
      lastX: 0,
      lastTime: 0,
      distance: 0,
      target: null,
    };
    this.bindHandlers();
    this.ready = this.init();
  }

  async init() {
    const imageJobs = this.buildCards();
    this.addEventListeners();
    this.resize();
    this.render(true);
    await Promise.all(imageJobs);
    if (!this.destroyed) this.render(true);
    return this;
  }

  bindHandlers() {
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onLostPointerCapture = this.onLostPointerCapture.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
  }

  buildCards() {
    this.track.replaceChildren();
    return this.visualItems.map(({ item, originalIndex, visualIndex }) => {
      const card = document.createElement('div');
      card.className = 'gallery-ring__item';
      card.dataset.originalIndex = String(originalIndex);
      card.dataset.visualIndex = String(visualIndex);
      card.setAttribute('aria-hidden', 'true');

      const media = document.createElement('div');
      media.className = 'gallery-ring__media';
      const image = document.createElement('img');
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.draggable = false;
      image.decoding = 'async';

      const imageJob = new Promise((resolve) => {
        let settled = false;
        const settle = (broken = false) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          card.classList.toggle('has-broken-image', broken);
          resolve();
        };
        const timeoutId = window.setTimeout(() => settle(true), 8000);
        image.addEventListener('load', () => settle(false), { once: true });
        image.addEventListener('error', () => settle(true), { once: true });
        if (SAFE_THUMBNAIL.test(item.thumbnail || '')) image.src = item.thumbnail;
        else settle(true);
      });

      media.appendChild(image);
      if (item.type === 'video') {
        const videoIndicator = document.createElement('span');
        videoIndicator.className = 'gallery-ring__video-indicator';
        videoIndicator.textContent = 'Video';
        media.appendChild(videoIndicator);
      }
      card.appendChild(media);
      this.track.appendChild(card);
      this.cards.push(card);
      return imageJob;
    });
  }

  addEventListeners() {
    this.container.addEventListener('pointerdown', this.onPointerDown);
    this.container.addEventListener('pointermove', this.onPointerMove);
    this.container.addEventListener('pointerup', this.onPointerUp);
    this.container.addEventListener('pointercancel', this.onPointerUp);
    this.container.addEventListener('lostpointercapture', this.onLostPointerCapture);
    this.container.addEventListener('wheel', this.onWheel, { passive: false });
    this.container.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', this.resize);
    }
    if ('IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) {
          this.resize();
          this.resume('intersection');
        } else {
          this.pause('intersection');
        }
      }, { threshold: 0.08 });
      this.intersectionObserver.observe(this.container);
    }
  }

  resize() {
    if (this.destroyed) return;
    const width = Math.max(1, this.container.clientWidth);
    const compact = width < 600;
    this.cardWidth = clamp(width * (compact ? 0.58 : 0.25), 180, compact ? 250 : 310);
    this.cardHeight = this.cardWidth * 1.18;
    const geometry = calculateRingGeometry(this.cardWidth, this.visualItems.length);
    this.angleStep = geometry.angleStep;
    this.radius = geometry.radius;
    this.container.style.setProperty('--ring-card-width', `${this.cardWidth}px`);
    this.container.style.setProperty('--ring-card-height', `${this.cardHeight}px`);
    this.container.style.setProperty('--ring-radius', `${this.radius}px`);
    this.cards.forEach((card, index) => {
      const angle = this.angleStep * index;
      card.dataset.angle = String(angle);
      card.style.transform = this.visualItems.length === 1
        ? 'translate(-50%, -50%)'
        : `translate(-50%, -50%) rotateY(${angle}deg) translateZ(${this.radius}px)`;
    });
    this.render(true);
  }

  onPointerDown(event) {
    if (this.destroyed || event.button > 0 || event.target.closest?.('button, a')) return;
    this.pointer.active = true;
    this.pointer.id = event.pointerId;
    this.pointer.startX = event.clientX;
    this.pointer.lastX = event.clientX;
    this.pointer.lastTime = event.timeStamp;
    this.pointer.distance = 0;
    this.pointer.target = event.target.closest?.('.gallery-ring__item') || null;
    this.velocity = 0;
    this.snapTarget = null;
    this.container.classList.add('is-dragging');
    this.container.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.pointer.active || event.pointerId !== this.pointer.id || this.items.length === 1) return;
    const deltaX = event.clientX - this.pointer.lastX;
    const elapsed = clamp(event.timeStamp - this.pointer.lastTime, 8, 64);
    const rotationDelta = deltaX * this.options.dragSensitivity;
    this.rotation += rotationDelta;
    const instantaneousVelocity = rotationDelta / elapsed;
    this.velocity = this.velocity * 0.68 + clamp(instantaneousVelocity, -0.8, 0.8) * 0.32;
    this.pointer.distance += Math.abs(deltaX);
    this.pointer.lastX = event.clientX;
    this.pointer.lastTime = event.timeStamp;
    this.render();
  }

  onPointerUp(event) {
    if (!this.pointer.active || event.pointerId !== this.pointer.id) return;
    const clicked = this.pointer.distance < 7 && event.type !== 'pointercancel';
    const target = this.pointer.target;
    this.releasePointer();
    if (clicked && target) {
      const originalIndex = Number(target.dataset.originalIndex);
      if (originalIndex === this.activeOriginalIndex) {
        this.options.onSelect(this.items[originalIndex]);
        return;
      }
    }
    if (this.items.length > 1) {
      if (Math.abs(this.velocity) < 0.004) this.beginSnap();
      this.schedule();
    }
  }

  onLostPointerCapture(event) {
    if (this.pointer.active && event.pointerId === this.pointer.id) {
      this.releasePointer(false);
      this.beginSnap();
    }
  }

  releasePointer(releaseCapture = true) {
    if (releaseCapture && this.pointer.id !== null && this.container.hasPointerCapture?.(this.pointer.id)) {
      this.container.releasePointerCapture(this.pointer.id);
    }
    this.pointer.active = false;
    this.pointer.id = null;
    this.pointer.target = null;
    this.container.classList.remove('is-dragging');
  }

  onWheel(event) {
    if (this.items.length < 2) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!Number.isFinite(delta) || delta === 0) return;
    this.wheelTotal = (this.wheelTotal || 0) + delta;
    window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => { this.wheelTotal = 0; }, 180);
    if (Math.abs(this.wheelTotal) < 70) return;
    event.preventDefault();
    this.step(this.wheelTotal > 0 ? 1 : -1);
    this.wheelTotal = 0;
  }

  onKeyDown(event) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.step(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.startSnap(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      this.startSnap(-(this.items.length - 1) * this.angleStep);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.options.onSelect(this.items[this.activeOriginalIndex]);
    }
  }

  step(direction) {
    if (this.items.length < 2) return;
    this.startSnap(this.rotation - direction * this.angleStep);
  }

  startSnap(target) {
    this.velocity = 0;
    this.snapTarget = target;
    this.schedule();
  }

  beginSnap() {
    if (!this.angleStep) return;
    this.startSnap(Math.round(this.rotation / this.angleStep) * this.angleStep);
  }

  frame(timestamp) {
    this.rafId = null;
    if (this.destroyed || this.pauseReasons.size) return;
    const elapsed = this.lastFrameTime ? clamp(timestamp - this.lastFrameTime, 1, 40) : 16.67;
    this.lastFrameTime = timestamp;
    let moving = false;
    if (!this.pointer.active && Math.abs(this.velocity) >= 0.004) {
      this.rotation += this.velocity * elapsed;
      this.velocity *= Math.pow(this.options.friction, elapsed / 16.67);
      moving = true;
    } else if (!this.pointer.active && this.snapTarget === null && Math.abs(this.velocity) < 0.004) {
      this.velocity = 0;
      this.beginSnap();
    }
    if (!this.pointer.active && this.snapTarget !== null) {
      const difference = this.snapTarget - this.rotation;
      this.rotation += difference * Math.min(1, elapsed * this.options.snapEase);
      if (Math.abs(difference) < 0.025) {
        this.rotation = this.snapTarget;
        this.snapTarget = null;
      } else {
        moving = true;
      }
    }
    this.render();
    if (moving || this.pointer.active || this.snapTarget !== null) this.schedule();
  }

  render(forceAnnouncement = false) {
    if (this.destroyed) return;
    this.track.style.transform = `translate(-50%, -50%) rotateY(${this.rotation}deg)`;
    const visualIndex = closestRingIndex(this.rotation, this.visualItems.length);
    const active = this.visualItems[visualIndex];
    this.cards.forEach((card, index) => {
      const relativeAngle = normalizeAngle(index * this.angleStep + this.rotation);
      const depth = (Math.cos(relativeAngle * Math.PI / 180) + 1) / 2;
      card.style.setProperty('--ring-depth', depth.toFixed(3));
      card.style.setProperty('--ring-parallax', `${clamp(-relativeAngle * 0.16, -26, 26).toFixed(2)}px`);
      card.style.zIndex = String(Math.round(depth * 100));
      card.classList.toggle('is-active', index === visualIndex);
    });
    if (active && (forceAnnouncement || active.originalIndex !== this.activeOriginalIndex)) {
      this.activeOriginalIndex = active.originalIndex;
      this.options.onActiveChange(
        this.items[active.originalIndex],
        active.originalIndex,
        this.items.length
      );
    }
  }

  schedule() {
    if (this.destroyed || this.pauseReasons.size || this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(this.frame);
  }

  pause(reason = 'manual') {
    if (this.destroyed) return;
    this.pauseReasons.add(reason);
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastFrameTime = 0;
  }

  resume(reason = 'manual') {
    if (this.destroyed) return;
    this.pauseReasons.delete(reason);
    this.lastFrameTime = 0;
    this.render();
    if (this.pointer.active || Math.abs(this.velocity) >= 0.004 || this.snapTarget !== null) this.schedule();
  }

  onVisibilityChange() {
    if (document.hidden) this.pause('visibility');
    else this.resume('visibility');
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== null) window.cancelAnimationFrame(this.rafId);
    window.clearTimeout(this.wheelTimer);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerup', this.onPointerUp);
    this.container.removeEventListener('pointercancel', this.onPointerUp);
    this.container.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    this.container.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('keydown', this.onKeyDown);
    if (this.pointer.active) this.releasePointer();
    this.track.replaceChildren();
    this.container.classList.remove('is-ready', 'is-fallback', 'is-dragging');
    ['--ring-card-width', '--ring-card-height', '--ring-radius'].forEach((property) => {
      this.container.style.removeProperty(property);
    });
    this.cards.length = 0;
    this.visualItems.length = 0;
    this.items.length = 0;
    this.options.onActiveChange = () => {};
    this.options.onSelect = () => {};
    this.container = null;
    this.track = null;
    this.viewport = null;
  }
}
