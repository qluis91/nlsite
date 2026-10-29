import { initNavbar } from './public-navbar.js';

initNavbar();

const form = document.getElementById('cotizacion-form');
const input = document.getElementById('cot-images');
const previews = document.getElementById('cot-previews');
const submit = document.getElementById('cotizacion-submit');
const msg = document.getElementById('cotizacion-msg');

const MAX = 5;
/** @type {File[]} */
let selected = [];

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

form?.addEventListener('submit', () => {
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Enviando…';
  }
  if (msg) {
    msg.hidden = false;
    msg.textContent = 'Enviando tu cotización…';
  }
});
