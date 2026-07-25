/**
 * Página de Inicio — GSAP + ScrollTrigger + Lenis
 * Panel 1 entrance animations and scroll behavior.
 */
import { revealBlurTextSegments, splitBlurText } from './blurText.js';

const HERO_ANIMATED_SELECTOR = [
  '[data-hero-animate]',
  '.hero-word',
  '.hero-social-link',
  '.hero-logo',
  '.hero-search--desktop',
  '.hero-nav-list > li',
  '.hero-nav-account',
  '.hero-nav-toggle',
].join(',');
const PANEL_TWO_ANIMATED_SELECTOR = '[data-panel2-animate]';

let heroAnimationPromise = null;
let heroAnimationCompleted = false;

function clearHeroSafetyTimer() {
  if (!window.__heroEntranceSafetyTimer) return;
  window.clearTimeout(window.__heroEntranceSafetyTimer);
  window.__heroEntranceSafetyTimer = null;
}

export function revealHeroImmediately() {
  clearHeroSafetyTimer();
  document.documentElement.classList.remove('hero-entrance-pending');
  document.querySelectorAll(HERO_ANIMATED_SELECTOR).forEach((element) => {
    ['opacity', 'visibility', 'transform', 'filter', 'will-change', 'letter-spacing']
      .forEach((property) => element.style.removeProperty(property));
  });
  document.querySelector('[data-home-page]')?.classList.add('is-motion-ready');
  heroAnimationCompleted = true;
}

export function revealPanelTransitionImmediately() {
  const root = document.documentElement;
  root.classList.remove('panel-transition-pending', 'panel-transition-ready');
  document.querySelectorAll(PANEL_TWO_ANIMATED_SELECTOR).forEach((element) => {
    ['opacity', 'visibility', 'transform', 'filter', 'will-change']
      .forEach((property) => element.style.removeProperty(property));
  });
  revealBlurTextSegments(document);
}

function preparePanelTransition() {
  const root = document.documentElement;
  root.classList.add('panel-transition-ready');
  root.classList.remove('panel-transition-pending');
}

// ── Lenis smooth scrolling ──
async function initLenis() {
  const LenisModule = await import('/vendor/lenis/lenis.mjs');
  const Lenis = LenisModule.default || LenisModule;

  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });

  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }

  requestAnimationFrame(raf);

  return lenis;
}

// ── GSAP + ScrollTrigger ──
async function initGSAP() {
  // GSAP core
  const gsapModule = await import('/vendor/gsap/index.js');
  const gsap_ = gsapModule.gsap || gsapModule.default;

  // ScrollTrigger
  const stModule = await import('/vendor/gsap/ScrollTrigger.js');
  const ScrollTrigger = stModule.default || stModule.ScrollTrigger;

  if (gsap_ && gsap_.registerPlugin) {
    gsap_.registerPlugin(ScrollTrigger);
  }

  return { gsap: gsap_, ScrollTrigger };
}

/**
 * Panel 1 entrance timeline
 * Animate in: grid → logo → nav → eyebrow → heading lines → helmet → CTAs → social
 */
