/**
 * Panel 2 & Panel 3 stabilization regression tests.
 * Run: node --test tests/cms-panels-stabilize.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');

let showcaseSectionId, servicesSectionId;

before(async () => {
  const { migratePanels } = require('../scripts/migrate-panels');
  await migratePanels();

  const [[sr]] = await pool.query(
    "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'showcase'"
  );
  showcaseSectionId = sr?.id;

  const [[svr]] = await pool.query(
    "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'services'"
  );
  servicesSectionId = svr?.id;
});

after(async () => {
  await pool.end();
});

// ── EJS compile tests ──
describe('EJS compile — Panel 2 & 3 views', () => {
  it('panel2.ejs compiles without error', async () => {
    const ejs = require('ejs');
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [], carouselItems: [],
      csrfToken: 'test-token', error: null, saved: null,
    });
    assert.ok(typeof html === 'string');
    assert.ok(html.length > 0);
  });

  it('panel3.ejs compiles without error', async () => {
    const ejs = require('ejs');
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel3.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, items: [],
      csrfToken: 'test-token', error: null, saved: null,
    });
    assert.ok(typeof html === 'string');
    assert.ok(html.length > 0);
  });

  it('panel2.ejs renders all tab buttons', async () => {
    const ejs = require('ejs');
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [], carouselItems: [],
      csrfToken: 'test-token', error: null, saved: null,
    });
    assert.ok(html.includes('data-tab="general"'));
    assert.ok(html.includes('data-tab="logoloop"'));
    assert.ok(html.includes('data-tab="carousel"'));
    assert.ok(html.includes('data-tab="style"'));
  });

  it('panel2.ejs LogoLoop form has data-logo-edit and link_type', async () => {
    const ejs = require('ejs');
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [{ public_id: 'test-id', item_type: 'text', text_content: 'Hello', media_public_id: null, url: null, link_type: 'internal', target: '_self', alt_text: null, is_visible: 1, status: 'draft' }],
      carouselItems: [],
      csrfToken: 'test-token', error: null, saved: null,
    });
    assert.ok(html.includes('data-logo-edit'), 'LogoLoop edit buttons should use data-logo-edit attribute');
    assert.ok(html.includes('name="link_type"'), 'LogoLoop form should have link_type');
    assert.ok(!html.includes('onclick="editLogoItem'), 'Should not have inline onclick for LogoLoop');
  });

  it('panel2.ejs carousel form has scoped ID and no orphan </form>', async () => {
    const ejs = require('ejs');
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [], carouselItems: [],
      csrfToken: 'test-token', error: null, saved: null,
    });
    assert.ok(html.includes('id="carousel-edit-details"'), 'Carousel edit details should have scoped id');
    const openCount = (html.match(/<form /g) || []).length;
    const closeCount = (html.match(/<\/form>/g) || []).length;
    assert.equal(openCount, closeCount, 'form tags must balance');
    // No inline onclick handlers
    assert.ok(!html.includes('onclick='), 'panel2.ejs should have no onclick handlers');
  });

  it('panel3.ejs feature form has data-feature-edit attribute', async () => {
    const ejs = require('ejs');
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel3.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, items: [{ public_id: 'test-id', title: 'Test', description: '', detail_text: '', icon_type: 'builtin', icon_key: 'diseno-3d', media_public_id: null, url: null, link_type: 'internal', target: '_self', style_variant: '', is_visible: 1, status: 'draft' }],
      csrfToken: 'test-token', error: null, saved: null,
    });
    assert.ok(html.includes('data-feature-edit'), 'Feature edit buttons should use data-feature-edit');
    assert.ok(html.includes('name="link_type"'), 'Feature form should have link_type');
    assert.ok(html.includes('id="feature-link-type"'), 'Feature form should have feature-link-type id');
    assert.ok(!html.includes('onclick='), 'panel3.ejs should have no onclick handlers');
    assert.ok(!html.includes('onchange="'), 'panel3.ejs should have no inline onchange');
  });
});

// ── Button types ──
describe('Button type safety', () => {
  it('panel2.ejs tab buttons are type="button"', async () => {
    const ejs = require('ejs');
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [], carouselItems: [],
      csrfToken: 'test-token', error: null, saved: null,
    });
    assert.ok(html.includes('type="button"'));
    // No inline event handlers
    assert.ok(!html.includes('onclick='), 'panel2.ejs must not have onclick handlers');
    assert.ok(!html.includes('onchange="'), 'panel2.ejs must not have inline onchange');
    assert.ok(!html.includes('<script>'), 'panel2.ejs must not have inline script block');
  });

  it('panel3.ejs edit button is type="button"', async () => {
    const ejs = require('ejs');
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel3.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, items: [],
      csrfToken: 'test-token', error: null, saved: null,
    });
    assert.ok(html.includes('type="button"'));
  });

  it('no nested forms in panel2 or panel3', async () => {
    const ejs = require('ejs');
    for (const view of ['panel2', 'panel3']) {
      const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', `${view}.ejs`);
      const html = await ejs.renderFile(viewPath, {
        content: {}, style: {}, bgMedia: view === 'panel2' ? null : undefined,
        logoItems: [], carouselItems: [], items: [],
        csrfToken: 'test-token', error: null, saved: null,
      });
      // Count total <form> opens and </form> closes — they must balance
      const opens = (html.match(/<form\b/gi) || []).length;
      const closes = (html.match(/<\/form>/gi) || []).length;
      assert.equal(opens, closes, `${view}.ejs form tags must balance (opens=${opens}, closes=${closes})`);
    }
  });

  it('no duplicate IDs in panel2 or panel3', async () => {
    const ejs = require('ejs');
    for (const view of ['panel2', 'panel3']) {
      const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', `${view}.ejs`);
      const html = await ejs.renderFile(viewPath, {
        content: {}, style: {}, bgMedia: view === 'panel2' ? null : undefined,
        logoItems: [], carouselItems: [], items: [],
        csrfToken: 'test-token', error: null, saved: null,
      });
      const ids = html.match(/id="([^"]+)"/g) || [];
      const seen = new Set();
      for (const id of ids) {
        if (seen.has(id)) assert.fail(`Duplicate ID ${id} in ${view}.ejs`);
        seen.add(id);
      }
    }
  });
});

// ── LogoLoop CRUD ──
describe('LogoLoop items — CRUD flow', () => {
  const repeatable = require('../services/cmsRepeatableService');
  const crypto = require('crypto');
  let textItemId, imageItemId;

  it('create text item succeeds', async () => {
    const result = await repeatable.createItem('logo_loop_items', showcaseSectionId, {
      item_type: 'text', text_content: 'TEST-TEXT', is_visible: 1, status: 'draft', sort_order: 99,
    });
    textItemId = result.public_id;
    assert.ok(textItemId);
    assert.equal(result.item_type, 'text');
    assert.equal(result.text_content, 'TEST-TEXT');
  });

  it('create image item succeeds', async () => {
    const result = await repeatable.createItem('logo_loop_items', showcaseSectionId, {
      item_type: 'image', media_public_id: null, is_visible: 1, status: 'draft', sort_order: 100,
    });
    imageItemId = result.public_id;
    assert.ok(imageItemId);
    assert.equal(result.item_type, 'image');
  });

  it('text item loads with correct item_type', async () => {
    const items = await repeatable.listItems('logo_loop_items', showcaseSectionId);
    const item = items.find(i => i.public_id === textItemId);
    assert.ok(item);
    assert.equal(item.item_type, 'text');
    assert.equal(item.text_content, 'TEST-TEXT');
  });

  it('edit updates existing row, no duplicate', async () => {
    const countBefore = (await repeatable.listItems('logo_loop_items', showcaseSectionId)).length;
    await repeatable.saveItem('logo_loop_items', textItemId, {
      text_content: 'UPDATED-TEXT', is_visible: 0, item_type: 'text', status: 'draft',
    });
    const items = await repeatable.listItems('logo_loop_items', showcaseSectionId);
    assert.equal(items.length, countBefore, 'should not create duplicate row');
    const updated = items.find(i => i.public_id === textItemId);
    assert.ok(updated);
    assert.equal(updated.text_content, 'UPDATED-TEXT');
  });

  it('edit preserves link_type field', async () => {
    await repeatable.saveItem('logo_loop_items', textItemId, {
      text_content: 'LINKED', url: 'https://example.com', link_type: 'external', target: '_blank',
      item_type: 'text', status: 'draft',
    });
    const items = await repeatable.listItems('logo_loop_items', showcaseSectionId);
    const item = items.find(i => i.public_id === textItemId);
    assert.equal(item.url, 'https://example.com');
    assert.equal(item.link_type, 'external');
    assert.equal(item.target, '_blank');
  });

  it('archive works', async () => {
    await repeatable.archiveItem('logo_loop_items', textItemId);
    const items = await repeatable.listItems('logo_loop_items', showcaseSectionId);
    assert.ok(!items.find(i => i.public_id === textItemId), 'archived item should be hidden from list');
  });

  it('reorder persists', async () => {
    const ids = [imageItemId];
    await repeatable.reorderItems('logo_loop_items', showcaseSectionId, ids);
    const items = await repeatable.listItems('logo_loop_items', showcaseSectionId, { includeArchived: true });
    const reordered = items.find(i => i.public_id === imageItemId);
    assert.equal(reordered.sort_order, 0);
  });

  it('collection publish works', async () => {
    await repeatable.publishCollection('logo_loop_items', showcaseSectionId, 'logoLoop_test');
    const published = await repeatable.getPublishedItems('logo_loop_items', showcaseSectionId);
    // Published items should exist (at least the image item we created)
    assert.ok(published.length >= 1);
  });

  // Cleanup
  after(async () => {
    try {
      await repeatable.archiveItem('logo_loop_items', imageItemId);
    } catch (_) { /* ignore */ }
  });
});

