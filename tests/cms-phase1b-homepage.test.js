const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const pageValidator = require('../validators/cmsPageValidator');
const panelValidator = require('../validators/cmsPanelsValidator');
const repeatable = require('../services/cmsRepeatableService');
const pool = require('../config/db');
const { migrateCmsHomepageFields, SOCIAL_SEED } = require('../scripts/migrate-cms-homepage-fields');

test('homepage public values have matching CMS fields', () => {
  const home = read('views/pages/home.ejs');
  const panel1 = read('views/pages/admin/page/panel1.ejs');
  const panel2 = read('views/pages/admin/page/panel2.ejs');
  // Carousel and feature forms live in partials included via item-editor-drawer
  const carouselForm = read('views/pages/admin/page/partials/carousel-form.ejs');
  const featureForm = read('views/pages/admin/page/partials/feature-form.ejs');
  const panel3 = read('views/pages/admin/page/panel3.ejs');

  for (const field of [
    'hero_aria_label', 'loading_aria_label', 'model_error_text', 'retry_label',
    'model_poster_alt', 'model_fallback_alt', 'social_aria_label',
  ]) assert.match(panel1, new RegExp(`name="${field}"`));
  for (const field of [
    'carouselControlsAriaLabel', 'carouselPreviousLabel', 'carouselNextLabel',
  ]) assert.match(panel2, new RegExp(`name="${field}"`));
  // media_alt and preview_media_alt are in the carousel partial form
  for (const field of [
    'media_alt', 'preview_media_alt',
  ]) assert.match(carouselForm, new RegExp(`name="${field}"`));
  for (const field of [
    'carouselAriaLabel', 'carouselControlsAriaLabel', 'carouselPreviousLabel',
    'carouselNextLabel', 'defaultButtonLabel',
  ]) assert.match(panel3, new RegExp(`name="${field}"`));
  // Fields from the feature-item form partial
  for (const field of [
    'button_label', 'media_alt', 'link_aria_label',
  ]) assert.match(featureForm, new RegExp(`name="${field}"`));

  assert.match(home, /item\.profile_url/);
  assert.match(home, /item\.media_alt \|\| item\.title/);
  assert.match(home, /item\.button_label \|\| panel3Content\.defaultButtonLabel/);
});

test('hero social URLs are CMS-driven and no placeholder profile links remain', () => {
  const home = read('views/pages/home.ejs');
  assert.doesNotMatch(home, /hero-social-link"[^>]+href="#"/);
  assert.doesNotMatch(home, /instagram\.com\/ninjalabcr|facebook\.com\/ninjalabcr|tiktok\.com\/@ninjalabcr|wa\.me\/50670240270/);
  assert.match(home, /socialItems\.forEach/);
  assert.match(home, /rel="noopener noreferrer"/);
});

test('social validator allowlists platforms and http(s) profile URLs', () => {
  const valid = pageValidator.validateSocialItem({
    platform: 'instagram',
    label: 'Instagram',
    profile_url: 'https://example.com/ninjalab',
    aria_label: 'Instagram de NinjaLab',
    is_visible: '1',
  });
  assert.equal(valid.valid, true);
  for (const profile_url of [
    'javascript:alert(1)', 'data:text/html,test', 'mailto:test@example.com',
    '/perfil', '#perfil', 'not a url',
  ]) {
    assert.equal(pageValidator.validateSocialItem({
      platform: 'instagram', label: 'Instagram', profile_url,
      aria_label: 'Instagram de NinjaLab',
    }).valid, false, profile_url);
  }
  assert.equal(pageValidator.validateSocialItem({
    platform: '<script>', label: 'X', profile_url: 'https://example.com',
    aria_label: 'X',
  }).valid, false);
});

test('new panel metadata length and unsafe URL validation is enforced', () => {
  assert.ok(panelValidator.validateCarouselItem({
    title: 'Proyecto',
    media_alt: 'x'.repeat(251),
  }).length);
  assert.ok(panelValidator.validateFeatureItem({
    title: 'Servicio',
    url: 'javascript:alert(1)',
    link_aria_label: 'Detalle',
  }).length);
  assert.ok(panelValidator.validatePanel3Content({
    heading: 'Servicios',
    carouselAriaLabel: 'x'.repeat(161),
  }).length);
});

test('migration is additive, idempotent, and seeds backward-compatible published socials', async () => {
  await migrateCmsHomepageFields();
  const [[before]] = await pool.query('SELECT COUNT(*) total FROM home_social_items');
  await migrateCmsHomepageFields();
  const [[after]] = await pool.query('SELECT COUNT(*) total FROM home_social_items');
  assert.equal(Number(after.total), Number(before.total));
  assert.ok(Number(after.total) >= SOCIAL_SEED.length);

  const [columns] = await pool.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'home_carousel_items' AND COLUMN_NAME IN ('media_alt','preview_media_alt'))
          OR (TABLE_NAME = 'home_feature_items' AND COLUMN_NAME IN ('button_label','media_alt','link_aria_label')))`
  );
  assert.equal(columns.length, 5);
});

test('social repeatable items preserve IDs and draft changes stay out of published reads', async () => {
  const [[section]] = await pool.query(
    "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id=s.page_id WHERE p.page_key='home' AND s.section_key='hero'"
  );
  assert.ok(section);
  const created = await repeatable.createItem('home_social_items', section.id, {
    platform: 'youtube',
    label: 'Canal de prueba',
    profile_url: 'https://example.com/channel',
    aria_label: 'Canal de prueba',
    media_public_id: null,
    sort_order: 9999,
    is_visible: 1,
    status: 'draft',
  });
  try {
    let published = await repeatable.getPublishedItems('home_social_items', section.id);
    assert.equal(published.some((item) => item.public_id === created.public_id), false);

    await repeatable.saveItem('home_social_items', created.public_id, {
      label: 'Canal actualizado',
    });
    const [rows] = await pool.query('SELECT public_id, label FROM home_social_items WHERE public_id = ?', [created.public_id]);
    assert.equal(rows[0].public_id, created.public_id);
    assert.equal(rows[0].label, 'Canal actualizado');

    await repeatable.publishCollection('home_social_items', section.id, 'hero_social_home');
    published = await repeatable.getPublishedItems('home_social_items', section.id);
    assert.equal(published.find((item) => item.public_id === created.public_id).label, 'Canal actualizado');

    await repeatable.archiveItem('home_social_items', created.public_id);
    published = await repeatable.getPublishedItems('home_social_items', section.id);
    assert.equal(published.some((item) => item.public_id === created.public_id), true);
    await repeatable.publishCollection('home_social_items', section.id, 'hero_social_home');
    published = await repeatable.getPublishedItems('home_social_items', section.id);
    assert.equal(published.some((item) => item.public_id === created.public_id), false);
  } finally {
    await pool.query('DELETE FROM content_revisions WHERE entity_type = ? AND entity_id = ?', ['social_item', created.id]);
    await pool.query('DELETE FROM home_social_items WHERE public_id = ?', [created.public_id]);
  }
});

test('partial panel saves are implemented as merges and public reads use published snapshots', () => {
  const controller = read('controllers/adminPanelsController.js');
  const contentService = read('services/cmsContentService.js');
  const repeatableService = read('services/cmsRepeatableService.js');
  assert.match(controller, /const content = \{\s*\.\.\.storedContent,/);
  assert.match(controller, /has\('carouselAriaLabel'\)/);
  assert.match(contentService, /published_content_json AS content_json/);
  assert.match(repeatableService, /published_data IS NOT NULL/);
});

test.after(async () => {
  await pool.end();
});
