const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/guestOrderController');

const router = express.Router();
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 7,
  standardHeaders: true,
  legacyHeaders: false,
  handler: controller.rateLimitExceeded,
});

router.get('/', controller.showLookup);
router.post('/', lookupLimiter, controller.lookup);
router.get('/:reference', controller.detail);

module.exports = router;
