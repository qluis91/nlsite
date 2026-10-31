const express = require('express');
const controller = require('../controllers/materialsController');

const router = express.Router();
router.get('/', controller.showMaterials);

module.exports = router;
