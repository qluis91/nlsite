/**
 * Canonical site brand normalization.
 * Known placeholder / legacy names never render publicly.
 */
const CANONICAL_SITE_NAME = 'NinjaLabCR';

const LEGACY_SITE_NAMES = Object.freeze([
  'Mi Sitio',
  'Mi Sitio Web',
  'NinjaLab CR',
]);

function normalizeSiteName(value) {
  const raw = String(value || '').trim();
  if (!raw || LEGACY_SITE_NAMES.includes(raw)) {
    return CANONICAL_SITE_NAME;
  }
  return raw;
}

module.exports = {
  CANONICAL_SITE_NAME,
  LEGACY_SITE_NAMES,
  normalizeSiteName,
};
