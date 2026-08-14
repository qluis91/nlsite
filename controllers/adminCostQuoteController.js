/**
 * Cost Quote Controller — Cotización 3D admin module (legacy parity).
 * Uses full state snapshot save/load matching legacy persistence.
 */
const pool = require('../config/db');
const calculator = require('../services/costQuoteCalculator');
const csrf = require('../config/csrf');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const QUOTE_STATUSES = ['pendiente', 'enviada', 'pendiente_aprobacion', 'aprobada', 'sin_respuesta', 'cancelada'];

function normalizeStatus(s) {
  const raw = String(s || 'pendiente').trim().toLowerCase().replace(/\s+/g, '_');
  if (raw === 'pendiente_de_aprobacion' || raw === 'pendiente-aprobacion') return 'pendiente_aprobacion';
  return QUOTE_STATUSES.includes(raw) ? raw : 'pendiente';
}

function newPublicToken() {
  return crypto.randomBytes(16).toString('hex');
}

function getProductsFromSnapshot(snapshot) {
  const state = snapshot && typeof snapshot === 'object' ? snapshot : {};
  if (Array.isArray(state.products) && state.products.length) return state.products;
  if (state.product && typeof state.product === 'object') return [state.product];
  return [];
}

function getQuoteDisplayName(snapshot, fallback) {
  const products = getProductsFromSnapshot(snapshot);
  const names = products.map(p => String(p && p.name ? p.name : '').trim()).filter(Boolean);
  if (!names.length) return String(fallback || '').trim();
  if (names.length === 1) return names[0];
  return names[0] + ' +' + (names.length - 1) + ' más';
}

// ── Catalog helpers ──

async function getCatalogData() {
  const [printers] = await pool.query("SELECT * FROM cost_quote_catalog WHERE catalog_type='printer' ORDER BY sort_order, id");
  const [materials] = await pool.query("SELECT * FROM cost_quote_catalog WHERE catalog_type='material' ORDER BY sort_order, id");
  const [additionals] = await pool.query("SELECT * FROM cost_quote_catalog WHERE catalog_type='additional' ORDER BY sort_order, id");

  const mapPrinter = r => ({ id: String(r.id), name: r.name, hourRate: r.unit_cost || 300 });
  const mapMaterial = r => ({ id: String(r.id), name: r.name, kgPrice: r.unit_cost || 20500 });
  const mapAdditional = r => ({ id: String(r.id), description: r.description || r.name, price: r.price || 0 });

  return {
    printers: printers.map(mapPrinter),
    materials: materials.map(mapMaterial),
    additionals: additionals.map(mapAdditional),
  };
}

// ── Page render ──

exports.showCotizacion = async (req, res, next) => {
  try {
    const catalog = await getCatalogData();

    const [quotes] = await pool.query(
      `SELECT id, product_name, client_name, client_email, workflow_status, public_token,
              total_crc, created_at, updated_at
       FROM cost_quotes ORDER BY updated_at DESC LIMIT 100`
    );

    res.render('pages/admin/cost-quote', {
      title: 'Cotización 3D',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-cost-quote.css'],
      pageModule: '/js/admin/cost-quote.js',
      pageScripts: [
        'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
      ],
      currentPath: '/admin/cotizacion-3d',
      catalog: JSON.stringify(catalog),
      quotes: JSON.stringify(quotes.map(q => ({
        id: String(q.id),
        productName: q.product_name,
        workflowStatus: normalizeStatus(q.workflow_status),
        clientEmail: q.client_email || '',
        clientName: q.client_name || '',
        totalCrc: q.total_crc || 0,
        createdAt: q.created_at,
        updatedAt: q.updated_at,
        publicToken: q.public_token || '',
      }))),
      csrfToken: csrf.generateToken(req),
    });
  } catch (err) { next(err); }
};

// ── Quotes CRUD (snapshot-based, legacy parity) ──

