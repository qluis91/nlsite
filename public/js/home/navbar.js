const navbarInstances = new WeakMap();
const DESKTOP_QUERY = '(min-width: 1041px)';
const SCROLL_THRESHOLD = 72;

export function initNavbar() {
  const header = document.querySelector('[data-home-navbar]');
  if (!header) return () => {};
  if (navbarInstances.has(header)) return navbarInstances.get(header);

  const toggle = header.querySelector('[data-nav-toggle]');
  const panel = header.querySelector('[data-nav-panel]');
  const dropdowns = [...header.querySelectorAll('[data-nav-dropdown]')];
  const desktop = window.matchMedia(DESKTOP_QUERY);
  const timers = new Map();
  const removers = [];
  let openDropdown = null;
  let menuOpen = false;
  let scrollFrame = null;
  let destroyed = false;

  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  function clearTimer(item) {
    const timer = timers.get(item);
    if (timer) clearTimeout(timer);
    timers.delete(item);
  }

  function queue(item, callback, delay) {
    clearTimer(item);
    timers.set(item, setTimeout(() => {
      timers.delete(item);
      callback();
    }, delay));
  }

  function setDropdown(item, expanded) {
    if (!item) return;
    const trigger = item.querySelector('.hero-nav-trigger');
    const dropdownPanel = item.querySelector('.hero-dropdown-panel');
    item.classList.toggle('is-open', expanded);
    trigger?.setAttribute('aria-expanded', String(expanded));
    dropdownPanel?.toggleAttribute('inert', !expanded);
    dropdownPanel?.setAttribute('aria-hidden', String(!expanded));
    if (expanded) openDropdown = item;
    else if (openDropdown === item) openDropdown = null;
  }

  function closeDropdowns(except = null) {
    dropdowns.forEach((item) => {
      clearTimer(item);
      if (item !== except) setDropdown(item, false);
    });
  }

  function open(item) {
    closeDropdowns(item);
    setDropdown(item, true);
  }

  function setMenu(expanded, returnFocus = false) {
    if (!toggle || !panel) return;
    menuOpen = expanded;
    header.classList.toggle('is-menu-open', expanded);
    document.body.classList.toggle('is-home-nav-open', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Cerrar menú principal' : 'Abrir menú principal');
    if (!expanded) {
      closeDropdowns();
      if (returnFocus) toggle.focus();
    }
  }

  function updateScrollState() {
    scrollFrame = null;
    header.classList.toggle('is-scrolled', window.scrollY > SCROLL_THRESHOLD);
  }

  function onScroll() {
    if (scrollFrame === null) scrollFrame = requestAnimationFrame(updateScrollState);
  }

  function onDocumentPointerDown(event) {
    if (!header.contains(event.target)) {
      closeDropdowns();
      if (menuOpen) setMenu(false);
    }
  }

  function onDocumentKeydown(event) {
    if (event.key !== 'Escape') return;
    if (openDropdown) {
      const trigger = openDropdown.querySelector('.hero-nav-trigger');
      closeDropdowns();
      trigger?.focus();
    } else if (menuOpen) {
      setMenu(false, true);
    }
  }

  function onModeChange() {
    setMenu(false);
    closeDropdowns();
  }

  header.classList.add('is-enhanced');
  setMenu(false);
  dropdowns.forEach((item) => setDropdown(item, false));
  updateScrollState();

  if (toggle) listen(toggle, 'click', () => setMenu(!menuOpen));
  listen(window, 'scroll', onScroll, { passive: true });
  listen(document, 'pointerdown', onDocumentPointerDown);
  listen(document, 'keydown', onDocumentKeydown);
  listen(desktop, 'change', onModeChange);

  dropdowns.forEach((item) => {
    const trigger = item.querySelector('.hero-nav-trigger');
    if (!trigger) return;

    listen(trigger, 'click', () => {
      const willOpen = !item.classList.contains('is-open');
      if (willOpen) open(item);
      else setDropdown(item, false);
    });

    listen(item, 'pointerenter', (event) => {
      if (!desktop.matches || event.pointerType === 'touch') return;
      queue(item, () => open(item), 70);
    });

    listen(item, 'pointerleave', (event) => {
      if (!desktop.matches || event.pointerType === 'touch') return;
      queue(item, () => setDropdown(item, false), 150);
    });

    listen(item, 'focusin', () => {
      if (desktop.matches) open(item);
    });

    listen(item, 'focusout', (event) => {
      if (desktop.matches && !item.contains(event.relatedTarget)) {
        queue(item, () => setDropdown(item, false), 80);
      }
    });
  });

  header.querySelectorAll('a[href]').forEach((link) => {
    listen(link, 'click', () => {
      if (!desktop.matches) setMenu(false);
      closeDropdowns();
    });
  });

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    removers.splice(0).forEach((remove) => remove());
    setMenu(false);
    closeDropdowns();
    dropdowns.forEach((item) => {
      const dropdownPanel = item.querySelector('.hero-dropdown-panel');
      dropdownPanel?.removeAttribute('inert');
      dropdownPanel?.removeAttribute('aria-hidden');
    });
    header.classList.remove('is-enhanced', 'is-scrolled', 'is-menu-open');
    document.body.classList.remove('is-home-nav-open');
    if (navbarInstances.get(header) === cleanup) navbarInstances.delete(header);
  }

  navbarInstances.set(header, cleanup);
  return cleanup;
}
