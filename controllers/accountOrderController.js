const customerOrders = require('../services/customerOrderService');
const accountService = require('../services/accountService');
const proofService = require('../services/paymentProofService');
const tilopayService = require('../services/tilopayService');
const { getPublicCategories } = require('../services/catalogService');

async function storeOptions(req, extra = {}) {
  const categories = await getPublicCategories();
  return {
    layout: 'layouts/store',
    robots: 'noindex, nofollow',
    pageClass: 'page-store',
    pageStyles: ['/css/store.css'],
    categories,
    activeCategory: null,
    ...extra,
  };
}

async function renderNotFound(req, res) {
  const opts = await storeOptions(req, { title: 'Pedido no encontrado' });
  return res.status(404).render('pages/404', opts);
}

exports.list = async (req, res, next) => {
  try {
    const [result, opts] = await Promise.all([
      customerOrders.listOrdersForUser(req.session.user.id, req.query),
      storeOptions(req, { title: 'Mis pedidos' }),
    ]);
    return res.render('pages/store/orders', { ...opts, ...result });
  } catch (error) { return next(error); }
};

exports.detail = async (req, res, next) => {
  const reference = customerOrders.normalizeReference(req.params.reference);
  if (!reference) return renderNotFound(req, res);
  try {
    const [order, accessRecord, opts] = await Promise.all([
      customerOrders.getOrderForUser(reference, req.session.user.id),
      customerOrders.getAccessRecord(reference),
      storeOptions(req),
    ]);
    if (!order) return renderNotFound(req, res);

    const internalId = accessRecord ? accessRecord.internal_id : null;
    const [proofSummary, tilopayTx] = await Promise.all([
      internalId ? proofService.getProofSummary(internalId) : Promise.resolve(null),
      order.paymentMethod === 'tilopay' && internalId
        ? tilopayService.getTransactionSummary(internalId) : Promise.resolve(null),
    ]);

    const nextAction = customerOrders.resolveNextAction(order, proofSummary, tilopayTx);
    const orderProgress = customerOrders.resolveOrderProgress(order);

    return res.render('pages/store/order-detail', {
      ...opts,
      title: `Pedido ${order.reference}`,
      order,
      detailContext: 'account',
      proofSummary,
      tilopayTx,
      nextAction,
      orderProgress,
    });
  } catch (error) { return next(error); }
};
