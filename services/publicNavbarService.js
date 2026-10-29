/**
 * Shared public navbar CMS loader + parent/child nav tree.
 */
'use strict';

const cmsContent = require('./cmsContentService');
const publishing = require('./cmsPublishingService');

const NAV_CHILD_DESCRIPTIONS = Object.freeze({
  '/soluciones-digitales': 'Sitios web, hosting, marketing y presencia digital.',
  '/fabricacion-3d': 'Impresión FDM/resina, piezas personalizadas y prototipos.',
  '/cotizar/otros': '¿Tu proyecto no encaja en una categoría? Contanos qué necesitás.',
  '/cotizar/sitio-web': 'Contanos qué tipo de sitio o solución digital necesitás.',
  '/cotizar/pieza-3d': 'Medidas, material, imágenes y detalles de tu pieza.',
});

const FALLBACK_NAV_TREE = Object.freeze([
  {
    publicId: 'fallback-tienda',
    label: 'Tienda',
    url: '/tienda',
    target: '_self',
    children: [],
  },
  {
    publicId: 'fallback-servicios',
    label: 'Servicios',
    url: '/soluciones-digitales',
    target: '_self',
    children: [
      { publicId: 'fallback-svc-digital', label: 'Soluciones Digitales', url: '/soluciones-digitales', target: '_self', description: NAV_CHILD_DESCRIPTIONS['/soluciones-digitales'] },
      { publicId: 'fallback-svc-3d', label: 'Fabricación 3D', url: '/fabricacion-3d', target: '_self', description: NAV_CHILD_DESCRIPTIONS['/fabricacion-3d'] },
      { publicId: 'fallback-svc-otros', label: 'Otros', url: '/cotizar/otros', target: '_self', description: NAV_CHILD_DESCRIPTIONS['/cotizar/otros'] },
    ],
  },
  {
    publicId: 'fallback-galeria',
    label: 'Galería',
    url: '/galeria',
    target: '_self',
    children: [],
  },
  {
    publicId: 'fallback-cotizar',
    label: 'Cotizar',
    url: '/cotizar/pieza-3d',
    target: '_self',
    children: [
      { publicId: 'fallback-q-web', label: 'Sitio web', url: '/cotizar/sitio-web', target: '_self', description: NAV_CHILD_DESCRIPTIONS['/cotizar/sitio-web'] },
      { publicId: 'fallback-q-3d', label: 'Pieza 3D', url: '/cotizar/pieza-3d', target: '_self', description: NAV_CHILD_DESCRIPTIONS['/cotizar/pieza-3d'] },
      { publicId: 'fallback-q-otros', label: 'Otros', url: '/cotizar/otros', target: '_self', description: NAV_CHILD_DESCRIPTIONS['/cotizar/otros'] },
    ],
  },
  {
    publicId: 'fallback-nosotros',
    label: 'Nosotros',
    url: '/nosotros',
    target: '_self',
    children: [],
  },
]);

/**
 * Build parent→children tree from flat published nav rows.
 * Only top-level items (no parent) appear in the primary list.
 * @param {Array<object>} flatItems
 * @returns {Array<object>}
 */
function buildNavTree(flatItems) {
  const items = Array.isArray(flatItems) ? flatItems : [];
  const byId = new Map();
  for (const raw of items) {
    const id = Number(raw.id);
    if (!Number.isFinite(id)) continue;
    byId.set(id, {
      id,
      publicId: raw.public_id || raw.publicId || '',
      parentId: raw.parent_id != null ? Number(raw.parent_id) : (raw.parentId != null ? Number(raw.parentId) : null),
      label: String(raw.label || '').trim(),
      url: String(raw.url || '').trim() || '/',
      target: raw.target === '_blank' ? '_blank' : '_self',
      sortOrder: Number(raw.sort_order ?? raw.sortOrder) || 0,
      children: [],
    });
  }

  const roots = [];
  for (const item of byId.values()) {
    if (item.parentId && byId.has(item.parentId) && item.parentId !== item.id) {
      const parent = byId.get(item.parentId);
      parent.children.push({
        publicId: item.publicId,
        label: item.label,
        url: item.url,
        target: item.target,
        description: NAV_CHILD_DESCRIPTIONS[item.url] || '',
      });
    } else {
      roots.push(item);
    }
  }

  roots.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const root of roots) {
    root.children.sort((a, b) => String(a.label).localeCompare(String(b.label), 'es'));
    // Prefer canonical child order for known groups
    root.children = orderKnownChildren(root.url, root.children);
  }

  return roots.map((root) => ({
    publicId: root.publicId,
    label: root.label,
    url: root.url,
    target: root.target,
    children: root.children,
  }));
}

