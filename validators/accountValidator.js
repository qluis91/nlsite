const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
const PHONE_INPUT_RE = /^[+\d\s().-]*$/;

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateProfile(input = {}) {
  const values = {
    name: cleanText(input.name),
    lastName: cleanText(input.lastName),
    phone: cleanText(input.phone),
  };
  const errors = {};

  if (!values.name) errors.name = 'El nombre es obligatorio.';
  else if (values.name.length > 100) errors.name = 'El nombre no puede superar 100 caracteres.';
  else if (CONTROL_CHARS_RE.test(values.name)) errors.name = 'El nombre contiene caracteres no válidos.';

  if (values.lastName.length > 100) errors.lastName = 'Los apellidos no pueden superar 100 caracteres.';
  else if (CONTROL_CHARS_RE.test(values.lastName)) errors.lastName = 'Los apellidos contienen caracteres no válidos.';

  let normalizedPhone = null;
  if (values.phone) {
    if (!PHONE_INPUT_RE.test(values.phone)) {
      errors.phone = 'Ingresa un teléfono válido.';
    } else {
      normalizedPhone = values.phone.replace(/\D/g, '');
      if (normalizedPhone.length < 8 || normalizedPhone.length > 15) {
        errors.phone = 'El teléfono debe contener entre 8 y 15 dígitos.';
      }
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    values: { ...values, phone: normalizedPhone },
    displayValues: values,
    errors,
  };
}

function validatePasswordChange(input = {}) {
  const currentPassword = String(input.currentPassword || '');
  const newPassword = String(input.newPassword || '');
  const confirmPassword = String(input.confirmPassword || '');
  const errors = {};

  if (!currentPassword) errors.currentPassword = 'La contraseña actual es obligatoria.';
  else if (currentPassword.length > 128) errors.currentPassword = 'La contraseña actual no es válida.';

  if (!newPassword) errors.newPassword = 'La nueva contraseña es obligatoria.';
  else if (newPassword.length < 8) errors.newPassword = 'La nueva contraseña debe tener al menos 8 caracteres.';
  else if (newPassword.length > 128) errors.newPassword = 'La nueva contraseña no puede superar 128 caracteres.';

  if (!confirmPassword) errors.confirmPassword = 'Confirma la nueva contraseña.';
  else if (confirmPassword !== newPassword) errors.confirmPassword = 'Las nuevas contraseñas no coinciden.';

  return {
    valid: Object.keys(errors).length === 0,
    values: { currentPassword, newPassword, confirmPassword },
    errors,
  };
}

module.exports = { cleanText, validateProfile, validatePasswordChange };
