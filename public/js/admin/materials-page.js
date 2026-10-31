(function () {
  'use strict';

  function nextIndex(list) {
    var max = -1;
    list.querySelectorAll('[data-materials-item]').forEach(function (el) {
      var idx = Number(el.getAttribute('data-index'));
      if (Number.isFinite(idx) && idx > max) max = idx;
    });
    return max + 1;
  }

  function nextOrder(list) {
    var max = 0;
    list.querySelectorAll('[name$="_order"]').forEach(function (input) {
      var n = Number(input.value);
      if (Number.isFinite(n) && n > max) max = n;
    });
    return max + 10;
  }

  function bindRemove(item) {
    var btn = item.querySelector('[data-materials-remove]');
    if (!btn || btn._materialsBound) return;
    btn._materialsBound = true;
    btn.addEventListener('click', function () {
      if (!window.confirm('¿Eliminar este material del borrador?')) return;
      item.remove();
      var form = document.getElementById('materials-page-form');
      if (form) form.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function init() {
    var list = document.querySelector('[data-materials-list]');
    var addBtn = document.getElementById('materials-add-item');
    var template = document.getElementById('materials-item-template');
    if (!list || !addBtn || !template) return;

    list.querySelectorAll('[data-materials-item]').forEach(bindRemove);

    addBtn.addEventListener('click', function () {
      var index = nextIndex(list);
      var order = nextOrder(list);
      var html = template.innerHTML
        .replace(/__INDEX__/g, String(index))
        .replace(/__NUMBER__/g, String(list.querySelectorAll('[data-materials-item]').length + 1))
        .replace(/__ORDER__/g, String(order));
      var wrap = document.createElement('div');
      wrap.innerHTML = html.trim();
      var item = wrap.firstElementChild;
      if (!item) return;
      list.appendChild(item);
      bindRemove(item);
      var form = document.getElementById('materials-page-form');
      if (form) form.dispatchEvent(new Event('input', { bubbles: true }));
      var title = item.querySelector('[name$="_title"]');
      if (title) title.focus();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
