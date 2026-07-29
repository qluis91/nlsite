const { DEFAULT_LIMIT, getPublicCatalog, getPublicCatalogAsync, getPublicCategories, getProductBySlug, getRelatedProducts, formatWeight, normalizeStoreQuery, resolveStoreHero } = require('../services/catalogService');
const pool = require('../config/db');
const { buildWhatsAppUrl } = require('../config/publicContact');
const { buildProductLd, buildBreadcrumbLd, jsonLdScript, makeAbsolute } = require('../config/jsonLdHelper');

const BASE_URL = process.env.APP_URL || 'http://localhost:' + (process.env.PORT || 3000);

function buildStoreUrl(filters, overrides = {}) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.search) params.set('search', next.search);
  if (next.category) params.set('category', next.category);
  if (next.inStock) params.set('inStock', next.inStock);
  if (next.sort && next.sort !== 'featured') params.set('sort', next.sort);
  if (next.limit && next.limit !== DEFAULT_LIMIT) params.set('limit', String(next.limit));
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

/**
 * Validate returnTo parameter — only allow /tienda and /carrito paths.
 */
function safeReturnPath(raw) {
  if (!raw) return '/tienda';
  const decoded = decodeURIComponent(String(raw));
  if (/^\/(tienda|carrito)(\/[a-z0-9-]+)?(\?[a-z0-9_=&%-]*)?$/i.test(decoded)) {
    return decoded;
  }
  return '/tienda';
}

async function showStore(req, res) {
  let catalog;
  let storeCategories;
  let catalogError = false;

  try {
    [catalog, storeCategories] = await Promise.all([
      getPublicCatalogAsync(req.query),
      getPublicCategories(),
    ]);
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
    storeCategories = [];
  }

  const { filters } = catalog;
  const categories = storeCategories.length ? storeCategories : catalog.categories;
  const activeCategory = categories.find((category) => category.slug === filters.category) || null;
  const activeFilters = [];
  if (filters.search) {
    activeFilters.push({
      label: `Búsqueda: "${filters.search}"`,
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

  const storeHero = await resolveStoreHero({
    activeCategory,
    search: filters.search,
  }, pool);

  // Category-specific SEO
  let catMetaTitle = '';
  let catMetaDescription = '';
  let catOgImage = '';
  let catCanonical = '';
  if (activeCategory && activeCategory.name) {
    catMetaTitle = activeCategory.seo_title || activeCategory.name;
    catMetaDescription = activeCategory.seo_description || activeCategory.description?.slice(0, 160) || '';
    catOgImage = activeCategory.og_image
      || (storeHero.source === 'category' ? storeHero.imageUrl : '')
      || '';
    catCanonical = makeAbsolute(`/tienda?category=${activeCategory.slug}`, BASE_URL);
  }

  // Breadcrumb JSON-LD for category pages
  let jsonLdBreadcrumb = '';
  if (activeCategory) {
    const storeUrl = makeAbsolute('/tienda', BASE_URL);
    const catUrl = makeAbsolute(`/tienda?category=${activeCategory.slug}`, BASE_URL);
    jsonLdBreadcrumb = jsonLdScript(buildBreadcrumbLd([
      { name: 'Tienda', item: storeUrl },
      { name: activeCategory.name, item: catUrl },
    ]));
  }

  // Build store canonical: no duplicate indexing for filtered views (Phase 12D)
  let storeCanonical = catCanonical || makeAbsolute('/tienda', BASE_URL);

  res.render('pages/tienda', {
    title: activeCategory ? `${activeCategory.name} | Tienda` : 'Tienda de impresión 3D',
    metaTitle: catMetaTitle || undefined,
    metaDescription: catMetaDescription || 'Explora productos, figuras y piezas personalizadas impresas en 3D por NinjaLab CR.',
    ogImage: catOgImage || undefined,
    canonical: storeCanonical,
    robots: activeFilters.length ? 'noindex,follow' : 'index,follow',
    layout: 'layouts/store',
    pageClass: 'page-store',
    pageStyles: ['/css/store.css'],
    pageModule: '/js/store/store.js',
    catalog,
    categories,
    catalogError,
    activeCategory,
    activeFilters,
    activeFilterCount: activeFilters.length,
    storeHero,
    buildStoreUrl: (overrides) => buildStoreUrl(filters, overrides),
    paginationPages: paginationWindow(filters.page, catalog.totalPages),
    jsonLdBreadcrumb,
  });
}

async function showProduct(req, res, next) {
  try {
    const slug = String(req.params.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 180);
    if (!slug) {
      return res.redirect('/tienda');
    }

    const [product, categories] = await Promise.all([
      getProductBySlug(slug),
      getPublicCategories(),
    ]);

    if (!product) {
      return res.status(404).render('pages/tienda-producto', {
        title: 'Producto no encontrado',
        layout: 'layouts/store',
        pageClass: 'page-store',
        pageStyles: ['/css/store.css'],
        pageModule: '/js/store/product-detail.js',
        product: null,
        categories,
        activeCategory: null,
        relatedProducts: [],
        returnTo: '/tienda',
        whatsappUrl: '',
        weightLabel: '',
      });
    }

    const returnTo = safeReturnPath(req.query.returnTo);
    const categoryIds = (product.categories || []).map(c => c.id || c.slug);
    const relatedProducts = await getRelatedProducts(product.id, categoryIds, 4);
    const whatsappUrl = buildWhatsAppUrl(product.title, 'NinjaLab');
    const weightLabel = formatWeight(product.weight);
    const primaryCategory = (product.categories && product.categories[0]) || null;
    const activeCategory = primaryCategory
      ? (categories.find((c) => c.slug === primaryCategory.slug) || primaryCategory)
      : null;

    // Phase 12D: Product JSON-LD
    const jsonLdProduct = jsonLdScript(buildProductLd(product, BASE_URL));

    // Phase 12D: Breadcrumb JSON-LD
    const productUrl = makeAbsolute(product.url, BASE_URL);
    const storeUrl = makeAbsolute('/tienda', BASE_URL);
    const breadcrumbItems = [{ name: 'Tienda', item: storeUrl }];
    if (activeCategory) {
      breadcrumbItems.push({ name: activeCategory.name, item: makeAbsolute(`/tienda?category=${activeCategory.slug}`, BASE_URL) });
    }
    breadcrumbItems.push({ name: product.title, item: productUrl });
    const jsonLdBreadcrumb = jsonLdScript(buildBreadcrumbLd(breadcrumbItems));

    res.render('pages/tienda-producto', {
      title: `${product.title} | Tienda`,
      metaTitle: product.seoTitle || product.title,
      metaDescription: product.seoDescription || product.description?.slice(0, 160) || product.title,
      ogImage: product.ogImage || product.primaryImage || '',
      canonical: productUrl,
      ogUrl: productUrl,
      robots: 'index,follow',
      layout: 'layouts/store',
      pageClass: 'page-store',
      pageStyles: ['/css/store.css'],
      pageModule: '/js/store/product-detail.js',
      product,
      categories,
      activeCategory,
      returnTo,
      relatedProducts,
      whatsappUrl,
      weightLabel,
      jsonLdProduct,
      jsonLdBreadcrumb,
    });
  } catch (err) { next(err); }
}

module.exports = {
  buildStoreUrl,
  paginationWindow,
  showStore,
  showProduct,
  safeReturnPath,
};
