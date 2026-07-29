/**
 * CMS Module Registry — Phase 11D.
 *
 * Central registry of all publishable CMS modules.
 * Each module declares its sources, validators, publishers,
 * dependencies, cache namespaces, and revision entity types.
 */

const pool = require('../config/db');

const MODULE_KEYS = Object.freeze({
  NAVBAR: 'navbar',
  HERO: 'home.hero',
  SHOWCASE: 'home.showcase',
  LOGO_LOOP: 'home.logoLoop',
  CAROUSEL: 'home.carousel',
  SERVICES: 'home.services',
  FEATURES: 'home.features',
  STORE_HERO: 'tienda.st-hero',
});

const MODULE_KEY_VALUES = Object.freeze(Object.values(MODULE_KEYS));

const MODULES = Object.freeze({
  [MODULE_KEYS.NAVBAR]: Object.freeze({
    key: MODULE_KEYS.NAVBAR,
    label: 'Navbar y branding',
    entitySource: 'site_settings + navigation_items',
    cacheNamespaces: ['siteSettings', 'nav_home'],
    revisionEntityTypes: ['site_setting', 'navigation_item'],
    dependencies: [],
    canPublishIndependently: true,
    validate: async () => {
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) cnt FROM navigation_items WHERE location='home' AND status='draft' AND deleted_at IS NULL AND is_visible=1"
      );
      const [[{ draftSettings }]] = await pool.query(
        "SELECT COUNT(*) draftSettings FROM site_settings WHERE setting_key LIKE 'site.%' OR setting_key LIKE 'navbar.%'"
      );
      return { valid: true, warnings: cnt === 0 ? ['Sin enlaces de navegación visibles en borrador.'] : [] };
    },
    pendingCheck: async () => {
      const [[navDraft]] = await pool.query(
        "SELECT COUNT(*) cnt FROM navigation_items WHERE location='home' AND status='draft' AND deleted_at IS NULL"
      );
      const [[settingCount]] = await pool.query(
        "SELECT COUNT(*) cnt FROM site_settings"
      );
      // Simple heuristic: if nav items have any drafts, there are pending changes
      return navDraft.cnt > 0;
    },
  }),

  [MODULE_KEYS.HERO]: Object.freeze({
    key: MODULE_KEYS.HERO,
    label: 'Panel 1 — Hero',
    entitySource: 'page_sections (home/hero)',
    cacheNamespaces: ['sc_home'],
    revisionEntityTypes: ['page_section'],
    dependencies: [],
    canPublishIndependently: true,
    validate: async () => {
      const [[row]] = await pool.query(
        "SELECT s.content_json FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key='home' AND s.section_key='hero'"
      );
      if (!row || !row.content_json) return { valid: true, warnings: ['Panel 1 sin contenido configurado.'] };
      let content;
      try { content = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json; } catch { return { valid: false, errors: ['JSON inválido en Panel 1.'] }; }
      if (!content.heading) return { valid: false, errors: ['El Panel 1 requiere un título.'] };
      return { valid: true, warnings: [] };
    },
    pendingCheck: async () => {
      const [[row]] = await pool.query(
        "SELECT s.status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key='home' AND s.section_key='hero'"
      );
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) cnt FROM home_social_items WHERE status IN ('draft', 'archived')"
      );
      return Boolean(row && row.status === 'draft') || cnt > 0;
    },
  }),

  [MODULE_KEYS.SHOWCASE]: Object.freeze({
    key: MODULE_KEYS.SHOWCASE,
    label: 'Panel 2 — Contenido general',
    entitySource: 'page_sections (home/showcase)',
    cacheNamespaces: ['sc_home'],
    revisionEntityTypes: ['page_section'],
    dependencies: [],
    canPublishIndependently: true,
    validate: async () => {
      const [[row]] = await pool.query(
        "SELECT s.content_json FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key='home' AND s.section_key='showcase'"
      );
      if (!row || !row.content_json) return { valid: true, warnings: ['Panel 2 sin contenido configurado.'] };
      let content;
      try { content = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json; } catch { return { valid: false, errors: ['JSON inválido en Panel 2.'] }; }
      if (!content.heading) return { valid: false, errors: ['El Panel 2 requiere un encabezado.'] };
      return { valid: true, warnings: [] };
    },
    pendingCheck: async () => {
      const [[row]] = await pool.query(
        "SELECT s.status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key='home' AND s.section_key='showcase'"
      );
      return row && row.status === 'draft';
    },
  }),

  [MODULE_KEYS.LOGO_LOOP]: Object.freeze({
    key: MODULE_KEYS.LOGO_LOOP,
    label: 'Panel 2 — LogoLoop',
    entitySource: 'logo_loop_items',
    cacheNamespaces: ['logoLoop_home'],
    revisionEntityTypes: ['logo_loop_item'],
    dependencies: [MODULE_KEYS.SHOWCASE],
    canPublishIndependently: true,
    validate: async () => {
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) cnt FROM logo_loop_items WHERE status='draft' AND deleted_at IS NULL AND is_visible=1"
      );
      if (cnt === 0) return { valid: false, errors: ['El LogoLoop requiere al menos un elemento visible en borrador.'] };
      return { valid: true, warnings: [] };
    },
    pendingCheck: async () => {
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) cnt FROM logo_loop_items WHERE status='draft' AND deleted_at IS NULL"
      );
      return cnt > 0;
    },
  }),

  [MODULE_KEYS.CAROUSEL]: Object.freeze({
    key: MODULE_KEYS.CAROUSEL,
    label: 'Panel 2 — Carrusel de proyectos',
    entitySource: 'home_carousel_items',
    cacheNamespaces: ['carousel_home'],
    revisionEntityTypes: ['carousel_item'],
    dependencies: [MODULE_KEYS.SHOWCASE],
    canPublishIndependently: true,
    validate: async () => {
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) cnt FROM home_carousel_items WHERE status='draft' AND deleted_at IS NULL AND is_visible=1"
      );
      if (cnt === 0) return { valid: false, errors: ['El carrusel requiere al menos un proyecto visible en borrador.'] };
      return { valid: true, warnings: [] };
    },
    pendingCheck: async () => {
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) cnt FROM home_carousel_items WHERE status='draft' AND deleted_at IS NULL"
      );
      return cnt > 0;
    },
  }),

  [MODULE_KEYS.SERVICES]: Object.freeze({
    key: MODULE_KEYS.SERVICES,
    label: 'Panel 3 — Contenido general',
    entitySource: 'page_sections (home/services)',
    cacheNamespaces: ['sc_home'],
    revisionEntityTypes: ['page_section'],
    dependencies: [],
    canPublishIndependently: true,
    validate: async () => {
      const [[row]] = await pool.query(
        "SELECT s.content_json FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key='home' AND s.section_key='services'"
      );
      if (!row || !row.content_json) return { valid: true, warnings: ['Panel 3 sin contenido configurado.'] };
      let content;
      try { content = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json; } catch { return { valid: false, errors: ['JSON inválido en Panel 3.'] }; }
      if (!content.heading) return { valid: false, errors: ['El Panel 3 requiere un encabezado.'] };
      return { valid: true, warnings: [] };
    },
    pendingCheck: async () => {
      const [[row]] = await pool.query(
        "SELECT s.status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key='home' AND s.section_key='services'"
      );
      return row && row.status === 'draft';
    },
  }),

  [MODULE_KEYS.FEATURES]: Object.freeze({
    key: MODULE_KEYS.FEATURES,
    label: 'Panel 3 — Tarjetas de servicios',
    entitySource: 'home_feature_items',
    cacheNamespaces: ['features_home'],
    revisionEntityTypes: ['feature_item'],
    dependencies: [MODULE_KEYS.SERVICES],
    canPublishIndependently: true,
    validate: async () => {
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) cnt FROM home_feature_items WHERE status='draft' AND deleted_at IS NULL AND is_visible=1"
      );
      // Supporting one/two/many-item behavior
      return { valid: true, warnings: cnt === 0 ? ['No hay tarjetas visibles en borrador.'] : [] };
    },
    pendingCheck: async () => {
      const [[{ cnt }]] = await pool.query(
        "SELECT COUNT(*) cnt FROM home_feature_items WHERE status='draft' AND deleted_at IS NULL"
      );
      return cnt > 0;
    },
  }),
  [MODULE_KEYS.STORE_HERO]: Object.freeze({
    key: MODULE_KEYS.STORE_HERO,
    label: 'Hero de Tienda',
    entitySource: 'page_sections (tienda/st-hero)',
    cacheNamespaces: ['sc_tienda'],
    revisionEntityTypes: ['page_section'],
    dependencies: [],
    canPublishIndependently: true,
    validate: async () => {
      const [[row]] = await pool.query(
        "SELECT s.content_json FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key='tienda' AND s.section_key='st-hero'"
      );
      if (!row || !row.content_json) return { valid: true, warnings: ['Hero de Tienda sin contenido configurado.'] };
      let content;
      try { content = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json; } catch { return { valid: false, errors: ['JSON inválido en Hero de Tienda.'] }; }
      if (!content.title) return { valid: false, errors: ['El Hero de Tienda requiere un título.'] };
      return { valid: true, warnings: [] };
    },
    pendingCheck: async () => {
      const [[row]] = await pool.query(
        "SELECT s.status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key='tienda' AND s.section_key='st-hero'"
      );
      return Boolean(row && row.status === 'draft');
    },
  }),
});

function getModule(moduleKey) {
  const mod = MODULES[moduleKey];
  if (!mod) throw new Error(`Módulo no encontrado: ${moduleKey}`);
  return mod;
}

function getAllModules() {
  return MODULE_KEY_VALUES.map(k => MODULES[k]);
}

module.exports = {
  MODULE_KEYS,
  MODULE_KEY_VALUES,
  MODULES,
  getModule,
  getAllModules,
};
