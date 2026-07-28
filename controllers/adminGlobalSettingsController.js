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

function settingsFromSubmission(vals) {
  return {
    'global.site_name': vals.site_name || '',
    'global.seo_title': vals.seo_title || '',
    'global.seo_description': vals.seo_description || '',
    'global.og_image': vals.og_image || '',
    'global.canonical_url': vals.canonical_url || '',
    'global.indexing_mode': vals.indexing_mode || '',
    'site.favicon': vals.favicon || '',
    'global.ga_measurement_id': vals.ga_measurement_id || '',
    'global.ga_enabled': vals.ga_enabled === '1' ? '1' : '0',
    'global.ga_consent_enabled': vals.ga_consent_enabled === '1' ? '1' : '0',
    'global.google_verification': vals.google_verification || '',
  };
}

async function showGlobalSettings(req, res, next) {
  try {
    const storedSettings = await publishing.getDraftSettings(GLOBAL_SETTING_KEYS);
    const settings = { ...storedSettings, ...(req.cmsSettingsOverride || {}) };

    const resolveMedia = async (ref) => {
      if (!ref) return null;
      return cmsContent.resolveMediaReference(ref, null);
    };

    const [ogImage, favicon] = await Promise.all([
      resolveMedia(settings['global.og_image']),
      resolveMedia(settings['site.favicon']),
    ]);

    res.status(req.cmsEditorStatus || 200).render('pages/admin/page/global-settings', {
      title: 'Configuración global y SEO',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-page.css'],
      pageScripts: ['/js/admin/media-selector.js', '/js/admin/cms-editor-state.js'],
      settings,
      ogImage,
      favicon,
      editorState: req.cmsEditorErrors?.length ? 'error' : (() => {
        if (!req.session) return null;
        const state = req.session.cms_editor_state || null;
        delete req.session.cms_editor_state;
        return state;
      })(),
      fieldErrors: req.cmsEditorErrors || [],
      pageAlerts: req.cmsEditorErrors?.length ? [{
        id: 'global-settings-validation',
        type: 'error',
        title: 'No se pudo guardar el borrador',
        description: req.cmsEditorErrors.join(' '),
        persistent: true,
      }] : [],
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
      return res.status(422).render('pages/admin/page/global-settings', {
        title: 'Configuración global y SEO',
        layout: 'layouts/admin',
        pageStyles: ['/css/admin-page.css'],
        pageScripts: ['/js/admin/media-selector.js', '/js/admin/cms-editor-state.js'],
        settings: Object.fromEntries([
          ['global.site_name', vals.site_name || ''],
          ['global.seo_title', vals.seo_title || ''],
          ['global.seo_description', vals.seo_description || ''],
          ['global.og_image', vals.og_image || ''],
          ['global.canonical_url', vals.canonical_url || ''],
          ['global.indexing_mode', vals.indexing_mode || ''],
          ['site.favicon', vals.favicon || ''],
          ['global.ga_measurement_id', vals.ga_measurement_id || ''],
          ['global.ga_enabled', vals.ga_enabled === '1' ? '1' : '0'],
          ['global.ga_consent_enabled', vals.ga_consent_enabled === '1' ? '1' : '0'],
          ['global.google_verification', vals.google_verification || ''],
        ]),
        ogImage: null,
        favicon: null,
        fieldErrors: errors,
        pageAlerts: [{
          id: 'global-settings-validation',
          type: 'error',
          title: 'No se pudo guardar el borrador',
          description: errors.join(' '),
          persistent: true,
        }],
        editorState: 'error',
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

    await publishing.saveSettingsDraft(entries, { actorId });

    req.session.success_msg = 'Configuración global guardada como borrador.';
    req.session.cms_editor_state = 'saved';
    return res.redirect('/admin/page/global-settings');
  } catch (error) {
    req.cmsSettingsOverride = settingsFromSubmission(req.body || {});
    req.cmsEditorErrors = ['Error de servidor o base de datos. El borrador anterior no fue modificado.'];
    req.cmsEditorStatus = 500;
    return showGlobalSettings(req, res, next);
  }
}

async function publishGlobalSettings(req, res, next) {
  try {
    await publishing.publishSettings(GLOBAL_SETTING_KEYS, {
      actorId: req.session.user?.id || null,
    });

    req.session.success_msg = 'Configuración global publicada.';
    req.session.cms_editor_state = 'published';
    return res.redirect('/admin/page/global-settings');
  } catch (error) {
    req.cmsEditorErrors = ['Error de servidor o base de datos al publicar la configuración global.'];
    req.cmsEditorStatus = 500;
    return showGlobalSettings(req, res, next);
  }
}

module.exports = { showGlobalSettings, saveGlobalSettings, publishGlobalSettings };