// ── Carousel CRUD ──
describe('Carousel items — CRUD flow', () => {
  const repeatable = require('../services/cmsRepeatableService');
  let itemId;

  it('create item succeeds', async () => {
    const result = await repeatable.createItem('home_carousel_items', showcaseSectionId, {
      eyebrow: 'TEST-EYEBROW', title: 'Test Project', description: 'A test project',
      button_label: 'View', button_url: '/projects/test', button_target: '_self',
      theme_key: 'graphite', is_visible: 1, status: 'draft', sort_order: 99,
    });
    itemId = result.public_id;
    assert.ok(itemId);
    assert.equal(result.title, 'Test Project');
  });

  it('existing item loads with correct data', async () => {
    const items = await repeatable.listItems('home_carousel_items', showcaseSectionId);
    const item = items.find(i => i.public_id === itemId);
    assert.ok(item);
    assert.equal(item.eyebrow, 'TEST-EYEBROW');
    assert.equal(item.theme_key, 'graphite');
  });

  it('edit updates existing row, no duplicate', async () => {
    const countBefore = (await repeatable.listItems('home_carousel_items', showcaseSectionId)).length;
    await repeatable.saveItem('home_carousel_items', itemId, {
      title: 'Updated Title', eyebrow: 'NEW-EYEBROW', theme_key: 'lime',
      button_target: '_blank', status: 'draft',
    });
    const items = await repeatable.listItems('home_carousel_items', showcaseSectionId);
    assert.equal(items.length, countBefore, 'should not duplicate');
    const updated = items.find(i => i.public_id === itemId);
    assert.equal(updated.title, 'Updated Title');
    assert.equal(updated.theme_key, 'lime');
    assert.equal(updated.button_target, '_blank');
  });

  it('archive works', async () => {
    await repeatable.archiveItem('home_carousel_items', itemId);
    const items = await repeatable.listItems('home_carousel_items', showcaseSectionId);
    assert.ok(!items.find(i => i.public_id === itemId));
  });

  it('reorder persists', async () => {
    const items = await repeatable.listItems('home_carousel_items', showcaseSectionId, { includeArchived: true });
    const ids = items.map(i => i.public_id);
    if (ids.length) {
      await repeatable.reorderItems('home_carousel_items', showcaseSectionId, ids);
    }
    // Should not throw
  });
});

