/**
 * Legal Pages Controller — Privacy, Terms, Data Deletion.
 *
 * Renders static legal content for Meta OAuth compliance and
 * provider integrations. No authentication required.
 */
const site = require('../config/site');

function showPrivacy(req, res, next) {
  try {
    const contactEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'info@ninjalabcr.com';
    const siteUrl = (process.env.SITE_URL || process.env.APP_URL || 'https://ninjalabcr.com').replace(/\/$/, '');

    return res.render('pages/legal/privacidad', {
      title: 'Política de Privacidad',
      layout: 'layouts/main',
      metaTitle: 'Política de Privacidad — ' + site.name,
      metaDescription: 'Política de privacidad de ' + site.name + '. Información sobre cómo tratamos tus datos personales, integraciones sociales y tus derechos.',
      canonical: siteUrl + '/privacidad',
      robots: 'index,follow',
      site,
      contactEmail,
      siteUrl,
      pageClass: 'page-legal',
      pageStyles: ['/css/home.css'],
      updateDate: 'Agosto 2026',
    });
  } catch (error) {
    next(error);
  }
}

function showTerms(req, res, next) {
  try {
    const contactEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'info@ninjalabcr.com';
    const siteUrl = (process.env.SITE_URL || process.env.APP_URL || 'https://ninjalabcr.com').replace(/\/$/, '');

    return res.render('pages/legal/terminos', {
      title: 'Términos de Servicio',
      layout: 'layouts/main',
      metaTitle: 'Términos de Servicio — ' + site.name,
      metaDescription: 'Términos de servicio de ' + site.name + '. Condiciones de uso del sitio web, cuentas, pedidos y contenido.',
      canonical: siteUrl + '/terminos',
      robots: 'index,follow',
      site,
      contactEmail,
      siteUrl,
      pageClass: 'page-legal',
      pageStyles: ['/css/home.css'],
      updateDate: 'Agosto 2026',
    });
  } catch (error) {
    next(error);
  }
}

function showDataDeletion(req, res, next) {
  try {
    const contactEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'info@ninjalabcr.com';
    const siteUrl = (process.env.SITE_URL || process.env.APP_URL || 'https://ninjalabcr.com').replace(/\/$/, '');

    return res.render('pages/legal/eliminacion-de-datos', {
      title: 'Eliminación de Datos',
      layout: 'layouts/main',
      metaTitle: 'Eliminación de Datos — ' + site.name,
      metaDescription: 'Instrucciones para solicitar la eliminación de datos de ' + site.name + ', revocar autorizaciones de Facebook, Instagram y TikTok, y eliminar información de integraciones sociales.',
      canonical: siteUrl + '/eliminacion-de-datos',
      robots: 'index,follow',
      site,
      contactEmail,
      siteUrl,
      pageClass: 'page-legal',
      pageStyles: ['/css/home.css'],
      updateDate: 'Agosto 2026',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { showPrivacy, showTerms, showDataDeletion };
