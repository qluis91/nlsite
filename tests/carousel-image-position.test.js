const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const focal = require('../public/js/admin/carousel-image-position');
const {
  migrateCarouselImagePosition,
  parsePublishedSnapshot,
} = require('../scripts/migrate-carousel-image-position');
const {
  migrateCarouselImageZoom,
  parsePublishedSnapshot: parseZoomPublishedSnapshot,
} = require('../scripts/migrate-carousel-image-zoom');
const { normalizeRepeatableRestoreSnapshot } = require('../controllers/adminPublishingController');

function migrationPool({ columns = [], items = [] } = {}) {
  const state = {
    columns: new Set(columns),
    items,
    alters: [],
    updates: [],
    begins: 0,
    commits: 0,
    rollbacks: 0,
    released: 0,
  };
  const connection = {
    async query(sql, params = []) {
      if (sql.includes('information_schema.COLUMNS')) {
        return [[...state.columns].map((COLUMN_NAME) => ({ COLUMN_NAME }))];
      }
      if (sql.startsWith('ALTER TABLE')) {
        const match = sql.match(/ADD COLUMN `([^`]+)`/);
        state.columns.add(match[1]);
        state.alters.push(match[1]);
        return [{ affectedRows: 0 }];
      }
      if (sql.includes('SELECT id, published_data')) return [state.items];
      if (sql.startsWith('UPDATE `home_carousel_items`')) {
        state.updates.push({ snapshot: JSON.parse(params[0]), id: params[1] });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected migration query: ${sql}`);
    },
    async beginTransaction() { state.begins += 1; },
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    release() { state.released += 1; },
  };
  return { state, getConnection: async () => connection };
}

test('normalizePosition uses integer rounding, clamping, and safe fallback', () => {
  const cases = [
    [null, 50],
    [undefined, 50],
    [true, 50],
    [false, 50],
    ['', 50],
    ['   ', 50],
    ['25.7', 26],
    ['0x20', 50],
    [[25], 50],
    [{ value: 25 }, 50],
    [Number.NaN, 50],
    [Number.POSITIVE_INFINITY, 50],
    [-0.6, 0],
    [-20, 0],
    [120, 100],
    ['+49.5', 50],
    ['.4', 0],
  ];

  cases.forEach(([input, expected]) => {
    assert.equal(focal.normalizePosition(input), expected, String(input));
  });
});

test('normalizePositionPair falls back independently per axis', () => {
  assert.deepEqual(focal.normalizePositionPair('bad', '72.6'), { x: 50, y: 73 });
  assert.deepEqual(focal.normalizePositionPair('18.2', []), { x: 18, y: 50 });
});

test('pointerDeltaToPosition uses inverse dimension-relative drag mapping', () => {
  assert.deepEqual(
    focal.pointerDeltaToPosition(50, 50, 20, 10, 200, 100),
    { x: 40, y: 40 }
  );
  assert.deepEqual(
    focal.pointerDeltaToPosition(50, 50, -20, -10, 200, 100),
    { x: 60, y: 60 }
  );
  assert.deepEqual(
    focal.pointerDeltaToPosition(95, 5, -100, 100, 200, 100),
    { x: 100, y: 0 }
  );
});

test('applyPreviewPosition and resetPosition stay synchronized', () => {
  const image = { style: {} };
  assert.deepEqual(focal.applyPreviewPosition(image, '25.7', 'bad'), { x: 26, y: 50 });
  assert.equal(image.style.objectPosition, '26% 50%');
  assert.deepEqual(focal.resetPosition(), { x: 50, y: 50 });
});

test('normalizeZoom uses integer rounding, clamping, and safe fallback', () => {
  const cases = [
    [null, 100],
    [undefined, 100],
    ['', 100],
    ['   ', 100],
    [50, 100],
    [100, 100],
    [150, 150],
    [250, 200],
    ['130.4', 130],
    ['bad', 100],
    [Number.NaN, 100],
    [[150], 100],
  ];
  cases.forEach(([input, expected]) => {
    assert.equal(focal.normalizeZoom(input), expected, String(input));
  });
});

test('applyPreviewFraming sets object-position, scale, and transform-origin', () => {
  const image = { style: {} };
  assert.deepEqual(
    focal.applyPreviewFraming(image, '25.7', 'bad', '130.4'),
    { x: 26, y: 50, zoom: 130 }
  );
  assert.equal(image.style.objectPosition, '26% 50%');
  assert.equal(image.style.transformOrigin, '26% 50%');
  assert.equal(image.style.transform, 'scale(1.3)');
  assert.deepEqual(focal.resetFraming(), { x: 50, y: 50, zoom: 100 });
});

test('migration recovers a partial schema and is idempotent per column', async () => {
  const pool = migrationPool({ columns: ['position_x'] });
  await migrateCarouselImagePosition(pool);
  assert.deepEqual(pool.state.alters, ['position_y']);
  assert.equal(pool.state.commits, 1);
  assert.equal(pool.state.rollbacks, 0);

  pool.state.alters.length = 0;
  await migrateCarouselImagePosition(pool);
  assert.deepEqual(pool.state.alters, []);
  assert.equal(pool.state.commits, 2);
  assert.equal(pool.state.released, 2);
});

test('migration adds both independently missing columns', async () => {
  const pool = migrationPool();
  await migrateCarouselImagePosition(pool);
  assert.deepEqual(pool.state.alters, ['position_x', 'position_y']);
});

