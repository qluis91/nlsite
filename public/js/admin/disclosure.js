/**
 * Phase 1D — Advanced-section disclosure (vanilla JS).
 * Usage: <details class="advanced-section" data-advanced-section>
 *   <summary>...</summary> content </details>
 *
 * Auto-opens when:
 *  - section contains a validation error (field-errors or aria-invalid)
 *  - a linked field receives focus (data-for-disclosure="sectionId")
 */
(function () {
  'use strict';

  if (window.__ninjaDisclosureInit) return;
  window.__ninjaDisclosureInit = true;

  function initDisclosures(scope = document) {
    scope.querySelectorAll('[data-advanced-section]').forEach((details) => {
      if (details.dataset.advancedReady === '1') return;
      details.dataset.advancedReady = '1';

      const summary = details.querySelector('summary');
      if (!summary) return;

      // Ensure correct ARIA
      summary.setAttribute('role', 'button');
      if (!summary.hasAttribute('aria-expanded')) {
        summary.setAttribute('aria-expanded', String(details.open));
      }

      // Track open/close for aria-expanded
      const observer = new MutationObserver(() => {
        summary.setAttribute('aria-expanded', String(details.open));
      });
      observer.observe(details, { attributes: true, attributeFilter: ['open'] });

      // Auto-open on validation error
      const hasError = details.querySelector('.cms-field-errors, [aria-invalid="true"]');
      if (hasError) {
        details.open = true;
      }

      // Auto-open on linked field focus
      const linkedFieldId = details.dataset.forField;
      if (linkedFieldId) {
        const linkedField = document.getElementById(linkedFieldId);
        if (linkedField) {
          linkedField.addEventListener('focus', () => {
            details.open = true;
          }, { once: false });
        }
      }

      // Keyboard: Enter/Space on summary toggles
      summary.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          details.open = !details.open;
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initDisclosures(), { once: true });
  } else {
    initDisclosures();
  }

  // Expose for dynamic content
  window.NLDisclosure = { init: initDisclosures };
})();
