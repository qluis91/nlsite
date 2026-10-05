/**
 * Cotización 3D catalog store — MySQL adapter for cost_quote_catalog.
 * API shapes match ninjalab3dcr costQuoteCatalogStore.
 */
const pool = require('../config/db');
const crypto = require('crypto');

const DEFAULT_CATALOG = {
  additionals: [],
  printers: [{ id: 'printer-default', name: 'Impresora principal', hourRate: 300 }],
  materials: [{ id: 'material-default', name: 'PLA estándar', kgPrice: 20500 }],
};

function newId(prefix) {
  return prefix + '-' + crypto.randomBytes(6).toString('hex');
}

function normalizeAdditional(item) {
  return {
    id: String(item.id || newId('add')),
    description: String(item.description || item.name || '').trim(),
    price: Math.max(0, Math.round(Number(item.price) || 0)),
  };
}

function normalizePrinter(item) {
  return {
    id: String(item.id || newId('printer')),
    name: String(item.name || '').trim() || 'Impresora',
    hourRate: Math.max(0, Math.round(Number(item.hourRate != null ? item.hourRate : item.unit_cost) || 0)),
  };
}

function normalizeMaterial(item) {
  return {
    id: String(item.id || newId('material')),
    name: String(item.name || '').trim() || 'Material',
    kgPrice: Math.max(0, Math.round(Number(item.kgPrice != null ? item.kgPrice : item.unit_cost) || 0)),
  };
}

function rowToPrinter(r) {
  return normalizePrinter({ id: r.id, name: r.name, hourRate: r.unit_cost });
}

function rowToMaterial(r) {
  return normalizeMaterial({ id: r.id, name: r.name, kgPrice: r.unit_cost });
}

function rowToAdditional(r) {
  return normalizeAdditional({
    id: r.id,
    description: r.description || r.name,
    price: r.price != null ? r.price : r.unit_cost,
  });
}

async function getCatalog() {
  const [printers] = await pool.query(
    "SELECT * FROM cost_quote_catalog WHERE catalog_type='printer' ORDER BY sort_order, id"
  );
  const [materials] = await pool.query(
    "SELECT * FROM cost_quote_catalog WHERE catalog_type='material' ORDER BY sort_order, id"
  );
  const [additionals] = await pool.query(
    "SELECT * FROM cost_quote_catalog WHERE catalog_type='additional' ORDER BY sort_order, id"
  );

  let mappedPrinters = printers.map(rowToPrinter);
  let mappedMaterials = materials.map(rowToMaterial);
  if (!mappedPrinters.length) mappedPrinters = DEFAULT_CATALOG.printers.map(normalizePrinter);
  if (!mappedMaterials.length) mappedMaterials = DEFAULT_CATALOG.materials.map(normalizeMaterial);

  return {
    printers: mappedPrinters,
    materials: mappedMaterials,
    additionals: additionals.map(rowToAdditional),
  };
}

async function findById(id) {
  const [[row]] = await pool.query('SELECT * FROM cost_quote_catalog WHERE id = ? LIMIT 1', [id]);
  return row || null;
}

async function upsertAdditional(body) {
  const item = normalizeAdditional(body || {});
  if (!item.description) return { ok: false, error: 'Indicá la descripción del adicional.' };
  const editId = String(body.id || '').trim();

  if (editId) {
    const existing = await findById(editId);
    if (!existing || existing.catalog_type !== 'additional') {
      return { ok: false, error: 'Adicional no encontrado.' };
    }
    await pool.query(
      `UPDATE cost_quote_catalog
          SET name = ?, description = ?, price = ?, unit_cost = ?
        WHERE id = ? AND catalog_type = 'additional'`,
      [item.description, item.description, item.price, item.price, editId]
    );
    const catalog = await getCatalog();
    return { ok: true, catalog, item: catalog.additionals.find((a) => a.id === String(editId)) };
  }

  const [result] = await pool.query(
    `INSERT INTO cost_quote_catalog (catalog_type, name, description, price, unit_cost, sort_order)
     VALUES ('additional', ?, ?, ?, ?, 0)`,
    [item.description, item.description, item.price, item.price]
  );
  const catalog = await getCatalog();
  const created = catalog.additionals.find((a) => a.id === String(result.insertId));
  return { ok: true, catalog, item: created };
}

