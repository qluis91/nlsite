/**
 * Shared accessible drawer controller for repeatable CMS item editors.
 * Form population remains owned by the existing panel-specific scripts.
 */
(function () {
  'use strict';

  if (window.AdminItemEditorDrawer?.version) return;

  var drawers = new Map();
  var triggerHandlers = new Map();
  var activeDrawer = null;
  var activeForm = null;
  var activeOpener = null;
  var baseline = '';
  var submitting = false;

  function focusableElements(root) {
    return Array.from(root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (element) {
      return !element.hidden && !element.closest('[hidden]');
    });
  }

  function serializeForm(form) {
    if (!form) return '';
    return Array.from(form.elements || []).reduce(function (values, field) {
      if (!field.name || field.disabled || field.name === '_csrf' || field.type === 'submit' || field.type === 'button') {
        return values;
      }
      if ((field.type === 'checkbox' || field.type === 'radio') && !field.checked) return values;
      values.push([field.name, field.type === 'file' ? (field.files?.[0]?.name || '') : String(field.value || '')]);
      return values;
    }, []).sort(function (a, b) {
      return (a[0] + '\u0000' + a[1]).localeCompare(b[0] + '\u0000' + b[1]);
    }).map(function (entry) {
      return entry[0] + '=' + entry[1];
    }).join('&');
  }

  function isDirty() {
    return Boolean(activeForm) && serializeForm(activeForm) !== baseline;
  }

  function setDocumentLocked(locked) {
    document.body.classList.toggle('item-editor-drawer-open', locked);
  }

  function closeImmediately(options) {
    options = options || {};
    if (!activeDrawer) return;
    var drawer = activeDrawer;
    var opener = activeOpener;
    activeDrawer = null;
    activeForm = null;
    activeOpener = null;
    baseline = '';
    submitting = false;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.inert = true;
    setDocumentLocked(false);
    window.setTimeout(function () {
      drawer.hidden = true;
      if (options.restoreFocus !== false && opener?.focus) opener.focus();
    }, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  }

  function confirmDiscard(onConfirm) {
    var options = {
      title: 'Descartar cambios',
      message: 'Hay cambios sin guardar. ¿Deseas descartarlos?',
      confirmLabel: 'Descartar cambios',
      confirmClass: 'btn-danger',
      onConfirm: onConfirm,
    };
    if (window.NinjaConfirm?.show) {
      window.NinjaConfirm.show(options);
      return;
    }
    if (window.confirm(options.message)) onConfirm();
  }

  function requestClose(options) {
    options = options || {};
    if (!activeDrawer) return;
    if (!submitting && isDirty() && !options.force) {
      confirmDiscard(function () { closeImmediately(); });
      return;
    }
    closeImmediately();
  }

  function openNow(kind, options) {
    options = options || {};
    var drawer = drawers.get(kind);
    if (!drawer) return false;

    if (activeDrawer && activeDrawer !== drawer) closeImmediately({ restoreFocus: false });
    if (typeof options.prepare === 'function') options.prepare();

    activeDrawer = drawer;
    activeForm = drawer.querySelector('[data-item-editor-form]');
    activeOpener = options.trigger || document.activeElement;
    submitting = false;

    var mode = options.mode || (activeForm?.querySelector('[name="public_id"]')?.value ? 'edit' : 'create');
    var title = mode === 'edit' ? drawer.dataset.editTitle : drawer.dataset.createTitle;
    var titleNode = drawer.querySelector('[data-item-editor-title]');
    var modeNode = drawer.querySelector('[data-item-editor-mode-label]');
    if (titleNode) titleNode.textContent = title;
    if (modeNode) modeNode.textContent = mode === 'edit' ? 'Editar elemento' : 'Nuevo elemento';

    drawer.hidden = false;
    drawer.inert = false;
    drawer.removeAttribute('aria-hidden');
    setDocumentLocked(true);
    baseline = serializeForm(activeForm);
    window.requestAnimationFrame(function () {
      drawer.classList.add('is-open');
      var initial = drawer.querySelector('[data-item-editor-autofocus]') || focusableElements(drawer.querySelector('.item-editor-drawer__panel'))[0];
      initial?.focus();
    });
    return true;
  }

  function requestOpen(kind, options) {
    options = options || {};
    var proceed = function () { openNow(kind, options); };
    if (activeDrawer && !submitting && isDirty()) {
      confirmDiscard(proceed);
      return false;
    }
    return openNow(kind, options);
  }

  function register(kind, handlers) {
    if (!drawers.has(kind) || !handlers) return false;
    triggerHandlers.set(kind, handlers);
    return true;
  }

  function handleOpenTrigger(event) {
    var trigger = event.target.closest?.('[data-item-editor-open]');
    if (!trigger) return;

    var kind = trigger.dataset.editorType;
    var mode = trigger.dataset.mode === 'edit' ? 'edit' : 'create';
    var handlers = triggerHandlers.get(kind);
    var prepare = handlers && handlers[mode];
    if (typeof prepare !== 'function') return;

    event.preventDefault();
    requestOpen(kind, {
      trigger: trigger,
      mode: mode,
      prepare: function () { prepare(trigger.dataset.itemId || '', trigger); },
    });
  }

  function trapFocus(event) {
    if (!activeDrawer || event.key !== 'Tab') return;
    if (event.target.closest?.('dialog[open]')) return;
    var panel = activeDrawer.querySelector('.item-editor-drawer__panel');
    var focusable = focusableElements(panel);
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function init() {
    document.querySelectorAll('[data-item-editor-drawer]').forEach(function (drawer) {
      var kind = drawer.dataset.itemEditorDrawer;
      if (!kind || drawers.has(kind)) return;
      drawer.inert = true;
      drawers.set(kind, drawer);
      drawer.addEventListener('click', function (event) {
        if (event.target.closest('[data-item-editor-close]')) requestClose();
      });
      drawer.querySelector('[data-item-editor-form]')?.addEventListener('submit', function () {
        submitting = true;
      });
    });

    document.addEventListener('click', handleOpenTrigger);

    document.addEventListener('keydown', function (event) {
      if (!activeDrawer) return;
      if (event.key === 'Escape') {
        if (event.target.closest?.('dialog[open]') || document.querySelector('dialog[open]')) return;
        event.preventDefault();
        requestClose();
        return;
      }
      trapFocus(event);
    });

    window.addEventListener('beforeunload', function (event) {
      if (!activeDrawer || submitting || !isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  // Page scripts are emitted after the admin body, so drawer markup is already
  // available even while readyState is still "loading".
  init();

  window.AdminItemEditorDrawer = {
    version: 1,
    requestOpen: requestOpen,
    requestClose: requestClose,
    register: register,
    isDirty: isDirty,
    serializeForm: serializeForm,
  };
})();
