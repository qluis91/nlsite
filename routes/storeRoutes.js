const express = require('express');
const storeController = require('../controllers/storeController');

const router = express.Router();

router.get('/', storeController.showStore);
router.get('/:slug', storeController.showProduct);

module.exports = router;
