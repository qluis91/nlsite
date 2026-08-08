/**
 * Cost Quote Controller — Cotización 3D admin module.
 */
const pool = require('../config/db');
const calculator = require('../services/costQuoteCalculator');
const csrf = require('../config/csrf');

// ── Catalog CRUD ──

async function getCatalog(req, res, next) {
  try {
    const [printers] = await pool.query(
      "SELECT * FROM cost_quote_catalog WHERE catalog_type='printer' ORDER BY sort_order, id"
    );
    const [materials] = await pool.query(
      "SELECT * FROM cost_quote_catalog WHERE catalog_type='material' ORDER BY sort_order, id"
    );
    const [additionals] = await pool.query(
      "SELECT * FROM cost_quote_catalog WHERE catalog_type='additional' ORDER BY sort_order, id"
    );
    return { printers, materials, additionals };
  } catch (err) { next(err); }
}

exports.showCotizacion = async (req, res, next) => {
  try {
    const data = await getCatalog(req, res, next);
    if (!data) return;

    const [quotes] = await pool.query(
      'SELECT id, title, status, client_name, created_at, updated_at FROM cost_quotes ORDER BY updated_at DESC LIMIT 50'
    );

    res.render('pages/admin/cost-quote', {
      title: 'Cotización 3D',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-cost-quote.css'],
      pageModule: '/js/admin/cost-quote.js',
      pageScripts: [],
      currentPath: '/admin/cotizacion-3d',
      ...data,
      quotes,
      csrfToken: csrf.generateToken(req),
    });
  } catch (err) { next(err); }
};

// ── Catalog item CRUD ──

