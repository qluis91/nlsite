/**
 * Panel 2 & Panel 3 admin controller — Phase 11C.
 * Handles rendering editor UIs, save drafts, publish, and item CRUD.
 */
const publishing = require('../services/cmsPublishingService');
const repeatable = require('../services/cmsRepeatableService');
const mediaService = require('../services/mediaService');
const validator = require('../validators/cmsPanelsValidator');
const pool = require('../config/db');
const cmsContent = require('../services/cmsContentService');

// ── Helpers ──

function actorId(req) {
  return req.session?.user?.id || null;
}

function errorRedirect(req, res, url, errors) {
  req.session.error_msg = errors.join('; ');
  return res.redirect(url);
}

function successRedirect(req, res, url, msg) {
  req.session.success_msg = msg;
  req.session.cms_editor_state = /publicad/i.test(msg) ? 'published' : 'saved';
  return res.redirect(url);
}

function consumeEditorState(req) {
  if (!req.session) return null;
  const state = req.session.cms_editor_state || null;
  delete req.session.cms_editor_state;
  return state;
}

function renderItemFailure(req, res, renderer, kind, errors, status = 422) {
  req.cmsSubmittedItem = { kind, values: { ...req.body } };
  req.cmsEditorErrors = errors;
  req.cmsEditorStatus = status;
  return renderer(req, res, () => {});
}

async function getSectionId(pageKey, sectionKey) {
  const [[row]] = await pool.query(
    "SELECT s.id AS id, s.content_json AS content_json, s.style_json AS style_json, s.status AS status, s.is_enabled AS is_enabled FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ? LIMIT 1",
    [pageKey, sectionKey]
  );
  return row || null;
}

