/**
 * Visual media selector — vanilla JS for Phase 11C + 11C-S.
 * Attaches to every [data-media-selector] element on the page.
 * Supports library browsing and direct device upload.
 */
(function () {
  'use strict';

  document.querySelectorAll('[data-media-selector]').forEach(initSelector);

  function initSelector(root) {
    const fieldName = root.dataset.fieldName;
    const allowedTypes = (root.dataset.allowedTypes || '').split(',').filter(Boolean);
    const allowedCategories = (root.dataset.allowedCategories || '').split(',').filter(Boolean);
    const uploadProfile = root.dataset.uploadProfile || '';
    const kindLabel = root.dataset.kindLabel || 'Archivo';
    if (!fieldName) {
      console.warn('Media selector: missing required fieldName.');
    }

    const preview = root.querySelector('[data-ms-preview]');
    const input = root.querySelector('[data-ms-input]');
    const modal = root.querySelector('[data-ms-modal]');
    const grid = root.querySelector('[data-ms-grid]');
    const pagination = root.querySelector('[data-ms-pagination]');
    const searchInput = root.querySelector('[data-ms-search]');
    const categoryFilter = root.querySelector('[data-ms-category-filter]');
    const typeFilter = root.querySelector('[data-ms-type-filter]');
    const confirmBtn = root.querySelector('[data-ms-confirm]');
    const searchForm = root.querySelector('[data-ms-search-form]');
    const csrfToken = document.querySelector('input[name="_csrf"]')?.value || '';
    const csrfHeader = document.querySelector('meta[name="csrf-token"]')?.content || csrfToken;

    // Upload elements
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

    let selectedPublicId = null;
    let selectedAssetData = null;
    let currentPage = 1;
    let pendingFile = null;

    // ── Tab switching ──
    function switchTab(tabName) {
      tabs.forEach(t => t.classList.toggle('is-active', t.dataset.msTab === tabName));
      panels.forEach(p => p.classList.toggle('is-active', p.dataset.msPanel === tabName));
      if (tabName === 'library') loadMedia();
    }

    tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.msTab)));

    // ── File input & drag-drop ──
    if (uploadZone && fileInput) {
      uploadZone.addEventListener('click', () => fileInput.click());
      uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('is-dragover'); });
      uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('is-dragover'));
      uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('is-dragover');
        const files = e.dataTransfer.files;
        if (files.length) handleFile(files[0]);
      });
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) handleFile(fileInput.files[0]);
      });
    }

    uploadClear?.addEventListener('click', resetUpload);

    function handleFile(file) {
      pendingFile = file;
      uploadFilename.textContent = file.name;
      uploadFileInfo.style.display = 'flex';
      uploadActions.style.display = 'flex';
      uploadRetry.style.display = 'none';
      uploadError.style.display = 'none';
      uploadProgress.style.display = 'none';
      resetUploadState();
    }

    function resetUpload() {
      pendingFile = null;
      if (fileInput) fileInput.value = '';
      uploadFileInfo.style.display = 'none';
      uploadProgress.style.display = 'none';
      uploadActions.style.display = 'none';
      uploadRetry.style.display = 'none';
      uploadError.style.display = 'none';
    }

    function resetUploadState() {
      uploadProgress.style.display = 'none';
      uploadError.style.display = 'none';
      uploadRetry.style.display = 'none';
      uploadBtn.style.display = '';
      uploadBtn.disabled = false;
    }

    // ── Upload ──
    uploadBtn?.addEventListener('click', performUpload);
    uploadRetry?.addEventListener('click', performUpload);

    async function performUpload() {
      if (!pendingFile) {
        showUploadError('Debe seleccionar un archivo.');
        return;
      }
      if (!uploadProfile) {
        showUploadError('Perfil de carga no configurado en este selector.');
        return;
      }

      // Client-side validation
      const ext = pendingFile.name.split('.').pop().toLowerCase();
      const extensionsByMime = {
        'image/jpeg': ['jpg', 'jpeg'],
        'image/png': ['png'],
        'image/webp': ['webp'],
        'image/svg+xml': ['svg'],
        'model/gltf-binary': ['glb'],
        'model/gltf+json': ['gltf'],
        'application/octet-stream': ['glb'],
      };
      const allowedExts = allowedTypes.length
        ? [...new Set(allowedTypes.flatMap(type => extensionsByMime[type] || []))]
        : ['jpg', 'jpeg', 'png', 'webp'];
      if (!allowedExts.includes(ext)) {
        showUploadError(`Formato no permitido. Use: ${allowedExts.join(', ').toUpperCase()}.`);
        return;
      }
      const maxSizeMb = allowedExts.includes('glb') ? 30 : 15;
      if (pendingFile.size > maxSizeMb * 1024 * 1024) {
        showUploadError(`El archivo supera el límite de ${maxSizeMb} MB.`);
        return;
      }

      uploadBtn.style.display = 'none';
      uploadProgress.style.display = 'block';
      uploadError.style.display = 'none';
      uploadStatus.textContent = 'Procesando…';

      const formData = new FormData();
      formData.append('file', pendingFile);
      formData.append('profile', uploadProfile);
      formData.append('_csrf', csrfToken);

      try {
        const res = await fetch('/admin/api/page/media/upload', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfHeader, 'Accept': 'application/json' },
          credentials: 'same-origin',
          body: formData,
        });

        const data = await res.json();

        if (!data.success) {
          showUploadError(data.error || 'Error al subir la imagen.');
          return;
        }

        uploadStatus.textContent = 'Completado';
        uploadProgress.style.display = 'none';
        uploadActions.style.display = 'none';

        // Auto-select the new asset
        selectedPublicId = data.asset.public_id;
        selectedAssetData = data.asset;
        input.value = 'media://' + data.asset.public_id;

        updatePreview(data.asset);
        modal.close();
        resetUpload();
      } catch (e) {
        showUploadError('Error de conexión. Intente de nuevo.');
      }
    }

    function showUploadError(msg) {
      uploadError.textContent = msg;
      uploadError.style.display = 'block';
      uploadProgress.style.display = 'none';
      uploadBtn.style.display = '';
      uploadRetry.style.display = '';
    }

    // ── Library browsing ──
    function populateFilters(categories) {
      if (categoryFilter) {
        categoryFilter.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
        categories.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c;
          opt.textContent = c;
          categoryFilter.appendChild(opt);
        });
      }
      if (typeFilter && allowedTypes.length) {
        typeFilter.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
        const uniqueTypes = [...new Set(allowedTypes.map(t => t.split('/')[0]))];
        uniqueTypes.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t;
          opt.textContent = t === 'image' ? 'Imágenes' : t === 'model' ? 'Modelos 3D' : t;
          typeFilter.appendChild(opt);
        });
      }
    }

    async function loadMedia(page = 1) {
      currentPage = page;
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

      grid.innerHTML = '<p class="empty-state">Cargando…</p>';
      try {
        const res = await fetch(`/admin/api/page/media?${params.toString()}`, {
          headers: { 'X-CSRF-Token': csrfHeader, 'Accept': 'application/json' },
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error('Error al cargar');
        const data = await res.json();

        if (Array.isArray(data.categories)) populateFilters(data.categories);

        if (!data.assets || data.assets.length === 0) {
          grid.innerHTML = '<p class="empty-state">No se encontraron archivos.</p>';
          pagination.innerHTML = '';
          return;
        }

        grid.innerHTML = '';
        data.assets.forEach(asset => {
          const card = document.createElement('div');
          card.className = 'media-selector__item' + (asset.public_id === selectedPublicId ? ' is-selected' : '');
          card.setAttribute('data-ms-item', asset.public_id);
          card.innerHTML =
            `<div class="media-selector__item-thumb">
              ${asset.thumbnail_url ? `<img src="${asset.thumbnail_url}" alt="" loading="lazy">` : '<span class="media-selector__item-icon">📄</span>'}
            </div>
            <div class="media-selector__item-body">
              <span class="media-selector__item-title">${escapeHtml(asset.title || asset.original_filename)}</span>
              <span class="media-selector__item-meta">${asset.category || ''} · ${asset.mime_type || ''}</span>
              ${asset.dimensions ? `<span class="media-selector__item-meta">${asset.dimensions}</span>` : ''}
            </div>`;

          card.addEventListener('click', () => selectItem(asset));
          grid.appendChild(card);
        });

        // Pagination
        if (data.totalPages > 1) {
          pagination.innerHTML = '';
          for (let p = 1; p <= data.totalPages; p++) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm ' + (p === currentPage ? 'btn-primary' : 'btn-secondary');
            btn.textContent = p;
            btn.type = 'button';
            btn.addEventListener('click', () => loadMedia(p));
            pagination.appendChild(btn);
          }
        } else {
          pagination.innerHTML = '';
        }
      } catch (e) {
        grid.innerHTML = '<p class="empty-state">Error al cargar archivos.</p>';
      }
    }

    function selectItem(asset) {
      selectedPublicId = asset.public_id;
      selectedAssetData = asset;
      confirmBtn.disabled = !selectedPublicId;
      grid.querySelectorAll('[data-ms-item]').forEach(el =>
        el.classList.toggle('is-selected', el.dataset.msItem === selectedPublicId)
      );
    }

    function updatePreview(assetData) {
      const title = assetData.title || assetData.original_filename || 'Archivo';
      const thumbUrl = assetData.thumbnail_url || assetData.thumbnail_path || '';
      const meta = [assetData.category, assetData.mime_type].filter(Boolean).join(' · ');
      const dims = assetData.width && assetData.height ? `${assetData.width}×${assetData.height}` : '';
      const fullMeta = [meta, dims].filter(Boolean).join(' · ');

      const thumbHtml = thumbUrl
        ? `<img src="${escapeHtml(thumbUrl)}" alt="" class="media-selector__thumb-img" data-ms-img>`
        : '<span class="media-selector__thumb-icon" data-ms-icon>📄</span>';

      preview.innerHTML =
        `<div class="media-selector__card" data-ms-card>
          <div class="media-selector__thumbnail" data-ms-thumb>${thumbHtml}</div>
          <div class="media-selector__info">
            <span class="media-selector__title" data-ms-title>${escapeHtml(title)}</span>
            <span class="media-selector__meta" data-ms-meta>${escapeHtml(fullMeta) || '—'}</span>
          </div>
          <div class="media-selector__actions">
            <button type="button" class="btn btn-secondary btn-sm" data-ms-change>Cambiar</button>
            <button type="button" class="btn btn-danger btn-sm" data-ms-remove>Quitar</button>
          </div>
        </div>`;
      rebindActions();
    }

    function applySelection() {
      if (!selectedPublicId) return;
      input.value = 'media://' + selectedPublicId;
      if (selectedAssetData) {
        updatePreview(selectedAssetData);
      } else {
        // Fallback from library grid
        const selectedCard = grid.querySelector(`[data-ms-item="${selectedPublicId}"]`);
        const title = selectedCard?.querySelector('.media-selector__item-title')?.textContent || 'Archivo';
        const thumbHtml = selectedCard?.querySelector('img')?.outerHTML || '<span class="media-selector__thumb-icon">📄</span>';
        const meta = selectedCard?.querySelector('.media-selector__item-meta')?.textContent || '';

        preview.innerHTML =
          `<div class="media-selector__card" data-ms-card>
            <div class="media-selector__thumbnail" data-ms-thumb>${thumbHtml}</div>
            <div class="media-selector__info">
              <span class="media-selector__title" data-ms-title>${escapeHtml(title)}</span>
              <span class="media-selector__meta" data-ms-meta>${escapeHtml(meta)}</span>
            </div>
            <div class="media-selector__actions">
              <button type="button" class="btn btn-secondary btn-sm" data-ms-change>Cambiar</button>
              <button type="button" class="btn btn-danger btn-sm" data-ms-remove>Quitar</button>
            </div>
          </div>`;
        rebindActions();
      }
      modal.close();
    }

    function clearSelection() {
      input.value = '';
      selectedPublicId = null;
      selectedAssetData = null;
      preview.innerHTML =
        `<div class="media-selector__empty" data-ms-empty>
          <p class="empty-state">Sin ${kindLabel} seleccionado.</p>
          <button type="button" class="btn btn-primary" data-ms-select>Seleccionar desde biblioteca</button>
        </div>`;
      rebindActions();
    }

    function rebindActions() {
      const changeBtn = preview.querySelector('[data-ms-change]');
      const removeBtn = preview.querySelector('[data-ms-remove]');
      const selectBtn = preview.querySelector('[data-ms-select]');

      changeBtn?.addEventListener('click', () => {
        selectedPublicId = null;
        confirmBtn.disabled = true;
        switchTab('library');
        modal.showModal();
      });
      removeBtn?.addEventListener('click', clearSelection);
      selectBtn?.addEventListener('click', () => {
        selectedPublicId = null;
        confirmBtn.disabled = true;
        switchTab('library');
        modal.showModal();
      });
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // Initial bind
    rebindActions();

    // Modal events
    modal.addEventListener('close', () => { selectedPublicId = null; confirmBtn.disabled = true; resetUpload(); });
    confirmBtn.addEventListener('click', applySelection);
    root.querySelector('[data-ms-cancel]')?.addEventListener('click', () => modal.close());

    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        loadMedia(1);
      });
    }

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.close();
    });

    // Escape closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.open) {
        modal.close();
      }
    });
  }
})();
