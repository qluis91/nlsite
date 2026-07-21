const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { isAuthenticated, isAdmin } = require('../middlewares/authMiddleware');

// Middleware: todas las rutas de admin requieren autenticación + rol admin
router.use(isAuthenticated, isAdmin);

// Dashboard
router.get('/', adminController.dashboard);

// ── CRUD de Usuarios ──

// GET  - Listar usuarios
router.get('/users', adminController.listUsers);

// GET  - Formulario crear usuario
router.get('/users/create', adminController.showCreateUser);

// POST - Crear usuario
router.post('/users/create', adminController.createUser);

// GET  - Formulario editar usuario
router.get('/users/:id/edit', adminController.showEditUser);

// POST - Actualizar usuario
router.post('/users/:id/edit', adminController.updateUser);

// POST - Eliminar usuario
router.post('/users/:id/delete', adminController.deleteUser);

// POST - Activar / Desactivar usuario
router.post('/users/:id/toggle', adminController.toggleUserStatus);

module.exports = router;
