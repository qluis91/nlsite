/**
 * Cart Controller — add, update, remove, clear, show.
 * Price and stock are always resolved server-side.
 */

const cartService = require('../services/cartService');
const { getPublicProductsByIds } = require('../services/catalogService');
const { safeReturnPath } = require('./storeController');

// ── Local safe return (allow /carrito too) ──
function safeCartReturn(raw) {
  if (!raw) return '/carrito';
  const decoded = decodeURIComponent(String(raw));
  if (/^\/(tienda|carrito)(\/[a-z0-9-]+)?(\?[a-z0-9_=&%-]*)?$/i.test(decoded)) {
    return decoded;
  }
  return '/carrito';
}

// ── Add to cart ──
exports.addItem = async (req, res, next) => {
  try {
    const productId = parseInt(req.body.productId, 10);
    const quantity = parseInt(req.body.quantity, 10) || 1;

    if (!productId || productId <= 0) {
      req.session.error_msg = 'Producto no válido.';
      return res.redirect(safeCartReturn(req.body.returnTo));
    }

    // Validate product exists and is published
    const [product] = await getPublicProductsByIds([productId]);
    if (!product) {
      req.session.error_msg = 'Este producto no está disponible.';
      return res.redirect(safeCartReturn(req.body.returnTo));
    }

    if (!product.inStock) {
      req.session.error_msg = 'Este producto está agotado.';
      return res.redirect(safeCartReturn(req.body.returnTo));
    }

    const cart = cartService.getSessionCart(req);
    const existing = cart.items.find(i => i.productId === productId);
    const newTotal = (existing ? existing.quantity : 0) + Math.max(1, quantity);

    if (newTotal > product.stockQuantity) {
      req.session.error_msg = `Solo hay ${product.stockQuantity} unidades disponibles.`;
      return res.redirect(safeCartReturn(req.body.returnTo));
    }

    cartService.addItem(cart, productId, quantity);

    // Signal the product page to show the add-to-cart success panel.
    req.session.addToCartSuccess = {
      productName: product.title,
      productId: productId,
    };

    req.session.success_msg = 'Producto agregado al carrito.';
    res.redirect(safeCartReturn(req.body.returnTo));
  } catch (err) { next(err); }
};

// ── Update cart item ──
exports.updateItem = async (req, res, next) => {
  try {
    const productId = parseInt(req.body.productId, 10);
    const quantity = parseInt(req.body.quantity, 10);

    if (!productId || productId <= 0) {
      req.session.error_msg = 'Producto no válido.';
      return res.redirect('/carrito');
    }

    // Validate product
    const [product] = await getPublicProductsByIds([productId]);
    if (!product) {
      const cart = cartService.getSessionCart(req);
      cartService.removeItem(cart, productId);
      req.session.error_msg = 'Este producto ya no está disponible.';
      return res.redirect('/carrito');
    }

    if (isNaN(quantity) || quantity < 1) {
      // Remove if quantity <= 0
      const cart = cartService.getSessionCart(req);
      cartService.removeItem(cart, productId);
      req.session.success_msg = 'Producto eliminado del carrito.';
      return res.redirect('/carrito');
    }

    if (!product.inStock) {
      req.session.error_msg = 'Este producto está agotado.';
      return res.redirect('/carrito');
    }

    if (quantity > product.stockQuantity) {
      req.session.error_msg = `La cantidad solicitada supera la disponibilidad (${product.stockQuantity}).`;
      return res.redirect('/carrito');
    }

    const cart = cartService.getSessionCart(req);
    cartService.updateItem(cart, productId, quantity);
    req.session.success_msg = 'Cantidad actualizada.';
    res.redirect('/carrito');
  } catch (err) { next(err); }
};

// ── Remove cart item ──
exports.removeItem = async (req, res, next) => {
  try {
    const productId = parseInt(req.body.productId, 10);
    if (!productId || productId <= 0) {
      req.session.error_msg = 'Producto no válido.';
      return res.redirect('/carrito');
    }

    const cart = cartService.getSessionCart(req);
    cartService.removeItem(cart, productId);
    req.session.success_msg = 'Producto eliminado del carrito.';
    res.redirect('/carrito');
  } catch (err) { next(err); }
};

// ── Clear cart ──
exports.clearCart = (req, res, next) => {
  try {
    const cart = cartService.getSessionCart(req);
    cartService.clearCart(cart);
    req.session.success_msg = 'Carrito vaciado correctamente.';
    res.redirect('/carrito');
  } catch (err) { next(err); }
};

// ── Show cart ──
exports.showCart = async (req, res, next) => {
  try {
    const cart = cartService.getSessionCart(req);
    const hydrated = await cartService.hydrateCart(cart);
    const { getPublicCategories } = require('../services/catalogService');
    const categories = await getPublicCategories();

    res.render('pages/carrito', {
      title: 'Carrito',
      metaDescription: `Tu carrito de NinjaLab — ${hydrated.itemCount} artículos`,
      robots: 'noindex,nofollow',
      layout: 'layouts/store',
      pageClass: 'page-store',
      pageStyles: ['/css/store.css'],
      pageModule: '/js/cart/cart.js',
      cart: hydrated,
      categories,
      activeCategory: null,
      removedCount: hydrated.removedItems.length,
    });
  } catch (err) { next(err); }
};
