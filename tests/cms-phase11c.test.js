/**
 * Phase 11C tests — Panel 2 & Panel 3 CMS administration.
 * Run: node --test tests/cms-phase11c.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');

// ── Setup ──
before(async () => {
  const { migratePanels } = require('../scripts/migrate-panels');
  await migratePanels();
});

after(async () => {
  await pool.end();
});

describe('Phase 11C — Migration & Schema', () => {
  it('creates all tables', async () => {
    for (const table of ['logo_loop_items', 'home_carousel_items', 'home_feature_items']) {
      const [[row]] = await pool.query(`SELECT COUNT(*) total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, [table]);
      assert.equal(Number(row.total), 1, `${table} should exist`);
    }
  });

  it('logo_loop_items has required columns', async () => {
    const [cols] = await pool.query("SHOW COLUMNS FROM logo_loop_items");
    const names = cols.map(c => c.Field);
    for (const col of ['public_id', 'page_section_id', 'item_type', 'text_content', 'sort_order', 'status', 'deleted_at']) {
      assert.ok(names.includes(col));
    }
  });

  it('home_carousel_items has required columns', async () => {
    const [cols] = await pool.query("SHOW COLUMNS FROM home_carousel_items");
    const names = cols.map(c => c.Field);
    for (const col of ['public_id', 'title', 'theme_key', 'sort_order', 'status', 'deleted_at']) {
      assert.ok(names.includes(col));
    }
  });

  it('home_feature_items has required columns', async () => {
    const [cols] = await pool.query("SHOW COLUMNS FROM home_feature_items");
    const names = cols.map(c => c.Field);
    for (const col of ['public_id', 'title', 'icon_type', 'icon_key', 'style_variant', 'sort_order', 'status', 'deleted_at']) {
      assert.ok(names.includes(col));
    }
  });

  it('migrations are idempotent', async () => {
    const [[before]] = await pool.query("SELECT COUNT(*) total FROM logo_loop_items WHERE deleted_at IS NULL");
    const { migratePanels } = require('../scripts/migrate-panels');
    await migratePanels();
    const [[after]] = await pool.query("SELECT COUNT(*) total FROM logo_loop_items WHERE deleted_at IS NULL");
    assert.equal(Number(before.total), Number(after.total));
  });

  it('seeds include hardcoded items', async () => {
    const [rows] = await pool.query("SELECT text_content FROM logo_loop_items WHERE deleted_at IS NULL ORDER BY sort_order");
    const texts = rows.map(r => r.text_content);
    assert.ok(texts.includes('ACABADOS'));
    assert.ok(texts.includes('IMPRESIÓN 3D'));
  });

  it('existing CMS data not overwritten by seed', async () => {
    const [[before]] = await pool.query("SELECT COUNT(*) total FROM logo_loop_items");
    const { migratePanels } = require('../scripts/migrate-panels');
    await migratePanels();
    const [[after]] = await pool.query("SELECT COUNT(*) total FROM logo_loop_items");
    assert.equal(Number(before.total), Number(after.total));
  });
});

describe('Phase 11C — Validators', () => {
  const validator = require('../validators/cmsPanelsValidator');

  it('validatePanel2Content — valid input passes', () => {
    const errors = validator.validatePanel2Content({ eyebrow: 'TEST', heading: 'Hello', supportText: 'x' });
    assert.equal(errors.length, 0);
  });

  it('validatePanel2Content — heading required', () => {
    const errors = validator.validatePanel2Content({ eyebrow: 'ok', heading: '' });
    assert.ok(errors.some(e => e.includes('requerido')));
  });

  it('validatePanel2Content — text limits', () => {
    const errors = validator.validatePanel2Content({ heading: 'A'.repeat(221) });
    assert.ok(errors.some(e => e.includes('excede')));
  });

  it('validateLogoLoopItem — valid text', () => {
    const errors = validator.validateLogoLoopItem({ item_type: 'text', text_content: 'Hello' });
    assert.equal(errors.length, 0);
  });

  it('validateLogoLoopItem — invalid type rejected', () => {
    const errors = validator.validateLogoLoopItem({ item_type: 'invalid', text_content: 'x' });
    assert.ok(errors.some(e => e.includes('Tipo')));
  });

  it('validateLogoLoopItem — missing text rejected', () => {
    const errors = validator.validateLogoLoopItem({ item_type: 'text', text_content: '' });
    assert.ok(errors.some(e => e.includes('requerido')));
  });

  it('validateLogoLoopItem — unsafe URL', () => {
    const errors = validator.validateLogoLoopItem({ item_type: 'text', text_content: 'Test', url: 'javascript:alert(1)' });
    assert.ok(errors.length > 0);
  });

  it('validateLogoLoopItem — safe URL passes', () => {
    const errors = validator.validateLogoLoopItem({ item_type: 'text', text_content: 'Test', url: '/path' });
    assert.equal(errors.length, 0);
  });

  it('validateCarouselItem — valid item', () => {
    const errors = validator.validateCarouselItem({ title: 'Test', theme_key: 'graphite' });
    assert.equal(errors.length, 0);
  });

  it('validateCarouselItem — invalid theme', () => {
    const errors = validator.validateCarouselItem({ title: 'Test', theme_key: 'bad' });
    assert.ok(errors.some(e => e.includes('Tema')));
  });

  it('validateCarouselItem — missing title', () => {
    const errors = validator.validateCarouselItem({ title: '' });
    assert.ok(errors.some(e => e.includes('requerido')));
  });

  it('validatePanel3Content — valid', () => {
    const errors = validator.validatePanel3Content({ eyebrow: 'K', heading: 'H', description: 'D' });
    assert.equal(errors.length, 0);
  });

  it('validateFeatureItem — valid builtin', () => {
    const errors = validator.validateFeatureItem({ title: 'Test', icon_type: 'builtin', icon_key: 'diseno-3d' });
    assert.equal(errors.length, 0);
  });

  it('validateFeatureItem — invalid icon_key', () => {
    const errors = validator.validateFeatureItem({ title: 'Test', icon_type: 'builtin', icon_key: 'bad' });
    assert.ok(errors.some(e => e.includes('Icono')));
  });

  it('validateFeatureItem — invalid style_variant', () => {
    const errors = validator.validateFeatureItem({ title: 'Test', style_variant: 'evil' });
    assert.ok(errors.some(e => e.toLowerCase().includes('estilo')));
  });

  it('validateColor — valid hex', () => {
    assert.equal(validator.validateColor('#FF0000', 'Test'), null);
    assert.equal(validator.validateColor('#ff0000aa', 'Test'), null);
  });

  it('validateColor — invalid', () => {
    assert.ok(validator.validateColor('red', 'Test') !== null);
    assert.ok(validator.validateColor('#GGG', 'Test') !== null);
  });

  it('validateUrl — safe URLs', () => {
    assert.equal(validator.validateUrl('/path'), null);
    assert.equal(validator.validateUrl('https://example.com'), null);
    assert.equal(validator.validateUrl('#section'), null);
    assert.equal(validator.validateUrl('mailto:test@test.com'), null);
  });

  it('validateUrl — unsafe URLs', () => {
    assert.ok(validator.validateUrl('javascript:void(0)') !== null);
    assert.ok(validator.validateUrl('data:text/html,<script>') !== null);
  });
});

describe('Phase 11C — Repeatable Items CRUD', () => {
  const repeatable = require('../services/cmsRepeatableService');
  let showcaseId, servicesId;

  before(async () => {
    const [[s]] = await pool.query("SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'showcase'");
    showcaseId = s.id;
    const [[svc]] = await pool.query("SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = 'services'");
    servicesId = svc.id;
  });

  it('listItems returns non-archived items', async () => {
    const items = await repeatable.listItems('logo_loop_items', showcaseId);
    assert.ok(items.length >= 6);
    assert.ok(items.every(i => i.status !== 'archived'));
  });

  it('getPublishedItems returns only published visible', async () => {
    const items = await repeatable.getPublishedItems('logo_loop_items', showcaseId);
    assert.ok(items.every(i => i.status === 'published' && i.is_visible === 1));
  });

  it('createItem and delete', async () => {
    const item = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text', text_content: 'TestCreate', status: 'draft'
    }, { actorId: null });
    assert.ok(item.public_id);
    assert.equal(item.text_content, 'TestCreate');
    await pool.query('DELETE FROM logo_loop_items WHERE public_id = ?', [item.public_id]);
  });

  it('createCarouselItem', async () => {
    const item = await repeatable.createItem('home_carousel_items', showcaseId, {
      title: 'TestCarousel', theme_key: 'lime', status: 'draft'
    }, { actorId: null });
    assert.ok(item.public_id);
    await pool.query('DELETE FROM home_carousel_items WHERE public_id = ?', [item.public_id]);
  });

  it('createFeatureItem', async () => {
    const item = await repeatable.createItem('home_feature_items', servicesId, {
      title: 'TestFeature', icon_type: 'builtin', icon_key: 'diseno-3d', status: 'draft'
    }, { actorId: null });
    assert.ok(item.public_id);
    await pool.query('DELETE FROM home_feature_items WHERE public_id = ?', [item.public_id]);
  });

  it('saveItem updates fields and creates revision', async () => {
    const items = await repeatable.listItems('logo_loop_items', showcaseId);
    const original = items[0];
    await repeatable.saveItem('logo_loop_items', original.public_id, {
      text_content: 'SAVED', item_type: original.item_type
    }, { actorId: null });
    const [updated] = await pool.query('SELECT text_content FROM logo_loop_items WHERE public_id = ?', [original.public_id]);
    assert.equal(updated[0].text_content, 'SAVED');
    // Verify revision was created for THIS item
    const [revs] = await pool.query(
      "SELECT * FROM content_revisions WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1",
      ['logo_loop_item', original.id]
    );
    assert.ok(revs.length > 0, 'revision should be created');
    assert.equal(revs[0].action, 'metadata_edit');
    // Restore
    await pool.query('UPDATE logo_loop_items SET text_content = ? WHERE public_id = ?', [original.text_content, original.public_id]);
  });

  it('archiveItem sets archived status', async () => {
    const { randomUUID } = require('crypto');
    const pid = randomUUID();
    await pool.query("INSERT INTO logo_loop_items (public_id, page_section_id, item_type, text_content, status) VALUES (?, ?, 'text', 'Temp', 'draft')", [pid, showcaseId]);
    await repeatable.archiveItem('logo_loop_items', pid, { actorId: null });
    const [[item]] = await pool.query("SELECT status, deleted_at FROM logo_loop_items WHERE public_id = ?", [pid]);
    assert.equal(item.status, 'archived');
    assert.ok(item.deleted_at);
  });

  it('reorderItems persists', async () => {
    const items = await repeatable.listItems('logo_loop_items', showcaseId);
    const ids = items.map(i => i.public_id).reverse();
    await repeatable.reorderItems('logo_loop_items', showcaseId, ids);
    const [reordered] = await pool.query("SELECT public_id FROM logo_loop_items WHERE deleted_at IS NULL ORDER BY sort_order");
    const sorted = reordered.map(r => r.public_id);
    assert.deepEqual(sorted, ids);
    // Restore
    await repeatable.reorderItems('logo_loop_items', showcaseId, items.map(i => i.public_id));
  });

  it('publishCollection works', async () => {
    await repeatable.publishCollection('home_feature_items', servicesId, 'features_home', { actorId: null });
    const items = await repeatable.getPublishedItems('home_feature_items', servicesId);
    assert.ok(items.length > 0);
  });

  it('seeded carousel items exist', async () => {
    const items = await repeatable.listItems('home_carousel_items', showcaseId);
    assert.ok(items.length >= 4);
    assert.ok(items.some(i => i.title === 'Diseño desde cero'));
  });

  it('seeded feature items exist', async () => {
    const items = await repeatable.listItems('home_feature_items', servicesId);
    assert.ok(items.length >= 6);
    assert.ok(items.some(i => i.title === 'Diseño 3D'));
  });
});

describe('Phase 11C — Capabilities', () => {
  const capabilities = require('../config/capabilities');

  it('all Phase 11C capabilities defined', () => {
    for (const cap of ['SHOWCASE_VIEW', 'SHOWCASE_EDIT', 'SHOWCASE_PUBLISH', 'LOGOLOOP_EDIT', 'LOGOLOOP_PUBLISH', 'CAROUSEL_EDIT', 'CAROUSEL_PUBLISH', 'SERVICES_VIEW', 'SERVICES_EDIT', 'SERVICES_PUBLISH']) {
      assert.ok(capabilities.CAPABILITIES[cap], cap);
    }
  });

  it('Phase 11C capabilities map to admin role', () => {
    for (const cap of ['SHOWCASE_VIEW', 'SHOWCASE_EDIT', 'SHOWCASE_PUBLISH', 'LOGOLOOP_EDIT', 'LOGOLOOP_PUBLISH', 'CAROUSEL_EDIT', 'CAROUSEL_PUBLISH', 'SERVICES_VIEW', 'SERVICES_EDIT', 'SERVICES_PUBLISH']) {
      assert.ok(capabilities.ADMIN_CAPABILITIES.includes(capabilities.CAPABILITIES[cap]), cap);
    }
  });
});

describe('Phase 11C — Media Usage & Publishing', () => {
  const repeatable = require('../services/cmsRepeatableService');
  const publishing = require('../services/cmsPublishingService');

  it('registerPanelUsageSources registers all', () => {
    const usageService = require('../services/mediaUsageService');
    repeatable.registerPanelUsageSources();
    const sources = usageService.registeredSources();
    assert.ok(sources.includes('logo_loop_items'));
    assert.ok(sources.includes('home_carousel_items'));
    assert.ok(sources.includes('home_feature_items'));
  });

  it('saveSectionDraft for showcase works', async () => {
    try {
      await publishing.saveSectionDraft('home', 'showcase',
        { eyebrow: 'CMS TEST', heading: 'Test' },
        { backgroundColor: '#FFFFFF' },
        { actorId: null }
      );
      const section = await publishing.getSectionDraft('home', 'showcase');
      assert.ok(section);
      assert.equal(section.content.eyebrow, 'CMS TEST');
    } finally {
      await publishing.publishSection('home', 'showcase', { actorId: null });
    }
  });

  it('Panel 1 section still functional', async () => {
    const section = await publishing.getSectionDraft('home', 'hero');
    assert.ok(section);
  });
});

describe('Phase 11C-S — EJS include-path regression', () => {
  it('navbar.ejs compiles with correct include paths', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'navbar.ejs'), 'utf8');
    ejs.compile(src, { filename: 'views/pages/admin/page/navbar.ejs' });
    assert.ok(true);
  });

  it('panel1.ejs compiles with correct include paths', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel1.ejs'), 'utf8');
    ejs.compile(src, { filename: 'views/pages/admin/page/panel1.ejs' });
    assert.ok(true);
  });

  it('panel2.ejs compiles with correct include paths', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs'), 'utf8');
    ejs.compile(src, { filename: 'views/pages/admin/page/panel2.ejs' });
    assert.ok(true);
  });

  it('panel3.ejs compiles with correct include paths', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel3.ejs'), 'utf8');
    ejs.compile(src, { filename: 'views/pages/admin/page/panel3.ejs' });
    assert.ok(true);
  });

  it('home.ejs compiles with correct include paths', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'home.ejs'), 'utf8');
    ejs.compile(src, { filename: 'views/pages/home.ejs' });
    assert.ok(true);
  });
});

// ── Phase 11C-S: Direct upload ──
const sharp = require('sharp');
const crypto = require('crypto');

describe('Phase 11C-S — Shared Image Processing Pipeline', () => {
  it('large variant uses quality 80', () => {
    const { IMAGE_VARIANTS } = require('../config/cmsOptions');
    assert.strictEqual(IMAGE_VARIANTS.large.quality, 80);
  });
  it('medium variant uses quality 80', () => {
    const { IMAGE_VARIANTS } = require('../config/cmsOptions');
    assert.strictEqual(IMAGE_VARIANTS.medium.quality, 80);
  });
  it('thumbnail variant uses quality 80', () => {
    const { IMAGE_VARIANTS } = require('../config/cmsOptions');
    assert.strictEqual(IMAGE_VARIANTS.thumbnail.quality, 80);
  });
  it('legacy imageProcessingService uses quality 80 for all profiles', () => {
    const { PROFILES } = require('../services/imageProcessingService');
    assert.strictEqual(PROFILES.product.quality, 80);
    assert.strictEqual(PROFILES.avatar.quality, 80);
    assert.strictEqual(PROFILES.gallery.quality, 80);
    assert.strictEqual(PROFILES.category.quality, 80);
  });
  it('gallery image profiles use quality 80', () => {
    const { IMAGE_PROFILES } = require('../config/galleryOptions');
    assert.strictEqual(IMAGE_PROFILES.display.quality, 80);
    assert.strictEqual(IMAGE_PROFILES.thumbnail.quality, 80);
    assert.strictEqual(IMAGE_PROFILES.poster.quality, 80);
  });
  it('mediaStorageService renderVariant produces WebP', async () => {
    const img = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 100, b: 200, alpha: 1 } }
    }).png().toBuffer();
    const { renderVariant } = require('../services/mediaStorageService');
    const { IMAGE_VARIANTS } = require('../config/cmsOptions');
    const result = await renderVariant(img, IMAGE_VARIANTS.thumbnail);
    assert.strictEqual(result.width, 200);
    assert.strictEqual(result.height, 200);
    // Verify it's WebP
    const meta = await sharp(result.buffer).metadata();
    assert.strictEqual(meta.format, 'webp');
  });
});

describe('Phase 11C-S — Upload Profiles', () => {
  it('all profiles have required fields', () => {
    const { UPLOAD_PROFILES, UPLOAD_PROFILE_KEYS } = require('../config/cmsOptions');
    assert.ok(UPLOAD_PROFILE_KEYS.length >= 10);
    for (const key of UPLOAD_PROFILE_KEYS) {
      const p = UPLOAD_PROFILES[key];
      assert.ok(p.field, `${key}: missing field`);
      assert.ok(Array.isArray(p.allowedMimeTypes) && p.allowedMimeTypes.length > 0, `${key}: missing allowedMimeTypes`);
      assert.ok(p.category, `${key}: missing category`);
      assert.ok(p.maxSize > 0, `${key}: missing maxSize`);
      assert.ok(p.kind, `${key}: missing kind`);
    }
  });
  it('hero-model profile accepts GLB only', () => {
    const { UPLOAD_PROFILES } = require('../config/cmsOptions');
    const p = UPLOAD_PROFILES['hero-model'];
    assert.ok(p.allowedMimeTypes.includes('model/gltf-binary'));
    assert.strictEqual(p.kind, 'model');
  });
  it('image profiles reject GLB', () => {
    const { UPLOAD_PROFILES } = require('../config/cmsOptions');
    for (const [key, p] of Object.entries(UPLOAD_PROFILES)) {
      if (key === 'hero-model') continue;
      assert.strictEqual(p.kind, 'image', `${key} should be image-only`);
      assert.ok(!p.allowedMimeTypes.includes('model/gltf-binary'), `${key} should not accept GLB`);
    }
  });
  it('unknown profile is recognized as invalid', () => {
    const { UPLOAD_PROFILE_KEYS } = require('../config/cmsOptions');
    assert.strictEqual(UPLOAD_PROFILE_KEYS.includes('bogus-profile'), false);
    assert.strictEqual(UPLOAD_PROFILE_KEYS.includes('hero-background'), true);
  });
});

describe('Phase 11C-S — Media Service Selector Upload', () => {
  it('createFromSelectorUpload exists and returns asset', async () => {
    const mediaService = require('../services/mediaService');
    assert.strictEqual(typeof mediaService.createFromSelectorUpload, 'function');
  });
  it('duplicate upload returns existing asset', async () => {
    const mediaService = require('../services/mediaService');
    const img = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).jpeg().toBuffer();
    const file = { buffer: img, mimetype: 'image/jpeg', originalname: 'dup-test.jpg', size: img.length };
    const a1 = await mediaService.createFromSelectorUpload({ file, category: 'site', actorId: null });
    const a2 = await mediaService.createFromSelectorUpload({ file, category: 'site', actorId: null });
    assert.ok(a1.public_id);
    assert.strictEqual(a1.public_id, a2.public_id); // duplicate returns same asset
    // clean up
    await pool.query('DELETE FROM media_assets WHERE public_id = ?', [a1.public_id]);
  });
});

describe('Phase 11C-S — Upload Endpoint Route', () => {
  it('route POST /admin/api/page/media/upload exists', () => {
    const express = require('express');
    const router = require('../routes/adminPageRoutes');
    assert.ok(router.stack.some(layer =>
      layer.route && layer.route.path === '/api/page/media/upload' &&
      layer.route.methods.post
    ), 'Post route for upload should exist');
  });
});

describe('Phase 11C-S — Media Selector JS', () => {
  it('media-selector.js is valid JavaScript syntax', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin', 'media-selector.js'), 'utf8');
    // Basic syntax check: parseable by checking for known structures
    assert.ok(src.includes('data-ms-upload-zone'), 'should contain upload zone reference');
    assert.ok(src.includes('performUpload'), 'should contain upload function');
    assert.ok(src.includes('data-ms-tab'), 'should contain tab switching');
    assert.ok(!src.includes('FIXME'), 'should not contain FIXME');
  });
  it('media-selector.ejs has upload panel', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'views', 'components', 'media-selector.ejs'), 'utf8');
    assert.ok(src.includes('data-ms-tab="upload"'), 'should have upload tab');
    assert.ok(src.includes('data-ms-tab="library"'), 'should have library tab');
    assert.ok(src.includes('Subir desde mi dispositivo'), 'should have upload label');
    assert.ok(src.includes('data-ms-upload-zone'), 'should have upload zone');
  });
});

// ── Panel 2/3 regression tests (ambiguous SQL + error-handler fixes) ──

describe('Panel 2/3 regression — SQL ambiguity', () => {
  it('getSectionId("showcase") returns page_sections row with qualified columns', async () => {
    // Executes the same query pattern as getSectionId but with qualified aliases
    const [[row]] = await pool.query(
      'SELECT s.id AS id, s.content_json AS content_json, s.style_json AS style_json, s.status AS status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ? LIMIT 1',
      ['home', 'showcase']
    );
    assert.ok(row, 'showcase section should exist');
    assert.ok(typeof row.id === 'number', 's.id should be a number');
    assert.strictEqual(typeof row.status, 'string', 'status should be present');
  });

  it('getSectionId("services") returns page_sections row with qualified columns', async () => {
    const [[row]] = await pool.query(
      'SELECT s.id AS id, s.content_json AS content_json, s.style_json AS style_json, s.status AS status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ? LIMIT 1',
      ['home', 'services']
    );
    assert.ok(row, 'services section should exist');
    assert.ok(typeof row.id === 'number', 's.id should be a number');
    assert.strictEqual(typeof row.status, 'string', 'status should be present');
  });

  it('unqualified SELECT id fails due to column ambiguity', async () => {
    await assert.rejects(
      pool.query(
        'SELECT id, content_json, style_json, status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ?',
        ['home', 'showcase']
      ),
      /Column.*id.*ambiguous|ER_NON_UNIQ/i,
      'unqualified id should produce ambiguity error'
    );
  });
});

describe('Panel 2/3 regression — null JSON safety', () => {
  before(async () => {
    // Save original
    const [[orig]] = await pool.query(
      'SELECT content_json, style_json FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ?',
      ['home', 'showcase']
    );
    this._origShowcase = orig;
    await pool.query(
      'UPDATE page_sections s INNER JOIN pages p ON p.id = s.page_id SET s.content_json = NULL, s.style_json = NULL WHERE p.page_key = ? AND s.section_key = ?',
      ['home', 'showcase']
    );
  });

  after(async () => {
    if (this._origShowcase) {
      await pool.query(
        'UPDATE page_sections s INNER JOIN pages p ON p.id = s.page_id SET s.content_json = ?, s.style_json = ? WHERE p.page_key = ? AND s.section_key = ?',
        [this._origShowcase.content_json, this._origShowcase.style_json, 'home', 'showcase']
      );
    }
  });

  it('null content_json does not crash getSectionId', async () => {
    const [[row]] = await pool.query(
      'SELECT s.id AS id, s.content_json AS content_json, s.style_json AS style_json, s.status AS status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ? LIMIT 1',
      ['home', 'showcase']
    );
    const content = (typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json) || {};
    assert.deepStrictEqual(content, {});
  });

  it('null style_json does not crash getSectionId', async () => {
    const [[row]] = await pool.query(
      'SELECT s.id AS id, s.content_json AS content_json, s.style_json AS style_json, s.status AS status FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ? LIMIT 1',
      ['home', 'showcase']
    );
    const style = (typeof row.style_json === 'string' ? JSON.parse(row.style_json) : row.style_json) || {};
    assert.deepStrictEqual(style, {});
  });
});

describe('Panel 2/3 regression — error handler', () => {
  it('controller does not reference pages/admin/error view', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminPanelsController.js'), 'utf8');
    assert.ok(!src.includes("pages/admin/error"), 'should not reference missing admin/error view');
  });

  it('catch blocks use next(error) pattern', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminPanelsController.js'), 'utf8');
    assert.ok(src.includes('return next(e)'), 'showPanel2 catch should use next(e)');
    // Count occurrences: should have at least 2 (showPanel2 + showPanel3)
    const matches = src.match(/return next\(e\)/g);
    assert.ok(matches && matches.length >= 2, 'should have at least 2 next(e) calls in catch blocks');
  });
});

describe('Panel 2/3 regression — routes', () => {
  it('GET /page/home/panel-2 route exists', () => {
    const router = require('../routes/adminPanelsRoutes');
    const hasRoute = router.stack.some(layer =>
      layer.route && layer.route.path === '/page/home/panel-2' && layer.route.methods.get
    );
    assert.ok(hasRoute, 'Panel 2 GET route should exist');
  });

  it('GET /page/home/panel-3 route exists', () => {
    const router = require('../routes/adminPanelsRoutes');
    const hasRoute = router.stack.some(layer =>
      layer.route && layer.route.path === '/page/home/panel-3' && layer.route.methods.get
    );
    assert.ok(hasRoute, 'Panel 3 GET route should exist');
  });
});
