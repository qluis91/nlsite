const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminCatalogController');
const { productImageUpload, categoryHeroUpload } = require('../middleware/upload');
const { csrfSynchronisedProtection } = require('../config/csrf');

// ══════════════════════════════════════
//  CATEGORIES (multipart for optional hero image)
// ══════════════════════════════════════

router.get('/catalogo/categorias', ctrl.listCategories);
router.get('/catalogo/categorias/nueva', ctrl.showCreateCategory);
router.post('/catalogo/categorias', categoryHeroUpload, csrfSynchronisedProtection, ctrl.createCategory);
router.get('/catalogo/categorias/:id/editar', ctrl.showEditCategory);
router.post('/catalogo/categorias/:id', categoryHeroUpload, csrfSynchronisedProtection, ctrl.updateCategory);
router.post('/catalogo/categorias/:id/eliminar', csrfSynchronisedProtection, ctrl.deleteCategory);

// ══════════════════════════════════════
//  PRODUCTS (multipart on create/update)
// ══════════════════════════════════════

router.get('/catalogo/productos', ctrl.listProducts);
router.get('/catalogo/productos/nuevo', ctrl.showCreateProduct);
// Multipart: multer parses body first, then CSRF validates
router.post('/catalogo/productos', productImageUpload, csrfSynchronisedProtection, ctrl.createProduct);
router.get('/catalogo/productos/:id/editar', ctrl.showEditProduct);
// Multipart: multer parses body first, then CSRF validates
router.post('/catalogo/productos/:id', productImageUpload, csrfSynchronisedProtection, ctrl.updateProduct);
router.post('/catalogo/productos/:id/eliminar', csrfSynchronisedProtection, ctrl.deleteProduct);

// ══════════════════════════════════════
//  IMAGE ACTIONS
// ══════════════════════════════════════

router.post('/catalogo/productos/:id/imagenes/:imageId/eliminar', csrfSynchronisedProtection, ctrl.deleteImage);
router.post('/catalogo/productos/:id/imagenes/:imageId/principal', csrfSynchronisedProtection, ctrl.setPrimary);
router.post('/catalogo/productos/:id/imagenes/reordenar', csrfSynchronisedProtection, ctrl.reorderImages);

module.exports = router;
