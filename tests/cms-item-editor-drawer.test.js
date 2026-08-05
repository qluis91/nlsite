const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const Module = require('node:module');
const vm = require('node:vm');
const { safeJsonScript } = require('../config/jsonLdHelper');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function renderPanel(name, locals = {}) {
  const defaults = name === 'panel2'
    ? { content: {}, style: {}, bgMedia: null, logoItems: [], carouselItems: [] }
    : { content: {}, style: {}, items: [] };
  return ejs.renderFile(path.join(root, 'views', 'pages', 'admin', 'page', `${name}.ejs`), {
    safeJsonScript,
    csrfToken: 'csrf-test-token',
    error: '',
    saved: '',
    capabilities: [
      'home.logoLoop.publish',
      'home.carousel.publish',
      'home.services.publish',
    ],
    ...defaults,
    ...locals,
  });
}

function logoItem() {
  return {
    public_id: 'logo-1', item_type: 'text', text_content: 'Logo', media_public_id: null,
    media_public_id_resolved: null, url: '', link_type: 'internal', target: '_self',
    alt_text: '', is_visible: 1, status: 'draft', sort_order: 0,
  };
}

function carouselItem() {
  return {
    public_id: 'carousel-1', eyebrow: '', title: 'Project', description: '',
    button_label: '', button_url: '', button_target: '_self', media_public_id: null,
    media_public_id_resolved: null, preview_media_public_id: null,
    preview_media_public_id_resolved: null, position_x: 50, position_y: 50,
    media_alt: '', preview_media_alt: '', theme_key: 'graphite', is_visible: 1,
    status: 'draft', sort_order: 0,
  };
}

function featureItem() {
  return {
    public_id: 'feature-1', title: 'Feature', description: '', detail_text: '',
    button_label: '', icon_type: 'builtin', icon_key: 'diseno-3d', media_public_id: null,
    media_public_id_resolved: null, media_alt: '', url: '', link_aria_label: '',
    link_type: 'internal', target: '_self', style_variant: '', is_visible: 1,
    status: 'draft', sort_order: 0,
  };
}

