/**
 * Panel 2 & Panel 3 admin controller — Phase 11C.
 * Handles rendering editor UIs, save drafts, publish, and item CRUD.
 */
const publishing = require('../services/cmsPublishingService');
const repeatable = require('../services/cmsRepeatableService');
const mediaService = require('../services/mediaService');
const validator = require('../validators/cmsPanelsValidator');
const pool = require('../config/db');

// ── Helpers ──

function errorRedirect(res, url, errors) {
  return res.redirect(url + '?error=' + encodeURIComponent(errors.join('; ')));
}

function successRedirect(res, url, msg) {
  return res.redirect(url + '?saved=' + encodeURIComponent(msg));
}

async function getSectionId(pageKey, sectionKey) {
  const [[row]] = await pool.query(
    "SELECT s.id AS id, s.content_json AS content_json, s.style_json AS style_json, s.status AS status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ? LIMIT 1",
    [pageKey, sectionKey]
  );
  return row || null;
}

async function resolveMediaData(ref) {
  if (!ref) return null;
  const publicId = String(ref).replace(/^media:\/\//, '').trim();
  if (!publicId) return null;
  const [rows] = await pool.query(
    `SELECT public_id, title, original_name AS original_filename, mime_type, category,
            CASE
              WHEN width IS NOT NULL AND height IS NOT NULL THEN CONCAT(width, '×', height)
              ELSE ''
            END AS dimensions,
            thumbnail_path AS thumbnail_url,
            public_url AS url
       FROM media_assets
      WHERE public_id = ? AND status = 'active' AND deleted_at IS NULL
      LIMIT 1`,
    [publicId]
  );
  return rows[0] || null;
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

    const content = (typeof section.content_json === 'string' ? JSON.parse(section.content_json) : section.content_json) || {};
    const style = (typeof section.style_json === 'string' ? JSON.parse(section.style_json) : section.style_json) || {};

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

    res.render('pages/admin/page/panel2', {
      title: 'Panel 2 — Showcase',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageScripts: ['/js/admin/media-selector.js', '/js/admin/panel2-editor.js'],
      content,
      style,
      bgMedia,
      logoItems,
      carouselItems,
      error: req.query.error,
      saved: req.query.saved,
    });
  } catch (e) {
    console.error('Panel 2 editor error:', e);
    return next(e);
  }
}

async function savePanel2Draft(req, res) {
  const { eyebrow, heading, supportText, carouselLabel, logoLoopAriaLabel, backgroundColor, textColor, accentColor, backgroundMedia } = req.body;

  const contentErrors = validator.validatePanel2Content({ eyebrow, heading, supportText: supportText, carouselLabel, logoLoopAriaLabel });
  const styleErrors = validator.validatePanel2Style({ backgroundColor, textColor, accentColor });

  if (contentErrors.length || styleErrors.length) {
    return errorRedirect(res, '/admin/page/home/panel-2', [...contentErrors, ...styleErrors]);
  }

  try {
    const content = {
      eyebrow: eyebrow?.trim() || null,
      heading: heading?.trim() || null,
      supportText: supportText?.trim() || null,
      carouselLabel: carouselLabel?.trim() || null,
      logoLoopAriaLabel: logoLoopAriaLabel?.trim() || null,
    };
    const style = {
      backgroundColor: backgroundColor?.trim() || null,
      textColor: textColor?.trim() || null,
      accentColor: accentColor?.trim() || null,
      backgroundMedia: backgroundMedia?.trim() || null,
    };

    await publishing.saveSectionDraft('home', 'showcase', content, style, { actorId: req.user?.id });

    return successRedirect(res, '/admin/page/home/panel-2', 'Borrador guardado.');
  } catch (e) {
    console.error('Panel 2 save error:', e);
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al guardar.']);
  }
}

async function publishPanel2(req, res) {
  try {
    await publishing.publishSection('home', 'showcase', { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-2', 'Panel 2 publicado.');
  } catch (e) {
    console.error('Panel 2 publish error:', e);
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al publicar.']);
  }
}

// ── LogoLoop items ──

async function createLogoLoopItem(req, res) {
  const errors = validator.validateLogoLoopItem(req.body);
  if (errors.length) return errorRedirect(res, '/admin/page/home/panel-2', errors);

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
    }, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-2', 'Elemento agregado.');
  } catch (e) {
    console.error('Create logo loop item:', e);
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al crear elemento.']);
  }
}

async function saveLogoLoopItem(req, res) {
  const errors = validator.validateLogoLoopItem(req.body);
  if (errors.length) return errorRedirect(res, '/admin/page/home/panel-2', errors);
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
    }, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-2', 'Elemento guardado.');
  } catch (e) {
    console.error('Save logo loop item:', e);
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al guardar elemento.']);
  }
}

async function archiveLogoLoopItem(req, res) {
  try {
    await repeatable.archiveItem('logo_loop_items', req.body.public_id, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-2', 'Elemento archivado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al archivar.']);
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
    await repeatable.reorderItems('logo_loop_items', section.id, ids, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-2', 'Orden actualizado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al reordenar.']);
  }
}

async function publishLogoLoop(req, res) {
  try {
    const section = await getSectionId('home', 'showcase');
    await repeatable.publishCollection('logo_loop_items', section.id, 'logoLoop_home', { actorId: req.user?.id });
    // Ensure the section itself is published so items appear on the public homepage
    if (section.status !== 'published') {
      await publishing.publishSection('home', 'showcase', { actorId: req.user?.id });
    }
    return successRedirect(res, '/admin/page/home/panel-2', 'LogoLoop publicado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al publicar.']);
  }
}

// ── Carousel items ──

async function createCarouselItem(req, res) {
  const errors = validator.validateCarouselItem(req.body);
  if (errors.length) return errorRedirect(res, '/admin/page/home/panel-2', errors);

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
    }, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-2', 'Proyecto agregado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al crear proyecto.']);
  }
}