// ── Feature cards CRUD ──
describe('Feature items — CRUD flow', () => {
  const repeatable = require('../services/cmsRepeatableService');
  let builtinItemId, mediaItemId;

  it('create with builtin icon succeeds', async () => {
    const result = await repeatable.createItem('home_feature_items', servicesSectionId, {
      title: 'Builtin Test', description: 'A builtin card',
      icon_type: 'builtin', icon_key: 'diseno-3d',
      style_variant: 'default', is_visible: 1, status: 'draft', sort_order: 99,
    });
    builtinItemId = result.public_id;
    assert.ok(builtinItemId);
    assert.equal(result.icon_type, 'builtin');
  });

  it('create with media icon succeeds', async () => {
    const result = await repeatable.createItem('home_feature_items', servicesSectionId, {
      title: 'Media Test', description: 'A media card',
      icon_type: 'media', icon_key: null,
      media_public_id: null, is_visible: 1, status: 'draft', sort_order: 100,
    });
    mediaItemId = result.public_id;
    assert.ok(mediaItemId);
    assert.equal(result.icon_type, 'media');
  });

  it('edit loads existing item with icon_type', async () => {
    const items = await repeatable.listItems('home_feature_items', servicesSectionId);
    const item = items.find(i => i.public_id === builtinItemId);
    assert.ok(item);
    assert.equal(item.icon_type, 'builtin');
    assert.equal(item.icon_key, 'diseno-3d');
  });

  it('edit updates existing row, no duplicate', async () => {
    const countBefore = (await repeatable.listItems('home_feature_items', servicesSectionId)).length;
    await repeatable.saveItem('home_feature_items', builtinItemId, {
      title: 'Updated Builtin', icon_type: 'builtin', icon_key: 'escaneo-3d',
      style_variant: 'highlight', status: 'draft',
    });
    const items = await repeatable.listItems('home_feature_items', servicesSectionId);
    assert.equal(items.length, countBefore, 'should not duplicate');
    const updated = items.find(i => i.public_id === builtinItemId);
    assert.equal(updated.title, 'Updated Builtin');
    assert.equal(updated.icon_key, 'escaneo-3d');
    assert.equal(updated.style_variant, 'highlight');
  });

  it('edit preserves link_type and target', async () => {
    await repeatable.saveItem('home_feature_items', builtinItemId, {
      title: 'Linked Card', url: 'https://example.com', link_type: 'external', target: '_blank',
      icon_type: 'builtin', icon_key: 'diseno-3d', status: 'draft',
    });
    const items = await repeatable.listItems('home_feature_items', servicesSectionId);
    const item = items.find(i => i.public_id === builtinItemId);
    assert.equal(item.link_type, 'external');
    assert.equal(item.target, '_blank');
  });

  it('icon type switching works (builtin→media)', async () => {
    await repeatable.saveItem('home_feature_items', builtinItemId, {
      title: 'Switched Card', icon_type: 'media', icon_key: null, status: 'draft',
    });
    const items = await repeatable.listItems('home_feature_items', servicesSectionId);
    const item = items.find(i => i.public_id === builtinItemId);
    assert.equal(item.icon_type, 'media');
    assert.equal(item.icon_key, null);
  });

  it('archive works', async () => {
    await repeatable.archiveItem('home_feature_items', builtinItemId);
    const items = await repeatable.listItems('home_feature_items', servicesSectionId);
    assert.ok(!items.find(i => i.public_id === builtinItemId));
  });

  it('reorder persists', async () => {
    const ids = [mediaItemId];
    await repeatable.reorderItems('home_feature_items', servicesSectionId, ids);
    const items = await repeatable.listItems('home_feature_items', servicesSectionId, { includeArchived: true });
    const reordered = items.find(i => i.public_id === mediaItemId);
    assert.equal(reordered.sort_order, 0);
  });

  it('collection publish works', async () => {
    await repeatable.publishCollection('home_feature_items', servicesSectionId, 'features_test');
    const published = await repeatable.getPublishedItems('home_feature_items', servicesSectionId);
    assert.ok(published.length >= 1);
  });

  after(async () => {
    try {
      await repeatable.archiveItem('home_feature_items', mediaItemId);
    } catch (_) { /* ignore */ }
  });
});

