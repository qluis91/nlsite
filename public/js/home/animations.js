/**
 * Página de Inicio — GSAP + ScrollTrigger + Lenis
 * Panel 1 entrance animations and scroll behavior.
 */

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
async function runEntrance(gsap, lenis, heroPanel) {
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
  const hasCanvas = document.querySelector('[data-helmet-canvas]');

  tl.set(heroPanel, { autoAlpha: 1 })

    // 1. Background grid
    .fromTo('.hero-bg-grid', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8 }, 0)

    // 2. Logo
    .fromTo('.hero-logo', { autoAlpha: 0, y: -20 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 0.15)

    // 3. Navigation items stagger
    .fromTo('.hero-nav-list > li', { autoAlpha: 0, y: -10 }, {
      autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.08,
    }, 0.25)

    // 4. Eyebrow
    .fromTo('.hero-eyebrow', { autoAlpha: 0, y: 15 }, {
      autoAlpha: 1, y: 0, duration: 0.5,
    }, 0.4)

    // 5. Heading lines rise sequentially
    .fromTo('.hero-line', { autoAlpha: 0, y: 40 }, {
      autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.12, ease: 'power3.out',
    }, 0.5)

    // 5b. Glow intensifies
    .fromTo('.hero-bg-glow', { autoAlpha: 0.2 }, { autoAlpha: 1, duration: 0.8 }, 0.6)

    // 6. Helmet fades/scales in
    .fromTo(hasCanvas || '.hero-3d', { autoAlpha: 0, scale: 0.9 }, {
      autoAlpha: 1, scale: 1, duration: 0.7, ease: 'power2.out',
    }, 0.7)

    // 7. CTA buttons stagger up
    .fromTo('.hero-btn', { autoAlpha: 0, y: 20 }, {
      autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.1, ease: 'power2.out',
    }, 0.85)

    // 8. Social buttons reveal
    .fromTo('.hero-social-link', { autoAlpha: 0, y: 12, scale: 0.8 }, {
      autoAlpha: 1, y: 0, scale: 1, duration: 0.35, stagger: 0.07, ease: 'back.out(1.7)',
    }, 1.0);

  // Mark page as ready
  document.querySelector('[data-home-page]')?.classList.add('is-motion-ready');

  return tl;
}

/**
 * Scroll behavior — Panel 1 → Panel 2 transition
 */
async function runScrollAnimations(gsap, lenis, heroPanel) {
  const media = gsap.matchMedia();

  media.add({
    desktop: '(min-width: 769px)',
    mobile: '(max-width: 768px)',
  }, (context) => {
    const compact = context.conditions.mobile;

    // Hero copy and CTAs shift upward together on scroll
    gsap.to(['.hero-text', '.hero-ctas'], {
      scrollTrigger: {
        trigger: heroPanel,
        start: 'top top',
        end: 'bottom top',
        scrub: 0.8,
      },
      y: compact ? -16 : -40,
      opacity: compact ? 0.65 : 0.45,
      ease: 'none',
    });

    // Helmet shifts and scales subtly
    if (document.querySelector('[data-helmet-canvas]')) {
      gsap.to('.hero-3d', {
        scrollTrigger: {
          trigger: heroPanel,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.8,
        },
        y: compact ? 10 : 20,
        scale: compact ? 0.97 : 0.92,
        opacity: compact ? 0.7 : 0.5,
        ease: 'none',
      });
    }

    // Social links fade
    gsap.to('.hero-social', {
      scrollTrigger: {
        trigger: heroPanel,
        start: 'top top',
        end: compact ? 'bottom-=80 top' : 'bottom-=200 top',
        scrub: 0.6,
      },
      opacity: 0,
      ease: 'none',
    });

    // Grid parallax
    gsap.to('.hero-bg-grid', {
      scrollTrigger: {
        trigger: heroPanel,
        start: 'top top',
        end: 'bottom top',
        scrub: 0.5,
      },
      y: compact ? 24 : 60,
      ease: 'none',
    });
  });

  return media;
}

/**
 * Public initializer
 */
export async function initHomeAnimations() {
  const heroPanel = document.querySelector('[data-panel="1"]');
  if (!heroPanel) return;

  try {
    // Initialize Lenis
    const lenis = await initLenis();

    // Initialize GSAP
    const { gsap, ScrollTrigger } = await initGSAP();

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
    await runEntrance(gsap, lenis, heroPanel);

    // Run scroll animations
    await runScrollAnimations(gsap, lenis, heroPanel);

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
    // Fallback: show content
    const homePage = document.querySelector('[data-home-page]');
    if (homePage) homePage.classList.add('is-motion-ready');
  }
}
