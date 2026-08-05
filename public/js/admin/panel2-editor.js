/**
 * Panel 2 CMS editor — tab switching, LogoLoop, and carousel editors.
 * Reads item data from JSON data blocks (no inline onclick, no CSP violations).
 * Initializes once per page load (guarded).
 */
(function () {
  'use strict';

  if (window.__panel2EditorInitialized) return;
  window.__panel2EditorInitialized = true;

  // ── Guard: only run on Panel 2 page ──
  var tabNav = document.querySelector('.cms-tabs[aria-label="Secciones del Panel 2"]');
  if (!tabNav) return;

  // ── Load item data from JSON blocks ──
  function loadItemsData(blockId) {
    var node = document.getElementById(blockId);
    if (!node) return [];
    try {
      return JSON.parse(node.textContent || '[]');
    } catch (_) {
      return [];
    }
  }

  var logoItems = loadItemsData('panel2-logo-items-data');
  var carouselItems = loadItemsData('panel2-carousel-items-data');
  var submittedItem = loadItemsData('panel2-submitted-item-data');
  var focalPosition = window.CarouselImagePosition;

  function bindFocalEditors(scope) {
    if (!focalPosition) return;
    (scope || document).querySelectorAll('[data-carousel-focal-editor]').forEach(function (root) {
      if (root.dataset.carouselFocalBound) return;
      root.dataset.carouselFocalBound = '1';

      var form = root.closest('form');
      var frame = root.querySelector('[data-carousel-focal-frame]');
      var image = root.querySelector('[data-carousel-focal-preview]');
      var empty = root.querySelector('[data-carousel-focal-empty]');
      var xInput = root.querySelector('[data-carousel-position-x]');
      var yInput = root.querySelector('[data-carousel-position-y]');
      var xOutput = root.querySelector('[data-carousel-position-x-output]');
      var yOutput = root.querySelector('[data-carousel-position-y-output]');
      var centerButton = root.querySelector('[data-carousel-position-center]');
      if (!form || !frame || !image || !xInput || !yInput) return;

      function sync() {
        var position = focalPosition.normalizePositionPair(xInput.value, yInput.value);
        xInput.value = String(position.x);
        yInput.value = String(position.y);
        xInput.setAttribute('aria-valuenow', String(position.x));
        yInput.setAttribute('aria-valuenow', String(position.y));
        if (xOutput) xOutput.textContent = position.x + '%';
        if (yOutput) yOutput.textContent = position.y + '%';
        focalPosition.applyPreviewPosition(image, position.x, position.y);
      }

      function setPreview(url) {
        var safeUrl = typeof url === 'string' ? url.trim() : '';
        if (safeUrl) {
          image.src = safeUrl;
          image.hidden = false;
          if (empty) empty.hidden = true;
        } else {
          image.removeAttribute('src');
          image.hidden = true;
          if (empty) empty.hidden = false;
        }
        sync();
      }

      xInput.addEventListener('input', sync);
      yInput.addEventListener('input', sync);
      image.addEventListener('dragstart', function (event) { event.preventDefault(); });
      if (centerButton) {
        centerButton.addEventListener('click', function () {
          var centered = focalPosition.resetPosition();
          xInput.value = String(centered.x);
          yInput.value = String(centered.y);
          sync();
          centerButton.focus();
        });
      }

      var drag = null;
      frame.addEventListener('pointerdown', function (event) {
        if (image.hidden || !event.isPrimary || (event.button !== undefined && event.button !== 0)) return;
        event.preventDefault();
        var rect = frame.getBoundingClientRect();
        drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          position: focalPosition.normalizePositionPair(xInput.value, yInput.value),
          width: rect.width,
          height: rect.height,
        };
        if (frame.setPointerCapture) frame.setPointerCapture(event.pointerId);
        frame.classList.add('is-dragging');
      });
      frame.addEventListener('pointermove', function (event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        var position = focalPosition.pointerDeltaToPosition(
          drag.position.x,
          drag.position.y,
          event.clientX - drag.startX,
          event.clientY - drag.startY,
          drag.width,
          drag.height
        );
        xInput.value = String(position.x);
        yInput.value = String(position.y);
        sync();
      });
      function stopDrag(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (frame.hasPointerCapture && frame.hasPointerCapture(drag.pointerId)) {
          frame.releasePointerCapture(drag.pointerId);
        }
        drag = null;
        frame.classList.remove('is-dragging');
      }
      frame.addEventListener('pointerup', stopDrag);
      frame.addEventListener('pointercancel', stopDrag);
      frame.addEventListener('lostpointercapture', function () {
        drag = null;
        frame.classList.remove('is-dragging');
      });

      var fieldName = root.dataset.carouselMediaField;
      var mediaSelector = fieldName
        ? form.querySelector('[data-media-selector][data-field-name="' + fieldName + '"]')
        : null;
      if (mediaSelector) {
        mediaSelector.addEventListener('media-selector:change', function (event) {
          var detail = event.detail || {};
          setPreview(detail.cleared ? '' : detail.previewUrl);
        });
        mediaSelector.addEventListener('media-selector:load', function (event) {
          var detail = event.detail || {};
          setPreview(detail.publicUrl || detail.thumbnailUrl || '');
        });
      }

      root.__syncCarouselFocalEditor = sync;
      sync();
    });
  }

  function findLogoItem(id) {
    for (var i = 0; i < logoItems.length; i++) {
      if (logoItems[i].id === id) return logoItems[i];
    }
    return null;
  }

  function findCarouselItem(id) {
    for (var i = 0; i < carouselItems.length; i++) {
      if (carouselItems[i].id === id) return carouselItems[i];
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
      if (panel) {
        panel.classList.add('is-active');
        panel.hidden = false;
      }
    });
  });

  // ── LogoLoop type switching ──
  var logoType = document.getElementById('logo-type');
  var logoTextGroup = document.getElementById('logo-text-group');
  var logoMediaGroup = document.getElementById('logo-media-group');
  var logoAltGroup = document.getElementById('logo-alt-group');

  function updateLogoFields() {
    if (!logoType || !logoTextGroup || !logoMediaGroup || !logoAltGroup) return;
    var t = logoType.value;
    logoTextGroup.hidden = t !== 'text';
    logoMediaGroup.hidden = t === 'text';
    logoAltGroup.hidden = t === 'text';
  }

  if (logoType) {
    logoType.addEventListener('change', updateLogoFields);
    updateLogoFields();
  }

  // ── LogoLoop edit handler ──
  function editLogoItem(item) {
    if (!item) return;
    var form = document.getElementById('logo-form');
    if (!form) return;
    var el = getEl;
    el('logo-edit-id').value = item.id || '';
    el('logo-type').value = item.item_type || 'text';
    el('logo-text-content').value = item.text_content || '';
    var selector = form.querySelector('[data-media-selector]');
    if (selector) {
      selector.dispatchEvent(new CustomEvent('media-selector:load', {
        bubbles: true,
        detail: {
          value: item.media || '',
          publicId: (item.media || '').replace('media://', ''),
          thumbnailUrl: item.media_thumb || '',
          title: item.media_title || '',
        }
      }));
    }
    el('logo-url').value = item.url || '';
    el('logo-link-type').value = item.link_type || 'internal';
    el('logo-target').value = item.target || '_self';
    el('logo-alt').value = item.alt_text || '';
    el('logo-visible').value = item.is_visible ? '1' : '0';
    el('logo-submit-btn').textContent = 'Guardar cambios';
    el('logo-cancel-btn').hidden = false;
    form.action = '/admin/page/home/panel-2/logo-loop/items/save';
    updateLogoFields();
    var tl = document.querySelector('[data-tab="logoloop"]');
    if (tl) tl.click();
    var summary = document.querySelector('.cms-card summary');
    if (summary) summary.click();
  }

  function resetLogoForm() {
    var form = document.getElementById('logo-form');
    var el = getEl;
    el('logo-edit-id').value = '';
    el('logo-submit-btn').textContent = 'Agregar elemento';
    el('logo-cancel-btn').hidden = true;
    if (form) {
      form.action = '/admin/page/home/panel-2/logo-loop/items';
      form.reset();
    }
    updateLogoFields();
  }

  // ── Carousel edit handler ──
  function editCarouselItem(item) {
    if (!item) return;
    var form = document.getElementById('carousel-form');
    if (!form) return;
    var el = getEl;
    el('carousel-edit-id').value = item.id || '';
    el('carousel-eyebrow').value = item.eyebrow || '';
    el('carousel-title').value = item.title || '';
    el('carousel-desc').value = item.description || '';
    el('carousel-btn-label').value = item.button_label || '';
    el('carousel-btn-url').value = item.button_url || '';
    el('carousel-btn-target').value = item.button_target || '_self';
    el('carousel-media-alt').value = item.media_alt || '';
    el('carousel-preview-alt').value = item.preview_media_alt || '';
    el('carousel-position-x').value = focalPosition ? focalPosition.normalizePosition(item.position_x) : 50;
    el('carousel-position-y').value = focalPosition ? focalPosition.normalizePosition(item.position_y) : 50;
    var selectors = form.querySelectorAll('[data-media-selector]');
    if (selectors.length >= 1) {
      selectors[0].dispatchEvent(new CustomEvent('media-selector:load', {
        bubbles: true,
        detail: {
          value: item.media_public_id || '',
          publicId: (item.media_public_id || '').replace('media://', ''),
          thumbnailUrl: item.media_thumb || '',
          publicUrl: item.media_url || '',
          title: item.media_title || '',
        }
      }));
    }
    if (selectors.length >= 2) {
      selectors[1].dispatchEvent(new CustomEvent('media-selector:load', {
        bubbles: true,
        detail: {
          value: item.preview_media_public_id || '',
          publicId: (item.preview_media_public_id || '').replace('media://', ''),
          thumbnailUrl: item.preview_media_thumb || '',
          title: item.preview_media_title || '',
        }
      }));
    }
    el('carousel-theme').value = item.theme_key || 'graphite';
    el('carousel-visible').value = item.is_visible ? '1' : '0';
    el('carousel-submit-btn').textContent = 'Guardar cambios';
    el('carousel-cancel-btn').hidden = false;
    form.action = '/admin/page/home/panel-2/carousel/items/save';
    var tc = document.querySelector('[data-tab="carousel"]');
    if (tc) tc.click();
    var details = document.getElementById('carousel-edit-details');
    if (details) {
      var sum = details.querySelector('summary');
      if (sum) sum.click();
    }
    var focalEditor = form.querySelector('[data-carousel-focal-editor]');
    if (focalEditor && focalEditor.__syncCarouselFocalEditor) focalEditor.__syncCarouselFocalEditor();
  }

  function resetCarouselForm() {
    var form = document.getElementById('carousel-form');
    var el = getEl;
    el('carousel-edit-id').value = '';
    el('carousel-submit-btn').textContent = 'Agregar proyecto';
    el('carousel-cancel-btn').hidden = true;
    if (form) {
      form.action = '/admin/page/home/panel-2/carousel/items';
      form.reset();
      form.querySelectorAll('[data-media-selector]').forEach(function (selector) {
        selector.dispatchEvent(new CustomEvent('media-selector:load', {
          bubbles: true,
          detail: { value: '', publicId: '', thumbnailUrl: '', publicUrl: '', title: '' }
        }));
      });
    }
  }

  // ── Helper: getElementById with safety ──
  function getEl(id) {
    return document.getElementById(id) || {};
  }

  // ── Delegate edit clicks via data-xxx-edit-id attributes ──
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.logoEditId) {
      var li = findLogoItem(btn.dataset.logoEditId);
      if (li) editLogoItem(li);
      return;
    }

    if (btn.dataset.carouselEditId) {
      var ci = findCarouselItem(btn.dataset.carouselEditId);
      if (ci) editCarouselItem(ci);
      return;
    }

    if (btn.id === 'logo-cancel-btn') {
      resetLogoForm();
      return;
    }

    if (btn.id === 'carousel-cancel-btn') {
      resetCarouselForm();
      return;
    }
  });

  window.NLCarouselFocalEditor = { init: bindFocalEditors };
  bindFocalEditors(document);

  if (submittedItem && submittedItem.kind && submittedItem.values) {
    var values = submittedItem.values;
    if (submittedItem.kind === 'logo') {
      editLogoItem({
        id: values.public_id || '',
        item_type: values.item_type,
        text_content: values.text_content,
        media: values.media_public_id || '',
        url: values.url,
        link_type: values.link_type,
        target: values.target,
        alt_text: values.alt_text,
        is_visible: values.is_visible !== '0',
      });
      if (!values.public_id) document.getElementById('logo-form').action = '/admin/page/home/panel-2/logo-loop/items';
    } else if (submittedItem.kind === 'carousel') {
      editCarouselItem({
        id: values.public_id || '',
        eyebrow: values.eyebrow,
        title: values.title,
        description: values.description,
        button_label: values.button_label,
        button_url: values.button_url,
        button_target: values.button_target,
        media_public_id: values.media_public_id || '',
        preview_media_public_id: values.preview_media_public_id || '',
        media_alt: values.media_alt,
        preview_media_alt: values.preview_media_alt,
        position_x: values.position_x,
        position_y: values.position_y,
        theme_key: values.theme_key,
        is_visible: values.is_visible !== '0',
      });
      if (!values.public_id) document.getElementById('carousel-form').action = '/admin/page/home/panel-2/carousel/items';
    }
  }
})();
