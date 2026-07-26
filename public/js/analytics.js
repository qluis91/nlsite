/**
 * Phase 14 — Analytics, Consent & Conversion Tracking.
 *
 * Consent flow:
 *  1. Page loads → cookie-consent banner shown if consent mode enabled.
 *  2. User clicks "Accept" → localStorage consent=accepted, banner hidden, GA4 loads.
 *  3. User clicks "Reject" → localStorage consent=rejected, banner hidden, GA4 blocked.
 *  4. On reload: if consent=accepted, load GA4 immediately (no banner).
 *  5. If consent=rejected or absent, show banner (if consent mode enabled).
 *
 * GA4 only loads when analytics is enabled, a valid G-... ID exists, and consent=accepted.
 *
 * Events via delegated data-analytics-event attributes:
 *  whatsapp_click, add_to_cart, checkout_start, quote_start, quote_submit.
 *  product_view fires automatically on product detail pages.
 */
(function () {
  'use strict';

  var GA_ID = window.__GA_MEASUREMENT_ID || '';
  var GA_ENABLED = window.__GA_ENABLED === true;
  var CONSENT_ENABLED = window.__CONSENT_ENABLED === true;
  var CONSENT_KEY = 'nl_ga_consent';
  var CONSENT_VERSION = 1;

  var consent = null;
  var bannerEl = null;
  var gaLoaded = false;
  var trackedOnce = {};

  function readConsent() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj && obj.v === CONSENT_VERSION && (obj.status === 'accepted' || obj.status === 'rejected')) {
        return obj;
      }
      return null;
    } catch (e) { return null; }
  }

  function writeConsent(status) {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ status: status, v: CONSENT_VERSION, ts: Date.now() }));
    } catch (e) {}
  }

  function revokeConsent() {
    try { localStorage.removeItem(CONSENT_KEY); } catch (e) {}
  }

  function loadGA4() {
    if (gaLoaded) return;
    if (!GA_ID || !GA_ENABLED) return;
    if (consent && consent.status !== 'accepted') return;
    gaLoaded = true;

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true, send_page_view: true });

    fireProductView();
    firePageEvents();
  }

  function buildBanner() {
    if (document.querySelector('.cookie-consent')) return;
    if (!CONSENT_ENABLED) return;

    var div = document.createElement('div');
    div.className = 'cookie-consent';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-label', 'Consentimiento de cookies');
    div.innerHTML =
      '<span class="cookie-consent__text">' +
      'Este sitio usa cookies de Google Analytics para medir visitas de forma anonima. ' +
      'No compartimos datos personales.</span>' +
      '<span class="cookie-consent__actions">' +
      '<button class="cookie-consent__btn cookie-consent__btn--accept" data-cookie-action="accept">Aceptar</button>' +
      '<button class="cookie-consent__btn cookie-consent__btn--reject" data-cookie-action="reject">Rechazar</button>' +
      '<button class="cookie-consent__btn cookie-consent__btn--prefs" data-cookie-action="prefs">Cambiar preferencias</button>' +
      '</span>';
    document.body.appendChild(div);
    bannerEl = div;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { div.classList.add('is-visible'); });
    });

    div.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cookie-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-cookie-action');
      handleConsentAction(action);
    });
  }

  function handleConsentAction(action) {
    if (action === 'accept') {
      writeConsent('accepted');
      consent = readConsent();
      hideBanner();
      loadGA4();
    } else if (action === 'reject') {
      writeConsent('rejected');
      consent = readConsent();
      hideBanner();
    } else if (action === 'prefs') {
      consent = null;
      revokeConsent();
      if (bannerEl) { bannerEl.remove(); bannerEl = null; gaLoaded = false; }
      buildBanner();
    }
  }

  function hideBanner() {
    if (!bannerEl) return;
    bannerEl.classList.remove('is-visible');
    setTimeout(function () { if (bannerEl) { bannerEl.remove(); bannerEl = null; } }, 400);
  }

  function track(eventName, params) {
    if (!gaLoaded || typeof gtag === 'undefined') return;
    var safe = {};
    if (params) {
      var keys = Object.keys(params);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = params[k];
        if (v == null || v === '') continue;
        if (typeof v === 'string') v = ('' + v).slice(0, 200);
        safe[k] = v;
      }
    }
    gtag('event', eventName, safe);
  }

  function fireProductView() {
    var root = document.querySelector('[data-analytics-product-view]');
    if (!root) return;
    var id = root.getAttribute('data-analytics-product-id');
    var name = root.getAttribute('data-analytics-product-name');
    var price = root.getAttribute('data-analytics-product-price');
    var category = root.getAttribute('data-analytics-product-category');
    if (id && name) {
      track('view_item', {
        currency: 'CRC',
        value: price || '0',
        items: [{ item_id: id, item_name: name, price: price || '0', item_category: category || '' }]
      });
    }
  }

  function firePageEvents() {
    var els = document.querySelectorAll('[data-analytics-page-event]');
    for (var i = 0; i < els.length; i++) {
      var eventName = els[i].getAttribute('data-analytics-page-event');
      if (eventName) track(eventName);
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-analytics-event]');
    if (!el) return;
    // Radios/checkboxes fire 'change' instead (handles keyboard navigation)
    if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) return;
    fireAnalyticsEvent(el);
  });

  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-analytics-event]');
    if (!el) return;
    fireAnalyticsEvent(el);
  });

  function fireAnalyticsEvent(el) {
    var eventName = el.getAttribute('data-analytics-event');
    // Prevent duplicate fires for once-only events
    if (el.hasAttribute('data-analytics-once')) {
      if (trackedOnce[eventName]) return;
      trackedOnce[eventName] = true;
    }
    var productName = el.getAttribute('data-analytics-product');
    var productId = el.getAttribute('data-analytics-product-id');
    var category = el.getAttribute('data-analytics-product-category');
    var params = {};
    if (productId) params.item_id = productId;
    if (productName) params.item_name = productName;
    if (category) params.item_category = category;
    track(eventName, params);
  }

  function init() {
    consent = readConsent();
    if (consent && consent.status === 'accepted') {
      loadGA4();
    } else {
      buildBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
