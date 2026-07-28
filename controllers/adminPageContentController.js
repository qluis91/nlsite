/**
 * Navbar & Panel 1 admin controllers — Phase 11B.
 */
const publishing = require('../services/cmsPublishingService');
const mediaService = require('../services/mediaService');
const pool = require('../config/db');
const cmsContent = require('../services/cmsContentService');
const storage = require('../services/mediaStorageService');
const usageService = require('../services/mediaUsageService');
const revisionService = require('../services/contentRevisionService');
const validator = require('../validators/cmsPageValidator');
const { MEDIA_KINDS, REVISION_ENTITY_TYPES } = require('../config/cmsOptions');

const PAGE_STYLES = ['/css/admin-page.css'];
const PAGE_MODULE = '/js/admin/media-library.js';
const NAVBAR_PATH = '/admin/page/navbar';
const PANEL1_PATH = '/admin/page/home/panel-1';

function actorId(req) { return req.session?.user?.id || null; }
function consumeEditorState(req) {
  if (!req.session) return null;
  const state = req.session.cms_editor_state || null;
  delete req.session.cms_editor_state;
  return state;
}
function redirectWithError(req, res, destination, message) {
  req.session.error_msg = message || 'No fue posible completar la operación.';
  return res.redirect(destination);
}

// ── Media asset picker helpers ──

async function listPickableMedia(options = {}) {
  const { kind = null, search = '' } = options;
  const filters = { page: 1, limit: 100, status: 'active' };
  if (kind) filters.kind = kind;
  if (search) filters.search = search;
  return mediaService.listAssets(filters);
}

async function verifyMediaRef(ref, expectedKind = null) {
  if (!ref) return null;
  const publicId = ref.replace('media://', '');
  const asset = await mediaService.getByPublicId(publicId);
  if (!asset) throw new Error(`El recurso multimedia ${ref} no existe o está archivado.`);
  if (expectedKind && asset.kind !== expectedKind) {
    throw new Error(`El recurso multimedia debe ser de tipo ${expectedKind === 'model' ? 'modelo 3D' : 'imagen'}.`);
  }
  return asset;
}

async function resolveMediaData(ref) {
  if (!ref || !ref.startsWith('media://')) return null;
  const publicId = ref.replace('media://', '');
  const resolved = await cmsContent.resolveMediaReference(`media://${publicId}`, null);
  if (!resolved) return null;
  return {
    public_id: publicId,
    title: resolved.title,
    original_filename: resolved.title,
    mime_type: resolved.mimeType,
    category: resolved.category,
    dimensions: resolved.dimensions,
    thumbnail_url: resolved.thumbnailUrl,
    url: resolved.url,
  };
}

// ── Navbar editor ──

async function showNavbar(req, res, next) {
  try {
    const navItems = await publishing.listNavItems('home');
    const storedSettings = await publishing.getDraftSettings([
      'site.logo_primary', 'site.logo_light', 'site.logo_dark',
      'site.favicon', 'navbar.bg_color', 'navbar.text_color',
      'navbar.accent_color', 'navbar.border_color', 'navbar.opacity', 'navbar.logo_width',
    ]);
    const settings = { ...storedSettings, ...(req.cmsSettingsOverride || {}) };
    const mediaList = await listPickableMedia({ kind: 'image' });

    // Resolve current media refs for visual selector pre-population
    const [logoPrimary, logoLight, logoDark, favicon] = await Promise.all([
      resolveMediaData(settings['site.logo_primary']),
      resolveMediaData(settings['site.logo_light']),
      resolveMediaData(settings['site.logo_dark']),
      resolveMediaData(settings['site.favicon']),
    ]);

    res.status(req.cmsEditorStatus || 200).render('pages/admin/page/navbar', {
      title: 'Navbar y branding',
      layout: 'layouts/admin',
      pageStyles: PAGE_STYLES,
      pageScripts: ['/js/admin/media-selector.js', '/js/admin/cms-editor-state.js'],
      pageModule: PAGE_MODULE,
      navItems,
      settings,
      mediaList,
      logoPrimary, logoLight, logoDark, favicon,
      editorState: req.cmsEditorErrors?.length ? 'error' : consumeEditorState(req),
      fieldErrors: req.cmsEditorErrors || [],
      submittedNavItem: req.cmsSubmittedNavItem || null,
      pageAlerts: req.cmsEditorErrors?.length ? [{
        id: 'navbar-validation',
        type: 'error',
        title: 'No se pudo guardar el borrador',
        description: req.cmsEditorErrors.join(' '),
        persistent: true,
      }] : [],
      formatFileSize: mediaService.formatFileSize,
    });
  } catch (error) { next(error); }
}

