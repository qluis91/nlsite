/**
 * Gallery v2 workflow: branding, confirm dialog, multi-row atlas,
 * thumbnail framing, automatic ordering.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const site = require('../config/site');
const validator = require('../validators/galleryValidator');
const media = require('../services/galleryMediaService');
const {
  migrateSiteBrandingNinjaLabCR,
  PLACEHOLDERS,
  CANONICAL,
} = require('../scripts/migrate-site-branding-ninjalabcr');
const {
  migrateGalleryThumbnailFraming,
  COLUMN_DEFINITIONS,
} = require('../scripts/migrate-gallery-thumbnail-framing');
const tracker = require('../scripts/migrationTracker');

const created = [];
const pool = require('../config/db');

after(async () => {
  await media.deleteAbsolutePaths(created);
  try { await pool.end(); } catch (_) { /* already closed */ }
});

describe('Branding — NinjaLabCR', () => {
  it('runtime defaults no longer use Mi Sitio placeholders', () => {
    assert.equal(site.name, process.env.SITE_NAME || 'NinjaLabCR');
    assert.doesNotMatch(site.name, /Mi Sitio/);
    const main = fs.readFileSync(path.join(root, 'views', 'layouts', 'main.ejs'), 'utf8');
    const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    const globalSettings = fs.readFileSync(
      path.join(root, 'views', 'pages', 'admin', 'page', 'global-settings.ejs'),
      'utf8'
    );
    assert.doesNotMatch(main, /Mi Sitio/);
    assert.doesNotMatch(envExample, /Mi Sitio/);
    assert.doesNotMatch(globalSettings, /Mi Sitio/);
    assert.match(main, /NinjaLabCR/);
    assert.match(envExample, /SITE_NAME=NinjaLabCR/);
    assert.doesNotMatch(main, /'NinjaLab CR'/);
  });

  it('branding migration only replaces known placeholders', async () => {
    const [beforeRows] = await pool.query(
      `SELECT setting_value, published_value FROM site_settings WHERE setting_key = 'global.site_name'`
    );
    const previous = beforeRows[0] || null;

    await pool.query(
      `INSERT INTO site_settings (setting_key, setting_value, published_value, value_type, setting_group, is_public)
       VALUES ('global.site_name', 'Mi Sitio Web', 'NinjaLab CR', 'string', 'global', 1)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), published_value = VALUES(published_value)`
    );
    await migrateSiteBrandingNinjaLabCR(pool);
    const [rows] = await pool.query(
      `SELECT setting_value, published_value FROM site_settings WHERE setting_key = 'global.site_name'`
    );
    assert.equal(rows[0].setting_value, CANONICAL);
    assert.equal(rows[0].published_value, CANONICAL);

    await pool.query(
      `UPDATE site_settings SET setting_value = ?, published_value = ? WHERE setting_key = 'global.site_name'`,
      ['Marca Personalizada XYZ', 'Marca Personalizada XYZ']
    );
    await migrateSiteBrandingNinjaLabCR(pool);
    const [kept] = await pool.query(
      `SELECT setting_value, published_value FROM site_settings WHERE setting_key = 'global.site_name'`
    );
    assert.equal(kept[0].setting_value, 'Marca Personalizada XYZ');
    assert.equal(kept[0].published_value, 'Marca Personalizada XYZ');

    if (previous) {
      await pool.query(
        `UPDATE site_settings SET setting_value = ?, published_value = ? WHERE setting_key = 'global.site_name'`,
        [previous.setting_value, previous.published_value]
      );
    } else {
      await pool.query(
        `UPDATE site_settings SET setting_value = ?, published_value = ? WHERE setting_key = 'global.site_name'`,
        [CANONICAL, CANONICAL]
      );
    }
    assert.ok(PLACEHOLDERS.includes('Mi Sitio'));
  });
});

