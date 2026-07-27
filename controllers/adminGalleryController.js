const gallery = require('../services/galleryService');
const media = require('../services/galleryMediaService');
const validator = require('../validators/galleryValidator');
const { MEDIA_TYPES } = require('../config/galleryOptions');
const { parsePositiveId } = require('../validators/addressValidator');

function redirectWithError(req, res, destination, error) {
  req.session.error_msg = error?.message || 'No fue posible completar la operación de galería.';
  return res.redirect(destination);
}

function itemFilePaths(item) {
  return [item?.media_path, item?.thumbnail_path, item?.poster_path].filter(Boolean);
}

function uploadFiles(req) {
  return {
    media: req.files?.media?.[0] || null,
    poster: req.files?.poster?.[0] || null,
  };
}

function buildAdminGalleryUrl(filters, overrides = {}) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.search) params.set('search', next.search);
  if (next.categoryId) params.set('category', String(next.categoryId));
  if (next.mediaType) params.set('type', next.mediaType);
  if (next.published) params.set('published', next.published);
  if (next.featured) params.set('featured', next.featured);
  if (next.page && next.page !== 1) params.set('page', String(next.page));
  const query = params.toString();
  return query ? `/admin/galeria?${query}` : '/admin/galeria';
}

async function listItems(req, res, next) {
  try {
    const filters = validator.parseAdminFilters(req.query);
    const [result, categories] = await Promise.all([
      gallery.listAdmin(filters),
      gallery.listCategories(),
    ]);
    res.render('pages/admin/gallery/index', {
      title: 'Galería',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-gallery.css'],
      ...result,
      filters,
      categories,
      buildAdminGalleryUrl: (overrides) => buildAdminGalleryUrl(filters, overrides),
    });
  } catch (error) {
    next(error);
  }
}

async function showCreateItem(req, res, next) {
  try {
    res.render('pages/admin/gallery/form', {
      title: 'Nuevo elemento de galería',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-gallery.css'],
      item: null,
      categories: await gallery.listCategories(),
      action: '/admin/galeria',
    });
  } catch (error) {
    next(error);
  }
}

async function createItem(req, res, next) {
  const createdPaths = [];
  try {
    const categories = await gallery.listCategories();
    const validation = validator.validateItem(req.body, categories.map((category) => Number(category.id)));
    if (!validation.valid) return redirectWithError(req, res, '/admin/galeria/nuevo', new Error(validation.error));
    const data = validation.value;
    if (await gallery.isItemSlugTaken(data.slug)) {
      return redirectWithError(req, res, '/admin/galeria/nuevo', new Error('Ya existe un elemento con ese título.'));
    }

    const files = uploadFiles(req);
    if (data.mediaType === MEDIA_TYPES.IMAGE) {
      if (!files.media) throw new Error('La imagen principal es obligatoria.');
      if (files.poster) throw new Error('Una imagen no debe incluir un póster de video.');
      const processed = await media.processImagePair(files.media);
      createdPaths.push(...processed.createdPaths);
      Object.assign(data, {
        mediaPath: processed.mediaPath,
        thumbnailPath: processed.thumbnailPath,
        posterPath: null,
      });
    } else {
      if (!files.media || !files.poster) throw new Error('El video y su póster son obligatorios.');
      const video = await media.saveVideo(files.media);
      createdPaths.push(...video.createdPaths);
      const poster = await media.processImagePair(files.poster, { poster: true });
      createdPaths.push(...poster.createdPaths);
      Object.assign(data, {
        mediaPath: video.mediaPath,
        thumbnailPath: poster.thumbnailPath,
        posterPath: poster.posterPath,
      });
    }

    if (data.isPublished) {
      await media.assertPublishable({
        title: data.title,
        alt_text: data.altText,
        media_type: data.mediaType,
        media_path: data.mediaPath,
        thumbnail_path: data.thumbnailPath,
        poster_path: data.posterPath,
      });
    }
    await gallery.createItem(data);
    req.session.success_msg = 'Elemento de galería creado correctamente.';
    return res.redirect('/admin/galeria');
  } catch (error) {
    await media.deleteAbsolutePaths(createdPaths);
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, '/admin/galeria/nuevo', error);
  }
}