describe('reusable CMS item editor drawer', () => {
  it('renders LogoLoop and carousel editors as modal drawers, not visible inline forms', async () => {
    const html = await renderPanel('panel2', { logoItems: [logoItem()], carouselItems: [carouselItem()] });
    assert.match(html, /data-item-editor-drawer="logo"/);
    assert.match(html, /data-item-editor-drawer="carousel"/);
    assert.equal((html.match(/data-item-editor-drawer="logo"/g) || []).length, 1);
    assert.equal((html.match(/data-item-editor-drawer="carousel"/g) || []).length, 1);
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /data-item-editor-open data-editor-type="logo" data-mode="create"/);
    assert.match(html, /data-editor-type="logo" data-mode="edit"[\s\S]*data-item-id="logo-1"/);
    assert.match(html, /data-item-editor-open data-editor-type="carousel" data-mode="create"/);
    assert.match(html, /data-editor-type="carousel" data-mode="edit"[\s\S]*data-item-id="carousel-1"/);
    assert.doesNotMatch(html, /<details[^>]*>\s*<summary[^>]*>Agregar \/ Editar/);
    assert.ok(html.indexOf('id="logo-form"') > html.indexOf('data-item-editor-drawer="logo"'));
    assert.ok(html.indexOf('id="carousel-form"') > html.indexOf('data-item-editor-drawer="carousel"'));
  });

  it('renders the feature editor in the same reusable drawer shell', async () => {
    const html = await renderPanel('panel3', { items: [featureItem()] });
    assert.match(html, /data-item-editor-drawer="feature"/);
    assert.equal((html.match(/data-item-editor-drawer="feature"/g) || []).length, 1);
    assert.match(html, /data-item-editor-open data-editor-type="feature" data-mode="create"/);
    assert.match(html, /data-editor-type="feature" data-mode="edit"[\s\S]*data-item-id="feature-1"/);
    assert.doesNotMatch(html, /<details[^>]*>\s*<summary[^>]*>Agregar \/ Editar/);
    assert.ok(html.indexOf('id="feature-form"') > html.indexOf('data-item-editor-drawer="feature"'));
  });

  it('keeps CSRF, draft, collection publication, and media controls in drawer forms', async () => {
    const panel2 = await renderPanel('panel2');
    const panel3 = await renderPanel('panel3');
    assert.match(panel2, /name="_csrf" value="csrf-test-token"/);
    assert.match(panel2, />Guardar borrador</);
    assert.match(panel2, /formaction="\/admin\/page\/home\/panel-2\/logo-loop\/items\/save-publish"/);
    assert.match(panel2, /formaction="\/admin\/page\/home\/panel-2\/carousel\/items\/save-publish"/);
    assert.match(panel2, /data-media-selector/);
    assert.match(panel3, /formaction="\/admin\/page\/home\/panel-3\/items\/save-publish"/);
  });

  it('omits save-and-publish controls when publish capability is absent', async () => {
    const panel2 = await renderPanel('panel2', { capabilities: [] });
    const panel3 = await renderPanel('panel3', { capabilities: [] });
    assert.doesNotMatch(panel2, /items\/save-publish/);
    assert.doesNotMatch(panel3, /items\/save-publish/);
  });

  it('reopens the relevant drawer with submitted values and validation messages', async () => {
    const html = await renderPanel('panel3', {
      submittedItem: { kind: 'feature', values: { title: 'Valor conservado' } },
      fieldErrors: ['El título es obligatorio.'],
    });
    assert.match(html, /El título es obligatorio\./);
    assert.match(html, /panel3-submitted-item-data/);
    assert.match(html, /Valor conservado/);
    assert.match(read('public/js/admin/panel3-editor.js'), /submittedItem[\s\S]*requestOpen\('feature'/);
  });
});

