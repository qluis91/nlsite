const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const pool = require('../config/db');
const publishing = require('../services/cmsPublishingService');
const { migrateCmsDraftPublish } = require('../scripts/migrate-cms-draft-publish');

const root = path.resolve(__dirname, '..');
const settingKey = `test.cms.phase1.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test.before(async () => {
  await migrateCmsDraftPublish();
});

test.after(async () => {
  await pool.query('DELETE FROM site_settings WHERE setting_key = ?', [settingKey]);
  publishing.invalidateNamespace('siteSettings');
  await pool.end();
});

test('account dashboard renders the admin link only for administrators', () => {
  const template = ejs.compile(source('views/pages/account/dashboard.ejs'), {
    filename: path.join(root, 'views/pages/account/dashboard.ejs'),
  });
  const summary = {
    totalOrders: 0,
    pendingPaymentOrders: 0,
    activeOrders: 0,
    completedOrders: 0,
    latestOrder: null,
  };
  const adminHtml = template({ accountUser: { name: 'Admin', role_id: 1 }, summary });
  const userHtml = template({ accountUser: { name: 'User', role_id: 2 }, summary });
  assert.match(adminHtml, /href="\/admin"/);
  assert.match(adminHtml, /Ir al panel administrativo/);
  assert.doesNotMatch(userHtml, /Ir al panel administrativo/);
  assert.doesNotMatch(userHtml, /href="\/admin"/);
});

test('all rendered CMS panel editors expose separate Save and Publish controls', () => {
  const templates = [
    'views/pages/admin/page/navbar.ejs',
    'views/pages/admin/page/panel1.ejs',
    'views/pages/admin/page/panel2.ejs',
    'views/pages/admin/page/panel3.ejs',
    'views/pages/admin/page/global-settings.ejs',
    'views/pages/admin/page/page-seo.ejs',
  ];
  for (const file of templates) {
    const html = source(file);
    assert.match(html, /data-cms-editor-form/, `${file} needs a draft form`);
    assert.match(html, /Guardar cambios/, `${file} needs an explicit Save label`);
    assert.match(html, /data-cms-publish-form/, `${file} needs a publish form`);
    assert.match(html, />Publicar(?:<|\s)/, `${file} needs a separate Publish label`);
  }
});

test('settings draft stays private until explicit publish and invalidates public cache', async () => {
  await publishing.upsertSetting(settingKey, 'published-before', 'string', {
    settingGroup: 'test',
    isPublic: true,
  });
  assert.equal((await publishing.getPublishedSettings([settingKey]))[settingKey], 'published-before');

  await publishing.saveSettingsDraft([
    [settingKey, 'draft-after', 'string', 'test', true],
  ]);
  publishing.invalidateNamespace('siteSettings');

  assert.equal((await publishing.getDraftSettings([settingKey]))[settingKey], 'draft-after');
  assert.equal((await publishing.getPublishedSettings([settingKey]))[settingKey], 'published-before');

  await publishing.publishSettings([settingKey]);
  assert.equal((await publishing.getPublishedSettings([settingKey]))[settingKey], 'draft-after');
});

test('published section and repeatable reads use snapshot columns', () => {
  const contentService = source('services/cmsContentService.js');
  const repeatableService = source('services/cmsRepeatableService.js');
  const app = source('app.js');
  assert.match(contentService, /published_content_json AS content_json/);
  assert.match(contentService, /published_value AS setting_value/);
  assert.match(repeatableService, /published_data IS NOT NULL/);
  assert.match(app, /published_style_json AS style_json/);
});

test('validation paths re-render submitted values and do not use failure PRG', () => {
  const panelController = source('controllers/adminPanelsController.js');
  const heroController = source('controllers/adminPageContentController.js');
  const settingsController = source('controllers/adminGlobalSettingsController.js');
  assert.match(panelController, /cmsEditorOverride/);
  assert.match(panelController, /cmsSubmittedItem/);
  assert.match(panelController, /cmsEditorStatus = 422/);
  assert.match(heroController, /submittedHeroSection/);
  assert.match(heroController, /cmsSettingsOverride/);
  assert.match(settingsController, /settingsFromSubmission/);
  assert.match(settingsController, /cmsEditorStatus = 500/);
});

test('editor state blocks dirty publish, warns, prevents duplicates, and protects navigation', () => {
  const editor = source('public/js/admin/cms-editor-state.js');
  assert.match(editor, /Cambios sin guardar/);
  assert.match(editor, /NinjaAlerts\.warning/);
  assert.match(editor, /event\.preventDefault\(\)/);
  assert.match(editor, /processing = true/);
  assert.match(editor, /control\.disabled = true/);
  assert.match(editor, /beforeunload/);
  assert.match(editor, /Borrador guardado/);
  assert.match(editor, /Publicado/);
});

