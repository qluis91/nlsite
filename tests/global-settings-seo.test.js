/**
 * Phase 12A tests — Global Settings & SEO.
 * Run: node --test tests/global-settings-seo.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const pool = require('../config/db');

const BASE = { hostname: 'localhost', port: 3000 };

// Helpers
function fetch(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const opts = { ...BASE, path, method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  // Seed global settings if empty
  const [[c]] = await pool.query("SELECT COUNT(*) c FROM site_settings WHERE setting_key = 'global.site_name'");
  if (Number(c.c) === 0) {
    await pool.query("INSERT INTO site_settings (setting_key, setting_value, value_type, setting_group, is_public) VALUES (?,?,?,?,?)",
      ['global.site_name', 'TestSite', 'string', 'global', 1]);
  }
});

after(async () => {
  await pool.end();
});

describe('Phase 12A — Admin card registration', () => {
  it('CMS_MODULES includes global-settings card', () => {
    const { CMS_MODULES } = require('../controllers/adminPageController');
    const card = CMS_MODULES.find(m => m.key === 'global-settings');
    assert.ok(card, 'global-settings module must exist in CMS_MODULES');
    assert.equal(card.title, 'Configuración global y SEO');
    assert.equal(card.status, 'active');
    assert.equal(card.href, '/admin/page/global-settings');
  });
});

describe('Phase 12A — Validator', () => {
  const { validateGlobalSettings } = require('../validators/cmsPanelsValidator');

  it('valid input passes', () => {
    const errors = validateGlobalSettings({
      site_name: 'My Site',
      seo_title: 'SEO Title',
      seo_description: 'SEO Description',
      canonical_url: 'https://example.com',
      indexing_mode: 'index,follow',
    });
    assert.equal(errors.length, 0);
  });

  it('empty input also passes (all fields optional)', () => {
    const errors = validateGlobalSettings({});
    assert.equal(errors.length, 0);
  });

  it('rejects site_name too long', () => {
    const errors = validateGlobalSettings({ site_name: 'A'.repeat(101) });
    assert.ok(errors.some(e => e.includes('Nombre del sitio') && e.includes('excede')));
  });

  it('rejects seo_title too long', () => {
    const errors = validateGlobalSettings({ seo_title: 'A'.repeat(121) });
    assert.ok(errors.some(e => e.includes('Título SEO') && e.includes('excede')));
  });

  it('rejects invalid indexing_mode', () => {
    const errors = validateGlobalSettings({ indexing_mode: 'invalid' });
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('indexación'));
  });

  it('rejects invalid canonical_url', () => {
    const errors = validateGlobalSettings({ canonical_url: 'not-a-url' });
    assert.ok(errors.some(e => e.includes('URL')));
  });

  it('accepts index,nofollow as valid indexing_mode', () => {
    const errors = validateGlobalSettings({ indexing_mode: 'index,nofollow' });
    assert.equal(errors.length, 0);
  });
});

describe('Phase 12A — Capabilities', () => {
  const { CAPABILITIES, hasCapability } = require('../config/capabilities');

  it('GLOBAL_SETTINGS_VIEW is registered', () => {
    assert.equal(CAPABILITIES.GLOBAL_SETTINGS_VIEW, 'global.settings.view');
  });

  it('GLOBAL_SETTINGS_EDIT is registered', () => {
    assert.equal(CAPABILITIES.GLOBAL_SETTINGS_EDIT, 'global.settings.edit');
  });

  it('GLOBAL_SETTINGS_PUBLISH is registered', () => {
    assert.equal(CAPABILITIES.GLOBAL_SETTINGS_PUBLISH, 'global.settings.publish');
  });

  it('admin user has global settings capabilities', () => {
    const caps = require('../config/capabilities').capabilitiesFor({ id: 1, role_id: 1 });
    assert.ok(caps.includes(CAPABILITIES.GLOBAL_SETTINGS_VIEW));
    assert.ok(caps.includes(CAPABILITIES.GLOBAL_SETTINGS_EDIT));
    assert.ok(caps.includes(CAPABILITIES.GLOBAL_SETTINGS_PUBLISH));
  });
});

describe('Phase 12A — Global settings persistence', () => {
  after(async () => {
    await pool.query("DELETE FROM site_settings WHERE setting_key LIKE 'global.%'");
  });

  it('upserts global.site_name setting', async () => {
    const publishing = require('../services/cmsPublishingService');
    await publishing.upsertSetting('global.site_name', 'PersistTest', 'string', {
      settingGroup: 'global', isPublic: true, actorId: null,
    });
    const settings = await publishing.getPublishedSettings(['global.site_name']);
    assert.equal(settings['global.site_name'], 'PersistTest');
  });

  it('upserts global.seo_title setting', async () => {
    const publishing = require('../services/cmsPublishingService');
    await publishing.upsertSetting('global.seo_title', 'PersistSEO', 'string', {
      settingGroup: 'seo', isPublic: true, actorId: null,
    });
    const settings = await publishing.getPublishedSettings(['global.seo_title']);
    assert.equal(settings['global.seo_title'], 'PersistSEO');
  });

  it('upserts global.seo_description setting', async () => {
    const publishing = require('../services/cmsPublishingService');
    await publishing.upsertSetting('global.seo_description', 'PersistDesc', 'string', {
      settingGroup: 'seo', isPublic: true, actorId: null,
    });
    const settings = await publishing.getPublishedSettings(['global.seo_description']);
    assert.equal(settings['global.seo_description'], 'PersistDesc');
  });

  it('upserts global.indexing_mode setting', async () => {
    const publishing = require('../services/cmsPublishingService');
    await publishing.upsertSetting('global.indexing_mode', 'noindex,nofollow', 'string', {
      settingGroup: 'seo', isPublic: true, actorId: null,
    });
    const settings = await publishing.getPublishedSettings(['global.indexing_mode']);
    assert.equal(settings['global.indexing_mode'], 'noindex,nofollow');
  });

  it('upserts global.canonical_url setting', async () => {
    const publishing = require('../services/cmsPublishingService');
    await publishing.upsertSetting('global.canonical_url', 'https://example.com', 'string', {
      settingGroup: 'seo', isPublic: true, actorId: null,
    });
    const settings = await publishing.getPublishedSettings(['global.canonical_url']);
    assert.equal(settings['global.canonical_url'], 'https://example.com');
  });
});

describe('Phase 12A — Public homepage SEO rendering', () => {
  it('homepage returns 200 with SEO meta tags present', async () => {
    const res = await fetch('/');
    assert.equal(res.status, 200);
    // OG and Twitter tags should be present (values depend on current settings)
    assert.ok(res.body.includes('og:title'), 'Should include og:title');
    assert.ok(res.body.includes('og:description'), 'Should include og:description');
    assert.ok(res.body.includes('og:type'), 'Should include og:type');
    assert.ok(res.body.includes('twitter:card'), 'Should include twitter:card');
  });

  it('homepage includes meta description tag', async () => {
    const res = await fetch('/');
    assert.ok(res.body.includes('name="description"'), 'Should include meta description');
  });

  it('auth page loads without errors', async () => {
    const res = await fetch('/auth/login');
    assert.equal(res.status, 200);
  });

  it('auth page does not crash with unknown settings', async () => {
    const res = await fetch('/auth/register');
    assert.equal(res.status, 200);
  });
});

describe('Phase 12A — View includes', () => {
  const ejs = require('ejs');
  const fs = require('fs');

  it('global-settings.ejs renders without errors', () => {
    const tpl = fs.readFileSync('views/pages/admin/page/global-settings.ejs', 'utf-8');
    let compiled;
    assert.doesNotThrow(() => { compiled = ejs.compile(tpl, { filename: 'views/pages/admin/page/global-settings.ejs' }); });
    assert.ok(compiled);
    const html = compiled({
      csrfToken: 'x',
      settings: { 'global.site_name': '', 'global.seo_title': '', 'global.seo_description': '', 'global.og_image': '', 'global.canonical_url': '', 'global.indexing_mode': '' },
      ogImage: null,
      favicon: null,
      indexingModes: [
        { value: 'index,follow', label: 'Indexar y seguir' },
        { value: 'noindex,nofollow', label: 'No indexar' },
        { value: 'index,nofollow', label: 'Indexar sin seguir' },
      ],
    });
    assert.ok(html.includes('Configuración global y SEO'));
    assert.ok(html.includes('site_name'));
    assert.ok(html.includes('seo_title'));
    assert.ok(html.includes('favicon'));
  });
});

describe('Phase 12A — Admin page overview includes global-settings module', () => {
  it('overview page renders global-settings module', async () => {
    const { CMS_MODULES } = require('../controllers/adminPageController');
    const ejs = require('ejs');
    const fs = require('fs');
    const tpl = fs.readFileSync('views/pages/admin/page/overview.ejs', 'utf-8');
    const compiled = ejs.compile(tpl, { filename: 'views/pages/admin/page/overview.ejs' });
    const html = compiled({
      title: 'Test',
      modules: CMS_MODULES,
      summary: { totalAssets: 0, imageAssets: 0, modelAssets: 0, storageLabel: '0B', archivedAssets: 0, processingAssets: 0, failedAssets: 0 },
      recent: [],
      sectionCounts: { logoLoop: 0, carousel: 0, features: 0 },
      formatFileSize: () => '',
    });
    assert.ok(html.includes('Configuración global y SEO'));
    assert.ok(html.includes('/admin/page/global-settings'));
  });
});
