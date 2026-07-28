/**
 * NinjaLab Store — Phase 1.5 + Mobile Drawer
 * Sort auto-submit (CSP-safe). Mobile navigation drawer.
 */
const storeInstances = new WeakMap();

function _focusableSelector() {
  return 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
}

function _getFocusableElements(container) {
  return Array.from(container.querySelectorAll(_focusableSelector()));
}

function _trapFocus(container, event) {
  if (event.key !== 'Tab') return;
  const focusable = _getFocusableElements(container);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey) {
    if (document.activeElement === first) { last.focus(); event.preventDefault(); }
  } else {
    if (document.activeElement === last) { first.focus(); event.preventDefault(); }
  }
}

function _lockBodyScroll() {
  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  document.body.style.overflowY = 'scroll';
}

function _unlockBodyScroll() {
  const scrollY = parseInt(document.body.style.top || '0', 10) * -1;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  document.body.style.overflowY = '';
  window.scrollTo(0, scrollY);
}

export function initStore(root = document) {
  if (!root) return () => {};
  if (storeInstances.has(root)) return storeInstances.get(root);

  const sort = root.querySelector('[data-store-sort]');
  const sortForm = root.querySelector('[data-store-sort-form]');

  // ── Mobile drawer ──
  const toggle = root.querySelector('#store-menu-toggle');
  const drawer = root.querySelector('#store-mobile-drawer');
  const backdrop = root.querySelector('#store-mobile-backdrop');
  const closeBtn = drawer ? drawer.querySelector('#store-mobile-drawer-close') : null;

  const removers = [];
  let destroyed = false;
  let drawerOpen = false;
  let savedTrigger = null;

  const listen = (target, event, handler, options) => {
    if (!target) return;
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  // Sort binding
  listen(sort, 'change', () => {
    if (sortForm) sortForm.requestSubmit();
  });

  // ── Drawer open/close ──
  function openDrawer() {
    if (drawerOpen || !drawer || !backdrop) return;
    drawerOpen = true;
    savedTrigger = document.activeElement;
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.setAttribute('aria-hidden', 'false');
    drawer.classList.add('is-open');
    backdrop.classList.add('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    _lockBodyScroll();

    // Focus the close button or first focusable element
    const focusable = _getFocusableElements(drawer);
    const focusTarget = closeBtn && focusable.includes(closeBtn) ? closeBtn : focusable[0];
    if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
  }

  function closeDrawer() {
    if (!drawerOpen || !drawer || !backdrop) return;
    drawerOpen = false;
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.setAttribute('aria-hidden', 'true');
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    _unlockBodyScroll();

    // Restore focus to trigger
    if (savedTrigger && typeof savedTrigger.focus === 'function') {
      requestAnimationFrame(() => savedTrigger.focus());
    }
    savedTrigger = null;
  }

  listen(toggle, 'click', openDrawer);
  listen(closeBtn, 'click', closeDrawer);
  listen(backdrop, 'click', closeDrawer);

  // Keyboard: Escape closes
  listen(document, 'keydown', (event) => {
    if (event.key === 'Escape' && drawerOpen) {
      event.preventDefault();
      closeDrawer();
    }
    if (drawerOpen) _trapFocus(drawer, event);
  });

  // Close drawer on navigation link click
  if (drawer) {
    const navLinks = drawer.querySelectorAll('a[href]');
    navLinks.forEach((link) => {
      listen(link, 'click', (event) => {
        const href = link.getAttribute('href');
        if (href && href !== '#' && !href.startsWith('javascript:') && !link.getAttribute('target')) {
          closeDrawer();
        }
      });
    });

    // Reset scroll position on open
    listen(drawer, 'transitionend', () => {
      if (drawerOpen && drawer) drawer.scrollTop = 0;
    }, { once: false });
  }

  // Close drawer if viewport resizes above mobile breakpoint
  let resizeDebounce = null;
  listen(window, 'resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      if (drawerOpen && window.innerWidth > 767) closeDrawer();
    }, 100);
  });

  // Update cart count from server-rendered badge
  function syncCartCount() {
    if (!drawer) return;
    const sidebarBadge = document.querySelector('.st-sidebar__badge');
    const drawerBadge = drawer.querySelector('.st-mobile-drawer__badge');
    if (!sidebarBadge || !drawerBadge || !drawerBadge.parentElement) return;
    const count = parseInt(sidebarBadge.textContent, 10);
    if (!isNaN(count) && count > 0) {
      drawerBadge.textContent = String(count);
      drawerBadge.style.display = '';
    } else {
      drawerBadge.style.display = 'none';
    }
  }

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    if (drawerOpen) { _unlockBodyScroll(); drawerOpen = false; }
    removers.splice(0).forEach((remove) => remove());
    if (storeInstances.get(root) === cleanup) storeInstances.delete(root);
  }

  storeInstances.set(root, cleanup);
  return cleanup;
}

const destroyStore = initStore(document);
window.addEventListener('pagehide', destroyStore, { once: true });
