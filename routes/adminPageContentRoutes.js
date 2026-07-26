/**
 * Navbar & Panel 1 admin routes — Phase 11B.
 * Mounted under /admin behind isAuthenticated + isAdmin in app.js.
 */
const express = require('express');
const controller = require('../controllers/adminPageContentController');
const { csrfSynchronisedProtection } = require('../config/csrf');
const { requireCapability } = require('../middlewares/capabilityMiddleware');
const { CAPABILITIES } = require('../config/capabilities');

const router = express.Router();

// ── Navbar ──
router.get('/page/navbar', requireCapability(CAPABILITIES.NAVBAR_VIEW), controller.showNavbar);
router.post('/page/navbar/save', requireCapability(CAPABILITIES.NAVBAR_EDIT), csrfSynchronisedProtection, controller.saveNavbarSettings);
router.post('/page/navbar/publish', requireCapability(CAPABILITIES.NAVBAR_PUBLISH), csrfSynchronisedProtection, controller.publishNavbar);

router.post('/page/navbar/items', requireCapability(CAPABILITIES.NAVBAR_EDIT), csrfSynchronisedProtection, controller.createNavItem);
router.post('/page/navbar/items/save', requireCapability(CAPABILITIES.NAVBAR_EDIT), csrfSynchronisedProtection, controller.saveNavItem);
router.post('/page/navbar/items/archive', requireCapability(CAPABILITIES.NAVBAR_EDIT), csrfSynchronisedProtection, controller.archiveNavItem);
router.post('/page/navbar/items/reorder', requireCapability(CAPABILITIES.NAVBAR_EDIT), csrfSynchronisedProtection, controller.reorderNavItems);

// ── Panel 1 (Hero) ──
router.get('/page/home/panel-1', requireCapability(CAPABILITIES.HERO_VIEW), controller.showPanel1);
router.post('/page/home/panel-1/save', requireCapability(CAPABILITIES.HERO_EDIT), csrfSynchronisedProtection, controller.savePanel1Draft);
router.post('/page/home/panel-1/publish', requireCapability(CAPABILITIES.HERO_PUBLISH), csrfSynchronisedProtection, controller.publishPanel1);

// ── Preview ──
router.get('/page/preview', requireCapability(CAPABILITIES.PAGE_MANAGE), controller.preview);

module.exports = router;
