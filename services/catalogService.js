const fs = require('fs');
const path = require('path');
const { normalizeCatalogTags } = require('./catalogTags');

// ── Try MySQL; fall back to JSON if unavailable
let pool = null;
try {
  pool = require('../config/db');
} catch {
  // MySQL not configured — will use JSON only
}

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'catalog.json');
const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 48;
const MAX_SEARCH_LENGTH = 100;
const ALLOWED_SORTS = new Set(['featured', 'newest', 'price-asc', 'price-desc', 'name-asc', 'name-desc']);

/**
 * Resolve public display price using: promotional > web > regular.
 */
function resolveDisplayPrice(product) {
  const regular = Number(product.regular_price ?? product.regularPrice ?? 0);
  const promotional = Number(product.promotional_price ?? product.promotionalPrice ?? 0);
  const web = Number(product.web_price ?? product.webPrice ?? 0);

  if (Number.isFinite(promotional) && promotional > 0 && promotional < regular) {
    return {
      displayPrice: promotional,
      regularPrice: regular,
      hasPromotion: true,
    };
  }
  if (Number.isFinite(web) && web > 0) {
    return {
      displayPrice: web,
      regularPrice: regular,
      hasPromotion: false,
    };
  }
  return {
    displayPrice: regular,
    regularPrice: regular,
    hasPromotion: false,
  };
}

function normalizeCatalogText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = String(value ?? '');
  if (!/^\d+$/.test(normalized)) return fallback;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function normalizeStoreQuery(query = {}) {
  const rawSearch = Array.isArray(query.search) ? query.search[0] : query.search;
  const cleanedSearch = String(rawSearch ?? '').replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  const rawCategory = Array.isArray(query.category) ? query.category[0] : query.category;
  const category = /^[a-z0-9-]{1,80}$/i.test(String(rawCategory ?? '')) ? String(rawCategory) : '';
  const rawStock = Array.isArray(query.inStock) ? query.inStock[0] : query.inStock;
  const inStock = rawStock === 'true' || rawStock === 'false' ? rawStock : '';
  const rawSort = Array.isArray(query.sort) ? query.sort[0] : query.sort;
  const sort = ALLOWED_SORTS.has(String(rawSort)) ? String(rawSort) : 'featured';

  return {
    search: cleanedSearch.slice(0, MAX_SEARCH_LENGTH),
    searchWasTruncated: cleanedSearch.length > MAX_SEARCH_LENGTH,
    category,
    inStock,
    sort,
    page: parsePositiveInteger(query.page, 1),
    limit: parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
  };
}

function loadCatalogData() {
  const parsed = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return {
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    products: Array.isArray(parsed.products) ? parsed.products : [],
  };
}

function isPublicProduct(product) {
  return product
    && product.active !== false
    && product.published !== false
    && typeof product.title === 'string'
    && typeof product.url === 'string'
    && /^\/tienda\/[a-z0-9-]+$/i.test(product.url);
}

function publicProductView(product, categoryMap) {
  const pricing = resolveDisplayPrice(product);
  const availability = product.availability === 'made-to-order'
    ? 'Por encargo'
    : product.inStock === false ? 'Agotado' : 'Disponible';

  return {
    id: product.id,
    title: product.title,
    slug: product.slug || product.url?.split('/').pop() || '',
    description: typeof product.description === 'string' ? product.description : '',
    url: product.url,
    categorySlug: typeof product.category === 'string' ? product.category : '',
    categoryName: categoryMap.get(product.category)?.name || '',
    categories: [{ slug: product.category, name: categoryMap.get(product.category)?.name || '' }],
    image: typeof product.image === 'string' && /^\/images\/[a-z0-9_./-]+$/i.test(product.image)
      ? product.image
      : '',
    imageWidth: parsePositiveInteger(product.imageWidth, 1200, 10000),
    imageHeight: parsePositiveInteger(product.imageHeight, 1500, 10000),
    regularPrice: pricing.regularPrice,
    promotionalPrice: pricing.hasPromotion ? pricing.displayPrice : null,
    webPrice: null,
    displayPrice: pricing.displayPrice,
    hasPromotion: pricing.hasPromotion,
    priceLabel: pricing.displayPrice > 0
      ? new Intl.NumberFormat('es-CR', {
        style: 'currency',
        currency: 'CRC',
        maximumFractionDigits: 0,
      }).format(pricing.displayPrice)
      : 'Solicitar cotización',
    availability,
    inStock: product.inStock !== false,
    searchKeywords: Array.isArray(product.tags) ? product.tags.map(String).join(' ') : '',
    hasPrice: pricing.displayPrice > 0,
    featuredOrder: Number.isFinite(Number(product.featuredOrder)) ? Number(product.featuredOrder) : 9999,
    createdAt: Date.parse(product.createdAt) || 0,
    numericPrice: pricing.displayPrice,
  };
}