exports.createCatalogItem = async (req, res, next) => {
  try {
    const { catalog_type, name, unit_label, unit_cost, price, is_resin, description } = req.body;
    if (!['printer', 'material', 'additional'].includes(catalog_type)) {
      return res.status(400).json({ error: 'Tipo inválido.' });
    }
    const nameTrim = String(name || '').trim();
    if (!nameTrim || nameTrim.length > 120) {
      return res.status(400).json({ error: 'Nombre requerido (máx 120).' });
    }
    const cost = parseFloat(unit_cost) || 0;
    const [result] = await pool.query(
      `INSERT INTO cost_quote_catalog (catalog_type, name, description, unit_label, unit_cost, price, is_resin)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [catalog_type, nameTrim, String(description || '').slice(0, 500),
       String(unit_label || '').slice(0, 40), cost, parseFloat(price) || null,
       catalog_type === 'material' ? (is_resin === '1' ? 1 : 0) : 0]
    );
    return res.json({ id: result.insertId, name: nameTrim });
  } catch (err) { next(err); }
};

exports.updateCatalogItem = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) return res.status(400).json({ error: 'ID inválido.' });
    const { name, unit_label, unit_cost, price, is_resin, description } = req.body;
    const nameTrim = String(name || '').trim();
    if (!nameTrim) return res.status(400).json({ error: 'Nombre requerido.' });

    await pool.query(
      `UPDATE cost_quote_catalog SET name=?, description=?, unit_label=?, unit_cost=?, price=?, is_resin=?
       WHERE id=?`,
      [nameTrim, String(description || '').slice(0, 500),
       String(unit_label || '').slice(0, 40), parseFloat(unit_cost) || 0,
       parseFloat(price) || null, is_resin === '1' ? 1 : 0, id]
    );
    return res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.deleteCatalogItem = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const [[item]] = await pool.query('SELECT catalog_type FROM cost_quote_catalog WHERE id=?', [id]);
    if (!item) return res.status(404).json({ error: 'No encontrado.' });

    // Prevent deleting last printer or material
    const [count] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM cost_quote_catalog WHERE catalog_type=?', [item.catalog_type]
    );
    if (count[0].cnt <= 1) {
      return res.status(400).json({ error: 'Debe existir al menos un elemento de este tipo.' });
    }

    await pool.query('DELETE FROM cost_quote_catalog WHERE id=?', [id]);
    return res.json({ ok: true });
  } catch (err) { next(err); }
};

// ── Quotes CRUD ──

exports.createQuote = async (req, res, next) => {
  try {
    const {
      title, client_name, client_email, client_phone, description,
      delivery_days, validity_days, shipping_cost, payment_terms, warranty, extra_notes,
      include_iva, quote_email,
      global_discount_enabled, global_discount_pct,
      wholesale_enabled, wholesale_tiers, wholesale_scenario_qty,
      design_cost, profit_pct, alex_pct, luis_pct,
      hour_rate, kg_price,
      selected_printer_id, selected_material_id,
      products,
    } = req.body;

    const titleTrim = String(title || '').trim();
    if (!titleTrim || titleTrim.length > 200) {
      return res.status(400).json({ error: 'Título requerido (máx 200).' });
    }

    const productsArr = Array.isArray(products) ? products : [];
    const totals = calculator.computeQuoteTotals(productsArr, {
      hourRate: parseFloat(hour_rate) || 300,
      kgPrice: parseFloat(kg_price) || 20500,
      profitPct: parseFloat(profit_pct) || 100,
      alexPct: parseFloat(alex_pct) || 30,
      luisPct: 100 - (parseFloat(alex_pct) || 30),
      designCost: parseFloat(design_cost) || 0,
      shippingCost: parseFloat(shipping_cost) || 0,
      includeIva: include_iva === '1' || include_iva === true,
      wholesaleEnabled: wholesale_enabled === '1' || wholesale_enabled === true,
      wholesaleTiers: typeof wholesale_tiers === 'string' ? JSON.parse(wholesale_tiers) : (wholesale_tiers || []),
      wholesaleScenarioQty: parseInt(wholesale_scenario_qty, 10) || null,
      globalDiscountEnabled: global_discount_enabled === '1' || global_discount_enabled === true,
      globalDiscountPct: parseFloat(global_discount_pct) || 0,
    });

    const [result] = await pool.query(
      `INSERT INTO cost_quotes (
        title, description, client_name, client_email, client_phone,
        delivery_days, validity_days, shipping_cost, payment_terms, warranty, extra_notes,
        include_iva, quote_email,
        global_discount_enabled, global_discount_pct,
        wholesale_enabled, wholesale_tiers, wholesale_scenario_qty,
        design_cost, profit_pct, alex_pct, luis_pct,
        hour_rate, kg_price,
        selected_printer_id, selected_material_id,
        products, computed_totals, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        titleTrim, String(description || '').slice(0, 65535),
        String(client_name || '').slice(0, 150),
        String(client_email || '').slice(0, 180),
        String(client_phone || '').slice(0, 30),
        parseInt(delivery_days, 10) || null,
        parseInt(validity_days, 10) || 15,
        parseFloat(shipping_cost) || 0,
        String(payment_terms || '').slice(0, 500),
        String(warranty || '').slice(0, 500),
        String(extra_notes || '').slice(0, 65535),
        include_iva === '1' || include_iva === true ? 1 : 0,
        String(quote_email || '').slice(0, 200),
        global_discount_enabled === '1' || global_discount_enabled === true ? 1 : 0,
        parseFloat(global_discount_pct) || 0,
        wholesale_enabled === '1' || wholesale_enabled === true ? 1 : 0,
        JSON.stringify(typeof wholesale_tiers === 'string' ? JSON.parse(wholesale_tiers) : (wholesale_tiers || [])),
        parseInt(wholesale_scenario_qty, 10) || null,
        parseFloat(design_cost) || 0,
        parseFloat(profit_pct) || 100,
        parseFloat(alex_pct) || 30,
        100 - (parseFloat(alex_pct) || 30),
        parseFloat(hour_rate) || 300,
        parseFloat(kg_price) || 20500,
        parseInt(selected_printer_id, 10) || null,
        parseInt(selected_material_id, 10) || null,
        JSON.stringify(productsArr),
        JSON.stringify(totals),
        req.session.user ? req.session.user.id : null,
      ]
    );

    return res.json({ id: result.insertId, totals });
  } catch (err) { next(err); }
};