async function saveCarouselItem(req, res) {
  const errors = validator.validateCarouselItem(req.body);
  if (errors.length) return errorRedirect(res, '/admin/page/home/panel-2', errors);
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
    }, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-2', 'Proyecto guardado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al guardar proyecto.']);
  }
}

async function archiveCarouselItem(req, res) {
  try {
    await repeatable.archiveItem('home_carousel_items', req.body.public_id, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-2', 'Proyecto archivado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al archivar.']);
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
    await repeatable.reorderItems('home_carousel_items', section.id, ids, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-2', 'Orden actualizado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al reordenar.']);
  }
}

async function publishCarousel(req, res) {
  try {
    const section = await getSectionId('home', 'showcase');
    await repeatable.publishCollection('home_carousel_items', section.id, 'carousel_home', { actorId: req.user?.id });
    // Ensure the section itself is published so items appear on the public homepage
    if (section.status !== 'published') {
      await publishing.publishSection('home', 'showcase', { actorId: req.user?.id });
    }
    return successRedirect(res, '/admin/page/home/panel-2', 'Carrusel publicado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-2', ['Error al publicar.']);
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

    const content = (typeof section.content_json === 'string' ? JSON.parse(section.content_json) : section.content_json) || {};
    const style = (typeof section.style_json === 'string' ? JSON.parse(section.style_json) : section.style_json) || {};

    const items = await repeatable.listItems('home_feature_items', section.id);
    await resolveItemMediaData(items, ['media_public_id']);

    res.render('pages/admin/page/panel3', {
      title: 'Panel 3 — Servicios',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageScripts: ['/js/admin/media-selector.js', '/js/admin/panel3-editor.js'],
      content,
      style,
      items,
      error: req.query.error,
      saved: req.query.saved,
    });
  } catch (e) {
    console.error('Panel 3 editor error:', e);
    return next(e);
  }
}

async function savePanel3Draft(req, res) {
  const { eyebrow, heading, description, backgroundColor, textColor, accentColor } = req.body;

  const contentErrors = validator.validatePanel3Content({ eyebrow, heading, description });
  const styleErrors = validator.validatePanel3Style({ backgroundColor, textColor, accentColor });

  if (contentErrors.length || styleErrors.length) {
    return errorRedirect(res, '/admin/page/home/panel-3', [...contentErrors, ...styleErrors]);
  }

  try {
    const content = {
      eyebrow: eyebrow?.trim() || null,
      heading: heading?.trim() || null,
      description: description?.trim() || null,
    };
    const style = {
      backgroundColor: backgroundColor?.trim() || null,
      textColor: textColor?.trim() || null,
      accentColor: accentColor?.trim() || null,
    };

    await publishing.saveSectionDraft('home', 'services', content, style, { actorId: req.user?.id });

    return successRedirect(res, '/admin/page/home/panel-3', 'Borrador guardado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-3', ['Error al guardar.']);
  }
}

async function publishPanel3(req, res) {
  try {
    await publishing.publishSection('home', 'services', { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-3', 'Panel 3 publicado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-3', ['Error al publicar.']);
  }
}

// ── Feature items ──

async function createFeatureItem(req, res) {
  const errors = validator.validateFeatureItem(req.body);
  if (errors.length) return errorRedirect(res, '/admin/page/home/panel-3', errors);
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
    }, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-3', 'Tarjeta agregada.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-3', ['Error al crear tarjeta.']);
  }
}

async function saveFeatureItem(req, res) {
  const errors = validator.validateFeatureItem(req.body);
  if (errors.length) return errorRedirect(res, '/admin/page/home/panel-3', errors);
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
    }, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-3', 'Tarjeta guardada.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-3', ['Error al guardar tarjeta.']);
  }
}

async function archiveFeatureItem(req, res) {
  try {
    await repeatable.archiveItem('home_feature_items', req.body.public_id, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-3', 'Tarjeta archivada.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-3', ['Error al archivar.']);
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
    await repeatable.reorderItems('home_feature_items', section.id, ids, { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-3', 'Orden actualizado.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-3', ['Error al reordenar.']);
  }
}

async function publishFeatureItems(req, res) {
  try {
    const section = await getSectionId('home', 'services');
    await repeatable.publishCollection('home_feature_items', section.id, 'features_home', { actorId: req.user?.id });
    return successRedirect(res, '/admin/page/home/panel-3', 'Tarjetas publicadas.');
  } catch (e) {
    return errorRedirect(res, '/admin/page/home/panel-3', ['Error al publicar.']);
  }
}

module.exports = {
  showPanel2, savePanel2Draft, publishPanel2,
  createLogoLoopItem, saveLogoLoopItem, archiveLogoLoopItem, reorderLogoLoopItems, publishLogoLoop,
  createCarouselItem, saveCarouselItem, archiveCarouselItem, reorderCarouselItems, publishCarousel,
  showPanel3, savePanel3Draft, publishPanel3,
  createFeatureItem, saveFeatureItem, archiveFeatureItem, reorderFeatureItems, publishFeatureItems,
};
