/**
 * Cart page — progressive enhancement for quantity ± controls.
 * CSP-safe: no inline handlers. No-JS flow works fully with server-rendered forms.
 */

let initDone = false;

export function initCart() {
  if (initDone) return;
  initDone = true;

  function adjust(el, delta) {
    const targetId = el.getAttribute('data-qty-target');
    if (!targetId) return;
    const input = document.getElementById(targetId);
    if (!input) return;
    const min = parseInt(input.min, 10) || 1;
    const max = parseInt(input.max, 10) || 99;
    let val = parseInt(input.value, 10) || min;
    val = Math.max(min, Math.min(max, val + delta));
    input.value = String(val);
  }

  document.querySelectorAll('.cart-qty-dec').forEach(b => {
    b.addEventListener('click', () => adjust(b, -1));
  });
  document.querySelectorAll('.cart-qty-inc').forEach(b => {
    b.addEventListener('click', () => adjust(b, 1));
  });

  // Clear cart confirmation
  const clearBtn = document.querySelector('[data-cart-clear-btn]');
  const clearForm = document.querySelector('[data-cart-clear-form]');
  if (clearBtn && clearForm) {
    clearBtn.addEventListener('click', () => {
      if (confirm('¿Estás seguro de vaciar el carrito?')) {
        clearForm.submit();
      }
    });
  }

  // Sync product-detail quantity to cart form
  const detailQty = document.querySelector('[data-quantity-input]');
  const cartQtyHidden = document.querySelector('[data-cart-quantity]');
  if (detailQty && cartQtyHidden) {
    const sync = () => { cartQtyHidden.value = detailQty.value || '1'; };
    detailQty.addEventListener('input', sync);
    detailQty.addEventListener('change', sync);
    const obs = new MutationObserver(() => {
      cartQtyHidden.value = detailQty.value || '1';
    });
    obs.observe(detailQty, { attributes: true, attributeFilter: ['value'] });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCart);
} else {
  initCart();
}
