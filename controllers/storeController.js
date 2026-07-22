const { DEFAULT_LIMIT, getPublicCatalog, normalizeStoreQuery } = require('../services/catalogService');

function buildStoreUrl(filters, overrides = {}) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.search) params.set('search', next.search);
  if (next.category) params.set('category', next.category);
  if (next.inStock) params.set('inStock', next.inStock);
  if (next.sort && next.sort !== 'featured') params.set('sort', next.sort);
  if (next.limit && next.limit !== 12) params.set('limit', String(next.limit));
  if (next.page && next.page !== 1) params.set('page', String(next.page));
  const query = params.toString();
  return query ? `/tienda?${query}` : '/tienda';
}

function paginationWindow(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const candidates = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const pages = [...candidates].filter((page) => page > 0 && page <= totalPages).sort((a, b) => a - b);
  const output = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) output.push('ellipsis');
    output.push(page);
  });
  return output;
}

function showStore(req, res) {
  let catalog;
  let catalogError = false;

  try {
    catalog = getPublicCatalog(req.query);
  } catch (error) {
    catalogError = true;
    console.warn('[store] Public catalog unavailable:', error.message);
    catalog = {
      filters: normalizeStoreQuery(req.query),
      categories: [],
      products: [],
      totalProducts: 0,
      totalCatalogProducts: 0,
      totalPages: 1,
      invalidCategory: false,
      source: 'unavailable',
    };
    catalog.filters.page = 1;
    catalog.filters.limit = Math.min(catalog.filters.limit, DEFAULT_LIMIT);
  }

  const { filters, categories } = catalog;
  const activeCategory = categories.find((category) => category.slug === filters.category) || null;
  const activeFilters = [];
  if (filters.search) {
    activeFilters.push({
      label: `Búsqueda: “${filters.search}”`,
      removeUrl: buildStoreUrl(filters, { search: '', page: 1 }),
    });
  }
  if (activeCategory) {
    activeFilters.push({
      label: `Categoría: ${activeCategory.name}`,
      removeUrl: buildStoreUrl(filters, { category: '', page: 1 }),
    });
  }
  if (filters.inStock) {
    activeFilters.push({
      label: filters.inStock === 'true' ? 'Disponibles' : 'Agotados',
      removeUrl: buildStoreUrl(filters, { inStock: '', page: 1 }),
    });
  }

  res.render('pages/tienda', {
    title: 'Tienda de impresión 3D',
    metaDescription: 'Explora productos, figuras y piezas personalizadas impresas en 3D por NinjaLab CR.',
    robots: activeFilters.length ? 'noindex,follow' : 'index,follow',
    layout: 'layouts/main',
    pageClass: 'page-store',
    pageStyles: ['/css/home.css', '/css/store.css'],
    pageModule: '/js/store/store.js',
    usesHeroNavbar: true,
    navbarOnHome: false,
    navbarSearchContext: 'store',
    searchQuery: filters.search,
    catalog,
    categories,
    catalogError,
    activeCategory,
    activeFilters,
    activeFilterCount: activeFilters.length,
    buildStoreUrl: (overrides) => buildStoreUrl(filters, overrides),
    paginationPages: paginationWindow(filters.page, catalog.totalPages),
  });
}

module.exports = {
  buildStoreUrl,
  paginationWindow,
  showStore,
};
