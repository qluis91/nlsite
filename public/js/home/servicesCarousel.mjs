/**
 * Home Services Circular Carousel — Adapter for circular carousel on Home.
 */

import { createCircularCarousel } from '../ui/circularCarousel.mjs';

const instanceMap = new WeakMap();

const ICON_SVG = {
  'diseno-3d': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  'escaneo-3d': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M6 12h12"/><circle cx="12" cy="12" r="3"/></svg>',
  'diseno-grafico': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  'desarrollo-web': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  'prendas': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  'impresion-3d': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 12H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
};

export const SERVICES = [
  { id: 'diseno-3d', title: 'Diseño 3D', description: 'Modelado y diseño 3D profesional para prototipos y productos personalizados.', icon: ICON_SVG['diseno-3d'], href: '/tienda' },
  { id: 'escaneo-3d', title: 'Escaneo 3D', description: 'Digitalización precisa de objetos físicos para replicación o modificación.', icon: ICON_SVG['escaneo-3d'], href: '/tienda' },
  { id: 'diseno-grafico', title: 'Diseño Gráfico', description: 'Identidad visual, branding y piezas gráficas con claridad y estilo.', icon: ICON_SVG['diseno-grafico'], href: '/tienda' },
  { id: 'desarrollo-web', title: 'Desarrollo Web', description: 'Sitios web y aplicaciones funcionales adaptadas a cada necesidad.', icon: ICON_SVG['desarrollo-web'], href: '/tienda' },
  { id: 'prendas', title: 'Prendas y Sublimación', description: 'Personalización de camisetas, tazas y más con sublimación de alta calidad.', icon: ICON_SVG['prendas'], href: '/tienda' },
  { id: 'impresion-3d', title: 'Impresión 3D Gran Formato', description: 'Piezas de gran tamaño con precisión milimétrica y acabados profesionales.', icon: ICON_SVG['impresion-3d'], href: '/tienda' },
];

function renderCard(item) {
  const card = document.createElement('div');
  card.setAttribute('role', 'listitem');
  card.setAttribute('aria-label', item.title);
  card.innerHTML =
    `<div class="svc-card__badge" aria-hidden="true"><span class="svc-card__badge-icon">${item.icon}</span></div>` +
    `<h3 class="svc-card__title">${item.title}</h3>` +
    `<p class="svc-card__desc">${item.description}</p>` +
    `<a class="svc-card__cta" href="${item.href}" aria-label="Ver detalle de ${item.title}">VER DETALLE <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg></a>`;
  return card;
}

export function initServicesCarousel(root) {
  if (!root) return () => {};
  if (instanceMap.has(root)) return instanceMap.get(root);

  const panel = root.closest('.home-panel--services');
  const status = panel?.querySelector('[data-svc-status]');
  const prevBtn = panel?.querySelector('[data-svc-prev]');
  const nextBtn = panel?.querySelector('[data-svc-next]');

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const carousel = createCircularCarousel({
    root,
    items: SERVICES,
    renderItem: renderCard,
    cardWidth: 280,
    cardHeight: 470,
    tabletCardWidth: 250,
    tabletCardHeight: 440,
    mobileCardWidth: 280,
    mobileCardHeight: 430,
    snapAngle: true,
    reducedMotion: prefersReduced,
    onActiveChange: (item) => {
      if (status) status.textContent = `Servicio activo: ${item.title}`;
    },
  });

  // Wire prev/next buttons
  const onPrev = () => carousel.prev();
  const onNext = () => carousel.next();
  prevBtn?.addEventListener('click', onPrev);
  nextBtn?.addEventListener('click', onNext);

  const destroy = () => {
    prevBtn?.removeEventListener('click', onPrev);
    nextBtn?.removeEventListener('click', onNext);
    instanceMap.delete(root);
    carousel.destroy();
  };
  instanceMap.set(root, destroy);
  return destroy;
}
