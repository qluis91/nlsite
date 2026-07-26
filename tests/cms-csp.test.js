/**
 * CSP regression tests — nonce-based CSP compliance for admin views.
 * Run: node --test tests/cms-csp.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

// ── CSP header tests (source inspection) ──
describe('CSP header presence', () => {
  it('CSP nonce middleware exists in app.js', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8');
    assert.ok(source.includes('cspNonce'), 'app.js must set cspNonce');
    assert.ok(source.includes("'nonce-"), 'app.js CSP must use nonce- directive');
    const scriptSrcMatch = source.match(/scriptSrc\s*:\s*\[([^\]]+)\]/);
    assert.ok(scriptSrcMatch, 'scriptSrc must exist in CSP config');
    const scriptSrc = scriptSrcMatch[0];
    assert.ok(!scriptSrc.includes("unsafe-inline"), 'script-src must not have unsafe-inline');
  });

  it('CSP nonce uses crypto.randomBytes (per-request unique)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf-8');
    assert.ok(source.includes('randomBytes'), 'nonce should use crypto.randomBytes');
  });
});

// ── Inline script audit ──
describe('Admin views — no inline scripts', () => {
  const adminViews = [
    'pages/admin/page/panel2.ejs',
    'pages/admin/page/panel3.ejs',
    'pages/admin/page/navbar.ejs',
    'pages/admin/page/panel1.ejs',
  ];

  for (const view of adminViews) {
    it(`${view} has no <script> block (only type=json or src=)`, () => {
      const content = fs.readFileSync(path.join(__dirname, '..', 'views', view), 'utf-8');
      const scriptTags = content.match(/<script\b[^>]*>/gi) || [];
      for (const tag of scriptTags) {
        if (tag.includes('src=') || tag.includes('nonce=') || tag.includes('type="application/json"')) continue;
        assert.fail(`${view} has inline <script> without nonce: ${tag.substring(0, 80)}`);
      }
    });

    it(`${view} has no onclick handlers`, () => {
      const content = fs.readFileSync(path.join(__dirname, '..', 'views', view), 'utf-8');
      assert.ok(!content.includes('onclick='), `${view} must not have onclick handlers`);
    });

    it(`${view} has no inline onchange`, () => {
      const content = fs.readFileSync(path.join(__dirname, '..', 'views', view), 'utf-8');
      assert.ok(!content.includes('onchange="'), `${view} must not have inline onchange`);
    });
  }

  it('admin layout has no inline <script> block', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'views', 'layouts', 'admin.ejs'), 'utf-8');
    const scripts = content.match(/<script\b[^>]*>/gi) || [];
    for (const tag of scripts) {
      if (!tag.includes('src=') && !tag.includes('nonce=')) {
        assert.fail(`admin.ejs has inline <script> without nonce: ${tag.substring(0, 80)}`);
      }
    }
  });
});

// ── External editor script existence ──
describe('External editor scripts', () => {
  it('panel2-editor.js exists and is syntactically valid', () => {
    const fpath = path.join(__dirname, '..', 'public', 'js', 'admin', 'panel2-editor.js');
    assert.ok(fs.existsSync(fpath), 'panel2-editor.js must exist');
    const content = fs.readFileSync(fpath, 'utf-8');
    try { new Function(content); } catch (e) { assert.fail(`panel2-editor.js syntax: ${e.message}`); }
    assert.ok(content.includes('logoEditId'), 'should handle data attribute');
    assert.ok(content.includes('carouselEditId'), 'should handle carousel');
  });

  it('panel3-editor.js exists and is syntactically valid', () => {
    const fpath = path.join(__dirname, '..', 'public', 'js', 'admin', 'panel3-editor.js');
    assert.ok(fs.existsSync(fpath), 'panel3-editor.js must exist');
    const content = fs.readFileSync(fpath, 'utf-8');
    try { new Function(content); } catch (e) { assert.fail(`panel3-editor.js syntax: ${e.message}`); }
    assert.ok(content.includes('featureEditId'), 'should handle feature edit');
  });

  it('media-selector.js exists and is valid', () => {
    const fpath = path.join(__dirname, '..', 'public', 'js', 'admin', 'media-selector.js');
    assert.ok(fs.existsSync(fpath), 'media-selector.js must exist');
    try { new Function(fs.readFileSync(fpath, 'utf-8')); } catch (e) { assert.fail(`media-selector.js: ${e.message}`); }
  });
});

// ── EJS renders — CSP safe output ──
describe('EJS renders — CSP safe', () => {
  it('panel2.ejs renders with ID-based buttons and JSON blocks, no onclick/script', async () => {
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [{ public_id: 'test', item_type: 'text', text_content: 'Hi', media_public_id: null, url: null, link_type: 'internal', target: '_self', alt_text: null, is_visible: 1, status: 'draft', media_public_id_resolved: null }],
      carouselItems: [],
      csrfToken: 'x', error: null, saved: null,
    });
    assert.ok(html.includes('data-logo-edit-id'), 'must have data-logo-edit-id');
    assert.ok(html.includes('panel2-logo-items-data'), 'must have JSON data block');
    assert.ok(!html.includes('onclick='), 'must not have onclick');
    assert.ok(!html.match(/<script>(?!.*type="application\/json")/), 'must not have executable inline script');
  });

  it('panel3.ejs renders with ID-based buttons, no onclick/script', async () => {
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel3.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {},
      items: [{ public_id: 'test', title: 'T', description: '', detail_text: '', icon_type: 'builtin', icon_key: 'diseno-3d', media_public_id: null, url: null, link_type: 'internal', target: '_self', style_variant: '', is_visible: 1, status: 'draft', media_public_id_resolved: null }],
      csrfToken: 'x', error: null, saved: null,
    });
    assert.ok(html.includes('data-feature-edit-id'), 'must have data-feature-edit-id');
    assert.ok(html.includes('panel3-feature-items-data'), 'must have JSON data block');
    assert.ok(!html.includes('onclick='), 'must not have onclick');
  });
});

// ── JSON data block validity ──
describe('JSON data blocks', () => {
  it('panel2-logo-items-data block contains valid JSON', async () => {
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel2.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {}, bgMedia: null,
      logoItems: [{ public_id: 'test', item_type: 'text', text_content: 'Hello "World"', media_public_id: null, url: null, link_type: 'internal', target: '_self', alt_text: null, is_visible: 1, status: 'draft', media_public_id_resolved: null }],
      carouselItems: [],
      csrfToken: 'x', error: null, saved: null,
    });
    const m = html.match(/id="panel2-logo-items-data"[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(m, 'must have panel2-logo-items-data block');
    const parsed = JSON.parse(m[1].trim());
    assert.ok(Array.isArray(parsed), 'must parse to array');
    assert.equal(parsed[0].id, 'test');
  });

  it('panel3-feature-items-data block contains valid JSON', async () => {
    const viewPath = path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'panel3.ejs');
    const html = await ejs.renderFile(viewPath, {
      content: {}, style: {},
      items: [{ public_id: 'feat', title: 'Feature', description: '', detail_text: '', icon_type: 'builtin', icon_key: 'diseno-3d', media_public_id: null, url: null, link_type: 'internal', target: '_self', style_variant: '', is_visible: 1, status: 'draft', media_public_id_resolved: null }],
      csrfToken: 'x', error: null, saved: null,
    });
    const m = html.match(/id="panel3-feature-items-data"[^>]*>([\s\S]*?)<\/script>/);
    assert.ok(m, 'must have panel3-feature-items-data block');
    const parsed = JSON.parse(m[1].trim());
    assert.ok(Array.isArray(parsed), 'must parse to array');
    assert.equal(parsed[0].id, 'feat');
  });
});

// ── Controller includes editor scripts ──
describe('Controller loads editor scripts', () => {
  it('adminPanelsController includes panel2-editor.js and panel3-editor.js', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminPanelsController.js'), 'utf-8');
    assert.ok(source.includes('panel2-editor.js'), 'must include panel2-editor.js');
    assert.ok(source.includes('panel3-editor.js'), 'must include panel3-editor.js');
    assert.ok(source.includes('media-selector.js'), 'must include media-selector.js');
  });
});

// ── CMS admin views — no inline handlers ──
describe('CMS admin views — no inline handlers', () => {
  const files = [
    'views/pages/admin/page/panel2.ejs',
    'views/pages/admin/page/panel3.ejs',
    'views/pages/admin/page/navbar.ejs',
    'views/pages/admin/page/panel1.ejs',
  ];
  for (const f of files) {
    it(`${path.basename(f)} clean`, () => {
      const content = fs.readFileSync(path.join(__dirname, '..', f), 'utf-8');
      assert.ok(!content.includes('onclick='), 'no onclick');
      assert.ok(!content.includes('onchange="'), 'no onchange');
      // Only <script> tags with src=nonce= or type=json are OK
    });
  }
});

// ── Initialization guard check ──
describe('Editor initialization guards', () => {
  it('panel2-editor.js has guard against double init', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin', 'panel2-editor.js'), 'utf-8');
    assert.ok(content.includes('__panel2EditorInitialized'), 'must guard against double init');
  });

  it('panel3-editor.js has guard against double init', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin', 'panel3-editor.js'), 'utf-8');
    assert.ok(content.includes('__panel3EditorInitialized'), 'must guard against double init');
  });
});
