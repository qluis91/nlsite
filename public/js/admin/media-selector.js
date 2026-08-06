/**
 * Reusable CMS media selector.
 * Each selector owns its dialog and request state; repeated script execution is safe.
 */
(function () {
  'use strict';

  if (window.NLMediaSelector?.version === 1) {
    window.NLMediaSelector.init();
    return;
  }

  const SELECTOR = '[data-media-selector]';
  const controllers = new WeakMap();

  function initMediaSelectors(scope = document) {
    const roots = [];
    if (scope?.matches?.(SELECTOR)) roots.push(scope);
    scope?.querySelectorAll?.(SELECTOR).forEach(root => roots.push(root));

    roots.forEach((root) => {
      if (root.dataset.mediaSelectorInitialized === '1') return;
      root.dataset.mediaSelectorInitialized = '1';
      controllers.set(root, initializeMediaSelector(root));
    });

    return roots.map(root => controllers.get(root)).filter(Boolean);
  }

  function initializeMediaSelector(root) {
    const fieldName = root.dataset.fieldName || '';
    const allowedTypes = splitList(root.dataset.allowedTypes);
    const allowedCategories = splitList(root.dataset.allowedCategories);
    const uploadProfile = root.dataset.uploadProfile || '';
    const kindLabel = root.dataset.kindLabel || 'Archivo';

    const preview = root.querySelector('[data-ms-preview]');
    const input = root.querySelector('[data-ms-input]');
    const modal = root.querySelector('[data-ms-modal]');
    const grid = root.querySelector('[data-ms-grid]');
    const pagination = root.querySelector('[data-ms-pagination]');
    const searchInput = root.querySelector('[data-ms-search]');
    const categoryFilter = root.querySelector('[data-ms-category-filter]');
    const typeFilter = root.querySelector('[data-ms-type-filter]');
    const confirmBtn = root.querySelector('[data-ms-confirm]');
    const searchBtn = root.querySelector('[data-ms-search-btn]');
    const csrfToken = document.querySelector('input[name="_csrf"]')?.value || '';
    const csrfHeader = document.querySelector('meta[name="csrf-token"]')?.content || csrfToken;

    const tabs = root.querySelectorAll('[data-ms-tab]');
    const panels = root.querySelectorAll('[data-ms-panel]');
    const uploadZone = root.querySelector('[data-ms-upload-zone]');
    const fileInput = root.querySelector('[data-ms-file-input]');
    const uploadFileInfo = root.querySelector('[data-ms-upload-file]');
    const uploadFilename = root.querySelector('[data-ms-upload-filename]');
    const uploadClear = root.querySelector('[data-ms-upload-clear]');
    const uploadProgress = root.querySelector('[data-ms-upload-progress]');
    const uploadStatus = root.querySelector('[data-ms-upload-status]');
    const uploadError = root.querySelector('[data-ms-upload-error]');
    const uploadActions = root.querySelector('[data-ms-upload-actions]');
    const uploadBtn = root.querySelector('[data-ms-upload-btn]');
    const uploadRetry = root.querySelector('[data-ms-upload-retry]');

    const state = {
      opening: false,
      loading: false,
      loaded: false,
      requestController: null,
      requestSerial: 0,
      selectedPublicId: null,
      selectedAssetData: null,
      currentPage: 1,
      pendingFile: null,
      uploading: false,
      opener: null,
      searchTimer: null,
    };

    if (!fieldName) console.warn('Media selector: missing required fieldName.');
    if (!preview || !input || !modal || !grid || !pagination || !confirmBtn) {
      console.warn(`Media selector "${fieldName || '(sin nombre)'}": markup incompleto.`);
      return createPublicController();
    }

    function switchTab(tabName, options = {}) {
      tabs.forEach(tab => tab.classList.toggle('is-active', tab.dataset.msTab === tabName));
      panels.forEach(panel => panel.classList.toggle('is-active', panel.dataset.msPanel === tabName));
      if (tabName === 'library' && options.load !== false && !state.loaded) {
        void loadMedia(1);
      }
    }

    function openModal(event) {
      event?.preventDefault?.();
      if (state.opening || modal.open) return Promise.resolve(false);

      state.opening = true;
      state.opener = event?.currentTarget || document.activeElement || null;
      state.selectedPublicId = null;
      state.selectedAssetData = null;
      confirmBtn.disabled = true;
      switchTab('library', { load: false });

      try {
        modal.showModal();
      } catch (error) {
        state.opening = false;
        showLibraryError('No se pudo abrir la biblioteca.');
        return Promise.resolve(false);
      }

      return loadMedia(1).finally(() => {
        state.opening = false;
      }).then(() => true);
    }

    function closeModal(returnValue = 'cancel') {
      if (modal.open) modal.close(returnValue);
    }

    function abortActiveRequest() {
      if (state.requestController) state.requestController.abort();
      state.requestController = null;
      state.loading = false;
    }

    function handleClose() {
      abortActiveRequest();
      clearTimeout(state.searchTimer);
      state.searchTimer = null;
      state.opening = false;
      state.selectedPublicId = null;
      state.selectedAssetData = null;
      confirmBtn.disabled = true;
      resetUpload();
      const opener = state.opener;
      state.opener = null;
      if (opener?.focus) setTimeout(() => opener.focus(), 0);
    }

    async function loadMedia(page = 1, options = {}) {
      if (state.loading && !options.force) return false;
      if (state.loading) abortActiveRequest();

      const requestController = new AbortController();
      const requestSerial = ++state.requestSerial;
      state.requestController = requestController;
      state.loading = true;
      state.currentPage = page;

      const params = new URLSearchParams({
        page: String(page),
        limit: '12',
        allowed_types: allowedTypes.join(','),
        allowed_categories: allowedCategories.join(','),
        status: 'active',
      });
      const search = searchInput?.value.trim();
      if (search) params.set('search', search);
      if (categoryFilter?.value) params.set('category', categoryFilter.value);
      if (typeFilter?.value) params.set('mime_filter', typeFilter.value);

      // Show skeleton loading state
      grid.innerHTML =
        '<div class="skeleton-grid" data-ms-skeleton>' +
          [...Array(6)].map(() =>
            '<div class="skeleton" aria-hidden="true" style="aspect-ratio:4/3;border-radius:0.5rem"></div>'
          ).join('') +
        '</div>';
      try {
        const response = await fetch(`/admin/api/page/media?${params.toString()}`, {
          signal: requestController.signal,
          headers: { 'X-CSRF-Token': csrfHeader, 'Accept': 'application/json' },
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        let payload;
        try {
          payload = await response.json();
        } catch {
          const error = new Error('INVALID_JSON');
          error.code = 'INVALID_JSON';
          throw error;
        }

        if (requestSerial !== state.requestSerial) return false;
        renderAssets(payload);
        state.loaded = true;
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        state.loaded = false;
        showLibraryError(
          error?.code === 'INVALID_JSON'
            ? 'No se pudo procesar la respuesta del servidor.'
            : 'No se pudo cargar la biblioteca.'
        );
        return false;
      } finally {
        if (state.requestController === requestController) {
          state.requestController = null;
          state.loading = false;
        }
      }
    }

    function renderAssets(payload = {}) {
      if (Array.isArray(payload.categories)) populateFilters(payload.categories);
      const assets = Array.isArray(payload.assets) ? payload.assets : [];

      grid.innerHTML = '';
      if (assets.length === 0) {
        grid.innerHTML = '<p class="empty-state">No se encontraron archivos.</p>';
        pagination.innerHTML = '';
        return;
      }

      assets.forEach((asset) => {
        const isArchived = Boolean(asset.is_archived || asset.status === 'archived');
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'media-selector__item' +
          (asset.public_id === state.selectedPublicId ? ' is-selected' : '') +
          (isArchived ? ' is-archived' : '');
        card.setAttribute('data-ms-item', asset.public_id);
        card.innerHTML =
          `<div class="media-selector__item-thumb">
            ${(asset.thumbnail_url || asset.thumbnail_path)
              ? `<img src="${escapeHtml(asset.thumbnail_url || asset.thumbnail_path)}" alt="" loading="lazy">`
              : '<span class="media-selector__item-icon">📄</span>'}
          </div>
          <div class="media-selector__item-body">
            <span class="media-selector__item-title">${escapeHtml(asset.title || asset.original_filename || 'Archivo')}</span>
            ${isArchived ? '<span class="media-selector__badge media-selector__badge--archived">Archivado</span>' : ''}
            <span class="media-selector__item-meta">${escapeHtml([asset.category, asset.mime_type].filter(Boolean).join(' · '))}</span>
            ${asset.dimensions ? `<span class="media-selector__item-meta">${escapeHtml(asset.dimensions)}</span>` : ''}
          </div>`;
        card.addEventListener('click', () => selectItem(asset));
        grid.appendChild(card);
      });

      pagination.innerHTML = '';
      const totalPages = Math.max(1, Number(payload.totalPages) || 1);
      for (let page = 1; page <= totalPages; page += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm ' +
          (page === state.currentPage ? 'btn-primary' : 'btn-secondary');
        button.textContent = String(page);
        button.addEventListener('click', () => void loadMedia(page, { force: true }));
        pagination.appendChild(button);
      }
    }

    function populateFilters(categories) {
      if (categoryFilter) {
        const previousCategory = categoryFilter.value;
        categoryFilter.querySelectorAll('option:not(:first-child)').forEach(option => option.remove());
        categories.forEach((category) => {
          const option = document.createElement('option');
          option.value = category;
          option.textContent = category;
          categoryFilter.appendChild(option);
        });
        categoryFilter.value = previousCategory;
      }

      if (typeFilter && allowedTypes.length) {
        const previousType = typeFilter.value;
        typeFilter.querySelectorAll('option:not(:first-child)').forEach(option => option.remove());
        [...new Set(allowedTypes.map(type => type.split('/')[0]))].forEach((type) => {
          const option = document.createElement('option');
          option.value = type;
          option.textContent = type === 'image' ? 'Imágenes' : type === 'model' ? 'Modelos 3D' : type;
          typeFilter.appendChild(option);
        });
        typeFilter.value = previousType;
      }
    }

    function selectItem(asset) {
      state.selectedPublicId = asset.public_id;
      state.selectedAssetData = asset;
      confirmBtn.disabled = !state.selectedPublicId;
      grid.querySelectorAll('[data-ms-item]').forEach(item => {
        item.classList.toggle('is-selected', item.dataset.msItem === state.selectedPublicId);
      });
    }

    function applySelection() {
      if (!state.selectedPublicId) return;
      input.value = `media://${state.selectedPublicId}`;
      updatePreview(state.selectedAssetData || { public_id: state.selectedPublicId });
      notifyChange(state.selectedAssetData || {});
      closeModal('selected');
    }

    function notifyChange(asset) {
      const data = asset && typeof asset === 'object' ? asset : {};
      root.dispatchEvent(new CustomEvent('media-selector:change', {
        bubbles: true,
        detail: {
          fieldName,
          previewUrl: data.public_url || data.url || data.thumbnail_url || data.thumbnail_path || '',
          cleared: !input.value,
        },
      }));
    }

    function updatePreview(asset) {
      const title = asset.title || asset.original_filename || 'Archivo';
      const thumbnail = asset.thumbnail_url || asset.thumbnail_path || '';
      const dimensions = asset.dimensions ||
        (asset.width && asset.height ? `${asset.width}×${asset.height}` : '');
      const metadata = [asset.category, asset.mime_type, dimensions].filter(Boolean).join(' · ');
      const thumbnailHtml = thumbnail
        ? `<img src="${escapeHtml(thumbnail)}" alt="" class="media-selector__thumb-img" data-ms-img>`
        : '<span class="media-selector__thumb-icon" data-ms-icon>📄</span>';

      // Phase 1D: Archived / missing warning
      const isArchived = Boolean(asset.is_archived || asset.status === 'archived');
      const pathInvalid = Boolean(asset.path_contract_valid === false) && !isArchived;
      const warningHtml = isArchived
        ? `<div class="media-archived-warning" role="alert"><strong>Atención:</strong> Este archivo está archivado y no será visible al público. Puedes reemplazarlo o quitar la referencia.</div>`
        : pathInvalid
          ? `<div class="media-archived-warning" role="alert"><strong>Atención:</strong> El archivo no se encuentra disponible. Puedes reemplazarlo o quitar la referencia.</div>`
          : '';

      preview.innerHTML =
        `<div class="media-selector__card" data-ms-card>
          ${warningHtml}
          <div class="media-selector__thumbnail" data-ms-thumb>${thumbnailHtml}</div>
          <div class="media-selector__info">
            <span class="media-selector__title" data-ms-title>${escapeHtml(title)}</span>
            <span class="media-selector__meta" data-ms-meta>${escapeHtml(metadata) || '—'}</span>
          </div>
          <div class="media-selector__actions">
            <button type="button" class="btn btn-secondary btn-sm" data-ms-change>Cambiar</button>
            <button type="button" class="btn btn-danger btn-sm" data-ms-remove>Quitar</button>
          </div>
        </div>`;
    }

    function clearSelection() {
      input.value = '';
      state.selectedPublicId = null;
      state.selectedAssetData = null;
      preview.innerHTML =
        `<div class="media-selector__empty" data-ms-empty>
          <p class="empty-state">Sin ${escapeHtml(kindLabel.toLowerCase())} seleccionado.</p>
          <button type="button" class="btn btn-primary" data-ms-select>Seleccionar desde biblioteca</button>
        </div>`;
      notifyChange(null);
    }

    function handlePreviewClick(event) {
      const openButton = event.target.closest?.('[data-ms-select], [data-ms-change]');
      if (openButton) {
        void openModal({ preventDefault: () => event.preventDefault(), currentTarget: openButton });
        return;
      }
      if (event.target.closest?.('[data-ms-remove]')) {
        event.preventDefault();
        clearSelection();
      }
    }

    function handleFile(file) {
      state.pendingFile = file;
      if (uploadFilename) uploadFilename.textContent = file.name;
      if (uploadFileInfo) uploadFileInfo.style.display = 'flex';
      if (uploadActions) uploadActions.style.display = 'flex';
      resetUploadState();
    }

    function resetUpload() {
      state.pendingFile = null;
      state.uploading = false;
      if (fileInput) fileInput.value = '';
      [uploadFileInfo, uploadProgress, uploadActions, uploadRetry, uploadError].forEach((element) => {
        if (element) element.style.display = 'none';
      });
    }

    function resetUploadState() {
      if (uploadProgress) uploadProgress.style.display = 'none';
      if (uploadError) uploadError.style.display = 'none';
      if (uploadRetry) uploadRetry.style.display = 'none';
      if (uploadBtn) {
        uploadBtn.style.display = '';
        uploadBtn.disabled = false;
      }
    }

    async function performUpload() {
      if (state.uploading) return false;
      if (!state.pendingFile) {
        showUploadError('Debe seleccionar un archivo.');
        return false;
      }
      if (!uploadProfile) {
        showUploadError('Perfil de carga no configurado en este selector.');
        return false;
      }

      const extension = state.pendingFile.name.split('.').pop().toLowerCase();
      const extensionsByMime = {
        'image/jpeg': ['jpg', 'jpeg'],
        'image/png': ['png'],
        'image/webp': ['webp'],
        'image/svg+xml': ['svg'],
        'model/gltf-binary': ['glb'],
        'model/gltf+json': ['gltf'],
        'application/octet-stream': ['glb'],
      };
      const allowedExtensions = allowedTypes.length
        ? [...new Set(allowedTypes.flatMap(type => extensionsByMime[type] || []))]
        : ['jpg', 'jpeg', 'png', 'webp'];
      if (!allowedExtensions.includes(extension)) {
        showUploadError(`Formato no permitido. Use: ${allowedExtensions.join(', ').toUpperCase()}.`);
        return false;
      }
      const maxSizeMb = allowedExtensions.includes('glb') ? 30 : 15;
      if (state.pendingFile.size > maxSizeMb * 1024 * 1024) {
        showUploadError(`El archivo supera el límite de ${maxSizeMb} MB.`);
        return false;
      }

      state.uploading = true;
      if (uploadBtn) uploadBtn.style.display = 'none';
      if (uploadProgress) uploadProgress.style.display = 'block';
      if (uploadError) uploadError.style.display = 'none';
      if (uploadStatus) uploadStatus.textContent = 'Procesando…';

      const formData = new FormData();
      formData.append('file', state.pendingFile);
      formData.append('profile', uploadProfile);
      formData.append('_csrf', csrfToken);

      try {
        const response = await fetch('/admin/api/page/media/upload', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfHeader, 'Accept': 'application/json' },
          credentials: 'same-origin',
          body: formData,
        });
        const payload = await response.json();
        if (!response.ok || !payload.success || !payload.asset) {
          showUploadError(payload.error || 'Error al subir el archivo.');
          return false;
        }

        input.value = `media://${payload.asset.public_id}`;
        updatePreview(payload.asset);
        notifyChange(payload.asset);
        if (uploadStatus) uploadStatus.textContent = 'Completado';
        closeModal('uploaded');
        return true;
      } catch {
        showUploadError('Error de conexión. Intente de nuevo.');
        return false;
      } finally {
        state.uploading = false;
      }
    }

    function showUploadError(message) {
      if (uploadError) {
        uploadError.textContent = message;
        uploadError.style.display = 'block';
      }
      if (uploadProgress) uploadProgress.style.display = 'none';
      if (uploadBtn) uploadBtn.style.display = '';
      if (uploadRetry) uploadRetry.style.display = '';
    }

    function showLibraryError(message) {
      grid.innerHTML = `<p class="empty-state" role="alert">${escapeHtml(message)}</p>`;
      pagination.innerHTML = '';
    }

    function escapeHtml(value) {
      const element = document.createElement('div');
      element.textContent = String(value ?? '');
      return element.innerHTML;
    }

    // ── External load support — allows editor scripts to restore a selection ──
    root.addEventListener('media-selector:load', (event) => {
      const detail = event.detail || {};
      if (!detail.value) return clearSelection();
      input.value = detail.value;
      const asset = {
        public_id: detail.publicId || detail.value.replace(/^media:\/\//, '') || '',
        title: detail.title || '',
        public_url: detail.publicUrl || '',
        thumbnail_url: detail.thumbnailUrl || '',
        mime_type: detail.mimeType || '',
        category: detail.category || '',
        dimensions: detail.dimensions || '',
      };
      updatePreview(asset);
      notifyChange(asset);
    });

    tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.msTab)));
    preview.addEventListener('click', handlePreviewClick);
    confirmBtn.addEventListener('click', applySelection);
    root.querySelector('[data-ms-cancel]')?.addEventListener('click', () => closeModal());
    modal.addEventListener('close', handleClose);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });

    // Search trigger: button click and Enter key (no nested <form> to avoid breaking parent forms)
    searchBtn?.addEventListener('click', () => {
      void loadMedia(1, { force: true });
    });
    searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void loadMedia(1, { force: true });
      }
    });
    searchInput?.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => void loadMedia(1, { force: true }), 300);
    });
    categoryFilter?.addEventListener('change', () => void loadMedia(1, { force: true }));
    typeFilter?.addEventListener('change', () => void loadMedia(1, { force: true }));

    if (uploadZone && fileInput) {
      uploadZone.addEventListener('click', () => fileInput.click());
      uploadZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        uploadZone.classList.add('is-dragover');
      });
      uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('is-dragover'));
      uploadZone.addEventListener('drop', (event) => {
        event.preventDefault();
        uploadZone.classList.remove('is-dragover');
        if (event.dataTransfer.files.length) handleFile(event.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) handleFile(fileInput.files[0]);
      });
    }
    uploadClear?.addEventListener('click', resetUpload);
    uploadBtn?.addEventListener('click', () => void performUpload());
    uploadRetry?.addEventListener('click', () => void performUpload());

    return createPublicController();

    function createPublicController() {
      return {
        root,
        fieldName,
        allowedTypes: [...allowedTypes],
        allowedCategories: [...allowedCategories],
        uploadProfile,
        open: openModal,
        close: closeModal,
        load: loadMedia,
        switchTab,
        select: selectItem,
        applySelection,
        clear: clearSelection,
        handleFile,
        upload: performUpload,
        getState: () => ({
          opening: state.opening,
          loading: state.loading,
          loaded: state.loaded,
          currentPage: state.currentPage,
          selectedPublicId: state.selectedPublicId,
        }),
      };
    }
  }

  function splitList(value = '') {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }

  const api = {
    version: 1,
    init: initMediaSelectors,
    getController: root => controllers.get(root),
  };
  window.NLMediaSelector = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initMediaSelectors(), { once: true });
  } else {
    initMediaSelectors();
  }
})();