async function saveNavbarSettings(req, res, next) {
  const destination = NAVBAR_PATH;
  const rawSettings = {
    'site.logo_primary': req.body.logo_primary || '',
    'site.logo_light': req.body.logo_light || '',
    'site.logo_dark': req.body.logo_dark || '',
    'site.favicon': req.body.favicon || '',
    'navbar.bg_color': req.body.bg_color || '',
    'navbar.text_color': req.body.text_color || '',
    'navbar.accent_color': req.body.accent_color || '',
    'navbar.border_color': req.body.border_color || '',
    'navbar.opacity': req.body.opacity || '',
    'navbar.logo_width': req.body.logo_width || '',
  };
  try {
    const validation = validator.validateNavbarSettings(req.body);
    if (!validation.valid) {
      req.cmsSettingsOverride = rawSettings;
      req.cmsEditorErrors = [validation.error];
      req.cmsEditorStatus = 422;
      return showNavbar(req, res, next);
    }

    const vals = validation.value;
    const settings = [
      ['site.logo_primary', vals.logo_primary, 'media', 'navbar'],
      ['site.logo_light', vals.logo_light, 'media', 'navbar'],
      ['site.logo_dark', vals.logo_dark, 'media', 'navbar'],
      ['site.favicon', vals.favicon, 'media', 'navbar'],
      ['navbar.bg_color', vals.bg_color, 'string', 'navbar'],
      ['navbar.text_color', vals.text_color, 'string', 'navbar'],
      ['navbar.accent_color', vals.accent_color, 'string', 'navbar'],
      ['navbar.border_color', vals.border_color, 'string', 'navbar'],
      ['navbar.opacity', vals.opacity === null ? null : String(vals.opacity), 'number', 'navbar'],
      ['navbar.logo_width', vals.logo_width === null ? null : String(vals.logo_width), 'number', 'navbar'],
    ];

    await publishing.saveSettingsDraft(settings, { actorId: actorId(req) });

    req.session.success_msg = 'Configuración del navbar guardada como borrador.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(NAVBAR_PATH);
  } catch (error) {
    req.cmsSettingsOverride = rawSettings;
    req.cmsEditorErrors = [error.message || 'Error de servidor o base de datos.'];
    req.cmsEditorStatus = 500;
    return showNavbar(req, res, next);
  }
}