test('migration merges focal keys without removing published snapshot keys', async () => {
  const pool = migrationPool({
    columns: ['position_x', 'position_y'],
    items: [{
      id: 7,
      published_data: JSON.stringify({ title: 'Keep me', future_key: { enabled: true }, position_x: '25.7' }),
    }],
  });
  await migrateCarouselImagePosition(pool);
  assert.deepEqual(pool.state.updates, [{
    id: 7,
    snapshot: {
      title: 'Keep me',
      future_key: { enabled: true },
      position_x: 26,
      position_y: 50,
    },
  }]);
});

test('migration reports malformed published_data and rolls back the backfill', async () => {
  const pool = migrationPool({
    columns: ['position_x', 'position_y'],
    items: [{ id: 8, published_data: '{not-json' }],
  });
  await assert.rejects(
    migrateCarouselImagePosition(pool),
    (error) => error.code === 'CMS_CAROUSEL_POSITION_MALFORMED_PUBLISHED_DATA'
  );
  assert.equal(pool.state.commits, 0);
  assert.equal(pool.state.rollbacks, 1);
  assert.deepEqual(pool.state.updates, []);
});

test('parsePublishedSnapshot rejects non-object legacy snapshots', () => {
  assert.throws(
    () => parsePublishedSnapshot('[]', 9),
    (error) => error.code === 'CMS_CAROUSEL_POSITION_MALFORMED_PUBLISHED_DATA'
  );
});

test('revision restore defaults missing axes independently without broad snapshot rewriting', () => {
  assert.deepEqual(
    normalizeRepeatableRestoreSnapshot('carousel_item', {
      published_data: { title: 'Published title', future_key: 'kept', position_x: '18.8' },
    }),
    {
      published_data: { title: 'Published title', future_key: 'kept', position_x: '18.8' },
      position_x: 19,
      position_y: 50,
      zoom_percent: 100,
    }
  );
  assert.deepEqual(
    normalizeRepeatableRestoreSnapshot('carousel_item', { title: 'Old revision', position_y: 'bad' }),
    { title: 'Old revision', position_x: 50, position_y: 50, zoom_percent: 100 }
  );
  assert.deepEqual(
    normalizeRepeatableRestoreSnapshot('carousel_item', { position_x: [], position_y: '72.6', zoom_percent: 250 }),
    { position_x: 50, position_y: 73, zoom_percent: 200 }
  );
});

test('zoom migration adds missing column and is idempotent', async () => {
  const pool = migrationPool({ columns: ['position_x', 'position_y'] });
  await migrateCarouselImageZoom(pool);
  assert.deepEqual(pool.state.alters, ['zoom_percent']);
  assert.equal(pool.state.commits, 1);

  pool.state.alters.length = 0;
  await migrateCarouselImageZoom(pool);
  assert.deepEqual(pool.state.alters, []);
  assert.equal(pool.state.commits, 2);
});

test('zoom migration merges zoom_percent without removing published snapshot keys', async () => {
  const pool = migrationPool({
    columns: ['position_x', 'position_y', 'zoom_percent'],
    items: [{
      id: 11,
      published_data: JSON.stringify({
        title: 'Keep me',
        future_key: { enabled: true },
        position_x: 40,
        position_y: 60,
      }),
    }],
  });
  await migrateCarouselImageZoom(pool);
  assert.deepEqual(pool.state.updates, [{
    id: 11,
    snapshot: {
      title: 'Keep me',
      future_key: { enabled: true },
      position_x: 40,
      position_y: 60,
      zoom_percent: 100,
    },
  }]);
});

test('zoom migration reports malformed published_data and rolls back', async () => {
  const pool = migrationPool({
    columns: ['zoom_percent'],
    items: [{ id: 12, published_data: '{not-json' }],
  });
  await assert.rejects(
    migrateCarouselImageZoom(pool),
    (error) => error.code === 'CMS_CAROUSEL_ZOOM_MALFORMED_PUBLISHED_DATA'
  );
  assert.equal(pool.state.commits, 0);
  assert.equal(pool.state.rollbacks, 1);
});

test('parseZoomPublishedSnapshot rejects non-object legacy snapshots', () => {
  assert.throws(
    () => parseZoomPublishedSnapshot('[]', 9),
    (error) => error.code === 'CMS_CAROUSEL_ZOOM_MALFORMED_PUBLISHED_DATA'
  );
});

test('public home template exposes carousel zoom CSS variable', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'home.ejs'), 'utf8');
  assert.match(home, /--carousel-zoom:<%= item\.zoom_percent %>/);
  assert.match(home, /project-carousel__image-frame/);
});

test('admin preview helper wiring binds zoom with framing sync', () => {
  const editor = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'panel2-editor.js'),
    'utf8'
  );
  assert.match(editor, /data-carousel-zoom/);
  assert.match(editor, /applyPreviewFraming/);
  assert.match(editor, /normalizeZoom\(item\.zoom_percent\)/);
});

test('carousel focal media listeners are scoped to each editor form', () => {
  const editor = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'panel2-editor.js'),
    'utf8'
  );
  assert.match(editor, /var form = root\.closest\('form'\)/);
  assert.match(editor, /form\.querySelector\('\[data-media-selector\]\[data-field-name=/);
  assert.match(editor, /mediaSelector\.addEventListener\('media-selector:change'/);
  assert.doesNotMatch(editor, /document\.addEventListener\('media-selector:change'/);
});

test('carousel focal initialization is idempotent for existing and dynamic editors', () => {
  const editor = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'panel2-editor.js'),
    'utf8'
  );
  assert.match(editor, /if \(root\.dataset\.carouselFocalBound\) return/);
  assert.match(editor, /window\.NLCarouselFocalEditor = \{ init: bindFocalEditors \}/);
});
