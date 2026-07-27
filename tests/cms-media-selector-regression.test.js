const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ejs = require('ejs');
const express = require('express');
const { safeJsonScript } = require('../config/jsonLdHelper');

const root = path.join(__dirname, '..');
const selectorPath = path.join(root, 'views', 'components', 'media-selector.ejs');
const viewPath = (name) => path.join(root, 'views', 'pages', 'admin', 'page', `${name}.ejs`);

function renderSelector(locals = {}) {
  return ejs.renderFile(selectorPath, locals);
}

function feature(overrides = {}) {
  return {
    public_id: 'feature-1',
    title: 'Servicio',
    description: '',
    detail_text: '',
    icon_type: 'builtin',
    icon_key: 'diseno-3d',
    media_public_id: null,
    media_public_id_resolved: null,
    url: '',
    link_type: 'internal',
    target: '_self',
    style_variant: '',
    is_visible: 1,
    status: 'draft',
    sort_order: 0,
    ...overrides,
  };
}

function renderAdminView(name, locals = {}) {
  const common = { csrfToken: 'test-csrf', error: '', saved: '' };
  const defaults = {
    navbar: {
      settings: {},
      navItems: [],
      mediaList: { items: [] },
      logoPrimary: null,
      logoLight: null,
      logoDark: null,
      favicon: null,
    },
    panel1: {
      section: null,
      mediaList: { items: [] },
      modelList: { items: [] },
      bgMedia: null,
      modelMedia: null,
      fallbackMedia: null,
    },
    panel2: {
      content: {},
      style: {},
      bgMedia: null,
      logoItems: [],
      carouselItems: [],
    },
    panel3: {
      content: {},
      style: {},
      items: [],
    },
  };
  return ejs.renderFile(viewPath(name), { safeJsonScript, ...common, ...defaults[name], ...locals });
}

describe('media-selector optional-local regression', () => {
  it('renders when currentValue is omitted', async () => {
    const html = await renderSelector({ fieldName: 'media' });
    assert.match(html, /data-ms-empty/);
  });

  it('renders when thumbnailUrl is omitted', async () => {
    const html = await renderSelector({ fieldName: 'media', currentValue: 'media://asset-1' });
    assert.match(html, /data-ms-icon/);
  });

  it('renders when optional arrays are omitted', async () => {
    const html = await renderSelector({ fieldName: 'media' });
    assert.match(html, /data-allowed-types=""/);
    assert.match(html, /data-allowed-categories=""/);
  });

  it('renders an empty-state selector', async () => {
    const html = await renderSelector({ fieldName: 'media', currentValue: '' });
    assert.match(html, /Sin imagen seleccionado/);
    assert.match(html, /value="" data-ms-input/);
  });

  it('renders selected media metadata and thumbnail', async () => {
    const html = await renderSelector({
      fieldName: 'media',
      currentValue: 'media://asset-1',
      thumbnailUrl: '/uploads/media/thumbnail.webp',
      selectedTitle: 'Icono',
      selectedCategory: 'icon',
      selectedMime: 'image/webp',
      selectedDimensions: '200×200',
    });
    assert.match(html, /thumbnail\.webp/);
    assert.match(html, />Icono</);
    assert.match(html, /icon · image\/webp/);
  });

  it('preserves the hidden media reference', async () => {
    const html = await renderSelector({
      fieldName: 'media_public_id',
      currentValue: 'media://asset-1',
    });
    assert.match(html, /name="media_public_id" value="media:\/\/asset-1"/);
  });

  it('renders safely and warns when fieldName is omitted', async () => {
    const html = await renderSelector();
    assert.match(html, /falta el fieldName requerido/);
    assert.match(html, /name="" value=""/);
  });

  it('keeps direct-upload and library-selection tabs', async () => {
    const html = await renderSelector({ fieldName: 'media' });
    assert.match(html, /data-ms-tab="library"/);
    assert.match(html, /data-ms-tab="upload"/);
    assert.match(html, /Subir desde mi dispositivo/);
  });
});

