/**
 * Panel 2 & Panel 3 admin routes — Phase 11C.
 * Mounted under /admin behind isAuthenticated + isAdmin in app.js.
 */
const express = require('express');
const controller = require('../controllers/adminPanelsController');
const { csrfSynchronisedProtection } = require('../config/csrf');
const { requireCapability } = require('../middlewares/capabilityMiddleware');
const { CAPABILITIES } = require('../config/capabilities');

const router = express.Router();

// ── Panel 2 (Showcase) ──
router.get('/page/home/panel-2', requireCapability(CAPABILITIES.SHOWCASE_VIEW), controller.showPanel2);
router.post('/page/home/panel-2/draft', requireCapability(CAPABILITIES.SHOWCASE_EDIT), csrfSynchronisedProtection, controller.savePanel2Draft);
router.post('/page/home/panel-2/publish', requireCapability(CAPABILITIES.SHOWCASE_PUBLISH), csrfSynchronisedProtection, controller.publishPanel2);

// LogoLoop items
router.post('/page/home/panel-2/logo-loop/items', requireCapability(CAPABILITIES.LOGOLOOP_EDIT), csrfSynchronisedProtection, controller.createLogoLoopItem);
router.post('/page/home/panel-2/logo-loop/items/save', requireCapability(CAPABILITIES.LOGOLOOP_EDIT), csrfSynchronisedProtection, controller.saveLogoLoopItem);
router.post('/page/home/panel-2/logo-loop/items/save-publish', requireCapability(CAPABILITIES.LOGOLOOP_EDIT), requireCapability(CAPABILITIES.LOGOLOOP_PUBLISH), csrfSynchronisedProtection, controller.saveAndPublishLogoLoopItem);
router.post('/page/home/panel-2/logo-loop/items/reorder', requireCapability(CAPABILITIES.LOGOLOOP_EDIT), csrfSynchronisedProtection, controller.reorderLogoLoopItems);
router.post('/page/home/panel-2/logo-loop/items/archive', requireCapability(CAPABILITIES.LOGOLOOP_EDIT), csrfSynchronisedProtection, controller.archiveLogoLoopItem);
router.post('/page/home/panel-2/logo-loop/items/publish', requireCapability(CAPABILITIES.LOGOLOOP_PUBLISH), csrfSynchronisedProtection, controller.publishLogoLoop);

// Carousel items
router.post('/page/home/panel-2/carousel/items', requireCapability(CAPABILITIES.CAROUSEL_EDIT), csrfSynchronisedProtection, controller.createCarouselItem);
router.post('/page/home/panel-2/carousel/items/save', requireCapability(CAPABILITIES.CAROUSEL_EDIT), csrfSynchronisedProtection, controller.saveCarouselItem);
router.post('/page/home/panel-2/carousel/items/save-publish', requireCapability(CAPABILITIES.CAROUSEL_EDIT), requireCapability(CAPABILITIES.CAROUSEL_PUBLISH), csrfSynchronisedProtection, controller.saveAndPublishCarouselItem);
router.post('/page/home/panel-2/carousel/items/reorder', requireCapability(CAPABILITIES.CAROUSEL_EDIT), csrfSynchronisedProtection, controller.reorderCarouselItems);
router.post('/page/home/panel-2/carousel/items/archive', requireCapability(CAPABILITIES.CAROUSEL_EDIT), csrfSynchronisedProtection, controller.archiveCarouselItem);
router.post('/page/home/panel-2/carousel/items/publish', requireCapability(CAPABILITIES.CAROUSEL_PUBLISH), csrfSynchronisedProtection, controller.publishCarousel);

// ── Panel 3 (Services) ──
router.get('/page/home/panel-3', requireCapability(CAPABILITIES.SERVICES_VIEW), controller.showPanel3);
router.post('/page/home/panel-3/draft', requireCapability(CAPABILITIES.SERVICES_EDIT), csrfSynchronisedProtection, controller.savePanel3Draft);
router.post('/page/home/panel-3/publish', requireCapability(CAPABILITIES.SERVICES_PUBLISH), csrfSynchronisedProtection, controller.publishPanel3);

// Feature items
router.post('/page/home/panel-3/items', requireCapability(CAPABILITIES.SERVICES_EDIT), csrfSynchronisedProtection, controller.createFeatureItem);
router.post('/page/home/panel-3/items/save', requireCapability(CAPABILITIES.SERVICES_EDIT), csrfSynchronisedProtection, controller.saveFeatureItem);
router.post('/page/home/panel-3/items/save-publish', requireCapability(CAPABILITIES.SERVICES_EDIT), requireCapability(CAPABILITIES.SERVICES_PUBLISH), csrfSynchronisedProtection, controller.saveAndPublishFeatureItem);
router.post('/page/home/panel-3/items/reorder', requireCapability(CAPABILITIES.SERVICES_EDIT), csrfSynchronisedProtection, controller.reorderFeatureItems);
router.post('/page/home/panel-3/items/archive', requireCapability(CAPABILITIES.SERVICES_EDIT), csrfSynchronisedProtection, controller.archiveFeatureItem);
router.post('/page/home/panel-3/items/publish', requireCapability(CAPABILITIES.SERVICES_PUBLISH), csrfSynchronisedProtection, controller.publishFeatureItems);

module.exports = router;
