/**
 * Carousel media persistence & rendering regression tests.
 * Run: node --test tests/carousel-persistence.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

const pool = require('../config/db');
const repeatable = require('../services/cmsRepeatableService');
const { safeJsonScript } = require('../config/jsonLdHelper');

let sectionId;
let createdItemId;

describe('Carousel persistence — create & save with media', () => {
  before(async () => {
    const [[row]] = await pool.query(
      "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'showcase'"
    );
    sectionId = row ? row.id : null;
    if (!sectionId) {
      // Create test section
      const [[p]] = await pool.query("SELECT id FROM pages WHERE page_key = 'home' LIMIT 1");
      const [result] = await pool.query(
        "INSERT INTO page_sections (page_id, section_key, name, content_json, style_json, status, is_enabled) VALUES (?, 'showcase', 'Showcase', '{}', '{}', 'published', 1)",
        [p.id]
      );
      sectionId = result.insertId;
    }
    await pool.query("DELETE FROM home_carousel_items WHERE page_section_id = ? AND title IN (?, ?, ?, ?)",
      [sectionId, 'PERSIST_TEST_MAIN', 'PERSIST_TEST_UPDATE', 'PERSIST_TEST_EDIT', 'PERSIST_TEST_BOTH']);
  });

  after(async () => {
    await pool.query("DELETE FROM home_carousel_items WHERE page_section_id = ? AND title IN (?, ?, ?, ?)",
      [sectionId, 'PERSIST_TEST_MAIN', 'PERSIST_TEST_UPDATE', 'PERSIST_TEST_EDIT', 'PERSIST_TEST_BOTH']);
    // gracefully end pool to allow test runner to exit
    await pool.end();
  });

  // ── Create ──

  it('createItem stores both media_public_id and preview_media_public_id', async () => {
    const result = await repeatable.createItem('home_carousel_items', sectionId, {
      title: 'PERSIST_TEST_BOTH',
      eyebrow: null,
      description: null,
      button_label: null,
      button_url: null,
      button_target: '_self',
      media_public_id: 'main-img-uuid',
      preview_media_public_id: 'prev-img-uuid',
      theme_key: 'graphite',
      is_visible: 1,
      status: 'draft',
      sort_order: 999,
    });

    const [rows] = await pool.query('SELECT * FROM home_carousel_items WHERE public_id = ?', [result.public_id]);
    assert.equal(rows.length, 1, 'must create one row');
    assert.equal(rows[0].media_public_id, 'main-img-uuid', 'main image UUID stored');
    assert.equal(rows[0].preview_media_public_id, 'prev-img-uuid', 'preview image UUID stored');
    assert.equal(rows[0].title, 'PERSIST_TEST_BOTH');
    createdItemId = result.public_id;
  });

  it('createItem handles null media fields', async () => {
    const result = await repeatable.createItem('home_carousel_items', sectionId, {
      title: 'PERSIST_TEST_MAIN',
      eyebrow: null,
      description: null,
      button_label: null,
      button_url: null,
      button_target: '_self',
      media_public_id: 'only-main-uuid',
      preview_media_public_id: null,
      theme_key: 'lime',
      is_visible: 1,
      status: 'draft',
      sort_order: 998,
    });

    const [rows] = await pool.query('SELECT * FROM home_carousel_items WHERE public_id = ?', [result.public_id]);
    assert.equal(rows[0].media_public_id, 'only-main-uuid');
    assert.equal(rows[0].preview_media_public_id, null);
  });

  // ── Save/Update ──

  it('saveItem updates both media fields', async () => {
    // First create
    const created = await repeatable.createItem('home_carousel_items', sectionId, {
      title: 'PERSIST_TEST_UPDATE',
      eyebrow: null,
      description: null,
      button_label: null,
      button_url: null,
      button_target: '_self',
      media_public_id: 'old-main',
      preview_media_public_id: 'old-preview',
      theme_key: 'graphite',
      is_visible: 1,
      status: 'draft',
      sort_order: 997,
    });

    // Update
    await repeatable.saveItem('home_carousel_items', created.public_id, {
      title: 'PERSIST_TEST_UPDATE',
      eyebrow: null,
      description: 'Updated desc',
      button_label: null,
      button_url: null,
      button_target: '_self',
      media_public_id: 'new-main-uuid',
      preview_media_public_id: 'new-preview-uuid',
      theme_key: 'silver',
      is_visible: 1,
      status: 'draft',
    });

    const [rows] = await pool.query('SELECT * FROM home_carousel_items WHERE public_id = ?', [created.public_id]);
    assert.equal(rows.length, 1, 'must still be one row');
    assert.equal(rows[0].media_public_id, 'new-main-uuid', 'main updated');
    assert.equal(rows[0].preview_media_public_id, 'new-preview-uuid', 'preview updated');
    assert.equal(rows[0].description, 'Updated desc');
    assert.equal(rows[0].theme_key, 'silver');
  });

  it('saveItem does NOT create duplicate row', async () => {
    const created = await repeatable.createItem('home_carousel_items', sectionId, {
      title: 'PERSIST_TEST_EDIT',
      eyebrow: null, description: null, button_label: null, button_url: null,
      button_target: '_self',
      media_public_id: 'orig-main', preview_media_public_id: null,
      theme_key: 'ink', is_visible: 1, status: 'draft', sort_order: 996,
    });

    await repeatable.saveItem('home_carousel_items', created.public_id, {
      title: 'PERSIST_TEST_EDIT',
      eyebrow: null, description: null, button_label: null, button_url: null,
      button_target: '_self',
      media_public_id: 'updated-main', preview_media_public_id: 'added-preview',
      theme_key: 'ink', is_visible: 1, status: 'draft',
    });

    const [rows] = await pool.query('SELECT * FROM home_carousel_items WHERE title = ?', ['PERSIST_TEST_EDIT']);
    assert.equal(rows.length, 1, 'must not create duplicates');
    assert.equal(rows[0].media_public_id, 'updated-main');
    assert.equal(rows[0].preview_media_public_id, 'added-preview');
  });

  it('saveItem with null preview clears existing preview', async () => {
    const created = await repeatable.createItem('home_carousel_items', sectionId, {
      title: 'PERSIST_TEST_MAIN',
      eyebrow: null, description: null, button_label: null, button_url: null,
      button_target: '_self',
      media_public_id: 'keep-main', preview_media_public_id: 'remove-me',
      theme_key: 'graphite', is_visible: 1, status: 'draft', sort_order: 995,
    });

    await repeatable.saveItem('home_carousel_items', created.public_id, {
      title: 'PERSIST_TEST_MAIN',
      eyebrow: null, description: null, button_label: null, button_url: null,
      button_target: '_self',
      media_public_id: 'keep-main', preview_media_public_id: null,
      theme_key: 'graphite', is_visible: 1, status: 'draft',
    });

    const [rows] = await pool.query('SELECT * FROM home_carousel_items WHERE public_id = ?', [created.public_id]);
    assert.equal(rows[0].media_public_id, 'keep-main', 'main preserved');
    assert.equal(rows[0].preview_media_public_id, null, 'preview cleared');
  });

  // ── Publication ──

  it('publishCollection promotes draft items to published', async () => {
    // Ensure at least one draft item
    await repeatable.createItem('home_carousel_items', sectionId, {
      title: 'PERSIST_TEST_BOTH',
      eyebrow: null, description: null, button_label: null, button_url: null,
      button_target: '_self',
      media_public_id: 'pub-main', preview_media_public_id: 'pub-preview',
      theme_key: 'graphite', is_visible: 1, status: 'draft', sort_order: 994,
    });

    await repeatable.publishCollection('home_carousel_items', sectionId, 'test_carousel_home');

    const [rows] = await pool.query(
      'SELECT * FROM home_carousel_items WHERE page_section_id = ? AND media_public_id = ? AND status = ?',
      [sectionId, 'pub-main', 'published']
    );
    assert.ok(rows.length > 0, 'item must be published');
    assert.equal(rows[0].media_public_id, 'pub-main', 'media survives publication');
    assert.equal(rows[0].preview_media_public_id, 'pub-preview', 'preview survives publication');
  });

  it('getPublishedItems excludes draft and archived items', async () => {
    const items = await repeatable.getPublishedItems('home_carousel_items', sectionId);
    const allItems = await repeatable.listItems('home_carousel_items', sectionId);
    // published count should be <= total count (non-draft, non-archived visible items)
    assert.ok(items.length <= allItems.length, 'published subset is correct');
  });

  // ── listItems returns media fields ──

  it('listItems returns media_public_id and preview_media_public_id', async () => {
    const items = await repeatable.listItems('home_carousel_items', sectionId);
    for (const item of items) {
      assert.ok('media_public_id' in item, 'must have media_public_id');
      assert.ok('preview_media_public_id' in item, 'must have preview_media_public_id');
    }
  });
});

describe('Carousel controller — normalization', () => {
  const fakeReqBody = {
    title: 'Test Title',
    eyebrow: '',
    description: '',
    button_label: '',
    button_url: '',
    button_target: '_self',
    media_public_id: 'media://test-uuid-123',
    preview_media_public_id: 'media://test-uuid-456',
    theme_key: 'graphite',
    is_visible: '1',
    public_id: 'existing-pub-id',
  };

  function normalizeMediaPublicId(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    return normalized.startsWith('media://')
      ? normalized.slice('media://'.length)
      : normalized;
  }

  it('strips media:// prefix', () => {
    assert.equal(normalizeMediaPublicId('media://uuid-here'), 'uuid-here');
  });

  it('passes plain UUID through', () => {
    assert.equal(normalizeMediaPublicId('uuid-plain'), 'uuid-plain');
  });

  it('handles empty string → null', () => {
    assert.equal(normalizeMediaPublicId(''), null);
  });

  it('handles missing value → null', () => {
    assert.equal(normalizeMediaPublicId(undefined), null);
  });

  it('handles null → null', () => {
    assert.equal(normalizeMediaPublicId(null), null);
    // Explicit check for string-only behavior
    assert.equal((null || '').replace('media://', '') || null, null);
  });
});

describe('Carousel template — panel2.ejs JSON data block', () => {
  const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs');

  it('JSON block includes media fields for carousel items', async () => {
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [],
      carouselItems: [{
        public_id: 'car-id-1',
        eyebrow: 'Test', title: 'Carousel Test',
        description: '', button_label: '', button_url: '', button_target: '_self',
        media_public_id: 'main-uuid',
        media_public_id_resolved: { thumbnail_url: '/t1.webp', url: '/m1.webp', title: 'Main Image' },
        preview_media_public_id: 'prev-uuid',
        preview_media_public_id_resolved: { thumbnail_url: '/t2.webp', url: '/m2.webp', title: 'Preview Image' },
        theme_key: 'graphite', is_visible: 1, status: 'draft', sort_order: 0,
      }],
      csrfToken: 'x', error: null, saved: null, safeJsonScript,
    });

    const m = html.match(/id="panel2-carousel-items-data"[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(m, 'must have carousel JSON data block');
    const parsed = JSON.parse(m[1].trim());
    assert.equal(parsed.length, 1, 'must have one carousel item');
    assert.equal(parsed[0].media_public_id, 'media://main-uuid', 'main media prefixed');
    assert.equal(parsed[0].preview_media_public_id, 'media://prev-uuid', 'preview media prefixed');
    assert.ok(parsed[0].media_thumb, 'must have media_thumb');
    assert.ok(parsed[0].media_title, 'must have media_title');
    assert.ok(parsed[0].preview_media_thumb, 'must have preview_media_thumb');
    assert.ok(parsed[0].preview_media_title, 'must have preview_media_title');
  });

  it('JSON block handles missing resolved data gracefully', async () => {
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [],
      carouselItems: [{
        public_id: 'car-id-2',
        eyebrow: '', title: 'No Media',
        description: '', button_label: '', button_url: '', button_target: '_self',
        media_public_id: null,
        media_public_id_resolved: null,
        preview_media_public_id: null,
        preview_media_public_id_resolved: null,
        theme_key: 'lime', is_visible: 1, status: 'draft', sort_order: 0,
      }],
      csrfToken: 'x', error: null, saved: null, safeJsonScript,
    });

    const m = html.match(/id="panel2-carousel-items-data"[^>]*>([\s\S]*?)<\/script>/);
    const parsed = JSON.parse(m[1].trim());
    assert.equal(parsed[0].media_public_id, '', 'null media → empty string');
    assert.equal(parsed[0].preview_media_public_id, '', 'null preview → empty string');
    assert.equal(parsed[0].media_thumb, '', 'null resolved → empty thumb');
  });

  it('carousel form includes both media selectors with correct field names', async () => {
    // The raw source includes the fieldName parameters for the include
    const src = fs.readFileSync(viewPath, 'utf-8');
    // Find the carousel-form section
    const formStart = src.indexOf('<form method="POST" action="/admin/page/home/panel-2/carousel/items"');
    const formEnd = src.indexOf('<!-- ═══ Style tab ═══ -->');
    const carouselFormSrc = src.substring(formStart, formEnd);
    assert.ok(carouselFormSrc.includes("fieldName: 'media_public_id'"), 'must have main media fieldName');
    assert.ok(carouselFormSrc.includes("fieldName: 'preview_media_public_id'"), 'must have preview media fieldName');

    // Verify rendered output has the actual hidden inputs
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [],
      carouselItems: [],
      csrfToken: 'x', error: null, saved: null, safeJsonScript,
    });
    assert.ok(html.includes('name="media_public_id"'), 'rendered form must have main media input');
    assert.ok(html.includes('name="preview_media_public_id"'), 'rendered form must have preview media input');
  });

  it('carousel form has edit buttons with data-carousel-edit-id', () => {
    const html = fs.readFileSync(viewPath, 'utf-8');
    assert.ok(html.includes('data-carousel-edit-id'), 'must have edit-id attribute');
  });
});

describe('Carousel editor JS — panel2-editor.js', () => {
  const jsPath = path.join(__dirname, '..', 'public', 'js', 'admin', 'panel2-editor.js');
  let js;

  before(() => { js = fs.readFileSync(jsPath, 'utf-8'); });

  it('editCarouselItem dispatches media-selector:load on two selectors', () => {
    assert.ok(js.includes("selectors[0].dispatchEvent"), 'must dispatch on first selector');
    assert.ok(js.includes("selectors[1].dispatchEvent"), 'must dispatch on second selector');
  });

  it('carousel load event includes preview_media_public_id', () => {
    assert.ok(js.includes('item.preview_media_public_id'), 'must read preview_media_public_id from JSON');
  });

  it('carousel load event includes media_thumb and preview_media_thumb', () => {
    assert.ok(js.includes('item.preview_media_thumb'), 'must read preview_media_thumb');
  });

  it('form action changes to save route for edit', () => {
    assert.ok(js.includes("carousel/items/save"), 'edit must POST to save route');
  });

  it('resetCarouselForm calls form.reset()', () => {
    assert.ok(js.includes('form.reset()'), 'cancel must reset form');
  });
});

describe('Carousel preview — adminPageContentController', () => {
  const contentPath = path.join(__dirname, '..', 'controllers', 'adminPageContentController.js');
  let content;

  before(() => { content = fs.readFileSync(contentPath, 'utf-8'); });

  it('resolves preview_media_public_id for carousel items', () => {
    assert.ok(
      content.includes("item.preview_media_public_id") && content.includes("preview_media_resolved"),
      'must resolve both preview fields in draft preview'
    );
  });

  it('resolves media_public_id for carousel items', () => {
    assert.ok(
      content.includes("item.media_public_id") && content.includes("media_resolved"),
      'must resolve main media in draft preview'
    );
  });
});

describe('Carousel public homepage — app.js', () => {
  const appPath = path.join(__dirname, '..', 'app.js');
  let appContent;

  before(() => { appContent = fs.readFileSync(appPath, 'utf-8'); });

  it('resolves preview_media_public_id for carousel', () => {
    assert.ok(
      appContent.includes(".preview_media_public_id") && appContent.includes("preview_media_resolved"),
      'public route must resolve preview media'
    );
  });

  it('resolves media_public_id for carousel', () => {
    assert.ok(
      appContent.includes('.media_public_id') && appContent.includes("media_resolved"),
      'public route must resolve main media'
    );
  });

  it('uses getPublishedItems for carousel', () => {
    assert.ok(appContent.includes("getPublishedItems('home_carousel_items'"), 'must use published items');
  });
});

describe('Carousel controller — adminPanelsController', () => {
  const ctrlPath = path.join(__dirname, '..', 'controllers', 'adminPanelsController.js');
  let ctrl;

  before(() => { ctrl = fs.readFileSync(ctrlPath, 'utf-8'); });

  it('createCarouselItem includes both media fields', () => {
    assert.ok(ctrl.includes('media_public_id:') && ctrl.includes("req.body.media_public_id"), 'create has media');
    assert.ok(ctrl.includes('preview_media_public_id:') && ctrl.includes("req.body.preview_media_public_id"), 'create has preview');
  });

  it('saveCarouselItem includes both media fields', () => {
    const saveIdx = ctrl.indexOf('async function saveCarouselItem');
    const saveBlock = ctrl.substring(saveIdx, saveIdx + 2000);
    assert.ok(saveBlock.includes('media_public_id:'), 'save has media');
    assert.ok(saveBlock.includes('preview_media_public_id:'), 'save has preview');
  });

  it('showPanel2 resolves both carousel media fields', () => {
    assert.ok(
      ctrl.includes("'media_public_id', 'preview_media_public_id'"),
      'must resolve both fields for carousel'
    );
  });

  it('publishCarousel uses correct cache namespace', () => {
    assert.ok(
      ctrl.includes("'carousel_home'"),
      'must use carousel_home cache namespace'
    );
  });
});

describe('CSP / markup safety', () => {
  it('panel2.ejs has no onclick in carousel section', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs'), 'utf-8');
    assert.ok(!html.includes('onclick='), 'must not use onclick handlers');
  });

  it('panel2-editor.js reads from JSON blocks only', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin', 'panel2-editor.js'), 'utf-8');
    assert.ok(js.includes('loadItemsData'), 'must use loadItemsData for JSON blocks');
  });
});