describe('CMS editor EJS rendering regression', () => {
  it('Panel 3 renders with no existing media icon', async () => {
    const html = await renderAdminView('panel3');
    assert.match(html, /name="media_public_id" value=""/);
  });

  it('Panel 3 renders an existing media icon', async () => {
    const item = feature({
      icon_type: 'media',
      icon_key: null,
      media_public_id: 'asset-1',
      media_public_id_resolved: {
        thumbnail_url: '/uploads/media/icon.webp',
        url: '/uploads/media/icon.webp',
      },
    });
    const html = await renderAdminView('panel3', { items: [item] });
    assert.match(html, /\/uploads\/media\/icon\.webp/);
    assert.match(html, /media:\/\/asset-1/);
  });

  it('Panel 3 built-in icon mode renders', async () => {
    const html = await renderAdminView('panel3', { items: [feature()] });
    assert.match(html, />diseno-3d</);
    assert.match(html, /value="builtin"/);
  });

  it('Panel 3 media icon mode renders', async () => {
    const html = await renderAdminView('panel3', {
      items: [feature({ icon_type: 'media', icon_key: null, media_public_id: 'asset-2' })],
    });
    assert.match(html, /value="media"/);
    assert.match(html, /media:\/\/asset-2/);
  });

  for (const [name, label] of [
    ['navbar', 'Navbar'],
    ['panel1', 'Panel 1'],
    ['panel2', 'Panel 2'],
  ]) {
    it(`${label} editor still renders`, async () => {
      const html = await renderAdminView(name);
      assert.match(html, /data-media-selector/);
    });
  }

  it('media-selector.js parses as JavaScript', () => {
    const source = fs.readFileSync(path.join(root, 'public', 'js', 'admin', 'media-selector.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source));
  });
});

describe('Panel 3 controller and authenticated route regression', () => {
  const pool = { query: async () => { throw new Error('Unexpected database query'); } };
  const originalModuleLoad = Module._load;
  Module._load = function loadWithFakePool(request, parent, isMain) {
    if (request === '../config/db') return pool;
    return originalModuleLoad.call(this, request, parent, isMain);
  };
  const repeatable = require('../services/cmsRepeatableService');
  const mediaStorage = require('../services/mediaStorageService');
  const controller = require('../controllers/adminPanelsController');
  Module._load = originalModuleLoad;
  const originalPoolQuery = pool.query;
  const originalListItems = repeatable.listItems;
  const originalStoredPathExists = mediaStorage.storedPathExists;
  const originalShowPanel3 = controller.showPanel3;

  afterEach(() => {
    pool.query = originalPoolQuery;
    repeatable.listItems = originalListItems;
    mediaStorage.storedPathExists = originalStoredPathExists;
    controller.showPanel3 = originalShowPanel3;
    delete require.cache[require.resolve('../routes/adminPanelsRoutes')];
  });

  it('does not query media assets when Panel 3 has no media reference', async () => {
    let queryCount = 0;
    pool.query = async () => {
      queryCount += 1;
      return [[{ id: 3, content_json: null, style_json: null, status: 'draft' }]];
    };
    repeatable.listItems = async () => [feature()];
    let rendered;
    await controller.showPanel3(
      { query: {} },
      { render(view, locals) { rendered = { view, locals }; } },
      (error) => { throw error; }
    );
    assert.equal(queryCount, 1);
    assert.equal(rendered.view, 'pages/admin/page/panel3');
    assert.equal(rendered.locals.items[0].media_public_id_resolved, null);
  });

  it('resolves a stored raw media UUID for the Panel 3 editor', async () => {
    const mediaId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const queries = [];
    pool.query = async (sql, params) => {
      queries.push({ sql, params });
      if (queries.length === 1) {
        return [[{ id: 3, content_json: {}, style_json: {}, status: 'draft' }]];
      }
      return [[{
        title: 'Icono',
        original_filename: 'icon.webp',
        mime_type: 'image/webp',
        category: 'icon',
        dimensions: '200×200',
        storage_path: 'media/icons/icon.webp',
        public_url: '/uploads/media/icons/icon.webp',
        thumbnail_path: 'media/icons/icon.webp',
        variants_json: null,
      }]];
    };
    mediaStorage.storedPathExists = async () => true;
    repeatable.listItems = async () => [
      feature({ icon_type: 'media', icon_key: null, media_public_id: mediaId }),
    ];
    let locals;
    await controller.showPanel3(
      { query: {} },
      { render(_view, viewLocals) { locals = viewLocals; } },
      (error) => { throw error; }
    );
    assert.equal(queries.length, 2);
    assert.deepEqual(queries[1].params, [mediaId]);
    assert.match(queries[1].sql, /original_name AS original_filename/);
    assert.equal(locals.items[0].media_public_id_resolved.thumbnail_url, '/uploads/media/icons/icon.webp');
  });

  it('authenticated admin Panel 3 route returns HTTP 200', async () => {
    controller.showPanel3 = (_req, res) => {
      renderAdminView('panel3').then(
        (html) => res.status(200).send(html),
        (error) => res.status(500).send(error.message)
      );
    };
    delete require.cache[require.resolve('../routes/adminPanelsRoutes')];
    const router = require('../routes/adminPanelsRoutes');
    const app = express();
    app.use((req, res, next) => {
      req.session = { user: { id: 1, role_id: 1 } };
      next();
    });
    app.use(router);

    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/page/home/panel-3`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Panel 3/);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