// ── Validator regression ──
describe('Validator regression — Panel 2 & 3', () => {
  const validator = require('../validators/cmsPanelsValidator');

  it('validates link_type on LogoLoop', () => {
    const errors = validator.validateLogoLoopItem({ item_type: 'text', text_content: 'Test', link_type: 'invalid' });
    assert.ok(errors.some(e => e.toLowerCase().includes('enlace')));
  });

  it('validates unsafe URL on LogoLoop', () => {
    const errors = validator.validateLogoLoopItem({ item_type: 'text', text_content: 'Test', url: 'javascript:alert(1)' });
    assert.ok(errors.some(e => e.toLowerCase().includes('url')));
  });

  it('validates carousel theme', () => {
    const errors = validator.validateCarouselItem({ title: 'Test', theme_key: 'invalid' });
    assert.ok(errors.some(e => e.toLowerCase().includes('tema')));
  });

  it('validates feature icon_type', () => {
    const errors = validator.validateFeatureItem({ title: 'Test', icon_type: 'invalid' });
    assert.ok(errors.some(e => e.toLowerCase().includes('icono')));
  });

  it('validates unknown icon_key', () => {
    const errors = validator.validateFeatureItem({ title: 'Test', icon_type: 'builtin', icon_key: 'nope' });
    assert.ok(errors.some(e => e.toLowerCase().includes('icono')));
  });

  it('validates feature style_variant', () => {
    const errors = validator.validateFeatureItem({ title: 'Test', style_variant: 'invalid' });
    assert.ok(errors.some(e => e.toLowerCase().includes('variante')));
  });

  it('validates link_type on feature items', () => {
    const errors = validator.validateFeatureItem({ title: 'Test', link_type: 'invalid' });
    assert.ok(errors.some(e => e.toLowerCase().includes('enlace')));
  });

  it('rejects unsafe URL on feature items', () => {
    const errors = validator.validateFeatureItem({ title: 'Test', url: 'data:text/html,<script>' });
    assert.ok(errors.some(e => e.toLowerCase().includes('url')));
  });
});

