/**
 * Phase 14 tests — Analytics, Consent & Conversion Tracking.
 * Run: node --test tests/analytics-consent.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const pool = require('../config/db');

const BASE = { hostname: 'localhost', port: 3000 };

function fetch(path) {
  return new Promise((resolve, reject) => {
    http.get({ ...BASE, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

after(async () => {
  await pool.end();
});

// ──── Global settings editor ────
describe('Phase 14 — Global settings analytics fields', () => {
  it('global-settings.ejs has ga_enabled checkbox', () => {
    const tpl = fs.readFileSync('views/pages/admin/page/global-settings.ejs', 'utf-8');
    assert.ok(tpl.includes('ga_enabled'));
  });

  it('global-settings.ejs has ga_measurement_id input', () => {
    const tpl = fs.readFileSync('views/pages/admin/page/global-settings.ejs', 'utf-8');
    assert.ok(tpl.includes('ga_measurement_id'));
  });

  it('global-settings.ejs has google_verification input', () => {
    const tpl = fs.readFileSync('views/pages/admin/page/global-settings.ejs', 'utf-8');
    assert.ok(tpl.includes('google_verification'));
  });

  it('validator accepts valid G- measurement ID', () => {
    const { validateGlobalSettings } = require('../validators/cmsPanelsValidator');
    const errors = validateGlobalSettings({ ga_measurement_id: 'G-ABC123XYZ' });
    assert.equal(errors.length, 0);
  });

  it('validator rejects invalid measurement ID', () => {
    const { validateGlobalSettings } = require('../validators/cmsPanelsValidator');
    const errors = validateGlobalSettings({ ga_measurement_id: 'invalid' });
    assert.ok(errors.length > 0);
    assert.ok(errors[0].toLowerCase().includes('no v') || errors[0].toLowerCase().includes('invalid'));
  });

  it('validator accepts empty measurement ID', () => {
    const { validateGlobalSettings } = require('../validators/cmsPanelsValidator');
    const errors = validateGlobalSettings({ ga_measurement_id: '' });
    assert.equal(errors.length, 0);
  });
});

// ──── CSP ────
describe('Phase 14 — CSP for analytics domains', () => {
  it('app.js script-src allows googletagmanager.com', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    assert.ok(code.includes('googletagmanager.com'));
  });

  it('app.js script-src allows google-analytics.com', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    assert.ok(code.includes('google-analytics.com'));
  });

  it('app.js connect-src allows analytics domains', () => {
    const code = fs.readFileSync('app.js', 'utf-8');
    assert.ok(code.includes('analytics.google.com'));
  });
});

// ──── Layout injection ────
describe('Phase 14 — Consent banner in layouts', () => {
  it('main.ejs includes consent-banner.css when gaConsentEnabled', () => {
    const tpl = fs.readFileSync('views/layouts/main.ejs', 'utf-8');
    assert.ok(tpl.includes('consent-banner.css'));
  });

  it('store.ejs includes consent-banner.css when gaConsentEnabled', () => {
    const tpl = fs.readFileSync('views/layouts/store.ejs', 'utf-8');
    assert.ok(tpl.includes('consent-banner.css'));
  });

  it('main.ejs loads analytics.js', () => {
    const tpl = fs.readFileSync('views/layouts/main.ejs', 'utf-8');
    assert.ok(tpl.includes('/js/analytics.js'));
  });

  it('store.ejs loads analytics.js', () => {
    const tpl = fs.readFileSync('views/layouts/store.ejs', 'utf-8');
    assert.ok(tpl.includes('/js/analytics.js'));
  });

  it('main.ejs has Google Search Console meta tag', () => {
    const tpl = fs.readFileSync('views/layouts/main.ejs', 'utf-8');
    assert.ok(tpl.includes('google-site-verification'));
  });

  it('main.ejs injects __GA_MEASUREMENT_ID config', () => {
    const tpl = fs.readFileSync('views/layouts/main.ejs', 'utf-8');
    assert.ok(tpl.includes('__GA_MEASUREMENT_ID'));
  });
});

// ──── Conversion data attributes ────
describe('Phase 14 — Conversion tracking data attributes', () => {
  it('product detail has data-analytics-product-view', () => {
    const tpl = fs.readFileSync('views/pages/tienda-producto.ejs', 'utf-8');
    assert.ok(tpl.includes('data-analytics-product-view'));
  });

  it('product detail has add_to_cart data attribute', () => {
    const tpl = fs.readFileSync('views/pages/tienda-producto.ejs', 'utf-8');
    assert.ok(tpl.includes('data-analytics-event="add_to_cart"'));
  });

  it('product detail has whatsapp_click data attribute', () => {
    const tpl = fs.readFileSync('views/pages/tienda-producto.ejs', 'utf-8');
    assert.ok(tpl.includes('data-analytics-event="whatsapp_click"'));
  });

  it('checkout page has begin_checkout page event', () => {
    const tpl = fs.readFileSync('views/pages/checkout.ejs', 'utf-8');
    assert.ok(tpl.includes('data-analytics-page-event="begin_checkout"'));
  });

  it('checkout page has quote_start on quote-requiring delivery', () => {
    const tpl = fs.readFileSync('views/pages/checkout.ejs', 'utf-8');
    assert.ok(tpl.includes('data-analytics-event="quote_start"'));
  });

  it('checkout page has data-analytics-once for quote_start', () => {
    const tpl = fs.readFileSync('views/pages/checkout.ejs', 'utf-8');
    assert.ok(tpl.includes('data-analytics-once'));
  });

  it('checkout page triggers quote_start only for pending_quote deliveries', () => {
    const tpl = fs.readFileSync('views/pages/checkout.ejs', 'utf-8');
    // The quote_start attribute is guarded by dlv.shippingStatus === 'pending_quote'
    assert.ok(tpl.includes("dlv.shippingStatus === 'pending_quote'"));
  });

  it('checkout confirmation has conditional quote_submit', () => {
    const tpl = fs.readFileSync('views/pages/checkout-confirmation.ejs', 'utf-8');
    assert.ok(tpl.includes('data-analytics-page-event="quote_submit"'));
    // Must be conditional on isPendingShipping
    assert.ok(tpl.includes('isPendingShipping'));
  });
});

// ──── Consent CSS exists ────
describe('Phase 14 — Consent banner CSS', () => {
  it('consent-banner.css exists', () => {
    const css = fs.readFileSync('public/css/consent-banner.css', 'utf-8');
    assert.ok(css.includes('.cookie-consent'));
  });
});

// ──── Analytics JS exists and is valid ────
describe('Phase 14 — Analytics JS', () => {
  it('analytics.js syntax is valid', () => {
    const code = fs.readFileSync('public/js/analytics.js', 'utf-8');
    assert.ok(code.includes('__GA_MEASUREMENT_ID'));
    assert.ok(code.includes('cookie-consent'));
    assert.ok(code.includes('data-analytics-event'));
  });

  it('analytics.js has once-only duplicate prevention', () => {
    const code = fs.readFileSync('public/js/analytics.js', 'utf-8');
    assert.ok(code.includes('trackedOnce'));
    assert.ok(code.includes('data-analytics-once'));
  });

  it('analytics.js has change event listener for keyboard navigation', () => {
    const code = fs.readFileSync('public/js/analytics.js', 'utf-8');
    assert.ok(code.includes("addEventListener('change'"), 'must have change listener');
  });

  it('click handler skips radio and checkbox inputs', () => {
    const code = fs.readFileSync('public/js/analytics.js', 'utf-8');
    assert.ok(code.includes("el.type === 'radio' || el.type === 'checkbox'"), 'click handler must skip radios/checkboxes');
  });

  it('shared fireAnalyticsEvent function exists', () => {
    const code = fs.readFileSync('public/js/analytics.js', 'utf-8');
    assert.ok(code.includes('function fireAnalyticsEvent('));
  });
});

// ──── Live HTTP: no GA on loaded pages (consent not given yet) ────
describe('Phase 14 — Live HTTP rendering', () => {
  it('homepage has analytics.js script tag', async () => {
    const res = await fetch('/');
    assert.ok(res.body.includes('/js/analytics.js'));
  });

  it('store page has analytics.js script tag', async () => {
    const res = await fetch('/tienda');
    assert.ok(res.body.includes('/js/analytics.js'));
  });

  it('admin login redirect does NOT have GA config variables', async () => {
    const res = await fetch('/auth/login?returnTo=/admin');
    assert.equal(res.status, 200);
    assert.ok(!res.body.includes('__GA_MEASUREMENT_ID'), 'Login pages should not set GA config');
  });
});
