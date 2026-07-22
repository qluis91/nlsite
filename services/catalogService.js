const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'catalog.json');
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 36;
const MAX_SEARCH_LENGTH = 100;
const ALLOWED_SORTS = new Set(['featured', 'newest', 'price-asc', 'price-desc', 'name-asc']);

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
  const price = Number(product.price);
  const hasPrice = Number.isFinite(price) && price >= 0;
  const availability = product.availability === 'made-to-order'
    ? 'Por encargo'
    : product.inStock === false ? 'Agotado' : 'Disponible';

  return {
    title: product.title,
    description: typeof product.description === 'string' ? product.description : '',
    url: product.url,
    categorySlug: typeof product.category === 'string' ? product.category : '',
    categoryName: categoryMap.get(product.category)?.name || '',
    image: typeof product.image === 'string' && /^\/images\/[a-z0-9_./-]+$/i.test(product.image)
      ? product.image
      : '',
    imageWidth: parsePositiveInteger(product.imageWidth, 1200, 10000),
    imageHeight: parsePositiveInteger(product.imageHeight, 1500, 10000),
    priceLabel: hasPrice
      ? new Intl.NumberFormat('es-CR', {
        style: 'currency',
        currency: 'CRC',
        maximumFractionDigits: 0,
      }).format(price)
      : 'Solicitar cotización',
    availability,
    inStock: product.inStock !== false,
    searchKeywords: Array.isArray(product.tags) ? product.tags.map(String).join(' ') : '',
    hasPrice,
    featuredOrder: Number.isFinite(Number(product.featuredOrder)) ? Number(product.featuredOrder) : 9999,
    createdAt: Date.parse(product.createdAt) || 0,
    numericPrice: hasPrice ? price : Number.MAX_SAFE_INTEGER,
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
    return left.featuredOrder - right.featuredOrder || byName(left, right);
  });

  return sorted;
}

function getPublicCatalog(query = {}) {
  const filters = normalizeStoreQuery(query);
  const data = loadCatalogData();
  const categories = data.categories
    .filter((category) => category && category.active !== false && /^[a-z0-9-]{1,80}$/i.test(category.slug))
    .map((category) => ({ slug: category.slug, name: String(category.name || category.slug) }))
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

module.exports = {
  ALLOWED_SORTS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_SEARCH_LENGTH,
  getPublicCatalog,
  normalizeCatalogText,
  normalizeStoreQuery,
};
