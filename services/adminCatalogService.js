/**
 * Admin catalog service — CRUD operations for categories and products.
 */
const pool = require('../config/db');
const { slugify } = require('../validators/catalogValidator');

// ══════════════════════════════════════
//  CATEGORIES
// ══════════════════════════════════════

async function listCategories() {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.slug, c.created_at,
            COUNT(pc.product_id) AS product_count
     FROM categories c
     LEFT JOIN product_categories pc ON c.id = pc.category_id
     GROUP BY c.id
     ORDER BY c.name ASC`
  );
  return rows;
}

async function getCategoryById(id) {
  const [rows] = await pool.query('SELECT id, name, slug FROM categories WHERE id = ?', [id]);
  return rows[0] || null;
}

async function createCategory(name, slug) {
  const s = slug || slugify(name);
  const [result] = await pool.query('INSERT INTO categories (name, slug) VALUES (?, ?)', [name, s]);
  return { id: result.insertId, name, slug: s };
}

async function updateCategory(id, name, slug) {
  const s = slug || slugify(name);
  await pool.query('UPDATE categories SET name = ?, slug = ? WHERE id = ?', [name, s, id]);
  return { id, name, slug: s };
}

async function deleteCategory(id) {
  // Check for associated products
  const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM product_categories WHERE category_id = ?', [id]);
  if (rows[0].cnt > 0) {
    throw new Error('No se puede eliminar esta categoría porque tiene productos asociados.');
  }
  await pool.query('DELETE FROM categories WHERE id = ?', [id]);
}

async function isCategorySlugTaken(slug, excludeId = null) {
  const query = excludeId
    ? 'SELECT id FROM categories WHERE slug = ? AND id != ?'
    : 'SELECT id FROM categories WHERE slug = ?';
  const params = excludeId ? [slug, excludeId] : [slug];
  const [rows] = await pool.query(query, params);
  return rows.length > 0;
}

// ══════════════════════════════════════
//  PRODUCTS
// ══════════════════════════════════════

async function listProducts(search = '', categoryId = '', page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  let where = '1=1';
  const params = [];

  if (search) {
    where += ' AND p.name LIKE ?';
    params.push(`%${search}%`);
  }
  if (categoryId) {
    where += ' AND pc2.category_id = ?';
    params.push(parseInt(categoryId, 10));
  }

  const sql = `
    SELECT p.id, p.name, p.slug, p.regular_price, p.promotional_price,
           p.web_price, p.weight, p.stock_quantity, p.is_active, p.is_published,
           p.created_at,
           pi.file_path AS primary_image
    FROM products p
    LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
    ${categoryId ? 'JOIN product_categories pc2 ON pc2.product_id = p.id' : ''}
    WHERE ${where}
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const [products] = await pool.query(sql, params);

  // Count total
  const countSql = `
    SELECT COUNT(DISTINCT p.id) AS total
    FROM products p
    ${categoryId ? 'JOIN product_categories pc2 ON pc2.product_id = p.id' : ''}
    WHERE ${where}
  `;
  const countParams = categoryId ? [parseInt(categoryId, 10)] : search ? [`%${search}%`] : [];
  const [countResult] = await pool.query(countSql, countParams);
  const total = countResult[0].total;

  // Get categories for each product
  const productIds = products.map(p => p.id);
  let catMap = new Map();
  if (productIds.length) {
    const [cats] = await pool.query(
      `SELECT pc.product_id, c.name
       FROM product_categories pc
       JOIN categories c ON c.id = pc.category_id
       WHERE pc.product_id IN (?)`,
      [productIds]
    );
    for (const cat of cats) {
      if (!catMap.has(cat.product_id)) catMap.set(cat.product_id, []);
      catMap.get(cat.product_id).push(cat.name);
    }
  }

  return {
    products: products.map(p => ({
      ...p,
      categoryNames: catMap.get(p.id) || [],
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

async function getProductById(id) {
  const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
  if (!rows[0]) return null;
  const product = rows[0];

  // Parse tags
  if (product.tags) {
    try { product.tags = JSON.parse(product.tags); } catch { product.tags = []; }
  } else {
    product.tags = [];
  }

  // Get categories
  const [cats] = await pool.query(
    `SELECT c.id, c.name FROM product_categories pc
     JOIN categories c ON c.id = pc.category_id
     WHERE pc.product_id = ?`,
    [id]
  );
  product.categoryIds = cats.map(c => c.id);
  product.categories = cats;

  // Get images
  const [images] = await pool.query(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, position ASC',
    [id]
  );
  product.images = images;
  product.primaryImage = images.find(img => img.is_primary) || null;
  product.secondaryImages = images.filter(img => !img.is_primary);

  return product;
}

async function createProduct(data) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Insert product
    const [result] = await conn.query(
      `INSERT INTO products (name, slug, regular_price, promotional_price, web_price,
        weight, stock_quantity, description, tags, is_active, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name, data.slug, data.regularPrice, data.promotionalPrice, data.webPrice,
        data.weight, data.stockQuantity, data.description, data.tags, data.isActive ? 1 : 0, data.isPublished ? 1 : 0,
      ]
    );
    const productId = result.insertId;

    // Insert categories
    if (data.categoryIds && data.categoryIds.length) {
      const values = data.categoryIds.map(cid => [productId, cid]);
      await conn.query('INSERT INTO product_categories (product_id, category_id) VALUES ?', [values]);
    }

    await conn.commit();
    return productId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function updateProduct(id, data) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE products SET name = ?, slug = ?, regular_price = ?, promotional_price = ?,
        web_price = ?, weight = ?, stock_quantity = ?, description = ?, tags = ?,
        is_active = ?, is_published = ?
       WHERE id = ?`,
      [
        data.name, data.slug, data.regularPrice, data.promotionalPrice, data.webPrice,
        data.weight, data.stockQuantity, data.description, data.tags,
        data.isActive ? 1 : 0, data.isPublished ? 1 : 0, id,
      ]
    );

    // Replace category associations
    if (data.categoryIds !== undefined) {
      await conn.query('DELETE FROM product_categories WHERE product_id = ?', [id]);
      if (data.categoryIds.length) {
        const values = data.categoryIds.map(cid => [id, cid]);
        await conn.query('INSERT INTO product_categories (product_id, category_id) VALUES ?', [values]);
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteProduct(id) {
  // Try physical delete first
  try {
    await pool.query('DELETE FROM products WHERE id = ?', [id]);
    return { action: 'deleted' };
  } catch (err) {
    // If FK violation from future order/quote tables, archive instead
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1217) {
      await pool.query(
        'UPDATE products SET is_active = 0, is_published = 0 WHERE id = ?',
        [id]
      );
      return { action: 'archived', reason: 'historical-references' };
    }
    throw err;
  }
}

// ══════════════════════════════════════
//  PRODUCT IMAGES
// ══════════════════════════════════════

async function addProductImage(productId, imageData) {
  // Get current max position
  const [rows] = await pool.query(
    'SELECT COALESCE(MAX(position), -1) AS maxPos FROM product_images WHERE product_id = ?',
    [productId]
  );
  const pos = rows[0].maxPos + 1;

  const [result] = await pool.query(
    `INSERT INTO product_images (product_id, file_path, file_name, mime_type, width, height, size_bytes, is_primary, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productId, imageData.filePath, imageData.fileName, imageData.mimeType,
      imageData.width || null, imageData.height || null, imageData.sizeBytes || null,
      imageData.isPrimary ? 1 : 0, imageData.position !== undefined ? imageData.position : pos,
    ]
  );
  return result.insertId;
}

async function removeProductImage(imageId, productId) {
  const [rows] = await pool.query(
    'SELECT file_path FROM product_images WHERE id = ? AND product_id = ?',
    [imageId, productId]
  );
  if (!rows[0]) return null;
  await pool.query('DELETE FROM product_images WHERE id = ? AND product_id = ?', [imageId, productId]);
  return rows[0].file_path;
}

async function setPrimaryImage(imageId, productId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE product_images SET is_primary = 0 WHERE product_id = ?', [productId]);
    await conn.query('UPDATE product_images SET is_primary = 1 WHERE id = ? AND product_id = ?', [imageId, productId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function countProductImages(productId) {
  const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM product_images WHERE product_id = ?', [productId]);
  return rows[0].cnt;
}

async function getProductImages(productId) {
  const [rows] = await pool.query(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, position ASC',
    [productId]
  );
  return rows;
}

async function reorderImages(productId, orderedIds) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < orderedIds.length; i++) {
      await conn.query(
        'UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?',
        [i, orderedIds[i], productId]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Auto-promote first image as primary when no primary exists.
 */
async function ensurePrimaryImage(productId) {
  const [rows] = await pool.query(
    'SELECT id FROM product_images WHERE product_id = ? ORDER BY position ASC LIMIT 1',
    [productId]
  );
  if (rows[0]) {
    await pool.query(
      'UPDATE product_images SET is_primary = 1 WHERE id = ?',
      [rows[0].id]
    );
  }
}

module.exports = {
  // Categories
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  isCategorySlugTaken,
  // Products
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  // Images
  addProductImage,
  removeProductImage,
  setPrimaryImage,
  countProductImages,
  getProductImages,
  reorderImages,
  ensurePrimaryImage,
};