function runEntrance(gsap) {
  const compact = window.matchMedia('(max-width: 768px)').matches;
  const resolvedFilter = 'blur(0px)';

  return new Promise((resolve) => {
    const tl = gsap.timeline({
      defaults: { ease: 'power2.out' },
      onComplete: () => {
        revealHeroImmediately();
        resolve();
      },
    });

    tl
      // 1. Background awakening
      .to('.hero-bg-gradient', { opacity: 1, scale: 1, duration: 0.8 }, 0)
      .to('.hero-bg-glow', { opacity: 1, x: 0, y: 0, scale: 1, duration: 1 }, 0.05)
      .to('.hero-bg-grid', { opacity: 1, y: 0, duration: 0.85 }, 0.08)

      // 2. Premium navbar entrance
      .to('.hero-header', { opacity: 1, y: 0, filter: resolvedFilter, duration: 0.68 }, 0.08)
      .to('.hero-logo', { opacity: 1, y: 0, filter: resolvedFilter, duration: 0.58 }, 0.14)
      .to('.hero-search--desktop', { opacity: 1, y: 0, filter: resolvedFilter, duration: 0.5 }, 0.2)
      .to('.hero-nav-list > li', {
        opacity: 1, y: 0, filter: resolvedFilter, duration: 0.48, stagger: 0.055,
      }, 0.25)
      .to('.hero-nav-account, .hero-nav-toggle', {
        opacity: 1, y: 0, filter: resolvedFilter, duration: 0.48,
      }, 0.42)

      // 3. Eyebrow and light sweep
      .to('.hero-eyebrow', {
        opacity: 0.85,
        y: 0,
        filter: resolvedFilter,
        letterSpacing: '0.22em',
        duration: 0.62,
      }, 0.42)

      // 4. Word-level blur reveal with stable server-rendered wrapping
      .to('.hero-word', {
        opacity: 1,
        y: 0,
        filter: resolvedFilter,
        duration: compact ? 0.56 : 0.68,
        stagger: compact ? 0.045 : 0.065,
        ease: 'power3.out',
      }, 0.58)

      // 5. Supporting copy
      .to('.hero-support', {
        opacity: 1, y: 0, filter: resolvedFilter, duration: 0.5,
      }, compact ? 0.98 : 1.08)

      // 6. Buttons
      .to('.hero-btn', {
        opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.09,
      }, compact ? 1.08 : 1.2)

      // 7. Social links
      .to('.hero-social-link', {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.42,
        stagger: 0.055,
        ease: 'power2.out',
      }, compact ? 1.26 : 1.42)

      // 8. Reveal the existing stage; never target or recreate the canvas.
      .to('.hero-3d', {
        opacity: 1,
        y: 0,
        scale: 1,
        filter: 'saturate(1)',
        duration: compact ? 0.72 : 0.9,
        ease: 'power3.out',
      }, compact ? 0.7 : 0.66);
  });
}

/**
 * Scroll behavior — Panel 1 → Panel 2 transition
 */
