const express = require('express');
const controller = require('../controllers/adminGalleryController');
const { galleryUpload } = require('../middleware/galleryUpload');
const { csrfSynchronisedProtection } = require('../config/csrf');

const router = express.Router();

router.get('/galeria', controller.listItems);
router.get('/galeria/nuevo', controller.showCreateItem);
router.post('/galeria', galleryUpload, csrfSynchronisedProtection, controller.createItem);
router.get('/galeria/categorias', controller.listCategories);
router.post('/galeria/categorias', csrfSynchronisedProtection, controller.createCategory);
router.post('/galeria/categorias/:id', csrfSynchronisedProtection, controller.updateCategory);
router.post('/galeria/categorias/:id/eliminar', csrfSynchronisedProtection, controller.deleteCategory);
router.get('/galeria/:id/editar', controller.showEditItem);
router.post('/galeria/:id', galleryUpload, csrfSynchronisedProtection, controller.updateItem);
router.post('/galeria/:id/eliminar', csrfSynchronisedProtection, controller.deleteItem);
router.post('/galeria/:id/publicar', csrfSynchronisedProtection, controller.togglePublished);
router.post('/galeria/:id/destacar', csrfSynchronisedProtection, controller.toggleFeatured);

module.exports = router;
