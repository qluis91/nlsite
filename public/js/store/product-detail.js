/**
 * Product detail — gallery thumbnails + quantity control.
 */
const detailInstances = new WeakMap();

export function initProductDetail(root) {
  if (!root) return () => {};
  if (detailInstances.has(root)) return detailInstances.get(root);

  const mainImage = root.querySelector('[data-product-main-image]');
  const thumbnails = [...root.querySelectorAll('[data-product-thumbnail]')];
  const gallery = root.querySelector('[data-product-gallery]');
  const quantityRoot = root.querySelector('[data-product-quantity]');
  const removers = [];
  let destroyed = false;

  const listen = (target, event, handler, options) => {
    if (!target) return;
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  // ── Gallery: thumbnail click → swap main image ──
  if (mainImage && thumbnails.length) {
    function setActiveThumbnail(btn) {
      thumbnails.forEach(t => {
        t.classList.remove('is-active');
        t.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
    }

    for (const btn of thumbnails) {
      listen(btn, 'click', () => {
        const src = btn.getAttribute('data-image-src');
        const alt = btn.getAttribute('data-image-alt');
        if (src && mainImage) {
          mainImage.src = src;
          if (alt) mainImage.alt = alt;
          setActiveThumbnail(btn);
        }
      });

      listen(btn, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
        }
      });
    }
  }

  // ── Quantity control ──
  if (quantityRoot) {
    const input = quantityRoot.querySelector('[data-quantity-input]');
    const decBtn = quantityRoot.querySelector('[data-quantity-decrease]');
    const incBtn = quantityRoot.querySelector('[data-quantity-increase]');
    const cartHidden = document.querySelector('[data-cart-quantity]');

    if (input && decBtn && incBtn) {
      const min = parseInt(input.min, 10) || 1;
      const max = parseInt(input.max, 10) || 99;

      function syncCartHidden() {
        if (cartHidden) cartHidden.value = input.value;
      }

      function updateButtons() {
        const val = parseInt(input.value, 10) || min;
        decBtn.disabled = val <= min;
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
        if (isNaN(val) || val < min) val = min;
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
    removers.splice(0).forEach(r => r());
    if (detailInstances.get(root) === cleanup) detailInstances.delete(root);
  }

  detailInstances.set(root, cleanup);
  return cleanup;
}

// Auto-init
const root = document.querySelector('[data-product-gallery]')?.closest('.store-page');
const destroy = initProductDetail(root);
if (destroy) window.addEventListener('pagehide', destroy, { once: true });