async function runScrollAnimations(gsap, heroPanel, panelTwo, onPanelStateChange) {
  const media = gsap.matchMedia();

  media.add({
    desktop: '(min-width: 769px)',
    mobile: '(max-width: 768px)',
  }, (context) => {
    const compact = context.conditions.mobile;

    // Split Panel 2 copy before it enters: chars for heading/kicker, words for support.
    const kickerEl = panelTwo.querySelector('.showcase-kicker');
    const headingEl = panelTwo.querySelector('.showcase-heading');
    const supportEl = panelTwo.querySelector('.showcase-support');
    const fallY = compact ? -28 : -46;
    const kickerSplit = splitBlurText(kickerEl, {
      animateBy: 'chars',
      direction: 'top',
      blur: compact ? 8 : 11,
      y: fallY,
      scale: 0.98,
    });
    const headingSplit = splitBlurText(headingEl, {
      animateBy: 'chars',
      direction: 'top',
      blur: compact ? 9 : 13,
      y: fallY,
      scale: 0.97,
    });
    const supportSplit = splitBlurText(supportEl, {
      animateBy: 'words',
      direction: 'top',
      blur: compact ? 5 : 8,
      y: compact ? -18 : -28,
      scale: 0.99,
    });

    // Child spans own opacity/blur/Y. Parents must stay fully visible.
    gsap.set([kickerEl, headingEl, supportEl].filter(Boolean), {
      opacity: 1,
      visibility: 'visible',
      filter: 'none',
      y: 0,
    });

    const syncPanelState = (trigger) => {
      if (trigger.progress <= 0.01) {
        onPanelStateChange('panel1-active');
      } else if (trigger.progress >= 0.99) {
        onPanelStateChange('panel2-active');
      } else {
        onPanelStateChange(
          trigger.direction < 0 ? 'transitioning-to-panel1' : 'transitioning-to-panel2',
        );
      }
    };

    const transition = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        id: 'home-panel-1-to-2',
        trigger: panelTwo,
        start: 'top 92%',
        end: 'top top',
        scrub: compact ? 0.22 : 0.32,
        invalidateOnRefresh: true,
        onUpdate: syncPanelState,
        onRefresh: syncPanelState,
      },
    });

    const kickerTargets = kickerSplit?.targets?.length ? kickerSplit.targets : kickerEl;
    const headingTargets = headingSplit?.targets?.length ? headingSplit.targets : headingEl;
    const supportTargets = supportSplit?.targets?.length ? supportSplit.targets : supportEl;

    const settle = {
      kicker: {
        opacity: 0.6,
        filter: compact ? 'blur(4px)' : 'blur(5px)',
        y: compact ? 4 : 6,
        scale: 1,
      },
      heading: {
        opacity: 0.55,
        filter: compact ? 'blur(5px)' : 'blur(6px)',
        y: compact ? 5 : 7,
        scale: 0.995,
      },
      support: {
        opacity: 0.6,
        filter: compact ? 'blur(3px)' : 'blur(4px)',
        y: compact ? 3 : 5,
        scale: 1,
      },
    };
    const finalState = {
      opacity: 1,
      filter: 'blur(0px)',
      y: 0,
      scale: 1,
    };

    transition
      .addLabel('panelExit', 0)
      .to(['.hero-text', '.hero-ctas'], {
        y: compact ? -18 : -48,
        scale: compact ? 0.99 : 0.965,
        opacity: compact ? 0.38 : 0.12,
        filter: compact ? 'none' : 'blur(2px)',
        duration: 0.72,
      }, 'panelExit')
      .to('.hero-social', { y: -12, opacity: 0, duration: 0.38 }, 'panelExit')
      .to('.hero-3d', {
        x: compact ? 18 : '8vw',
        y: compact ? 14 : 34,
        scale: compact ? 0.94 : 0.84,
        rotation: compact ? 0 : 2.5,
        opacity: compact ? 0.36 : 0.16,
        duration: 0.82,
      }, 0.02)
      .to('.hero-bg-grid', { y: compact ? 24 : 68, opacity: 0.08, duration: 0.74 }, 'panelExit')
      .to('.hero-bg-glow', { x: '12%', y: '8%', scale: 0.72, opacity: 0.16, duration: 0.76 }, 'panelExit')
      .to('.grainient-background', { opacity: 0.16, duration: 0.78 }, 'panelExit')
      .to('[data-panel2-animate="background"]', { opacity: 1, scale: 1, duration: 0.82 }, 0.02)
      .to('[data-panel2-animate="bridge"]', { opacity: 1, scaleX: 1, duration: 0.62 }, 0.06)
      .to('[data-panel2-animate="trust"]', {
        opacity: 1, y: 0, duration: 0.42,
      }, 0.12)
      // Text starts late: trust strip is on-screen first; copy animates while clearly visible.
      .addLabel('kickerIn', 0.72)
      .fromTo(kickerTargets, {
        opacity: 0,
        filter: compact ? 'blur(8px)' : 'blur(11px)',
        y: fallY,
        scale: 0.98,
      }, {
        ...settle.kicker,
        duration: 0.12,
        stagger: compact ? 0.005 : 0.007,
        ease: 'power2.out',
      }, 'kickerIn')
      .to(kickerTargets, {
        ...finalState,
        duration: 0.1,
        stagger: compact ? 0.005 : 0.007,
        ease: 'power2.out',
      }, 'kickerIn+=0.1')
      .addLabel('headingIn', 0.78)
      .fromTo(headingTargets, {
        opacity: 0,
        filter: compact ? 'blur(9px)' : 'blur(13px)',
        y: fallY,
        scale: 0.97,
      }, {
        ...settle.heading,
        duration: 0.14,
        stagger: compact ? 0.006 : 0.009,
        ease: 'power2.out',
      }, 'headingIn')
      .to(headingTargets, {
        ...finalState,
        duration: 0.12,
        stagger: compact ? 0.006 : 0.009,
        ease: 'power3.out',
      }, 'headingIn+=0.12')
      .addLabel('supportIn', 0.86)
      .fromTo(supportTargets, {
        opacity: 0,
        filter: compact ? 'blur(5px)' : 'blur(8px)',
        y: compact ? -18 : -28,
        scale: 0.99,
      }, {
        ...settle.support,
        duration: 0.12,
        stagger: compact ? 0.01 : 0.014,
        ease: 'power2.out',
      }, 'supportIn')
      .to(supportTargets, {
        ...finalState,
        duration: 0.1,
        stagger: compact ? 0.01 : 0.014,
        ease: 'power2.out',
      }, 'supportIn+=0.1')
      .addLabel('carouselIn', 0.9)
      .to('[data-panel2-animate="carousel"]', {
        opacity: 1,
        y: 0,
        scale: 1,
        filter: 'blur(0px)',
        duration: 0.28,
      }, 'carouselIn')
      .to('[data-panel2-animate="card"]', {
        opacity: 1,
        y: 0,
        scale: 1,
        rotationX: 0,
        filter: 'blur(0px)',
        duration: 0.24,
        stagger: compact ? 0.03 : 0.045,
      }, 'carouselIn+=0.04')
      .to('[data-panel2-animate="controls"]', {
        opacity: 1,
        duration: 0.16,
      }, 0.96);

    return () => {
      if (kickerSplit) kickerSplit.destroy();
      if (headingSplit) headingSplit.destroy();
      if (supportSplit) supportSplit.destroy();
      transition.kill();
    };
  });

  return media;
}