function sortProducts(products, sort) {
  const sorted = [...products];
  const byName = (left, right) => left.title.localeCompare(right.title, 'es', { sensitivity: 'base' });

  sorted.sort((left, right) => {
    if (sort === 'newest') return right.createdAt - left.createdAt || byName(left, right);
    if (sort === 'price-asc') return Number(right.hasPrice) - Number(left.hasPrice) || left.numericPrice - right.numericPrice || byName(left, right);
    if (sort === 'price-desc') return Number(right.hasPrice) - Number(left.hasPrice) || right.numericPrice - left.numericPrice || byName(left, right);
    if (sort === 'name-asc') return byName(left, right);
    if (sort === 'name-desc') return byName(right, left);
    return left.featuredOrder - right.featuredOrder || byName(left, right);
  });

  return sorted;
}

function getPublicCatalog(query = {}) {
  // Use JSON as authoritative source (MySQL-backed async version exported separately)
  return getJsonCatalog(query);
}

/**
 * JSON-backed catalog query (original implementation).
 */
function getJsonCatalog(query = {}) {
  const filters = normalizeStoreQuery(query);
  const data = loadCatalogData();
  const categories = data.categories
    .filter((category) => category && category.active !== false && /^[a-z0-9-]{1,80}$/i.test(category.slug))
    .map(mapPublicCategory)
    .sort((left, right) => left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }));
  const categoryMap = new Map(categories.map((category) => [category.slug, category]));
  const requestedCategoryIsValid = !filters.category || categoryMap.has(filters.category);
  if (!requestedCategoryIsValid) filters.category = '';

  const allProducts = data.products
    .filter(isPublicProduct)
    .map((product) => publicProductView(product, categoryMap));
  const normalizedSearch = normalizeCatalogText(filters.search);
  const filtered = allProducts.filter((product) => {
    if (filters.category && product.categorySlug !== filters.category) return false;
    if (filters.inStock === 'true' && !product.inStock) return false;
    if (filters.inStock === 'false' && product.inStock) return false;
    if (!normalizedSearch) return true;
    return normalizeCatalogText([
      product.title,
      product.description,
      product.categoryName,
      product.searchKeywords,
    ].join(' ')).includes(normalizedSearch);
  });

  const sorted = sortProducts(filtered, filters.sort);
  const totalProducts = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalProducts / filters.limit));
  filters.page = Math.min(filters.page, totalPages);
  const offset = (filters.page - 1) * filters.limit;

  return {
    filters,
    categories,
    products: sorted.slice(offset, offset + filters.limit),
    totalProducts,
    totalCatalogProducts: allProducts.length,
    totalPages,
    invalidCategory: !requestedCategoryIsValid,
    source: 'json',
  };
}

/**
 * Get all public categories for store sidebar and hero resolution.
 */
