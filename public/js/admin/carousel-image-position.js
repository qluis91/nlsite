(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CarouselImagePosition = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DEFAULT_POSITION = 50;
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

  function normalizePositionPair(positionX, positionY) {
    return {
      x: normalizePosition(positionX),
      y: normalizePosition(positionY),
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
    var position = normalizePositionPair(positionX, positionY);
    if (image && image.style) {
      image.style.objectPosition = position.x + '% ' + position.y + '%';
    }
    return position;
  }

  function resetPosition() {
    return { x: DEFAULT_POSITION, y: DEFAULT_POSITION };
  }

  return Object.freeze({
    DEFAULT_POSITION: DEFAULT_POSITION,
    normalizePosition: normalizePosition,
    normalizePositionPair: normalizePositionPair,
    pointerDeltaToPosition: pointerDeltaToPosition,
    applyPreviewPosition: applyPreviewPosition,
    resetPosition: resetPosition,
  });
});