async function showEditItem(req, res, next) {
  try {
    const item = await gallery.getItemById(parsePositiveId(req.params.id));
    if (!item) return redirectWithError(req, res, '/admin/galeria', new Error('Elemento de galería no encontrado.'));
    res.render('pages/admin/gallery/form', {
      title: 'Editar elemento de galería',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-gallery.css'],
      item,
      categories: await gallery.listCategories(),
      action: `/admin/galeria/${item.id}`,
    });
  } catch (error) {
    next(error);
  }
}

async function updateItem(req, res, next) {
  const createdPaths = [];
  const destination = `/admin/galeria/${req.params.id}/editar`;
  try {
    const existing = await gallery.getItemById(parsePositiveId(req.params.id));
    if (!existing) return redirectWithError(req, res, '/admin/galeria', new Error('Elemento de galería no encontrado.'));
    const categories = await gallery.listCategories();
    const validation = validator.validateItem(req.body, categories.map((category) => Number(category.id)));
    if (!validation.valid) return redirectWithError(req, res, destination, new Error(validation.error));
    const data = validation.value;
    if (await gallery.isItemSlugTaken(data.slug, existing.id)) {
      return redirectWithError(req, res, destination, new Error('Ya existe otro elemento con ese título.'));
    }

    Object.assign(data, {
      mediaPath: existing.media_path,
      thumbnailPath: existing.thumbnail_path,
      posterPath: existing.poster_path,
    });
    const files = uploadFiles(req);

    if (data.mediaType === MEDIA_TYPES.IMAGE) {
      if (files.poster) throw new Error('Una imagen no debe incluir un póster de video.');
      if (files.media) {
        const processed = await media.processImagePair(files.media);
        createdPaths.push(...processed.createdPaths);
        data.mediaPath = processed.mediaPath;
        data.thumbnailPath = processed.thumbnailPath;
        data.posterPath = null;
      } else if (existing.media_type !== MEDIA_TYPES.IMAGE) {
        throw new Error('Al cambiar de video a imagen debe cargar una imagen nueva.');
      }
    } else {
      if (files.media) {
        const video = await media.saveVideo(files.media);
        createdPaths.push(...video.createdPaths);
        data.mediaPath = video.mediaPath;
      } else if (existing.media_type !== MEDIA_TYPES.VIDEO) {
        throw new Error('Al cambiar de imagen a video debe cargar un video nuevo.');
      }
      if (files.poster) {
        const poster = await media.processImagePair(files.poster, { poster: true });
        createdPaths.push(...poster.createdPaths);
        data.posterPath = poster.posterPath;
        data.thumbnailPath = poster.thumbnailPath;
      } else if (existing.media_type !== MEDIA_TYPES.VIDEO) {
        throw new Error('Al cambiar de imagen a video debe cargar un póster.');
      }
    }

    if (data.isPublished) {
      await media.assertPublishable({
        title: data.title,
        alt_text: data.altText,
        media_type: data.mediaType,
        media_path: data.mediaPath,
        thumbnail_path: data.thumbnailPath,
        poster_path: data.posterPath,
      });
    }
    await gallery.updateItem(existing.id, data);
    const retained = new Set([data.mediaPath, data.thumbnailPath, data.posterPath].filter(Boolean));
    await media.deleteGalleryPaths(itemFilePaths(existing).filter((filePath) => !retained.has(filePath)));
    req.session.success_msg = 'Elemento de galería actualizado correctamente.';
    return res.redirect('/admin/galeria');
  } catch (error) {
    await media.deleteAbsolutePaths(createdPaths);
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, destination, error);
  }
}

