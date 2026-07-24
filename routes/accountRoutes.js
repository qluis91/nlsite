const express = require('express');
const accountController = require('../controllers/accountController');
const addressController = require('../controllers/addressController');
const accountOrderRoutes = require('./accountOrderRoutes');

const router = express.Router();

router.get('/', accountController.dashboard);
router.get('/perfil', accountController.showProfile);
router.post('/perfil', accountController.updateProfile);
router.post('/avatar/eliminar', accountController.removeAvatar);
router.get('/direcciones', addressController.list);
router.get('/direcciones/nueva', addressController.showCreate);
router.post('/direcciones/nueva', addressController.create);
router.get('/direcciones/:id/editar', addressController.showEdit);
router.post('/direcciones/:id/editar', addressController.update);
router.post('/direcciones/:id/predeterminada', addressController.setDefault);
router.post('/direcciones/:id/eliminar', addressController.remove);
router.get('/seguridad', accountController.showSecurity);
router.post('/seguridad/contrasena', accountController.changePassword);

// Static account sections are declared before the order detail parameter.
router.use(accountOrderRoutes);

module.exports = router;
