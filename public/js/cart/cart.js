/**
 * Cart page — progressive enhancement for quantity ± controls.
 * No-JS flow works fully with server-rendered forms.
 */

function initCart() {
  const decs = document.querySelectorAll('.cart-qty-dec');
  const incs = document.querySelectorAll('.cart-qty-inc');

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
    // Disable buttons at boundaries
    const wrapper = input.closest('.pd-quantity__control');
    if (wrapper) {
      const decBtn = wrapper.querySelector('[data-qty-target]');
      const incBtn = wrapper.querySelector('.cart-qty-inc');
      if (decBtn && decBtn === el && val <= min) return;
      if (incBtn && incBtn !== el && val >= max) return;
    }
  }

  decs.forEach(b => b.addEventListener('click', () => adjust(b, -1)));
  incs.forEach(b => b.addEventListener('click', () => adjust(b, 1)));

  // Sync product-detail quantity to cart form on detail page
  const detailQty = document.querySelector('[data-quantity-input]');
  const cartQtyHidden = document.querySelector('[data-cart-quantity]');
  if (detailQty && cartQtyHidden) {
    const syncQty = () => { cartQtyHidden.value = detailQty.value || '1'; };
    detailQty.addEventListener('input', syncQty);
    detailQty.addEventListener('change', syncQty);
    // Also sync when ± buttons change it (they modify the input)
    const obs = new MutationObserver(() => {
      cartQtyHidden.value = detailQty.value || '1';
    });
    obs.observe(detailQty, { attributes: true, attributeFilter: ['value'] });
  }
}

document.addEventListener('DOMContentLoaded', initCart);
