/**
 * Gallery IMAGE thumbnail framing editor — reuses CarouselImagePosition helpers.
 */
(function () {
  'use strict';

  if (window.GalleryThumbnailFraming?.version) return;

  var helpers = window.CarouselImagePosition;
  var objectUrl = null;

  function qs(root, selector) {
    return root.querySelector(selector);
  }

  function syncVisibility() {
    var root = document.querySelector('[data-gallery-thumb-framing]');
    var typeSelect = document.getElementById('gallery-media-type');
    if (!root || !typeSelect) return;
    var isImage = typeSelect.value === 'image';
    root.hidden = !isImage;
  }

  function applyPreview(root) {
    if (!helpers) return;
    var image = qs(root, '[data-gallery-framing-image]');
    var xInput = qs(root, '[data-gallery-framing-x]');
    var yInput = qs(root, '[data-gallery-framing-y]');
    var zoomInput = qs(root, '[data-gallery-framing-zoom]');
    var xOut = qs(root, '[data-gallery-framing-x-output]');
    var yOut = qs(root, '[data-gallery-framing-y-output]');
    var zoomOut = qs(root, '[data-gallery-framing-zoom-output]');
    if (!image || !xInput || !yInput || !zoomInput) return;

    var framing = helpers.normalizeFraming(xInput.value, yInput.value, zoomInput.value);
    xInput.value = String(framing.x);
    yInput.value = String(framing.y);
    zoomInput.value = String(framing.zoom);
    if (xOut) xOut.textContent = String(framing.x);
    if (yOut) yOut.textContent = String(framing.y);
    if (zoomOut) zoomOut.textContent = String(framing.zoom);
    helpers.applyPreviewFraming(image, framing.x, framing.y, framing.zoom);
  }

  function setPreviewSource(root, source, { revoke = true } = {}) {
    var image = qs(root, '[data-gallery-framing-image]');
    if (!image) return;
    if (revoke && objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    if (!source) {
      image.removeAttribute('src');
      image.hidden = true;
      return;
    }
    image.src = source;
    image.hidden = false;
    applyPreview(root);
  }

  function bind() {
    var root = document.querySelector('[data-gallery-thumb-framing]');
    if (!root || !helpers) return;

    var mediaInput = document.getElementById('gallery-media');
    var resetBtn = qs(root, '[data-gallery-framing-reset]');
    var xInput = qs(root, '[data-gallery-framing-x]');
    var yInput = qs(root, '[data-gallery-framing-y]');
    var zoomInput = qs(root, '[data-gallery-framing-zoom]');

    function onChange() {
      applyPreview(root);
    }

    [xInput, yInput, zoomInput].forEach(function (input) {
      if (!input) return;
      input.addEventListener('input', onChange);
      input.addEventListener('change', onChange);
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        var framing = helpers.resetFraming();
        if (xInput) xInput.value = String(framing.x);
        if (yInput) yInput.value = String(framing.y);
        if (zoomInput) zoomInput.value = String(framing.zoom);
        applyPreview(root);
      });
    }

    if (mediaInput) {
      mediaInput.addEventListener('change', function () {
        var typeSelect = document.getElementById('gallery-media-type');
        if (!typeSelect || typeSelect.value !== 'image') return;
        var file = mediaInput.files && mediaInput.files[0];
        if (!file || !String(file.type || '').startsWith('image/')) {
          var initial = root.getAttribute('data-media-source') || '';
          setPreviewSource(root, initial);
          return;
        }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(file);
        setPreviewSource(root, objectUrl, { revoke: false });
      });
    }

    var initial = root.getAttribute('data-media-source') || '';
    if (initial) setPreviewSource(root, initial);
    else applyPreview(root);
    syncVisibility();
  }

  function init() {
    bind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.GalleryThumbnailFraming = {
    version: 1,
    syncVisibility: syncVisibility,
  };
})();
