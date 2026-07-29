/**
 * Reusable accessible confirmation dialog — Phase 1D.
 * Replaces browser window.confirm() across all Admin views.
 *
 * Usage via data attribute:
 *   <form data-confirm="¿Eliminar este elemento?" data-confirm-title="Eliminar">
 *
 * Or programmatically:
 *   NinjaConfirm.show({ title, message, confirmLabel, confirmClass, onConfirm })
 *
 * Features:
 * - Accessible (focus trap, ARIA dialog, Escape closes, focus restore)
 * - CSP compatible (no inline event handlers)
 * - Reduced-motion support
 * - Backdrop click behavior is intentional (close on backdrop=none by default)
 */
(function () {
  'use strict';

  if (window.NinjaConfirm?.version) return;

  const DIALOG_ID = 'ninja-confirm-dialog';
  const DEFAULT_TITLE = 'Confirmar acción';
  const DEFAULT_CONFIRM = 'Confirmar';
  const DEFAULT_CANCEL = 'Cancelar';

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  function createDialog() {
    let existing = document.getElementById(DIALOG_ID);
    if (existing) return existing;

    const dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `
      <div class="confirm-dialog__inner">
        <h2 id="${DIALOG_ID}-title" class="confirm-dialog__title"></h2>
        <p id="${DIALOG_ID}-desc" class="confirm-dialog__message"></p>
        <div class="confirm-dialog__actions">
          <button type="button" class="btn btn-outline" data-confirm-cancel>${DEFAULT_CANCEL}</button>
          <button type="button" class="btn" data-confirm-ok>${DEFAULT_CONFIRM}</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  let activeState = null;
  let previousActiveElement = null;

  function getFocusableElements(dialog) {
    return dialog.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
  }

  function trapFocus(event, dialog) {
    const focusable = getFocusableElements(dialog);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.key === 'Tab') {
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function show(options = {}) {
    const dialog = createDialog();
    if (dialog.open) return;

    const title = options.title || DEFAULT_TITLE;
    const message = options.message || '';
    const confirmLabel = options.confirmLabel || (options.destructive ? 'Eliminar permanentemente' : DEFAULT_CONFIRM);
    const confirmClass = options.confirmClass || (options.destructive ? 'btn-danger' : 'btn-primary');

    dialog.querySelector('.confirm-dialog__title').textContent = title;
    dialog.querySelector('.confirm-dialog__message').innerHTML = message;
    const confirmBtn = dialog.querySelector('[data-confirm-ok]');
    confirmBtn.textContent = confirmLabel;
    confirmBtn.className = `btn ${confirmClass}`;

    previousActiveElement = document.activeElement;
    activeState = {
      onConfirm: options.onConfirm || null,
      onCancel: options.onCancel || null,
      form: options.form || null,
    };

    dialog.showModal();
    const firstFocusable = dialog.querySelector(getFocusableElements(dialog).length ? '[data-confirm-cancel]' : '[data-confirm-ok]');
    if (firstFocusable) firstFocusable.focus();
  }

  function handleConfirm() {
    if (!activeState) return;
    const dialog = document.getElementById(DIALOG_ID);
    dialog.close('confirmed');
    if (activeState.form) {
      activeState.form.submit();
    } else if (activeState.onConfirm) {
      activeState.onConfirm();
    }
    cleanup();
  }

  function handleCancel() {
    if (!activeState) return;
    const dialog = document.getElementById(DIALOG_ID);
    dialog.close('cancelled');
    if (activeState.onCancel) activeState.onCancel();
    cleanup();
  }

  function cleanup() {
    activeState = null;
    if (previousActiveElement?.focus) {
      setTimeout(() => previousActiveElement.focus(), 0);
    }
    previousActiveElement = null;
  }

  // Initialize event bindings
  function init() {
    const dialog = createDialog();

    dialog.addEventListener('close', () => {
      cleanup();
    });

    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
        return;
      }
      trapFocus(event, dialog);
    });

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        // Do NOT close on backdrop click — intentional behavior
        event.stopPropagation();
      }
      const okBtn = event.target.closest('[data-confirm-ok]');
      if (okBtn) { handleConfirm(); return; }
      const cancelBtn = event.target.closest('[data-confirm-cancel]');
      if (cancelBtn) { handleCancel(); return; }
    });

    // Delegate click handling for forms with data-confirm
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-confirm]');
      if (!button) return;

      // Find the form: use form attribute if present, otherwise closest ancestor
      const form = button.getAttribute('form')
        ? document.getElementById(button.getAttribute('form'))
        : button.closest('form');

      event.preventDefault();
      const message = button.getAttribute('data-confirm') || button.closest('[data-confirm]')?.getAttribute('data-confirm');
      const title = button.getAttribute('data-confirm-title') || null;
      const confirmLabel = button.getAttribute('data-confirm-label') || null;
      const isDestructive = button.hasAttribute('data-confirm-destructive');

      show({
        title: title || DEFAULT_TITLE,
        message: message,
        confirmLabel: confirmLabel || (isDestructive ? 'Eliminar permanentemente' : DEFAULT_CONFIRM),
        confirmClass: isDestructive ? 'btn-danger' : 'btn-primary',
        destructive: isDestructive,
        form: form,
      });
    });

    // Also intercept form submit (for forms that have data-confirm on the form element)
    document.addEventListener('submit', (event) => {
      const form = event.target.closest('form');
      if (!form) return;
      const confirmAttr = form.getAttribute('data-confirm');
      if (!confirmAttr) return;
      // Only intercept if it wasn't already handled by click delegation
      if (form.dataset.confirmHandled === 'true') {
        form.dataset.confirmHandled = 'false';
        return;
      }
      event.preventDefault();
      const title = form.getAttribute('data-confirm-title') || null;
      const isDestructive = form.hasAttribute('data-confirm-destructive');

      show({
        title: title || DEFAULT_TITLE,
        message: confirmAttr,
        confirmLabel: isDestructive ? 'Eliminar permanentemente' : DEFAULT_CONFIRM,
        confirmClass: isDestructive ? 'btn-danger' : 'btn-primary',
        destructive: isDestructive,
        form: form,
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.NinjaConfirm = {
    version: 1,
    show,
  };
})();
