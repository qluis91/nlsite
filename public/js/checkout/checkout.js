/**
 * Checkout page — progressive enhancement for address section toggle.
 */
(() => {
  const addressBlock = document.getElementById('checkout-address');
  const deliveryInputs = document.querySelectorAll('[data-delivery-option]');
  const addressFields = document.querySelectorAll('[data-address-field]');
  const shippingDisplay = document.getElementById('checkout-shipping-display');
  const shippingPending = document.getElementById('checkout-shipping-pending');
  const finalTotal = document.getElementById('checkout-final-total');
  const finalPending = document.getElementById('checkout-final-pending');

  if (!deliveryInputs.length) return;

  function update(e) {
    const input = e ? e.target : document.querySelector('[data-delivery-option]:checked');
    if (!input) return;
    const requiresAddr = input.getAttribute('data-requires-address') === 'true';

    // Address
    if (addressBlock) addressBlock.style.display = requiresAddr ? '' : 'none';
    addressFields.forEach(f => { f.required = requiresAddr; });

    // Shipping display
    if (shippingDisplay) shippingDisplay.style.display = requiresAddr ? 'none' : 'flex';
    if (shippingPending) shippingPending.style.display = requiresAddr ? 'flex' : 'none';

    // Final total
    if (finalTotal) finalTotal.style.display = requiresAddr ? 'none' : '';
    if (finalPending) finalPending.style.display = requiresAddr ? '' : 'none';
  }

  deliveryInputs.forEach(i => i.addEventListener('change', update));
  // Run once on load
  update();
})();
