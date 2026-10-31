import { initNavbar } from './public-navbar.js';

initNavbar();

function revealMaterials() {
  var hero = document.getElementById('materials-hero');
  if (hero) {
    requestAnimationFrame(function () {
      hero.classList.add('is-visible');
    });
  }

  var cards = document.querySelectorAll('.page-materials .material-io-card');
  if (!cards.length) return;

  var reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion || !('IntersectionObserver' in window)) {
    cards.forEach(function (card) {
      card.classList.add('is-visible');
    });
    return;
  }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.35, rootMargin: '0px 0px -10% 0px' }
  );

  cards.forEach(function (card) {
    io.observe(card);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', revealMaterials);
} else {
  revealMaterials();
}
