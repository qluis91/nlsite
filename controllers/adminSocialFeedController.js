/**
 * Social Feed Admin Controller — Phase 2A.
 * List, create, edit, reorder, archive, publish, restore, activate/deactivate.
 */
const { generateToken } = require('../config/csrf');
const mediaService = require('../services/mediaService');
const socialService = require('../services/socialFeedService');
const publicationService = require('../services/publicationService');
const cmsPublishingService = require('../services/cmsPublishingService');
const revisionService = require('../services/contentRevisionService');
const sectionValidator = require('../validators/socialFeedSectionValidator');
const { MODULE_KEYS } = require('../services/moduleRegistry');
const { REVISION_ENTITY_TYPES } = require('../config/cmsOptions');
const { describeAdminBehavior } = require('../services/socialEmbedService');

const MODULE_KEY = MODULE_KEYS.SOCIAL_FEED;
const BASE_PATH = '/admin/page/social-feed';

function actorId(req) { return req.session?.user?.id || null; }

async function resolveThumbnail(ref) {
  if (!ref?.startsWith('media://')) return null;
  try {
    const publicId = ref.replace('media://', '');
    return await mediaService.getByPublicId(publicId);
  } catch { return null; }
}

function csrfFor(req) {
  try { return generateToken(req); } catch { return ''; }
}

// ── List ──

async function showList(req, res, next) {
  try {
    const platform = String(req.query.platform || '').trim().toLowerCase() || null;
    const [posts, storedSection] = await Promise.all([
      socialService.listPosts(platform ? { platform } : {}),
      cmsPublishingService.getSectionDraft('home', 'social-feed'),
    ]);
    const section = storedSection || {
      id: null,
      status: 'draft',
      version: 0,
      content: sectionValidator.DEFAULT_SETTINGS,
    };
    const settings = sectionValidator.normalizeSocialFeedSettings(section.content);
    const revisions = section.id
      ? await revisionService.listRevisions('page_section', section.id, 5)
      : [];
    const pageAlerts = req.session?.cms_alerts || [];
    if (req.session?.cms_alerts) delete req.session.cms_alerts;
    const sectionErrors = req.session?.social_feed_section_errors || [];
    const sectionForm = req.session?.social_feed_section_form || null;
    delete req.session.social_feed_section_errors;
    delete req.session.social_feed_section_form;

    res.render('pages/admin/page/social-feed/list', {
      title: 'Social Feed',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageModule: '',
      pageScripts: ['/js/admin/cms-editor-state.js'],
      csrfToken: csrfFor(req),
      posts: posts.map((post) => ({
        ...post,
        embedPreview: describeAdminBehavior(post),
      })),
      platformFilter: platform || '',
      pageAlerts: pageAlerts.concat(sectionErrors.length ? [{
        id: 'social-feed-section-validation',
        type: 'error',
        title: 'No se pudo guardar la sección',
        description: sectionErrors.join(' '),
        persistent: true,
      }] : []),
      section,
      sectionSettings: sectionForm
        ? sectionValidator.normalizeSocialFeedSettings(sectionForm)
        : settings,
      sectionErrors,
      revisions,
    });
  } catch (error) {
    next(error);
  }
}

