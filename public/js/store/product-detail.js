/**
 * Product detail — gallery thumbnails + quantity control.
 * CSP-safe: no inline handlers. Idempotent via WeakMap.
 */
const detailInstances = new WeakMap();

export function initProductDetail(root) {
  if (!root) return () => {};
  if (detailInstances.has(root)) return detailInstances.get(root);

  const mainImage = root.querySelector('[data-product-main-image]');
  const thumbnails = [...root.querySelectorAll('[data-product-thumbnail]')];
  const quantityRoot = root.querySelector('[data-product-quantity]');
  const removers = [];
  let destroyed = false;
  let activeIndex = Math.max(0, thumbnails.findIndex((t) => t.classList.contains('is-active')));

  const listen = (target, event, handler, options) => {
    if (!target) return;
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  function setActiveThumbnail(btn, index) {
    thumbnails.forEach((t) => {
      t.classList.remove('is-active');
      t.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', 'true');
    activeIndex = index;
  }

  function selectThumbnail(btn, index) {
    const src = btn.getAttribute('data-image-src');
    const alt = btn.getAttribute('data-image-alt');
    if (src && mainImage) {
      mainImage.src = src;
      if (alt) mainImage.alt = alt;
    }
    setActiveThumbnail(btn, index);
  }

  if (mainImage && thumbnails.length) {
    thumbnails.forEach((btn, index) => {
      listen(btn, 'click', () => selectThumbnail(btn, index));

      listen(btn, 'keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault();
          const next = (index + 1) % thumbnails.length;
          thumbnails[next].focus();
          selectThumbnail(thumbnails[next], next);
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const prev = (index - 1 + thumbnails.length) % thumbnails.length;
          thumbnails[prev].focus();
          selectThumbnail(thumbnails[prev], prev);
        } else if (event.key === 'Home') {
          event.preventDefault();
          thumbnails[0].focus();
          selectThumbnail(thumbnails[0], 0);
        } else if (event.key === 'End') {
          event.preventDefault();
          const last = thumbnails.length - 1;
          thumbnails[last].focus();
          selectThumbnail(thumbnails[last], last);
        }
      });
    });

    if (activeIndex < 0 && thumbnails[0]) {
      setActiveThumbnail(thumbnails[0], 0);
    }
  }

  if (quantityRoot) {
    const input = quantityRoot.querySelector('[data-quantity-input]');
    const decBtn = quantityRoot.querySelector('[data-quantity-decrease]');
    const incBtn = quantityRoot.querySelector('[data-quantity-increase]');
    const cartHidden = root.querySelector('[data-cart-quantity]');

    if (input && decBtn && incBtn) {
      const min = parseInt(input.min, 10) || 1;
      const max = parseInt(input.max, 10) || 99;

      function syncCartHidden() {
        if (cartHidden) cartHidden.value = input.value;
      }

      function updateButtons() {
        const val = parseInt(input.value, 10) || min;
        decBtn.disabled = val <= min || input.disabled;
        incBtn.disabled = val >= max || input.disabled;
        syncCartHidden();
      }

      listen(decBtn, 'click', () => {
        const val = parseInt(input.value, 10) || min;
        if (val > min) {
          input.value = String(val - 1);
          updateButtons();
        }
      });

      listen(incBtn, 'click', () => {
        const val = parseInt(input.value, 10) || min;
        if (val < max) {
          input.value = String(val + 1);
          updateButtons();
        }
      });

      listen(input, 'input', () => {
        let val = parseInt(input.value, 10);
        if (Number.isNaN(val) || val < min) val = min;
        if (val > max) val = max;
        input.value = String(val);
        updateButtons();
      });

      listen(input, 'change', updateButtons);
      updateButtons();
    }
  }

  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    removers.splice(0).forEach((remove) => remove());
    if (detailInstances.get(root) === cleanup) detailInstances.delete(root);
  }

  detailInstances.set(root, cleanup);
  return cleanup;
}

const root = document.querySelector('[data-product-page]');
const destroy = initProductDetail(root);
if (destroy) window.addEventListener('pagehide', destroy, { once: true });

// Add-to-cart success panel — dismiss and focus management
const panel = document.querySelector('[data-add-to-cart-panel]');
if (panel) {
  // Show the panel (CSS starts it hidden; noscript handles the no-JS case)
  panel.style.display = 'block';

  // Move focus to the panel for screen readers
  panel.focus();
  const dismissBtn = panel.querySelector('[data-add-to-cart-dismiss]');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      panel.style.display = 'none';
      // Return focus to the "Add to cart" button if available
      const addBtn = document.querySelector('.st-product__cart-form button[type="submit"]');
      if (addBtn) addBtn.focus();
    });
  }
  // Dismiss with Escape key
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      panel.style.display = 'none';
      const addBtn = document.querySelector('.st-product__cart-form button[type="submit"]');
      if (addBtn) addBtn.focus();
    }
  });
}
