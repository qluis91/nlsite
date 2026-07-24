/**
 * Tilopay webhook/notification route — no session, no CSRF.
 * Mounted with: app.use('/webhooks', tilopayWebhookRoutes)
 *
 * ⚠️ NOTIFICATION MODEL (2026-07-23):
 * Tilopay webhook signature mechanism is not publicly documented.
 * Until confirmed from the Tilopay merchant portal:
 *
 *   1. Accept JSON notifications at POST /webhooks/tilopay
 *   2. Extract provider/internal reference from the body
 *   3. Perform authenticated server-to-server status lookup
 *   4. Use the lookup result — not the notification body — as authoritative
 *
 *   This route uses express.json() with bounded body size.
 *   If Tilopay later documents signature verification requiring raw bytes,
 *   switch to express.raw() and add the documented verification.
 */
const express = require('express');
const ctrl = require('../controllers/tilopayController');

const router = express.Router();

// Bounded JSON body — no session, no CSRF, provider-level auth via server lookup
router.use(express.json({ limit: '64kb' }));
router.post('/tilopay', ctrl.handleWebhook);

module.exports = router;
