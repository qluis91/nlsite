(function () {
  'use strict';

  if (window.__ninjaCmsEditorStateInitialized) return;
  window.__ninjaCmsEditorStateInitialized = true;

  var STATE_LABELS = {
    clean: 'Sin cambios',
    dirty: 'Cambios sin guardar',
    saving: 'Guardando',
    saved: 'Borrador guardado',
    published: 'Publicado',
    error: 'Error',
  };

  function formSignature(form) {
    var parts = [];
    new FormData(form).forEach(function (value, key) {
      if (key === '_csrf') return;
      parts.push(key + '=' + (value instanceof File ? value.name + ':' + value.size : String(value)));
    });
    return parts.sort().join('&');
  }

  function initEditor(root) {
    if (root.dataset.cmsEditorReady === 'true') return;
    root.dataset.cmsEditorReady = 'true';

    var statusNode = root.querySelector('[data-cms-editor-status]');
    var saveForms = Array.prototype.slice.call(root.querySelectorAll('[data-cms-editor-form]'));
    var publishForms = Array.prototype.slice.call(root.querySelectorAll('[data-cms-publish-form]'));
    var initialState = root.dataset.editorState || 'clean';
    var baselines = new Map();
    var dirtyForms = new Set();
    var processing = false;

    function setState(state) {
      root.dataset.editorState = state;
      if (statusNode) {
        statusNode.textContent = STATE_LABELS[state] || STATE_LABELS.clean;
        statusNode.dataset.state = state;
      }
    }

    function refreshDirty(form) {
      if (formSignature(form) === baselines.get(form)) dirtyForms.delete(form);
      else dirtyForms.add(form);
      setState(dirtyForms.size ? 'dirty' : 'clean');
    }

    function warnUnsaved() {
      if (window.NinjaAlerts && typeof window.NinjaAlerts.warning === 'function') {
        window.NinjaAlerts.warning(
          'Cambios sin guardar',
          'Guarda los cambios antes de publicar para evitar perderlos.',
          { id: 'cms-unsaved-publish', persistent: true }
        );
      }
      setState('dirty');
    }

    saveForms.forEach(function (form) {
      baselines.set(form, formSignature(form));
      if (initialState === 'error') dirtyForms.add(form);

      form.addEventListener('input', function () { refreshDirty(form); });
      form.addEventListener('change', function () { refreshDirty(form); });
      form.addEventListener('submit', function (event) {
        if (processing) {
          event.preventDefault();
          return;
        }
        processing = true;
        setState('saving');
        Array.prototype.forEach.call(form.querySelectorAll('button[type="submit"], input[type="submit"]'), function (control) {
          control.disabled = true;
          control.setAttribute('aria-disabled', 'true');
        });
      });
    });

    publishForms.forEach(function (form) {
      form.addEventListener('submit', function (event) {
        if (processing) {
          event.preventDefault();
          return;
        }
        if (dirtyForms.size) {
          event.preventDefault();
          warnUnsaved();
          return;
        }
        processing = true;
        Array.prototype.forEach.call(form.querySelectorAll('button[type="submit"], input[type="submit"]'), function (control) {
          control.disabled = true;
          control.setAttribute('aria-disabled', 'true');
        });
      });
    });

    window.addEventListener('beforeunload', function (event) {
      if (!dirtyForms.size || processing) return;
      event.preventDefault();
      event.returnValue = '';
    });

    setState(initialState);
  }

  function init() {
    document.querySelectorAll('[data-cms-editor]').forEach(initEditor);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
