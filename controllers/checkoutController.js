/**
 * Checkout Controller — GET/POST checkout, confirmation page.
 */
const { validateCheckoutPayload } = require('../validators/checkoutValidator');
const { validateCartForCheckout, generateCheckoutToken, createOrder } = require('../services/orderService');
const { getSessionCart, clearCart, sanitizeCart } = require('../services/cartService');
const { DELIVERY_METHODS, PAYMENT_METHODS, ALL_PAYMENT_KEYS, CR_PROVINCES } = require('../config/checkoutOptions');
const pool = require('../config/db');

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

    res.render('pages/checkout', {
      title: 'Finalizar pedido',
      robots: 'noindex,nofollow',
      layout: 'layouts/main',
      pageClass: 'page-checkout',
      pageStyles: ['/css/home.css', '/css/store.css', '/css/cart.css', '/css/checkout.css'],
      pageModule: '/js/checkout/checkout.js',
      usesHeroNavbar: true,
      navbarSearchContext: 'store',
      checkout: validation.hydrated,
      token,
      prefill,
      deliveryMethods: DELIVERY_METHODS,
      paymentMethods: PAYMENT_METHODS,
      allPaymentKeys: ALL_PAYMENT_KEYS,
      provinces: CR_PROVINCES,
      errors: {},
      formData: {},
    });
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
    const dlvConfig = DELIVERY_METHODS[deliveryKey];
    const payload = validateCheckoutPayload(req.body, dlvConfig);

    if (!payload.valid) {
      // Re-render with errors
      return res.render('pages/checkout', {
        title: 'Finalizar pedido',
        robots: 'noindex,nofollow',
        layout: 'layouts/main',
        pageClass: 'page-checkout',
        pageStyles: ['/css/home.css', '/css/store.css', '/css/cart.css', '/css/checkout.css'],
        pageModule: '/js/checkout/checkout.js',
        usesHeroNavbar: true,
        navbarSearchContext: 'store',
        checkout: validation.hydrated,
        token: sessionToken,
        prefill: { customerName: '', email: '' },
        deliveryMethods: DELIVERY_METHODS,
        paymentMethods: PAYMENT_METHODS,
        allPaymentKeys: ALL_PAYMENT_KEYS,
        provinces: CR_PROVINCES,
        errors: payload.errors,
        formData: {
          customerName: req.body.customerName || '',
          email: req.body.email || '',
          phone: req.body.phone || '',
          deliveryMethod: req.body.deliveryMethod || '',
          paymentMethod: req.body.paymentMethod || '',
          province: req.body.province || '',
          canton: req.body.canton || '',
          distrito: req.body.distrito || '',
          addressLine: req.body.addressLine || '',
          addressReference: req.body.addressReference || '',
        },
      });
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

    // Store recent order reference for guest access
    if (!req.session.recentOrders) req.session.recentOrders = [];
    req.session.recentOrders.push({
      reference: result.orderRef,
      id: result.orderId,
      expiresAt: Date.now() + 3600000, // 1 hour
    });
    // Keep only last 5
    if (req.session.recentOrders.length > 5) {
      req.session.recentOrders = req.session.recentOrders.slice(-5);
    }

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
    const ref = String(req.params.reference || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 24);
    if (!ref) return res.redirect('/tienda');

    const [rows] = await pool.query(
      `SELECT o.* FROM orders o WHERE o.order_reference = ? LIMIT 1`,
      [ref]
    );
    if (!rows[0]) {
      return res.status(404).render('pages/404', {
        title: 'Pedido no encontrado',
        layout: 'layouts/main',
      });
    }

    const order = rows[0];

    // Authorization: owner OR session recent order
    const userId = req.session.user ? req.session.user.id : null;
    const recentRefs = (req.session.recentOrders || []).map(r => r.reference);
    if (order.user_id && order.user_id !== userId && !recentRefs.includes(ref)) {
      return res.status(404).render('pages/404', {
        title: 'Pedido no encontrado',
        layout: 'layouts/main',
      });
    }
    if (!order.user_id && !recentRefs.includes(ref)) {
      return res.status(404).render('pages/404', {
        title: 'Pedido no encontrado',
        layout: 'layouts/main',
      });
    }

    // Get order items
    const [items] = await pool.query(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
      [order.id]
    );

    // Determine display values
    const dlvLabel = DELIVERY_METHODS[order.delivery_method]
      ? DELIVERY_METHODS[order.delivery_method].label : order.delivery_method;
    const pmtLabel = PAYMENT_METHODS[order.payment_method]
      ? PAYMENT_METHODS[order.payment_method].label : order.payment_method;

    const isPendingShipping = order.shipping_status === 'pending_quote';
    const isPickup = order.delivery_method === 'local_pickup';

    res.render('pages/checkout-confirmation', {
      title: 'Pedido recibido',
      robots: 'noindex,nofollow',
      layout: 'layouts/main',
      pageClass: 'page-checkout',
      pageStyles: ['/css/home.css', '/css/store.css', '/css/cart.css', '/css/checkout.css'],
      usesHeroNavbar: true,
      navbarSearchContext: 'store',
      order,
      items,
      dlvLabel,
      pmtLabel,
      isPendingShipping,
      isPickup,
    });
  } catch (err) { next(err); }
};
