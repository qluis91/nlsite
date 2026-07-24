/**
 * Admin catalog controller — Categories, Products, Images.
 */
const path = require('path');
const pool = require('../config/db');
const catalog = require('../services/adminCatalogService');
const imgProc = require('../services/imageProcessingService');
const v = require('../validators/catalogValidator');

// ══════════════════════════════════════
//  CATEGORIES
// ══════════════════════════════════════

exports.listCategories = async (req, res, next) => {
  try {
    const categories = await catalog.listCategories();
    res.render('pages/admin/categories', {
      title: 'Categorías',
      layout: 'layouts/admin',
      categories,
    });
  } catch (err) { next(err); }
};

exports.showCreateCategory = (req, res) => {
  res.render('pages/admin/category-form', {
    title: 'Nueva Categoría',
    layout: 'layouts/admin',
    category: null,
    action: '/admin/catalogo/categorias',
  });
};

exports.createCategory = async (req, res, next) => {
  try {
    const nameResult = v.validateCategoryName(req.body.name);
    if (!nameResult.valid) {
      req.session.error_msg = nameResult.error;
      return res.redirect('/admin/catalogo/categorias/nueva');
    }
    const descResult = v.validateCategoryDescription(req.body.description);
    const heroTitle = v.validateHeroTitle(req.body.hero_title);
    const heroDesc = v.validateHeroDescription(req.body.hero_description);
    const heroAlt = v.validateHeroAlt(req.body.hero_alt);
    const heroPos = v.validateHeroPosition(req.body.hero_position);
    for (const result of [descResult, heroTitle, heroDesc, heroAlt, heroPos]) {
      if (!result.valid) {
        req.session.error_msg = result.error;
        return res.redirect('/admin/catalogo/categorias/nueva');
      }
    }

    const slug = v.slugify(nameResult.value);
    const taken = await catalog.isCategorySlugTaken(slug);
    if (taken) {
      req.session.error_msg = 'Ya existe una categoría con ese nombre.';
      return res.redirect('/admin/catalogo/categorias/nueva');
    }

    const created = await catalog.createCategory(nameResult.value, slug, {
      description: descResult.value,
      hero_title: heroTitle.value,
      hero_description: heroDesc.value,
      hero_image: null,
      hero_alt: heroAlt.value,
      hero_position: heroPos.value,
    });

    if (req.file) {
      try {
        const { dir, urlPrefix } = imgProc.categoryStoragePath(created.id);
        const result = await imgProc.processImage(req.file, dir, imgProc.PROFILES.category);
        const heroImage = urlPrefix + result.fileName;
        await catalog.updateCategory(created.id, nameResult.value, slug, {
          description: descResult.value,
          hero_title: heroTitle.value,
          hero_description: heroDesc.value,
          hero_image: heroImage,
          hero_alt: heroAlt.value,
          hero_position: heroPos.value,
        });
      } catch (imgErr) {
        req.session.error_msg = imgErr.message || 'No se pudo procesar la imagen del hero.';
        return res.redirect(`/admin/catalogo/categorias/${created.id}/editar`);
      }
    }

    req.session.success_msg = 'Categoría creada exitosamente.';
    res.redirect('/admin/catalogo/categorias');
  } catch (err) { next(err); }
};

