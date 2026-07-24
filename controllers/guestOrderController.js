const customerOrders = require('../services/customerOrderService');
const proofService = require('../services/paymentProofService');
const tilopayService = require('../services/tilopayService');
const { getPublicCategories } = require('../services/catalogService');

const GENERIC_ERROR = 'No pudimos verificar los datos del pedido.';

async function storeLookupOptions(extra = {}) {
  const categories = await getPublicCategories();
  return {
    layout: 'layouts/store',
    robots: 'noindex,nofollow',
    pageClass: 'page-store',
    pageStyles: ['/css/store.css'],
    categories,
    activeCategory: null,
    ...extra,
  };
}

async function renderLookup(res, options = {}) {
  const opts = await storeLookupOptions({ title: 'Consultar pedido' });
  return res.status(options.status || 200).render('pages/store/guest-lookup', {
    ...opts,
    lookupError: options.error || null,
    form: { reference: options.reference || '', email: options.email || '' },
  });
}

function renderNotFound(res) {
  return res.status(404).render('pages/404', { title: 'Pedido no encontrado', layout: 'layouts/store',
    categories: [], activeCategory: null, pageClass: 'page-store', pageStyles: ['/css/store.css'] });
}

exports.showLookup = async (_req, res) => {
  try { await renderLookup(res); } catch (e) { res.status(500).render('pages/404', { title: 'Error', layout: 'layouts/main' }); }
};

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
    const [order, opts] = await Promise.all([
      customerOrders.getCustomerSafeOrder(reference),
      storeLookupOptions({ title: `Pedido ${reference}` }),
    ]);
    if (!order) return renderNotFound(res);
    const internalId = accessRecord ? accessRecord.internal_id : null;
    const [proofSummary, tilopayTx] = await Promise.all([
      internalId ? proofService.getProofSummary(internalId) : Promise.resolve(null),
      order.paymentMethod === 'tilopay' && internalId
        ? tilopayService.getTransactionSummary(internalId) : Promise.resolve(null),
    ]);
    const nextAction = customerOrders.resolveNextAction(order, proofSummary, tilopayTx);
    const orderProgress = customerOrders.resolveOrderProgress(order);
    return res.render('pages/store/order-detail', {
      ...opts, order, detailContext: 'guest', proofSummary, tilopayTx, nextAction, orderProgress,
    });
  } catch (error) { return next(error); }
};

exports.rateLimitExceeded = async (_req, res) => {
  try { await renderLookup(res, { status: 429, error: GENERIC_ERROR }); } catch (e) { res.status(500).end(); }
};

exports.GENERIC_ERROR = GENERIC_ERROR;
