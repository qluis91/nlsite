/**
 * Testimonials Admin Controller — Phase 2D.
 * List, create, edit, reorder, archive, publish, restore, activate/deactivate.
 */
const { generateToken } = require('../config/csrf');
const mediaService = require('../services/mediaService');
const testimonialService = require('../services/testimonialService');
const publicationService = require('../services/publicationService');
const cmsPublishingService = require('../services/cmsPublishingService');
const revisionService = require('../services/contentRevisionService');
const sectionValidator = require('../validators/testimonialsSectionValidator');
const { MODULE_KEYS } = require('../services/moduleRegistry');

const MODULE_KEY = MODULE_KEYS.TESTIMONIALS;
const BASE_PATH = '/admin/page/testimonials';

function actorId(req) { return req.session?.user?.id || null; }
function csrfFor(req) { try { return generateToken(req); } catch { return ''; } }
function hRaw(str) { return String(str || '').trim(); }

async function resolveAvatar(ref) {
  if (!ref?.startsWith('media://')) return null;
  try {
    const publicId = ref.replace('media://', '');
    return await mediaService.getByPublicId(publicId);
  } catch { return null; }
}

// ── List ──
async function showList(req, res, next) {
  try {
    const platform = String(req.query.platform || '').trim().toLowerCase() || null;
    const [testimonials, storedSection] = await Promise.all([
      testimonialService.listTestimonials(platform ? { platform } : {}),
      cmsPublishingService.getSectionDraft('home', 'testimonials'),
    ]);
    const section = storedSection || { id: null, status: 'draft', version: 0, content: sectionValidator.DEFAULT_SETTINGS };
    const settings = sectionValidator.normalizeTestimonialsSectionSettings(section.content);
    const revisions = section.id
      ? await revisionService.listRevisions('page_section', section.id, 5)
      : [];
    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;
    const sectionErrors = req.session?.testimonials_section_errors || [];
    const sectionForm = req.session?.testimonials_section_form || null;
    delete req.session.testimonials_section_errors;
    delete req.session.testimonials_section_form;

    res.render('pages/admin/page/testimonials/list', {
      title: 'Testimonios',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageModule: '',
      csrfToken: csrfFor(req),
      testimonials: testimonials.map(t => ({
        ...t,
        platformLabel: t.platform === 'other' ? 'Otro' : t.platform.charAt(0).toUpperCase() + t.platform.slice(1),
      })),
      platformFilter: platform || '',
      pageAlerts: pageAlerts.concat(sectionErrors.length ? [{
        id: 'testimonials-section-validation',
        type: 'error',
        title: 'No se pudo guardar la sección',
        description: sectionErrors.join(' '),
        persistent: true,
      }] : []),
      section,
      sectionSettings: sectionForm
        ? sectionValidator.normalizeTestimonialsSectionSettings(sectionForm)
        : settings,
      sectionErrors,
      revisions,
    });
  } catch (error) {
    next(error);
  }
}

// ── Create form ──
async function showCreate(req, res, next) {
  const flash = req.session?.cms_editor_state || {};
  if (req.session?.cms_editor_state) delete req.session.cms_editor_state;

  res.render('pages/admin/page/testimonials/form', {
    title: 'Nuevo Testimonio',
    layout: 'layouts/admin',
    pageStyles: ['/css/admin-page.css'],
    pageModule: '/js/admin/media-library.js',
    csrfToken: csrfFor(req),
    testimonial: null,
    avatar: null,
    form: flash.form || {},
    errors: flash.errors || [],
  });
}

// ── Edit form ──
async function showEdit(req, res, next) {
  try {
    const publicId = String(req.query.id || '').trim();
    if (!publicId) return res.redirect(BASE_PATH);

    const testimonial = await testimonialService.getTestimonial(publicId);
    if (!testimonial) {
      req.session.cms_alerts = [{ type: 'error', text: 'Testimonio no encontrado.' }];
      return res.redirect(BASE_PATH);
    }

    let avatar = null;
    if (testimonial.avatarMediaRef) avatar = await resolveAvatar(testimonial.avatarMediaRef);

    const flash = req.session?.cms_editor_state || {};
    if (req.session?.cms_editor_state) delete req.session.cms_editor_state;

    res.render('pages/admin/page/testimonials/form', {
      title: 'Editar Testimonio',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageModule: '/js/admin/media-library.js',
      csrfToken: csrfFor(req),
      testimonial: flash.form ? { ...testimonial, ...flash.form } : testimonial,
      avatar,
      form: flash.form || {},
      errors: flash.errors || [],
    });
  } catch (error) {
    next(error);
  }
}

