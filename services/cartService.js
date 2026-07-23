/**
 * Cart Service — session cart operations with server-authoritative hydration.
 *
 * Session shape: { items: [{ productId: N, quantity: N, addedAt: 'ISO' }] }
 * All product info, prices, and stock resolved from DB on every render/mutation.
 */

const { getPublicProductsByIds, resolveDisplayPrice } = require('./catalogService');

// ── Limits ──
const MAX_DISTINCT_ITEMS = 50;
const MAX_QUANTITY_PER_ITEM = 99;

// ── Session cart accessors ──

function getSessionCart(req) {
  if (!req.session.cart) {
    req.session.cart = { items: [] };
  }
  // Ensure shape
  if (!Array.isArray(req.session.cart.items)) {
    req.session.cart.items = [];
  }
  return req.session.cart;
}

function saveSessionCart(req) {
  req.session.cart.updatedAt = new Date().toISOString();
  // Session auto-saves on response, but we touch it
}

function getCartItemCount(cart) {
  if (!cart || !Array.isArray(cart.items)) return 0;
  return cart.items.reduce((sum, item) => sum + (parseInt(item.quantity, 10) || 0), 0);
}

// ── Sanitization ──

function sanitizeItem(item) {
  const productId = parseInt(item.productId, 10);
  const quantity = parseInt(item.quantity, 10);
  if (!productId || productId <= 0) return null;
  if (!quantity || quantity <= 0) return null;
  return { productId, quantity };
}

function sanitizeCart(cart) {
  if (!cart || !Array.isArray(cart.items)) return { items: [] };
  const seen = new Set();
  const clean = [];
  for (const item of cart.items) {
    const s = sanitizeItem(item);
    if (!s) continue;
    if (seen.has(s.productId)) continue;
    seen.add(s.productId);
    clean.push({ productId: s.productId, quantity: Math.min(s.quantity, MAX_QUANTITY_PER_ITEM), addedAt: item.addedAt || new Date().toISOString() });
  }
  return { items: clean.slice(0, MAX_DISTINCT_ITEMS) };
}

// ── Mutations ──

function addItem(cart, productId, quantity) {
  const qty = Math.max(1, Math.min(parseInt(quantity, 10) || 1, MAX_QUANTITY_PER_ITEM));
  if (!cart || !Array.isArray(cart.items)) cart = { items: [] };
  const existing = cart.items.find(i => i.productId === productId);
  if (existing) {
    existing.quantity = Math.min(existing.quantity + qty, MAX_QUANTITY_PER_ITEM);
  } else {
    cart.items.push({ productId, quantity: qty, addedAt: new Date().toISOString() });
  }
  // Cap distinct items
  if (cart.items.length > MAX_DISTINCT_ITEMS) {
    cart.items = cart.items.slice(0, MAX_DISTINCT_ITEMS);
  }
}

function updateItem(cart, productId, quantity) {
  const qty = Math.max(0, Math.min(parseInt(quantity, 10) || 0, MAX_QUANTITY_PER_ITEM));
  if (!cart || !Array.isArray(cart.items)) return null;
  const idx = cart.items.findIndex(i => i.productId === productId);
  if (idx === -1) return null;
  if (qty === 0) {
    cart.items.splice(idx, 1);
  } else {
    cart.items[idx].quantity = qty;
  }
  return cart.items[idx] || null;
}

function removeItem(cart, productId) {
  if (!cart || !Array.isArray(cart.items)) return;
  const idx = cart.items.findIndex(i => i.productId === productId);
  if (idx !== -1) cart.items.splice(idx, 1);
}

function clearCart(cart) {
  if (cart) cart.items = [];
}

// ── Hydration ──

async function hydrateCart(cart) {
  const clean = sanitizeCart(cart);
  if (!clean.items.length) {
    return {
      items: [],
      unavailableItems: [],
      removedItems: [],
      itemCount: 0,
      uniqueItemCount: 0,
      subtotal: 0,
    };
  }

  const productIds = clean.items.map(i => i.productId);
  const products = await getPublicProductsByIds(productIds);
  const productMap = new Map(products.map(p => [p.id, p]));

  const hydrated = [];
  const unavailable = [];
  const removed = [];

  for (const item of clean.items) {
    const product = productMap.get(item.productId);
    if (!product) {
      // Product is hidden/archived/deleted — remove from session
      removed.push(item.productId);
      continue;
    }

    // Only keep: item quantity clamped to stock, not stock itself
    const effectiveQty = Math.min(item.quantity, Math.max(product.stockQuantity, 0) || 0);
    const available = product.inStock && effectiveQty > 0;

    hydrated.push({
      productId: product.id,
      slug: product.slug,
      title: product.title,
      quantity: item.quantity,
      effectiveQuantity: effectiveQty,
      stockQuantity: product.stockQuantity,
      available,
      primaryImage: product.primaryImage,
      imageWidth: product.imageWidth,
      imageHeight: product.imageHeight,
      displayPrice: product.displayPrice,
      regularPrice: product.regularPrice,
      hasPromotion: product.hasPromotion,
      priceLabel: product.priceLabel,
      unitPrice: product.displayPrice,
      lineTotal: product.displayPrice * effectiveQty,
      url: product.url,
    });
  }

  // Remove unavailable products from session
  if (removed.length) {
    for (const id of removed) {
      removeItem(cart, id);
    }
  }

  const subtotal = hydrated
    .filter(h => h.available)
    .reduce((sum, h) => sum + h.lineTotal, 0);

  const itemCount = hydrated.reduce((sum, h) => sum + h.quantity, 0);

  return {
    items: hydrated,
    unavailableItems: unavailable,
    removedItems: removed,
    itemCount,
    uniqueItemCount: hydrated.length,
    subtotal,
  };
}

// ── Preserve cart across session regeneration ──

function captureCartForRegeneration(req) {
  const cart = getSessionCart(req);
  return sanitizeCart(cart);
}

function restoreCartAfterRegeneration(req, preserved) {
  if (!preserved || !preserved.items.length) return;
  req.session.cart = sanitizeCart(preserved);
}

module.exports = {
  MAX_DISTINCT_ITEMS,
  MAX_QUANTITY_PER_ITEM,
  getSessionCart,
  saveSessionCart,
  getCartItemCount,
  sanitizeCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  hydrateCart,
  captureCartForRegeneration,
  restoreCartAfterRegeneration,
};
