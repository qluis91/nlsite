const FALLBACK_IMAGE = '/images/social-feed-fallback.svg';
const LOAD_TIMEOUT_MS = 12000;
const ALLOWED_EMBED_ORIGINS = Object.freeze({
  youtube: 'https://www.youtube-nocookie.com',
  tiktok: 'https://www.tiktok.com',
  instagram: 'https://www.instagram.com',
  facebook: 'https://www.facebook.com',
});

function allowedEmbedSource(value, platform) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.origin === ALLOWED_EMBED_ORIGINS[platform];
  } catch {
    return false;
  }
}

function safeOriginalUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function safeThumbnail(value) {
  const candidate = String(value || '');
  return candidate.startsWith('/') && !candidate.startsWith('//')
    ? candidate
    : FALLBACK_IMAGE;
}

export function initSocialEmbedModal(root) {
  const modal = root?.querySelector('[data-social-embed-modal]');
  const dialog = modal?.querySelector('[data-social-embed-dialog]');
  const stage = modal?.querySelector('[data-social-embed-stage]');
  const loading = modal?.querySelector('[data-social-embed-loading]');
  const error = modal?.querySelector('[data-social-embed-error]');
  const fallbackImage = modal?.querySelector('[data-social-embed-fallback-image]');
  const title = modal?.querySelector('[data-social-embed-title]');
  const description = modal?.querySelector('[data-social-embed-description]');
  const fallbackLink = modal?.querySelector('[data-social-embed-fallback-link]');
  const triggers = [...(root?.querySelectorAll('[data-social-embed-open]') || [])];
  if (!modal || !dialog || !stage || !loading || !error || !fallbackLink) {
    return () => {};
  }

  const staticRemovers = [];
  let activeRemovers = [];
  let activeTrigger = null;
  let loadTimer = 0;
  let providerFrame = null;
  let isOpen = false;

  function listen(target, name, handler, options, collection = staticRemovers) {
    target?.addEventListener(name, handler, options);
    collection.push(() => target?.removeEventListener(name, handler, options));
  }

  function clearActiveListeners() {
    activeRemovers.splice(0).forEach((remove) => remove());
  }

  function clearProvider() {
    window.clearTimeout(loadTimer);
    loadTimer = 0;
    if (providerFrame) {
      providerFrame.removeAttribute('src');
      providerFrame.remove();
      providerFrame = null;
    }
    stage.querySelectorAll('[data-social-embed-provider], script[data-social-embed-script]')
      .forEach((node) => node.remove());
  }

  function showError() {
    if (!isOpen) return;
    clearProvider();
    loading.hidden = true;
    error.hidden = false;
    window.NinjaAlerts?.warning?.(
      'No se pudo cargar la publicación. Puede abrir el enlace original.',
      { duration: 5000 },
    );
  }

  function focusableElements() {
    return [...dialog.querySelectorAll(
      'button:not([disabled]), [href], iframe, [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden);
  }

  function onKeydown(event) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements();
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function close({ restoreFocus = true } = {}) {
    if (!isOpen) return;
    const focusTarget = activeTrigger;
    isOpen = false;
    clearActiveListeners();
    clearProvider();
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.removeAttribute('data-platform');
    document.body.classList.remove('is-social-embed-open');
    if (title) title.textContent = '';
    if (description) {
      description.textContent = '';
      description.hidden = true;
    }
    fallbackLink.removeAttribute('href');
    if (fallbackImage) {
      fallbackImage.src = FALLBACK_IMAGE;
      fallbackImage.alt = '';
    }
    activeTrigger = null;
    if (restoreFocus && focusTarget?.isConnected) {
      focusTarget.focus({ preventScroll: true });
    }
  }

  function open(trigger) {
    const platform = trigger.dataset.embedPlatform || '';
    const embedSrc = trigger.dataset.embedSrc || '';
    const originalUrl = safeOriginalUrl(trigger.dataset.originalUrl || trigger.href || '');
    if (!allowedEmbedSource(embedSrc, platform) || !originalUrl) return;
    if (isOpen) close({ restoreFocus: false });

    activeTrigger = trigger;
    isOpen = true;
    modal.dataset.platform = platform;
    modal.dataset.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'true'
      : 'false';
    if (title) title.textContent = trigger.dataset.embedTitle || 'Publicación social';
    if (description) {
      description.textContent = trigger.dataset.embedDescription || '';
      description.hidden = !description.textContent;
    }
    fallbackLink.href = originalUrl;
    if (fallbackImage) {
      fallbackImage.src = safeThumbnail(trigger.dataset.embedThumbnail);
      fallbackImage.alt = trigger.dataset.embedThumbnailAlt || '';
    }
    loading.hidden = false;
    error.hidden = true;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-social-embed-open');

    listen(document, 'keydown', onKeydown, undefined, activeRemovers);
    modal.querySelectorAll('[data-social-embed-close]').forEach((button) => {
      listen(button, 'click', close, undefined, activeRemovers);
    });
    const backdrop = modal.querySelector('[data-social-embed-backdrop]');
    listen(backdrop, 'click', close, undefined, activeRemovers);

    providerFrame = document.createElement('iframe');
    providerFrame.dataset.socialEmbedProvider = platform;
    providerFrame.className = 'social-embed-modal__frame';
    providerFrame.title = trigger.dataset.embedFrameTitle || `Publicación de ${platform}`;
    providerFrame.setAttribute('allowfullscreen', '');
    providerFrame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    providerFrame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    providerFrame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation',
    );
    listen(providerFrame, 'load', () => {
      if (!isOpen) return;
      window.clearTimeout(loadTimer);
      loadTimer = 0;
      loading.hidden = true;
      error.hidden = true;
    }, { once: true }, activeRemovers);
    listen(providerFrame, 'error', showError, { once: true }, activeRemovers);
    providerFrame.src = embedSrc;
    stage.appendChild(providerFrame);
    loadTimer = window.setTimeout(showError, LOAD_TIMEOUT_MS);
    dialog.focus({ preventScroll: true });
  }

  triggers.forEach((trigger) => {
    const onClick = (event) => {
      if (!allowedEmbedSource(trigger.dataset.embedSrc || '', trigger.dataset.embedPlatform || '')) {
        return;
      }
      event.preventDefault();
      open(trigger);
    };
    listen(trigger, 'click', onClick);
  });

  return () => {
    close({ restoreFocus: false });
    clearActiveListeners();
    staticRemovers.splice(0).forEach((remove) => remove());
  };
}
