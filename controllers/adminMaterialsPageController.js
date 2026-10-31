const publishing = require('../services/cmsPublishingService');
const publicationService = require('../services/publicationService');
const mediaService = require('../services/mediaService');
const { generateToken } = require('../config/csrf');
const { DEFAULT_MATERIALS_CONTENT } = require('../scripts/migrate-materials-page-cms');
const { ALLOWED_ICONS, normalizeIconKey } = require('../services/materialsIconService');

const ADMIN_PATH = '/admin/page/materiales';
const MODULE_KEY = 'materiales.materials-content';
const MEDIA_REFERENCE =
  /^media:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value, max) {
  return String(value || '')
    .trim()
    .slice(0, max);
}

function checkbox(value) {
  return value === '1' || value === 'true' || value === true || value === 'on';
}

function safeUrl(value) {
  const raw = text(value, 500);
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function mediaReference(value, errors, label) {
  const ref = text(value, 100);
  if (!ref) return '';
  if (!MEDIA_REFERENCE.test(ref)) {
    errors.push(`${label} debe seleccionarse desde la Biblioteca multimedia.`);
    return ref;
  }
  return ref;
}

function slugify(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function normalizeStringList(raw, maxItems, maxLen) {
  const lines = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
  const out = [];
  for (const line of lines) {
    const cleaned = String(line || '')
      .trim()
      .slice(0, maxLen);
    if (!cleaned) continue;
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

function collectMaterialIndexes(body) {
  const indexes = new Set();
  Object.keys(body || {}).forEach((key) => {
    const match = /^material_(\d+)_/.exec(key);
    if (match) indexes.add(Number(match[1]));
  });
  return Array.from(indexes).sort((a, b) => a - b);
}

function validateMaterialsPage(body) {
  const errors = [];
  const heroTitle = text(body.heroTitle, 160);
  if (!heroTitle) errors.push('El título principal es obligatorio.');

  const rawCanonical = text(body.seoCanonical, 500);
  const canonical = safeUrl(rawCanonical);
  if (rawCanonical && !canonical) {
    errors.push('La URL canónica debe ser interna o HTTP(S).');
  }

  const indexes = collectMaterialIndexes(body);
  const items = [];
  const seenIds = new Set();

  indexes.forEach((index, position) => {
    const title = text(body[`material_${index}_title`], 160);
    const rawId = text(body[`material_${index}_id`], 64);
    const id = slugify(rawId || title) || `material-${position + 1}`;
    if (!title) {
      errors.push(`El material #${position + 1} requiere un nombre.`);
    }
    if (seenIds.has(id)) {
      errors.push(`El ID de material «${id}» está duplicado.`);
    }
    seenIds.add(id);

    const iconRaw = text(body[`material_${index}_icon`], 32).toLowerCase();
    if (iconRaw && !ALLOWED_ICONS.includes(iconRaw)) {
      errors.push(`El icono «${iconRaw}» no es válido para ${title || id}.`);
    }

    const rawOrder = Number.parseInt(body[`material_${index}_order`], 10);
    const order =
      Number.isInteger(rawOrder) && rawOrder >= 0 && rawOrder <= 9999
        ? rawOrder
        : (position + 1) * 10;
    if (
      body[`material_${index}_order`] &&
      (!Number.isInteger(rawOrder) || rawOrder < 0 || rawOrder > 9999)
    ) {
      errors.push(`El orden de ${title || id} debe estar entre 0 y 9999.`);
    }

    items.push({
      id,
      title: title || id,
      icon: normalizeIconKey(iconRaw || 'cube'),
      description: text(body[`material_${index}_description`], 900),
      pros: normalizeStringList(body[`material_${index}_pros`], 12, 180),
      cons: normalizeStringList(body[`material_${index}_cons`], 12, 180),
      visible: checkbox(body[`material_${index}_visible`]),
      order,
    });
  });

  if (!items.length) {
    errors.push('Agregá al menos un material.');
  }

  const value = {
    isVisible: checkbox(body.isVisible),
    hero: {
      eyebrow: text(body.heroEyebrow, 120),
      title: heroTitle,
      description: text(body.heroDescription, 1000),
    },
    items,
    seo: {
      title: text(body.seoTitle, 160),
      description: text(body.seoDescription, 320),
      canonical: canonical || rawCanonical || '/materiales',
      ogMedia: mediaReference(body.seoOgMedia, errors, 'La imagen Open Graph'),
    },
    accessibility: { ariaLabel: text(body.ariaLabel, 180) },
  };

  return { value, errors };
}

async function resolveAdminMedia(reference) {
  if (!MEDIA_REFERENCE.test(String(reference || ''))) return null;
  try {
    return await mediaService.getByPublicId(reference.slice('media://'.length));
  } catch {
    return null;
  }
}

async function validateNewMediaReferences(content) {
  const stored = await publishing.getSectionDraft('materiales', 'materials-content');
  const storedRef = stored?.content?.seo?.ogMedia || '';
  const errors = [];
  const reference = content?.seo?.ogMedia;
  if (!reference || reference === storedRef || !MEDIA_REFERENCE.test(reference)) return errors;
  const asset = await mediaService.getByPublicId(reference.slice('media://'.length)).catch(() => null);
  if (!asset || asset.status !== 'active' || asset.deleted_at) {
    errors.push('Los medios nuevos deben seleccionarse desde la Biblioteca multimedia y estar activos.');
  }
  return errors;
}

async function renderEditor(req, res, overrides = {}) {
  const stored = await publishing.getSectionDraft('materiales', 'materials-content');
  const content = overrides.submittedContent || stored?.content || DEFAULT_MATERIALS_CONTENT;
  const ogRef = content.seo?.ogMedia;
  const mediaByRef = {};
  if (ogRef) {
    mediaByRef[ogRef] = await resolveAdminMedia(ogRef);
  }

  return res.status(overrides.status || 200).render('pages/admin/page/materials', {
    title: 'Página Materiales',
    layout: 'layouts/admin',
    pageStyles: ['/css/admin-page.css'],
    pageScripts: [
      '/js/admin/media-selector.js',
      '/js/admin/cms-editor-state.js',
      '/js/admin/materials-page.js',
    ],
    csrfToken: generateToken(req),
    section: stored || {},
    content,
    mediaByRef,
    allowedIcons: ALLOWED_ICONS,
    editorState: overrides.editorState || null,
    fieldErrors: overrides.fieldErrors || [],
    pageAlerts: overrides.pageAlerts || [],
  });
}

async function showMaterialsPage(req, res, next) {
  try {
    const editorState = req.session?.cms_editor_state || null;
    if (req.session?.cms_editor_state) delete req.session.cms_editor_state;
    return await renderEditor(req, res, { editorState });
  } catch (error) {
    return next(error);
  }
}

async function saveMaterialsPageDraft(req, res, next) {
  const validation = validateMaterialsPage(req.body);
  try {
    if (!validation.errors.length) {
      validation.errors.push(...(await validateNewMediaReferences(validation.value)));
    }
  } catch (error) {
    return next(error);
  }
  if (validation.errors.length) {
    return renderEditor(req, res, {
      status: 422,
      submittedContent: validation.value,
      fieldErrors: validation.errors,
      editorState: 'error',
      pageAlerts: [
        {
          id: 'materials-validation',
          type: 'error',
          title: 'No se pudo guardar el borrador',
          description: validation.errors.join(' '),
          persistent: true,
        },
      ],
    }).catch(next);
  }
  try {
    await publishing.saveSectionDraft('materiales', 'materials-content', validation.value, {}, {
      actorId: req.session?.user?.id || null,
      expectedVersion: req.body.version,
    });
    req.session.success_msg = 'Borrador de la Página Materiales guardado.';
    req.session.cms_editor_state = 'saved';
    return res.redirect(ADMIN_PATH);
  } catch (error) {
    return renderEditor(req, res, {
      status: error.code === 'CMS_VERSION_CONFLICT' ? 409 : 500,
      submittedContent: validation.value,
      fieldErrors: [error.message || 'No fue posible guardar el borrador.'],
      editorState: 'error',
      pageAlerts: [
        {
          id: error.code === 'CMS_VERSION_CONFLICT' ? 'materials-concurrency' : 'materials-save-error',
          type: error.code === 'CMS_VERSION_CONFLICT' ? 'warning' : 'error',
          title: error.code === 'CMS_VERSION_CONFLICT' ? 'El borrador cambió' : 'Error al guardar',
          description: error.message || 'No se modificó el borrador almacenado.',
          persistent: true,
        },
      ],
    }).catch(next);
  }
}

async function publishMaterialsPage(req, res, next) {
  try {
    await publicationService.publishModules([MODULE_KEY], 'module', {
      actorId: req.session?.user?.id || null,
    });
    req.session.success_msg = 'Página Materiales publicada.';
    req.session.cms_editor_state = 'published';
    return res.redirect(ADMIN_PATH);
  } catch (error) {
    if (error.code?.startsWith('ER_')) return next(error);
    req.session.error_msg = error.message || 'No fue posible publicar la Página Materiales.';
    return res.redirect(ADMIN_PATH);
  }
}

module.exports = {
  MEDIA_REFERENCE,
  ADMIN_PATH,
  MODULE_KEY,
  safeUrl,
  slugify,
  normalizeStringList,
  validateMaterialsPage,
  showMaterialsPage,
  saveMaterialsPageDraft,
  publishMaterialsPage,
};
