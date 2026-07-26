/**
 * Media library progressive enhancement — Phase 11A.
 * Copy-to-clipboard for public URLs and a processing state for uploads.
 * Everything degrades gracefully: forms and links work without this module.
 */

function flashButton(button, message) {
  const original = button.textContent;
  button.textContent = message;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1600);
}

async function copyUrl(button) {
  const relative = button.getAttribute('data-copy-url');
  if (!relative) return;
  const absolute = new URL(relative, window.location.origin).href;
  try {
    await navigator.clipboard.writeText(absolute);
    flashButton(button, 'Copiado');
  } catch {
    flashButton(button, 'No se pudo copiar');
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy-url]');
  if (button) copyUrl(button);
});

for (const form of document.querySelectorAll('form[data-media-upload]')) {
  form.addEventListener('submit', () => {
    const state = form.querySelector('[data-upload-state]');
    if (state) state.hidden = false;
    for (const button of form.querySelectorAll('button[type="submit"]')) {
      button.disabled = true;
    }
  });
}
