const publishing = require('../services/cmsPublishingService');
const publicationService = require('../services/publicationService');
const mediaService = require('../services/mediaService');
const { generateToken } = require('../config/csrf');
const { DEFAULT_ABOUT_CONTENT } = require('../scripts/migrate-about-page-cms');

const ADMIN_PATH = '/admin/page/nosotros';
const MODULE_KEY = 'nosotros.about-content';
const SECTION_KEYS = Object.freeze(['history', 'mission', 'capabilities', 'values', 'process']);
const TARGETS = new Set(['_self', '_blank']);
const MEDIA_REFERENCE = /^media:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value, max) {
  return String(value || '').trim().slice(0, max);
}

function checkbox(value) {
  return value === '1' || value === 'true' || value === true || value === 'on';
}

function safeUrl(value) {
  const raw = text(value, 500);
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function mediaReference(value, errors, label) {
  const ref = text(value, 100);
  if (!ref) return '';
  if (!MEDIA_REFERENCE.test(ref)) {
    errors.push(`${label} debe seleccionarse desde la Biblioteca multimedia.`);
    return ref;
  }
  return ref;
}

function validateAboutPage(body) {
  const errors = [];
  const heroTitle = text(body.heroTitle, 160);
  if (!heroTitle) errors.push('El título principal es obligatorio.');

  const rawCtaUrl = text(body.ctaUrl, 500);
  const ctaUrl = safeUrl(rawCtaUrl);
  if (rawCtaUrl && !ctaUrl) errors.push('La URL del CTA debe ser interna o HTTP(S).');
  const rawCanonical = text(body.seoCanonical, 500);
  const canonical = safeUrl(rawCanonical);
  if (rawCanonical && !canonical) errors.push('La URL canónica debe ser interna o HTTP(S).');

  const sections = SECTION_KEYS.map((key, index) => {
    const rawOrder = Number.parseInt(body[`section_${key}_order`], 10);
    const order = Number.isInteger(rawOrder) && rawOrder >= 0 && rawOrder <= 999
      ? rawOrder
      : (index + 1) * 10;
    if (body[`section_${key}_order`] && (!Number.isInteger(rawOrder) || rawOrder < 0 || rawOrder > 999)) {
      errors.push(`El orden de ${key} debe estar entre 0 y 999.`);
    }
    return {
      key,
      heading: text(body[`section_${key}_heading`], 160),
      text: text(body[`section_${key}_text`], 4000),
      media: mediaReference(body[`section_${key}_media`], errors, `La imagen de ${key}`),
      alt: text(body[`section_${key}_alt`], 240),
      visible: checkbox(body[`section_${key}_visible`]),
      order,
    };
  });

  const value = {
    isVisible: checkbox(body.isVisible),
    hero: {
      eyebrow: text(body.heroEyebrow, 120),
      title: heroTitle,
      description: text(body.heroDescription, 1000),
      media: mediaReference(body.heroMedia, errors, 'La imagen principal'),
      alt: text(body.heroAlt, 240),
    },
    sections,
    cta: {
      heading: text(body.ctaHeading, 160),
      text: text(body.ctaText, 1000),
      label: text(body.ctaLabel, 80),
      url: ctaUrl || rawCtaUrl,
      target: TARGETS.has(body.ctaTarget) ? body.ctaTarget : '_self',
      visible: checkbox(body.ctaVisible),
    },
    seo: {
      title: text(body.seoTitle, 160),
      description: text(body.seoDescription, 320),
      canonical: canonical || rawCanonical,
      ogMedia: mediaReference(body.seoOgMedia, errors, 'La imagen Open Graph'),
    },
    accessibility: { ariaLabel: text(body.ariaLabel, 180) },
  };
  return { value, errors };
}

async function resolveAdminMedia(reference) {
  if (!MEDIA_REFERENCE.test(String(reference || ''))) return null;
  try {
    return await mediaService.getByPublicId(reference.slice('media://'.length));
  } catch {
    return null;
  }
}

function contentMediaReferences(content) {
  return [
    content?.hero?.media,
    ...(content?.sections || []).map((section) => section.media),
    content?.seo?.ogMedia,
  ].filter(Boolean);
}

async function validateNewMediaReferences(content) {
  const stored = await publishing.getSectionDraft('nosotros', 'about-content');
  const storedRefs = new Set(contentMediaReferences(stored?.content));
  const errors = [];
  for (const reference of new Set(contentMediaReferences(content))) {
    if (storedRefs.has(reference) || !MEDIA_REFERENCE.test(reference)) continue;
    const asset = await mediaService.getByPublicId(reference.slice('media://'.length)).catch(() => null);
    if (!asset || asset.status !== 'active' || asset.deleted_at) {
      errors.push('Los medios nuevos deben seleccionarse desde la Biblioteca multimedia y estar activos.');
    }
  }
  return errors;
}

async function renderEditor(req, res, overrides = {}) {
  const stored = await publishing.getSectionDraft('nosotros', 'about-content');
  const content = overrides.submittedContent || stored?.content || DEFAULT_ABOUT_CONTENT;
  const mediaRefs = [
    content.hero?.media,
    ...(content.sections || []).map((section) => section.media),
    content.seo?.ogMedia,
  ];
  const resolved = await Promise.all(mediaRefs.map(resolveAdminMedia));
  const mediaByRef = {};
  mediaRefs.forEach((ref, index) => { if (ref) mediaByRef[ref] = resolved[index]; });

  return res.status(overrides.status || 200).render('pages/admin/page/about', {
    title: 'Página Nosotros',
    layout: 'layouts/admin',
    pageStyles: ['/css/admin-page.css'],
    pageScripts: ['/js/admin/media-selector.js', '/js/admin/cms-editor-state.js'],
    csrfToken: generateToken(req),
    section: stored || {},
    content,
    mediaByRef,
    sectionKeys: SECTION_KEYS,
    editorState: overrides.editorState || null,
    fieldErrors: overrides.fieldErrors || [],
    pageAlerts: overrides.pageAlerts || [],
  });
}

async function showAboutPage(req, res, next) {
  try {
    const editorState = req.session?.cms_editor_state || null;
    if (req.session?.cms_editor_state) delete req.session.cms_editor_state;
    return await renderEditor(req, res, { editorState });
  } catch (error) {
    return next(error);
  }
}

async function saveAboutPageDraft(req, res, next) {
  const validation = validateAboutPage(req.body);
  try {
    if (!validation.errors.length) {
      validation.errors.push(...await validateNewMediaReferences(validation.value));
    }
  } catch (error) {
    return next(error);
  }
  if (validation.errors.length) {
    return renderEditor(req, res, {
      status: 422,
      submittedContent: validation.value,
      fieldErrors: validation.errors,
      editorState: 'error',
      pageAlerts: [{
        id: 'about-validation',
        type: 'error',
        title: 'No se pudo guardar el borrador',
        description: validation.errors.join(' '),
        persistent: true,
      }],
    }).catch(next);
  }
  try {
    await publishing.saveSectionDraft('nosotros', 'about-content', validation.value, {}, {
      actorId: req.session?.user?.id || null,
      expectedVersion: req.body.version,
    });
    req.session.success_msg = 'Borrador de la Página Nosotros guardado.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(ADMIN_PATH);
  } catch (error) {
    return renderEditor(req, res, {
      status: error.code === 'CMS_VERSION_CONFLICT' ? 409 : 500,
      submittedContent: validation.value,
      fieldErrors: [error.message || 'No fue posible guardar el borrador.'],
      editorState: 'error',
      pageAlerts: [{
        id: error.code === 'CMS_VERSION_CONFLICT' ? 'about-concurrency' : 'about-save-error',
        type: error.code === 'CMS_VERSION_CONFLICT' ? 'warning' : 'error',
        title: error.code === 'CMS_VERSION_CONFLICT' ? 'El borrador cambió' : 'Error al guardar',
        description: error.message || 'No se modificó el borrador almacenado.',
        persistent: true,
      }],
    }).catch(next);
  }
}

async function publishAboutPage(req, res, next) {
  try {
    await publicationService.publishModules([MODULE_KEY], 'module', {
      actorId: req.session?.user?.id || null,
    });
    req.session.success_msg = 'Página Nosotros publicada.';
    req.session.cms_editor_state = 'published';
    return res.redirect(ADMIN_PATH);
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    req.session.error_msg = error.message || 'No fue posible publicar la Página Nosotros.';
    return res.redirect(ADMIN_PATH);
  }
}

module.exports = {
  SECTION_KEYS,
  MEDIA_REFERENCE,
  safeUrl,
  validateAboutPage,
  showAboutPage,
  saveAboutPageDraft,
  publishAboutPage,
};
