/**
 * Cotización 3D catalog store — MySQL adapter for cost_quote_catalog.
 * API shapes match ninjalab3dcr costQuoteCatalogStore (+ emails).
 */
const pool = require('../config/db');
const crypto = require('crypto');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FALLBACK_EMAILS = [
  { id: 'email-fallback-info', email: 'info@ninjalab3d.com', label: 'Info', isDefault: false },
  { id: 'email-fallback-luis', email: 'lquijano@ninjalab3d.com', label: 'Luis Quijano', isDefault: true },
  { id: 'email-fallback-badilla', email: 'badilla@ninjalab3d.com', label: 'Badilla', isDefault: false },
];

const DEFAULT_CATALOG = {
  additionals: [],
  printers: [{ id: 'printer-default', name: 'Impresora principal', hourRate: 300 }],
  materials: [{ id: 'material-default', name: 'PLA estándar', kgPrice: 20500 }],
  emails: FALLBACK_EMAILS.map((e) => ({ ...e })),
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

function normalizeEmail(item) {
  const email = String(item.email || item.name || '')
    .trim()
    .toLowerCase()
    .slice(0, 180);
  const label = String(item.label != null ? item.label : (item.description || ''))
    .trim()
    .slice(0, 120);
  return {
    id: String(item.id || newId('email')),
    email,
    label,
    isDefault: Boolean(item.isDefault ?? item.is_default),
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

function rowToEmail(r) {
  return normalizeEmail({
    id: r.id,
    email: r.name,
    label: r.description || '',
    isDefault: r.is_default,
  });
}

function validateEmailAddress(email) {
  if (!email) return 'Indicá el correo electrónico.';
  if (email.length > 180) return 'El correo es demasiado largo.';
  if (!EMAIL_RE.test(email)) return 'El correo no es válido.';
  return null;
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
  const [emails] = await pool.query(
    `SELECT * FROM cost_quote_catalog
      WHERE catalog_type='email'
      ORDER BY is_default DESC, sort_order, id`
  );

  let mappedPrinters = printers.map(rowToPrinter);
  let mappedMaterials = materials.map(rowToMaterial);
  let mappedEmails = emails.map(rowToEmail);
  if (!mappedPrinters.length) mappedPrinters = DEFAULT_CATALOG.printers.map(normalizePrinter);
  if (!mappedMaterials.length) mappedMaterials = DEFAULT_CATALOG.materials.map(normalizeMaterial);
  if (!mappedEmails.length) mappedEmails = FALLBACK_EMAILS.map((e) => ({ ...e }));

  // Ensure exactly one default when possible
  if (mappedEmails.length && !mappedEmails.some((e) => e.isDefault)) {
    mappedEmails[0] = { ...mappedEmails[0], isDefault: true };
  }

  return {
    printers: mappedPrinters,
    materials: mappedMaterials,
    additionals: additionals.map(rowToAdditional),
    emails: mappedEmails,
  };
}

async function findById(id) {
  const [[row]] = await pool.query('SELECT * FROM cost_quote_catalog WHERE id = ? LIMIT 1', [id]);
  return row || null;
}

async function clearDefaultEmails(conn) {
  await conn.query(
    "UPDATE cost_quote_catalog SET is_default = 0 WHERE catalog_type = 'email'"
  );
}

async function findDuplicateEmail(email, excludeId) {
  const params = [email];
  let sql =
    `SELECT id FROM cost_quote_catalog
      WHERE catalog_type = 'email' AND LOWER(name) = LOWER(?)`;
  if (excludeId) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const [[row]] = await pool.query(sql, params);
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

async function upsertEmail(body) {
  const item = normalizeEmail(body || {});
  const emailError = validateEmailAddress(item.email);
  if (emailError) return { ok: false, error: emailError };
  if (item.label.length > 120) return { ok: false, error: 'La etiqueta es demasiado larga.' };

  const editId = String(body.id || '').trim();
  const wantsDefault = Boolean(body.isDefault ?? body.is_default);

  const dup = await findDuplicateEmail(item.email, editId || null);
  if (dup) return { ok: false, error: 'Ese correo ya está registrado.' };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (editId) {
      const [[existing]] = await conn.query(
        'SELECT * FROM cost_quote_catalog WHERE id = ? LIMIT 1',
        [editId]
      );
      if (!existing || existing.catalog_type !== 'email') {
        await conn.rollback();
        return { ok: false, error: 'Correo no encontrado.' };
      }

      const wasDefault = Number(existing.is_default) === 1;
      // Checkbox drives default; editing a default with the box still checked keeps it.
      const makeDefault = wantsDefault;

      if (makeDefault) {
        await clearDefaultEmails(conn);
      }

      await conn.query(
        `UPDATE cost_quote_catalog
            SET name = ?, description = ?, is_default = ?
          WHERE id = ? AND catalog_type = 'email'`,
        [item.email, item.label || null, makeDefault ? 1 : 0, editId]
      );

      if (wasDefault && !makeDefault) {
        const [[next]] = await conn.query(
          `SELECT id FROM cost_quote_catalog
            WHERE catalog_type = 'email' AND id <> ?
            ORDER BY sort_order, id
            LIMIT 1`,
          [editId]
        );
        if (next) {
          await conn.query(
            "UPDATE cost_quote_catalog SET is_default = 1 WHERE id = ?",
            [next.id]
          );
        }
      }

      await conn.commit();
      const catalog = await getCatalog();
      return { ok: true, catalog, item: catalog.emails.find((e) => e.id === String(editId)) };
    }

    if (wantsDefault) {
      await clearDefaultEmails(conn);
    }

    const [[countRow]] = await conn.query(
      "SELECT COUNT(*) AS total FROM cost_quote_catalog WHERE catalog_type = 'email'"
    );
    const isFirst = Number(countRow.total) === 0;
    const isDefault = wantsDefault || isFirst ? 1 : 0;

    const [result] = await conn.query(
      `INSERT INTO cost_quote_catalog
         (catalog_type, name, description, unit_cost, is_default, sort_order)
       VALUES ('email', ?, ?, 0, ?, 0)`,
      [item.email, item.label || null, isDefault]
    );
    await conn.commit();
    const catalog = await getCatalog();
    return {
      ok: true,
      catalog,
      item: catalog.emails.find((e) => e.id === String(result.insertId)),
    };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function setDefaultEmail(id) {
  const emailId = String(id || '').trim();
  const existing = await findById(emailId);
  if (!existing || existing.catalog_type !== 'email') {
    return { ok: false, error: 'Correo no encontrado.' };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await clearDefaultEmails(conn);
    await conn.query(
      "UPDATE cost_quote_catalog SET is_default = 1 WHERE id = ? AND catalog_type = 'email'",
      [emailId]
    );
    await conn.commit();
    return { ok: true, catalog: await getCatalog() };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteEmail(id) {
  const emailId = String(id || '').trim();
  const existing = await findById(emailId);
  if (!existing || existing.catalog_type !== 'email') {
    return { ok: false, error: 'Correo no encontrado.' };
  }

  const [[count]] = await pool.query(
    "SELECT COUNT(*) AS total FROM cost_quote_catalog WHERE catalog_type='email'"
  );
  if (Number(count.total) <= 1) {
    return { ok: false, error: 'Debe quedar al menos un correo de cotización.' };
  }

  const wasDefault = Number(existing.is_default) === 1;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "DELETE FROM cost_quote_catalog WHERE id = ? AND catalog_type = 'email'",
      [emailId]
    );
    if (wasDefault) {
      const [[next]] = await conn.query(
        `SELECT id FROM cost_quote_catalog
          WHERE catalog_type = 'email'
          ORDER BY sort_order, id
          LIMIT 1`
      );
      if (next) {
        await conn.query(
          "UPDATE cost_quote_catalog SET is_default = 1 WHERE id = ?",
          [next.id]
        );
      }
    }
    await conn.commit();
    return { ok: true, catalog: await getCatalog() };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getCatalog,
  upsertAdditional,
  deleteAdditional,
  upsertPrinter,
  deletePrinter,
  upsertMaterial,
  deleteMaterial,
  upsertEmail,
  deleteEmail,
  setDefaultEmail,
  DEFAULT_CATALOG,
  FALLBACK_EMAILS,
  normalizeAdditional,
  normalizePrinter,
  normalizeMaterial,
  normalizeEmail,
  rowToEmail,
  validateEmailAddress,
};
