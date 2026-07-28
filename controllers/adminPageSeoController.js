/**
 * Page-specific SEO controller — Phase 12B.
 * One editor per page key: home, store, gallery.
 */
const publishing = require('../services/cmsPublishingService');
const cmsContent = require('../services/cmsContentService');

const PAGES = Object.freeze([
  { key: 'home', label: 'Inicio', path: '/' },
  { key: 'store', label: 'Tienda', path: '/tienda' },
  { key: 'gallery', label: 'Galería', path: '/galeria' },
]);

const FIELDS = ['title', 'description', 'og_image', 'canonical', 'robots'];

function pageSettingKey(pageKey, field) {
  return `seo.${pageKey}.${field}`;
}

function allKeys() {
  const keys = [];
  for (const p of PAGES) {
    for (const f of FIELDS) {
      keys.push(pageSettingKey(p.key, f));
    }
  }
  return keys;
}

async function showPageSeo(req, res, next) {
  try {
    const requestedPage = req.cmsActivePage || req.query.page;
    const activePage = (requestedPage && PAGES.some(p => p.key === requestedPage))
      ? requestedPage
      : 'home';

    const storedSettings = await publishing.getDraftSettings(allKeys());
    const settings = { ...storedSettings, ...(req.cmsSeoOverride || {}) };
    const resolveMedia = async (ref) => {
      if (!ref) return null;
      return cmsContent.resolveMediaReference(ref, null);
    };

    // Resolve OG media for all pages
    const ogMedia = {};
    for (const p of PAGES) {
      const ogRef = settings[pageSettingKey(p.key, 'og_image')];
      ogMedia[p.key] = ogRef ? await resolveMedia(ogRef) : null;
    }

    res.status(req.cmsEditorStatus || 200).render('pages/admin/page/page-seo', {
      title: 'SEO por página',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageScripts: ['/js/admin/media-selector.js', '/js/admin/cms-editor-state.js'],
      pages: PAGES,
      activePage,
      settings,
      ogMedia,
      editorState: req.cmsEditorErrors?.length ? 'error' : (() => {
        if (!req.session) return null;
        const state = req.session.cms_editor_state || null;
        delete req.session.cms_editor_state;
        return state;
      })(),
      fieldErrors: req.cmsEditorErrors || [],
      pageAlerts: req.cmsEditorErrors?.length ? [{
        id: `page-seo-error-${activePage}`,
        type: 'error',
        title: 'No se pudo guardar el borrador',
        description: req.cmsEditorErrors.join(' '),
        persistent: true,
      }] : [],
      indexingModes: [
        { value: 'index,follow', label: 'Indexar y seguir (completo)' },
        { value: 'noindex,nofollow', label: 'No indexar ni seguir (oculto)' },
        { value: 'index,nofollow', label: 'Indexar pero no seguir' },
      ],
    });
  } catch (error) {
    next(error);
  }
}