async function deleteItem(req, res, next) {
  try {
    const deleted = await gallery.deleteItem(parsePositiveId(req.params.id));
    await media.deleteGalleryPaths(itemFilePaths(deleted));
    req.session.success_msg = 'Elemento de galería eliminado correctamente.';
    res.redirect('/admin/galeria');
  } catch (error) {
    if (error.message.includes('no encontrado')) return redirectWithError(req, res, '/admin/galeria', error);
    next(error);
  }
}

async function togglePublished(req, res, next) {
  try {
    const item = await gallery.getItemById(parsePositiveId(req.params.id));
    if (!item) return redirectWithError(req, res, '/admin/galeria', new Error('Elemento de galería no encontrado.'));
    const publish = !Boolean(item.is_published);
    if (publish) await media.assertPublishable(item);
    await gallery.setPublished(item.id, publish);
    req.session.success_msg = publish ? 'Elemento publicado.' : 'Elemento retirado de la galería pública.';
    res.redirect('/admin/galeria');
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, '/admin/galeria', error);
  }
}

async function toggleFeatured(req, res, next) {
  try {
    const item = await gallery.getItemById(parsePositiveId(req.params.id));
    if (!item) return redirectWithError(req, res, '/admin/galeria', new Error('Elemento de galería no encontrado.'));
    await gallery.setFeatured(item.id, !Boolean(item.is_featured));
    req.session.success_msg = item.is_featured ? 'Elemento retirado de destacados.' : 'Elemento destacado.';
    res.redirect('/admin/galeria');
  } catch (error) {
    next(error);
  }
}

async function listCategories(req, res, next) {
  try {
    res.render('pages/admin/gallery/categories', {
      title: 'Categorías de galería',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-gallery.css'],
      categories: await gallery.listCategories(),
    });
  } catch (error) {
    next(error);
  }
}

async function createCategory(req, res, next) {
  try {
    const validation = validator.validateCategory(req.body);
    if (!validation.valid) return redirectWithError(req, res, '/admin/galeria/categorias', new Error(validation.error));
    if (await gallery.isCategorySlugTaken(validation.value.slug)) {
      return redirectWithError(req, res, '/admin/galeria/categorias', new Error('Ya existe una categoría con ese nombre.'));
    }
    await gallery.createCategory(validation.value);
    req.session.success_msg = 'Categoría de galería creada.';
    res.redirect('/admin/galeria/categorias');
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, '/admin/galeria/categorias', error);
  }
}

async function updateCategory(req, res, next) {
  try {
    const category = await gallery.getCategoryById(parsePositiveId(req.params.id));
    if (!category) return redirectWithError(req, res, '/admin/galeria/categorias', new Error('Categoría no encontrada.'));
    const validation = validator.validateCategory(req.body);
    if (!validation.valid) return redirectWithError(req, res, '/admin/galeria/categorias', new Error(validation.error));
    if (await gallery.isCategorySlugTaken(validation.value.slug, category.id)) {
      return redirectWithError(req, res, '/admin/galeria/categorias', new Error('Ya existe otra categoría con ese nombre.'));
    }
    await gallery.updateCategory(category.id, validation.value);
    req.session.success_msg = 'Categoría de galería actualizada.';
    res.redirect('/admin/galeria/categorias');
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, '/admin/galeria/categorias', error);
  }
}

async function deleteCategory(req, res, next) {
  try {
    await gallery.deleteCategory(parsePositiveId(req.params.id));
    req.session.success_msg = 'Categoría de galería eliminada.';
    res.redirect('/admin/galeria/categorias');
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, '/admin/galeria/categorias', error);
  }
}

module.exports = {
  buildAdminGalleryUrl,
  listItems,
  showCreateItem,
  createItem,
  showEditItem,
  updateItem,
  deleteItem,
  togglePublished,
  toggleFeatured,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
