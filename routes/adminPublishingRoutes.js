/**
 * Publishing & History routes — Phase 11D.
 *
 * Mounted under /admin behind isAuthenticated + isAdmin.
 */
const express = require('express');
const controller = require('../controllers/adminPublishingController');
const { csrfSynchronisedProtection } = require('../config/csrf');
const { requireCapability } = require('../middlewares/capabilityMiddleware');
const { CAPABILITIES } = require('../config/capabilities');

const router = express.Router();

// ── Publishing Dashboard ──
router.get(
  '/page/publishing',
  requireCapability(CAPABILITIES.PUBLISHING_VIEW),
  controller.showPublishingDashboard
);

// ── Publish Selected ──
router.post(
  '/page/publishing/publish-selected',
  requireCapability(CAPABILITIES.PUBLISHING_PUBLISH),
  csrfSynchronisedProtection,
  controller.publishSelected
);

// ── Publish Full Home ──
router.post(
  '/page/publishing/publish-home',
  requireCapability(CAPABILITIES.PUBLISHING_PUBLISH),
  csrfSynchronisedProtection,
  controller.publishFullHome
);

// ── History Browser ──
router.get(
  '/page/history',
  requireCapability(CAPABILITIES.HISTORY_VIEW),
  controller.showHistory
);

// ── Revision Detail ──
router.get(
  '/page/history/revision/:id([0-9]+)',
  requireCapability(CAPABILITIES.HISTORY_VIEW),
  controller.showRevisionDetail
);

// ── Compare Revisions ──
router.get(
  '/page/history/compare',
  requireCapability(CAPABILITIES.HISTORY_COMPARE),
  controller.showCompare
);

// ── Restore Revision ──
router.get(
  '/page/history/revision/:id([0-9]+)/restore',
  requireCapability(CAPABILITIES.HISTORY_RESTORE_DRAFT),
  controller.showRestore
);

router.post(
  '/page/history/revision/:id([0-9]+)/restore',
  requireCapability(CAPABILITIES.HISTORY_RESTORE_DRAFT),
  csrfSynchronisedProtection,
  controller.restoreRevision
);

module.exports = router;
