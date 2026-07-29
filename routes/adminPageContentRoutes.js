/**
 * Navbar & Panel 1 admin routes — Phase 11B.
 * Global Settings & SEO routes — Phase 12A.
 * Mounted under /admin behind isAuthenticated + isAdmin in app.js.
 */
const express = require('express');
const controller = require('../controllers/adminPageContentController');
const globalSettingsController = require('../controllers/adminGlobalSettingsController');
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
router.post(
  '/page/home/panel-1/save',
  controller.panel1SaveDiagnostics,
  requireCapability(CAPABILITIES.HERO_EDIT),
  csrfSynchronisedProtection,
  controller.savePanel1Draft
);
router.post('/page/home/panel-1/publish', requireCapability(CAPABILITIES.HERO_PUBLISH), csrfSynchronisedProtection, controller.publishPanel1);
router.post('/page/home/panel-1/social/items', requireCapability(CAPABILITIES.HERO_EDIT), csrfSynchronisedProtection, controller.createSocialItem);
router.post('/page/home/panel-1/social/items/save', requireCapability(CAPABILITIES.HERO_EDIT), csrfSynchronisedProtection, controller.saveSocialItem);
router.post('/page/home/panel-1/social/items/archive', requireCapability(CAPABILITIES.HERO_EDIT), csrfSynchronisedProtection, controller.archiveSocialItem);
router.post('/page/home/panel-1/social/items/reorder', requireCapability(CAPABILITIES.HERO_EDIT), csrfSynchronisedProtection, controller.reorderSocialItems);

// ── Global Settings & SEO (Phase 12A) ──
router.get('/page/global-settings', requireCapability(CAPABILITIES.GLOBAL_SETTINGS_VIEW), globalSettingsController.showGlobalSettings);
router.post('/page/global-settings/save', requireCapability(CAPABILITIES.GLOBAL_SETTINGS_EDIT), csrfSynchronisedProtection, globalSettingsController.saveGlobalSettings);
router.post('/page/global-settings/publish', requireCapability(CAPABILITIES.GLOBAL_SETTINGS_PUBLISH), csrfSynchronisedProtection, globalSettingsController.publishGlobalSettings);

// ── Page-specific SEO (Phase 12B) ──
const pageSeoController = require('../controllers/adminPageSeoController');
router.get('/page/page-seo', requireCapability(CAPABILITIES.GLOBAL_SETTINGS_VIEW), pageSeoController.showPageSeo);
router.post('/page/page-seo/save', requireCapability(CAPABILITIES.GLOBAL_SETTINGS_EDIT), csrfSynchronisedProtection, pageSeoController.savePageSeo);
router.post('/page/page-seo/publish', requireCapability(CAPABILITIES.GLOBAL_SETTINGS_PUBLISH), csrfSynchronisedProtection, pageSeoController.publishPageSeo);

// ── Store Hero (Phase 1F) ──
const storeHeroController = require('../controllers/adminStoreHeroController');
router.get('/page/store-hero', requireCapability(CAPABILITIES.STORE_HERO_VIEW), storeHeroController.showStoreHero);
router.post('/page/store-hero/save', requireCapability(CAPABILITIES.STORE_HERO_EDIT), csrfSynchronisedProtection, storeHeroController.saveStoreHeroDraft);
router.post('/page/store-hero/publish', requireCapability(CAPABILITIES.STORE_HERO_PUBLISH), csrfSynchronisedProtection, storeHeroController.publishStoreHero);

// ── Página Nosotros (Phase 1H) ──
const aboutPageController = require('../controllers/adminAboutPageController');
router.get('/page/nosotros', requireCapability(CAPABILITIES.ABOUT_PAGE_VIEW), aboutPageController.showAboutPage);
router.post('/page/nosotros/save', requireCapability(CAPABILITIES.ABOUT_PAGE_EDIT), csrfSynchronisedProtection, aboutPageController.saveAboutPageDraft);
router.post('/page/nosotros/publish', requireCapability(CAPABILITIES.ABOUT_PAGE_PUBLISH), csrfSynchronisedProtection, aboutPageController.publishAboutPage);

// ── Social Feed (Phase 2A) ──
const socialFeedController = require('../controllers/adminSocialFeedController');
router.get('/page/social-feed', requireCapability(CAPABILITIES.SOCIAL_FEED_VIEW), socialFeedController.showList);
router.get('/page/social-feed/create', requireCapability(CAPABILITIES.SOCIAL_FEED_EDIT), socialFeedController.showCreate);
router.get('/page/social-feed/edit', requireCapability(CAPABILITIES.SOCIAL_FEED_EDIT), socialFeedController.showEdit);
router.post('/page/social-feed/save', requireCapability(CAPABILITIES.SOCIAL_FEED_EDIT), csrfSynchronisedProtection, socialFeedController.saveDraft);
router.post('/page/social-feed/publish', requireCapability(CAPABILITIES.SOCIAL_FEED_PUBLISH), csrfSynchronisedProtection, socialFeedController.publishPost);
router.post('/page/social-feed/archive', requireCapability(CAPABILITIES.SOCIAL_FEED_EDIT), csrfSynchronisedProtection, socialFeedController.archivePost);
router.post('/page/social-feed/reorder', requireCapability(CAPABILITIES.SOCIAL_FEED_EDIT), csrfSynchronisedProtection, socialFeedController.reorderPosts);
router.post('/page/social-feed/toggle-active', requireCapability(CAPABILITIES.SOCIAL_FEED_EDIT), csrfSynchronisedProtection, socialFeedController.toggleActive);
router.post('/page/social-feed/restore', requireCapability(CAPABILITIES.SOCIAL_FEED_EDIT), csrfSynchronisedProtection, socialFeedController.restorePostDraft);

// ── Preview ──
router.get('/page/preview', requireCapability(CAPABILITIES.PAGE_MANAGE), controller.preview);

module.exports = router;
