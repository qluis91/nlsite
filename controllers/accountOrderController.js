const customerOrders = require('../services/customerOrderService');
const accountService = require('../services/accountService');
const proofService = require('../services/paymentProofService');
const tilopayService = require('../services/tilopayService');
const { accountViewOptions } = require('./accountController');

async function renderNotFound(req, res) {
  const accountUser = await accountService.getUserProfile(req.session.user.id);
  return res.status(404).render('pages/404', accountViewOptions(accountUser, 'orders', {
    title: 'Pedido no encontrado',
  }));
}

exports.list = async (req, res, next) => {
  try {
    const [result, accountUser] = await Promise.all([
      customerOrders.listOrdersForUser(req.session.user.id, req.query),
      accountService.getUserProfile(req.session.user.id),
    ]);
    return res.render('pages/account/orders', accountViewOptions(accountUser, 'orders', {
      title: 'Mis pedidos',
      ...result,
    }));
  } catch (error) { return next(error); }
};

exports.detail = async (req, res, next) => {
  const reference = customerOrders.normalizeReference(req.params.reference);
  if (!reference) return renderNotFound(req, res);
  try {
    const [order, accountUser, accessRecord] = await Promise.all([
      customerOrders.getOrderForUser(reference, req.session.user.id),
      accountService.getUserProfile(req.session.user.id),
      customerOrders.getAccessRecord(reference),
    ]);
    if (!order) return renderNotFound(req, res);
    const proofSummary = accessRecord ? await proofService.getProofSummary(accessRecord.internal_id) : null;
    const tilopayTx = order.payment_method === 'tilopay'
      ? await tilopayService.getTransactionSummary(accessRecord ? accessRecord.internal_id : null) : null;
    return res.render('pages/customer-order-detail', accountViewOptions(accountUser, 'orders', {
      title: 'Detalle del pedido',
      order,
      detailContext: 'account',
      isConfirmation: false,
      proofSummary,
      tilopayTx,
    }));
  } catch (error) { return next(error); }
};
