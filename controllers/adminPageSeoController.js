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
    const activePage = (req.query.page && PAGES.some(p => p.key === req.query.page))
      ? req.query.page
      : 'home';

    const settings = await publishing.getPublishedSettings(allKeys());
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

    res.render('pages/admin/page/page-seo', {
      title: 'SEO por página',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageScripts: ['/js/admin/media-selector.js'],
      pages: PAGES,
      activePage,
      settings,
      ogMedia,
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
  try {
    const vals = { ...req.body };
    delete vals._csrf;
    const pageKey = vals.page_key;
    delete vals.page_key;

    if (!PAGES.some(p => p.key === pageKey)) {
      req.session.error_msg = 'Página no válida.';
      return res.redirect('/admin/page/page-seo');
    }

    const actorId = req.session.user?.id || null;
    const entries = [
      [pageSettingKey(pageKey, 'title'), vals.title || '', 'string', 'seo'],
      [pageSettingKey(pageKey, 'description'), vals.description || '', 'string', 'seo'],
      [pageSettingKey(pageKey, 'og_image'), vals.og_image || '', 'media', 'seo'],
      [pageSettingKey(pageKey, 'canonical'), vals.canonical || '', 'string', 'seo'],
      [pageSettingKey(pageKey, 'robots'), vals.robots || '', 'string', 'seo'],
    ];

    for (const [key, value, type, group] of entries) {
      await publishing.upsertSetting(key, value, type, {
        settingGroup: group,
        isPublic: true,
        actorId,
      });
    }

    req.session.success_msg = `SEO de "${PAGES.find(p => p.key === pageKey).label}" guardado como borrador.`;
    return res.redirect(`/admin/page/page-seo?page=${pageKey}`);
  } catch (error) {
    next(error);
  }
}

async function publishPageSeo(req, res, next) {
  try {
    publishing.flushCache();
    req.session.success_msg = 'Configuración de SEO por página publicada.';
    return res.redirect('/admin/page/page-seo');
  } catch (error) {
    next(error);
  }
}

module.exports = { showPageSeo, savePageSeo, publishPageSeo, PAGES, allKeys, pageSettingKey };
