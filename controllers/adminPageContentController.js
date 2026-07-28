/**
 * Navbar & Panel 1 admin controllers — Phase 11B.
 */
const crypto = require('node:crypto');
const publishing = require('../services/cmsPublishingService');
const mediaService = require('../services/mediaService');
const pool = require('../config/db');
const cmsContent = require('../services/cmsContentService');
const storage = require('../services/mediaStorageService');
const usageService = require('../services/mediaUsageService');
const revisionService = require('../services/contentRevisionService');
const validator = require('../validators/cmsPageValidator');
const repeatable = require('../services/cmsRepeatableService');
const publicationService = require('../services/publicationService');
const { MEDIA_KINDS, REVISION_ENTITY_TYPES } = require('../config/cmsOptions');

const PAGE_STYLES = ['/css/admin-page.css'];
const PAGE_MODULE = '/js/admin/media-library.js';
const NAVBAR_PATH = '/admin/page/navbar';
const PANEL1_PATH = '/admin/page/home/panel-1';

function actorId(req) { return req.session?.user?.id || null; }
function safeDiagnosticMessage(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, 180);
}
function logPanel1Save(req, event, details = {}) {
  const payload = {
    requestId: req.cmsSaveRequestId || null,
    route: req.originalUrl || PANEL1_PATH,
    adminId: actorId(req),
    panelKey: 'home.hero',
    event,
    ...details,
  };
  const method = event === 'error' || event === 'transaction_rollback' ? 'error' : 'info';
  console[method]('[cms-save]', JSON.stringify(payload));
}
function panel1SaveDiagnostics(req, res, next) {
  req.cmsSaveRequestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.cmsSaveRequestId);
  res.once('finish', () => {
    logPanel1Save(req, 'response', { httpStatus: res.statusCode });
  });
  next();
}
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
  if (!asset) {
    const error = new Error(`El recurso multimedia ${ref} no existe o está archivado.`);
    error.status = 422;
    throw error;
  }
  if (expectedKind && asset.kind !== expectedKind) {
    const error = new Error(`El recurso multimedia debe ser de tipo ${expectedKind === 'model' ? 'modelo 3D' : 'imagen'}.`);
    error.status = 422;
    throw error;
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
  const storedContent = storedSection?.content || {};
  const storedStyle = storedSection?.style || {};
  const storedModel = storedStyle.model || {};
  const has = (name) => Object.prototype.hasOwnProperty.call(body, name);
  return {
    ...(storedSection || {}),
    status: storedSection?.status || 'draft',
    content: {
      ...storedContent,
      ...(has('eyebrow') ? { eyebrow: body.eyebrow || '' } : {}),
      ...(has('heading') ? { heading: body.heading || '' } : {}),
      ...(has('description') ? { description: body.description || '' } : {}),
      primaryButton: {
        ...(storedContent.primaryButton || {}),
        ...(has('primary_label') ? { label: body.primary_label || '' } : {}),
        ...(has('primary_url') ? { url: body.primary_url || '' } : {}),
        ...(has('primary_target') ? { target: body.primary_target || '_self' } : {}),
        ...(has('primary_visible') ? { visible: body.primary_visible === '1' } : {}),
      },
      secondaryButton: {
        ...(storedContent.secondaryButton || {}),
        ...(has('secondary_label') ? { label: body.secondary_label || '' } : {}),
        ...(has('secondary_url') ? { url: body.secondary_url || '' } : {}),
        ...(has('secondary_target') ? { target: body.secondary_target || '_self' } : {}),
        ...(has('secondary_visible') ? { visible: body.secondary_visible === '1' } : {}),
      },
      ...(has('background_media') ? { backgroundMedia: body.background_media || null } : {}),
      ...(has('model_media') ? { modelMedia: body.model_media || null } : {}),
      ...(has('model_fallback') ? { modelFallbackMedia: body.model_fallback || null } : {}),
      ...(has('model_enabled') ? { modelEnabled: body.model_enabled === '1' } : {}),
      ...(has('is_visible') ? { isVisible: body.is_visible === '1' } : {}),
      ...(has('hero_aria_label') ? { heroAriaLabel: body.hero_aria_label || '' } : {}),
      ...(has('loading_aria_label') ? { loadingAriaLabel: body.loading_aria_label || '' } : {}),
      ...(has('model_error_text') ? { modelErrorText: body.model_error_text || '' } : {}),
      ...(has('retry_label') ? { retryLabel: body.retry_label || '' } : {}),
      ...(has('model_poster_alt') ? { modelPosterAlt: body.model_poster_alt || '' } : {}),
      ...(has('model_fallback_alt') ? { modelFallbackAlt: body.model_fallback_alt || '' } : {}),
      ...(has('social_aria_label') ? { socialAriaLabel: body.social_aria_label || '' } : {}),
    },
    style: {
      ...storedStyle,
      model: {
        ...storedModel,
        ...(has('model_scale') ? { scale: body.model_scale ?? 1 } : {}),
        position: {
          ...(storedModel.position || {}),
          ...(has('model_pos_x') ? { x: body.model_pos_x ?? 0 } : {}),
          ...(has('model_pos_y') ? { y: body.model_pos_y ?? 0 } : {}),
          ...(has('model_pos_z') ? { z: body.model_pos_z ?? 0 } : {}),
        },
        rotation: {
          ...(storedModel.rotation || {}),
          ...(has('model_rot_x') ? { x: body.model_rot_x ?? 0 } : {}),
          ...(has('model_rot_y') ? { y: body.model_rot_y ?? 0 } : {}),
          ...(has('model_rot_z') ? { z: body.model_rot_z ?? 0 } : {}),
        },
        ...(has('auto_rotate') ? { autoRotate: body.auto_rotate === '1' } : {}),
        ...(has('auto_rotate_speed') ? { autoRotateSpeed: body.auto_rotate_speed ?? 1 } : {}),
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
    const [[heroRow]] = await pool.query(
      "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'hero' LIMIT 1"
    );
    const socialItems = heroRow ? await repeatable.listItems('home_social_items', heroRow.id) : [];
    await Promise.all(socialItems.map(async (item) => {
      if (item.media_public_id) item.media_resolved = await resolveMediaData(`media://${item.media_public_id}`);
    }));
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
      socialItems,
      submittedSocialItem: req.cmsSubmittedSocialItem || null,
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
    logPanel1Save(req, 'validation', { result: errors.length ? 'failed' : 'passed' });
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

    await publishing.saveSectionDraft('home', 'hero', content, style, {
      actorId: actorId(req),
      onDiagnostic: (event, details) => logPanel1Save(req, event, details),
    });
    req.session.success_msg = 'Borrador del Panel 1 guardado.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(PANEL1_PATH);
  } catch (error) {
    logPanel1Save(req, 'error', {
      code: error.code || 'CMS_SAVE_ERROR',
      message: safeDiagnosticMessage(error.message || 'Save failed'),
    });
    try {
      const storedSection = await publishing.getSectionDraft('home', 'hero');
      return renderPanel1Editor(req, res, {
        section: submittedHeroSection(req.body, storedSection),
        status: error.status === 422 ? 422 : (error.status === 503 ? 503 : 500),
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
    await publicationService.publishModules(['home.hero'], 'module', { actorId: actorId(req) });
    req.session.success_msg = 'Panel 1 publicado. Los cambios ahora son visibles en la página de inicio.';
    req.session.cms_editor_state = 'published';
    return res.redirect(PANEL1_PATH);
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    return redirectWithError(req, res, destination, error.message);
  }
}

async function heroSectionId() {
  const [[row]] = await pool.query(
    "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'hero' LIMIT 1"
  );
  if (!row) throw new Error('La sección Hero no existe.');
  return row.id;
}

async function markHeroDraft() {
  await pool.query(
    "UPDATE page_sections s INNER JOIN pages p ON p.id=s.page_id SET s.status='draft' WHERE p.page_key='home' AND s.section_key='hero'"
  );
}

async function renderSocialFailure(req, res, errors, status = 422) {
  req.cmsSubmittedSocialItem = { values: { ...req.body } };
  const section = await publishing.getSectionDraft('home', 'hero');
  return renderPanel1Editor(req, res, {
    section,
    status,
    fieldErrors: errors,
    editorState: 'error',
    pageAlerts: [{
      id: 'hero-social-validation',
      type: 'error',
      title: 'No se pudo guardar la red social',
      description: errors.join(' '),
      persistent: true,
    }],
  });
}

async function createSocialItem(req, res) {
  const validation = validator.validateSocialItem(req.body);
  if (!validation.valid) return renderSocialFailure(req, res, [validation.error]);
  try {
    if (validation.value.media_public_id) {
      await verifyMediaRef(`media://${validation.value.media_public_id}`, 'image');
    }
    await repeatable.createItem('home_social_items', await heroSectionId(), {
      ...validation.value,
      sort_order: 999,
      status: 'draft',
    }, { actorId: actorId(req) });
    await markHeroDraft();
    req.session.success_msg = 'Red social agregada al borrador.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(PANEL1_PATH);
  } catch (error) {
    return renderSocialFailure(req, res, [error.message || 'Error al crear la red social.'], error.status === 422 ? 422 : 500);
  }
}

async function saveSocialItem(req, res) {
  const validation = validator.validateSocialItem(req.body);
  if (!validation.valid) return renderSocialFailure(req, res, [validation.error]);
  try {
    if (validation.value.media_public_id) {
      await verifyMediaRef(`media://${validation.value.media_public_id}`, 'image');
    }
    await repeatable.saveItem('home_social_items', req.body.public_id, validation.value, { actorId: actorId(req) });
    await markHeroDraft();
    req.session.success_msg = 'Red social guardada en el borrador.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(PANEL1_PATH);
  } catch (error) {
    return renderSocialFailure(req, res, [error.message || 'Error al guardar la red social.'], error.status === 422 ? 422 : 500);
  }
}

async function archiveSocialItem(req, res) {
  try {
    await repeatable.archiveItem('home_social_items', req.body.public_id, { actorId: actorId(req) });
    await markHeroDraft();
    req.session.success_msg = 'Red social archivada en el borrador.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(PANEL1_PATH);
  } catch (error) {
    return redirectWithError(req, res, PANEL1_PATH, error.message);
  }
}

async function reorderSocialItems(req, res) {
  try {
    const ids = String(req.body.ids || '').split(',').map((id) => id.trim()).filter(Boolean);
    if (!ids.length) throw new Error('Indique el orden de las redes sociales.');
    await repeatable.reorderItems('home_social_items', await heroSectionId(), ids, { actorId: actorId(req) });
    await markHeroDraft();
    req.session.success_msg = 'Orden de redes sociales guardado en el borrador.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(PANEL1_PATH);
  } catch (error) {
    return redirectWithError(req, res, PANEL1_PATH, error.message);
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
    let socialItems = section ? await repeatableSvc.listItems('home_social_items', await heroSectionId()) : [];

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
    for (const item of socialItems) {
      if (item.media_public_id) item.media_resolved = await resolveMedia('media://' + item.media_public_id);
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
      previewSocialItems: socialItems,
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
  panel1SaveDiagnostics,
  showPanel1,
  savePanel1Draft,
  publishPanel1,
  createSocialItem,
  saveSocialItem,
  archiveSocialItem,
  reorderSocialItems,
  preview,
};
