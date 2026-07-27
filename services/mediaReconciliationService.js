const pool = require('../config/db');
const storage = require('./mediaStorageService');

const CLASSIFICATIONS = Object.freeze({
  VALID: 'valid',
  MISSING_ORIGINAL: 'missing_original',
  MISSING_DERIVATIVE: 'missing_thumbnail_or_variant',
  INVALID_PATH: 'invalid_stored_path',
  RECOVERABLE_LEGACY: 'recoverable_legacy_path',
});

async function inspectAsset(row) {
  const issues = [];
  let resolved;
  try {
    resolved = storage.resolvedAssetPaths(row);
  } catch {
    return {
      publicId: row.public_id,
      title: row.title || null,
      originalName: row.original_name || null,
      status: row.status,
      category: row.category,
      classification: CLASSIFICATIONS.INVALID_PATH,
      issues: ['La ruta almacenada no pertenece al contrato permitido.'],
      canonicalStoragePath: null,
      canonicalPublicUrl: null,
      requiresReupload: true,
    };
  }

  const originalExists = await storage.storedPathExists(resolved.storagePath);
  if (!originalExists) issues.push('Falta el archivo original.');

  const variants = storage.parseVariants(row.variants_json);
  const missingDerivatives = [];
  for (const [name, variant] of Object.entries(variants)) {
    if (!variant?.storage_path || !(await storage.storedPathExists(variant.storage_path))) {
      missingDerivatives.push(name);
    }
  }
  if (resolved.thumbnailStoragePath && !(await storage.storedPathExists(resolved.thumbnailStoragePath))) {
    if (!missingDerivatives.includes('thumbnail')) missingDerivatives.push('thumbnail');
  }
  if (missingDerivatives.length) {
    issues.push(`Faltan derivados: ${missingDerivatives.join(', ')}.`);
  }

  const urlDrift = row.public_url !== resolved.publicUrl ||
    Boolean(row.thumbnail_path) !== Boolean(resolved.thumbnailUrl) ||
    (row.thumbnail_path && row.thumbnail_path !== resolved.thumbnailUrl);
  if (urlDrift) issues.push('Las URL guardadas no coinciden con la ruta canónica.');

  let classification = CLASSIFICATIONS.VALID;
  if (!originalExists) classification = CLASSIFICATIONS.MISSING_ORIGINAL;
  else if (missingDerivatives.length) classification = CLASSIFICATIONS.MISSING_DERIVATIVE;
  else if (resolved.isLegacy || urlDrift) classification = CLASSIFICATIONS.RECOVERABLE_LEGACY;

  return {
    publicId: row.public_id,
    title: row.title || null,
    originalName: row.original_name || null,
    status: row.status,
    category: row.category,
    classification,
    issues,
    canonicalStoragePath: resolved.storagePath,
    canonicalPublicUrl: resolved.publicUrl,
    requiresReupload: classification === CLASSIFICATIONS.MISSING_ORIGINAL,
  };
}

async function buildReport({ limit = 500 } = {}) {
  const bounded = Math.min(2000, Math.max(1, Number(limit) || 500));
  const [rows] = await pool.query(
    `SELECT public_id, title, original_name, status, category, storage_path, public_url,
            thumbnail_path, variants_json
       FROM media_assets
      ORDER BY id ASC
      LIMIT ?`,
    [bounded]
  );
  const assets = [];
  for (const row of rows) assets.push(await inspectAsset(row));

  const counts = {};
  for (const value of Object.values(CLASSIFICATIONS)) counts[value] = 0;
  for (const asset of assets) counts[asset.classification] += 1;
  return {
    scanned: assets.length,
    truncated: rows.length === bounded,
    counts,
    assets,
  };
}

module.exports = {
  CLASSIFICATIONS,
  inspectAsset,
  buildReport,
};
