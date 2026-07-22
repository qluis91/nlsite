const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

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

// POST - Activar / Desactivar usuario
router.post('/users/:id/toggle', adminController.toggleUserStatus);

// POST - Eliminar usuario
router.post('/users/:id/delete', adminController.deleteUser);

module.exports = router;
