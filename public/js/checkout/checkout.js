/**
 * Checkout page — progressive enhancement for address section toggle.
 * CSP-safe: no inline event handlers. No client-side monetary authority.
 */

let initDone = false;

export function initCheckout() {
  if (initDone) return;
  initDone = true;

  const addressBlock = document.getElementById('checkout-address');
  const deliveryInputs = document.querySelectorAll('[data-delivery-option]');
  const manualAddress = document.querySelector('[data-manual-address]');
  const manualFields = document.querySelectorAll('[data-manual-address-field]');
  const addressChoices = document.querySelectorAll('[data-address-choice]');
  const shippingDisplay = document.getElementById('checkout-shipping-display');
  const shippingPending = document.getElementById('checkout-shipping-pending');
  const finalTotal = document.getElementById('checkout-final-total');
  const finalPending = document.getElementById('checkout-final-pending');

  if (!deliveryInputs.length) return;

  function update() {
    const input = document.querySelector('[data-delivery-option]:checked');
    if (!input) return;
    const requiresAddr = input.getAttribute('data-requires-address') === 'true';
    const selectedChoice = document.querySelector('[data-address-choice]:checked');
    const usesManualAddress = !selectedChoice || selectedChoice.value === 'manual';

    if (addressBlock) addressBlock.style.display = requiresAddr ? '' : 'none';
    if (manualAddress) manualAddress.hidden = requiresAddr && !usesManualAddress;
    manualFields.forEach((field) => {
      field.disabled = !requiresAddr || !usesManualAddress;
      field.required = requiresAddr && usesManualAddress && field.hasAttribute('data-manual-required');
    });

    if (shippingDisplay) shippingDisplay.style.display = requiresAddr ? 'none' : 'flex';
    if (shippingPending) shippingPending.style.display = requiresAddr ? 'flex' : 'none';
    if (finalTotal) finalTotal.style.display = requiresAddr ? 'none' : '';
    if (finalPending) finalPending.style.display = requiresAddr ? '' : 'none';
  }

  deliveryInputs.forEach(i => i.addEventListener('change', update));
  addressChoices.forEach(i => i.addEventListener('change', update));
  update();

  // Double-submit prevention
  const form = document.querySelector('.st-checkout__layout');
  const submitBtn = document.querySelector('[data-checkout-submit]');
  if (form && submitBtn) {
    let submitting = false;
    form.addEventListener('submit', () => {
      if (submitting) {
        return false;
      }
      submitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Procesando...';
      submitBtn.setAttribute('aria-busy', 'true');
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCheckout);
} else {
  initCheckout();
}
