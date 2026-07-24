/**
 * Checkout Controller — GET/POST checkout, confirmation page.
 */
const { validateCheckoutPayload } = require('../validators/checkoutValidator');
const { validateCartForCheckout, generateCheckoutToken, createOrder } = require('../services/orderService');
const { getSessionCart, clearCart } = require('../services/cartService');
const { DELIVERY_METHODS, PAYMENT_METHODS, ALL_PAYMENT_KEYS, CR_PROVINCES } = require('../config/checkoutOptions');
const customerOrders = require('../services/customerOrderService');
const addressService = require('../services/addressService');
const { parsePositiveId } = require('../validators/addressValidator');

const ADDRESS_ERROR_FIELDS = ['province', 'canton', 'distrito', 'addressLine', 'addressReference'];

async function checkoutAddressOptions(req) {
  if (!req.session.user) {
    return { savedAddresses: [], defaultAddressId: null };
  }
  const savedAddresses = await addressService.listForUser(req.session.user.id);
  const defaultAddress = savedAddresses.find((address) => address.isDefault);
  return {
    savedAddresses,
    defaultAddressId: defaultAddress ? defaultAddress.id : null,
  };
}

function checkoutViewData(req, checkout, token, options, extra = {}) {
  return {
    title: 'Finalizar pedido',
    robots: 'noindex,nofollow',
    layout: 'layouts/main',
    pageClass: 'page-checkout',
    pageStyles: ['/css/home.css', '/css/store.css', '/css/cart.css', '/css/checkout.css'],
    pageModule: '/js/checkout/checkout.js',
    usesHeroNavbar: true,
    navbarSearchContext: 'store',
    checkout,
    token,
    deliveryMethods: DELIVERY_METHODS,
    paymentMethods: PAYMENT_METHODS,
    allPaymentKeys: ALL_PAYMENT_KEYS,
    provinces: CR_PROVINCES,
    ...options,
    ...extra,
  };
}

async function resolveCheckoutAddress(req, deliveryKey) {
  const delivery = DELIVERY_METHODS[deliveryKey];
  if (!delivery || !delivery.requiresAddress) {
    return { input: req.body, addressChoice: 'manual', error: null };
  }

  const choice = String(req.body.addressChoice || '');
  if (!req.session.user) {
    if (choice !== 'manual') {
      return {
        input: req.body,
        addressChoice: 'manual',
        error: 'Selecciona una dirección válida.',
      };
    }
    return { input: req.body, addressChoice: 'manual', error: null };
  }

  if (choice === 'manual') {
    return { input: req.body, addressChoice: choice, error: null };
  }

  const match = /^saved:([1-9]\d*)$/.exec(choice);
  const addressId = match ? parsePositiveId(match[1]) : null;
  if (!addressId) {
    return { input: req.body, addressChoice: choice, error: 'Selecciona una dirección válida.' };
  }
  const address = await addressService.getForUser(addressId, req.session.user.id);
  if (!address) {
    return { input: req.body, addressChoice: choice, error: 'Selecciona una dirección válida.' };
  }
  return {
    input: {
      ...req.body,
      province: address.province,
      canton: address.canton,
      distrito: address.district,
      addressLine: address.addressLine,
      addressReference: address.addressReference,
    },
    addressChoice: choice,
    error: null,
  };
}

// ── GET /checkout ──
exports.showCheckout = async (req, res, next) => {
  try {
    const cart = getSessionCart(req);
    const validation = await validateCartForCheckout(cart);

    if (!validation.valid || !validation.hydrated) {
      req.session.error_msg = validation.error || 'Tu carrito no tiene productos disponibles.';
      return res.redirect('/carrito');
    }

    // Generate fresh checkout token
    const token = generateCheckoutToken();
    req.session.checkoutToken = token;

    // Pre-fill from authenticated user
    const user = req.session.user;
    const prefill = {
      customerName: user ? user.name : '',
      email: user ? user.email : '',
    };

    const addressOptions = await checkoutAddressOptions(req);
    const initialChoice = addressOptions.defaultAddressId
      ? `saved:${addressOptions.defaultAddressId}`
      : 'manual';

    res.render('pages/checkout', checkoutViewData(req, validation.hydrated, token, addressOptions, {
      prefill,
      errors: {},
      formData: { addressChoice: initialChoice },
    }));
  } catch (err) { next(err); }
};

