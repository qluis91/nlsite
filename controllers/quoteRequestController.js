'use strict';

const publicNavbar = require('../services/publicNavbarService');
const quoteService = require('../services/quoteRequestService');
const validator = require('../validators/quoteRequestValidator');
const { buildWhatsAppUrl } = require('../config/publicContact');

function ninja(key, type, text) {
  return { type, title: String(text || ''), id: key };
}

function setAlerts(req, alerts) {
  req.session.cms_alerts = alerts;
}

async function renderQuotePage(req, res, next, opts) {
  try {
    const cmsData = await publicNavbar.getNavbarCmsData();
    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;

    const user = req.session?.user || res.locals.user || null;
    const prefill = {
      name: user?.name || '',
      email: user?.email || '',
      phone: user?.phone || '',
    };

    return res.render(opts.view, {
      title: opts.title,
      metaTitle: opts.metaTitle,
      metaDescription: opts.metaDescription,
      canonical: opts.canonical,
      robots: 'index,follow',
      layout: 'layouts/main',
      pageClass: 'page-quote',
      pageStyles: ['/css/public-navbar.css', '/css/quote-pages.css'],
      pageModule: opts.pageModule || '/js/public-navbar.js',
      usesHeroNavbar: true,
      cmsData,
      currentPath: req.path,
      pageAlerts,
      prefill,
      csrfToken: res.locals.csrfToken || req.csrfToken?.(),
      fieldErrors: opts.fieldErrors || [],
      formValues: opts.formValues || {},
      referenceName: opts.referenceName || '',
      referenceId: opts.referenceId || '',
      whatsappUrl: buildWhatsAppUrl('Hola NinjaLabCR, quiero cotizar una pieza 3D.'),
      successReference: opts.successReference || '',
    });
  } catch (error) {
    return next(error);
  }
}

function showWebsiteQuote(req, res, next) {
  return renderQuotePage(req, res, next, {
    view: 'pages/quotes/website',
    title: 'Cotización de sitio web',
    metaTitle: 'Cotizar sitio web | NinjaLabCR',
    metaDescription: 'Solicitá una cotización para tu sitio web, tienda en línea o presencia digital con NinjaLabCR.',
    canonical: '/cotizar/sitio-web',
  });
}

function show3dQuote(req, res, next) {
  const referenceId = String(req.query.ref || '').trim().slice(0, 80);
  const referenceName = String(req.query.nombre || req.query.name || '').trim().slice(0, 200);
  return renderQuotePage(req, res, next, {
    view: 'pages/quotes/3d',
    title: 'Cotización personalizada 3D',
    metaTitle: 'Cotizar pieza 3D | NinjaLabCR',
    metaDescription: 'Cotizá impresión 3D: medidas, material, imágenes de referencia y link de archivo 3D.',
    canonical: '/cotizar/pieza-3d',
    pageModule: '/js/quote-3d.js',
    referenceId,
    referenceName,
  });
}

function showOtherQuote(req, res, next) {
  return renderQuotePage(req, res, next, {
    view: 'pages/quotes/other',
    title: 'Solicitar cotización',
    metaTitle: 'Solicitar cotización | NinjaLabCR',
    metaDescription: 'Contanos tu proyecto y solicitá una cotización personalizada con NinjaLabCR.',
    canonical: '/cotizar/otros',
  });
}

async function submitQuote(req, res, next, type) {
  try {
    const validation = validator.validateByType(type, {
      ...req.body,
      reference_id: req.body.reference_id || req.body.ref,
      reference_product: req.body.reference_product || req.body.nombre,
    });
    if (!validation.valid) {
      setAlerts(req, [ninja('qerr', 'error', validation.error)]);
      const redirectMap = {
        website: '/cotizar/sitio-web',
        '3d': '/cotizar/pieza-3d',
        other: '/cotizar/otros',
      };
      return res.redirect(redirectMap[type] || '/cotizar/otros');
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length > 5) {
      setAlerts(req, [ninja('qerr', 'error', 'Máximo 5 imágenes de referencia.')]);
      return res.redirect(type === '3d' ? '/cotizar/pieza-3d' : '/cotizar/otros');
    }

    const user = req.session?.user || res.locals.user || null;
    const created = await quoteService.createQuoteRequest({
      requestType: validation.value.requestType,
      customerName: validation.value.customerName,
      customerEmail: user?.email || validation.value.customerEmail,
      customerPhone: validation.value.customerPhone,
      subject: validation.value.subject,
      payload: validation.value.payload,
      sourceUrl: req.originalUrl || req.path || '',
      userId: user?.id || null,
      files,
    });

    setAlerts(req, [ninja('qok', 'success',
      `Recibimos tu solicitud (${created.reference}). Revisaremos la información y te contactaremos para preparar la propuesta.`
    )]);

    const redirectMap = {
      website: '/cotizar/sitio-web',
      '3d': '/cotizar/pieza-3d',
      other: '/cotizar/otros',
    };
    return res.redirect(redirectMap[type] || '/cotizar/otros');
  } catch (error) {
    if (error.code === 'TOO_MANY_FILES' || error.code === 'BAD_MIME' || error.code === 'BAD_IMAGE') {
      setAlerts(req, [ninja('qerr', 'error', error.message || 'No se pudo procesar la imagen.')]);
      return res.redirect(type === '3d' ? '/cotizar/pieza-3d' : '/cotizar/otros');
    }
    return next(error);
  }
}

function submitWebsite(req, res, next) { return submitQuote(req, res, next, 'website'); }
function submit3d(req, res, next) { return submitQuote(req, res, next, '3d'); }
function submitOther(req, res, next) { return submitQuote(req, res, next, 'other'); }

module.exports = {
  showWebsiteQuote,
  show3dQuote,
  showOtherQuote,
  submitWebsite,
  submit3d,
  submitOther,
};
