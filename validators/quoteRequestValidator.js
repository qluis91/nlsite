'use strict';

const ALLOWED_TYPES = new Set(['website', '3d', 'other']);
const YES_NO_UNKNOWN = new Set(['yes', 'no', 'unknown', 'Sí', 'No', 'No estoy seguro']);
const WEBSITE_TYPES = new Set([
  'Sitio corporativo', 'Landing page', 'Tienda en línea', 'Portafolio',
  'Catálogo', 'Rediseño de sitio existente', 'Otro', '',
]);
const MATERIALS = new Set(['', 'PLA', 'PETG', 'ABS', 'TPU', 'Resina', 'Sin preferencia']);

function h(v) { return String(v == null ? '' : v).trim(); }

function bounded(value, label, max, { required = false } = {}) {
  const v = h(value);
  if (!v) {
    if (required) return { valid: false, error: `${label} es obligatorio.` };
    return { valid: true, value: '' };
  }
  if (v.length > max) return { valid: false, error: `${label} no puede exceder ${max} caracteres.` };
  return { valid: true, value: v };
}

function emailOk(value) {
  const v = h(value).toLowerCase();
  if (!v) return { valid: false, error: 'El correo electrónico es obligatorio.' };
  if (v.length > 180) return { valid: false, error: 'El correo electrónico es demasiado largo.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { valid: false, error: 'El correo electrónico no es válido.' };
  return { valid: true, value: v };
}

function safeHttpUrl(value, { required = false } = {}) {
  const v = h(value);
  if (!v) {
    if (required) return { valid: false, error: 'La URL es obligatoria.' };
    return { valid: true, value: '' };
  }
  if (v.length > 1000) return { valid: false, error: 'La URL es demasiado larga.' };
  try {
    const parsed = new URL(v);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'La URL debe usar http o https.' };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, error: 'La URL no puede incluir credenciales.' };
    }
    return { valid: true, value: parsed.href };
  } catch {
    return { valid: false, error: 'La URL no es válida.' };
  }
}

function normalizeYesNoUnknown(value) {
  const v = h(value);
  if (!v) return 'unknown';
  const lower = v.toLowerCase();
  if (lower === 'yes' || lower === 'sí' || lower === 'si') return 'yes';
  if (lower === 'no') return 'no';
  return 'unknown';
}

function optionalNumber(value, label, { min = 0, max = 1e7, exclusiveMin = false } = {}) {
  const v = h(value);
  if (!v) return { valid: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n)) return { valid: false, error: `${label} no es un número válido.` };
  if (exclusiveMin ? n <= min : n < min) {
    return { valid: false, error: `${label} debe ser mayor que ${min}.` };
  }
  if (n > max) return { valid: false, error: `${label} está fuera de rango.` };
  return { valid: true, value: n };
}

function requiredNumber(value, label, { min = 0, max = 1e7, exclusiveMin = true } = {}) {
  const v = h(value);
  if (!v) return { valid: false, error: `${label} es obligatorio.`, field: null };
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return { valid: false, error: `${label} no es un número válido.` };
  }
  if (exclusiveMin ? n <= min : n < min) {
    return { valid: false, error: `${label} debe ser mayor que ${min}.` };
  }
  if (n > max) return { valid: false, error: `${label} está fuera de rango.` };
  return { valid: true, value: n };
}

function commonCustomer(body) {
  const name = bounded(body.customer_name || body.name, 'El nombre', 150, { required: true });
  if (!name.valid) return name;
  const email = emailOk(body.customer_email || body.email);
  if (!email.valid) return email;
  const phone = bounded(body.customer_phone || body.phone, 'El teléfono', 80, { required: true });
  if (!phone.valid) return phone;
  return {
    valid: true,
    value: {
      customerName: name.value,
      customerEmail: email.value,
      customerPhone: phone.value,
    },
  };
}

function validateWebsiteQuote(body = {}) {
  const common = commonCustomer(body);
  if (!common.valid) return common;
  const company = bounded(body.company, 'La empresa', 200);
  if (!company.valid) return company;
  const websiteType = bounded(body.website_type || body.websiteType, 'El tipo de sitio', 80);
  if (!websiteType.valid) return websiteType;
  if (websiteType.value && !WEBSITE_TYPES.has(websiteType.value)) {
    return { valid: false, error: 'Tipo de sitio no válido.' };
  }
  const pageCount = optionalNumber(body.page_count || body.pageCount, 'La cantidad de páginas', { min: 0, max: 500 });
  if (!pageCount.valid) return pageCount;
  const budget = bounded(body.budget, 'El presupuesto', 100);
  if (!budget.valid) return budget;
  const desiredDate = bounded(body.desired_date || body.desiredDate, 'La fecha objetivo', 80);
  if (!desiredDate.valid) return desiredDate;
  const description = bounded(body.description, 'La descripción', 5000, { required: true });
  if (!description.valid) return description;

  return {
    valid: true,
    value: {
      requestType: 'website',
      ...common.value,
      subject: websiteType.value || 'Cotización de sitio web',
      payload: {
        company: company.value,
        websiteType: websiteType.value,
        pageCount: pageCount.value,
        hasDomain: normalizeYesNoUnknown(body.has_domain || body.hasDomain),
        hasHosting: normalizeYesNoUnknown(body.has_hosting || body.hasHosting),
        businessEmail: normalizeYesNoUnknown(body.business_email || body.businessEmail),
        ecommerce: normalizeYesNoUnknown(body.ecommerce),
        marketing: normalizeYesNoUnknown(body.marketing),
        budget: budget.value,
        desiredDate: desiredDate.value,
        description: description.value,
      },
    },
  };
}

