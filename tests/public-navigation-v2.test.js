/**
 * Public navigation v2 — tree, active states, shared CMS navbar helper.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const publicNavbar = require('../services/publicNavbarService');

describe('publicNavbarService buildNavTree', () => {
  it('builds parent/child tree and keeps children off top-level', () => {
    const tree = publicNavbar.buildNavTree([
      { id: 1, public_id: 'a', label: 'Tienda', url: '/tienda', parent_id: null, sort_order: 1 },
      { id: 2, public_id: 'b', label: 'Servicios', url: '/soluciones-digitales', parent_id: null, sort_order: 2 },
      { id: 3, public_id: 'c', label: 'Soluciones Digitales', url: '/soluciones-digitales', parent_id: 2, sort_order: 1 },
      { id: 4, public_id: 'd', label: 'Fabricación 3D', url: '/fabricacion-3d', parent_id: 2, sort_order: 2 },
      { id: 5, public_id: 'e', label: 'Otros', url: '/cotizar/otros', parent_id: 2, sort_order: 3 },
      { id: 6, public_id: 'f', label: 'Cotizar', url: '/cotizar/pieza-3d', parent_id: null, sort_order: 4 },
      { id: 7, public_id: 'g', label: 'Sitio web', url: '/cotizar/sitio-web', parent_id: 6, sort_order: 1 },
      { id: 8, public_id: 'h', label: 'Pieza 3D', url: '/cotizar/pieza-3d', parent_id: 6, sort_order: 2 },
      { id: 9, public_id: 'i', label: 'Otros', url: '/cotizar/otros', parent_id: 6, sort_order: 3 },
    ]);

    assert.equal(tree.length, 3);
    assert.deepEqual(tree.map((t) => t.label), ['Tienda', 'Servicios', 'Cotizar']);
    const servicios = tree.find((t) => t.label === 'Servicios');
    assert.deepEqual(servicios.children.map((c) => c.label), [
      'Soluciones Digitales', 'Fabricación 3D', 'Otros',
    ]);
    const cotizar = tree.find((t) => t.label === 'Cotizar');
    assert.deepEqual(cotizar.children.map((c) => c.label), [
      'Sitio web', 'Pieza 3D', 'Otros',
    ]);
    assert.ok(!tree.some((t) => t.label === 'Pieza 3D'));
  });

  it('fallback nav matches canonical Services + Cotizar structure', () => {
    const fb = publicNavbar.FALLBACK_NAV_TREE;
    const labels = fb.map((i) => i.label);
    assert.deepEqual(labels, ['Tienda', 'Servicios', 'Galería', 'Cotizar', 'Nosotros']);
    const svc = fb.find((i) => i.label === 'Servicios');
    assert.deepEqual(svc.children.map((c) => c.label), [
      'Soluciones Digitales', 'Fabricación 3D', 'Otros',
    ]);
    const quote = fb.find((i) => i.label === 'Cotizar');
    assert.deepEqual(quote.children.map((c) => c.label), [
      'Sitio web', 'Pieza 3D', 'Otros',
    ]);
  });
});

describe('publicNavbarService active states', () => {
  const servicios = {
    label: 'Servicios',
    url: '/soluciones-digitales',
    children: [
      { url: '/soluciones-digitales', label: 'Soluciones Digitales' },
      { url: '/fabricacion-3d', label: 'Fabricación 3D' },
      { url: '/cotizar/otros', label: 'Otros' },
    ],
  };
  const cotizar = {
    label: 'Cotizar',
    url: '/cotizar/pieza-3d',
    children: [
      { url: '/cotizar/sitio-web', label: 'Sitio web' },
      { url: '/cotizar/pieza-3d', label: 'Pieza 3D' },
      { url: '/cotizar/otros', label: 'Otros' },
    ],
  };

  it('marks Servicios for digital and 3D manufacturing paths', () => {
    assert.equal(publicNavbar.resolveNavActiveState('/soluciones-digitales', servicios).parentActive, true);
    assert.equal(publicNavbar.resolveNavActiveState('/fabricacion-3d', servicios).parentActive, true);
    assert.equal(publicNavbar.resolveNavActiveState('/cotizar/otros', servicios).parentActive, false);
  });

  it('marks Cotizar for all /cotizar/* including otros', () => {
    assert.equal(publicNavbar.resolveNavActiveState('/cotizar/pieza-3d', cotizar).parentActive, true);
    assert.equal(publicNavbar.resolveNavActiveState('/cotizar/otros', cotizar).parentActive, true);
    assert.equal(publicNavbar.resolveNavActiveState('/cotizar/sitio-web', cotizar).parentActive, true);
  });

  it('does not activate both parents for /cotizar/otros', () => {
    const svc = publicNavbar.resolveNavActiveState('/cotizar/otros', servicios);
    const quote = publicNavbar.resolveNavActiveState('/cotizar/otros', cotizar);
    assert.equal(svc.parentActive, false);
    assert.equal(quote.parentActive, true);
  });
});
