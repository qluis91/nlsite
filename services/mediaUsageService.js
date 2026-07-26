/**
 * Media usage/reference service — Phase 11A.
 *
 * Answers two questions for any asset:
 *   • Where is this media asset used?
 *   • Can this media be archived or deleted safely?
 *
 * CMS content references media through a stable token (`media://<public_id>`)
 * so a replaced file never breaks an existing reference. Later phases register
 * their own sources instead of extending this file.
 */
const pool = require('../config/db');

const REFERENCE_SCHEME = 'media://';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildReference(publicId) {
  if (!UUID_PATTERN.test(String(publicId || ''))) {
    throw new Error('Identificador de medio no válido.');
  }
  return `${REFERENCE_SCHEME}${publicId}`;
}

/**
 * Built-in sources. Each returns user-facing locations, never raw SQL rows.
 */
async function findPageSectionUsages(reference) {
  const [rows] = await pool.query(
    `SELECT s.section_key, s.name, p.name AS page_name
       FROM page_sections s
       INNER JOIN pages p ON p.id = s.page_id
      WHERE s.content_json LIKE ? OR s.style_json LIKE ?
      ORDER BY p.name ASC, s.sort_order ASC
      LIMIT 50`,
    [`%${reference}%`, `%${reference}%`]
  );
  return rows.map((row) => ({
    source: 'page_sections',
    label: 'Sección de página',
    location: `${row.page_name} — ${row.name || row.section_key}`,
  }));
}

async function findSiteSettingUsages(reference) {
  const [rows] = await pool.query(
    `SELECT setting_key, setting_group
       FROM site_settings
      WHERE setting_value LIKE ?
      ORDER BY setting_key ASC
      LIMIT 50`,
    [`%${reference}%`]
  );
  return rows.map((row) => ({
    source: 'site_settings',
    label: 'Configuración del sitio',
    location: `${row.setting_group}.${row.setting_key}`,
  }));
}

const usageSources = new Map([
  ['page_sections', findPageSectionUsages],
  ['site_settings', findSiteSettingUsages],
]);

/**
 * Registration hook for later phases (navigation items, logo-loop items,
 * carousel items, feature items, gallery items).
 * @param {string} key
 * @param {(reference: string) => Promise<Array>} finder
 */
function registerUsageSource(key, finder) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('Clave de origen inválida.');
  if (typeof finder !== 'function') throw new Error('El origen de uso debe ser una función.');
  usageSources.set(key, finder);
}

function registeredSources() {
  return [...usageSources.keys()];
}

/**
 * @returns {Promise<Array<{source: string, label: string, location: string}>>}
 */
async function findUsages(publicId) {
  const reference = buildReference(publicId);
  const results = await Promise.all([...usageSources.values()].map((finder) => finder(reference)));
  return results.flat();
}

async function isReferenced(publicId) {
  return (await findUsages(publicId)).length > 0;
}

/**
 * Archiving and physical deletion are both blocked while an asset is
 * referenced, so a live page can never lose its media.
 */
async function assertNotReferenced(publicId, operation = 'archivar') {
  const usages = await findUsages(publicId);
  if (usages.length) {
    const locations = usages.slice(0, 3).map((usage) => usage.location).join(', ');
    const suffix = usages.length > 3 ? ` y ${usages.length - 3} más` : '';
    const error = new Error(`No se puede ${operation}: el archivo está en uso en ${locations}${suffix}.`);
    error.usages = usages;
    throw error;
  }
  return true;
}

module.exports = {
  REFERENCE_SCHEME,
  buildReference,
  registerUsageSource,
  registeredSources,
  findUsages,
  isReferenced,
  assertNotReferenced,
};
