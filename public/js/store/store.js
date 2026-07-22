import { initNavbar } from '../home/navbar.js';

const storeInstances = new WeakMap();

export function initStore(root) {
  if (!root) return () => {};
  if (storeInstances.has(root)) return storeInstances.get(root);

  const toggle = root.querySelector('[data-store-filter-toggle]');
  const filters = root.querySelector('[data-store-filters]');
  const closeButton = root.querySelector('[data-store-filter-close]');
  const backdrop = root.querySelector('[data-store-filter-backdrop]');
  const sort = root.querySelector('[data-store-sort]');
  const sortForm = root.querySelector('[data-store-sort-form]');
  const navbarToggle = document.querySelector('[data-nav-toggle]');
  const removers = [];
  let isOpen = false;
  let destroyed = false;

  const listen = (target, event, handler, options) => {
    if (!target) return;
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  function setOpen(nextOpen, returnFocus = false) {
    if (!toggle || !filters || !backdrop) return;
    isOpen = nextOpen;
    root.classList.toggle('is-filter-open', nextOpen);
    document.body.classList.toggle('is-store-filter-open', nextOpen);
    toggle.setAttribute('aria-expanded', String(nextOpen));
    backdrop.hidden = !nextOpen;
    filters.toggleAttribute('inert', !nextOpen && window.matchMedia('(max-width: 1040px)').matches);
    if (nextOpen) closeButton?.focus();
    else if (returnFocus) toggle.focus();
  }

  function onViewportChange(event) {
    if (!event.matches) {
      setOpen(false);
      filters?.removeAttribute('inert');
    } else if (!isOpen) {
      filters?.setAttribute('inert', '');
    }
  }

  const mobile = window.matchMedia('(max-width: 1040px)');
  root.classList.add('is-enhanced');
  if (mobile.matches) filters?.setAttribute('inert', '');

  listen(toggle, 'click', () => setOpen(!isOpen, isOpen));
  listen(closeButton, 'click', () => setOpen(false, true));
  listen(backdrop, 'click', () => setOpen(false, true));
  listen(navbarToggle, 'click', () => {
    if (isOpen) setOpen(false);
  });
  listen(document, 'keydown', (event) => {
    if (event.key === 'Escape' && isOpen) setOpen(false, true);
  });
  listen(mobile, 'change', onViewportChange);
  listen(sort, 'change', () => sortForm?.requestSubmit());

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    removers.splice(0).forEach((remove) => remove());
    setOpen(false);
    filters?.removeAttribute('inert');
    root.classList.remove('is-enhanced', 'is-filter-open');
    document.body.classList.remove('is-store-filter-open');
    if (storeInstances.get(root) === cleanup) storeInstances.delete(root);
  }

  storeInstances.set(root, cleanup);
  return cleanup;
}

initNavbar();
const storeRoot = document.querySelector('[data-store-page]');
const destroyStore = initStore(storeRoot);
window.addEventListener('pagehide', destroyStore, { once: true });
