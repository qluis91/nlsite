/**
 * NinjaLab Store — Phase 1.5
 * Sort auto-submit (CSP-safe). No inline handlers.
 */
const storeInstances = new WeakMap();

export function initStore(root = document) {
  if (!root) return () => {};
  if (storeInstances.has(root)) return storeInstances.get(root);

  const sort = root.querySelector('[data-store-sort]');
  const sortForm = root.querySelector('[data-store-sort-form]');
  const removers = [];
  let destroyed = false;

  const listen = (target, event, handler, options) => {
    if (!target) return;
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  listen(sort, 'change', () => {
    if (sortForm) sortForm.requestSubmit();
  });

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    removers.splice(0).forEach((remove) => remove());
    if (storeInstances.get(root) === cleanup) storeInstances.delete(root);
  }

  storeInstances.set(root, cleanup);
  return cleanup;
}

const destroyStore = initStore(document);
window.addEventListener('pagehide', destroyStore, { once: true });