exports.showEditCategory = async (req, res, next) => {
  try {
    const cat = await catalog.getCategoryById(req.params.id);
    if (!cat) {
      req.session.error_msg = 'Categoría no encontrada.';
      return res.redirect('/admin/catalogo/categorias');
    }
    res.render('pages/admin/category-form', {
      title: 'Editar Categoría',
      layout: 'layouts/admin',
      category: cat,
      action: `/admin/catalogo/categorias/${cat.id}`,
    });
  } catch (err) { next(err); }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const cat = await catalog.getCategoryById(req.params.id);
    if (!cat) {
      req.session.error_msg = 'Categoría no encontrada.';
      return res.redirect('/admin/catalogo/categorias');
    }
    const nameResult = v.validateCategoryName(req.body.name);
    if (!nameResult.valid) {
      req.session.error_msg = nameResult.error;
      return res.redirect(`/admin/catalogo/categorias/${cat.id}/editar`);
    }
    const descResult = v.validateCategoryDescription(req.body.description);
    const heroTitle = v.validateHeroTitle(req.body.hero_title);
    const heroDesc = v.validateHeroDescription(req.body.hero_description);
    const heroAlt = v.validateHeroAlt(req.body.hero_alt);
    const heroPos = v.validateHeroPosition(req.body.hero_position);
    for (const result of [descResult, heroTitle, heroDesc, heroAlt, heroPos]) {
      if (!result.valid) {
        req.session.error_msg = result.error;
        return res.redirect(`/admin/catalogo/categorias/${cat.id}/editar`);
      }
    }

    const slug = v.slugify(nameResult.value);
    const taken = await catalog.isCategorySlugTaken(slug, cat.id);
    if (taken) {
      req.session.error_msg = 'Ya existe otra categoría con ese nombre.';
      return res.redirect(`/admin/catalogo/categorias/${cat.id}/editar`);
    }

    let heroImage = cat.hero_image || null;
    const removeHero = req.body.remove_hero_image === '1';

    if (removeHero && heroImage) {
      const abs = path.join(imgProc.UPLOAD_ROOT, heroImage.replace(/^\/uploads\//, ''));
      await imgProc.deleteProcessedImage(abs);
      heroImage = null;
    }

    if (req.file) {
      try {
        const { dir, urlPrefix } = imgProc.categoryStoragePath(cat.id);
        const result = await imgProc.processImage(req.file, dir, imgProc.PROFILES.category);
        if (heroImage) {
          const abs = path.join(imgProc.UPLOAD_ROOT, heroImage.replace(/^\/uploads\//, ''));
          await imgProc.deleteProcessedImage(abs);
        }
        heroImage = urlPrefix + result.fileName;
      } catch (imgErr) {
        req.session.error_msg = imgErr.message || 'No se pudo procesar la imagen del hero.';
        return res.redirect(`/admin/catalogo/categorias/${cat.id}/editar`);
      }
    }

    await catalog.updateCategory(cat.id, nameResult.value, slug, {
      description: descResult.value,
      hero_title: heroTitle.value,
      hero_description: heroDesc.value,
      hero_image: heroImage,
      hero_alt: heroAlt.value,
      hero_position: heroPos.value,
    });
    req.session.success_msg = 'Categoría actualizada exitosamente.';
    res.redirect('/admin/catalogo/categorias');
  } catch (err) { next(err); }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    await catalog.deleteCategory(req.params.id);
    req.session.success_msg = 'Categoría eliminada exitosamente.';
    res.redirect('/admin/catalogo/categorias');
  } catch (err) {
    if (err.message.includes('productos asociados')) {
      req.session.error_msg = err.message;
      return res.redirect('/admin/catalogo/categorias');
    }
    next(err);
  }
};

// ══════════════════════════════════════
//  PRODUCTS
// ══════════════════════════════════════

exports.listProducts = async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const categoryId = String(req.query.category || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const result = await catalog.listProducts(search, categoryId, page, 20);
    const categories = await catalog.listCategories();

    res.render('pages/admin/products', {
      title: 'Productos',
      layout: 'layouts/admin',
      products: result.products,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      search,
      categoryFilter: categoryId,
      categories,
    });
  } catch (err) { next(err); }
};

exports.showCreateProduct = async (req, res, next) => {
  try {
    const categories = await catalog.listCategories();
    res.render('pages/admin/product-form', {
      title: 'Nuevo Producto',
      layout: 'layouts/admin',
      product: null,
      categories,
      action: '/admin/catalogo/productos',
    });
  } catch (err) { next(err); }
};

exports.createProduct = async (req, res, next) => {
  try {
    const categories = await catalog.listCategories();
    const availableIds = categories.map(c => c.id);

    // Validate fields
    const nameResult = v.validateProductName(req.body.name);
    if (!nameResult.valid) {
      req.session.error_msg = nameResult.error;
      return res.redirect('/admin/catalogo/productos/nuevo');
    }

    const catResult = v.validateCategoryIds(req.body.categoryIds, availableIds);
    if (!catResult.valid) {
      req.session.error_msg = catResult.error;
      return res.redirect('/admin/catalogo/productos/nuevo');
    }

    const regularPrice = v.validatePrice(req.body.regularPrice, 'Precio regular');
    if (!regularPrice.valid) { req.session.error_msg = regularPrice.error; return res.redirect('/admin/catalogo/productos/nuevo'); }

    const promotionalPrice = v.validatePrice(req.body.promotionalPrice, 'Precio promocional');
    const webPrice = v.validatePrice(req.body.webPrice, 'Precio web');
    const stockResult = v.validateStock(req.body.stockQuantity);
    const weightResult = v.validateWeight(req.body.weight);
    const descResult = v.validateDescription(req.body.description);
    const tagsResult = v.validateTags(req.body.tags);

    // Validate image count
    const newImageCount = ((req.files?.primaryImage?.length || 0) + (req.files?.secondaryImages?.length || 0));
    if (newImageCount > v.MAX_IMAGES) {
      req.session.error_msg = `Máximo ${v.MAX_IMAGES} imágenes por producto.`;
      return res.redirect('/admin/catalogo/productos/nuevo');
    }

    const slug = v.slugify(nameResult.value);
    const [existing] = await pool.query('SELECT id FROM products WHERE slug = ?', [slug]);
    if (existing.length) {
      req.session.error_msg = 'Ya existe un producto con ese nombre.';
      return res.redirect('/admin/catalogo/productos/nuevo');
    }

    // Create product
    const productId = await catalog.createProduct({
      name: nameResult.value, slug,
      regularPrice: regularPrice.value ?? 0,
      promotionalPrice: promotionalPrice.value,
      webPrice: webPrice.value,
      weight: weightResult.value,
      stockQuantity: stockResult.value,
      description: descResult.value,
      tags: tagsResult.value,
      isActive: true,
      isPublished: req.body.isPublished === '1',
      categoryIds: catResult.value,
    });

    // Process images
    const { dir, urlPrefix } = imgProc.productStoragePath(productId);
    const processedFiles = [];

    try {
      // Primary image
      if (req.files?.primaryImage?.length) {
        const result = await imgProc.processImage(req.files.primaryImage[0], dir, imgProc.PROFILES.product);
        await catalog.addProductImage(productId, {
          filePath: urlPrefix + result.fileName,
          fileName: result.fileName,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          sizeBytes: result.sizeBytes,
          isPrimary: true,
        });
        processedFiles.push(result);
      }

      // Secondary images
      if (req.files?.secondaryImages?.length) {
        for (const file of req.files.secondaryImages) {
          const result = await imgProc.processImage(file, dir, imgProc.PROFILES.product);
          await catalog.addProductImage(productId, {
            filePath: urlPrefix + result.fileName,
            fileName: result.fileName,
            mimeType: result.mimeType,
            width: result.width,
            height: result.height,
            sizeBytes: result.sizeBytes,
            isPrimary: !processedFiles.length, // first image becomes primary if no primary was set
          });
          processedFiles.push(result);
        }
      }

      // If no primary was explicitly set, promote first image
      if (!req.files?.primaryImage?.length && req.files?.secondaryImages?.length) {
        await catalog.ensurePrimaryImage(productId);
      }

    } catch (imgErr) {
      // Rollback: delete processed files and the product
      await imgProc.cleanTempFiles(processedFiles);
      await catalog.deleteProduct(productId);
      throw imgErr;
    }

    req.session.success_msg = 'Producto creado exitosamente.';
    res.redirect('/admin/catalogo/productos');
  } catch (err) { next(err); }
};

exports.showEditProduct = async (req, res, next) => {
  try {
    const product = await catalog.getProductById(req.params.id);
    if (!product) {
      req.session.error_msg = 'Producto no encontrado.';
      return res.redirect('/admin/catalogo/productos');
    }
    const categories = await catalog.listCategories();
    res.render('pages/admin/product-form', {
      title: 'Editar Producto',
      layout: 'layouts/admin',
      product,
      categories,
      action: `/admin/catalogo/productos/${product.id}`,
    });
  } catch (err) { next(err); }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const product = await catalog.getProductById(req.params.id);
    if (!product) {
      req.session.error_msg = 'Producto no encontrado.';
      return res.redirect('/admin/catalogo/productos');
    }

    const categories = await catalog.listCategories();
    const availableIds = categories.map(c => c.id);

    const nameResult = v.validateProductName(req.body.name);
    if (!nameResult.valid) {
      req.session.error_msg = nameResult.error;
      return res.redirect(`/admin/catalogo/productos/${product.id}/editar`);
    }

    const catResult = v.validateCategoryIds(req.body.categoryIds, availableIds);
    if (!catResult.valid) {
      req.session.error_msg = catResult.error;
      return res.redirect(`/admin/catalogo/productos/${product.id}/editar`);
    }

    const regularPrice = v.validatePrice(req.body.regularPrice, 'Precio regular');
    const promotionalPrice = v.validatePrice(req.body.promotionalPrice, 'Precio promocional');
    const webPrice = v.validatePrice(req.body.webPrice, 'Precio web');
    const stockResult = v.validateStock(req.body.stockQuantity);
    const weightResult = v.validateWeight(req.body.weight);
    const descResult = v.validateDescription(req.body.description);
    const tagsResult = v.validateTags(req.body.tags);

    // Validate image count
    const removeIds = Array.isArray(req.body.removeImageIds) ? req.body.removeImageIds : (req.body.removeImageIds ? [req.body.removeImageIds] : []);
    const newImageCount = ((req.files?.primaryImage?.length || 0) + (req.files?.secondaryImages?.length || 0));
    const countResult = v.validateImageCount(product.images.length, removeIds, newImageCount);
    if (!countResult.valid) {
      req.session.error_msg = countResult.error;
      return res.redirect(`/admin/catalogo/productos/${product.id}/editar`);
    }

    const slug = v.slugify(nameResult.value);
    const [existing] = await pool.query('SELECT id FROM products WHERE slug = ? AND id != ?', [slug, product.id]);
    if (existing.length) {
      req.session.error_msg = 'Ya existe un producto con ese nombre.';
      return res.redirect(`/admin/catalogo/productos/${product.id}/editar`);
    }

    // Update product data
    await catalog.updateProduct(product.id, {
      name: nameResult.value, slug,
      regularPrice: regularPrice.value ?? 0,
      promotionalPrice: promotionalPrice.value,
      webPrice: webPrice.value,
      weight: weightResult.value,
      stockQuantity: stockResult.value,
      description: descResult.value,
      tags: tagsResult.value,
      isActive: req.body.isActive === '1',
      isPublished: req.body.isPublished === '1',
      categoryIds: catResult.value,
    });

    // Remove selected images
    const { dir, urlPrefix } = imgProc.productStoragePath(product.id);
    const removedPaths = [];
    if (removeIds.length) {
      for (const imgId of removeIds) {
        const id = parseInt(imgId, 10);
        if (!Number.isSafeInteger(id)) continue;
        const filePath = await catalog.removeProductImage(id, product.id);
        if (filePath) {
          const absPath = path.join(imgProc.UPLOAD_ROOT, 'products', String(product.id), path.basename(filePath));
          removedPaths.push(absPath);
        }
      }
    }

    // Process new images
    const processedFiles = [];
    try {
      const hasPrimary = await catalog.countProductImages(product.id) > 0
        ? (await pool.query('SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1', [product.id]))[0].length > 0
        : false;

      if (req.files?.primaryImage?.length) {
        const result = await imgProc.processImage(req.files.primaryImage[0], dir, imgProc.PROFILES.product);
        await catalog.addProductImage(product.id, {
          filePath: urlPrefix + result.fileName,
          fileName: result.fileName,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          sizeBytes: result.sizeBytes,
          isPrimary: true,
        });
        processedFiles.push(result);
      }

      if (req.files?.secondaryImages?.length) {
        for (const file of req.files.secondaryImages) {
          const result = await imgProc.processImage(file, dir, imgProc.PROFILES.product);
          await catalog.addProductImage(product.id, {
            filePath: urlPrefix + result.fileName,
            fileName: result.fileName,
            mimeType: result.mimeType,
            width: result.width,
            height: result.height,
            sizeBytes: result.sizeBytes,
            isPrimary: !hasPrimary && !processedFiles.length,
          });
          processedFiles.push(result);
        }
      }

      await catalog.ensurePrimaryImage(product.id);

      // Delete old files after successful DB update
      for (const p of removedPaths) {
        await imgProc.deleteProcessedImage(p);
      }

    } catch (imgErr) {
      await imgProc.cleanTempFiles(processedFiles);
      throw imgErr;
    }

    req.session.success_msg = 'Producto actualizado exitosamente.';
    res.redirect('/admin/catalogo/productos');
  } catch (err) { next(err); }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await catalog.getProductById(req.params.id);
    if (!product) {
      req.session.error_msg = 'Producto no encontrado.';
      return res.redirect('/admin/catalogo/productos');
    }

    const result = await catalog.deleteProduct(product.id);

    if (result.action === 'archived') {
      // Keep image files for archived products
      req.session.success_msg = 'El producto fue desactivado porque tiene referencias históricas. Ya no aparece en la tienda pública.';
    } else {
      // Delete image files only for fully deleted products
      if (product.images && product.images.length) {
        for (const img of product.images) {
          const absPath = path.join(imgProc.UPLOAD_ROOT, 'products', String(product.id), path.basename(img.file_path));
          await imgProc.deleteProcessedImage(absPath);
        }
      }
      req.session.success_msg = 'Producto eliminado correctamente.';
    }
    res.redirect('/admin/catalogo/productos');
  } catch (err) { next(err); }
};

