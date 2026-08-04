const express = require('express');
const controller = require('../controllers/legalController');

const router = express.Router();

router.get('/privacidad', controller.showPrivacy);
router.get('/terminos', controller.showTerms);
router.get('/eliminacion-de-datos', controller.showDataDeletion);

module.exports = router;
