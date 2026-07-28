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
  { id: 'diseno-3d', title: 'Diseño 3D', description: 'Modelado y diseño 3D profesional para prototipos y productos personalizados.', iconKey: 'diseno-3d', href: '/tienda', buttonLabel: 'VER DETALLE' },
  { id: 'escaneo-3d', title: 'Escaneo 3D', description: 'Digitalización precisa de objetos físicos para replicación o modificación.', iconKey: 'escaneo-3d', href: '/tienda', buttonLabel: 'VER DETALLE' },
  { id: 'diseno-grafico', title: 'Diseño Gráfico', description: 'Identidad visual, branding y piezas gráficas con claridad y estilo.', iconKey: 'diseno-grafico', href: '/tienda', buttonLabel: 'VER DETALLE' },
  { id: 'desarrollo-web', title: 'Desarrollo Web', description: 'Sitios web y aplicaciones funcionales adaptadas a cada necesidad.', iconKey: 'desarrollo-web', href: '/tienda', buttonLabel: 'VER DETALLE' },
  { id: 'prendas', title: 'Prendas y Sublimación', description: 'Personalización de camisetas, tazas y más con sublimación de alta calidad.', iconKey: 'prendas', href: '/tienda', buttonLabel: 'VER DETALLE' },
  { id: 'impresion-3d', title: 'Impresión 3D Gran Formato', description: 'Piezas de gran tamaño con precisión milimétrica y acabados profesionales.', iconKey: 'impresion-3d', href: '/tienda', buttonLabel: 'VER DETALLE' },
];

function renderCard(item) {
  // Semantic result: <a class="svc-card__cta">, built with DOM APIs for CMS safety.
  const card = document.createElement('div');
  card.setAttribute('role', 'listitem');
  card.setAttribute('aria-label', item.title);
  const badge = document.createElement('div');
  badge.className = 'svc-card__badge';
  badge.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('span');
  icon.className = 'svc-card__badge-icon';
  if (item.iconKey && ICON_SVG[item.iconKey]) {
    icon.innerHTML = ICON_SVG[item.iconKey];
  } else if (item.mediaUrl) {
    const image = document.createElement('img');
    image.src = item.mediaUrl;
    image.alt = item.mediaAlt || '';
    image.className = 'svc-card__media-icon';
    icon.appendChild(image);
  } else {
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M6 12h12"/></svg>';
  }
  badge.appendChild(icon);
  const title = document.createElement('h3');
  title.className = 'svc-card__title';
  title.textContent = item.title;
  const description = document.createElement('p');
  description.className = 'svc-card__desc';
  description.textContent = item.description;
  const link = document.createElement('a');
  link.className = 'svc-card__cta';
  link.href = item.href;
  if (item.target === '_blank') {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  link.setAttribute('aria-label', item.linkAriaLabel || `${item.buttonLabel}: ${item.title}`);
  link.appendChild(document.createTextNode(`${item.buttonLabel} `));
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('width', '12');
  arrow.setAttribute('height', '12');
  arrow.setAttribute('viewBox', '0 0 24 24');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-width', '2.5');
  arrow.setAttribute('aria-hidden', 'true');
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowPath.setAttribute('d', 'M5 12h14M13 5l7 7-7 7');
  arrow.appendChild(arrowPath);
  link.appendChild(arrow);
  card.append(badge, title, description, link);
  return card;
}

/**
 * Read CMS feature items from a server-rendered JSON block.
 * Falls back to the hardcoded SERVICES array when CMS data is absent or invalid.
 */
function resolveServiceItems() {
  try {
    const el = document.getElementById('services-cms-data');
    if (!el) return SERVICES;
    const raw = JSON.parse(el.textContent);
    if (!Array.isArray(raw) || raw.length === 0) return SERVICES;
    return raw.map(function(item) {
      return {
        id: item.id,
        title: item.title || 'Servicio',
        description: item.description || '',
        iconKey: item.icon_key && ICON_SVG[item.icon_key] ? item.icon_key : null,
        mediaUrl: item.media_url || null,
        mediaAlt: item.media_alt || '',
        href: item.href || '/tienda',
        target: item.target === '_blank' ? '_blank' : '_self',
        buttonLabel: item.button_label || 'VER DETALLE',
        linkAriaLabel: item.link_aria_label || '',
      };
    });
  } catch (_) {
    return SERVICES;
  }
}

export function initServicesCarousel(root) {
  if (!root) return () => {};
  if (instanceMap.has(root)) return instanceMap.get(root);

  const panel = root.closest('.home-panel--services');
  const status = panel?.querySelector('[data-svc-status]');
  const prevBtn = panel?.querySelector('[data-svc-prev]');
  const nextBtn = panel?.querySelector('[data-svc-next]');

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const serviceItems = resolveServiceItems();

  const carousel = createCircularCarousel({
    root,
    items: serviceItems,
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