function orderKnownChildren(parentUrl, children) {
  const orders = {
    '/soluciones-digitales': ['/soluciones-digitales', '/fabricacion-3d', '/cotizar/otros'],
    '/cotizar/pieza-3d': ['/cotizar/sitio-web', '/cotizar/pieza-3d', '/cotizar/otros'],
    '#servicios-ninjalab': ['/soluciones-digitales', '/fabricacion-3d', '/cotizar/otros'],
  };
  const order = orders[parentUrl];
  if (!order) return children;
  return [...children].sort((a, b) => {
    const ai = order.indexOf(a.url);
    const bi = order.indexOf(b.url);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

/**
 * Active parent/child flags for current path.
 * /cotizar/otros activates Cotizar (not Servicios).
 * @param {string} currentPath
 * @param {object} item top-level nav item
 */
function resolveNavActiveState(currentPath, item) {
  const path = String(currentPath || '');
  const url = String(item.url || '');
  const children = Array.isArray(item.children) ? item.children : [];
  const hasChildren = children.length > 0;

  let childActiveUrl = '';
  for (const child of children) {
    if (pathMatches(path, child.url)) {
      childActiveUrl = child.url;
      break;
    }
  }

  let parentActive = false;
  if (url === '/tienda' || path.startsWith('/tienda')) {
    parentActive = url === '/tienda' && path.startsWith('/tienda');
  } else if (url === '/galeria' || path.startsWith('/galeria')) {
    parentActive = url === '/galeria' && path.startsWith('/galeria');
  } else if (url === '/nosotros' || path.startsWith('/nosotros')) {
    parentActive = url === '/nosotros' && path.startsWith('/nosotros');
  } else if (
    url === '/soluciones-digitales'
    || url === '/fabricacion-3d'
    || url.startsWith('#servicios')
    || item.label === 'Servicios'
  ) {
    // Servicios: digital / fabricacion — NOT /cotizar/otros
    parentActive = path === '/soluciones-digitales' || path.startsWith('/soluciones-digitales/')
      || path === '/fabricacion-3d' || path.startsWith('/fabricacion-3d/');
  } else if (
    url.startsWith('/cotizar')
    || item.label === 'Cotizar'
  ) {
    parentActive = path.startsWith('/cotizar');
  } else if (!hasChildren) {
    parentActive = pathMatches(path, url);
  } else if (childActiveUrl) {
    parentActive = true;
  }

  return {
    parentActive,
    childActiveUrl,
    hasChildren,
  };
}

function pathMatches(currentPath, url) {
  const path = String(currentPath || '');
  const u = String(url || '');
  if (!u || u.startsWith('#')) return false;
  if (path === u) return true;
  if (u !== '/' && path.startsWith(u + '/')) return true;
  return false;
}

async function getPublishedNavTree(location = 'home') {
  try {
    const flat = await publishing.getPublishedNavItems(location);
    if (!flat || !flat.length) return FALLBACK_NAV_TREE.map((x) => ({ ...x, children: [...(x.children || [])] }));
    const tree = buildNavTree(flat);
    if (!tree.length) return FALLBACK_NAV_TREE.map((x) => ({ ...x, children: [...(x.children || [])] }));
    return tree;
  } catch {
    return FALLBACK_NAV_TREE.map((x) => ({ ...x, children: [...(x.children || [])] }));
  }
}

async function getNavbarCmsData(location = 'home') {
  const [navItems, rawSettings] = await Promise.all([
    getPublishedNavTree(location),
    publishing.getPublishedSettings([
      'site.logo_primary', 'site.logo_light', 'site.logo_dark',
      'navbar.bg_color', 'navbar.text_color', 'navbar.accent_color',
    ]),
  ]);
  const settings = Object.fromEntries(
    Object.entries(rawSettings || {}).map(([key, value]) => [
      key,
      value === null || value === undefined || value === 'null' ? '' : value,
    ])
  );
  const logos = {};
  for (const [name, key] of Object.entries({
    primary: 'site.logo_primary',
    light: 'site.logo_light',
    dark: 'site.logo_dark',
  })) {
    logos[name] = await cmsContent.resolveMediaReference(settings[key], null);
  }
  return { navItems, settings, logos };
}

module.exports = {
  NAV_CHILD_DESCRIPTIONS,
  FALLBACK_NAV_TREE,
  buildNavTree,
  resolveNavActiveState,
  getPublishedNavTree,
  getNavbarCmsData,
};