// ── Save draft ──
async function saveDraft(req, res, next) {
  try {
    const publicId = String(req.body.publicId || '').trim();
    const userId = actorId(req);
    if (!userId) return res.redirect('/auth/login');

    const validation = await testimonialService.validateTestimonial(req.body);
    if (!validation.valid) {
      req.session.cms_editor_state = {
        form: {
          displayName: hRaw(req.body.displayName),
          testimonialText: req.body.testimonialText || '',
          platform: hRaw(req.body.platform),
          sourceUrl: hRaw(req.body.sourceUrl),
          avatarMediaRef: hRaw(req.body.avatarMediaRef),
          rating: req.body.rating || '',
          isFeatured: req.body.isFeatured,
          isActive: req.body.isActive,
        },
        errors: validation.errors,
      };
      return publicId
        ? res.redirect(`${BASE_PATH}/edit?id=${publicId}`)
        : res.redirect(`${BASE_PATH}/create`);
    }

    if (publicId) {
      await testimonialService.updateTestimonial(publicId, validation.sanitized, userId);
    } else {
      await testimonialService.createTestimonial(validation.sanitized, userId);
    }

    req.session.cms_alerts = [{ type: 'success', text: 'Borrador guardado.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    if (error.code === 'STALE_UPDATE') {
      req.session.cms_alerts = [{ type: 'error', text: error.message }];
      return res.redirect(BASE_PATH);
    }
    next(error);
  }
}

// ── Publish ──
async function publishTestimonial(req, res, next) {
  try {
    await publicationService.publishModules([MODULE_KEY], 'module', { actorId: actorId(req) });
    req.session.cms_alerts = [{ type: 'success', text: 'Publicación completada.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Restore from published snapshot ──
async function restoreTestimonialDraft(req, res, next) {
  try {
    const publicId = String(req.body.publicId || '').trim();
    const sourceRevisionId = req.body.sourceRevisionId ? Number(req.body.sourceRevisionId) : null;

    if (!publicId) {
      req.session.cms_alerts = [{ type: 'error', text: 'ID de testimonio requerido.' }];
      return res.redirect(BASE_PATH);
    }

    await testimonialService.restoreTestimonialDraft(publicId, actorId(req), sourceRevisionId);
    req.session.cms_alerts = [{ type: 'success', text: 'Testimonio restaurado como borrador. Publique para que los cambios sean visibles.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Archive ──
async function archiveTestimonial(req, res, next) {
  try {
    const publicId = String(req.body.publicId || '').trim();
    if (!publicId) return res.redirect(BASE_PATH);

    await testimonialService.archiveTestimonial(publicId, actorId(req));
    req.session.cms_alerts = [{ type: 'success', text: 'Testimonio archivado.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Reorder ──
async function reorderTestimonials(req, res, next) {
  try {
    const ids = String(req.body.order || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.redirect(BASE_PATH);

    await testimonialService.reorderTestimonials(ids, actorId(req));
    req.session.cms_alerts = [{ type: 'success', text: 'Orden actualizado.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Toggle active ──
async function toggleActive(req, res, next) {
  try {
    const publicId = String(req.body.publicId || '').trim();
    const active = req.body.active === '1' || req.body.active === 'true';
    if (!publicId) return res.redirect(BASE_PATH);

    await testimonialService.setActive(publicId, active, actorId(req));
    req.session.cms_alerts = [{ type: 'success', text: active ? 'Testimonio activado.' : 'Testimonio desactivado.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Section settings ──

async function saveSectionSettings(req, res, next) {
  try {
    const validation = sectionValidator.validateTestimonialsSectionSettings(req.body);
    if (!validation.valid) {
      req.session.testimonials_section_errors = validation.errors;
      req.session.testimonials_section_form = validation.sanitized;
      return res.redirect(BASE_PATH);
    }
    await cmsPublishingService.saveSectionDraft(
      'home', 'testimonials', validation.sanitized, {},
      { actorId: actorId(req), expectedVersion: req.body.version === '' ? null : Number(req.body.version) }
    );
    req.session.cms_alerts = [{ type: 'success', text: 'Configuración guardada como borrador. Publique para hacerla visible.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    if (error.code === 'CMS_VERSION_CONFLICT') {
      req.session.cms_alerts = [{ type: 'error', text: error.message }];
      return res.redirect(BASE_PATH);
    }
    next(error);
  }
}

async function publishSectionSettings(req, res, next) {
  try {
    await cmsPublishingService.publishSection('home', 'testimonials', { actorId: actorId(req) });
    req.session.cms_alerts = [{ type: 'success', text: 'Sección de testimonios publicada.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  showList,
  showCreate,
  showEdit,
  saveDraft,
  publishTestimonial,
  restoreTestimonialDraft,
  archiveTestimonial,
  reorderTestimonials,
  toggleActive,
  saveSectionSettings,
  publishSectionSettings,
};