describe('rendered HTML — no legacy inline editors', () => {
  it('Panel 2 does not contain "Agregar / Editar proyecto"', async () => {
    const html = await renderPanel('panel2', { logoItems: [logoItem()], carouselItems: [carouselItem()] });
    assert.doesNotMatch(html, /Agregar \/ Editar proyecto/);
  });

  it('Panel 2 does not contain a legacy carousel editor <details>', async () => {
    const html = await renderPanel('panel2', { logoItems: [logoItem()], carouselItems: [carouselItem()] });
    assert.doesNotMatch(html, /<details[^>]*id="carousel-edit-details"/);
    assert.doesNotMatch(html, /<summary[^>]*>Agregar \/ Editar/);
  });

  it('Panel 2 contains exactly one carousel form', async () => {
    const html = await renderPanel('panel2', { carouselItems: [carouselItem()] });
    const count = (html.match(/id="carousel-form"/g) || []).length;
    assert.equal(count, 1, 'Carousel form must appear exactly once');
  });

  it('Carousel form is a descendant of the carousel drawer root', async () => {
    const html = await renderPanel('panel2', { carouselItems: [carouselItem()] });
    const drawerIndex = html.indexOf('data-item-editor-drawer="carousel"');
    const formIndex = html.indexOf('id="carousel-form"');
    assert.ok(formIndex > drawerIndex, 'Carousel form must be inside the carousel drawer');
    // The form must appear before the closing </div> of the outer cms-editor wrapper
    // (the drawer is a child of data-cms-editor, and the form is inside the drawer)
    const editorCloseIndex = html.lastIndexOf('</div>');
    assert.ok(formIndex < editorCloseIndex, 'Carousel form must be inside the drawer, not after page close');
    // The drawer section closing </section> must appear after the form
    const sectionIndex = html.indexOf('<section', drawerIndex);
    assert.ok(sectionIndex > drawerIndex, 'Drawer must have a section element');
    const sectionCloseIndex = html.indexOf('</section>', sectionIndex);
    assert.ok(sectionCloseIndex > formIndex, 'Carousel form must be inside the drawer section');
  });

  it('Carousel reorder form exists outside the carousel drawer', async () => {
    const html = await renderPanel('panel2', { carouselItems: [carouselItem()] });
    const reorderIndex = html.indexOf('carousel/items/reorder');
    assert.ok(reorderIndex > -1, 'Carousel reorder form must exist');
    const drawerIndex = html.indexOf('data-item-editor-drawer="carousel"');
    // Reorder must be after the drawer closing (outside it) OR before the drawer starts
    // Since reorder is in the carousel tab before the drawer include at bottom of page
    const drawerOpen = html.indexOf('<div', drawerIndex);
    // Reorder should be BEFORE the drawer (since it's in the carousel tab)
    assert.ok(reorderIndex < drawerIndex, 'Carousel reorder form must be outside the carousel drawer');
  });

  it('Panel 2 contains exactly one LogoLoop form', async () => {
    const html = await renderPanel('panel2', { logoItems: [logoItem()] });
    const count = (html.match(/id="logo-form"/g) || []).length;
    assert.equal(count, 1, 'LogoLoop form must appear exactly once');
  });

  it('LogoLoop form is inside the LogoLoop drawer', async () => {
    const html = await renderPanel('panel2', { logoItems: [logoItem()] });
    const drawerIndex = html.indexOf('data-item-editor-drawer="logo"');
    const formIndex = html.indexOf('id="logo-form"');
    assert.ok(formIndex > drawerIndex, 'LogoLoop form must be inside the LogoLoop drawer');
  });

  it('Panel 3 contains exactly one feature form', async () => {
    const html = await renderPanel('panel3', { items: [featureItem()] });
    const count = (html.match(/id="feature-form"/g) || []).length;
    assert.equal(count, 1, 'Feature form must appear exactly once');
  });

  it('Feature form is inside the feature drawer', async () => {
    const html = await renderPanel('panel3', { items: [featureItem()] });
    const drawerIndex = html.indexOf('data-item-editor-drawer="feature"');
    const formIndex = html.indexOf('id="feature-form"');
    assert.ok(formIndex > drawerIndex, 'Feature form must be inside the feature drawer');
  });

  it('No create/edit forms appear after item lists as inline editors', async () => {
    const panel2 = await renderPanel('panel2', { logoItems: [logoItem()], carouselItems: [carouselItem()] });
    const panel3 = await renderPanel('panel3', { items: [featureItem()] });
    // Ensure forms are only inside drawers, not in the carousel/feature tabs as standalone elements
    // The forms have id="carousel-form", id="logo-form", id="feature-form"
    // Check that each form appears AFTER its drawer root
    for (const [html, formId, drawerAttr] of [
      [panel2, 'carousel-form', 'data-item-editor-drawer="carousel"'],
      [panel2, 'logo-form', 'data-item-editor-drawer="logo"'],
      [panel3, 'feature-form', 'data-item-editor-drawer="feature"'],
    ]) {
      const formIdx = html.indexOf(`id="${formId}"`);
      const drawerIdx = html.indexOf(drawerAttr);
      assert.ok(formIdx > drawerIdx, `${formId} must appear after ${drawerAttr}`);
    }
  });

  it('Add/Edit triggers still contain data-item-editor-open', async () => {
    const panel2 = await renderPanel('panel2', { logoItems: [logoItem()], carouselItems: [carouselItem()] });
    const panel3 = await renderPanel('panel3', { items: [featureItem()] });
    assert.match(panel2, /data-item-editor-open data-editor-type="logo" data-mode="create"/);
    assert.match(panel2, /data-item-editor-open data-editor-type="logo" data-mode="edit"/);
    assert.match(panel2, /data-item-editor-open data-editor-type="carousel" data-mode="create"/);
    assert.match(panel2, /data-item-editor-open data-editor-type="carousel" data-mode="edit"/);
    assert.match(panel3, /data-item-editor-open data-editor-type="feature" data-mode="create"/);
    assert.match(panel3, /data-item-editor-open data-editor-type="feature" data-mode="edit"/);
  });

  it('Validation-error state opens the correct drawer and preserves values', async () => {
    // Panel 2 LogoLoop validation error
    const panel2Logo = await renderPanel('panel2', {
      logoItems: [logoItem()],
      submittedItem: { kind: 'logo', values: { item_type: 'text', text_content: 'Test Logo' } },
      fieldErrors: ['El contenido de texto es obligatorio.'],
    });
    assert.match(panel2Logo, /El contenido de texto es obligatorio\./);
    assert.match(panel2Logo, /Test Logo/);
    assert.match(panel2Logo, /panel2-submitted-item-data/);
    assert.match(panel2Logo, /"kind":"logo"/);

    // Panel 2 Carousel validation error
    const panel2Carousel = await renderPanel('panel2', {
      carouselItems: [carouselItem()],
      submittedItem: { kind: 'carousel', values: { title: 'Test Project' } },
      fieldErrors: ['El título es obligatorio.'],
    });
    assert.match(panel2Carousel, /El título es obligatorio\./);
    assert.match(panel2Carousel, /Test Project/);

    // Panel 3 Feature validation error
    const panel3Feature = await renderPanel('panel3', {
      items: [featureItem()],
      submittedItem: { kind: 'feature', values: { title: 'Test Feature' } },
      fieldErrors: ['El título es obligatorio.'],
    });
    assert.match(panel3Feature, /El título es obligatorio\./);
    assert.match(panel3Feature, /Test Feature/);
    assert.match(panel3Feature, /panel3-submitted-item-data/);
  });

  it('LogoLoop reorder form is not inside the LogoLoop drawer', async () => {
    const html = await renderPanel('panel2', { logoItems: [logoItem()] });
    const reorderIndex = html.indexOf('logo-loop/items/reorder');
    const drawerIndex = html.indexOf('data-item-editor-drawer="logo"');
    assert.ok(reorderIndex > -1, 'LogoLoop reorder form must exist');
    assert.ok(reorderIndex < drawerIndex, 'LogoLoop reorder must be outside the LogoLoop drawer');
  });

  it('Feature reorder form is not inside the feature drawer', async () => {
    const html = await renderPanel('panel3', { items: [featureItem()] });
    const reorderIndex = html.indexOf('panel-3/items/reorder');
    const drawerIndex = html.indexOf('data-item-editor-drawer="feature"');
    assert.ok(reorderIndex > -1, 'Feature reorder form must exist');
    assert.ok(reorderIndex < drawerIndex, 'Feature reorder must be outside the feature drawer');
  });

  it('no legacy create/edit <details> wrappers in Panel 2 or Panel 3', async () => {
    const panel2 = await renderPanel('panel2', { logoItems: [logoItem()], carouselItems: [carouselItem()] });
    const panel3 = await renderPanel('panel3', { items: [featureItem()] });
    for (const html of [panel2, panel3]) {
      assert.doesNotMatch(html, /<details[^>]*>\s*<summary[^>]*>Agregar \/ Editar/);
      assert.doesNotMatch(html, /<details[^>]*>\s*<summary[^>]*>Agregar/);
    }
  });
});

