/**
 * Testimonial validator — Phase 2D.
 * Allowlist platforms, required text/name, sensible limits,
 * optional safe URL, bounded rating, media reference validation.
 */
const MAX_NAME = 200;
const MAX_TEXT = 1000;
const MAX_SOURCE_URL = 2048;
const ALLOWED_PLATFORMS = ['instagram', 'facebook', 'google', 'tripadvisor', 'other'];
const MIN_RATING = 1;
const MAX_RATING = 5;

function h(str) { return String(str || '').trim(); }

function validateDisplayName(value) {
  const v = h(value);
  if (!v) return { valid: false, error: 'El nombre del cliente es obligatorio.' };
  if (v.length > MAX_NAME) return { valid: false, error: `El nombre no puede exceder ${MAX_NAME} caracteres.` };
  return { valid: true, value: v };
}

function validateTestimonialText(value) {
  const v = String(value || '').trim();
  if (!v) return { valid: false, error: 'El texto del testimonio es obligatorio.' };
  if (v.length > MAX_TEXT) return { valid: false, error: `El testimonio no puede exceder ${MAX_TEXT} caracteres.` };
  return { valid: true, value: v };
}

function validatePlatform(value) {
  const v = h(value).toLowerCase();
  if (!v || !ALLOWED_PLATFORMS.includes(v)) return { valid: false, error: 'Plataforma no válida.' };
  return { valid: true, value: v };
}

function validateSourceUrl(value) {
  const v = h(value);
  if (!v) return { valid: true, value: '' };
  if (v.length > MAX_SOURCE_URL) return { valid: false, error: `La URL no puede exceder ${MAX_SOURCE_URL} caracteres.` };
  try {
    const parsed = new URL(v);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { valid: false, error: 'La URL debe ser HTTP o HTTPS.' };
    if (parsed.username || parsed.password) return { valid: false, error: 'La URL no debe contener credenciales.' };
    return { valid: true, value: parsed.href };
  } catch {
    return { valid: false, error: 'URL inválida.' };
  }
}

function validateRating(value) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '' || raw === null || raw === undefined) return { valid: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_RATING || n > MAX_RATING) {
    return { valid: false, error: `La calificación debe ser un entero entre ${MIN_RATING} y ${MAX_RATING}.` };
  }
  return { valid: true, value: n };
}

function validateAvatarMediaRef(ref) {
  if (!ref) return { valid: true, value: '' };
  if (!ref.startsWith('media://')) return { valid: false, error: 'Referencia de medio inválida.' };
  const publicId = ref.replace('media://', '');
  if (!/^[0-9a-f-]{32,36}$/i.test(publicId)) return { valid: false, error: 'ID de medio inválido.' };
  return { valid: true, value: ref };
}

function validateTestimonialInput(body) {
  const errors = [];

  const nameResult = validateDisplayName(body.displayName);
  if (!nameResult.valid) errors.push(nameResult.error);

  const textResult = validateTestimonialText(body.testimonialText);
  if (!textResult.valid) errors.push(textResult.error);

  const platformResult = validatePlatform(body.platform);
  if (!platformResult.valid) errors.push(platformResult.error);

  const urlResult = validateSourceUrl(body.sourceUrl);
  if (!urlResult.valid) errors.push(urlResult.error);

  const ratingResult = validateRating(body.rating);
  if (!ratingResult.valid) errors.push(ratingResult.error);

  const avatarResult = validateAvatarMediaRef(h(body.avatarMediaRef));
  if (!avatarResult.valid) errors.push(avatarResult.error);

  return {
    valid: errors.length === 0,
    errors,
    sanitized: {
      displayName: nameResult.valid ? nameResult.value : h(body.displayName),
      testimonialText: textResult.valid ? textResult.value : h(body.testimonialText),
      platform: platformResult.valid ? platformResult.value : h(body.platform),
      sourceUrl: urlResult.valid ? urlResult.value : h(body.sourceUrl),
      rating: ratingResult.valid ? ratingResult.value : null,
      avatarMediaRef: avatarResult.valid ? avatarResult.value : h(body.avatarMediaRef),
      isActive: body.isActive === '0' || body.isActive === 'false' ? 0 : 1,
      isFeatured: body.isFeatured === '1' || body.isFeatured === 'true' ? 1 : 0,
    },
  };
}

module.exports = {
  ALLOWED_PLATFORMS,
  MAX_NAME,
  MAX_TEXT,
  MAX_SOURCE_URL,
  MIN_RATING,
  MAX_RATING,
  validateTestimonialInput,
  validateDisplayName,
  validateTestimonialText,
  validatePlatform,
  validateSourceUrl,
  validateRating,
  validateAvatarMediaRef,
};