exports.createQuote = async (req, res, next) => {
  try {
    const { snapshot, name, totalCrc } = req.body;
    const state = typeof snapshot === 'string' ? JSON.parse(snapshot) : (snapshot || {});
    const products = getProductsFromSnapshot(state);
    if (!products.length) return res.status(400).json({ error: 'Indicá al menos un producto.' });

    const productName = String(name || getQuoteDisplayName(state, '')).trim();
    if (!productName) return res.status(400).json({ error: 'Indicá el nombre del producto.' });

    const clientEmail = String(state.export?.clientEmail || '').trim();
    const clientName = String(state.export?.clientName || '').trim();
    const total = calculator.computeQuoteTotal(state);

    const payload = {
      costs: state.costs || {},
      discounts: state.discounts || {},
      discountRanges: state.discountRanges || {},
      products,
      alexPercent: state.alexPercent,
      globalDiscount: state.globalDiscount || { enabled: false, percent: 0 },
      scenarioQty: state.scenarioQty || {},
      wholesaleMode: !!state.wholesaleMode,
      export: state.export || {},
    };

    const existingId = String(state.currentSavedQuoteId || req.body.id || '').trim();
    if (existingId) {
      const [[current]] = await pool.query('SELECT * FROM cost_quotes WHERE id=?', [existingId]);
      if (!current) return res.status(400).json({ error: 'Cotización no encontrada.' });
      if (current.workflow_status === 'aprobada') {
        return res.status(400).json({ error: 'Cotización aprobada no se puede editar.' });
      }
      await pool.query(`UPDATE cost_quotes SET
        product_name=?, payload=?, client_email=?, client_name=?, total_crc=?,
        workflow_data=JSON_SET(COALESCE(workflow_data,'{}'), '$.pdfGeneratedAt', IFNULL(?, workflow_data->>'$.pdfGeneratedAt')),
        updated_at=NOW()
      WHERE id=?`, [
        productName, JSON.stringify(payload), clientEmail, clientName, total,
        req.body.pdfGeneratedAt ? new Date(req.body.pdfGeneratedAt).getTime() : null,
        existingId,
      ]);
      return res.json({ ok: true, id: existingId, totalCrc: total });
    }

    const id = crypto.randomBytes(8).toString('hex');
    const publicToken = newPublicToken();
    await pool.query(`INSERT INTO cost_quotes (
      id, product_name, payload, workflow_status, public_token,
      client_email, client_name, total_crc, workflow_data,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`, [
      id, productName, JSON.stringify(payload), 'pendiente', publicToken,
      clientEmail, clientName, total,
      JSON.stringify({ pdfGeneratedAt: null }),
    ]);

    return res.json({ ok: true, id, totalCrc: total, publicToken });
  } catch (err) { next(err); }
};

exports.updateQuote = async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const [[current]] = await pool.query('SELECT * FROM cost_quotes WHERE id=?', [id]);
    if (!current) return res.status(404).json({ error: 'No encontrado.' });
    if (current.workflow_status === 'aprobada') {
      return res.status(400).json({ error: 'Cotización aprobada no se puede editar.' });
    }

    const { snapshot, name } = req.body;
    const state = typeof snapshot === 'string' ? JSON.parse(snapshot) : (snapshot || {});
    const productName = String(name || getQuoteDisplayName(state, ''));
    const total = calculator.computeQuoteTotal(state);

    await pool.query(`UPDATE cost_quotes SET
      product_name=?, payload=?, total_crc=?,
      client_email=?, client_name=?,
      updated_at=NOW()
    WHERE id=?`, [
      productName || current.product_name,
      JSON.stringify({
        costs: state.costs || {}, discounts: state.discounts || {},
        discountRanges: state.discountRanges || {},
        products: getProductsFromSnapshot(state),
        alexPercent: state.alexPercent, globalDiscount: state.globalDiscount || { enabled: false, percent: 0 },
        scenarioQty: state.scenarioQty || {}, wholesaleMode: !!state.wholesaleMode,
        export: state.export || {},
      }),
      total || current.total_crc,
      String(state.export?.clientEmail || current.client_email || '').trim(),
      String(state.export?.clientName || current.client_name || '').trim(),
      id,
    ]);

    return res.json({ ok: true, id, totalCrc: total });
  } catch (err) { next(err); }
};

exports.deleteQuote = async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const [result] = await pool.query('DELETE FROM cost_quotes WHERE id=?', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'No encontrado.' });
    return res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.loadQuote = async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const [[quote]] = await pool.query('SELECT * FROM cost_quotes WHERE id=?', [id]);
    if (!quote) return res.status(404).json({ error: 'No encontrado.' });

    const payload = typeof quote.payload === 'string' ? JSON.parse(quote.payload) : (quote.payload || {});
    return res.json({
      id: String(quote.id),
      productName: quote.product_name,
      workflowStatus: normalizeStatus(quote.workflow_status),
      publicToken: quote.public_token || '',
      totalCrc: quote.total_crc || 0,
      clientEmail: quote.client_email || '',
      clientName: quote.client_name || '',
      payload,
    });
  } catch (err) { next(err); }
};