exports.updateQuote = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });

    const [[existing]] = await pool.query('SELECT status FROM cost_quotes WHERE id=?', [id]);
    if (!existing) return res.status(404).json({ error: 'No encontrado.' });
    if (existing.status === 'approved') {
      return res.status(400).json({ error: 'No se puede modificar una cotización aprobada.' });
    }

    const {
      title, client_name, client_email, client_phone, description,
      delivery_days, validity_days, shipping_cost, payment_terms, warranty, extra_notes,
      include_iva, quote_email,
      global_discount_enabled, global_discount_pct,
      wholesale_enabled, wholesale_tiers, wholesale_scenario_qty,
      design_cost, profit_pct, alex_pct, luis_pct,
      hour_rate, kg_price,
      selected_printer_id, selected_material_id,
      products, status,
    } = req.body;

    const productsArr = Array.isArray(products) ? products : [];
    const totals = calculator.computeQuoteTotals(productsArr, {
      hourRate: parseFloat(hour_rate) || 300,
      kgPrice: parseFloat(kg_price) || 20500,
      profitPct: parseFloat(profit_pct) || 100,
      alexPct: parseFloat(alex_pct) || 30,
      luisPct: 100 - (parseFloat(alex_pct) || 30),
      designCost: parseFloat(design_cost) || 0,
      shippingCost: parseFloat(shipping_cost) || 0,
      includeIva: include_iva === '1' || include_iva === true,
      wholesaleEnabled: wholesale_enabled === '1' || wholesale_enabled === true,
      wholesaleTiers: typeof wholesale_tiers === 'string' ? JSON.parse(wholesale_tiers) : (wholesale_tiers || []),
      wholesaleScenarioQty: parseInt(wholesale_scenario_qty, 10) || null,
      globalDiscountEnabled: global_discount_enabled === '1' || global_discount_enabled === true,
      globalDiscountPct: parseFloat(global_discount_pct) || 0,
    });

    await pool.query(
      `UPDATE cost_quotes SET
        title=?, description=?, client_name=?, client_email=?, client_phone=?,
        delivery_days=?, validity_days=?, shipping_cost=?, payment_terms=?, warranty=?, extra_notes=?,
        include_iva=?, quote_email=?,
        global_discount_enabled=?, global_discount_pct=?,
        wholesale_enabled=?, wholesale_tiers=?, wholesale_scenario_qty=?,
        design_cost=?, profit_pct=?, alex_pct=?, luis_pct=?,
        hour_rate=?, kg_price=?,
        selected_printer_id=?, selected_material_id=?,
        products=?, computed_totals=?, status=?,
        updated_at=NOW()
      WHERE id=?`,
      [
        String(title || '').trim().slice(0, 200),
        String(description || '').slice(0, 65535),
        String(client_name || '').slice(0, 150),
        String(client_email || '').slice(0, 180),
        String(client_phone || '').slice(0, 30),
        parseInt(delivery_days, 10) || null,
        parseInt(validity_days, 10) || 15,
        parseFloat(shipping_cost) || 0,
        String(payment_terms || '').slice(0, 500),
        String(warranty || '').slice(0, 500),
        String(extra_notes || '').slice(0, 65535),
        include_iva === '1' || include_iva === true ? 1 : 0,
        String(quote_email || '').slice(0, 200),
        global_discount_enabled === '1' || global_discount_enabled === true ? 1 : 0,
        parseFloat(global_discount_pct) || 0,
        wholesale_enabled === '1' || wholesale_enabled === true ? 1 : 0,
        JSON.stringify(typeof wholesale_tiers === 'string' ? JSON.parse(wholesale_tiers) : (wholesale_tiers || [])),
        parseInt(wholesale_scenario_qty, 10) || null,
        parseFloat(design_cost) || 0,
        parseFloat(profit_pct) || 100,
        parseFloat(alex_pct) || 30,
        100 - (parseFloat(alex_pct) || 30),
        parseFloat(hour_rate) || 300,
        parseFloat(kg_price) || 20500,
        parseInt(selected_printer_id, 10) || null,
        parseInt(selected_material_id, 10) || null,
        JSON.stringify(productsArr),
        JSON.stringify(totals),
        String(status || 'draft').slice(0, 20),
        id,
      ]
    );

    return res.json({ id, totals });
  } catch (err) { next(err); }
};

exports.loadQuote = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    const [[quote]] = await pool.query('SELECT * FROM cost_quotes WHERE id=?', [id]);
    if (!quote) return res.status(404).json({ error: 'No encontrado.' });
    return res.json(quote);
  } catch (err) { next(err); }
};

exports.deleteQuote = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido.' });
    await pool.query('DELETE FROM cost_quotes WHERE id=? AND status != ?', [id, 'approved']);
    return res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.listQuotes = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, title, status, client_name, created_at, updated_at FROM cost_quotes ORDER BY updated_at DESC LIMIT 100'
    );
    return res.json(rows);
  } catch (err) { next(err); }
};
