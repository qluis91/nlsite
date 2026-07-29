/**
 * CMS capability map — Phase 11A.
 *
 * The project authorizes through the numeric `role_id` column (1 = admin).
 * Capabilities give each CMS write a named permission without redesigning the
 * existing authorization model: every capability maps to the database admin
 * role. ADMIN_EMAILS is never consulted here.
 */
const CAPABILITIES = Object.freeze({
  PAGE_MANAGE: 'page.manage',
  MEDIA_VIEW: 'media.view',
  MEDIA_UPLOAD: 'media.upload',
  MEDIA_EDIT: 'media.edit',
  MEDIA_ARCHIVE: 'media.archive',
  MEDIA_DELETE: 'media.delete',
  NAVBAR_VIEW: 'navbar.view',
  NAVBAR_EDIT: 'navbar.edit',
  NAVBAR_PUBLISH: 'navbar.publish',
  HERO_VIEW: 'home.hero.view',
  HERO_EDIT: 'home.hero.edit',
  HERO_PUBLISH: 'home.hero.publish',
  SHOWCASE_VIEW: 'home.showcase.view',
  SHOWCASE_EDIT: 'home.showcase.edit',
  SHOWCASE_PUBLISH: 'home.showcase.publish',
  LOGOLOOP_EDIT: 'home.logoLoop.edit',
  LOGOLOOP_PUBLISH: 'home.logoLoop.publish',
  CAROUSEL_EDIT: 'home.carousel.edit',
  CAROUSEL_PUBLISH: 'home.carousel.publish',
  SERVICES_VIEW: 'home.services.view',
  SERVICES_EDIT: 'home.services.edit',
  SERVICES_PUBLISH: 'home.services.publish',
  // Phase 11D — Publishing & History
  PUBLISHING_VIEW: 'cms.publishing.view',
  PUBLISHING_PUBLISH: 'cms.publishing.publish',
  HISTORY_VIEW: 'cms.history.view',
  HISTORY_COMPARE: 'cms.history.compare',
  HISTORY_RESTORE_DRAFT: 'cms.history.restoreDraft',
  HISTORY_RESTORE_PUBLISH: 'cms.history.restorePublish',
  // Phase 12A — Global Settings & SEO
  GLOBAL_SETTINGS_VIEW: 'global.settings.view',
  GLOBAL_SETTINGS_EDIT: 'global.settings.edit',
  GLOBAL_SETTINGS_PUBLISH: 'global.settings.publish',
  // Phase 1F — Store Hero CMS
  STORE_HERO_VIEW: 'store.hero.view',
  STORE_HERO_EDIT: 'store.hero.edit',
  STORE_HERO_PUBLISH: 'store.hero.publish',
  // Phase 1H — Página Nosotros
  ABOUT_PAGE_VIEW: 'about.page.view',
  ABOUT_PAGE_EDIT: 'about.page.edit',
  ABOUT_PAGE_PUBLISH: 'about.page.publish',
  // Phase 2A — Social Feed
  SOCIAL_FEED_VIEW: 'social.feed.view',
  SOCIAL_FEED_EDIT: 'social.feed.edit',
  SOCIAL_FEED_PUBLISH: 'social.feed.publish',
});

const CAPABILITY_VALUES = Object.freeze(Object.values(CAPABILITIES));

/**
 * Physical deletion has no admin UI in Phase 11A: the project has no
 * established super-admin destructive-action pattern to hook into.
 */
const UNASSIGNED_CAPABILITIES = Object.freeze([]);

const ADMIN_CAPABILITIES = Object.freeze(
  CAPABILITY_VALUES.filter((capability) => !UNASSIGNED_CAPABILITIES.includes(capability))
);

function isAdminUser(user) {
  return Boolean(user) && Number(user.role_id) === 1;
}

function capabilitiesFor(user) {
  return isAdminUser(user) ? [...ADMIN_CAPABILITIES] : [];
}

function hasCapability(user, capability) {
  if (!CAPABILITY_VALUES.includes(capability)) return false;
  return capabilitiesFor(user).includes(capability);
}

module.exports = {
  CAPABILITIES,
  CAPABILITY_VALUES,
  ADMIN_CAPABILITIES,
  UNASSIGNED_CAPABILITIES,
  isAdminUser,
  capabilitiesFor,
  hasCapability,
};
