/**
 * Panel 3 CMS editor — tab switching and feature-card editor.
 * Reads item data from JSON data blocks (no inline onclick, no CSP violations).
 * Initializes once per page load (guarded).
 */
(function () {
  'use strict';

  if (window.__panel3EditorInitialized) return;
  window.__panel3EditorInitialized = true;

  // ── Guard: only run on Panel 3 page ──
  var tabNav = document.querySelector('.cms-tabs[aria-label="Secciones del Panel 3"]');
  if (!tabNav) return;

  // ── Load items from JSON block ──
  function loadItemsData() {
    var node = document.getElementById('panel3-feature-items-data');
    if (!node) return [];
    try {
      return JSON.parse(node.textContent || '[]');
    } catch (_) {
      return [];
    }
  }

  var featureItems = loadItemsData();
  var submittedItem = (function () {
    var node = document.getElementById('panel3-submitted-item-data');
    if (!node) return null;
    try { return JSON.parse(node.textContent || 'null'); } catch (_) { return null; }
  })();

  function findFeatureItem(id) {
    for (var i = 0; i < featureItems.length; i++) {
      if (featureItems[i].id === id) return featureItems[i];
    }
    return null;
  }

  // ── Tab switching ──
  tabNav.querySelectorAll('.cms-tab').forEach(function (tab) {
    if (tab.dataset.cmsTabBound) return;
    tab.dataset.cmsTabBound = '1';
    tab.addEventListener('click', function () {
      tabNav.querySelectorAll('.cms-tab').forEach(function (t) {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.cms-tab-panel').forEach(function (p) {
        p.classList.remove('is-active');
        p.hidden = true;
      });
      this.classList.add('is-active');
      this.setAttribute('aria-selected', 'true');
      var panel = document.querySelector('[data-panel="' + this.dataset.tab + '"]');
      if (panel) { panel.classList.add('is-active'); panel.hidden = false; }
    });
  });

  // ── Icon type switching ──
  var iconTypeSel = document.getElementById('feature-icon-type');
  var builtinGroup = document.getElementById('feature-builtin-group');
  var mediaGroup = document.getElementById('feature-media-group');

  function updateIconFields() {
    if (!iconTypeSel || !builtinGroup || !mediaGroup) return;
    builtinGroup.hidden = iconTypeSel.value !== 'builtin';
    mediaGroup.hidden = iconTypeSel.value !== 'media';
  }

  if (iconTypeSel) {
    iconTypeSel.addEventListener('change', updateIconFields);
    updateIconFields();
  }

  // ── Feature edit handler ──
  function editFeatureItem(item) {
    if (!item) return;
    var form = document.getElementById('feature-form');
    if (!form) return;
    var el = getEl;
    el('feature-edit-id').value = item.id || '';
    el('feature-title').value = item.title || '';
    el('feature-desc').value = item.description || '';
    el('feature-detail').value = item.detail_text || '';
    el('feature-button-label').value = item.button_label || 'VER DETALLE';
    if (iconTypeSel) iconTypeSel.value = item.icon_type || 'builtin';
    el('feature-icon-key').value = item.icon_key || '';
    var selector = form.querySelector('[data-media-selector]');
    if (selector) {
      selector.dispatchEvent(new CustomEvent('media-selector:load', {
        bubbles: true,
        detail: {
          value: item.media_public_id || '',
          publicId: (item.media_public_id || '').replace('media://', ''),
          thumbnailUrl: item.media_thumb || '',
          title: item.media_title || '',
        }
      }));
    }
    el('feature-url').value = item.url || '';
    el('feature-media-alt').value = item.media_alt || '';
    el('feature-link-aria').value = item.link_aria_label || '';
    el('feature-link-type').value = item.link_type || 'internal';
    el('feature-target').value = item.target || '_self';
    el('feature-style').value = item.style_variant || '';
    el('feature-visible').value = item.is_visible ? '1' : '0';
    el('feature-submit-btn').textContent = 'Guardar cambios';
    el('feature-cancel-btn').hidden = false;
    form.action = '/admin/page/home/panel-3/items/save';
    updateIconFields();
    var tc = document.querySelector('[data-tab="cards"]');
    if (tc) tc.click();
    var summary = document.querySelector('.cms-card summary');
    if (summary) summary.click();
  }

  function resetFeatureForm() {
    var form = document.getElementById('feature-form');
    var el = getEl;
    el('feature-edit-id').value = '';
    el('feature-submit-btn').textContent = 'Agregar tarjeta';
    el('feature-cancel-btn').hidden = true;
    if (form) {
      form.action = '/admin/page/home/panel-3/items';
      form.reset();
    }
    updateIconFields();
  }

  // ── Helper ──
  function getEl(id) {
    return document.getElementById(id) || {};
  }

  // ── Delegate edit clicks via data-feature-edit-id attributes ──
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.featureEditId) {
      var fi = findFeatureItem(btn.dataset.featureEditId);
      if (fi) editFeatureItem(fi);
      return;
    }

    if (btn.id === 'feature-cancel-btn') {
      resetFeatureForm();
    }
  });

  if (submittedItem && submittedItem.kind === 'feature' && submittedItem.values) {
    var values = submittedItem.values;
    editFeatureItem({
      id: values.public_id || '',
      title: values.title,
      description: values.description,
      detail_text: values.detail_text,
      button_label: values.button_label,
      icon_type: values.icon_type,
      icon_key: values.icon_key,
      media_public_id: values.media_public_id || '',
      media_alt: values.media_alt,
      url: values.url,
      link_aria_label: values.link_aria_label,
      link_type: values.link_type,
      target: values.target,
      style_variant: values.style_variant,
      is_visible: values.is_visible !== '0',
    });
    if (!values.public_id) document.getElementById('feature-form').action = '/admin/page/home/panel-3/items';
  }
})();