async function getPublicCategories() {
  if (!pool) {
    const data = loadCatalogData();
    return (data.categories || [])
      .filter(cat => cat && cat.active !== false && /^[a-z0-9-]{1,80}$/i.test(cat.slug))
      .map(cat => mapPublicCategory(cat))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }
  try {
    const [rows] = await pool.query(
      `SELECT slug, name, description, hero_title, hero_description,
              hero_image, hero_alt, hero_position,
              seo_title, seo_description, og_image
       FROM categories
       ORDER BY name ASC`
    );
    return rows.map(mapPublicCategory);
  } catch (err) {
    // Older DBs without hero columns: fall back to slug/name only
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      try {
        const [rows] = await pool.query('SELECT slug, name FROM categories ORDER BY name ASC');
        return rows.map(mapPublicCategory);
      } catch (fallbackErr) {
        console.warn('[catalog] Categories query failed:', fallbackErr.message);
        return [];
      }
    }
    console.warn('[catalog] Categories query failed:', err.message);
    return [];
  }
}

const HERO_POSITIONS = new Set(['center', 'top', 'bottom', 'left', 'right']);
const DEFAULT_STORE_HERO = Object.freeze({
  eyebrow: 'Tienda NinjaLabCR',
  title: 'Ideas creadas en 3D',
  description: 'Descubre productos impresos, diseñados y personalizados por NinjaLabCR en Costa Rica.',
  imageUrl: '/images/LogoCompleto.png',
  imageAlt: 'NinjaLabCR — Impresión y diseño 3D',
  imagePosition: 'center',
  contextText: '',
});

function mapPublicCategory(cat) {
  return {
    slug: String(cat.slug || ''),
    name: String(cat.name || cat.slug || ''),
    description: typeof cat.description === 'string' ? cat.description : '',
    hero_title: typeof cat.hero_title === 'string' ? cat.hero_title : '',
    hero_description: typeof cat.hero_description === 'string' ? cat.hero_description : '',
    hero_image: typeof cat.hero_image === 'string' ? cat.hero_image : '',
    hero_alt: typeof cat.hero_alt === 'string' ? cat.hero_alt : '',
    hero_position: typeof cat.hero_position === 'string' ? cat.hero_position : 'center',
    seo_title: typeof cat.seo_title === 'string' ? cat.seo_title : '',
    seo_description: typeof cat.seo_description === 'string' ? cat.seo_description : '',
    og_image: typeof cat.og_image === 'string' ? cat.og_image : '',
  };
}

function isSafeHeroImagePath(raw) {
  const value = String(raw || '');
  return (
    /^\/uploads\/categories\/[1-9]\d*\/[a-z0-9._-]+\.(webp|jpe?g|png|avif)$/i.test(value)
    || /^\/images\/[a-z0-9._/-]+\.(webp|jpe?g|png|avif|gif)$/i.test(value)
  );
}

function normalizeHeroPosition(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return HERO_POSITIONS.has(value) ? value : 'center';
}

/**
 * Resolve the store catalog hero view model from the active category / search.
 * Phase 1F: Reads from CMS published data when available.
 * Fallback order: CMS published > hardcoded defaults.
 */
