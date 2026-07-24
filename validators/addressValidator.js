const { CR_PROVINCES } = require('../config/checkoutOptions');

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
const PHONE_INPUT_RE = /^[+\d\s().-]*$/;

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateRequiredText(value, field, maxLength) {
  const cleaned = cleanText(value);
  if (!cleaned) return { error: `${field} es obligatorio.`, value: cleaned };
  if (cleaned.length > maxLength) {
    return { error: `${field} no puede superar ${maxLength} caracteres.`, value: cleaned };
  }
  if (CONTROL_CHARS_RE.test(cleaned)) {
    return { error: `${field} contiene caracteres no válidos.`, value: cleaned };
  }
  return { value: cleaned };
}

function validateAddress(input = {}) {
  const errors = {};
  const label = validateRequiredText(input.label, 'La etiqueta', 60);
  const canton = validateRequiredText(input.canton, 'El cantón', 80);
  const district = validateRequiredText(input.district, 'El distrito', 80);
  const addressLine = validateRequiredText(input.addressLine, 'La dirección exacta', 300);
  const province = cleanText(input.province);
  const addressReference = cleanText(input.addressReference);
  const contactPhoneDisplay = cleanText(input.contactPhone);

  if (label.error) errors.label = label.error;
  if (!CR_PROVINCES.includes(province)) errors.province = 'Selecciona una provincia válida.';
  if (canton.error) errors.canton = canton.error;
  if (district.error) errors.district = district.error;
  if (addressLine.error) errors.addressLine = addressLine.error;
  if (addressReference.length > 200) {
    errors.addressReference = 'Las referencias no pueden superar 200 caracteres.';
  } else if (CONTROL_CHARS_RE.test(addressReference)) {
    errors.addressReference = 'Las referencias contienen caracteres no válidos.';
  }

  let contactPhone = null;
  if (contactPhoneDisplay) {
    if (!PHONE_INPUT_RE.test(contactPhoneDisplay)) {
      errors.contactPhone = 'Ingresa un teléfono válido.';
    } else {
      contactPhone = contactPhoneDisplay.replace(/\D/g, '');
      if (contactPhone.length < 8 || contactPhone.length > 15) {
        errors.contactPhone = 'El teléfono debe contener entre 8 y 15 dígitos.';
      }
    }
  }

  let isDefault = false;
  if (input.isDefault !== undefined) {
    if (input.isDefault !== '1') errors.isDefault = 'La selección predeterminada no es válida.';
    else isDefault = true;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: {
      label: label.value,
      province,
      canton: canton.value,
      district: district.value,
      addressLine: addressLine.value,
      addressReference: addressReference || null,
      contactPhone,
      isDefault,
    },
    displayValues: {
      label: label.value,
      province,
      canton: canton.value,
      district: district.value,
      addressLine: addressLine.value,
      addressReference,
      contactPhone: contactPhoneDisplay,
      isDefault,
    },
  };
}

function parsePositiveId(value) {
  const raw = String(value || '');
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

module.exports = { validateAddress, parsePositiveId };
