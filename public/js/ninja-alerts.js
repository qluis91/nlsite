(function ninjaAlertsBootstrap(window, document) {
  'use strict';

  if (window.NinjaAlerts && window.NinjaAlerts.__initialized) return;

  var MAX_VISIBLE = 5;
  var DEFAULT_DURATIONS = {
    info: 5000,
    success: 5000,
    warning: 8000,
    error: 10000,
  };
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICON_PATHS = {
    info: 'M12 16v-4m0-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    success: 'm8.5 12.5 2.25 2.25L15.75 9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    warning: 'M12 9v4m0 4h.01M10.3 4.2 2.7-1.55a2 2 0 0 1 2.73.73l5.15 8.92A2 2 0 0 1 18.85 19H5.15a2 2 0 0 1-1.73-3l5.15-8.92a2 2 0 0 1 .73-.73Z',
    error: 'm9 9 6 6m0-6-6 6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  };

  var records = new Map();
  var queue = [];
  var sequence = 0;
  var container = null;

  function reducedMotion() {
    return Boolean(
      window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function normalizeType(type) {
    return Object.prototype.hasOwnProperty.call(DEFAULT_DURATIONS, type) ? type : 'info';
  }

  function ensureContainer() {
    if (container && container.isConnected !== false) return container;
    container = document.querySelector('[data-ninja-alerts]');
    if (!container) {
      container = document.createElement('section');
      container.className = 'ninja-alerts';
      container.setAttribute('data-ninja-alerts', '');
      container.setAttribute('aria-label', 'Notificaciones');
      container.setAttribute('aria-relevant', 'additions removals');
      document.body.appendChild(container);
    }
    return container;
  }

  function makeSvg(pathData) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    var path = document.createElementNS(SVG_NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  function appendTextElement(parent, tag, className, text) {
    var element = document.createElement(tag);
    element.className = className;
    element.textContent = String(text);
    parent.appendChild(element);
    return element;
  }

  function createNode(record) {
    var urgent = record.type === 'warning' || record.type === 'error';
    var node = document.createElement('article');
    node.className = 'ninja-alert ninja-alert--' + record.type;
    node.setAttribute('data-ninja-alert', '');
    node.setAttribute('data-alert-id', record.id);
    node.setAttribute('data-alert-type', record.type);
    node.setAttribute('role', urgent ? 'alert' : 'status');
    node.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
    node.setAttribute('aria-atomic', 'true');

    var accent = document.createElement('span');
    accent.className = 'ninja-alert__accent';
    accent.setAttribute('aria-hidden', 'true');
    node.appendChild(accent);

    var icon = document.createElement('span');
    icon.className = 'ninja-alert__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.appendChild(makeSvg(ICON_PATHS[record.type]));
    node.appendChild(icon);

    var content = document.createElement('span');
    content.className = 'ninja-alert__content';
    appendTextElement(content, 'strong', 'ninja-alert__title', record.title);
    if (record.description) {
      appendTextElement(content, 'span', 'ninja-alert__description', record.description);
    }
    if (record.actionLabel && typeof record.actionCallback === 'function') {
      var actions = document.createElement('span');
      actions.className = 'ninja-alert__actions';
      var action = appendTextElement(actions, 'button', 'ninja-alert__action', record.actionLabel);
      action.type = 'button';
      action.addEventListener('click', function onAction(event) {
        record.actionCallback(event, record.id);
      });
      content.appendChild(actions);
    }
    node.appendChild(content);

    var close = document.createElement('button');
    close.className = 'ninja-alert__close';
    close.type = 'button';
    close.setAttribute('data-alert-close', '');
    close.setAttribute('aria-label', 'Cerrar alerta: ' + record.title);
    close.appendChild(makeSvg('m7 7 10 10M17 7 7 17'));
    node.appendChild(close);
    return node;
  }

  function visibleRecords() {
    return Array.from(records.values()).filter(function isVisible(record) {
      return record.visible && record.node && record.node.parentNode;
    });
  }

  function measurePositions() {
    var positions = new Map();
    visibleRecords().forEach(function remember(record) {
      if (typeof record.node.getBoundingClientRect === 'function') {
        positions.set(record.id, record.node.getBoundingClientRect().top);
      }
    });
    return positions;
  }

  function animateReflow(previous) {
    if (reducedMotion()) return;
    visibleRecords().forEach(function animate(record) {
      if (!previous.has(record.id) || typeof record.node.getBoundingClientRect !== 'function') return;
      var delta = previous.get(record.id) - record.node.getBoundingClientRect().top;
      if (!delta) return;
      if (window.gsap) {
        window.gsap.fromTo(record.node, { y: delta }, { y: 0, duration: 0.22, ease: 'power2.out' });
      } else if (typeof record.node.animate === 'function') {
        record.node.animate(
          [{ transform: 'translateY(' + delta + 'px)' }, { transform: 'translateY(0)' }],
          { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
      }
    });
  }

  function animateEntry(node) {
    if (reducedMotion()) return;
    if (window.gsap) {
      window.gsap.fromTo(
        node,
        { autoAlpha: 0, x: 20, y: -4, scale: 0.97 },
        { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0.24, ease: 'power2.out', clearProps: 'transform' }
      );
      return;
    }
    if (typeof node.animate === 'function') {
      node.animate(
        [
          { opacity: 0, transform: 'translate3d(20px,-4px,0) scale(.97)' },
          { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' },
        ],
        { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
      return;
    }
    node.classList.add('is-entering');
    window.requestAnimationFrame(function beginCssEntry() {
      node.classList.remove('is-entering');
    });
  }

  function animateExit(node, done) {
    if (reducedMotion()) {
      done();
      return;
    }
    if (window.gsap) {
      window.gsap.to(node, {
        autoAlpha: 0,
        x: 20,
        y: -4,
        scale: 0.97,
        duration: 0.18,
        ease: 'power1.in',
        onComplete: done,
      });
      return;
    }
    if (typeof node.animate === 'function') {
      var animation = node.animate(
        [
          { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' },
          { opacity: 0, transform: 'translate3d(20px,-4px,0) scale(.97)' },
        ],
        { duration: 180, easing: 'ease-in', fill: 'forwards' }
      );
      animation.finished.then(done, done);
      return;
    }
    node.classList.add('is-leaving');
    var finished = false;
    var finish = function finishCssExit() {
      if (finished) return;
      finished = true;
      node.removeEventListener('transitionend', finish);
      done();
    };
    node.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, 240);
  }

  function clearTimer(record) {
    if (record.timer) {
      window.clearTimeout(record.timer);
      record.timer = null;
    }
  }

  function pauseTimer(record) {
    if (record.persistent || record.paused || !record.timer) return;
    clearTimer(record);
    record.remaining = Math.max(0, record.remaining - (Date.now() - record.startedAt));
    record.paused = true;
  }

  function resumeTimer(record) {
    if (record.persistent || !record.paused || !record.visible) return;
    record.paused = false;
    startTimer(record);
  }

  function startTimer(record) {
    clearTimer(record);
    if (record.persistent || !record.visible || record.remaining <= 0) return;
    record.startedAt = Date.now();
    record.timer = window.setTimeout(function autoDismiss() {
      record.timer = null;
      dismiss(record.id);
    }, record.remaining);
  }

  function bindNode(record) {
    var node = record.node;
    var close = node.querySelector('[data-alert-close]');
    if (close) close.addEventListener('click', function closeAlert() { dismiss(record.id); });
    node.addEventListener('mouseenter', function pauseOnHover() { pauseTimer(record); });
    node.addEventListener('mouseleave', function resumeAfterHover() { resumeTimer(record); });
    node.addEventListener('focusin', function pauseOnFocus() { pauseTimer(record); });
    node.addEventListener('focusout', function resumeAfterFocus(event) {
      if (!event.relatedTarget || !node.contains(event.relatedTarget)) resumeTimer(record);
    });
  }

  function showRecord(record, animate) {
    var host = ensureContainer();
    if (!record.node) record.node = createNode(record);
    if (!record.node.parentNode) host.appendChild(record.node);
    record.visible = true;
    bindNode(record);
    if (animate) animateEntry(record.node);
    startTimer(record);
  }

  function showNext() {
    while (queue.length && visibleRecords().length < MAX_VISIBLE) {
      var nextId = queue.shift();
      var record = records.get(nextId);
      if (record) showRecord(record, true);
    }
  }

  function dismiss(id) {
    var key = String(id || '');
    var record = records.get(key);
    if (!record || record.dismissing) return false;
    record.dismissing = true;
    clearTimer(record);

    if (!record.visible || !record.node || !record.node.parentNode) {
      queue = queue.filter(function keep(otherId) { return otherId !== key; });
      records.delete(key);
      return true;
    }

    var previous = measurePositions();
    animateExit(record.node, function removeAlert() {
      if (record.node.parentNode) record.node.parentNode.removeChild(record.node);
      records.delete(key);
      record.visible = false;
      showNext();
      animateReflow(previous);
    });
    return true;
  }

  function add(type, title, description, options) {
    var normalizedType = normalizeType(type);
    var normalizedDescription = description;
    var normalizedOptions = options;
    if (description && typeof description === 'object') {
      normalizedOptions = description;
      normalizedDescription = '';
    }
    normalizedOptions = normalizedOptions || {};
    var id = normalizedOptions.id ? String(normalizedOptions.id) : 'ninja-alert-' + (++sequence);
    if (records.has(id)) return id;

    var persistent = Boolean(normalizedOptions.persistent);
    var requestedDuration = Number(normalizedOptions.duration);
    var duration = Number.isFinite(requestedDuration) && requestedDuration >= 0
      ? requestedDuration
      : DEFAULT_DURATIONS[normalizedType];
    if (duration === 0) persistent = true;

    var record = {
      id: id,
      type: normalizedType,
      title: String(title || ''),
      description: normalizedDescription ? String(normalizedDescription) : '',
      persistent: persistent,
      duration: duration,
      remaining: duration,
      startedAt: 0,
      timer: null,
      paused: false,
      visible: false,
      dismissing: false,
      actionLabel: normalizedOptions.actionLabel ? String(normalizedOptions.actionLabel) : '',
      actionCallback: normalizedOptions.actionCallback,
      node: null,
    };
    records.set(id, record);
    if (visibleRecords().length >= MAX_VISIBLE) {
      queue.push(id);
    } else {
      showRecord(record, true);
    }
    return id;
  }

  function clear() {
    queue.slice().forEach(dismiss);
    visibleRecords().forEach(function dismissVisible(record) { dismiss(record.id); });
  }

  function hydrate() {
    var host = ensureContainer();
    var nodes = Array.prototype.slice.call(host.querySelectorAll('[data-ninja-alert]'));
    nodes.forEach(function hydrateNode(node, index) {
      var type = normalizeType(node.getAttribute('data-alert-type'));
      var id = node.getAttribute('data-alert-id') || 'server-alert-' + (++sequence);
      if (records.has(id)) {
        if (node.parentNode) node.parentNode.removeChild(node);
        return;
      }
      var durationValue = Number(node.getAttribute('data-alert-duration'));
      var duration = Number.isFinite(durationValue) && durationValue > 0
        ? durationValue
        : DEFAULT_DURATIONS[type];
      var persistent = node.getAttribute('data-alert-persistent') === 'true';
      var titleNode = node.querySelector('.ninja-alert__title');
      var descriptionNode = node.querySelector('.ninja-alert__description');
      var record = {
        id: id,
        type: type,
        title: titleNode ? titleNode.textContent : '',
        description: descriptionNode ? descriptionNode.textContent : '',
        persistent: persistent,
        duration: duration,
        remaining: duration,
        startedAt: 0,
        timer: null,
        paused: false,
        visible: index < MAX_VISIBLE,
        dismissing: false,
        node: node,
      };
      records.set(id, record);
      if (record.visible) {
        bindNode(record);
        animateEntry(node);
        startTimer(record);
      } else {
        if (node.parentNode) node.parentNode.removeChild(node);
        queue.push(id);
      }
    });
  }

  var api = {
    __initialized: true,
    info: function info(title, description, options) { return add('info', title, description, options); },
    success: function success(title, description, options) { return add('success', title, description, options); },
    warning: function warning(title, description, options) { return add('warning', title, description, options); },
    error: function error(title, description, options) { return add('error', title, description, options); },
    dismiss: dismiss,
    clear: clear,
  };
  window.NinjaAlerts = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrate, { once: true });
  } else {
    hydrate();
  }
}(window, document));