async function resolveMediaData(ref) {
  if (!ref) return null;
  const publicId = String(ref).replace(/^media:\/\//, '').trim();
  if (!publicId) return null;
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

async function resolveItemMediaData(items, fields) {
  for (const item of items) {
    for (const f of fields) {
      if (item[f]) {
        item[f + '_resolved'] = await resolveMediaData(item[f]);
      }
    }
  }
}

// ── Panel 2: Showcase ──

async function showPanel2(req, res, next) {
  try {
    const section = await getSectionId('home', 'showcase');
    if (!section) {
      const err = new Error('Sección showcase no encontrada.');
      err.status = 500;
      return next(err);
    }

    const storedContent = (typeof section.content_json === 'string' ? JSON.parse(section.content_json) : section.content_json) || {};
    const storedStyle = (typeof section.style_json === 'string' ? JSON.parse(section.style_json) : section.style_json) || {};
    const content = { ...storedContent, ...(req.cmsEditorOverride?.content || {}) };
    const style = { ...storedStyle, ...(req.cmsEditorOverride?.style || {}) };

    const [logoItems, carouselItems] = await Promise.all([
      repeatable.listItems('logo_loop_items', section.id),
      repeatable.listItems('home_carousel_items', section.id),
    ]);

    await Promise.all([
      resolveItemMediaData(logoItems, ['media_public_id']),
      resolveItemMediaData(carouselItems, ['media_public_id', 'preview_media_public_id']),
    ]);

    // Resolve background media
    let bgMedia = null;
    if (style.backgroundMedia) bgMedia = await resolveMediaData(style.backgroundMedia);

    res.status(req.cmsEditorStatus || 200).render('pages/admin/page/panel2', {
      title: 'Panel 2 — Showcase',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageScripts: ['/js/admin/media-selector.js', '/js/admin/panel2-editor.js', '/js/admin/cms-editor-state.js'],
      content,
      style,
      bgMedia,
      logoItems,
      carouselItems,
      error: null,
      saved: null,
      fieldErrors: req.cmsEditorErrors || [],
      editorState: req.cmsEditorErrors?.length ? 'error' : consumeEditorState(req),
      pageAlerts: req.cmsEditorErrors?.length ? [{
        id: 'panel-2-validation',
        type: 'error',
        title: 'No se pudo guardar el borrador',
        description: req.cmsEditorErrors.join(' '),
        persistent: true,
      }] : [],
      submittedItem: req.cmsSubmittedItem || null,
    });
  } catch (e) {
    console.error('Panel 2 editor error:', e);
    return next(e);
  }
}

async function savePanel2Draft(req, res) {
  const section = await getSectionId('home', 'showcase');
  const storedContent = (typeof section.content_json === 'string' ? JSON.parse(section.content_json) : section.content_json) || {};
  const storedStyle = (typeof section.style_json === 'string' ? JSON.parse(section.style_json) : section.style_json) || {};
  const has = (name) => Object.prototype.hasOwnProperty.call(req.body, name);
  const content = {
    ...storedContent,
    ...(has('eyebrow') ? { eyebrow: req.body.eyebrow?.trim() || null } : {}),
    ...(has('heading') ? { heading: req.body.heading?.trim() || null } : {}),
    ...(has('supportText') ? { supportText: req.body.supportText?.trim() || null } : {}),
    ...(has('carouselLabel') ? { carouselLabel: req.body.carouselLabel?.trim() || null } : {}),
    ...(has('logoLoopAriaLabel') ? { logoLoopAriaLabel: req.body.logoLoopAriaLabel?.trim() || null } : {}),
  };
  const style = {
    ...storedStyle,
    ...(has('backgroundColor') ? { backgroundColor: req.body.backgroundColor?.trim() || null } : {}),
    ...(has('textColor') ? { textColor: req.body.textColor?.trim() || null } : {}),
    ...(has('accentColor') ? { accentColor: req.body.accentColor?.trim() || null } : {}),
    ...(has('backgroundMedia') ? { backgroundMedia: req.body.backgroundMedia?.trim() || null } : {}),
  };

  const contentErrors = validator.validatePanel2Content(content);
  const styleErrors = validator.validatePanel2Style(style);

  if (contentErrors.length || styleErrors.length) {
    req.cmsEditorOverride = { content, style };
    req.cmsEditorErrors = [...contentErrors, ...styleErrors];
    req.cmsEditorStatus = 422;
    return showPanel2(req, res, () => {});
  }

  try {
    await publishing.saveSectionDraft('home', 'showcase', content, style, { actorId: actorId(req) });

    return successRedirect(req, res, '/admin/page/home/panel-2', 'Borrador del Panel 2 guardado.');
  } catch (e) {
    console.error('Panel 2 save error:', e);
    req.cmsEditorOverride = { content, style };
    req.cmsEditorErrors = ['Error de servidor o base de datos. El borrador anterior no fue modificado.'];
    req.cmsEditorStatus = 500;
    return showPanel2(req, res, () => {});
  }
}

async function publishPanel2(req, res) {
  try {
    await publishing.publishSection('home', 'showcase', { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Panel 2 publicado.');
  } catch (e) {
    console.error('Panel 2 publish error:', e);
    return errorRedirect(req, res, '/admin/page/home/panel-2', ['Error al publicar.']);
  }
}

// ── LogoLoop items ──

async function createLogoLoopItem(req, res) {
  const errors = validator.validateLogoLoopItem(req.body);
  if (errors.length) return renderItemFailure(req, res, showPanel2, 'logo', errors);

  try {
    const section = await getSectionId('home', 'showcase');
    await repeatable.createItem('logo_loop_items', section.id, {
      item_type: req.body.item_type || 'text',
      text_content: req.body.text_content?.trim() || null,
      media_public_id: (req.body.media_public_id || '').replace('media://', '') || null,
      url: req.body.url?.trim() || null,
      link_type: req.body.link_type || 'internal',
      target: req.body.target || '_self',
      alt_text: req.body.alt_text?.trim() || null,
      is_visible: req.body.is_visible === '0' ? 0 : 1,
      status: 'draft',
      sort_order: 999,
    }, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Elemento agregado.');
  } catch (e) {
    console.error('Create logo loop item:', e);
    return renderItemFailure(req, res, showPanel2, 'logo', ['Error de servidor al crear el elemento.'], 500);
  }
}

async function saveLogoLoopItem(req, res) {
  const errors = validator.validateLogoLoopItem(req.body);
  if (errors.length) return renderItemFailure(req, res, showPanel2, 'logo', errors);
  try {
    await repeatable.saveItem('logo_loop_items', req.body.public_id, {
      item_type: req.body.item_type,
      text_content: req.body.text_content?.trim() || null,
      media_public_id: (req.body.media_public_id || '').replace('media://', '') || null,
      url: req.body.url?.trim() || null,
      link_type: req.body.link_type || 'internal',
      target: req.body.target || '_self',
      alt_text: req.body.alt_text?.trim() || null,
      is_visible: req.body.is_visible === '0' ? 0 : 1,
    }, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Elemento guardado.');
  } catch (e) {
    console.error('Save logo loop item:', e);
    return renderItemFailure(req, res, showPanel2, 'logo', ['Error de servidor al guardar el elemento.'], 500);
  }
}

async function archiveLogoLoopItem(req, res) {
  try {
    await repeatable.archiveItem('logo_loop_items', req.body.public_id, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Elemento archivado.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-2', ['Error al archivar.']);
  }
}

async function reorderLogoLoopItems(req, res) {
  try {
    const section = await getSectionId('home', 'showcase');
    let ids = req.body.ids;
    if (typeof ids === 'string') {
      ids = ids.split(',').map(s => s.trim()).filter(Boolean);
    } else if (!Array.isArray(ids)) {
      try { ids = JSON.parse(ids || '[]'); } catch { ids = []; }
    }
    await repeatable.reorderItems('logo_loop_items', section.id, ids, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Orden actualizado.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-2', ['Error al reordenar.']);
  }
}

async function publishLogoLoop(req, res) {
  try {
    const section = await getSectionId('home', 'showcase');
    await repeatable.publishCollection('logo_loop_items', section.id, 'logoLoop_home', { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'LogoLoop publicado.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-2', ['Error al publicar.']);
  }
}

// ── Carousel items ──

async function createCarouselItem(req, res) {
  const errors = validator.validateCarouselItem(req.body);
  if (errors.length) return renderItemFailure(req, res, showPanel2, 'carousel', errors);

  try {
    const section = await getSectionId('home', 'showcase');
    await repeatable.createItem('home_carousel_items', section.id, {
      eyebrow: req.body.eyebrow?.trim() || null,
      title: req.body.title?.trim(),
      description: req.body.description?.trim() || null,
      button_label: req.body.button_label?.trim() || null,
      button_url: req.body.button_url?.trim() || null,
      button_target: req.body.button_target || '_self',
      media_public_id: (req.body.media_public_id || '').replace('media://', '') || null,
      preview_media_public_id: (req.body.preview_media_public_id || '').replace('media://', '') || null,
      theme_key: req.body.theme_key?.trim() || null,
      is_visible: req.body.is_visible === '0' ? 0 : 1,
      status: 'draft',
      sort_order: 999,
    }, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Proyecto agregado.');
  } catch (e) {
    return renderItemFailure(req, res, showPanel2, 'carousel', ['Error de servidor al crear el proyecto.'], 500);
  }
}

async function saveCarouselItem(req, res) {
  const errors = validator.validateCarouselItem(req.body);
  if (errors.length) return renderItemFailure(req, res, showPanel2, 'carousel', errors);
  try {
    await repeatable.saveItem('home_carousel_items', req.body.public_id, {
      eyebrow: req.body.eyebrow?.trim() || null,
      title: req.body.title?.trim(),
      description: req.body.description?.trim() || null,
      button_label: req.body.button_label?.trim() || null,
      button_url: req.body.button_url?.trim() || null,
      button_target: req.body.button_target || '_self',
      media_public_id: (req.body.media_public_id || '').replace('media://', '') || null,
      preview_media_public_id: (req.body.preview_media_public_id || '').replace('media://', '') || null,
      theme_key: req.body.theme_key?.trim() || null,
      is_visible: req.body.is_visible === '0' ? 0 : 1,
    }, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Proyecto guardado.');
  } catch (e) {
    return renderItemFailure(req, res, showPanel2, 'carousel', ['Error de servidor al guardar el proyecto.'], 500);
  }
}

async function archiveCarouselItem(req, res) {
  try {
    await repeatable.archiveItem('home_carousel_items', req.body.public_id, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Proyecto archivado.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-2', ['Error al archivar.']);
  }
}

async function reorderCarouselItems(req, res) {
  try {
    const section = await getSectionId('home', 'showcase');
    let ids = req.body.ids;
    if (typeof ids === 'string') {
      ids = ids.split(',').map(s => s.trim()).filter(Boolean);
    } else if (!Array.isArray(ids)) {
      try { ids = JSON.parse(ids || '[]'); } catch { ids = []; }
    }
    await repeatable.reorderItems('home_carousel_items', section.id, ids, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Orden actualizado.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-2', ['Error al reordenar.']);
  }
}

async function publishCarousel(req, res) {
  try {
    const section = await getSectionId('home', 'showcase');
    await repeatable.publishCollection('home_carousel_items', section.id, 'carousel_home', { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-2', 'Carrusel publicado.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-2', ['Error al publicar.']);
  }
}

// ── Panel 3: Services ──

async function showPanel3(req, res, next) {
  try {
    const section = await getSectionId('home', 'services');
    if (!section) {
      const err = new Error('Sección services no encontrada.');
      err.status = 500;
      return next(err);
    }

    const storedContent = (typeof section.content_json === 'string' ? JSON.parse(section.content_json) : section.content_json) || {};
    const storedStyle = (typeof section.style_json === 'string' ? JSON.parse(section.style_json) : section.style_json) || {};
    const content = { ...storedContent, ...(req.cmsEditorOverride?.content || {}) };
    const style = { ...storedStyle, ...(req.cmsEditorOverride?.style || {}) };

    const items = await repeatable.listItems('home_feature_items', section.id);
    await resolveItemMediaData(items, ['media_public_id']);

    res.render('pages/admin/page/panel3', {
      title: 'Panel 3 — Servicios',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageScripts: ['/js/admin/media-selector.js', '/js/admin/panel3-editor.js', '/js/admin/cms-editor-state.js'],
      content,
      style,
      items,
      error: null,
      saved: null,
      fieldErrors: req.cmsEditorErrors || [],
      editorState: req.cmsEditorErrors?.length ? 'error' : consumeEditorState(req),
      pageAlerts: req.cmsEditorErrors?.length ? [{
        id: 'panel-3-validation',
        type: 'error',
        title: 'No se pudo guardar el borrador',
        description: req.cmsEditorErrors.join(' '),
        persistent: true,
      }] : [],
      submittedItem: req.cmsSubmittedItem || null,
    });
  } catch (e) {
    console.error('Panel 3 editor error:', e);
    return next(e);
  }
}

async function savePanel3Draft(req, res) {
  const section = await getSectionId('home', 'services');
  const storedContent = (typeof section.content_json === 'string' ? JSON.parse(section.content_json) : section.content_json) || {};
  const storedStyle = (typeof section.style_json === 'string' ? JSON.parse(section.style_json) : section.style_json) || {};
  const has = (name) => Object.prototype.hasOwnProperty.call(req.body, name);
  const content = {
    ...storedContent,
    ...(has('eyebrow') ? { eyebrow: req.body.eyebrow?.trim() || null } : {}),
    ...(has('heading') ? { heading: req.body.heading?.trim() || null } : {}),
    ...(has('description') ? { description: req.body.description?.trim() || null } : {}),
  };
  const style = {
    ...storedStyle,
    ...(has('backgroundColor') ? { backgroundColor: req.body.backgroundColor?.trim() || null } : {}),
    ...(has('textColor') ? { textColor: req.body.textColor?.trim() || null } : {}),
    ...(has('accentColor') ? { accentColor: req.body.accentColor?.trim() || null } : {}),
  };

  const contentErrors = validator.validatePanel3Content(content);
  const styleErrors = validator.validatePanel3Style(style);

  if (contentErrors.length || styleErrors.length) {
    req.cmsEditorOverride = { content, style };
    req.cmsEditorErrors = [...contentErrors, ...styleErrors];
    req.cmsEditorStatus = 422;
    return showPanel3(req, res, () => {});
  }

  try {
    await publishing.saveSectionDraft('home', 'services', content, style, { actorId: actorId(req) });

    return successRedirect(req, res, '/admin/page/home/panel-3', 'Borrador del Panel 3 guardado.');
  } catch (e) {
    console.error('Panel 3 save error:', e);
    req.cmsEditorOverride = { content, style };
    req.cmsEditorErrors = ['Error de servidor o base de datos. El borrador anterior no fue modificado.'];
    req.cmsEditorStatus = 500;
    return showPanel3(req, res, () => {});
  }
}

async function publishPanel3(req, res) {
  try {
    await publishing.publishSection('home', 'services', { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-3', 'Panel 3 publicado.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-3', ['Error al publicar.']);
  }
}

// ── Feature items ──

async function createFeatureItem(req, res) {
  const errors = validator.validateFeatureItem(req.body);
  if (errors.length) return renderItemFailure(req, res, showPanel3, 'feature', errors);
  try {
    const section = await getSectionId('home', 'services');
    await repeatable.createItem('home_feature_items', section.id, {
      title: req.body.title?.trim(),
      description: req.body.description?.trim() || null,
      detail_text: req.body.detail_text?.trim() || null,
      icon_type: req.body.icon_type || 'builtin',
      icon_key: req.body.icon_key?.trim() || null,
      media_public_id: (req.body.media_public_id || '').replace('media://', '') || null,
      url: req.body.url?.trim() || null,
      link_type: req.body.link_type || 'internal',
      target: req.body.target || '_self',
      style_variant: req.body.style_variant?.trim() || null,
      is_visible: req.body.is_visible === '0' ? 0 : 1,
      status: 'draft',
      sort_order: 999,
    }, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-3', 'Tarjeta agregada.');
  } catch (e) {
    return renderItemFailure(req, res, showPanel3, 'feature', ['Error de servidor al crear la tarjeta.'], 500);
  }
}

async function saveFeatureItem(req, res) {
  const errors = validator.validateFeatureItem(req.body);
  if (errors.length) return renderItemFailure(req, res, showPanel3, 'feature', errors);
  try {
    await repeatable.saveItem('home_feature_items', req.body.public_id, {
      title: req.body.title?.trim(),
      description: req.body.description?.trim() || null,
      detail_text: req.body.detail_text?.trim() || null,
      icon_type: req.body.icon_type || 'builtin',
      icon_key: req.body.icon_key?.trim() || null,
      media_public_id: (req.body.media_public_id || '').replace('media://', '') || null,
      url: req.body.url?.trim() || null,
      link_type: req.body.link_type || 'internal',
      target: req.body.target || '_self',
      style_variant: req.body.style_variant?.trim() || null,
      is_visible: req.body.is_visible === '0' ? 0 : 1,
    }, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-3', 'Tarjeta guardada.');
  } catch (e) {
    return renderItemFailure(req, res, showPanel3, 'feature', ['Error de servidor al guardar la tarjeta.'], 500);
  }
}

async function archiveFeatureItem(req, res) {
  try {
    await repeatable.archiveItem('home_feature_items', req.body.public_id, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-3', 'Tarjeta archivada.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-3', ['Error al archivar.']);
  }
}

async function reorderFeatureItems(req, res) {
  try {
    const section = await getSectionId('home', 'services');
    let ids = req.body.ids;
    if (typeof ids === 'string') {
      ids = ids.split(',').map(s => s.trim()).filter(Boolean);
    } else if (!Array.isArray(ids)) {
      try { ids = JSON.parse(ids || '[]'); } catch { ids = []; }
    }
    await repeatable.reorderItems('home_feature_items', section.id, ids, { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-3', 'Orden actualizado.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-3', ['Error al reordenar.']);
  }
}

async function publishFeatureItems(req, res) {
  try {
    const section = await getSectionId('home', 'services');
    await repeatable.publishCollection('home_feature_items', section.id, 'features_home', { actorId: actorId(req) });
    return successRedirect(req, res, '/admin/page/home/panel-3', 'Tarjetas publicadas.');
  } catch (e) {
    return errorRedirect(req, res, '/admin/page/home/panel-3', ['Error al publicar.']);
  }
}

module.exports = {
  showPanel2, savePanel2Draft, publishPanel2,
  createLogoLoopItem, saveLogoLoopItem, archiveLogoLoopItem, reorderLogoLoopItems, publishLogoLoop,
  createCarouselItem, saveCarouselItem, archiveCarouselItem, reorderCarouselItems, publishCarousel,
  showPanel3, savePanel3Draft, publishPanel3,
  createFeatureItem, saveFeatureItem, archiveFeatureItem, reorderFeatureItems, publishFeatureItems,
};
