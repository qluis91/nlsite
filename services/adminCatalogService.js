/**
 * Admin catalog service — CRUD operations for categories and products.
 */
const pool = require('../config/db');
const { slugify } = require('../validators/catalogValidator');
const { normalizeCatalogTags } = require('./catalogTags');

const ADMIN_PRODUCT_PAGE_SIZE = 20;
const MAX_ADMIN_PRODUCT_PAGE_SIZE = 100;
const MAX_ADMIN_PRODUCT_PAGE = 1000000;
const MAX_ADMIN_PRODUCT_SEARCH_LENGTH = 100;
const PRODUCT_IMAGE_PATH = /^\/uploads\/products\/[1-9]\d*\/[a-z0-9][a-z0-9_.-]*$/i;

function normalizePositiveInteger(value, fallback, maximum) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function normalizeAdminProductQuery(search = '', categoryId = '', page = 1, limit = ADMIN_PRODUCT_PAGE_SIZE) {
  const normalizedCategory = normalizePositiveInteger(categoryId, null, Number.MAX_SAFE_INTEGER);
  return {
    search: String(search ?? '').replace(/\0/g, '').trim().slice(0, MAX_ADMIN_PRODUCT_SEARCH_LENGTH),
    categoryId: normalizedCategory,
    page: normalizePositiveInteger(page, 1, MAX_ADMIN_PRODUCT_PAGE),
    limit: normalizePositiveInteger(limit, ADMIN_PRODUCT_PAGE_SIZE, MAX_ADMIN_PRODUCT_PAGE_SIZE),
  };
}

async function catalogQuery(db, stage, sql, params = []) {
  try {
    return await db.query(sql, params);
  } catch (error) {
    error.catalogStage = stage;
    throw error;
  }
}

function normalizeLegacyBoolean(value, fallback, warnings, productId, field) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  warnings.push({ productId, field, issue: 'invalid_boolean' });
  return fallback;
}

function normalizeListedProduct(product, categoryNames, warnings) {
  const id = Number(product.id);
  const stock = Number(product.stock_quantity);
  const primaryImage = typeof product.primary_image === 'string'
    && PRODUCT_IMAGE_PATH.test(product.primary_image)
    ? product.primary_image
    : null;

  if (product.primary_image && !primaryImage) {
    warnings.push({ productId: id, field: 'primary_image', issue: 'invalid_media_path' });
  }
  if (product.stock_quantity === null || !Number.isSafeInteger(stock) || stock < 0) {
    warnings.push({ productId: id, field: 'stock_quantity', issue: 'invalid_number' });
  }

  return {
    ...product,
    stock_quantity: product.stock_quantity !== null && Number.isSafeInteger(stock) && stock >= 0
      ? stock
      : 0,
    is_active: normalizeLegacyBoolean(product.is_active, 0, warnings, id, 'is_active'),
    is_published: normalizeLegacyBoolean(product.is_published, 0, warnings, id, 'is_published'),
    primary_image: primaryImage,
    categoryNames: Array.isArray(categoryNames) ? categoryNames : [],
  };
}

// ══════════════════════════════════════
//  CATEGORIES
// ══════════════════════════════════════

async function listCategories(db = pool) {
  const [rows] = await catalogQuery(
    db,
    'categories.list',
    `SELECT c.id, c.name, c.slug, c.created_at,
            (SELECT COUNT(*)
               FROM product_categories pc
              WHERE pc.category_id = c.id) AS product_count
     FROM categories c
     ORDER BY c.name ASC`
  );
  return rows;
}

async function getCategoryById(id) {
  const [rows] = await pool.query(
    `SELECT id, name, slug, description, hero_title, hero_description,
            hero_image, hero_alt, hero_position
     FROM categories WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function createCategory(name, slug, hero = {}) {
  const s = slug || slugify(name);
  const [result] = await pool.query(
    `INSERT INTO categories
      (name, slug, description, hero_title, hero_description, hero_image, hero_alt, hero_position,
       seo_title, seo_description, og_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      s,
      hero.description || null,
      hero.hero_title || null,
      hero.hero_description || null,
      hero.hero_image || null,
      hero.hero_alt || null,
      hero.hero_position || 'center',
      hero.seo_title || null,
      hero.seo_description || null,
      hero.og_image || null,
    ]
  );
  return { id: result.insertId, name, slug: s };
}

