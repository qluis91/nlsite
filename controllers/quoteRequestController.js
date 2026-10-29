'use strict';

const publicNavbar = require('../services/publicNavbarService');
const quoteService = require('../services/quoteRequestService');
const validator = require('../validators/quoteRequestValidator');
const { buildWhatsAppUrl } = require('../config/publicContact');
const {
  MAX_FILES,
  MAX_BYTES,
  MAX_MB,
} = require('../middleware/quoteRequestUpload');

const REDIRECT = Object.freeze({
  website: '/cotizar/sitio-web',
  '3d': '/cotizar/pieza-3d',
  other: '/cotizar/otros',
});

const STICKY_KEYS = Object.freeze({
  website: [
    'customer_name', 'customer_email', 'customer_phone', 'company', 'website_type',
    'page_count', 'has_domain', 'has_hosting', 'business_email', 'ecommerce',
    'marketing', 'budget', 'desired_date', 'description',
  ],
  '3d': [
    'customer_name', 'customer_email', 'customer_phone', 'description',
    'width', 'depth', 'height', 'quantity', 'material', 'file_link',
    'reference_id', 'reference_product',
  ],
  other: [
    'customer_name', 'customer_email', 'customer_phone', 'project_type',
    'budget', 'desired_date', 'description',
  ],
});

function ninja(key, type, title, description) {
  const alert = { type, title: String(title || ''), id: key };
  if (description != null && String(description).trim()) {
    alert.description = String(description).trim().slice(0, 4000);
  }
  return alert;
}

function setAlerts(req, alerts) {
  req.session.cms_alerts = alerts;
}

function wantsJson(req) {
  const accept = String(req.get('accept') || '');
  if (accept.includes('application/json')) return true;
  return req.xhr === true || req.query?.format === 'json';
}

function pickStickyValues(type, body = {}) {
  const keys = STICKY_KEYS[type] || [];
  const out = {};
  for (const key of keys) {
    if (body[key] == null) continue;
    out[key] = String(body[key]).slice(0, 5000);
  }
  return out;
}

function consumeDraft(req, type) {
  const draft = req.session?.quote_form_draft;
  if (!draft || draft.type !== type) return { formValues: {}, fieldErrors: [] };
  delete req.session.quote_form_draft;
  return {
    formValues: draft.values && typeof draft.values === 'object' ? draft.values : {},
    fieldErrors: Array.isArray(draft.fieldErrors) ? draft.fieldErrors : [],
  };
}

function storeDraft(req, type, body, fieldErrors = []) {
  req.session.quote_form_draft = {
    type,
    values: pickStickyValues(type, body),
    fieldErrors,
  };
}

function mergePrefill(user, formValues) {
  return {
    name: formValues.customer_name || user?.name || '',
    email: formValues.customer_email || user?.email || '',
    phone: formValues.customer_phone || user?.phone || '',
  };
}

async function renderQuotePage(req, res, next, opts) {
  try {
    const cmsData = await publicNavbar.getNavbarCmsData();
    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;

    const draft = consumeDraft(req, opts.draftType || null);
    const formValues = { ...draft.formValues, ...(opts.formValues || {}) };
    const user = req.session?.user || res.locals.user || null;
    const prefill = mergePrefill(user, formValues);

    const referenceId = formValues.reference_id
      || opts.referenceId
      || '';
    const referenceName = formValues.reference_product
      || opts.referenceName
      || '';

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
      fieldErrors: opts.fieldErrors || draft.fieldErrors || [],
      formValues,
      referenceName,
      referenceId,
      whatsappUrl: buildWhatsAppUrl('Hola NinjaLabCR, quiero cotizar una pieza 3D.'),
      successReference: opts.successReference || '',
      maxImageFiles: MAX_FILES,
      maxImageBytes: MAX_BYTES,
      maxImageMb: MAX_MB,
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
    draftType: 'website',
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
    draftType: '3d',
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
    draftType: 'other',
  });
}

function respondValidationError(req, res, type, validation) {
  const payload = {
    ok: false,
    error: validation.error || 'Revisá los datos del formulario.',
    field: validation.field || null,
  };
  if (wantsJson(req)) {
    return res.status(422).json(payload);
  }
  storeDraft(req, type, req.body, validation.field ? [validation.field] : []);
  setAlerts(req, [ninja('qerr', 'warning', 'Revisá la cotización', payload.error)]);
  let location = REDIRECT[type] || '/cotizar/otros';
  if (type === '3d') {
    const ref = String(req.body.reference_id || '').trim();
    const nombre = String(req.body.reference_product || '').trim();
    const qs = new URLSearchParams();
    if (ref) qs.set('ref', ref.slice(0, 80));
    if (nombre) qs.set('nombre', nombre.slice(0, 200));
    const q = qs.toString();
    if (q) location += `?${q}`;
  }
  return res.redirect(location);
}

function respondFileError(req, res, type, message, status = 400) {
  if (wantsJson(req)) {
    return res.status(status).json({ ok: false, error: message, field: 'images' });
  }
  storeDraft(req, type, req.body, ['images']);
  setAlerts(req, [ninja('qerr', 'warning', 'No pudimos usar esa imagen', message)]);
  return res.redirect(REDIRECT[type] || '/cotizar/otros');
}

async function submitQuote(req, res, next, type) {
  try {
    const validation = validator.validateByType(type, {
      ...req.body,
      reference_id: req.body.reference_id || req.body.ref,
      reference_product: req.body.reference_product || req.body.nombre,
    });
    if (!validation.valid) {
      return respondValidationError(req, res, type, validation);
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length > 5) {
      return respondFileError(req, res, type, 'Máximo 5 imágenes de referencia.', 422);
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

    const description = `Recibimos tu solicitud ${created.reference}. Revisaremos la información y te contactaremos para preparar la propuesta.`;
    if (wantsJson(req)) {
      return res.status(201).json({
        ok: true,
        reference: created.reference,
        title: 'Cotización enviada correctamente',
        message: description,
      });
    }

    if (req.session?.quote_form_draft) delete req.session.quote_form_draft;
    setAlerts(req, [ninja('qok', 'success', 'Cotización enviada correctamente', description)]);
    return res.redirect(REDIRECT[type] || '/cotizar/otros');
  } catch (error) {
    if (error.code === 'TOO_MANY_FILES' || error.code === 'BAD_MIME' || error.code === 'BAD_IMAGE') {
      return respondFileError(
        req,
        res,
        type,
        error.message || 'No se pudo procesar la imagen.',
        error.code === 'TOO_MANY_FILES' ? 422 : 400
      );
    }
    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        error: 'No se pudo enviar la cotización. Intentá nuevamente.',
      });
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