async function resolveStoreHero({ activeCategory = null, search = '' } = {}, poolRef = null) {
  const searchText = String(search || '').replace(/\0/g, '').trim().slice(0, 100);
  const contextText = searchText ? `Resultados para “${searchText}”` : '';

  // If there's an active category, use category hero (Phase 1.5 behavior)
  if (activeCategory) {
    const name = String(activeCategory.name || '').trim() || DEFAULT_STORE_HERO.title;
    const title = String(activeCategory.hero_title || '').trim() || name || DEFAULT_STORE_HERO.title;
    const description = String(activeCategory.hero_description || '').trim()
      || String(activeCategory.description || '').trim()
      || DEFAULT_STORE_HERO.description;

    let imageUrl = '';
    if (isSafeHeroImagePath(activeCategory.hero_image)) {
      imageUrl = activeCategory.hero_image;
    } else {
      imageUrl = DEFAULT_STORE_HERO.imageUrl;
    }

    const imageAlt = String(activeCategory.hero_alt || '').trim()
      || (name ? `Productos de ${name} en NinjaLabCR` : DEFAULT_STORE_HERO.imageAlt);

    return {
      eyebrow: 'Tienda NinjaLabCR',
      title,
      description,
      imageUrl,
      imageAlt,
      imagePosition: normalizeHeroPosition(activeCategory.hero_position),
      contextText,
      primaryLabel: '',
      primaryUrl: '',
      buttonTarget: '_self',
      isVisible: true,
    };
  }

  // No active category — read from CMS published data
  const db = poolRef;
  if (db) {
    try {
      const [[row]] = await db.query(
        `SELECT s.published_content_json
           FROM page_sections s
          INNER JOIN pages p ON p.id = s.page_id
          WHERE p.page_key = 'tienda' AND s.section_key = 'st-hero'`
      );
      if (row && row.published_content_json) {
        const c = typeof row.published_content_json === 'string'
          ? JSON.parse(row.published_content_json)
          : row.published_content_json;
        if (c && c.isVisible !== false) {
          // Resolve media reference
          let imageUrl = DEFAULT_STORE_HERO.imageUrl;
          if (c.backgroundMedia && typeof c.backgroundMedia === 'string' && c.backgroundMedia.startsWith('media://')) {
            try {
              const publicId = c.backgroundMedia.replace('media://', '');
              const [[asset]] = await db.query(
                "SELECT public_url, thumbnail_path, status FROM media_assets WHERE public_id = ? AND status != 'deleted' LIMIT 1",
                [publicId]
              );
              if (asset && asset.public_url) imageUrl = asset.public_url;
            } catch (_) { /* use fallback */ }
          }

          const safeButtonUrl = (url) => {
            if (!url) return '';
            if (url.startsWith('/') && !url.startsWith('//')) return url;
            if (/^https?:\/\//i.test(url)) return url;
            return '';
          };

          return {
            eyebrow: c.eyebrow || DEFAULT_STORE_HERO.eyebrow,
            title: c.title || DEFAULT_STORE_HERO.title,
            description: c.description || DEFAULT_STORE_HERO.description,
            imageUrl,
            imageAlt: c.imageAlt || DEFAULT_STORE_HERO.imageAlt,
            imagePosition: c.imagePosition || DEFAULT_STORE_HERO.imagePosition,
            contextText,
            primaryLabel: c.primaryLabel || '',
            primaryUrl: safeButtonUrl(c.primaryUrl),
            buttonTarget: (c.buttonTarget === '_blank' || c.buttonTarget === '_self') ? c.buttonTarget : '_self',
            isVisible: true,
          };
        }
      }
    } catch (_) { /* use fallback */ }
  }

  return {
    ...DEFAULT_STORE_HERO,
    contextText,
    primaryLabel: '',
    primaryUrl: '',
    buttonTarget: '_self',
    isVisible: true,
  };
}

/**
 * Async MySQL-backed catalog query.
 * Falls back to JSON if MySQL is unavailable.
 */
async function getPublicCatalogAsync(query = {}) {
  const filters = normalizeStoreQuery(query);

  if (!pool) {
    return getPublicCatalog(query);
  }

  try {
    // Get published, active products
    let sql = `
      SELECT p.id, p.name, p.slug, p.regular_price, p.promotional_price,
             p.web_price, p.weight, p.stock_quantity, p.description, p.tags,
             p.created_at,
             pi.file_path AS image, pi.width AS imageWidth, pi.height AS imageHeight
      FROM products p
      LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
      WHERE p.is_active = 1 AND p.is_published = 1
    `;
    const params = [];

    // Category filter via slug (join categories table)
    if (filters.category) {
      sql += ` AND p.id IN (
        SELECT pc.product_id FROM product_categories pc
        JOIN categories c ON c.id = pc.category_id
        WHERE c.slug = ?
      )`;
      params.push(filters.category);
    }

    // Stock filter
    if (filters.inStock === 'true') {
      sql += ' AND p.stock_quantity > 0';
    } else if (filters.inStock === 'false') {
      sql += ' AND p.stock_quantity = 0';
    }

    // Search
    if (filters.search) {
      sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term);
    }

    const [products] = await pool.query(sql, params);

    // Get categories for each product
    const productIds = products.map(p => p.id);
    let catMap = new Map();
    if (productIds.length) {
      const [cats] = await pool.query(
        `SELECT pc.product_id, c.slug, c.name
         FROM product_categories pc
         JOIN categories c ON c.id = pc.category_id
         WHERE pc.product_id IN (?)`,
        [productIds]
      );
      for (const cat of cats) {
        if (!catMap.has(cat.product_id)) catMap.set(cat.product_id, []);
        catMap.get(cat.product_id).push({ slug: cat.slug, name: cat.name });
      }
    }

    // Convert to public product views
    const categorySet = new Map();
    const normalizedSearch = normalizeCatalogText(filters.search);

    const allProducts = products
      .filter(p => p.name)
      .map(p => {
        const pricing = resolveDisplayPrice(p);
        const tags = normalizeCatalogTags(p.tags);
        const cats = catMap.get(p.id) || [];
        const primaryCat = cats[0] || {};

        // Track categories
        cats.forEach(c => { if (!categorySet.has(c.slug)) categorySet.set(c.slug, c); });

        return {
          id: p.id,
          title: p.name,
          slug: p.slug,
          description: p.description || '',
          url: `/tienda/${p.slug}`,
          categorySlug: primaryCat.slug || '',
          categoryName: primaryCat.name || '',
          categories: cats,
          image: p.image && /^\/uploads\/products\/[a-z0-9_./-]+$/i.test(p.image) ? p.image : '',
          imageWidth: p.imageWidth || 1200,
          imageHeight: p.imageHeight || 1500,
          regularPrice: pricing.regularPrice,
          promotionalPrice: p.promotional_price || p.promotionalPrice || null,
          webPrice: p.web_price || p.webPrice || null,
          displayPrice: pricing.displayPrice,
          hasPromotion: pricing.hasPromotion,
          priceLabel: pricing.displayPrice > 0
            ? new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(pricing.displayPrice)
            : 'Solicitar cotización',
          availability: p.stock_quantity > 0 ? 'Disponible' : 'Agotado',
          inStock: p.stock_quantity > 0,
          stockQuantity: p.stock_quantity,
          tags,
          searchKeywords: tags.join(' '),
          hasPrice: pricing.displayPrice > 0,
          featuredOrder: 9999,
          createdAt: new Date(p.created_at).getTime(),
          numericPrice: pricing.displayPrice,
        };
      });

    const requestedCategoryIsValid = !filters.category || categorySet.has(filters.category);
    if (!requestedCategoryIsValid) filters.category = '';

    const allCategories = [...categorySet.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

    const filtered = allProducts.filter(product => {
      if (filters.category && product.categorySlug !== filters.category) return false;
      if (filters.inStock === 'true' && !product.inStock) return false;
      if (filters.inStock === 'false' && product.inStock) return false;
      if (!normalizedSearch) return true;
      return normalizeCatalogText([
        product.title, product.description, product.categoryName, product.searchKeywords,
      ].join(' ')).includes(normalizedSearch);
    });

    const sorted = sortProducts(filtered, filters.sort);
    const totalProducts = sorted.length;
    const totalPages = Math.max(1, Math.ceil(totalProducts / filters.limit));
    filters.page = Math.min(filters.page, totalPages);
    const offset = (filters.page - 1) * filters.limit;

    return {
      filters,
      categories: allCategories,
      products: sorted.slice(offset, offset + filters.limit),
      totalProducts,
      totalCatalogProducts: allProducts.length,
      totalPages,
      invalidCategory: !requestedCategoryIsValid,
      source: 'mysql',
    };
  } catch (err) {
    console.warn('[catalog] MySQL query failed, using JSON fallback:', err.message);
    return getPublicCatalog(query);
  }
}

/**
 * Get a single public product by slug for detail page.
 */
async function getProductBySlug(slug) {
  if (!pool) return null;

  try {
    const [rows] = await pool.query(
      `SELECT p.* FROM products p
       WHERE p.slug = ? AND p.is_active = 1 AND p.is_published = 1`,
      [slug]
    );
    if (!rows[0]) return null;
    const p = rows[0];

    const pricing = resolveDisplayPrice(p);

    // Get categories
    const [cats] = await pool.query(
      `SELECT c.slug, c.name FROM product_categories pc
       JOIN categories c ON c.id = pc.category_id
       WHERE pc.product_id = ?`,
      [p.id]
    );

    // Get all images ordered: primary first, then position, then id (max 5)
    const [imgRows] = await pool.query(
      'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, position ASC, id ASC LIMIT 5',
      [p.id]
    );

    // Deduplicate and build gallery: primary first, then rest by position
    const seen = new Set();
    const allImages = [];
    for (const img of imgRows) {
      if (seen.has(img.file_path)) continue;
      seen.add(img.file_path);
      allImages.push({
        id: img.id,
        filePath: img.file_path,
        isPrimary: img.is_primary === 1,
        width: img.width,
        height: img.height,
        position: img.position,
      });
    }

    const primaryImage = allImages.find(i => i.isPrimary) || allImages[0] || null;

    return {
      id: p.id,
      title: p.name,
      slug: p.slug,
      description: p.description || '',
      seoTitle: p.seo_title || '',
      seoDescription: p.seo_description || '',
      ogImage: p.og_image || '',
      url: `/tienda/${p.slug}`,
      categories: cats,
      primaryImage: primaryImage ? primaryImage.filePath : '',
      primaryImageWidth: primaryImage ? primaryImage.width : null,
      primaryImageHeight: primaryImage ? primaryImage.height : null,
      images: allImages,
      secondaryImages: allImages.filter(i => !i.isPrimary),
      regularPrice: pricing.regularPrice,
      promotionalPrice: p.promotional_price || null,
      webPrice: p.web_price || null,
      displayPrice: pricing.displayPrice,
      hasPromotion: pricing.hasPromotion,
      priceLabel: pricing.displayPrice > 0
        ? new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(pricing.displayPrice)
        : 'Solicitar cotización',
      availability: p.stock_quantity > 0 ? 'Disponible' : 'Agotado',
      inStock: p.stock_quantity > 0,
      stockQuantity: p.stock_quantity,
      weight: p.weight,
      tags: normalizeCatalogTags(p.tags),
      createdAt: p.created_at,
    };
  } catch (err) {
    console.warn('[catalog] Product detail query failed:', err.message);
    return null;
  }
}

/**
 * Get related published products from the same categories.
 */
async function getRelatedProducts(productId, categoryIds, limit = 4) {
  if (!pool || !categoryIds.length) return [];

  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT p.id, p.name, p.slug, p.regular_price, p.promotional_price, p.web_price,
              p.stock_quantity, p.description, p.tags, p.created_at,
              pi.file_path AS image, pi.width AS imageWidth, pi.height AS imageHeight
       FROM products p
       JOIN product_categories pc ON pc.product_id = p.id
       LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
       WHERE p.id != ?
         AND p.is_active = 1
         AND p.is_published = 1
         AND pc.category_id IN (?)
       ORDER BY p.created_at DESC
       LIMIT ?`,
      [productId, categoryIds, limit]
    );

    if (!rows.length) {
      // Fallback: recent published products
      const [fallback] = await pool.query(
        `SELECT p.id, p.name, p.slug, p.regular_price, p.promotional_price, p.web_price,
                p.stock_quantity, p.description, p.tags, p.created_at,
                pi.file_path AS image, pi.width AS imageWidth, pi.height AS imageHeight
         FROM products p
         LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
         WHERE p.id != ? AND p.is_active = 1 AND p.is_published = 1
         ORDER BY p.created_at DESC
         LIMIT ?`,
        [productId, limit]
      );
      return serializeRelatedProducts(fallback);
    }

    return serializeRelatedProducts(rows);
  } catch (err) {
    console.warn('[catalog] Related products query failed:', err.message);
    return [];
  }
}

function serializeRelatedProducts(rows) {
  return rows.map(p => {
    const pricing = resolveDisplayPrice(p);
    const image = p.image && /^\/uploads\/products\/[a-z0-9_./-]+$/i.test(p.image) ? p.image : '';
    return {
      id: p.id,
      title: p.name,
      slug: p.slug,
      url: `/tienda/${p.slug}`,
      image,
      primaryImage: image,
      imageWidth: p.imageWidth || 1200,
      imageHeight: p.imageHeight || 1500,
      regularPrice: pricing.regularPrice,
      displayPrice: pricing.displayPrice,
      hasPromotion: pricing.hasPromotion,
      priceLabel: pricing.displayPrice > 0
        ? new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(pricing.displayPrice)
        : 'Solicitar cotización',
      availability: p.stock_quantity > 0 ? 'Disponible' : 'Agotado',
      inStock: p.stock_quantity > 0,
      categoryName: '',
    };
  });
}

/**
 * Format weight for public display. Grams → g or kg.
 */
function formatWeight(grams) {
  if (!grams || grams <= 0) return '';
  if (grams < 1000) return `${grams} g`;
  const kg = grams / 1000;
  return kg % 1 === 0 ? `${kg} kg` : `${kg.toFixed(2).replace(/\.?0+$/, '')} kg`;
}

/**
 * Batch-fetch public products by IDs for cart hydration.
 * Returns only active + published products with primary image and price data.
 */
async function getPublicProductsByIds(productIds) {
  if (!pool || !productIds.length) return [];

  // Deduplicate and bound
  const ids = [...new Set(productIds)].map(Number).filter(id => id > 0).slice(0, 50);
  if (!ids.length) return [];

  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.slug, p.regular_price, p.promotional_price, p.web_price,
              p.stock_quantity, p.weight, p.description, p.tags, p.is_active, p.is_published,
              pi.file_path AS image, pi.width AS imageWidth, pi.height AS imageHeight
       FROM products p
       LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
       WHERE p.id IN (?)
         AND p.is_active = 1
         AND p.is_published = 1`,
      [ids]
    );

    return rows.map(p => {
      const pricing = resolveDisplayPrice(p);
      return {
        id: p.id,
        title: p.name,
        slug: p.slug,
        description: p.description || '',
        url: `/tienda/${p.slug}`,
        primaryImage: p.image && /^\/uploads\/products\/[a-z0-9_./-]+$/i.test(p.image) ? p.image : '',
        imageWidth: p.imageWidth || 1200,
        imageHeight: p.imageHeight || 1500,
        regularPrice: pricing.regularPrice,
        promotionalPrice: p.promotional_price || null,
        webPrice: p.web_price || null,
        displayPrice: pricing.displayPrice,
        hasPromotion: pricing.hasPromotion,
        priceLabel: pricing.displayPrice > 0
          ? new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(pricing.displayPrice)
          : 'Solicitar cotización',
        availability: p.stock_quantity > 0 ? 'Disponible' : 'Agotado',
        inStock: p.stock_quantity > 0,
        stockQuantity: p.stock_quantity,
        isActive: p.is_active === 1,
        isPublished: p.is_published === 1,
      };
    });
  } catch (err) {
    console.warn('[catalog] Batch product query failed:', err.message);
    return [];
  }
}

module.exports = {
  ALLOWED_SORTS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_SEARCH_LENGTH,
  HERO_POSITIONS,
  DEFAULT_STORE_HERO,
  getPublicCatalog,
  getPublicCatalogAsync,
  getPublicCategories,
  getProductBySlug,
  getRelatedProducts,
  getPublicProductsByIds,
  formatWeight,
  resolveDisplayPrice,
  normalizeCatalogText,
  normalizeStoreQuery,
  resolveStoreHero,
  isSafeHeroImagePath,
  normalizeHeroPosition,
};