async function updateCategory(id, name, slug, hero = {}) {
  const s = slug || slugify(name);
  await pool.query(
    `UPDATE categories SET
      name = ?,
      slug = ?,
      description = ?,
      hero_title = ?,
      hero_description = ?,
      hero_image = ?,
      hero_alt = ?,
      hero_position = ?,
      seo_title = ?,
      seo_description = ?,
      og_image = ?
     WHERE id = ?`,
    [
      name,
      s,
      hero.description || null,
      hero.hero_title || null,
      hero.hero_description || null,
      hero.hero_image || null,
      hero.hero_alt || null,
      hero.hero_position || 'center',
      hero.seo_title || null,
      hero.seo_description || null,
      hero.og_image || null,
      id,
    ]
  );
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

async function listProducts(
  search = '',
  categoryId = '',
  page = 1,
  limit = ADMIN_PRODUCT_PAGE_SIZE,
  db = pool
) {
  const filters = normalizeAdminProductQuery(search, categoryId, page, limit);
  const whereParts = [];
  const filterParams = [];

  if (filters.search) {
    whereParts.push('p.name LIKE ?');
    filterParams.push(`%${filters.search}%`);
  }
  if (filters.categoryId) {
    whereParts.push(
      'EXISTS (SELECT 1 FROM product_categories pc_filter'
      + ' WHERE pc_filter.product_id = p.id AND pc_filter.category_id = ?)'
    );
    filterParams.push(filters.categoryId);
  }
  const where = whereParts.length ? whereParts.join(' AND ') : '1=1';

  const countSql = `
    SELECT COUNT(*) AS total
    FROM products p
    WHERE ${where}
  `;
  const [countResult] = await catalogQuery(
    db,
    'products.count',
    countSql,
    [...filterParams]
  );
  const total = Number(countResult[0]?.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const effectivePage = Math.min(filters.page, totalPages);
  const offset = (effectivePage - 1) * filters.limit;

  const sql = `
    SELECT p.id, p.name, p.slug, p.regular_price, p.promotional_price,
           p.web_price, p.weight, p.stock_quantity, p.is_active, p.is_published,
           p.created_at,
           pi.file_path AS primary_image
    FROM products p
    LEFT JOIN product_images pi
      ON pi.id = (
        SELECT MIN(pi_primary.id)
        FROM product_images pi_primary
        WHERE pi_primary.product_id = p.id
          AND pi_primary.is_primary = 1
      )
    WHERE ${where}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `;
  const [products] = await catalogQuery(
    db,
    'products.list',
    sql,
    [...filterParams, filters.limit, offset]
  );

  // Get categories for each product
  const productIds = products.map(p => p.id);
  const catMap = new Map();
  if (productIds.length) {
    const [cats] = await catalogQuery(
      db,
      'products.categories',
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

  const warnings = [];
  return {
    products: products.map((product) =>
      normalizeListedProduct(product, catMap.get(product.id), warnings)
    ),
    total,
    page: effectivePage,
    totalPages,
    filters,
    warnings,
  };
}

async function getProductById(id) {
  const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
  if (!rows[0]) return null;
  const product = rows[0];

  product.tags = normalizeCatalogTags(product.tags);

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
  product.images = images.map((image) => ({
    ...image,
    display_path: typeof image.file_path === 'string' && PRODUCT_IMAGE_PATH.test(image.file_path)
      ? image.file_path
      : null,
  }));
  product.primaryImage = product.images.find(img => img.is_primary) || null;
  product.secondaryImages = product.images.filter(img => !img.is_primary);

  return product;
}

async function createProduct(data) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Insert product
    const [result] = await conn.query(
      `INSERT INTO products (name, slug, regular_price, promotional_price, web_price,
        weight, stock_quantity, description, seo_title, seo_description, og_image, tags, is_active, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name, data.slug, data.regularPrice, data.promotionalPrice, data.webPrice,
        data.weight, data.stockQuantity, data.description, data.seoTitle || '', data.seoDescription || '', data.ogImage || '',
        data.tags, data.isActive ? 1 : 0, data.isPublished ? 1 : 0,
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
        web_price = ?, weight = ?, stock_quantity = ?, description = ?,
        seo_title = ?, seo_description = ?, og_image = ?, tags = ?,
        is_active = ?, is_published = ?
       WHERE id = ?`,
      [
        data.name, data.slug, data.regularPrice, data.promotionalPrice, data.webPrice,
        data.weight, data.stockQuantity, data.description,
        data.seoTitle || '', data.seoDescription || '', data.ogImage || '',
        data.tags,
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

async function deleteProduct(id, db = pool) {
  // Try physical delete first
  try {
    await db.query('DELETE FROM products WHERE id = ?', [id]);
    return { action: 'deleted' };
  } catch (err) {
    // If FK violation from future order/quote tables, archive instead
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1217) {
      await db.query(
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
  normalizeAdminProductQuery,
  ADMIN_PRODUCT_PAGE_SIZE,
  PRODUCT_IMAGE_PATH,
};
