/**
 * Order Service — transactional order creation, stock deduction, idempotency.
 */
const crypto = require('crypto');
const pool = require('../config/db');
const { getPublicProductsByIds } = require('./catalogService');
const { sanitizeCart, clearCart } = require('./cartService');
const { DELIVERY_METHODS } = require('../config/checkoutOptions');

// ── Order reference generator ──
function generateOrderReference() {
  const prefix = 'NL';
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}-${random}${ts}`;
}

// ── Idempotency key ──
function generateCheckoutToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashCheckoutToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Cart validation for checkout ──
async function validateCartForCheckout(cart) {
  const clean = sanitizeCart(cart);
  if (!clean.items.length) {
    return { valid: false, error: 'Tu carrito está vacío.', hydrated: null, cart: clean };
  }

  const productIds = clean.items.map(i => i.productId);
  const products = await getPublicProductsByIds(productIds);
  const productMap = new Map(products.map(p => [p.id, p]));

  const items = [];
  const errors = [];

  for (const item of clean.items) {
    const product = productMap.get(item.productId);
    if (!product) {
      errors.push(`Un producto en tu carrito ya no está disponible y fue retirado.`);
      continue;
    }
    if (!product.inStock) {
      errors.push(`"${product.title}" está agotado.`);
      continue;
    }
    if (item.quantity > product.stockQuantity) {
      errors.push(`"${product.title}" solo tiene ${product.stockQuantity} unidades disponibles.`);
      continue;
    }
    if (!product.displayPrice || product.displayPrice <= 0) {
      errors.push(`"${product.title}" no tiene un precio válido.`);
      continue;
    }

    items.push({
      productId: product.id,
      title: product.title,
      slug: product.slug,
      quantity: item.quantity,
      unitPrice: product.displayPrice,
      displayPrice: product.displayPrice,
      regularPrice: product.regularPrice,
      hasPromotion: product.hasPromotion,
      priceLabel: product.priceLabel,
      stockQuantity: product.stockQuantity,
      primaryImage: product.primaryImage,
      lineTotal: product.displayPrice * item.quantity,
    });
  }

  // Remove invalid items from cart
  for (const item of clean.items) {
    if (!productMap.has(item.productId)) {
      const idx = clean.items.findIndex(i => i.productId === item.productId);
      if (idx !== -1) clean.items.splice(idx, 1);
    }
  }

  if (errors.length > 0 || items.length === 0) {
    return { valid: false, error: errors.join(' ') || 'No hay productos disponibles para comprar.', hydrated: null, cart: clean };
  }

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);

  return {
    valid: true,
    error: null,
    hydrated: { items, itemCount: items.reduce((s, i) => s + i.quantity, 0), subtotal },
    cart: clean,
  };
}

// ── Create order (transactional) ──
async function createOrder(checkoutData, cart) {
  const {
    customerName, email, phone,
    deliveryMethod, paymentMethod,
    province, canton, district, addressLine, addressReference,
    checkoutToken,
    userId,
  } = checkoutData;

  const dlvConfig = DELIVERY_METHODS[deliveryMethod];
  if (!dlvConfig) throw new Error('Método de entrega no válido.');

  // Re-validate cart
  const validation = await validateCartForCheckout(cart);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const { items, subtotal } = validation.hydrated;
  const idempotencyKey = hashCheckoutToken(checkoutToken);
  const orderRef = generateOrderReference();

  // Check duplicate idempotency key
  const [existing] = await pool.query(
    'SELECT id, order_reference FROM orders WHERE idempotency_key = ? LIMIT 1',
    [idempotencyKey]
  );
  if (existing.length > 0) {
    return { duplicate: true, orderRef: existing[0].order_reference, orderId: existing[0].id };
  }

  // Shipping amount and final total
  const shippingAmount = dlvConfig.shippingAmount; // 0 for pickup, null for others
  const finalTotal = dlvConfig.shippingStatus === 'not_required' ? subtotal : null;

  // Transaction
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Lock and validate stock for each product
    for (const item of items) {
      const [stockRows] = await conn.query(
        'SELECT stock_quantity, is_active, is_published, name FROM products WHERE id = ? FOR UPDATE',
        [item.productId]
      );
      const product = stockRows[0];
      if (!product || !product.is_active || !product.is_published) {
        throw new Error(`"${item.title}" ya no está disponible.`);
      }
      if (product.stock_quantity < item.quantity) {
        throw new Error(`"${item.title}" solo tiene ${product.stock_quantity} unidades.`);
      }
    }

    // 2. Insert order
    const [orderResult] = await conn.query(
      `INSERT INTO orders (
        order_reference, user_id, customer_name, customer_email, customer_phone,
        delivery_method, shipping_status, shipping_amount,
        payment_method, payment_status,
        province, canton, district, address_line, address_reference,
        product_subtotal, final_total, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderRef, userId, customerName, email, phone,
        deliveryMethod, dlvConfig.shippingStatus, shippingAmount,
        paymentMethod, 'pending',
        province || null, canton || null, district || null, addressLine || null, addressReference || null,
        subtotal, finalTotal, idempotencyKey
      ]
    );
    const orderId = orderResult.insertId;

    // 3. Insert order items
    for (const item of items) {
      await conn.query(
        `INSERT INTO order_items (
          order_id, product_id, product_name, product_slug,
          quantity, unit_price, line_total, primary_image
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId, item.productId, item.title, item.slug,
          item.quantity, item.unitPrice, item.lineTotal,
          item.primaryImage || null
        ]
      );
    }

    // 4. Decrement stock
    for (const item of items) {
      const [result] = await conn.query(
        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
        [item.quantity, item.productId, item.quantity]
      );
      if (result.affectedRows !== 1) {
        throw new Error(`Error al actualizar el inventario de "${item.title}".`);
      }
    }

    await conn.commit();

    return {
      success: true,
      duplicate: false,
      orderRef,
      orderId,
      subtotal,
      shippingAmount,
      finalTotal,
      shippingStatus: dlvConfig.shippingStatus,
      deliveryMethod,
      paymentMethod,
      customerName,
      email,
      phone,
      items,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  generateOrderReference,
  generateCheckoutToken,
  hashCheckoutToken,
  validateCartForCheckout,
  createOrder,
};
