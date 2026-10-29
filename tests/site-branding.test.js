/**
 * Runtime site branding normalization — NinjaLabCR
 * Run: node --test tests/site-branding.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const {
  CANONICAL_SITE_NAME,
  LEGACY_SITE_NAMES,
  normalizeSiteName,
} = require('../config/siteBranding');
const { startTestServer, stopTestServer } = require('./testServer');
const pool = require('../config/db');

const SITE_MODULE = path.join(__dirname, '..', 'config', 'site.js');

function reloadSiteModule() {
  delete require.cache[require.resolve('../config/site')];
  return require('../config/site');
}

describe('normalizeSiteName', () => {
  it('maps exact legacy placeholders to NinjaLabCR', () => {
    assert.equal(normalizeSiteName('Mi Sitio'), CANONICAL_SITE_NAME);
    assert.equal(normalizeSiteName('Mi Sitio Web'), CANONICAL_SITE_NAME);
    assert.equal(normalizeSiteName('NinjaLab CR'), CANONICAL_SITE_NAME);
  });

  it('maps empty / whitespace to NinjaLabCR', () => {
    assert.equal(normalizeSiteName(''), CANONICAL_SITE_NAME);
    assert.equal(normalizeSiteName('   '), CANONICAL_SITE_NAME);
    assert.equal(normalizeSiteName(null), CANONICAL_SITE_NAME);
    assert.equal(normalizeSiteName(undefined), CANONICAL_SITE_NAME);
  });

  it('preserves custom non-placeholder names', () => {
    assert.equal(normalizeSiteName('Cliente XYZ'), 'Cliente XYZ');
    assert.equal(normalizeSiteName('NinjaLab CR CMS'), 'NinjaLab CR CMS');
  });

  it('trims before comparing / returning', () => {
    assert.equal(normalizeSiteName('  Mi Sitio Web  '), CANONICAL_SITE_NAME);
    assert.equal(normalizeSiteName('  Cliente XYZ  '), 'Cliente XYZ');
  });

  it('exports the exact legacy allowlist', () => {
    assert.deepEqual([...LEGACY_SITE_NAMES], [
      'Mi Sitio',
      'Mi Sitio Web',
      'NinjaLab CR',
    ]);
  });
});

describe('config/site.js SITE_NAME normalization', () => {
  const previous = process.env.SITE_NAME;

  after(() => {
    if (previous === undefined) delete process.env.SITE_NAME;
    else process.env.SITE_NAME = previous;
    reloadSiteModule();
  });

  it('exposes NinjaLabCR when SITE_NAME is a legacy placeholder', () => {
    process.env.SITE_NAME = 'Mi Sitio Web';
    const site = reloadSiteModule();
    assert.equal(site.name, CANONICAL_SITE_NAME);
  });

  it('keeps a custom SITE_NAME', () => {
    process.env.SITE_NAME = 'Cliente XYZ';
    const site = reloadSiteModule();
    assert.equal(site.name, 'Cliente XYZ');
  });

  it('defaults to NinjaLabCR when SITE_NAME is unset', () => {
    delete process.env.SITE_NAME;
    const site = reloadSiteModule();
    assert.equal(site.name, CANONICAL_SITE_NAME);
  });
});

describe('setLocals site.name normalization', () => {
  const { setLocals } = require('../middlewares/authMiddleware');

  function run(existingSite) {
    const req = { path: '/', session: { user: null, cart: null } };
    const res = { locals: {} };
    if (existingSite) res.locals.site = existingSite;
    setLocals(req, res, () => {});
    return res.locals.site;
  }

  it('normalizes a legacy earlier site local in place fields', () => {
    const site = run({
      name: 'Mi Sitio',
      description: 'keep',
      colors: { primary: '#000' },
    });
    assert.equal(site.name, CANONICAL_SITE_NAME);
    assert.equal(site.description, 'keep');
  });

  it('preserves custom earlier site local by reference when already valid', () => {
    const existing = {
      name: 'CMS site',
      description: 'CMS description',
      colors: { primary: '#000000' },
    };
    assert.equal(run(existing), existing);
  });
});

describe('Public CMS site_name override + JSON-LD brand', () => {
  const BASE = { hostname: '127.0.0.1', port: 0 };
  let previousRow = null;

  function fetch(pathname) {
    return new Promise((resolve, reject) => {
      http.get({ ...BASE, path: pathname }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }).on('error', reject);
    });
  }

  async function upsertPublishedSiteName(value) {
    await pool.query(
      `INSERT INTO site_settings
         (setting_key, setting_value, published_value, value_type, setting_group, is_public)
       VALUES ('global.site_name', ?, ?, 'string', 'global', 1)
       ON DUPLICATE KEY UPDATE
         setting_value = VALUES(setting_value),
         published_value = VALUES(published_value)`,
      [value, value]
    );
  }

  before(async () => {
    const [[row]] = await pool.query(
      `SELECT setting_value, published_value FROM site_settings WHERE setting_key = 'global.site_name'`
    );
    previousRow = row || null;
    const server = await startTestServer();
    BASE.port = server.port;
  });

  after(async () => {
    if (previousRow) {
      await pool.query(
        `UPDATE site_settings SET setting_value = ?, published_value = ? WHERE setting_key = 'global.site_name'`,
        [previousRow.setting_value, previousRow.published_value]
      );
    } else {
      await pool.query(`DELETE FROM site_settings WHERE setting_key = 'global.site_name'`);
    }
    await stopTestServer();
    try { await pool.end(); } catch (_) { /* already closed */ }
  });

  it('published NinjaLabCR reaches public res.locals.site.name (footer)', async () => {
    await upsertPublishedSiteName('NinjaLabCR');
    const res = await fetch('/');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('NinjaLabCR'), 'footer/layout must show published brand');
    assert.ok(!res.body.includes('Mi Sitio Web'), 'must not show legacy placeholder');
  });

  it('stale published placeholder is normalized defensively', async () => {
    await upsertPublishedSiteName('Mi Sitio Web');
    const res = await fetch('/');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('NinjaLabCR'));
    assert.ok(!res.body.includes('Mi Sitio Web'));
    assert.ok(!/"name"\s*:\s*"Mi Sitio Web"/.test(res.body));
  });

  it('Organization/WebSite JSON-LD uses site brand, not seo_title', async () => {
    await upsertPublishedSiteName('NinjaLabCR');
    await pool.query(
      `INSERT INTO site_settings
         (setting_key, setting_value, published_value, value_type, setting_group, is_public)
       VALUES ('global.seo_title', 'Long SEO Phrase For Search', 'Long SEO Phrase For Search', 'string', 'global', 1)
       ON DUPLICATE KEY UPDATE
         setting_value = VALUES(setting_value),
         published_value = VALUES(published_value)`
    );
    const res = await fetch('/');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('"@type":"Organization"'));
    assert.ok(res.body.includes('"@type":"WebSite"'));
    assert.ok(
      res.body.includes('"name":"NinjaLabCR"') || res.body.includes('"name": "NinjaLabCR"'),
      'JSON-LD brand must be NinjaLabCR'
    );
    assert.ok(
      !res.body.includes('"name":"Long SEO Phrase For Search"'),
      'Organization name must not use seo_title'
    );
  });
});

// Keep module path referenced so accidental deletes fail loudly in CI grep audits
assert.ok(fs.existsSync(SITE_MODULE));
