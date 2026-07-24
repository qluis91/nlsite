const gallery = require('../services/galleryService');
const validator = require('../validators/galleryValidator');
const { buildGalleryUrl } = require('../utils/galleryUrl');

function safeGalleryJson(items) {
  return JSON.stringify(items.map((item) => ({
    id: Number(item.id),
    slug: item.slug,
    type: item.media_type,
    title: item.title,
    description: item.description || '',
    category: item.category_name || '',
    thumbnail: item.thumbnail_path,
    source: item.media_path,
    poster: item.poster_path || null,
    alt: item.alt_text,
    featured: Boolean(item.is_featured),
  })))
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function paginationWindow(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const candidates = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const pages = [...candidates].filter((page) => page > 0 && page <= totalPages).sort((a, b) => a - b);
  const output = [];
  pages.forEach((page, index) => {
    if (index && page - pages[index - 1] > 1) output.push('ellipsis');
    output.push(page);
  });
  return output;
}

async function showGallery(req, res, next) {
  try {
    const filters = validator.parsePublicFilters(req.query);
    const categories = await gallery.listCategories({ activeOnly: true });
    const categoryExists = !filters.category || categories.some((category) => category.slug === filters.category);
    const invalidCategory = Boolean(filters.category && !categoryExists);
    if (invalidCategory) filters.category = '';
    const result = await gallery.listPublic(filters);
    const activeCategory = categories.find((category) => category.slug === filters.category) || null;
    res.render('pages/gallery', {
      title: 'Nuestra galería',
      metaDescription: 'Explora proyectos, productos y procesos creados por NinjaLabCR.',
      robots: filters.category || filters.type || filters.page > 1 ? 'noindex,follow' : 'index,follow',
      layout: 'layouts/main',
      pageClass: 'page-gallery',
      pageStyles: ['/css/home.css', '/css/gallery.css'],
      pageModule: '/js/gallery.js',
      usesHeroNavbar: true,
      navbarOnHome: false,
      categories,
      activeCategory,
      filters,
      invalidCategory,
      ...result,
      galleryJson: safeGalleryJson(result.items),
      buildGalleryUrl: (overrides) => buildGalleryUrl(filters, overrides),
      paginationPages: paginationWindow(result.page, result.totalPages),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { showGallery, buildGalleryUrl, safeGalleryJson, paginationWindow };
