'use strict';

const quoteService = require('../services/quoteRequestService');
const validator = require('../validators/quoteRequestValidator');
const { formatDateTimeCR } = require('../utils/dateTime');

function ninja(key, type, text) {
  return { type, title: String(text || ''), id: key };
}

function setAlerts(req, alerts) {
  req.session.cms_alerts = alerts;
}

async function showList(req, res, next) {
  try {
    const type = String(req.query.type || '').trim();
    const status = String(req.query.status || '').trim();
    const rawItems = await quoteService.listQuoteRequests({ type, status });
    const items = rawItems.map((item) => ({
      ...item,
      createdAtLabel: formatDateTimeCR(item.created_at),
    }));
    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;
    return res.render('pages/admin/quotes/index', {
      title: 'Solicitudes de cotización',
      layout: 'layouts/admin',
      items,
      filters: { type, status },
      typeLabels: quoteService.TYPE_LABELS,
      statusLabels: quoteService.STATUS_LABELS,
      pageAlerts,
      currentPath: '/admin/cotizaciones',
    });
  } catch (error) {
    return next(error);
  }
}

async function showDetail(req, res, next) {
  try {
    const raw = await quoteService.getQuoteRequestByPublicId(req.params.publicId);
    if (!raw) {
      setAlerts(req, [ninja('nf', 'error', 'Solicitud no encontrada.')]);
      return res.redirect('/admin/cotizaciones');
    }
    const item = {
      ...raw,
      createdAtLabel: formatDateTimeCR(raw.created_at),
    };
    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;
    return res.render('pages/admin/quotes/detail', {
      title: `Cotización ${item.public_id.slice(0, 8)}`,
      layout: 'layouts/admin',
      item,
      statusLabels: quoteService.STATUS_LABELS,
      statusValues: validator.STATUS_VALUES,
      pageAlerts,
      currentPath: '/admin/cotizaciones',
      safeFileLink: validator.safeHttpUrl(item.payload?.fileLink || '').value || '',
    });
  } catch (error) {
    return next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const statusResult = validator.validateStatus(req.body.status);
    if (!statusResult.valid) {
      setAlerts(req, [ninja('st', 'error', statusResult.error)]);
      return res.redirect(`/admin/cotizaciones/${encodeURIComponent(req.params.publicId)}`);
    }
    const ok = await quoteService.updateQuoteStatus(req.params.publicId, statusResult.value);
    if (!ok) {
      setAlerts(req, [ninja('nf', 'error', 'Solicitud no encontrada.')]);
      return res.redirect('/admin/cotizaciones');
    }
    setAlerts(req, [ninja('st', 'success', 'Estado actualizado.')]);
    return res.redirect(`/admin/cotizaciones/${encodeURIComponent(req.params.publicId)}`);
  } catch (error) {
    return next(error);
  }
}

module.exports = { showList, showDetail, updateStatus };