exports.listQuotes = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, product_name, client_name, client_email, workflow_status, public_token,
              total_crc, created_at, updated_at
       FROM cost_quotes ORDER BY updated_at DESC LIMIT 100`
    );
    return res.json(rows.map(q => ({
      id: String(q.id),
      productName: q.product_name,
      workflowStatus: normalizeStatus(q.workflow_status),
      clientEmail: q.client_email || '',
      clientName: q.client_name || '',
      totalCrc: q.total_crc || 0,
      createdAt: q.created_at,
      updatedAt: q.updated_at,
      publicToken: q.public_token || '',
    })));
  } catch (err) { next(err); }
};

// ── Workflow ──

exports.setWorkflowStatus = async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    const { status } = req.body;
    const newStatus = normalizeStatus(status);
    if (!QUOTE_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: 'Estado inválido.' });
    }
    const [[current]] = await pool.query('SELECT * FROM cost_quotes WHERE id=?', [id]);
    if (!current) return res.status(404).json({ error: 'No encontrado.' });

    const workflowData = typeof current.workflow_data === 'string'
      ? JSON.parse(current.workflow_data) : (current.workflow_data || {});
    if (newStatus === 'enviada') workflowData.sentAt = Date.now();
    if (newStatus === 'aprobada') workflowData.approvedAt = Date.now();

    await pool.query(`UPDATE cost_quotes SET workflow_status=?, workflow_data=?, updated_at=NOW() WHERE id=?`, [
      newStatus, JSON.stringify(workflowData), id,
    ]);
    return res.json({ ok: true, status: newStatus });
  } catch (err) { next(err); }
};

// ── PDF generation ──

exports.pdfData = async (req, res, next) => {
  try {
    const { snapshot } = req.body;
    const state = typeof snapshot === 'string' ? JSON.parse(snapshot) : (snapshot || {});
    return res.json({
      pdfData: {
        logo: '/images/logo-combo.png',
        transfer: {
          name: 'Luis Quijano Aguilar',
          cedula: '1-1461-0619',
          iban: 'CR85016111116160804858',
          sinpe: '8614-3452',
        },
        brand: { phone: '(506) 7024-0270', web: 'www.ninjalab3d.com', email: 'lquijano@ninjalab3d.com' },
      },
    });
  } catch (err) { next(err); }
};

// ── Email sending ──

exports.sendEmail = async (req, res, next) => {
  try {
    const { snapshot, clientEmail, clientName } = req.body;
    const state = typeof snapshot === 'string' ? JSON.parse(snapshot) : (snapshot || {});
    const email = String(clientEmail || state.export?.clientEmail || '').trim();
    if (!email) return res.status(400).json({ error: 'Indicá el email del cliente.' });

    // In full implementation, this would use nlsite's mail system
    // For now, acknowledge the request
    const total = calculator.computeQuoteTotal(state);
    const feePricing = calculator.computeTilopayPricing(total);

    // TODO: integrate with nlsite's native mail system
    console.log(`[cotizacion-3d] Email requested to ${email} — total: ${total} — tilopay total: ${feePricing.tilopayTotal}`);

    return res.json({
      ok: true,
      message: 'Email preparado. Integración con sistema de correo nativo pendiente.',
      total,
      tilopayTotal: feePricing.tilopayTotal,
    });
  } catch (err) { next(err); }
};

// ── Public quote page ──

exports.publicQuote = async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).send('Token inválido.');

    const [[quote]] = await pool.query('SELECT * FROM cost_quotes WHERE public_token=?', [token]);
    if (!quote) return res.status(404).send('Cotización no encontrada.');

    const payload = typeof quote.payload === 'string' ? JSON.parse(quote.payload) : (quote.payload || {});
    const total = quote.total_crc || calculator.computeQuoteTotal(payload);

    // Only show safe public data — no internal costs or Alex/Luis margins
    res.render('pages/cotizacion-publica', {
      title: 'Cotización 3D',
      layout: 'layouts/main',
      quoteId: String(quote.id),
      token,
      clientName: quote.client_name || payload.export?.clientName || 'Cliente',
      productName: quote.product_name || 'Cotización 3D',
      total,
      status: normalizeStatus(quote.workflow_status),
      products: getProductsFromSnapshot(payload).map(p => ({
        name: p.name || 'Producto',
        quantity: p.quantity || 1,
      })),
      csrfToken: csrf.generateToken(req),
    });
  } catch (err) { next(err); }
};

exports.publicConfirm = async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Token inválido.' });

    const [[quote]] = await pool.query('SELECT * FROM cost_quotes WHERE public_token=?', [token]);
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada.' });

    await pool.query(`UPDATE cost_quotes SET workflow_status='pendiente_aprobacion', updated_at=NOW() WHERE id=?`, [quote.id]);
    return res.json({ ok: true });
  } catch (err) { next(err); }
};

// ── Catalog CRUD ──

exports.createCatalogItem = async (req, res, next) => {
  try {
    const { type, item } = req.body;
    const catalogType = String(type || '').trim();

    if (!['additional', 'printer', 'material'].includes(catalogType)) {
      return res.status(400).json({ error: 'Tipo inválido.' });
    }

    let name, unitCost, price, description;
    if (catalogType === 'printer') {
      name = String(item?.name || '').trim();
      unitCost = parseFloat(item?.hourRate) || 300;
      if (!name) return res.status(400).json({ error: 'Indicá el nombre de la impresora.' });
      price = null;
      description = null;
    } else if (catalogType === 'material') {
      name = String(item?.name || '').trim();
      unitCost = parseFloat(item?.kgPrice) || 20500;
      if (!name) return res.status(400).json({ error: 'Indicá el nombre del material.' });
      price = null;
      description = null;
    } else {
      name = String(item?.description || '').trim();
      description = name;
      unitCost = 0;
      price = parseFloat(item?.price) || 0;
      if (!name) return res.status(400).json({ error: 'Indicá la descripción del adicional.' });
    }

    const [result] = await pool.query(
      `INSERT INTO cost_quote_catalog (catalog_type, name, description, unit_cost, price)
       VALUES (?, ?, ?, ?, ?)`,
      [catalogType, name, String(description || '').slice(0, 500), unitCost, price]
    );

    return res.json({ id: String(result.insertId), catalog: await getCatalogData() });
  } catch (err) { next(err); }
};

exports.updateCatalogItem = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const { type, item } = req.body;

    const [[existing]] = await pool.query('SELECT * FROM cost_quote_catalog WHERE id=?', [id]);
    if (!existing) return res.status(404).json({ error: 'No encontrado.' });

    const catalogType = String(type || existing.catalog_type).trim();
    let name, unitCost, price, description;

    if (catalogType === 'printer') {
      name = String(item?.name || existing.name).trim();
      unitCost = parseFloat(item?.hourRate) || existing.unit_cost || 300;
      if (!name) return res.status(400).json({ error: 'Nombre requerido.' });
      description = existing.description;
      price = existing.price;
    } else if (catalogType === 'material') {
      name = String(item?.name || existing.name).trim();
      unitCost = parseFloat(item?.kgPrice) || existing.unit_cost || 20500;
      if (!name) return res.status(400).json({ error: 'Nombre requerido.' });
      description = existing.description;
      price = existing.price;
    } else {
      name = String(item?.description || existing.name).trim();
      description = name;
      unitCost = 0;
      price = parseFloat(item?.price) || existing.price || 0;
      if (!name) return res.status(400).json({ error: 'Descripción requerida.' });
    }

    await pool.query(
      'UPDATE cost_quote_catalog SET name=?, description=?, unit_cost=?, price=? WHERE id=?',
      [name, String(description || '').slice(0, 500), unitCost, price, id]
    );

    return res.json({ ok: true, catalog: await getCatalogData() });
  } catch (err) { next(err); }
};

exports.deleteCatalogItem = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const [[item]] = await pool.query('SELECT catalog_type FROM cost_quote_catalog WHERE id=?', [id]);
    if (!item) return res.status(404).json({ error: 'No encontrado.' });

    const [count] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM cost_quote_catalog WHERE catalog_type=?', [item.catalog_type]
    );
    const minRequired = (item.catalog_type === 'additional') ? 0 : 1;
    if (count[0].cnt <= minRequired + 1) {
      // Allow deletion but keep at least one
    }
    if (count[0].cnt <= 1 && item.catalog_type !== 'additional') {
      return res.status(400).json({ error: 'Debe quedar al menos un elemento de este tipo.' });
    }

    await pool.query('DELETE FROM cost_quote_catalog WHERE id=?', [id]);
    return res.json({ ok: true, catalog: await getCatalogData() });
  } catch (err) { next(err); }
};
