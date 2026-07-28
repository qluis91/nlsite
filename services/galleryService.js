const pool = require('../config/db');

async function listCategories({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE c.is_active = 1' : '';
  const [rows] = await pool.query(
    `SELECT c.*, COUNT(i.id) AS item_count
       FROM gallery_categories c
       LEFT JOIN gallery_items i ON i.category_id = c.id
       ${where}
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.name ASC, c.id ASC`
  );
  return rows;
}

async function getCategoryById(id) {
  const [rows] = await pool.query('SELECT * FROM gallery_categories WHERE id = ?', [id]);
  return rows[0] || null;
}

async function isCategorySlugTaken(slug, excludeId = null) {
  const sql = excludeId
    ? 'SELECT id FROM gallery_categories WHERE slug = ? AND id != ?'
    : 'SELECT id FROM gallery_categories WHERE slug = ?';
  const [rows] = await pool.query(sql, excludeId ? [slug, excludeId] : [slug]);
  return rows.length > 0;
}

async function createCategory(data) {
  const [result] = await pool.query(
    `INSERT INTO gallery_categories (name, slug, description, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?)`,
    [data.name, data.slug, data.description, data.sortOrder, data.isActive ? 1 : 0]
  );
  return result.insertId;
}

async function updateCategory(id, data) {
  await pool.query(
    `UPDATE gallery_categories
        SET name = ?, slug = ?, description = ?, sort_order = ?, is_active = ?
      WHERE id = ?`,
    [data.name, data.slug, data.description, data.sortOrder, data.isActive ? 1 : 0, id]
  );
}

async function deleteCategory(id) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [categories] = await connection.query(
      'SELECT id FROM gallery_categories WHERE id = ? FOR UPDATE',
      [id]
    );
    if (!categories[0]) throw new Error('Categoría de galería no encontrada.');
    const [[count]] = await connection.query(
      'SELECT COUNT(*) AS total FROM gallery_items WHERE category_id = ?',
      [id]
    );
    if (Number(count.total) > 0) {
      throw new Error('No se puede eliminar una categoría con elementos asociados.');
    }
    await connection.query('DELETE FROM gallery_categories WHERE id = ?', [id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function isItemSlugTaken(slug, excludeId = null) {
  const sql = excludeId
    ? 'SELECT id FROM gallery_items WHERE slug = ? AND id != ?'
    : 'SELECT id FROM gallery_items WHERE slug = ?';
  const [rows] = await pool.query(sql, excludeId ? [slug, excludeId] : [slug]);
  return rows.length > 0;
}

async function getItemById(id) {
  const [rows] = await pool.query(
    `SELECT i.*, c.name AS category_name, c.slug AS category_slug, c.is_active AS category_active
       FROM gallery_items i
       LEFT JOIN gallery_categories c ON c.id = i.category_id
      WHERE i.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function createItem(data) {
  const publishedAt = data.isPublished ? new Date() : null;
  const [result] = await pool.query(
    `INSERT INTO gallery_items
      (category_id, title, slug, description, media_type, media_path, thumbnail_path,
       poster_path, youtube_url, custom_cover_path, alt_text, sort_order, is_featured, is_published, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.categoryId, data.title, data.slug, data.description, data.mediaType,
      data.mediaPath, data.thumbnailPath, data.posterPath || null,
      data.youtubeUrl || null, data.customCoverPath || null,
      data.altText, data.sortOrder,
      data.isFeatured ? 1 : 0, data.isPublished ? 1 : 0,
      publishedAt,
    ]
  );
  return result.insertId;
}

async function updateItem(id, data) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [locked] = await connection.query('SELECT id FROM gallery_items WHERE id = ? FOR UPDATE', [id]);
    if (!locked[0]) throw new Error('Elemento de galería no encontrado.');
    const publishedAt = data.isPublished ? new Date() : null;
    await connection.query(
      `UPDATE gallery_items
          SET category_id = ?, title = ?, slug = ?, description = ?, media_type = ?,
              media_path = ?, thumbnail_path = ?, poster_path = ?, youtube_url = ?, custom_cover_path = ?,
              alt_text = ?,
              sort_order = ?, is_featured = ?, is_published = ?,
              published_at = ?
        WHERE id = ?`,
      [
        data.categoryId, data.title, data.slug, data.description, data.mediaType,
        data.mediaPath, data.thumbnailPath, data.posterPath || null,
        data.youtubeUrl || null, data.customCoverPath || null,
        data.altText, data.sortOrder,
        data.isFeatured ? 1 : 0, data.isPublished ? 1 : 0,
        publishedAt,
        id,
      ]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function deleteItem(id) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM gallery_items WHERE id = ? FOR UPDATE', [id]);
    if (!rows[0]) throw new Error('Elemento de galería no encontrado.');
    await connection.query('DELETE FROM gallery_items WHERE id = ?', [id]);
    await connection.commit();
    return rows[0];
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function setPublished(id, isPublished) {
  await pool.query(
    `UPDATE gallery_items
        SET is_published = ?,
            published_at = CASE WHEN ? = 1 THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE NULL END
      WHERE id = ?`,
    [isPublished ? 1 : 0, isPublished ? 1 : 0, id]
  );
}

async function setFeatured(id, isFeatured) {
  await pool.query('UPDATE gallery_items SET is_featured = ? WHERE id = ?', [isFeatured ? 1 : 0, id]);
}

async function listAdmin(filters) {
  const conditions = ['1 = 1'];
  const params = [];
  if (filters.search) {
    conditions.push('(i.title LIKE ? OR i.description LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.categoryId) {
    conditions.push('i.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.mediaType) {
    conditions.push('i.media_type = ?');
    params.push(filters.mediaType);
  }
  if (filters.published) {
    conditions.push('i.is_published = ?');
    params.push(filters.published === 'published' ? 1 : 0);
  }
  if (filters.featured) {
    conditions.push('i.is_featured = ?');
    params.push(filters.featured === 'featured' ? 1 : 0);
  }
  const where = conditions.join(' AND ');
  const offset = (filters.page - 1) * filters.limit;
  const [items] = await pool.query(
    `SELECT i.*, c.name AS category_name
       FROM gallery_items i
       LEFT JOIN gallery_categories c ON c.id = i.category_id
      WHERE ${where}
      ORDER BY i.is_featured DESC, i.sort_order ASC, i.created_at DESC, i.id DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit, offset]
  );
  const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM gallery_items i WHERE ${where}`, params);
  const total = Number(count.total);
  return {
    items,
    total,
    page: filters.page,
    totalPages: Math.max(1, Math.ceil(total / filters.limit)),
  };
}

async function listPublic(filters) {
  const conditions = [
    'i.is_published = 1',
    '(i.category_id IS NULL OR c.is_active = 1)',
  ];
  const params = [];
  if (filters.category) {
    conditions.push('c.slug = ?');
    params.push(filters.category);
  }
  if (filters.type) {
    conditions.push('i.media_type = ?');
    params.push(filters.type);
  }
  const where = conditions.join(' AND ');
  const offset = (filters.page - 1) * filters.limit;
  const [items] = await pool.query(
    `SELECT i.id, i.slug, i.title, i.description, i.media_type, i.media_path,
            i.thumbnail_path, i.poster_path, i.youtube_url, i.custom_cover_path,
            i.alt_text, i.is_featured,
            c.name AS category_name, c.slug AS category_slug
       FROM gallery_items i
       LEFT JOIN gallery_categories c ON c.id = i.category_id
      WHERE ${where}
      ORDER BY i.is_featured DESC, i.sort_order ASC, i.published_at DESC, i.id DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit, offset]
  );
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM gallery_items i
       LEFT JOIN gallery_categories c ON c.id = i.category_id
      WHERE ${where}`,
    params
  );
  const total = Number(count.total);
  return {
    items,
    total,
    page: filters.page,
    totalPages: Math.max(1, Math.ceil(total / filters.limit)),
  };
}

async function listPublishedVideoItems() {
  const [items] = await pool.query(
    `SELECT i.id, i.slug, i.title, i.description, i.media_type, i.media_path,
            i.thumbnail_path, i.poster_path, i.youtube_url, i.custom_cover_path,
            i.alt_text, i.is_featured,
            c.name AS category_name, c.slug AS category_slug
       FROM gallery_items i
       LEFT JOIN gallery_categories c ON c.id = i.category_id
      WHERE i.is_published = 1
        AND i.media_type IN ('video', 'youtube')
        AND (i.category_id IS NULL OR c.is_active = 1)
      ORDER BY i.is_featured DESC, i.sort_order ASC, i.published_at DESC, i.id DESC`
  );
  return items;
}

module.exports = {
  listCategories,
  getCategoryById,
  isCategorySlugTaken,
  createCategory,
  updateCategory,
  deleteCategory,
  isItemSlugTaken,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  setPublished,
  setFeatured,
  listAdmin,
  listPublic,
  listPublishedVideoItems,
};