async function deleteAdditional(id) {
  const existing = await findById(id);
  if (!existing || existing.catalog_type !== 'additional') {
    return { ok: false, error: 'Adicional no encontrado.' };
  }
  await pool.query("DELETE FROM cost_quote_catalog WHERE id = ? AND catalog_type = 'additional'", [id]);
  return { ok: true, catalog: await getCatalog() };
}

async function upsertPrinter(body) {
  const item = normalizePrinter(body || {});
  if (!item.name) return { ok: false, error: 'Indicá el nombre de la impresora.' };
  const editId = String(body.id || '').trim();

  if (editId) {
    const existing = await findById(editId);
    if (!existing || existing.catalog_type !== 'printer') {
      return { ok: false, error: 'Impresora no encontrada.' };
    }
    await pool.query(
      `UPDATE cost_quote_catalog
          SET name = ?, unit_cost = ?
        WHERE id = ? AND catalog_type = 'printer'`,
      [item.name, item.hourRate, editId]
    );
    const catalog = await getCatalog();
    return { ok: true, catalog, item: catalog.printers.find((p) => p.id === String(editId)) };
  }

  const [result] = await pool.query(
    `INSERT INTO cost_quote_catalog (catalog_type, name, unit_cost, sort_order)
     VALUES ('printer', ?, ?, 0)`,
    [item.name, item.hourRate]
  );
  const catalog = await getCatalog();
  return { ok: true, catalog, item: catalog.printers.find((p) => p.id === String(result.insertId)) };
}

async function deletePrinter(id) {
  const [[count]] = await pool.query(
    "SELECT COUNT(*) AS total FROM cost_quote_catalog WHERE catalog_type='printer'"
  );
  if (Number(count.total) <= 1) {
    return { ok: false, error: 'Debe quedar al menos una impresora.' };
  }
  const existing = await findById(id);
  if (!existing || existing.catalog_type !== 'printer') {
    return { ok: false, error: 'Impresora no encontrada.' };
  }
  await pool.query("DELETE FROM cost_quote_catalog WHERE id = ? AND catalog_type = 'printer'", [id]);
  return { ok: true, catalog: await getCatalog() };
}

async function upsertMaterial(body) {
  const item = normalizeMaterial(body || {});
  if (!item.name) return { ok: false, error: 'Indicá el nombre del material.' };
  const editId = String(body.id || '').trim();

  if (editId) {
    const existing = await findById(editId);
    if (!existing || existing.catalog_type !== 'material') {
      return { ok: false, error: 'Material no encontrado.' };
    }
    await pool.query(
      `UPDATE cost_quote_catalog
          SET name = ?, unit_cost = ?
        WHERE id = ? AND catalog_type = 'material'`,
      [item.name, item.kgPrice, editId]
    );
    const catalog = await getCatalog();
    return { ok: true, catalog, item: catalog.materials.find((m) => m.id === String(editId)) };
  }

  const [result] = await pool.query(
    `INSERT INTO cost_quote_catalog (catalog_type, name, unit_cost, sort_order)
     VALUES ('material', ?, ?, 0)`,
    [item.name, item.kgPrice]
  );
  const catalog = await getCatalog();
  return { ok: true, catalog, item: catalog.materials.find((m) => m.id === String(result.insertId)) };
}

async function deleteMaterial(id) {
  const [[count]] = await pool.query(
    "SELECT COUNT(*) AS total FROM cost_quote_catalog WHERE catalog_type='material'"
  );
  if (Number(count.total) <= 1) {
    return { ok: false, error: 'Debe quedar al menos un material.' };
  }
  const existing = await findById(id);
  if (!existing || existing.catalog_type !== 'material') {
    return { ok: false, error: 'Material no encontrado.' };
  }
  await pool.query("DELETE FROM cost_quote_catalog WHERE id = ? AND catalog_type = 'material'", [id]);
  return { ok: true, catalog: await getCatalog() };
}

module.exports = {
  getCatalog,
  upsertAdditional,
  deleteAdditional,
  upsertPrinter,
  deletePrinter,
  upsertMaterial,
  deleteMaterial,
  DEFAULT_CATALOG,
  normalizeAdditional,
  normalizePrinter,
  normalizeMaterial,
};