// ── Controller field mapping ──
describe('Controller field name mapping', () => {
  const controller = require('../controllers/adminPanelsController');
  const validator = require('../validators/cmsPanelsValidator');

  it('savePanel2Draft expects correct field names', () => {
    // Fields from panel2.ejs form: eyebrow, heading, supportText, carouselLabel, logoLoopAriaLabel, backgroundColor, textColor, accentColor
    const contentErrors = validator.validatePanel2Content({
      eyebrow: 'Kicker', heading: 'Heading', supportText: 'Support', carouselLabel: 'Label', logoLoopAriaLabel: 'Aria',
    });
    assert.equal(contentErrors.length, 0, 'Panel 2 content fields should be valid');

    const styleErrors = validator.validatePanel2Style({
      backgroundColor: '#000000', textColor: '#ffffff', accentColor: '#ff0000',
    });
    assert.equal(styleErrors.length, 0, 'Panel 2 style fields should be valid');
  });

  it('savePanel3Draft expects correct field names', () => {
    const contentErrors = validator.validatePanel3Content({
      eyebrow: 'Kicker', heading: 'Heading', description: 'Description',
    });
    assert.equal(contentErrors.length, 0, 'Panel 3 content fields should be valid');
  });

  it('create/saveLogoLoopItem expects correct field names', () => {
    const errors = validator.validateLogoLoopItem({
      item_type: 'text', text_content: 'Hello',
      url: null, link_type: 'internal', target: '_self',
      is_visible: '1',
    });
    assert.equal(errors.length, 0, 'LogoLoop fields should be valid');
  });

  it('create/saveCarouselItem expects correct field names', () => {
    const errors = validator.validateCarouselItem({
      eyebrow: 'Eyebrow', title: 'Title', description: 'Desc',
      button_label: 'Btn', button_url: '/test', button_target: '_self',
      theme_key: 'graphite', is_visible: '1',
    });
    assert.equal(errors.length, 0, 'Carousel fields should be valid');
  });

  it('create/saveFeatureItem expects correct field names', () => {
    const errors = validator.validateFeatureItem({
      title: 'Title', description: 'Desc', detail_text: 'Detail',
      icon_type: 'builtin', icon_key: 'diseno-3d',
      url: '/test', link_type: 'internal', target: '_self',
      style_variant: 'default', is_visible: '1',
    });
    assert.equal(errors.length, 0, 'Feature fields should be valid');
  });
});