// ── POST /checkout ──
exports.submitCheckout = async (req, res, next) => {
  try {
    // Validate checkout token
    const submittedToken = String(req.body.checkoutToken || '');
    const sessionToken = String(req.session.checkoutToken || '');
    if (!submittedToken || submittedToken !== sessionToken) {
      req.session.error_msg = 'Tu sesión de compra expiró. Por favor intenta nuevamente.';
      return res.redirect('/carrito');
    }

    const cart = getSessionCart(req);
    const validation = await validateCartForCheckout(cart);

    if (!validation.valid || !validation.hydrated) {
      req.session.error_msg = validation.error || 'Tu carrito cambió. Revisa los productos antes de continuar.';
      return res.redirect('/carrito');
    }

    // Validate form payload
    const deliveryKey = String(req.body.deliveryMethod || '');
    const resolvedAddress = await resolveCheckoutAddress(req, deliveryKey);
    const payload = validateCheckoutPayload(resolvedAddress.input);
    if (resolvedAddress.error) {
      payload.valid = false;
      payload.errors.addressChoice = resolvedAddress.error;
      ADDRESS_ERROR_FIELDS.forEach((field) => delete payload.errors[field]);
    }

    if (!payload.valid) {
      const addressOptions = await checkoutAddressOptions(req);
      return res.status(422).render('pages/checkout', checkoutViewData(
        req, validation.hydrated, sessionToken, addressOptions, {
        prefill: { customerName: '', email: '' },
        errors: payload.errors,
        formData: {
          customerName: req.body.customerName || '',
          email: req.body.email || '',
          phone: req.body.phone || '',
          deliveryMethod: req.body.deliveryMethod || '',
          paymentMethod: req.body.paymentMethod || '',
          addressChoice: resolvedAddress.addressChoice,
          province: req.body.province || '',
          canton: req.body.canton || '',
          distrito: req.body.distrito || '',
          addressLine: req.body.addressLine || '',
          addressReference: req.body.addressReference || '',
        },
      }));
    }

    // Create order
    const result = await createOrder({
      customerName: payload.data.customerName,
      email: payload.data.email,
      phone: payload.data.phone,
      deliveryMethod: payload.data.deliveryMethod,
      paymentMethod: payload.data.paymentMethod,
      province: payload.data.province || '',
      canton: payload.data.canton || '',
      district: payload.data.distrito || '',
      addressLine: payload.data.addressLine || '',
      addressReference: payload.data.addressReference || '',
      checkoutToken: submittedToken,
      userId: req.session.user ? req.session.user.id : null,
    }, cart);

    // Clear cart and token
    clearCart(cart);
    delete req.session.checkoutToken;

    // Store only a bounded, expiring reference grant for immediate confirmation.
    customerOrders.recordRecentOrderAccess(req.session, result.orderRef);

    req.session.success_msg = '¡Pedido recibido! Revisa los detalles de tu compra.';
    res.redirect('/checkout/confirmacion/' + result.orderRef);
  } catch (err) {
    req.session.error_msg = 'Ocurrió un error al procesar tu pedido. Por favor intenta nuevamente.';
    console.error('[checkout] Order creation failed:', err.message);
    res.redirect('/carrito');
  }
};

// ── GET /checkout/confirmacion/:reference ──
exports.showConfirmation = async (req, res, next) => {
  try {
    const reference = customerOrders.normalizeReference(req.params.reference);
    if (!reference) return renderConfirmationNotFound(res);
    const accessRecord = await customerOrders.getAccessRecord(reference);
    const allowed = customerOrders.canAccessCustomerOrder({
      order: accessRecord, authenticatedUser: req.session.user, session: req.session,
    });
    if (!allowed) return renderConfirmationNotFound(res);
    const order = await customerOrders.getCustomerSafeOrder(reference);
    if (!order) return renderConfirmationNotFound(res);
    return res.render('pages/customer-order-detail', {
      title: 'Pedido recibido',
      robots: 'noindex,nofollow',
      layout: 'layouts/main',
      pageClass: 'page-account-orders',
      pageStyles: ['/css/account-orders.css'],
      order,
      detailContext: 'confirmation',
      isConfirmation: true,
    });
  } catch (err) { next(err); }
};

exports.resolveCheckoutAddress = resolveCheckoutAddress;
exports.checkoutAddressOptions = checkoutAddressOptions;

function renderConfirmationNotFound(res) {
  return res.status(404).render('pages/404', { title: 'Pedido no encontrado', layout: 'layouts/main' });
}