async function savePageSeo(req, res, next) {
  const vals = { ...req.body };
  delete vals._csrf;
  const pageKey = vals.page_key;
  delete vals.page_key;
  try {
    if (!PAGES.some(p => p.key === pageKey)) {
      req.session.error_msg = 'Página no válida.';
      return res.redirect('/admin/page/page-seo');
    }

    const errors = [];
    if (String(vals.title || '').length > 120) errors.push('El título SEO no debe exceder 120 caracteres.');
    if (String(vals.description || '').length > 300) errors.push('La descripción SEO no debe exceder 300 caracteres.');
    if (String(vals.canonical || '').length > 500) errors.push('La URL canónica no debe exceder 500 caracteres.');
    if (vals.canonical) {
      try {
        const parsed = new URL(String(vals.canonical));
        if (!['http:', 'https:'].includes(parsed.protocol)) errors.push('La URL canónica debe usar HTTP o HTTPS.');
      } catch {
        errors.push('La URL canónica no es válida.');
      }
    }
    const allowedRobots = new Set(['', 'index,follow', 'noindex,nofollow', 'index,nofollow']);
    if (!allowedRobots.has(String(vals.robots || ''))) errors.push('El modo de indexación no es válido.');
    if (errors.length) {
      const settings = await publishing.getDraftSettings(allKeys());
      settings[pageSettingKey(pageKey, 'title')] = vals.title || '';
      settings[pageSettingKey(pageKey, 'description')] = vals.description || '';
      settings[pageSettingKey(pageKey, 'og_image')] = vals.og_image || '';
      settings[pageSettingKey(pageKey, 'canonical')] = vals.canonical || '';
      settings[pageSettingKey(pageKey, 'robots')] = vals.robots || '';
      return res.status(422).render('pages/admin/page/page-seo', {
        title: 'SEO por página',
        layout: 'layouts/admin',
        pageStyles: ['/css/admin-page.css'],
        pageScripts: ['/js/admin/media-selector.js', '/js/admin/cms-editor-state.js'],
        pages: PAGES,
        activePage: pageKey,
        settings,
        ogMedia: Object.fromEntries(PAGES.map((page) => [page.key, null])),
        indexingModes: [
          { value: 'index,follow', label: 'Indexar y seguir (completo)' },
          { value: 'noindex,nofollow', label: 'No indexar ni seguir (oculto)' },
          { value: 'index,nofollow', label: 'Indexar pero no seguir' },
        ],
        fieldErrors: errors,
        editorState: 'error',
        pageAlerts: [{
          id: `page-seo-validation-${pageKey}`,
          type: 'error',
          title: 'No se pudo guardar el borrador',
          description: errors.join(' '),
          persistent: true,
        }],
      });
    }

    const actorId = req.session.user?.id || null;
    const entries = [
      [pageSettingKey(pageKey, 'title'), vals.title || '', 'string', 'seo'],
      [pageSettingKey(pageKey, 'description'), vals.description || '', 'string', 'seo'],
      [pageSettingKey(pageKey, 'og_image'), vals.og_image || '', 'media', 'seo'],
      [pageSettingKey(pageKey, 'canonical'), vals.canonical || '', 'string', 'seo'],
      [pageSettingKey(pageKey, 'robots'), vals.robots || '', 'string', 'seo'],
    ];

    await publishing.saveSettingsDraft(entries, { actorId });

    req.session.success_msg = `SEO de "${PAGES.find(p => p.key === pageKey).label}" guardado como borrador.`;
    req.session.cms_editor_state = 'saved';
    return res.redirect(`/admin/page/page-seo?page=${pageKey}`);
  } catch (error) {
    req.cmsActivePage = PAGES.some((page) => page.key === pageKey) ? pageKey : 'home';
    req.cmsSeoOverride = {
      [pageSettingKey(req.cmsActivePage, 'title')]: vals.title || '',
      [pageSettingKey(req.cmsActivePage, 'description')]: vals.description || '',
      [pageSettingKey(req.cmsActivePage, 'og_image')]: vals.og_image || '',
      [pageSettingKey(req.cmsActivePage, 'canonical')]: vals.canonical || '',
      [pageSettingKey(req.cmsActivePage, 'robots')]: vals.robots || '',
    };
    req.cmsEditorErrors = ['Error de servidor o base de datos. El borrador anterior no fue modificado.'];
    req.cmsEditorStatus = 500;
    return showPageSeo(req, res, next);
  }
}

async function publishPageSeo(req, res, next) {
  const requestedPage = String(req.body.page_key || '');
  try {
    const pageKey = requestedPage;
    if (!PAGES.some((page) => page.key === pageKey)) {
      req.session.error_msg = 'Página no válida.';
      return res.redirect('/admin/page/page-seo');
    }
    const keys = FIELDS.map((field) => pageSettingKey(pageKey, field));
    await publishing.publishSettings(keys, { actorId: req.session.user?.id || null });
    req.session.success_msg = `SEO de "${PAGES.find((page) => page.key === pageKey).label}" publicado.`;
    req.session.cms_editor_state = 'published';
    return res.redirect(`/admin/page/page-seo?page=${pageKey}`);
  } catch (error) {
    req.cmsActivePage = PAGES.some((page) => page.key === requestedPage) ? requestedPage : 'home';
    req.cmsEditorErrors = ['Error de servidor o base de datos al publicar el SEO.'];
    req.cmsEditorStatus = 500;
    return showPageSeo(req, res, next);
  }
}

module.exports = { showPageSeo, savePageSeo, publishPageSeo, PAGES, allKeys, pageSettingKey };