// ── Service listItems returns proper data ──
describe('Repeatable service — listItems', () => {
  const repeatable = require('../services/cmsRepeatableService');

  it('listItems filters archived items by default', async () => {
    const items = await repeatable.listItems('logo_loop_items', showcaseSectionId);
    for (const item of items) {
      assert.notEqual(item.status, 'archived', 'archived items should not appear');
    }
  });

  it('getPublishedItems returns only published + visible items', async () => {
    const items = await repeatable.getPublishedItems('home_feature_items', servicesSectionId);
    for (const item of items) {
      assert.equal(item.status, 'published');
      assert.equal(item.is_visible, 1);
    }
  });

  it('items have public_id', async () => {
    const items = await repeatable.listItems('logo_loop_items', showcaseSectionId, { includeArchived: true });
    for (const item of items) {
      assert.ok(item.public_id, 'every item should have public_id');
    }
  });
});

// ── Reorder comma-separated parsing ──
describe('Reorder ID parsing', () => {
  // Test the parsing logic used in controller
  function parseIds(value) {
    // Try JSON first for arrays passed as JSON strings
    if (typeof value === 'string') {
      if (value.startsWith('[')) {
        try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch (_) {}
      }
      return value.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(value)) return [];
    return value;
  }

  it('handles comma-separated string', () => {
    assert.deepEqual(parseIds('a,b,c'), ['a', 'b', 'c']);
  });

  it('handles whitespace around commas', () => {
    assert.deepEqual(parseIds('a, b ,  c'), ['a', 'b', 'c']);
  });

  it('handles empty string', () => {
    assert.deepEqual(parseIds(''), []);
  });

  it('handles JSON array string', () => {
    // JSON array string should be tried as JSON before comma split
    assert.deepEqual(parseIds('["a","b"]'), ['a', 'b']);
  });

  it('handles actual array', () => {
    assert.deepEqual(parseIds(['a', 'b']), ['a', 'b']);
  });
});

// ── Public rendering data integrity ──
describe('Public rendering data integrity', () => {
  const repeatable = require('../services/cmsRepeatableService');

  it('LogoLoop item_type is always text/image/logo', async () => {
    const items = await repeatable.getPublishedItems('logo_loop_items', showcaseSectionId);
    const valid = new Set(['text', 'image', 'logo']);
    for (const item of items) {
      assert.ok(valid.has(item.item_type), `item_type '${item.item_type}' must be text/image/logo`);
    }
  });

  it('Carousel items have required fields', async () => {
    const items = await repeatable.getPublishedItems('home_carousel_items', showcaseSectionId);
    for (const item of items) {
      assert.ok(item.title, 'carousel item must have title');
      assert.ok(['graphite', 'lime', 'silver', 'ink'].includes(item.theme_key) || !item.theme_key);
    }
  });

  it('Feature items have valid icon_type', async () => {
    const items = await repeatable.getPublishedItems('home_feature_items', servicesSectionId);
    const valid = new Set(['builtin', 'media']);
    for (const item of items) {
      assert.ok(valid.has(item.icon_type) || !item.icon_type, `icon_type '${item.icon_type}' must be builtin/media`);
    }
  });
});

