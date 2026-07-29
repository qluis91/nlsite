const express = require('express');
const controller = require('../controllers/aboutController');

const router = express.Router();
router.get('/', controller.showAbout);

module.exports = router;
