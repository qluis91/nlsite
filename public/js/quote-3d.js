import { initNavbar } from './public-navbar.js';

initNavbar();

const form = document.getElementById('cotizacion-form');
const input = document.getElementById('cot-images');
const previews = document.getElementById('cot-previews');
const submit = document.getElementById('cotizacion-submit');
const msg = document.getElementById('cotizacion-msg');

const MAX = 5;
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

input?.addEventListener('change', () => {
  const incoming = [...(input.files || [])];
  for (const file of incoming) {
    if (!String(file.type || '').startsWith('image/')) continue;
    if (selected.length >= MAX) break;
    selected.push(file);
  }
  syncInputFiles();
  renderPreviews();
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
        || (response.status >= 500
          ? 'No se pudo enviar la cotización. Intentá nuevamente.'
          : 'Revisá los datos e intentá nuevamente.');
      showMessage(errorText, true);
      setSubmitting(false);
      if (payload?.field) {
        const field = form.querySelector(`[name="${payload.field}"]`);
        field?.focus?.();
      }
      return;
    }

    clearFormKeepAuth();
    setSubmitting(false);
    showMessage(
      payload.message
        || `Recibimos tu solicitud (${payload.reference || ''}). Revisaremos la información y te contactaremos para preparar la propuesta.`,
      false
    );
  } catch {
    showMessage('No se pudo enviar la cotización. Revisá tu conexión e intentá nuevamente.', true);
    setSubmitting(false);
  }
});
