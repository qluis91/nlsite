/**
 * Global Settings & SEO controller — Phase 12A.
 */
const publishing = require('../services/cmsPublishingService');
const cmsContent = require('../services/cmsContentService');
const { validateGlobalSettings } = require('../validators/cmsPanelsValidator');

const GLOBAL_SETTING_KEYS = [
  'global.site_name',
  'global.seo_title',
  'global.seo_description',
  'global.og_image',
  'global.canonical_url',
  'global.indexing_mode',
  'site.favicon',
  'global.ga_measurement_id',
  'global.ga_enabled',
  'global.ga_consent_enabled',
  'global.google_verification',
];

async function showGlobalSettings(req, res, next) {
  try {
    const settings = await publishing.getPublishedSettings(GLOBAL_SETTING_KEYS);

    const resolveMedia = async (ref) => {
      if (!ref) return null;
      return cmsContent.resolveMediaReference(ref, null);
    };

    const [ogImage, favicon] = await Promise.all([
      resolveMedia(settings['global.og_image']),
      resolveMedia(settings['site.favicon']),
    ]);

    res.render('pages/admin/page/global-settings', {
      title: 'Configuración global y SEO',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageScripts: ['/js/admin/media-selector.js'],
      settings,
      ogImage,
      favicon,
      indexingModes: [
        { value: 'index,follow', label: 'Indexar y seguir enlaces (completo)' },
        { value: 'noindex,nofollow', label: 'No indexar ni seguir (oculto)' },
        { value: 'index,nofollow', label: 'Indexar pero no seguir enlaces' },
      ],
    });
  } catch (error) {
    next(error);
  }
}

async function saveGlobalSettings(req, res, next) {
  try {
    const vals = { ...req.body };
    delete vals._csrf;

    const errors = validateGlobalSettings(vals);
    if (errors.length) {
      return res.render('pages/admin/page/global-settings', {
        title: 'Configuración global y SEO',
        layout: 'layouts/admin',
        pageStyles: ['/css/admin-page.css'],
        pageScripts: ['/js/admin/media-selector.js'],
        settings: await publishing.getPublishedSettings(GLOBAL_SETTING_KEYS),
        ogImage: null,
        favicon: null,
        error_msg: errors.join('<br>'),
        indexingModes: [
          { value: 'index,follow', label: 'Indexar y seguir enlaces (completo)' },
          { value: 'noindex,nofollow', label: 'No indexar ni seguir (oculto)' },
          { value: 'index,nofollow', label: 'Indexar pero no seguir enlaces' },
        ],
      });
    }

    const actorId = req.session.user?.id || null;

    const entries = [
      ['global.site_name', vals.site_name || '', 'string', 'global'],
      ['global.seo_title', vals.seo_title || '', 'string', 'seo'],
      ['global.seo_description', vals.seo_description || '', 'string', 'seo'],
      ['global.og_image', vals.og_image || '', 'media', 'seo'],
      ['global.canonical_url', vals.canonical_url || '', 'string', 'seo'],
      ['global.indexing_mode', vals.indexing_mode || '', 'string', 'seo'],
      ['site.favicon', vals.favicon || '', 'media', 'navbar'],
      ['global.ga_measurement_id', (vals.ga_measurement_id || '').trim().toUpperCase().slice(0, 30), 'string', 'analytics'],
      ['global.ga_enabled', vals.ga_enabled === '1' ? '1' : '0', 'flag', 'analytics'],
      ['global.ga_consent_enabled', vals.ga_consent_enabled === '1' ? '1' : '0', 'flag', 'analytics'],
      ['global.google_verification', (vals.google_verification || '').trim().slice(0, 128), 'string', 'analytics'],
    ];

    for (const [key, value, type, group] of entries) {
      await publishing.upsertSetting(key, value, type, {
        settingGroup: group,
        isPublic: true,
        actorId,
      });
    }

    req.session.success_msg = 'Configuración global guardada como borrador.';
    return res.redirect('/admin/page/global-settings');
  } catch (error) {
    next(error);
  }
}

async function publishGlobalSettings(req, res, next) {
  try {
    // Publish all global settings: upsert each setting (already in DB as draft),
    // then invalidate the siteSettings cache so public pages pick up new values.
    // The act of calling upsertSetting already invalidates per-key cache.
    // Re-invalidate the full namespace for safety.
    publishing.flushCache();

    req.session.success_msg = 'Configuración global publicada.';
    return res.redirect('/admin/page/global-settings');
  } catch (error) {
    next(error);
  }
}

module.exports = { showGlobalSettings, saveGlobalSettings, publishGlobalSettings };
