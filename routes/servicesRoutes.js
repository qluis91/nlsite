'use strict';

const express = require('express');
const controller = require('../controllers/servicesController');

const router = express.Router();
router.get('/soluciones-digitales', controller.showDigitalSolutions);
router.get('/fabricacion-3d', controller.showFabricacion3d);

module.exports = router;