describe('Admin confirm dialog', () => {
  it('admin layout loads confirmation styles and gallery delete is destructive', () => {
    const admin = fs.readFileSync(path.join(root, 'views', 'layouts', 'admin.ejs'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin-confirm-dialog.css'), 'utf8');
    const index = fs.readFileSync(path.join(root, 'views', 'pages', 'admin', 'gallery', 'index.ejs'), 'utf8');
    assert.match(admin, /admin-confirm-dialog\.css/);
    assert.match(admin, /confirm-dialog\.js/);
    assert.match(css, /\.confirm-dialog::backdrop/);
    assert.match(css, /width:\s*min\(92vw,\s*440px\)/);
    assert.match(css, /border-radius:\s*16px/);
    assert.match(css, /backdrop-filter:\s*blur/);
    assert.match(index, /data-confirm-destructive/);
    assert.match(index, /data-confirm-title="Eliminar elemento"/);
    assert.match(index, /name="_csrf"/);
  });
});

describe('Infinite Gallery multi-row atlas', () => {
  let rendererModule;

  before(async () => {
    const { pathToFileURL } = require('node:url');
    rendererModule = await import(
      pathToFileURL(path.join(root, 'public', 'js', 'gallery', 'infiniteMenuRenderer.mjs')).href
    );
  });

  it('maps logical items to flipped texture rows for incomplete final atlas rows', () => {
    // 5 items, sqrt → 3 columns, 2 rows (last row incomplete)
    const layout = rendererModule.createAtlasLayout(5, 4096);
    assert.equal(layout.columns, 3);
    assert.equal(layout.rows, 2);

    const cell0 = rendererModule.atlasCellUv(0, layout);
    const cell1 = rendererModule.atlasCellUv(1, layout);
    const cell3 = rendererModule.atlasCellUv(3, layout); // logical row 1
    const cell4 = rendererModule.atlasCellUv(4, layout);

    // After Y-flip compensation, logical row 0 uses textureRow = rows-1 = 1
    assert.equal(cell0.minV, 1 / 2);
    assert.equal(cell0.maxV, 1);
    assert.equal(cell1.minU, 1 / 3);
    assert.equal(cell1.minV, cell0.minV);

    // Logical row 1 uses textureRow 0 (bottom of flipped texture)
    assert.equal(cell3.minV, 0);
    assert.equal(cell3.maxV, 0.5);
    assert.equal(cell3.minU, 0);
    assert.equal(cell4.minU, 1 / 3);

    // Unused atlas cell (col 2, logical row 1) is never addressed by items 0-4
    const used = [0, 1, 2, 3, 4].map((index) => {
      const uv = rendererModule.atlasCellUv(index, layout);
      return `${Math.floor(uv.minU * layout.columns)}:${Math.floor(uv.minV * layout.rows)}`;
    });
    assert.equal(used.includes('2:0'), false);

    const shader = fs.readFileSync(
      path.join(root, 'public', 'js', 'gallery', 'infiniteMenuRenderer.mjs'),
      'utf8'
    );
    assert.match(shader, /textureRow = uAtlasRows - 1 - logicalRow/);
    assert.match(shader, /atlasThumbnailCandidates/);
    assert.doesNotMatch(
      shader,
      /int row = itemIndex \/ uAtlasColumns;\s*vec2 atlasUv/
    );
  });

  it('keeps one-row atlas V range correct', () => {
    // 2 items → columns=2, rows=1 (sqrt ceil)
    const layout = rendererModule.createAtlasLayout(2, 4096);
    assert.equal(layout.columns, 2);
    assert.equal(layout.rows, 1);
    const uv = rendererModule.atlasCellUv(1, layout);
    assert.equal(uv.minV, 0);
    assert.equal(uv.maxV, 1);
  });
});

describe('Gallery thumbnail framing', () => {
  it('migration registers framing columns and registry entry exists', () => {
    assert.ok(COLUMN_DEFINITIONS.thumbnail_position_x);
    assert.ok(COLUMN_DEFINITIONS.thumbnail_position_y);
    assert.ok(COLUMN_DEFINITIONS.thumbnail_zoom_percent);
    assert.ok(
      tracker.MIGRATION_REGISTRY.some((entry) => entry.name === 'migrateGalleryThumbnailFraming')
    );
    assert.ok(
      tracker.MIGRATION_REGISTRY.some((entry) => entry.name === 'migrateSiteBrandingNinjaLabCR')
    );
  });

  it('validator accepts ranges and rejects invalid framing', () => {
    const ok = validator.validateItem({
      title: 'Pieza',
      altText: 'Alt',
      mediaType: 'image',
      thumbnailPositionX: '20',
      thumbnailPositionY: '70',
      thumbnailZoomPercent: '150',
    }, []);
    assert.equal(ok.valid, true);
    assert.equal(ok.value.thumbnailPositionX, 20);
    assert.equal(ok.value.thumbnailPositionY, 70);
    assert.equal(ok.value.thumbnailZoomPercent, 150);
    assert.equal(ok.value.sortOrder, undefined);

    const legacy = validator.validateItem({
      title: 'Legacy',
      altText: 'Alt',
      mediaType: 'image',
    }, []);
    assert.equal(legacy.valid, true);
    assert.equal(legacy.value.thumbnailPositionX, 50);
    assert.equal(legacy.value.thumbnailPositionY, 50);
    assert.equal(legacy.value.thumbnailZoomPercent, 100);

    assert.equal(validator.validateItem({
      title: 'Bad',
      altText: 'Alt',
      mediaType: 'image',
      thumbnailPositionX: '101',
    }, []).valid, false);
    assert.equal(validator.validateItem({
      title: 'Bad',
      altText: 'Alt',
      mediaType: 'image',
      thumbnailZoomPercent: '99',
    }, []).valid, false);
  });

  it('admin form exposes framing controls and hides manual order', () => {
    const form = fs.readFileSync(path.join(root, 'views', 'pages', 'admin', 'gallery', 'form.ejs'), 'utf8');
    const controller = fs.readFileSync(
      path.join(root, 'controllers', 'adminGalleryController.js'),
      'utf8'
    );
    assert.match(form, /name="thumbnailPositionX"/);
    assert.match(form, /name="thumbnailPositionY"/);
    assert.match(form, /name="thumbnailZoomPercent"/);
    assert.match(form, /data-gallery-framing-reset/);
    assert.doesNotMatch(form, /name="sortOrder"/);
    assert.match(controller, /gallery-thumbnail-framing\.js/);
    assert.match(controller, /carousel-image-position\.js/);
    assert.match(controller, /processFramedThumbnailFromPublicPath/);
  });

  it('generates framed 512×512 WebP thumbnails at quality 80', async () => {
    const buffer = await sharp({
      create: { width: 900, height: 600, channels: 3, background: { r: 200, g: 40, b: 40 } },
    }).jpeg().toBuffer();
    const file = {
      buffer,
      mimetype: 'image/jpeg',
      size: buffer.length,
      originalname: 'frame-source.jpg',
    };
    const result = await media.processImagePair(file, {
      framing: { thumbnailPositionX: 20, thumbnailPositionY: 80, thumbnailZoomPercent: 140 },
    });
    created.push(...result.createdPaths);
    const thumbMeta = await sharp(media.resolveSafeGalleryPath(result.thumbnailPath, 'thumbnails')).metadata();
    assert.equal(thumbMeta.format, 'webp');
    assert.equal(thumbMeta.width, 512);
    assert.equal(thumbMeta.height, 512);
  });
});

describe('Automatic gallery item order', () => {
  it('create path ignores submitted sort order and uses transactional increments', () => {
    const service = fs.readFileSync(path.join(root, 'services', 'galleryService.js'), 'utf8');
    assert.match(service, /ORDER BY sort_order DESC, id DESC/);
    assert.match(service, /FOR UPDATE/);
    assert.match(service, /existing\.sort_order \+ 10|Number\(rows\[0\]\.sort_order\) \+ 10/);
    assert.match(service, /preservedSortOrder/);
    const form = fs.readFileSync(path.join(root, 'views', 'pages', 'admin', 'gallery', 'form.ejs'), 'utf8');
    assert.doesNotMatch(form, /name="sortOrder"/);
    const categories = fs.readFileSync(
      path.join(root, 'views', 'pages', 'admin', 'gallery', 'categories.ejs'),
      'utf8'
    );
    assert.match(categories, /name="sortOrder"/);
  });
});

describe('Forward migrations registered', () => {
  it('gallery framing migration is idempotent on columns', async () => {
    await migrateGalleryThumbnailFraming(pool);
    await migrateGalleryThumbnailFraming(pool);
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gallery_items'
          AND COLUMN_NAME IN ('thumbnail_position_x','thumbnail_position_y','thumbnail_zoom_percent')`
    );
    assert.equal(cols.length, 3);
  });
});
