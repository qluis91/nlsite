'use strict';

const publicNavbar = require('../services/publicNavbarService');

async function renderServicePage(req, res, next, { view, title, metaTitle, metaDescription, canonical }) {
  try {
    const cmsData = await publicNavbar.getNavbarCmsData();
    return res.render(view, {
      title,
      metaTitle,
      metaDescription,
      canonical,
      robots: 'index,follow',
      layout: 'layouts/main',
      pageClass: 'page-services',
      pageStyles: ['/css/public-navbar.css', '/css/services-pages.css'],
      pageModule: '/js/public-navbar.js',
      usesHeroNavbar: true,
      cmsData,
      currentPath: req.path,
    });
  } catch (error) {
    return next(error);
  }
}

function showDigitalSolutions(req, res, next) {
  return renderServicePage(req, res, next, {
    view: 'pages/soluciones-digitales',
    title: 'Soluciones digitales',
    metaTitle: 'Soluciones digitales | NinjaLabCR',
    metaDescription: 'Sitios web a medida, hosting, correos empresariales, marketing digital y presencia online con NinjaLabCR.',
    canonical: '/soluciones-digitales',
  });
}

function showFabricacion3d(req, res, next) {
  return renderServicePage(req, res, next, {
    view: 'pages/fabricacion-3d',
    title: 'Fabricación 3D',
    metaTitle: 'Fabricación e impresión 3D | NinjaLabCR',
    metaDescription: 'Impresión FDM y resina, piezas personalizadas, prototipos, figuras y acabados con NinjaLabCR.',
    canonical: '/fabricacion-3d',
  });
}

module.exports = { showDigitalSolutions, showFabricacion3d };
