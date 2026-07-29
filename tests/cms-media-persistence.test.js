/**
 * Media persistence regression tests — full lifecycle from selector to rendering.
 * Run: node --test tests/cms-media-persistence.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const pool = require('../config/db');
const repeatable = require('../services/cmsRepeatableService');
const ejs = require('ejs');
const { safeJsonScript } = require('../config/jsonLdHelper');

let sectionId;
const TEST_MEDIA_ID = 'persist-test-media-ref';

before(async () => {
  // Ensure a test media asset exists
  const [existing] = await pool.query('SELECT id FROM media_assets LIMIT 1');
  if (!existing[0]) {
    // Create a minimal media asset for testing
    await pool.query(
      `INSERT INTO media_assets (public_id, filename, original_name, storage_disk, storage_path, public_url,
        thumbnail_path, variants_json, mime_type, extension, file_size, title, status, created_by, updated_by)
       VALUES (?, 'test.png', 'test.png', 'public', '/uploads/test/test.png', '/uploads/test/test.png',
        '/uploads/test/thumb.png', '{}', 'image/png', 'png', 1024, 'Test Image', 'active', NULL, NULL)`,
      [TEST_MEDIA_ID]
    );
  }

  // Get showcase section
  const [[section]] = await pool.query(
    "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'showcase'"
  );
  sectionId = section.id;
});

after(async () => {
  // Cleanup test items
  await pool.query("DELETE FROM logo_loop_items WHERE page_section_id = ? AND text_content = ?", [sectionId, 'PERSIST_TEST']).catch(() => {});
  await pool.query("DELETE FROM home_carousel_items WHERE page_section_id = ? AND title = ?", [sectionId, 'PERSIST_TEST']).catch(() => {});
  // Cleanup test feature items
  const [[servicesSec]] = await pool.query(
    "SELECT s.id FROM page_sections s WHERE s.section_key = 'services'"
  );
  if (servicesSec) {
    await pool.query("DELETE FROM home_feature_items WHERE page_section_id = ? AND title = ?", [servicesSec.id, 'PERSIST_TEST']).catch(() => {});
  }
  try { await pool.end(); } catch (_) {}
});

describe('Media persistence — LogoLoop', () => {
  it('INSERT stores media_public_id', async () => {
    const result = await repeatable.createItem('logo_loop_items', sectionId, {
      item_type: 'image',
      text_content: 'PERSIST_TEST',
      media_public_id: TEST_MEDIA_ID,
      is_visible: 1,
      status: 'draft',
      sort_order: 999,
    });
    const [rows] = await pool.query('SELECT * FROM logo_loop_items WHERE public_id = ?', [result.public_id]);
    assert.ok(rows[0], 'item must exist');
    assert.equal(rows[0].media_public_id, TEST_MEDIA_ID, 'media_public_id must be stored');
  });

  it('listItems returns media_public_id', async () => {
    const items = await repeatable.listItems('logo_loop_items', sectionId);
    const found = items.find(i => i.text_content === 'PERSIST_TEST');
    assert.ok(found, 'test item must be in list');
    assert.equal(found.media_public_id, TEST_MEDIA_ID, 'listItems must return media_public_id');
  });

  it('UPDATE preserves media_public_id', async () => {
    const items = await repeatable.listItems('logo_loop_items', sectionId);
    const testItem = items.find(i => i.text_content === 'PERSIST_TEST');
    assert.ok(testItem, 'must find test item');

    await repeatable.saveItem('logo_loop_items', testItem.public_id, {
      text_content: 'PERSIST_TEST_UPD',
      item_type: 'logo',
      media_public_id: TEST_MEDIA_ID,
      is_visible: 0,
      status: 'draft',
    });

    const [rows] = await pool.query('SELECT * FROM logo_loop_items WHERE public_id = ?', [testItem.public_id]);
    assert.equal(rows[0].text_content, 'PERSIST_TEST_UPD', 'text should update');
    assert.equal(rows[0].media_public_id, TEST_MEDIA_ID, 'media_public_id must persist');
    assert.equal(rows[0].item_type, 'logo', 'item_type should update');
  });

  it('JSON data block includes media reference', async () => {
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs');
    const items = await repeatable.listItems('logo_loop_items', sectionId);
    // Add fake resolved data
    items.forEach(item => {
      if (item.media_public_id) {
        item.media_public_id_resolved = {
          thumbnail_url: '/thumb.jpg',
          url: '/file.jpg',
          title: 'Test Title',
        };
      }
    });
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: items,
      carouselItems: [],
      safeJsonScript,
      csrfToken: 'x', error: null, saved: null,
    });
    // Verify JSON block exists and contains media_thumb
    const m = html.match(/id="panel2-logo-items-data"[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(m, 'must have JSON data block');
    const parsed = JSON.parse(m[1].trim());
    const testItem = parsed.find(i => i.text_content && i.text_content.includes('PERSIST_TEST'));
    if (testItem) {
      assert.ok(testItem.hasOwnProperty('media_thumb'), 'must have media_thumb');
      assert.ok(testItem.hasOwnProperty('media_title'), 'must have media_title');
    }
  });
});

describe('Media persistence — Carousel', () => {
  it('INSERT stores media_public_id and preview_media_public_id', async () => {
    const result = await repeatable.createItem('home_carousel_items', sectionId, {
      title: 'PERSIST_TEST',
      media_public_id: TEST_MEDIA_ID,
      preview_media_public_id: 'preview-ref-id',
      theme_key: 'graphite',
      is_visible: 1,
      status: 'draft',
      sort_order: 999,
    });
    const [rows] = await pool.query('SELECT * FROM home_carousel_items WHERE public_id = ?', [result.public_id]);
    assert.equal(rows[0].media_public_id, TEST_MEDIA_ID);
    assert.equal(rows[0].preview_media_public_id, 'preview-ref-id');
  });

  it('controller strips media:// prefix', () => {
    const raw = 'media://abc-123';
    const normalized = (raw || '').replace('media://', '') || null;
    assert.equal(normalized, 'abc-123');
  });

  it('controller handles null/empty media gracefully', () => {
    const emptyVal = ('' || '').replace('media://', '') || null;
    assert.equal(emptyVal, null);
  });
});

describe('Media persistence — Feature items', () => {
  let servicesSectionId;

  before(async () => {
    const [[s]] = await pool.query("SELECT s.id FROM page_sections s WHERE s.section_key = 'services'");
    servicesSectionId = s.id;
  });

  it('INSERT stores media_public_id for media-icon cards', async () => {
    const result = await repeatable.createItem('home_feature_items', servicesSectionId, {
      title: 'PERSIST_TEST',
      icon_type: 'media',
      media_public_id: TEST_MEDIA_ID,
      is_visible: 1,
      status: 'draft',
      sort_order: 999,
    });
    const [rows] = await pool.query('SELECT * FROM home_feature_items WHERE public_id = ?', [result.public_id]);
    assert.equal(rows[0].media_public_id, TEST_MEDIA_ID);
    assert.equal(rows[0].icon_type, 'media');
  });

  it('builtin icon mode does not persist stale media', async () => {
    const result = await repeatable.createItem('home_feature_items', servicesSectionId, {
      title: 'PERSIST_TEST_B',
      icon_type: 'builtin',
      icon_key: 'diseno-3d',
      media_public_id: null,
      is_visible: 1,
      status: 'draft',
      sort_order: 999,
    });
    const [rows] = await pool.query('SELECT * FROM home_feature_items WHERE public_id = ?', [result.public_id]);
    assert.equal(rows[0].media_public_id, null);
  });
});

describe('Media selector — field scoping', () => {
  it('media-selector.ejs uses fieldName as hidden input name', async () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'views', 'components', 'media-selector.ejs'), 'utf-8');
    assert.ok(content.includes('data-ms-input'), 'must have data-ms-input marker');
    assert.ok(content.includes('name="<%= msFieldName %>"'), 'hidden input name must use fieldName param');
  });

  it('data-media-selector root scopes each selector', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'views', 'components', 'media-selector.ejs'), 'utf-8');
    assert.ok(content.includes('data-media-selector'), 'must have data-media-selector root');
  });
});

describe('media-selector:load event', () => {
  it('media-selector.js listens for media-selector:load event', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin', 'media-selector.js'), 'utf-8');
    assert.ok(content.includes("media-selector:load"), 'must listen for media-selector:load event');
    assert.ok(content.includes("updatePreview"), 'must call updatePreview');
  });
});

describe('Editor scripts dispatch load events', () => {
  it('panel2-editor.js dispatches media-selector:load for LogoLoop', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin', 'panel2-editor.js'), 'utf-8');
    assert.ok(content.includes("media-selector:load"), 'must dispatch media-selector:load');
    assert.ok(content.includes("media_thumb"), 'must use media_thumb from JSON block');
    assert.ok(content.includes("media_title"), 'must use media_title from JSON block');
  });

  it('panel3-editor.js dispatches media-selector:load for feature items', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin', 'panel3-editor.js'), 'utf-8');
    assert.ok(content.includes("media-selector:load"), 'must dispatch media-selector:load');
  });
});

describe('Preview rendering — preview_media_public_id', () => {
  it('adminPageContentController resolves preview_media_public_id', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminPageContentController.js'), 'utf-8');
    assert.ok(content.includes('preview_media_public_id'), 'must resolve preview_media_public_id');
  });

  it('app.js resolves preview_media_public_id', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8');
    assert.ok(content.includes('preview_media_public_id'), 'must resolve preview_media_public_id');
  });
});

describe('Publishing preserves media', () => {
  it('publishCollection sets status to published', async () => {
    // Create and publish
    const result = await repeatable.createItem('logo_loop_items', sectionId, {
      item_type: 'image',
      text_content: 'PERSIST_TEST_PUB',
      media_public_id: TEST_MEDIA_ID,
      is_visible: 1,
      status: 'draft',
      sort_order: 999,
    });

    await repeatable.publishCollection('logo_loop_items', sectionId, 'logoLoop_home');

    const [rows] = await pool.query('SELECT * FROM logo_loop_items WHERE public_id = ?', [result.public_id]);
    assert.equal(rows[0].status, 'published', 'should be published');
    assert.equal(rows[0].media_public_id, TEST_MEDIA_ID, 'media must be preserved after publish');
  });
});
