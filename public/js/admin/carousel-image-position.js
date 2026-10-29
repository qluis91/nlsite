(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CarouselImagePosition = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DEFAULT_POSITION = 50;
  var DEFAULT_ZOOM = 100;
  var MIN_ZOOM = 100;
  var MAX_ZOOM = 200;
  var DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

  function normalizePosition(value, fallback) {
    var safeFallback = arguments.length > 1
      ? normalizePosition(fallback)
      : DEFAULT_POSITION;

    if (typeof value !== 'number' && typeof value !== 'string') return safeFallback;
    if (typeof value === 'string') {
      value = value.trim();
      if (!value || !DECIMAL_NUMBER.test(value)) return safeFallback;
    }

    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return safeFallback;
    return Math.min(100, Math.max(0, Math.round(numeric)));
  }

  function normalizeZoom(value, fallback) {
    var safeFallback = arguments.length > 1
      ? normalizeZoom(fallback)
      : DEFAULT_ZOOM;

    if (typeof value !== 'number' && typeof value !== 'string') return safeFallback;
    if (typeof value === 'string') {
      value = value.trim();
      if (!value || !DECIMAL_NUMBER.test(value)) return safeFallback;
    }

    var numeric = Number(value);
    if (!Number.isFinite(numeric)) return safeFallback;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(numeric)));
  }

  function normalizePositionPair(positionX, positionY) {
    return {
      x: normalizePosition(positionX),
      y: normalizePosition(positionY),
    };
  }

  function normalizeFraming(positionX, positionY, zoomPercent) {
    var position = normalizePositionPair(positionX, positionY);
    return {
      x: position.x,
      y: position.y,
      zoom: normalizeZoom(zoomPercent),
    };
  }

  function pointerDeltaToPosition(startX, startY, deltaX, deltaY, width, height) {
    var safeWidth = Number(width);
    var safeHeight = Number(height);
    var x = normalizePosition(startX);
    var y = normalizePosition(startY);

    if (!Number.isFinite(safeWidth) || safeWidth <= 0) safeWidth = 1;
    if (!Number.isFinite(safeHeight) || safeHeight <= 0) safeHeight = 1;

    return normalizePositionPair(
      x - (Number(deltaX) || 0) / safeWidth * 100,
      y - (Number(deltaY) || 0) / safeHeight * 100
    );
  }

  function applyPreviewPosition(image, positionX, positionY) {
    var framing = normalizeFraming(positionX, positionY, DEFAULT_ZOOM);
    if (image && image.style) {
      image.style.objectPosition = framing.x + '% ' + framing.y + '%';
    }
    return { x: framing.x, y: framing.y };
  }

  function applyPreviewFraming(image, positionX, positionY, zoomPercent) {
    var framing = normalizeFraming(positionX, positionY, zoomPercent);
    if (image && image.style) {
      image.style.objectPosition = framing.x + '% ' + framing.y + '%';
      image.style.transformOrigin = framing.x + '% ' + framing.y + '%';
      image.style.transform = 'scale(' + framing.zoom / 100 + ')';
    }
    return framing;
  }

  function resetPosition() {
    return { x: DEFAULT_POSITION, y: DEFAULT_POSITION };
  }

  function resetFraming() {
    return {
      x: DEFAULT_POSITION,
      y: DEFAULT_POSITION,
      zoom: DEFAULT_ZOOM,
    };
  }

  return Object.freeze({
    DEFAULT_POSITION: DEFAULT_POSITION,
    DEFAULT_ZOOM: DEFAULT_ZOOM,
    MIN_ZOOM: MIN_ZOOM,
    MAX_ZOOM: MAX_ZOOM,
    normalizePosition: normalizePosition,
    normalizeZoom: normalizeZoom,
    normalizePositionPair: normalizePositionPair,
    normalizeFraming: normalizeFraming,
    pointerDeltaToPosition: pointerDeltaToPosition,
    applyPreviewPosition: applyPreviewPosition,
    applyPreviewFraming: applyPreviewFraming,
    resetPosition: resetPosition,
    resetFraming: resetFraming,
  });
});