/**
 * Public initializer
 */
async function initializeHomeAnimations(options = {}) {
  const heroPanel = document.querySelector('[data-panel="1"]');
  const panelTwo = document.querySelector('[data-panel="2"]');
  const onPanelStateChange = typeof options.onPanelStateChange === 'function'
    ? options.onPanelStateChange
    : () => {};
  if (!heroPanel || !panelTwo) {
    revealHeroImmediately();
    revealPanelTransitionImmediately();
    return;
  }

  try {
    const [lenis, { gsap, ScrollTrigger }] = await Promise.all([
      initLenis(),
      initGSAP(),
    ]);
    preparePanelTransition();

    // Sync Lenis with ScrollTrigger
    if (ScrollTrigger?.scrollerProxy) {
      ScrollTrigger.scrollerProxy(window, {
        scrollTop(value) {
          if (arguments.length && lenis) {
            lenis.scrollTo(value, { immediate: true });
          }
          return lenis ? (lenis.scroll || 0) : window.pageYOffset;
        },
        getBoundingClientRect() {
          return {
            top: 0, left: 0,
            width: window.innerWidth,
            height: window.innerHeight,
          };
        },
        pinType: document.querySelector('[data-home-page]')?.style.transform ? 'transform' : 'fixed',
      });
    }

    // Run entrance animation
    await runEntrance(gsap);

    // Run scroll animations
    await runScrollAnimations(gsap, heroPanel, panelTwo, onPanelStateChange);

    // Refresh ScrollTrigger after layout settles
    if (ScrollTrigger) {
      ScrollTrigger.refresh();
    }

    // Refresh on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (ScrollTrigger) ScrollTrigger.refresh();
      }, 200);
    }, { passive: true });

    // Refresh after images/fonts load
    window.addEventListener('load', () => {
      if (ScrollTrigger) ScrollTrigger.refresh();
    }, { once: true });

    // The external model load completes after the initial layout pass.
    document.addEventListener('helmet-loaded', () => {
      if (ScrollTrigger) ScrollTrigger.refresh();
    }, { once: true });

  } catch (err) {
    console.error('[animations] Initialization error:', err);
    revealHeroImmediately();
    revealPanelTransitionImmediately();
    onPanelStateChange('panel1-active');
  }
}

export function initHomeAnimations(options = {}) {
  if (heroAnimationPromise) return heroAnimationPromise;
  if (heroAnimationCompleted) return Promise.resolve();

  heroAnimationPromise = initializeHomeAnimations(options);
  return heroAnimationPromise;
}