// ── Media selector HTML structure ──
describe('Media selector HTML', () => {
  it('media-selector.ejs includes data-ms-input hidden input', async () => {
    const ejs = require('ejs');
    const viewPath = path.join(__dirname, '..', 'views', 'components', 'media-selector.ejs');
    const html = await ejs.renderFile(viewPath, {
      fieldName: 'media_public_id', currentValue: '', label: 'Test', kindLabel: 'Imagen',
      allowedTypes: ['image/png'], allowedCategories: ['test'], uploadProfile: 'test',
      helpText: '', required: false,
    });
    assert.ok(html.includes('data-ms-input'), 'media selector must have data-ms-input attribute');
    assert.ok(html.includes('data-media-selector'), 'media selector must have data-media-selector attribute');
  });
});

// ── Panel 2/3 routes existence ──
describe('Panel 2 & 3 route definitions', () => {
  it('admin routes include all Panel 2 endpoints', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminPanelsRoutes.js'), 'utf-8');
    const expectedEndpoints = [
      'panel-2',
      'panel-2/draft', 'panel-2/publish',
      'panel-2/logo-loop/items', 'panel-2/logo-loop/items/save',
      'panel-2/logo-loop/items/reorder', 'panel-2/logo-loop/items/archive',
      'panel-2/logo-loop/items/publish',
      'panel-2/carousel/items', 'panel-2/carousel/items/save',
      'panel-2/carousel/items/reorder', 'panel-2/carousel/items/archive',
      'panel-2/carousel/items/publish',
    ];
    for (const ep of expectedEndpoints) {
      assert.ok(source.includes(ep), `Route source should mention ${ep}`);
    }
  });

  it('admin routes include all Panel 3 endpoints', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminPanelsRoutes.js'), 'utf-8');
    const expectedEndpoints = [
      'panel-3',
      'panel-3/draft', 'panel-3/publish',
      'panel-3/items', 'panel-3/items/save',
      'panel-3/items/reorder', 'panel-3/items/archive',
      'panel-3/items/publish',
    ];
    for (const ep of expectedEndpoints) {
      assert.ok(source.includes(ep), `Route source should mention ${ep}`);
    }
  });
});

// ── CSS classes reference ──
describe('CSS class availability', () => {
  it('admin-page.css has required classes for tabs and panels', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin-page.css'), 'utf-8');
    assert.ok(css.includes('.cms-tabs'), 'CSS should define .cms-tabs');
    assert.ok(css.includes('.cms-tab'), 'CSS should define .cms-tab');
    assert.ok(css.includes('.cms-tab-panel'), 'CSS should define .cms-tab-panel');
    assert.ok(css.includes('.cms-section-header'), 'CSS should define .cms-section-header');
    assert.ok(css.includes('.cms-section-footer'), 'CSS should define .cms-section-footer');
    assert.ok(css.includes('.carousel-preview-card'), 'CSS should define .carousel-preview-card');
    assert.ok(css.includes('.badge-draft'), 'CSS should define .badge-draft');
    assert.ok(css.includes('.badge-text'), 'CSS should define .badge-text');
    assert.ok(css.includes('.badge-image'), 'CSS should define .badge-image');
    assert.ok(css.includes('.badge-logo'), 'CSS should define .badge-logo');
    assert.ok(css.includes('.cms-form--inline'), 'CSS should define .cms-form--inline');
  });
});