function validate3dQuote(body = {}) {
  const common = commonCustomer(body);
  if (!common.valid) return { ...common, field: common.field || 'customer_name' };
  const description = bounded(body.description, 'La descripción', 5000, { required: false });
  if (!description.valid) return { ...description, field: 'description' };
  const width = requiredNumber(body.width, 'El ancho', { min: 0, max: 1e6, exclusiveMin: true });
  if (!width.valid) return { ...width, field: 'width' };
  const height = requiredNumber(body.height, 'La altura', { min: 0, max: 1e6, exclusiveMin: true });
  if (!height.valid) return { ...height, field: 'height' };
  const depth = optionalNumber(body.depth, 'La profundidad', { min: 0, max: 1e6, exclusiveMin: true });
  if (!depth.valid) return { ...depth, field: 'depth' };
  const quantity = optionalNumber(body.quantity, 'La cantidad', { min: 1, max: 100000 });
  if (!quantity.valid) return { ...quantity, field: 'quantity' };
  const material = bounded(body.material, 'El material', 40);
  if (!material.valid) return { ...material, field: 'material' };
  if (material.value && !MATERIALS.has(material.value)) {
    return { valid: false, error: 'Material no válido.', field: 'material' };
  }
  const fileLink = safeHttpUrl(body.file_link || body.fileLink);
  if (!fileLink.valid) return { ...fileLink, field: 'file_link' };
  const referenceProduct = bounded(body.reference_product || body.referenceProduct || body.nombre, 'La referencia', 200);
  if (!referenceProduct.valid) return { ...referenceProduct, field: 'reference_product' };
  const referenceId = bounded(body.reference_id || body.referenceId || body.ref, 'El ID de referencia', 80);
  if (!referenceId.valid) return { ...referenceId, field: 'reference_id' };

  return {
    valid: true,
    value: {
      requestType: '3d',
      ...common.value,
      subject: referenceProduct.value
        ? `Pieza 3D: ${referenceProduct.value}`
        : 'Cotización de pieza 3D',
      payload: {
        description: description.value,
        width: width.value,
        depth: depth.value,
        height: height.value,
        quantity: quantity.value == null ? 1 : quantity.value,
        material: material.value === 'Sin preferencia' ? '' : material.value,
        fileLink: fileLink.value,
        referenceProduct: referenceProduct.value,
        referenceId: referenceId.value,
      },
    },
  };
}

function validateOtherQuote(body = {}) {
  const common = commonCustomer(body);
  if (!common.valid) return common;
  const projectType = bounded(body.project_type || body.projectType || body.subject, 'El asunto', 200, { required: true });
  if (!projectType.valid) return projectType;
  const description = bounded(body.description, 'La descripción', 5000, { required: true });
  if (!description.valid) return description;
  const budget = bounded(body.budget, 'El presupuesto', 100);
  if (!budget.valid) return budget;
  const desiredDate = bounded(body.desired_date || body.desiredDate, 'La fecha deseada', 80);
  if (!desiredDate.valid) return desiredDate;

  return {
    valid: true,
    value: {
      requestType: 'other',
      ...common.value,
      subject: projectType.value,
      payload: {
        projectType: projectType.value,
        description: description.value,
        budget: budget.value,
        desiredDate: desiredDate.value,
      },
    },
  };
}

function validateByType(type, body) {
  const t = String(type || '').toLowerCase();
  if (!ALLOWED_TYPES.has(t)) return { valid: false, error: 'Tipo de cotización no válido.' };
  if (t === 'website') return validateWebsiteQuote(body);
  if (t === '3d') return validate3dQuote(body);
  return validateOtherQuote(body);
}

const STATUS_VALUES = Object.freeze(['new', 'in_review', 'responded', 'closed', 'discarded']);

function validateStatus(status) {
  const v = h(status);
  if (!STATUS_VALUES.includes(v)) return { valid: false, error: 'Estado no válido.' };
  return { valid: true, value: v };
}

module.exports = {
  ALLOWED_TYPES,
  STATUS_VALUES,
  YES_NO_UNKNOWN,
  validateWebsiteQuote,
  validate3dQuote,
  validateOtherQuote,
  validateByType,
  validateStatus,
  safeHttpUrl,
  requiredNumber,
  optionalNumber,
};
