/**
 * Admin product image previews — client-side preview + count validation.
 */
(function () {
  const primaryInput = document.getElementById('primaryImage');
  const secondaryInput = document.getElementById('secondaryImages');
  const previewContainer = document.getElementById('new-image-previews');

  if (!primaryInput || !secondaryInput || !previewContainer) return;

  let objectURLs = [];

  function revokeURLs() {
    objectURLs.forEach(function (url) { URL.revokeObjectURL(url); });
    objectURLs = [];
  }

  function renderPreviews() {
    revokeURLs();
    previewContainer.innerHTML = '';
    const files = [];

    if (primaryInput.files[0]) files.push({ file: primaryInput.files[0], label: 'Principal' });
    for (let i = 0; i < secondaryInput.files.length; i++) {
      files.push({ file: secondaryInput.files[i], label: 'Secundaria' });
    }

    if (!files.length) {
      previewContainer.style.display = 'none';
      return;
    }

    previewContainer.style.display = 'grid';

    files.forEach(function (item) {
      const url = URL.createObjectURL(item.file);
      objectURLs.push(url);
      const card = document.createElement('div');
      card.className = 'image-card';
      card.innerHTML =
        '<img src="' + url + '" alt="" class="image-preview">' +
        '<span class="badge">' + item.label + '</span>';
      previewContainer.appendChild(card);
    });
  }

  primaryInput.addEventListener('change', renderPreviews);
  secondaryInput.addEventListener('change', renderPreviews);

  // Cleanup on page unload
  window.addEventListener('beforeunload', revokeURLs);
})();
