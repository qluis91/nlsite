import { initNavbar } from './public-navbar.js';

initNavbar();

const form = document.getElementById('cotizacion-form');
const input = document.getElementById('cot-images');
const previews = document.getElementById('cot-previews');
const submit = document.getElementById('cotizacion-submit');
const msg = document.getElementById('cotizacion-msg');

const MAX_FILES = Number(form?.dataset.maxImageFiles) || 5;
const MAX_BYTES = Number(form?.dataset.maxImageBytes) || (12 * 1024 * 1024);
const MAX_MB = Number(form?.dataset.maxImageMb) || Math.round(MAX_BYTES / (1024 * 1024));
const SUBMIT_LABEL = 'Enviar cotización';
/** @type {File[]} */
let selected = [];

function showMessage(text, isError = false) {
  if (!msg) return;
  msg.hidden = false;
  msg.textContent = text;
  msg.classList.toggle('is-error', Boolean(isError));
}

function setSubmitting(busy) {
  if (!submit) return;
  submit.disabled = Boolean(busy);
  submit.textContent = busy ? 'Enviando…' : SUBMIT_LABEL;
}

function notifySuccess(title, description) {
  if (window.NinjaAlerts?.success) {
    window.NinjaAlerts.success(title, description);
  }
}

function notifyWarning(title, description) {
  if (window.NinjaAlerts?.warning) {
    window.NinjaAlerts.warning(title, description);
  }
}

function notifyError(title, description) {
  if (window.NinjaAlerts?.error) {
    window.NinjaAlerts.error(title, description);
  }
}

function renderPreviews() {
  if (!previews) return;
  previews.innerHTML = '';
  if (!selected.length) {
    previews.hidden = true;
    return;
  }
  previews.hidden = false;
  selected.forEach((file, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'cotizacion-preview';
    const img = document.createElement('img');
    img.alt = '';
    img.src = URL.createObjectURL(file);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Quitar imagen');
    btn.textContent = '×';
    btn.addEventListener('click', () => {
      selected.splice(index, 1);
      syncInputFiles();
      renderPreviews();
    });
    wrap.append(img, btn);
    previews.appendChild(wrap);
  });
}

function syncInputFiles() {
  if (!input) return;
  const dt = new DataTransfer();
  selected.forEach((file) => dt.items.add(file));
  input.files = dt.files;
}

function clearFormKeepAuth() {
  if (!form) return;
  const keepName = form.querySelector('#cot-name');
  const keepEmail = form.querySelector('#cot-email');
  const keepPhone = form.querySelector('#cot-phone');
  const authName = keepName?.dataset.authPrefill || '';
  const authEmail = keepEmail?.dataset.authPrefill || '';
  const authPhone = keepPhone?.dataset.authPrefill || '';

  form.reset();
  selected = [];
  syncInputFiles();
  renderPreviews();

  const qty = form.querySelector('#cot-quantity');
  if (qty) qty.value = '1';
  if (keepName && authName) keepName.value = authName;
  if (keepEmail && authEmail) keepEmail.value = authEmail;
  if (keepPhone && authPhone) keepPhone.value = authPhone;
}

function safeFileLabel(name) {
  return String(name || 'archivo').replace(/[<>&"']/g, '').slice(0, 120);
}

input?.addEventListener('change', () => {
  const incoming = [...(input.files || [])];
  const warnings = [];
  let skippedCapacity = 0;

  for (const file of incoming) {
    const mime = String(file.type || '').toLowerCase();
    if (!mime.startsWith('image/') || mime.includes('svg')) {
      warnings.push('Solo podés subir imágenes PNG, JPG o WEBP.');
      continue;
    }
    if (Number(file.size) > MAX_BYTES) {
      const sizeMb = (Number(file.size) / 1024 / 1024).toFixed(1);
      warnings.push(
        `La imagen “${safeFileLabel(file.name)}” pesa ${sizeMb} MB. El máximo permitido es ${MAX_MB} MB.`
      );
      continue;
    }
    if (selected.length >= MAX_FILES) {
      skippedCapacity += 1;
      continue;
    }
    selected.push(file);
  }

  if (skippedCapacity > 0) {
    warnings.push(`Podés subir hasta ${MAX_FILES} imágenes de referencia.`);
  }

  syncInputFiles();
  renderPreviews();

  if (warnings.length) {
    const unique = [...new Set(warnings)];
    const text = unique.join(' ');
    showMessage(text, true);
    notifyWarning('No pudimos usar esa imagen', text);
  }
});

['#cot-name', '#cot-email', '#cot-phone'].forEach((sel) => {
  const el = document.querySelector(sel);
  if (el && el.value) el.dataset.authPrefill = el.value;
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form) return;

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  syncInputFiles();
  setSubmitting(true);
  showMessage('Enviando tu cotización…', false);

  try {
    const formData = new FormData(form);
    const response = await fetch(form.action || '/cotizar/pieza-3d', {
      method: 'POST',
      body: formData,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      const errorText = payload?.error
        || (response.status === 413
          ? `Cada imagen puede pesar máximo ${MAX_MB} MB.`
          : (response.status >= 500
            ? 'No se pudo enviar la cotización. Intentá nuevamente.'
            : 'Revisá los datos e intentá nuevamente.'));
      showMessage(errorText, true);
      setSubmitting(false);
      if (payload?.field === 'images' || response.status === 413 || response.status === 415) {
        notifyWarning('No pudimos usar esa imagen', errorText);
      } else if (response.status >= 500) {
        notifyError('No se pudo enviar la cotización', errorText);
      } else {
        notifyWarning('Revisá la cotización', errorText);
      }
      if (payload?.field) {
        const field = form.querySelector(`[name="${payload.field}"]`);
        field?.focus?.();
      }
      return;
    }

    const successTitle = payload.title || 'Cotización enviada correctamente';
    const successDescription = payload.message
      || `Recibimos tu solicitud ${payload.reference || ''}. Revisaremos la información y te contactaremos para preparar la propuesta.`;

    clearFormKeepAuth();
    setSubmitting(false);
    showMessage('Solicitud enviada correctamente.', false);
    notifySuccess(successTitle, successDescription);
  } catch {
    const networkText = 'Revisá tu conexión e intentá nuevamente.';
    showMessage('No se pudo enviar la cotización. Revisá tu conexión e intentá nuevamente.', true);
    setSubmitting(false);
    notifyError('No se pudo enviar la cotización', networkText);
  }
});
