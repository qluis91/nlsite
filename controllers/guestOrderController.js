const customerOrders = require('../services/customerOrderService');
const proofService = require('../services/paymentProofService');
const tilopayService = require('../services/tilopayService');

const GENERIC_ERROR = 'No pudimos verificar los datos del pedido.';

function renderLookup(res, options = {}) {
  return res.status(options.status || 200).render('pages/guest-order-lookup', {
    title: 'Consultar pedido', robots: 'noindex,nofollow', layout: 'layouts/main',
    pageClass: 'page-account-orders', pageStyles: ['/css/account-orders.css'],
    lookupError: options.error || null,
    form: { reference: options.reference || '', email: options.email || '' },
  });
}

function renderNotFound(res) {
  return res.status(404).render('pages/404', { title: 'Pedido no encontrado', layout: 'layouts/main' });
}

exports.showLookup = (_req, res) => renderLookup(res);

exports.lookup = async (req, res, next) => {
  const reference = customerOrders.normalizeReference(req.body.reference);
  const email = customerOrders.normalizeEmail(req.body.email);
  if (!reference || !email || req.session.user) {
    return renderLookup(res, { error: GENERIC_ERROR, reference: req.body.reference, email: req.body.email });
  }
  try {
    const verifiedReference = await customerOrders.verifyGuestOrder(reference, email);
    if (!verifiedReference) {
      return renderLookup(res, { error: GENERIC_ERROR, reference: req.body.reference, email: req.body.email });
    }
    customerOrders.grantGuestOrderAccess(req.session, verifiedReference);
    return req.session.save((error) => {
      if (error) return next(error);
      return res.redirect(`/consultar-pedido/${verifiedReference}`);
    });
  } catch (error) { return next(error); }
};

exports.detail = async (req, res, next) => {
  const reference = customerOrders.normalizeReference(req.params.reference);
  if (!reference) return renderNotFound(res);
  try {
    const accessRecord = await customerOrders.getAccessRecord(reference);
    const allowed = customerOrders.canAccessCustomerOrder({
      order: accessRecord, authenticatedUser: req.session.user, session: req.session,
    });
    if (!allowed) return renderNotFound(res);
    const order = await customerOrders.getCustomerSafeOrder(reference);
    if (!order) return renderNotFound(res);
    const proofSummary = accessRecord ? await proofService.getProofSummary(accessRecord.internal_id) : null;
    const tilopayTx = order.payment_method === 'tilopay'
      ? await tilopayService.getTransactionSummary(accessRecord ? accessRecord.internal_id : null) : null;
    return res.render('pages/customer-order-detail', {
      title: 'Detalle del pedido', robots: 'noindex,nofollow', layout: 'layouts/main',
      pageClass: 'page-account-orders', pageStyles: ['/css/account-orders.css'],
      order, detailContext: 'guest', isConfirmation: false, proofSummary, tilopayTx,
    });
  } catch (error) { return next(error); }
};

exports.rateLimitExceeded = (_req, res) => renderLookup(res, { status: 429, error: GENERIC_ERROR });
exports.GENERIC_ERROR = GENERIC_ERROR;