async function saveSectionSettings(req, res, next) {
  try {
    const validation = sectionValidator.validateSocialFeedSettings(req.body);
    if (!validation.valid) {
      req.session.social_feed_section_errors = validation.errors;
      req.session.social_feed_section_form = validation.sanitized;
      return res.redirect(BASE_PATH);
    }
    await cmsPublishingService.saveSectionDraft(
      'home',
      'social-feed',
      validation.sanitized,
      {},
      {
        actorId: actorId(req),
        expectedVersion: req.body.version === '' ? null : Number(req.body.version),
      }
    );
    req.session.cms_alerts = [{
      type: 'success',
      text: 'Configuración guardada como borrador. Publique para hacerla visible.',
    }];
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
    await cmsPublishingService.publishSection('home', 'social-feed', { actorId: actorId(req) });
    req.session.cms_alerts = [{ type: 'success', text: 'Sección “NinjaLab en redes” publicada.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Create form ──

async function showCreate(req, res, next) {
  const flash = req.session?.cms_editor_state || {};
  if (req.session?.cms_editor_state) delete req.session.cms_editor_state;

  res.render('pages/admin/page/social-feed/form', {
    title: 'Nuevo Post — Social Feed',
    layout: 'layouts/admin',
    pageStyles: ['/css/admin-page.css'],
    pageModule: '/js/admin/media-library.js',
    csrfToken: csrfFor(req),
    post: null,
    thumbnail: null,
    form: flash.form || {},
    errors: flash.errors || [],
  });
}

// ── Edit form ──

async function showEdit(req, res, next) {
  try {
    const publicId = String(req.query.id || '').trim();
    if (!publicId) return res.redirect(BASE_PATH);

    const post = await socialService.getPostForEdit(publicId);
    if (!post) {
      req.session.cms_alerts = [{ type: 'error', text: 'Post no encontrado.' }];
      return res.redirect(BASE_PATH);
    }

    let thumbnail = null;
    if (post.thumbnailMediaRef) thumbnail = await resolveThumbnail(post.thumbnailMediaRef);

    const flash = req.session?.cms_editor_state || {};
    if (req.session?.cms_editor_state) delete req.session.cms_editor_state;

    res.render('pages/admin/page/social-feed/form', {
      title: 'Editar Post — Social Feed',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageModule: '/js/admin/media-library.js',
      csrfToken: csrfFor(req),
      post: flash.form ? { ...post, ...flash.form } : post,
      thumbnail,
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

    const validation = await socialService.validatePost(req.body);
    if (!validation.valid) {
      // Preserve raw form values (not pre-escaped) for re-render
      req.session.cms_editor_state = {
        form: {
          platform: hRaw(req.body.platform),
          postUrl: hRaw(req.body.postUrl),
          title: hRaw(req.body.title),
          description: req.body.description || '',
          displayMode: hRaw(req.body.displayMode),
          thumbnailMediaRef: hRaw(req.body.thumbnailMediaRef),
          embedEnabled: req.body.embedEnabled,
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
      await socialService.updatePost(publicId, validation.sanitized, userId);
    } else {
      await socialService.createPost(validation.sanitized, userId);
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

async function publishPost(req, res, next) {
  try {
    const publicId = String(req.body.publicId || '').trim();
    if (!publicId) {
      req.session.cms_alerts = [{ type: 'error', text: 'ID de post requerido.' }];
      return res.redirect(BASE_PATH);
    }

    await publicationService.publishModules([MODULE_KEY], 'module', { actorId: actorId(req) });
    req.session.cms_alerts = [{ type: 'success', text: 'Publicación completada.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Restore from published snapshot ──

async function restorePostDraft(req, res, next) {
  try {
    const publicId = String(req.body.publicId || '').trim();
    const sourceRevisionId = req.body.sourceRevisionId
      ? Number(req.body.sourceRevisionId)
      : null;

    if (!publicId) {
      req.session.cms_alerts = [{ type: 'error', text: 'ID de post requerido.' }];
      return res.redirect(BASE_PATH);
    }

    await socialService.restorePostDraft(publicId, actorId(req), sourceRevisionId);
    req.session.cms_alerts = [{ type: 'success', text: 'Post restaurado como borrador. Publique para que los cambios sean visibles.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Archive ──

async function archivePost(req, res, next) {
  try {
    const publicId = String(req.body.publicId || '').trim();
    if (!publicId) return res.redirect(BASE_PATH);

    await socialService.archivePost(publicId, actorId(req));
    req.session.cms_alerts = [{ type: 'success', text: 'Post archivado.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

// ── Reorder ──

async function reorderPosts(req, res, next) {
  try {
    const ids = String(req.body.order || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.redirect(BASE_PATH);

    await socialService.reorderPosts(ids, actorId(req));
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

    await socialService.setActive(publicId, active, actorId(req));
    req.session.cms_alerts = [{ type: 'success', text: active ? 'Post activado.' : 'Post desactivado.' }];
    return res.redirect(BASE_PATH);
  } catch (error) {
    next(error);
  }
}

function hRaw(str) { return String(str || '').trim(); }

module.exports = {
  showList,
  showCreate,
  showEdit,
  saveDraft,
  publishPost,
  restorePostDraft,
  archivePost,
  reorderPosts,
  toggleActive,
  saveSectionSettings,
  publishSectionSettings,
};
