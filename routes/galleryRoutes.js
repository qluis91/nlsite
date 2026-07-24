const express = require('express');
const controller = require('../controllers/galleryController');

const router = express.Router();
router.get('/', controller.showGallery);

module.exports = router;
