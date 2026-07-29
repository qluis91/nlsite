/**
 * Store Hero CMS — Phase 1F.
 * Editor for the general Store hero (st-hero section on tienda page).
 */
const crypto = require('node:crypto');
const publishing = require('../services/cmsPublishingService');
const mediaService = require('../services/mediaService');
const pool = require('../config/db');
const publicationService = require('../services/publicationService');
const { generateToken } = require('../config/csrf');

const STORE_HERO_PATH = '/admin/page/store-hero';
const MODULE_STORE_HERO = 'tienda.st-hero';

function actorId(req) { return req.session?.user?.id || null; }

// ── Helpers ──

function h(str) { return String(str || '').trim(); }

function safeUrl(value) {
  const v = h(value);
  if (!v) return '';
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return '';
}

const VALID_TARGETS = new Set(['_self', '_blank']);

async function renderEditor(req, res, overrides = {}) {
  const stored = await publishing.getSectionDraft('tienda', 'st-hero');
  const section = stored || {};
  const content = section.content || {};
  const style = section.style || {};

  const mediaRef = content.backgroundMedia || '';
  const publicId = mediaRef.replace('media://', '');
  let bgMedia = null;
  if (publicId) {
    try { bgMedia = await mediaService.getByPublicId(publicId); } catch (_) {}
  }

  const modelList = { items: [] };
  try {
    const modelAssets = await mediaService.listAssets({ kind: 'model', status: 'active', limit: 20 });
    modelList.items = modelAssets.items || [];
  } catch (_) {}

  return res.status(overrides.status || 200).render('pages/admin/page/store-hero', {
    title: 'Hero de Tienda',
    layout: 'layouts/admin',
    pageStyles: ['/css/admin-page.css'],
    pageModule: '/js/admin/media-library.js',
    csrfToken: generateToken(req),
    section,
    content,
    style,
    bgMedia,
    modelList,
    storeHeroPath: STORE_HERO_PATH,
    editorState: overrides.editorState || null,
    fieldErrors: overrides.fieldErrors || [],
    submittedContent: overrides.submittedContent || null,
    pageAlerts: overrides.pageAlerts || [],
  });
}

// ── Validation ──

function validateStoreHero(body) {
  const errors = [];
  const content = {};

  // Required fields
  content.eyebrow = h(body.eyebrow).slice(0, 120);
  content.title = h(body.title);
  if (!content.title) errors.push('El título es obligatorio.');
  if (content.title.length > 160) content.title = content.title.slice(0, 160);

  content.description = h(body.description).slice(0, 500);
  content.imageAlt = h(body.imageAlt).slice(0, 200);
  content.imagePosition = ['center', 'top', 'bottom', 'left', 'right'].includes(h(body.imagePosition))
    ? h(body.imagePosition) : 'center';

  content.primaryLabel = h(body.primaryLabel).slice(0, 80);
  content.primaryUrl = safeUrl(body.primaryUrl).slice(0, 500);
  if (body.primaryUrl && h(body.primaryUrl) && !content.primaryUrl) {
    errors.push('La URL del botón debe comenzar con / o https://.');
  }
  if (content.primaryLabel && !content.primaryUrl) {
    // Label without URL is ok but button won't render
  }

  content.buttonTarget = VALID_TARGETS.has(h(body.buttonTarget)) ? h(body.buttonTarget) : '_self';
  content.ariaLabel = h(body.ariaLabel).slice(0, 160);
  content.backgroundMedia = h(body.backgroundMedia).slice(0, 500);
  content.isVisible = body.isVisible === '1' || body.isVisible === 'true' || body.isVisible === true;

  const errorsSummary = errors.length ? errors : null;
  return { valid: !errorsSummary, error: errorsSummary, value: content, errors: errorsSummary };
}

// ── Route handlers ──

async function showStoreHero(req, res, next) {
  try {
    const editorState = req.session?.cms_editor_state || null;
    if (req.session?.cms_editor_state) delete req.session.cms_editor_state;
    return await renderEditor(req, res, { editorState });
  } catch (error) {
    return next(error);
  }
}

async function saveStoreHeroDraft(req, res, next) {
  try {
    const validation = validateStoreHero(req.body);
    if (validation.errors && validation.errors.length) {
      return await renderEditor(req, res, {
        status: 422,
        fieldErrors: validation.errors,
        editorState: 'error',
        submittedContent: validation.value,
        pageAlerts: [{
          id: 'store-hero-validation',
          type: 'error',
          title: 'No se pudo guardar el borrador',
          description: validation.errors.join(' '),
          persistent: true,
        }],
      });
    }

    const content = validation.value;

    // Verify media reference
    if (content.backgroundMedia) {
      const publicId = content.backgroundMedia.replace('media://', '');
      const asset = await mediaService.getByPublicId(publicId);
      if (!asset) {
        return await renderEditor(req, res, {
          status: 422,
          fieldErrors: ['El recurso multimedia seleccionado no existe o está archivado.'],
          editorState: 'error',
          submittedContent: content,
          pageAlerts: [{
            id: 'store-hero-media',
            type: 'error',
            title: 'Medio no válido',
            description: 'El recurso multimedia seleccionado no existe o está archivado.',
            persistent: true,
          }],
        });
      }
    }

    const style = {};

    await publishing.saveSectionDraft('tienda', 'st-hero', content, style, {
      actorId: actorId(req),
    });

    req.session.success_msg = 'Borrador del Hero de Tienda guardado.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(STORE_HERO_PATH);
  } catch (error) {
    try {
      return await renderEditor(req, res, {
        status: error.status === 422 ? 422 : 500,
        fieldErrors: [error.message || 'No fue posible guardar el borrador.'],
        editorState: 'error',
        pageAlerts: [{
          id: 'store-hero-error',
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

async function publishStoreHero(req, res, next) {
  try {
    await publicationService.publishModules([MODULE_STORE_HERO], 'module', { actorId: actorId(req) });
    req.session.success_msg = 'Hero de Tienda publicado. Los cambios ahora son visibles en la tienda.';
    req.session.cms_editor_state = 'published';
    return res.redirect(STORE_HERO_PATH);
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    req.session.error_msg = error.message || 'No fue posible publicar.';
    return res.redirect(STORE_HERO_PATH);
  }
}

module.exports = { showStoreHero, saveStoreHeroDraft, publishStoreHero };