describe('drawer interaction and layout contracts', () => {
  const drawerJs = read('public/js/admin/item-editor-drawer.js');
  const drawerCss = read('public/css/admin-page.css');
  const routes = read('routes/adminPanelsRoutes.js');

  it('guards dirty closing, Escape, focus trapping, return focus, and unload', () => {
    assert.match(drawerJs, /serializeForm/);
    assert.match(drawerJs, /Descartar cambios/);
    assert.match(drawerJs, /event\.key === 'Escape'/);
    assert.match(drawerJs, /trapFocus/);
    assert.match(drawerJs, /opener\?\.focus/);
    assert.match(drawerJs, /beforeunload/);
  });

  it('panel scripts open create and edit modes for all three item types', () => {
    const panel2Editor = read('public/js/admin/panel2-editor.js');
    const panel3Editor = read('public/js/admin/panel3-editor.js');
    assert.match(panel2Editor, /drawer\.register\('logo',[\s\S]*create:[\s\S]*edit:/);
    assert.match(panel2Editor, /drawer\.register\('carousel',[\s\S]*create:[\s\S]*edit:/);
    assert.match(panel3Editor, /drawer\.register\('feature',[\s\S]*create:[\s\S]*edit:/);
  });

  it('controllers load the shared drawer script before both panel-specific scripts', () => {
    const controller = read('controllers/adminPanelsController.js');
    assert.match(controller, /item-editor-drawer\.js'\s*,\s*'\/js\/admin\/panel2-editor\.js/);
    assert.match(controller, /item-editor-drawer\.js'\s*,\s*'\/js\/admin\/panel3-editor\.js/);
    assert.match(read('views/layouts/admin.ejs'), /<script src="<%= s %>"><\/script>/);
  });

  it('the shared delegated click prevents navigation and opens the requested drawer', () => {
    const listeners = {};
    const classNames = new Set();
    const classList = {
      add: (name) => classNames.add(name),
      remove: (name) => classNames.delete(name),
      toggle: (name, enabled) => enabled ? classNames.add(name) : classNames.delete(name),
    };
    const focusTarget = { hidden: false, closest: () => null, focus() {} };
    const form = { elements: [], querySelector: () => null, addEventListener() {} };
    const panel = { querySelectorAll: () => [focusTarget], focus() {} };
    const title = { textContent: '' };
    const modeLabel = { textContent: '' };
    const drawer = {
      dataset: { itemEditorDrawer: 'logo', createTitle: 'Create', editTitle: 'Edit' },
      hidden: true,
      inert: true,
      classList,
      addEventListener() {},
      setAttribute() {},
      removeAttribute() {},
      querySelector(selector) {
        if (selector === '[data-item-editor-form]') return form;
        if (selector === '.item-editor-drawer__panel') return panel;
        if (selector === '[data-item-editor-title]') return title;
        if (selector === '[data-item-editor-mode-label]') return modeLabel;
        if (selector === '[data-item-editor-autofocus]') return focusTarget;
        return null;
      },
    };
    const document = {
      body: { classList },
      activeElement: null,
      querySelectorAll: (selector) => selector === '[data-item-editor-drawer]' ? [drawer] : [],
      querySelector: () => null,
      addEventListener: (name, listener) => { listeners[name] = listener; },
    };
    const window = {
      requestAnimationFrame: (callback) => callback(),
      setTimeout: (callback) => callback(),
      matchMedia: () => ({ matches: true }),
      addEventListener() {},
      confirm: () => true,
    };
    vm.runInNewContext(drawerJs, { window, document, Map, Array, String });
    let preparedId = null;
    window.AdminItemEditorDrawer.register('logo', { edit: (id) => { preparedId = id; } });
    const trigger = {
      dataset: { editorType: 'logo', mode: 'edit', itemId: 'logo-1' },
      focus() {},
    };
    document.activeElement = trigger;
    let prevented = false;
    listeners.click({
      target: { closest: (selector) => selector === '[data-item-editor-open]' ? trigger : null },
      preventDefault: () => { prevented = true; },
    });
    assert.equal(prevented, true);
    assert.equal(preparedId, 'logo-1');
    assert.equal(drawer.hidden, false);
    assert.equal(drawer.inert, false);
    assert.equal(classNames.has('is-open'), true);
    assert.equal(classNames.has('item-editor-drawer-open'), true);
  });

  it('uses a fixed desktop drawer and full-screen mobile layout with only its body scrolling', () => {
    assert.match(drawerCss, /width:\s*min\(620px, 100vw\)/);
    assert.match(drawerCss, /height:\s*100dvh/);
    assert.match(drawerCss, /\.item-editor-drawer__body\s*\{[^}]*overflow-y:\s*auto/s);
    assert.match(drawerCss, /@media \(max-width: 680px\)/);
  });

  it('requires edit and publish capabilities plus CSRF on combined actions', () => {
    for (const capabilityPair of [
      ['LOGOLOOP_EDIT', 'LOGOLOOP_PUBLISH'],
      ['CAROUSEL_EDIT', 'CAROUSEL_PUBLISH'],
      ['SERVICES_EDIT', 'SERVICES_PUBLISH'],
    ]) {
      const expression = new RegExp(
        `save-publish'[^\\n]*${capabilityPair[0]}[^\\n]*${capabilityPair[1]}[^\\n]*csrfSynchronisedProtection`
      );
      assert.match(routes, expression);
    }
  });
});

describe('save-and-publish controller integration', () => {
  function loadController() {
    const calls = [];
    const repeatable = {
      createItem: async (...args) => calls.push(['createItem', ...args]),
      saveItem: async (...args) => calls.push(['saveItem', ...args]),
      publishCollection: async (...args) => calls.push(['publishCollection', ...args]),
    };
    const pool = {
      query: async () => [[{ id: 42, content_json: {}, style_json: {}, status: 'draft', is_enabled: 1 }]],
    };
    const validator = {
      validateLogoLoopItem: () => [],
      validateCarouselItem: () => [],
      validateFeatureItem: () => [],
      normalizeCarouselPosition: () => ({ x: 50, y: 50 }),
    };
    const originalLoad = Module._load;
    const controllerPath = require.resolve('../controllers/adminPanelsController');
    delete require.cache[controllerPath];
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === controllerPath) {
        if (request === '../services/cmsRepeatableService') return repeatable;
        if (request === '../services/cmsPublishingService') return {};
        if (request === '../services/mediaService') return { getByPublicId: async () => null };
        if (request === '../validators/cmsPanelsValidator') return validator;
        if (request === '../config/db') return pool;
        if (request === '../services/cmsContentService') return {};
        if (request === '../services/publicationService') return {};
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      return { controller: require(controllerPath), calls };
    } finally {
      Module._load = originalLoad;
      delete require.cache[controllerPath];
    }
  }

  function request(body) {
    return { body, session: { user: { id: 7 } } };
  }

  function response() {
    return { redirectUrl: null, redirect(url) { this.redirectUrl = url; return this; } };
  }

  it('creates a LogoLoop draft then publishes the complete LogoLoop collection', async () => {
    const { controller, calls } = loadController();
    const res = response();
    await controller.saveAndPublishLogoLoopItem(request({ item_type: 'text', text_content: 'Logo' }), res);
    assert.deepEqual(calls.map((call) => call[0]), ['createItem', 'publishCollection']);
    assert.deepEqual(calls[1].slice(1, 4), ['logo_loop_items', 42, 'logoLoop_home']);
    assert.equal(res.redirectUrl, '/admin/page/home/panel-2');
  });

  it('edits a carousel draft then publishes the complete carousel collection', async () => {
    const { controller, calls } = loadController();
    await controller.saveAndPublishCarouselItem(request({ public_id: 'carousel-1', title: 'Project' }), response());
    assert.deepEqual(calls.map((call) => call[0]), ['saveItem', 'publishCollection']);
    assert.deepEqual(calls[1].slice(1, 4), ['home_carousel_items', 42, 'carousel_home']);
  });

  it('creates a feature draft then publishes the complete feature collection', async () => {
    const { controller, calls } = loadController();
    await controller.saveAndPublishFeatureItem(request({ title: 'Feature', icon_type: 'builtin' }), response());
    assert.deepEqual(calls.map((call) => call[0]), ['createItem', 'publishCollection']);
    assert.deepEqual(calls[1].slice(1, 4), ['home_feature_items', 42, 'features_home']);
  });
});
