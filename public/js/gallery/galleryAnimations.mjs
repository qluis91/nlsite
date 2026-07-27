const galleryAnimationInstances = new WeakMap();

const MOBILE_QUERY = '(max-width: 1023px)';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function noMotionController() {
  return {
    entryPromise: Promise.resolve(),
    modeTransitions: {
      exit: async () => {},
      enter: async () => {},
      reset() {},
      revealCarousel: async () => {},
    },
    openViewer: async () => {},
    closeViewer: async () => {},
    cancelViewer() {},
    destroy() {},
  };
}

export function shouldAnimateGalleryNavigation(event, anchor, currentLocation = window.location) {
  if (!anchor || event?.defaultPrevented || event?.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.hasAttribute?.('download')) return false;
  const target = anchor.getAttribute?.('target');
  if (target && target.toLowerCase() !== '_self') return false;
  const rawHref = anchor.getAttribute?.('href') || '';
  if (!rawHref || rawHref.startsWith('#')) return false;

  let url;
  try {
    url = new URL(anchor.href || rawHref, currentLocation.href);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (url.origin !== currentLocation.origin) return false;
  if (url.hash) return false;
  return url.href !== currentLocation.href;
}

async function loadMotionRuntime(dependencies) {
  if (dependencies.gsap) {
    return {
      gsap: dependencies.gsap,
      ScrollTrigger: dependencies.ScrollTrigger || null,
      Lenis: dependencies.Lenis || null,
    };
  }
  const [gsapModule, scrollModule, lenisModule] = await Promise.all([
    import('/vendor/gsap/index.js'),
    import('/vendor/gsap/ScrollTrigger.js'),
    import('/vendor/lenis/lenis.mjs'),
  ]);
  return {
    gsap: gsapModule.gsap || gsapModule.default,
    ScrollTrigger: scrollModule.default || scrollModule.ScrollTrigger,
    Lenis: lenisModule.default || lenisModule,
  };
}

export async function initGalleryAnimations({
  page,
  reducedMotion = window.matchMedia?.(REDUCED_QUERY).matches === true,
  dependencies = {},
} = {}) {
  if (!page) return noMotionController();
  if (galleryAnimationInstances.has(page)) return galleryAnimationInstances.get(page);

  if (reducedMotion) {
    page.classList.add('is-gallery-motion-ready', 'is-reduced-motion');
    const controller = noMotionController();
    const destroy = () => {
      page.classList.remove('is-gallery-motion-ready', 'is-reduced-motion');
      if (galleryAnimationInstances.get(page) === controller) {
        galleryAnimationInstances.delete(page);
      }
    };
    controller.destroy = destroy;
    galleryAnimationInstances.set(page, controller);
    return controller;
  }

  let runtime;
  try {
    runtime = await loadMotionRuntime(dependencies);
  } catch {
    // JS failed to load GSAP — content stays visible (no CSS-based hiding)
    page.classList.add('is-gallery-motion-ready');
    const controller = noMotionController();
    controller.destroy = () => {
      page.classList.remove('is-gallery-motion-ready');
      if (galleryAnimationInstances.get(page) === controller) {
        galleryAnimationInstances.delete(page);
      }
    };
    galleryAnimationInstances.set(page, controller);
    return controller;
  }

  const { gsap, ScrollTrigger, Lenis } = runtime;
  gsap?.registerPlugin?.(ScrollTrigger);
  const compact = window.matchMedia?.(MOBILE_QUERY).matches === true;
  const weakDevice = (Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4)
    || (Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 4);
  const allowBlur = !compact && !weakDevice;
  const activeAnimations = new Map();
  const activeViewerAnimations = new Set();
  const scrollAnimations = new Set();
  const removers = [];
  const revealedCarousels = new WeakSet();
  let destroyed = false;
  let navigating = false;
  let lenis = null;
  let lenisFrame = null;
  let viewerOrigin = null;

  function listen(target, name, handler, options) {
    if (!target) return;
    target.addEventListener(name, handler, options);
    removers.push(() => target.removeEventListener(name, handler, options));
  }

  function trackTween(factory, group = 'general') {
    return new Promise((resolve) => {
      if (destroyed) {
        resolve();
        return;
      }
      let animation = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (animation) {
          activeAnimations.delete(animation);
          activeViewerAnimations.delete(animation);
        }
        resolve();
      };
      animation = factory(finish);
      if (!animation) finish();
      else {
        activeAnimations.set(animation, finish);
        if (group === 'viewer') activeViewerAnimations.add(animation);
      }
    });
  }

  function killAnimation(animation) {
    const finish = activeAnimations.get(animation);
    animation?.kill?.();
    finish?.();
  }

  function clearTarget(target) {
    if (!target) return;
    gsap.set(target, {
      clearProps: 'opacity,visibility,transform,filter,willChange,pointerEvents',
    });
  }

  function tweenFromTo(targets, from, to, group = 'general') {
    const list = [...(targets?.length !== undefined && !targets.nodeType ? targets : [targets])]
      .filter(Boolean);
    if (!list.length) return Promise.resolve();
    return trackTween((finish) => gsap.fromTo(list, from, {
      ...to,
      onComplete: finish,
      onInterrupt: finish,
    }), group);
  }

  if (Lenis) {
    lenis = new Lenis({
      duration: compact ? 0.9 : 1.2,
      easing: (value) => Math.min(1, 1.001 - Math.pow(2, -10 * value)),
      smoothWheel: true,
    });
    const updateScrollTrigger = () => ScrollTrigger?.update?.();
    lenis.on?.('scroll', updateScrollTrigger);
    removers.push(() => lenis?.off?.('scroll', updateScrollTrigger));
    const lenisTick = (time) => {
      if (destroyed) return;
      lenis.raf(time);
      lenisFrame = window.requestAnimationFrame(lenisTick);
    };
    lenisFrame = window.requestAnimationFrame(lenisTick);
  }

  // ── Content is visible by default. Flag for will-change CSS only. ──
  page.classList.add('is-gallery-motion-ready');

  // ── 1. Entry timeline — above-the-fold entrance (once, no ScrollTrigger) ──
  const entryTargets = [...page.querySelectorAll('[data-gallery-animate="entry"]')];
  const visContainer = page.querySelector('[data-gallery-primary-mode]:not([hidden]), .gallery-visual-zone__content');

  const allEntryTargets = [
    ...entryTargets,
    visContainer,
  ].filter(Boolean);

  const entryPromise = new Promise((resolve) => {
    if (!allEntryTargets.length) {
      resolve();
      return;
    }

    const tl = gsap.timeline({
      defaults: { ease: 'power2.out' },
      onComplete: resolve,
    });

    tl.fromTo(allEntryTargets,
      {
        autoAlpha: 0,
        y: compact ? 28 : 40,
        filter: allowBlur ? 'blur(6px)' : 'none',
      },
      {
        autoAlpha: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: compact ? 0.65 : 0.85,
        stagger: compact ? 0.1 : 0.14,
        clearProps: 'filter',
      }
    );
  });

  // ── 2. After entry timeline: visible reversible scroll on entry elements ──
  // Only text/control elements ([data-gallery-animate="entry"]), NOT the
  // visualization container.  Shared trigger thresholds for consistent timing.
  const ENTER_START = 'top 80%';
  const EXIT_END = 'top 20%';

  entryPromise.then(() => {
    if (destroyed) return;
    entryTargets.forEach((element, index) => {
      if (!element?.isConnected) return;

      const distance = compact ? 16 : 24;
      const exitDur = compact ? 0.3 : 0.4;
      const returnDur = compact ? 0.15 : 0.18;
      const fadeTo = 0.6;
      const scaleTo = 0.985;

      const st = ScrollTrigger.create({
        id: `gallery-entry-scroll-${index}`,
        trigger: element,
        start: ENTER_START,
        end: EXIT_END,
        invalidateOnRefresh: true,

        onEnter() {
          gsap.to(element, {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: exitDur,
            ease: 'power2.out',
            overwrite: 'auto',
          });
        },

        onLeave() {
          gsap.to(element, {
            autoAlpha: fadeTo,
            y: -distance,
            scale: scaleTo,
            duration: exitDur,
            ease: 'power2.in',
            overwrite: 'auto',
          });
        },

        // Fast restoration when scrolling back into view
        onEnterBack() {
          gsap.to(element, {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: returnDur,
            ease: 'power2.out',
            overwrite: 'auto',
          });
        },

        // Instant restoration when scrolling back up past the trigger
        onLeaveBack() {
          gsap.set(element, {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            overwrite: 'auto',
          });
        },
      });

      scrollAnimations.add(st);
    });
  });

  // ── 2b. Infinite Menu info-panel animation ──
  // The selected-project overlay panel inside Infinite Menu needs its own
  // entrance animation, selection-change crossfade, and scroll restoration.
  // It starts hidden and is toggled by the renderer when a sphere is focused.
  // The Infinite canvas/container is excluded from all reversible fading —
  // only the info-panel card gets animated.
  const infinitePanel = page.querySelector('[data-gallery-animate="infinite-panel"]');
  if (infinitePanel) {
    let panelTween = null;

    function killPanelTween() {
      panelTween?.kill?.();
      panelTween = null;
    }

    function animatePanelIn() {
      if (destroyed || infinitePanel.hidden) return;
      killPanelTween();
      panelTween = gsap.fromTo(infinitePanel, {
        autoAlpha: 0,
        y: compact ? 14 : 18,
        scale: 0.98,
      }, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: compact ? 0.22 : 0.3,
        ease: 'power2.out',
        overwrite: 'auto',
        onComplete() { panelTween = null; },
      });
    }

    function animatePanelOut() {
      killPanelTween();
      gsap.set(infinitePanel, { autoAlpha: 0, y: compact ? 14 : 18, scale: 0.98 });
    }

    // Watch hidden toggling (initial reveal) and text-content changes (selection crossfade)
    const panelObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'hidden') {
          if (infinitePanel.hidden) {
            animatePanelOut();
          } else {
            animatePanelIn();
            // Refresh ScrollTrigger now that panel is visible
            ScrollTrigger?.refresh?.();
          }
        }
        if (mutation.type === 'characterData' && !infinitePanel.hidden) {
          // Selection changed — short crossfade while panel is visible
          killPanelTween();
          panelTween = gsap.fromTo(infinitePanel,
            { autoAlpha: 0.4 },
            {
              autoAlpha: 1,
              duration: compact ? 0.18 : 0.22,
              ease: 'power2.out',
              overwrite: 'auto',
              onComplete() { panelTween = null; },
            }
          );
        }
      }
    });

    panelObserver.observe(infinitePanel, {
      attributes: true,
      attributeFilter: ['hidden'],
      characterData: true,
      subtree: true,
    });
    removers.push(() => panelObserver?.disconnect());

    // ScrollTrigger: restore the panel quickly when scrolling back
    const panelScrollTrigger = ScrollTrigger.create({
      id: 'gallery-infinite-panel',
      trigger: infinitePanel,
      start: 'top 90%',
      end: 'top 30%',
      invalidateOnRefresh: true,
      onEnterBack() {
        killPanelTween();
        gsap.to(infinitePanel, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: compact ? 0.12 : 0.16,
          ease: 'power2.out',
          overwrite: 'auto',
        });
      },
      onLeaveBack() {
        gsap.set(infinitePanel, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          overwrite: 'auto',
        });
      },
    });
    scrollAnimations.add(panelScrollTrigger);
  }

  // ── 3. Below-fold repeatable scroll reveals ──
  function addRepeatableScrollReveal(element, id, opts = {}) {
    if (!element || destroyed) return null;

    const y = opts.y ?? (compact ? 16 : 30);
    const scale = opts.scale ?? 0.97;
    const start = opts.start ?? 'top 88%';
    const dur = opts.duration ?? (compact ? 0.45 : 0.6);
    const stgr = opts.stagger ?? 0;
    const ease = opts.ease ?? 'power2.out';

    gsap.set(element, { autoAlpha: 0, y, scale });

    const tween = gsap.to(element, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: dur,
      stagger: stgr,
      ease,
      scrollTrigger: {
        id,
        trigger: element,
        start,
        toggleActions: 'play none none reverse',
        invalidateOnRefresh: true,
      },
    });

    scrollAnimations.add(tween);
    return tween;
  }

  // Pagination + CTA
  page.querySelectorAll('[data-gallery-animate="scroll"]').forEach((element, index) => {
    addRepeatableScrollReveal(element, `gallery-scroll-${index}`);
  });

  // Grid cards — staggered
  const gridContainer = page.querySelector('.gallery-grid');
  if (gridContainer) {
    const cardEls = [...gridContainer.querySelectorAll('.gallery-grid__item')];
    if (cardEls.length) {
      gsap.set(cardEls, { autoAlpha: 0, y: compact ? 18 : 32, scale: 0.96 });
      const gridTween = gsap.to(cardEls, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: compact ? 0.38 : 0.52,
        stagger: compact ? 0.03 : 0.05,
        ease: 'power2.out',
        scrollTrigger: {
          id: 'gallery-grid-cards',
          trigger: gridContainer,
          start: 'top 88%',
          toggleActions: 'play none none reverse',
          invalidateOnRefresh: true,
        },
      });
      scrollAnimations.add(gridTween);
    }
  }

  const modeTransitions = {
    async exit(container) {
      if (!container || destroyed) return;
      container.style.pointerEvents = 'none';
      await tweenFromTo(container, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
      }, {
        autoAlpha: 0,
        y: compact ? -8 : -14,
        scale: 0.985,
        duration: compact ? 0.16 : 0.22,
        ease: 'power1.in',
      });
    },

    async enter(container, mode) {
      if (!container || destroyed) return;
      const cards = mode === 'grid'
        ? [...container.querySelectorAll('.gallery-grid__item')]
        : [];
      const belowViewport = container.getBoundingClientRect?.().top
        > (window.innerHeight || 0) * 0.92;
      if (belowViewport && ScrollTrigger) {
        const revealTargets = [container, ...cards];
        ScrollTrigger.getAll()
          .filter((trigger) => String(trigger.vars?.id || '').startsWith('gallery-mode-'))
          .forEach((trigger) => trigger.kill());
        const animation = gsap.fromTo(revealTargets, {
          autoAlpha: 0,
          y: compact ? 10 : 20,
          scale: mode === 'infinite' ? 0.975 : 0.99,
        }, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: compact ? 0.3 : 0.42,
          stagger: cards.length ? (compact ? 0.025 : 0.045) : 0,
          ease: 'power2.out',
          clearProps: 'opacity,visibility,transform,pointerEvents',
          scrollTrigger: {
            id: `gallery-mode-${mode}`,
            trigger: container,
            start: 'top 88%',
            toggleActions: 'play none none reverse',
            invalidateOnRefresh: true,
          },
        });
        scrollAnimations.add(animation);
        ScrollTrigger.refresh?.();
        return;
      }
      const promises = [
        tweenFromTo(container, {
          autoAlpha: 0,
          y: compact ? 10 : 18,
          scale: mode === 'infinite' ? 0.975 : 0.99,
        }, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: compact ? 0.28 : 0.4,
          ease: 'power2.out',
          clearProps: 'opacity,visibility,transform,filter,pointerEvents',
        }),
      ];
      if (cards.length) {
        promises.push(tweenFromTo(cards, {
          autoAlpha: 0,
          y: compact ? 10 : 20,
          scale: 0.975,
        }, {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: compact ? 0.26 : 0.38,
          stagger: compact ? 0.025 : 0.045,
          ease: 'power2.out',
          clearProps: 'opacity,visibility,transform',
        }));
      }
      await Promise.all(promises);
      ScrollTrigger?.refresh?.();
    },

    reset(container) {
      clearTarget(container);
    },

    async revealCarousel(carousel) {
      if (!carousel || destroyed || revealedCarousels.has(carousel)) return;
      revealedCarousels.add(carousel);
      const animation = gsap.fromTo(carousel, {
        autoAlpha: 0,
        y: compact ? 12 : 28,
        scale: 0.975,
      }, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: compact ? 0.32 : 0.48,
        ease: 'power2.out',
        clearProps: 'opacity,visibility,transform',
        scrollTrigger: {
          id: 'gallery-video-carousel',
          trigger: carousel,
          start: 'top 86%',
          toggleActions: 'play none none reverse',
          invalidateOnRefresh: true,
        },
      });
      scrollAnimations.add(animation);
      ScrollTrigger?.refresh?.();
    },
  };

  // ═══════════════════════════════════════════════════════════════
  //  Viewer animations: UNCHANGED
  // ═══════════════════════════════════════════════════════════════

  async function openViewer({ modal, dialog, origin } = {}) {
    if (!modal || !dialog || destroyed) return;
    viewerOrigin = origin?.isConnected ? origin : null;
    lenis?.stop?.();
    const backdrop = modal.querySelector('[data-gallery-animate="viewer-backdrop"]');
    const stage = modal.querySelector('[data-gallery-animate="viewer-stage"]');
    const details = modal.querySelector('[data-gallery-animate="viewer-details"]');
    const controls = modal.querySelector('[data-gallery-animate="viewer-controls"]');
    const close = modal.querySelector('[data-gallery-animate="viewer-close"]');
    const originRect = viewerOrigin?.getBoundingClientRect?.();
    const panelRect = dialog.getBoundingClientRect?.();
    const hasOrigin = originRect?.width > 0 && panelRect?.width > 0;
    const startScale = hasOrigin
      ? Math.max(0.18, Math.min(0.82, originRect.width / panelRect.width))
      : (compact ? 0.96 : 0.92);
    const startX = hasOrigin
      ? originRect.left + originRect.width / 2 - (panelRect.left + panelRect.width / 2)
      : 0;
    const startY = hasOrigin
      ? originRect.top + originRect.height / 2 - (panelRect.top + panelRect.height / 2)
      : (compact ? 12 : 24);

    await Promise.all([
      tweenFromTo(backdrop, { autoAlpha: 0 }, {
        autoAlpha: 1,
        duration: compact ? 0.18 : 0.24,
        ease: 'power1.out',
      }, 'viewer'),
      tweenFromTo(dialog, {
        autoAlpha: 0,
        x: startX,
        y: startY,
        scale: startScale,
      }, {
        autoAlpha: 1,
        x: 0,
        y: 0,
        scale: 1,
        duration: compact ? 0.3 : 0.42,
        ease: 'power3.out',
      }, 'viewer'),
      tweenFromTo([stage, details, controls, close], {
        autoAlpha: 0,
        y: compact ? 8 : 14,
      }, {
        autoAlpha: 1,
        y: 0,
        duration: compact ? 0.24 : 0.34,
        stagger: compact ? 0.025 : 0.045,
        delay: compact ? 0.04 : 0.08,
        ease: 'power2.out',
      }, 'viewer'),
    ]);
  }

  async function closeViewer({ modal, dialog, origin = viewerOrigin } = {}) {
    if (!modal || !dialog || destroyed) return;
    const backdrop = modal.querySelector('[data-gallery-animate="viewer-backdrop"]');
    const target = origin?.isConnected ? origin : null;
    const originRect = target?.getBoundingClientRect?.();
    const panelRect = dialog.getBoundingClientRect?.();
    const hasOrigin = originRect?.width > 0 && panelRect?.width > 0;
    await Promise.all([
      tweenFromTo(backdrop, { autoAlpha: 1 }, {
        autoAlpha: 0,
        duration: compact ? 0.14 : 0.2,
        ease: 'power1.in',
      }, 'viewer'),
      tweenFromTo(dialog, {
        autoAlpha: 1,
        x: 0,
        y: 0,
        scale: 1,
      }, {
        autoAlpha: 0,
        x: hasOrigin
          ? originRect.left + originRect.width / 2 - (panelRect.left + panelRect.width / 2)
          : 0,
        y: hasOrigin
          ? originRect.top + originRect.height / 2 - (panelRect.top + panelRect.height / 2)
          : (compact ? 8 : 18),
        scale: hasOrigin
          ? Math.max(0.18, Math.min(0.82, originRect.width / panelRect.width))
          : 0.97,
        duration: compact ? 0.2 : 0.28,
        ease: 'power2.in',
      }, 'viewer'),
    ]);
    clearTarget([backdrop, dialog, ...modal.querySelectorAll('[data-gallery-animate^="viewer-"]')]);
    viewerOrigin = null;
    lenis?.start?.();
  }

  function cancelViewer() {
    [...activeViewerAnimations].forEach(killAnimation);
    viewerOrigin = null;
    lenis?.start?.();
  }

  const onDocumentClick = (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!shouldAnimateGalleryNavigation(event, anchor) || navigating || destroyed) return;
    navigating = true;
    event.preventDefault();
    const destination = anchor.href;
    lenis?.stop?.();
    trackTween((finish) => gsap.to([
      page,
      document.querySelector('[data-home-navbar]'),
    ].filter(Boolean), {
      autoAlpha: 0,
      y: compact ? -6 : -10,
      duration: compact ? 0.14 : 0.2,
      ease: 'power1.in',
      onComplete: finish,
      onInterrupt: finish,
    })).then(() => {
      if (!destroyed) window.location.assign(destination);
    });
  };
  listen(document, 'click', onDocumentClick);

  const onResize = () => ScrollTrigger?.refresh?.();
  listen(window, 'orientationchange', onResize);

  // ── Lifecycle: refresh ScrollTrigger after layout, images, and fonts ──
  if (ScrollTrigger) {
    listen(window, 'load', () => {
      if (!destroyed) ScrollTrigger.refresh();
    }, { once: true });

    let resizeTimer;
    listen(window, 'resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!destroyed && ScrollTrigger) ScrollTrigger.refresh();
      }, 200);
    }, { passive: true });
  }

  const controller = {
    entryPromise,
    modeTransitions,
    openViewer,
    closeViewer,
    cancelViewer,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      [...activeAnimations.entries()].forEach(([animation, finish]) => {
        animation.kill?.();
        finish();
      });
      scrollAnimations.forEach((animation) => animation.kill?.());
      scrollAnimations.clear();
      ScrollTrigger?.getAll?.()
        .filter((trigger) => String(trigger.vars?.id || '').startsWith('gallery-'))
        .forEach((trigger) => trigger.kill());
      removers.splice(0).forEach((remove) => remove());
      if (lenisFrame !== null) window.cancelAnimationFrame(lenisFrame);
      lenisFrame = null;
      lenis?.destroy?.();
      lenis = null;
      clearTarget([
        page,
        ...page.querySelectorAll('[data-gallery-animate], .gallery-primary-mode, .gallery-grid__item'),
      ]);
      page.classList.remove('is-gallery-motion-ready');
      if (galleryAnimationInstances.get(page) === controller) {
        galleryAnimationInstances.delete(page);
      }
    },
  };

  galleryAnimationInstances.set(page, controller);
  return controller;
}