async function publishNavbar(req, res, next) {
  const destination = NAVBAR_PATH;
  try {
    const navbarSettingKeys = [
      'site.logo_primary', 'site.logo_light', 'site.logo_dark', 'site.favicon',
      'navbar.bg_color', 'navbar.text_color', 'navbar.accent_color',
      'navbar.border_color', 'navbar.opacity', 'navbar.logo_width',
    ];
    await publishing.publishSettings(navbarSettingKeys, { actorId: actorId(req) });
    const publishedItems = await publishing.publishNavItems({ location: 'home', actorId: actorId(req) });
    req.session.success_msg = `${publishedItems} enlace(s) publicados. La barra de navegación ahora muestra los cambios en el sitio.`;
    req.session.cms_editor_state = 'published';
    return res.redirect(NAVBAR_PATH);
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

// ── Nav item CRUD ──

async function saveNavItem(req, res, next) {
  const destination = NAVBAR_PATH;
  try {
    const validation = validator.validateNavItem(req.body);
    if (!validation.valid) {
      req.cmsSubmittedNavItem = { values: { ...req.body } };
      req.cmsEditorErrors = [validation.error];
      req.cmsEditorStatus = 422;
      return showNavbar(req, res, next);
    }
    await publishing.saveNavItem(req.body.public_id, validation.value, { actorId: actorId(req) });
    req.session.success_msg = 'Enlace de navegación actualizado.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(NAVBAR_PATH);
  } catch (error) {
    req.cmsSubmittedNavItem = { values: { ...req.body } };
    req.cmsEditorErrors = [error.message || 'Error de servidor o base de datos.'];
    req.cmsEditorStatus = 500;
    return showNavbar(req, res, next);
  }
}

async function createNavItem(req, res, next) {
  const destination = NAVBAR_PATH;
  try {
    const validation = validator.validateNavItem(req.body);
    if (!validation.valid) {
      req.cmsSubmittedNavItem = { values: { ...req.body } };
      req.cmsEditorErrors = [validation.error];
      req.cmsEditorStatus = 422;
      return showNavbar(req, res, next);
    }
    await publishing.createNavItem(validation.value, { actorId: actorId(req) });
    req.session.success_msg = 'Enlace de navegación creado.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(NAVBAR_PATH);
  } catch (error) {
    req.cmsSubmittedNavItem = { values: { ...req.body } };
    req.cmsEditorErrors = [error.message || 'Error de servidor o base de datos.'];
    req.cmsEditorStatus = 500;
    return showNavbar(req, res, next);
  }
}

async function archiveNavItem(req, res, next) {
  const destination = NAVBAR_PATH;
  try {
    await publishing.archiveNavItem(req.body.public_id, { actorId: actorId(req) });
    req.session.success_msg = 'Enlace de navegación archivado.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(NAVBAR_PATH);
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

async function reorderNavItems(req, res, next) {
  const destination = NAVBAR_PATH;
  try {
    let ids;
    if (typeof req.body.ordered === 'string') {
      try { ids = JSON.parse(req.body.ordered); } catch { ids = []; }
    } else {
      ids = req.body.ordered || [];
    }
    if (!Array.isArray(ids) || !ids.length) {
      return redirectWithError(req, res, destination, 'Se requiere al menos un elemento para reordenar.');
    }
    await publishing.reorderNavItems(ids, { location: 'home', actorId: actorId(req) });
    req.session.success_msg = 'Orden de navegación actualizado.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(NAVBAR_PATH);
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

// ── Panel 1 / Hero ──

async function showPanel1(req, res, next) {
  try {
    const section = await publishing.getSectionDraft('home', 'hero');
    return renderPanel1Editor(req, res, { section });
  } catch (error) { next(error); }
}

function submittedHeroSection(body, storedSection = null) {
  return {
    ...(storedSection || {}),
    status: storedSection?.status || 'draft',
    content: {
      eyebrow: body.eyebrow || '',
      heading: body.heading || '',
      description: body.description || '',
      primaryButton: {
        label: body.primary_label || '',
        url: body.primary_url || '',
        visible: body.primary_visible === '1',
      },
      secondaryButton: {
        label: body.secondary_label || '',
        url: body.secondary_url || '',
        visible: body.secondary_visible === '1',
      },
      backgroundMedia: body.background_media || null,
      modelMedia: body.model_media || null,
      modelFallbackMedia: body.model_fallback || null,
      modelEnabled: body.model_enabled === '1',
    },
    style: {
      model: {
        scale: body.model_scale ?? 1,
        position: {
          x: body.model_pos_x ?? 0,
          y: body.model_pos_y ?? 0,
          z: body.model_pos_z ?? 0,
        },
        rotation: {
          x: body.model_rot_x ?? 0,
          y: body.model_rot_y ?? 0,
          z: body.model_rot_z ?? 0,
        },
        autoRotate: body.auto_rotate === '1',
        autoRotateSpeed: body.auto_rotate_speed ?? 1,
      },
    },
  };
}

async function renderPanel1Editor(req, res, {
  section,
  status = 200,
  fieldErrors = [],
  pageAlerts = [],
  editorState = null,
} = {}) {
    const mediaList = await listPickableMedia();
    const modelList = await listPickableMedia({ kind: 'model' });

    // Resolve current media refs for visual selector pre-population
    const heroContent = section?.content || (
      section && typeof section.content_json === 'string'
        ? JSON.parse(section.content_json)
        : (section && section.content_json)
    ) || {};
    const [bgMedia, modelMedia, fallbackMedia] = await Promise.all([
      resolveMediaData(heroContent.backgroundMedia),
      resolveMediaData(heroContent.modelMedia),
      resolveMediaData(heroContent.modelFallbackMedia),
    ]);

    return res.status(status).render('pages/admin/page/panel1', {
      title: 'Panel 1 — Hero',
      layout: 'layouts/admin',
      pageStyles: PAGE_STYLES,
      pageScripts: ['/js/admin/media-selector.js', '/js/admin/cms-editor-state.js'],
      pageModule: PAGE_MODULE,
      section,
      mediaList,
      modelList,
      bgMedia, modelMedia, fallbackMedia,
      formatFileSize: mediaService.formatFileSize,
      fieldErrors,
      pageAlerts,
      editorState: editorState || consumeEditorState(req),
    });
}

async function savePanel1Draft(req, res, next) {
  const destination = PANEL1_PATH;
  try {
    const contentValidation = validator.validateHeroContent(req.body);
    const styleValidation = validator.validateHeroStyle(req.body);
    const errors = [
      ...(!contentValidation.valid ? [contentValidation.error] : []),
      ...(!styleValidation.valid ? [styleValidation.error] : []),
    ];
    if (errors.length) {
      const storedSection = await publishing.getSectionDraft('home', 'hero');
      return renderPanel1Editor(req, res, {
        section: submittedHeroSection(req.body, storedSection),
        status: 422,
        fieldErrors: errors,
        editorState: 'error',
        pageAlerts: [{
          id: 'panel-1-validation',
          type: 'error',
          title: 'No se pudo guardar el borrador',
          description: errors.join(' '),
          persistent: true,
        }],
      });
    }

    const content = contentValidation.value;
    const style = styleValidation.value;

    // Verify media references are active and of the correct kind
    if (content.backgroundMedia) await verifyMediaRef(content.backgroundMedia, 'image');
    if (content.modelMedia) await verifyMediaRef(content.modelMedia, 'model');
    if (content.modelFallbackMedia) await verifyMediaRef(content.modelFallbackMedia, 'image');

    await publishing.saveSectionDraft('home', 'hero', content, style, { actorId: actorId(req) });
    req.session.success_msg = 'Borrador del Panel 1 guardado.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(PANEL1_PATH);
  } catch (error) {
    try {
      const storedSection = await publishing.getSectionDraft('home', 'hero');
      return renderPanel1Editor(req, res, {
        section: submittedHeroSection(req.body, storedSection),
        status: 500,
        fieldErrors: [error.message || 'No fue posible guardar el borrador.'],
        editorState: 'error',
        pageAlerts: [{
          id: 'panel-1-save-error',
          type: 'error',
          title: 'Error al guardar',
          description: 'No se modificó el borrador almacenado.',
          persistent: true,
        }],
      });
    } catch {
      return next(error);
    }
  }
}

async function publishPanel1(req, res, next) {
  const destination = PANEL1_PATH;
  try {
    await publishing.publishSection('home', 'hero', { actorId: actorId(req) });
    req.session.success_msg = 'Panel 1 publicado. Los cambios ahora son visibles en la página de inicio.';
    req.session.cms_editor_state = 'published';
    return res.redirect(PANEL1_PATH);
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

// ── Preview ──

async function preview(req, res, next) {
  try {
    const section = await publishing.getSectionDraft('home', 'hero');
    const showcaseSection = await publishing.getSectionDraft('home', 'showcase').catch(() => null);
    const servicesSection = await publishing.getSectionDraft('home', 'services').catch(() => null);

    const settings = await publishing.getPublishedSettings([
      'site.logo_primary', 'site.logo_light', 'site.logo_dark',
      'site.favicon', 'navbar.bg_color', 'navbar.text_color',
      'navbar.accent_color', 'navbar.border_color', 'navbar.opacity', 'navbar.logo_width',
    ]);

    // Resolve Panel 2 repeatable items (draft)
    const repeatableSvc = require('../services/cmsRepeatableService');
    let logoLoopItems = [];
    let carouselItems = [];
    let featureItems = [];

    if (showcaseSection) {
      const [[sRow]] = await pool.query(
        "SELECT s.id AS id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'showcase'"
      );
      if (sRow) {
        [logoLoopItems, carouselItems] = await Promise.all([
          repeatableSvc.listItems('logo_loop_items', sRow.id),
          repeatableSvc.listItems('home_carousel_items', sRow.id),
        ]);
      }
    }

    if (servicesSection) {
      const [[sRow]] = await pool.query(
        "SELECT s.id AS id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'services'"
      );
      if (sRow) {
        featureItems = await repeatableSvc.listItems('home_feature_items', sRow.id);
      }
    }

    // Resolve media for repeatable items (needed by public template)
    const cmsContent = require('../services/cmsContentService');
    const resolveMedia = async (ref) => {
      if (!ref) return null;
      return cmsContent.resolveMediaReference(ref, null);
    };
    for (const item of carouselItems) {
      if (item.media_public_id) {
        item.media_resolved = await resolveMedia('media://' + item.media_public_id);
      }
      if (item.preview_media_public_id) {
        item.preview_media_resolved = await resolveMedia('media://' + item.preview_media_public_id);
      }
    }
    for (const item of logoLoopItems) {
      if (item.item_type !== 'text' && item.media_public_id) {
        item.media_resolved = await resolveMedia('media://' + item.media_public_id);
      }
    }
    for (const item of featureItems) {
      if (item.icon_type === 'media' && item.media_public_id) {
        item.media_resolved = await resolveMedia('media://' + item.media_public_id);
      }
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('X-Robots-Tag', 'noindex, nofollow');

    res.render('pages/home', {
      title: 'Vista previa — Panel 1-3',
      layout: 'layouts/main',
      pageClass: 'page-home',
      pageStyles: ['/css/home.css'],
      isPreview: true,
      previewNavbar: { settings },
      previewHeroContent: section?.content || null,
      previewHeroStyle: section?.style || null,
      previewShowcaseContent: showcaseSection?.content || null,
      previewShowcaseStyle: showcaseSection?.style || null,
      previewLogoLoopItems: logoLoopItems,
      previewCarouselItems: carouselItems,
      previewServicesContent: servicesSection?.content || null,
      previewServicesStyle: servicesSection?.style || null,
      previewFeatureItems: featureItems,
      previewBanner: true,
    });

  } catch (error) { next(error); }
}

module.exports = {
  showNavbar,
  saveNavbarSettings,
  publishNavbar,
  saveNavItem,
  createNavItem,
  archiveNavItem,
  reorderNavItems,
  showPanel1,
  savePanel1Draft,
  publishPanel1,
  preview,
};