// ══════════════════════════════════════
//  IMAGE ACTIONS
// ══════════════════════════════════════

exports.deleteImage = async (req, res, next) => {
  try {
    const { id: productId, imageId } = req.params;
    const filePath = await catalog.removeProductImage(parseInt(imageId), parseInt(productId));
    if (filePath) {
      const absPath = path.join(imgProc.UPLOAD_ROOT, 'products', String(productId), path.basename(filePath));
      await imgProc.deleteProcessedImage(absPath);
      await catalog.ensurePrimaryImage(productId);
    }
    req.session.success_msg = 'Imagen eliminada.';
    res.redirect(`/admin/catalogo/productos/${productId}/editar`);
  } catch (err) { next(err); }
};

exports.setPrimary = async (req, res, next) => {
  try {
    const { id: productId, imageId } = req.params;
    await catalog.setPrimaryImage(parseInt(imageId), parseInt(productId));
    req.session.success_msg = 'Imagen principal actualizada.';
    res.redirect(`/admin/catalogo/productos/${productId}/editar`);
  } catch (err) { next(err); }
};

exports.reorderImages = async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id);
    const orderedIds = (Array.isArray(req.body.imageOrder) ? req.body.imageOrder : [req.body.imageOrder])
      .map(id => parseInt(id, 10))
      .filter(id => Number.isSafeInteger(id));
    if (orderedIds.length) {
      await catalog.reorderImages(productId, orderedIds);
    }
    req.session.success_msg = 'Orden actualizado.';
    res.redirect(`/admin/catalogo/productos/${productId}/editar`);
  } catch (err) { next(err); }
};
