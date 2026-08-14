/**
 * Cotización 3D — Client calculator & admin module (legacy parity v2).
 * Mirrors nllegacy admin-cost-quote.js behavior exactly.
 */
(function () {
  'use strict';

  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const IVA_RATE = 0.13;

  // ── Helpers ──
  const roundMoney = n => Math.round(Number(n) || 0);
  const num = (v, fallback) => { const n = parseFloat(v); return isFinite(n) ? n : (fallback || 0); };
  const fmtCrc = n => {
    const v = roundMoney(n);
    try { return new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v); }
    catch (e) { return '\u20A1' + v.toLocaleString('es-CR'); }
  };
  const fmtMoney = n => '\u20A1' + roundMoney(n).toLocaleString('es-CR');
  const escapeHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── Additionals helpers ──
  function normalizeAdditional(v) {
    if (v && typeof v === 'object') return { price: roundMoney(v.price), description: String(v.description || ''), showOnInvoice: v.showOnInvoice !== false };
    return { price: roundMoney(v), description: '', showOnInvoice: true };
  }
  function getProductAdditionals(p) {
    if (!p) return [];
    if (Array.isArray(p.additionals) && p.additionals.length) return p.additionals.map(normalizeAdditional);
    return [1, 2, 3].map(i => normalizeAdditional(p['additional' + i]));
  }
  function sumAdditionals(p) { return roundMoney(getProductAdditionals(p).reduce((s, a) => s + a.price, 0)); }
  function sumVisibleAdditionals(p) { return roundMoney(getProductAdditionals(p).filter(a => a.showOnInvoice).reduce((s, a) => s + a.price, 0)); }

  // ── Discount ranges ──
  function getDiscountRanges(state) {
    const dr = state.discountRanges || {};
    return {
      range10_50: { min: Math.max(1, num(dr.range10_50?.min, 10)), max: Math.max(1, num(dr.range10_50?.max, 50)) },
      range50_100: { min: Math.max(1, num(dr.range50_100?.min, 50)), max: Math.max(1, num(dr.range50_100?.max, 100)) },
      range100plus: { min: Math.max(1, num(dr.range100plus?.min, 100)), max: null },
    };
  }
  function getTierDiscountPercent(state, qty, wholesaleMode) {
    if (!wholesaleMode) return 0;
    const d = state.discounts || {};
    const r = getDiscountRanges(state);
    const n = num(qty);
    if (n >= r.range100plus.min) return num(d.range100plus);
    if (n >= r.range50_100.min) return num(d.range50_100);
    if (n >= r.range10_50.min) return num(d.range10_50);
    return 0;
  }
  function formatRangeLabel(range, key) {
    if (key === 'range100plus' || range.max == null) return range.min + '+ uds';
    return range.min + ' a ' + range.max + ' uds';
  }

  // ── State & defaults (matches legacy EXACTLY) ──
  function defaultProduct() {
    return {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: 'Copa Mundial', quantity: 2, grams: 385, printHours: 14.5,
      qtyInputMode: 'unit', additionals: [], salePriceManual: 0,
      salePriceTouched: false, saleDiscountEnabled: false, saleDiscountPercent: 0,
    };
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  const app = document.getElementById('cost-quote-app');
  if (!app) return;

  // Read catalog from data attributes
  const catalogData = JSON.parse(app.dataset.catalog || '{"additionals":[],"printers":[],"materials":[]}');
  const savedQuotesData = JSON.parse(app.dataset.savedQuotes || '[]');

  const state = {
    costs: { hourRate: 300, designCost: 0, kgPrice: 20500, profitPercent: 100, printerId: '', materialId: '' },
    discounts: { range10_50: 5, range50_100: 10, range100plus: 15 },
    discountRanges: { range10_50: { min: 10, max: 50 }, range50_100: { min: 50, max: 100 }, range100plus: { min: 100, max: null } },
    alexPercent: 30, luisPercent: 70,
    globalDiscount: { enabled: false, percent: 0 },
    scenarioQty: { range10_50: 12, range50_100: 50, range100plus: 200 },
    export: {
      clientName: '', clientEmail: '', clientPhone: '', orderTitle: '', description: '',
      deliveryDays: 5, validDays: 15, shippingCost: 0,
      paymentTerms: 'Forma de pago: 50% de adelanto y 50% contra entrega.',
      warranty: 'Garantía: 3 meses por defectos de fabricación.',
      extraNotes: '', includeIva: false, quoteEmail: 'lquijano@ninjalab3d.com',
    },
    wholesaleMode: false,
    products: [defaultProduct()],
    currentSavedQuoteId: '',
  };

  const catalog = { additionals: catalogData.additionals || [], printers: catalogData.printers || [], materials: catalogData.materials || [] };
  let currentSavedQuoteId = state.currentSavedQuoteId;
  let activeTab = 'cotizacion';

  // ── Core calculations (mirrors legacy computeLine, computeAll) ──

  function getEffectiveCosts() { return state.costs; }

  function computeLine(product, quantity, discountPercent) {
    const c = getEffectiveCosts();
    const p = product || {};
    const qty = Math.max(0, num(quantity, 0));
    const mc = (num(p.grams) / 1000) * num(c.kgPrice);
    const tc = num(p.printHours) * num(c.hourRate);
    const ac = sumAdditionals(p);
    const pc = mc + tc;
    const uc = pc + ac;
    const ttc = uc * qty;
    const sp = Math.round(pc * (1 + num(c.profitPercent) / 100) + ac);
    const bs = p.salePriceTouched ? num(p.salePriceManual) : sp;
    const disc = Math.max(0, Math.min(100, num(discountPercent)));
    const su = bs * (1 - disc / 100);
    const nu = su - uc;
    const nt = nu * qty;
    const ap = num(state.alexPercent, 30);
    const lp = num(state.luisPercent, 70);
    return {
      quantity: qty, materialCost: mc, timeCost: tc, unitCost: uc, totalCost: ttc,
      suggestedPrice: sp, suggestedTotal: sp * qty, saleUnit: su, baseSale: bs,
      discountPercent: disc, netUnit: nu, netTotal: nt,
      alexUnitShare: nu * (ap / 100), luisUnitShare: nu * (lp / 100),
      alexShare: nt * (ap / 100), luisShare: nt * (lp / 100),
      designCost: 0, clientTotal: su * qty,
    };
  }

  function aggregateMain(productResults) {
    const c = getEffectiveCosts();
    const dc = num(c.designCost);
    const sg = productResults.reduce((s, pr) => s + pr.line.saleUnit * pr.line.quantity, 0);
    const st = productResults.reduce((s, pr) => s + pr.line.suggestedPrice * pr.line.quantity, 0);
    const gd = !state.wholesaleMode && state.globalDiscount && state.globalDiscount.enabled
      ? Math.max(0, Math.min(100, num(state.globalDiscount.percent))) : 0;
    const gda = Math.round(sg * (gd / 100));
    const sag = sg - gda;
    const tq = productResults.reduce((s, pr) => s + pr.line.quantity, 0);
    const nbg = productResults.reduce((s, pr) => s + pr.line.netTotal, 0);
    const nag = nbg - Math.round(nbg * (gd / 100));
    const ap = num(state.alexPercent, 30);
    const lp = num(state.luisPercent, 70);
    return {
      quantity: tq, productCount: productResults.length,
      suggestedPrice: productResults.length === 1 ? productResults[0].line.suggestedPrice : 0,
      suggestedTotal: st, suggestedUnitAvg: tq > 0 ? Math.round(st / tq) : 0,
      saleUnit: tq > 0 ? Math.round(sag / tq) : 0, saleTotal: sag,
      baseSale: productResults.length === 1 ? productResults[0].line.baseSale : sg,
      subtotalGross: sg, discountPercent: gd, globalDiscountAmount: gda,
      clientTotal: sag + dc, designCost: dc, netTotal: nag,
      netUnit: tq > 0 ? nag / tq : 0,
      alexUnitShare: tq > 0 ? (nag * (ap / 100)) / tq : 0, luisUnitShare: tq > 0 ? (nag * (lp / 100)) / tq : 0,
      alexShare: nag * (ap / 100) + dc, luisShare: nag * (lp / 100),
      materialCost: productResults.reduce((s, pr) => s + pr.line.materialCost, 0),
      timeCost: productResults.reduce((s, pr) => s + pr.line.timeCost, 0),
      unitCost: productResults.reduce((s, pr) => s + pr.line.unitCost, 0),
      totalCost: productResults.reduce((s, pr) => s + pr.line.totalCost, 0),
    };
  }

  function aggregateScenarioLine(productResults, discountPct) {
    let subs = 0, tcos = 0, qtya = 0, net = 0;
    productResults.forEach(pr => {
      const l = computeLine(pr.product, pr.product.quantity, discountPct);
      subs += l.saleUnit * l.quantity; tcos += l.totalCost; net += l.netTotal; qtya += l.quantity;
    });
    const dc = num(getEffectiveCosts().designCost);
    const ap = num(state.alexPercent, 30);
    const lp = num(state.luisPercent, 70);
    return {
      clientTotal: subs + dc, quantity: qtya, saleUnit: qtya > 0 ? Math.round(subs / qtya) : subs,
      baseSale: subs, suggestedPrice: subs, netTotal: net,
      netUnit: qtya > 0 ? net / qtya : 0,
      alexUnitShare: qtya > 0 ? (net * (ap / 100)) / qtya : 0, luisUnitShare: qtya > 0 ? (net * (lp / 100)) / qtya : 0,
      alexShare: net * (ap / 100), luisShare: net * (lp / 100), designCost: dc,
    };
  }

  function computeAll() {
    const products = state.products || [];
    if (!products.length) {
      return { products: [], main: null, scenarios: [] };
    }
    const d = state.discounts || {};
    const totalQty = products.reduce((s, p) => s + num(p.quantity), 0);
    const wholesaleTier = state.wholesaleMode ? getTierDiscountPercent(state, totalQty, true) : 0;

    const productResults = products.map(prod => {
      const qty = Math.max(1, num(prod.quantity, 1));
      let disc = 0;
      if (state.wholesaleMode) { disc = wholesaleTier; }
      else if (prod.saleDiscountEnabled) { disc = Math.max(0, Math.min(100, num(prod.saleDiscountPercent))); }
      const line = computeLine(prod, qty, disc);
      return { product: prod, line };
    });

    const main = aggregateMain(productResults);
    const scenarioDefs = [
      { key: 'range10_50', discount: num(d.range10_50) },
      { key: 'range50_100', discount: num(d.range50_100) },
      { key: 'range100plus', discount: num(d.range100plus) },
    ];
    const scenarios = scenarioDefs.map(def => ({
      key: def.key, range: getDiscountRanges(state)[def.key],
      label: formatRangeLabel(getDiscountRanges(state)[def.key], def.key),
      discount: def.discount, line: aggregateScenarioLine(productResults, def.discount),
    }));
    return { products: productResults, main, scenarios };
  }

  // ── API helpers ──

  async function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = opts.headers || {};
    if (!opts.method || opts.method === 'POST') {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['x-csrf-token'] = csrfToken;
    }
    if (opts.body && typeof opts.body === 'object') opts.body = JSON.stringify(opts.body);
    const r = await fetch(path, opts);
    const text = await r.text();
    let data = {};
    if (text) { try { data = JSON.parse(text); } catch (e) { throw new Error('La API no respondió correctamente.'); } }
    if (!r.ok) throw new Error(data.error || 'Error de servidor');
    return data;
  }

  // ── Read state from DOM ──

  function readStateFromDom() {
    const $ = (id) => { const el = app.querySelector('#' + id); return el ? el.value : ''; };
    const $$ = (sel) => app.querySelector(sel);

    state.costs.printerId = $('cq-printerId') || state.costs.printerId;
    state.costs.materialId = $('cq-materialId') || state.costs.materialId;
    state.costs.designCost = num($('cq-designCost'), state.costs.designCost);
    state.costs.profitPercent = num($('cq-profitPercent'), state.costs.profitPercent);
    state.costs.hourRate = num($('cq-hourRate'), state.costs.hourRate);
    state.costs.kgPrice = num($('cq-kgPrice'), state.costs.kgPrice);

    ['range10_50', 'range50_100', 'range100plus'].forEach(key => {
      const discEl = $('cq-discount-' + key);
      if (discEl) state.discounts[key] = Math.max(0, Math.min(100, num(discEl.value, state.discounts[key])));
      state.discountRanges[key].min = Math.max(1, num($('cq-range-' + key + '-min'), state.discountRanges[key].min));
      if (key !== 'range100plus')
        state.discountRanges[key].max = Math.max(state.discountRanges[key].min, num($('cq-range-' + key + '-max'), state.discountRanges[key].max));
      else state.discountRanges[key].max = null;
    });

    state.alexPercent = Math.max(0, Math.min(100, num($('cq-alexPercent'), state.alexPercent)));
    state.luisPercent = Math.max(0, Math.min(100, 100 - state.alexPercent));

    const ge = $$('[data-cq="globalDiscountEnabled"]');
    if (ge) state.globalDiscount.enabled = ge.checked;
    const gp = $$('[data-cq="globalDiscountPct"]');
    if (gp) state.globalDiscount.percent = Math.max(0, Math.min(100, num(gp.value)));

    const wm = $$('[data-cq="wholesaleMode"]');
    if (wm) state.wholesaleMode = wm.checked;

    // Read products from DOM
    const lines = app.querySelectorAll('[data-cq-product-line]');
    state.products = [];
    lines.forEach((el, idx) => {
      const pName = (el.querySelector('[data-cq-product-name]') || {}).value;
      const pQty = num((el.querySelector('[data-cq-product-qty]') || {}).value, 1);
      const pGrams = num((el.querySelector('[data-cq-product-grams]') || {}).value);
      const pHours = num((el.querySelector('[data-cq-product-hours]') || {}).value);
      const pMode = (el.querySelector('[data-cq-product-mode]') || {}).value || 'unit';
      const pSalePrice = num((el.querySelector('[data-cq-product-sale-price]') || {}).value);
      const pSaleTouched = (el.querySelector('[data-cq-product-sale-touched]') || {}).checked || false;
      const pDiscEnabled = (el.querySelector('[data-cq-product-discount-enabled]') || {}).checked || false;
      const pDiscPct = num((el.querySelector('[data-cq-product-discount-pct]') || {}).value);

      // Read additionals
      const addLines = el.querySelectorAll('[data-cq-additional]');
      const additionals = [];
      addLines.forEach(al => {
        const price = num((al.querySelector('[data-cq-additional-price]') || {}).value);
        const desc = (al.querySelector('[data-cq-additional-desc]') || {}).value || '';
        const showOnInvoice = (al.querySelector('[data-cq-additional-show]') || {}).checked !== false;
        if (desc || price > 0) additionals.push({ price, description: desc, showOnInvoice });
      });

      state.products.push({
        id: el.dataset.productId || ('p' + idx),
        name: pName || '', quantity: Math.max(1, pQty), grams: pGrams, printHours: pHours,
        qtyInputMode: pMode, additionals,
        salePriceManual: pSalePrice, salePriceTouched: pSaleTouched,
        saleDiscountEnabled: pDiscEnabled, saleDiscountPercent: pDiscPct,
      });
    });

    if (!state.products.length) state.products = [defaultProduct()];

    // Export fields
    state.export.clientName = $('cq-clientName') || state.export.clientName;
    state.export.clientEmail = $('cq-clientEmail') || state.export.clientEmail;
    state.export.clientPhone = $('cq-clientPhone') || state.export.clientPhone;
    state.export.orderTitle = $('cq-orderTitle') || state.export.orderTitle;
    state.export.description = $('cq-description') || state.export.description;
    state.export.deliveryDays = num($('cq-deliveryDays'), state.export.deliveryDays);
    state.export.validDays = num($('cq-validDays'), state.export.validays);
    state.export.shippingCost = num($('cq-shippingCost'), state.export.shippingCost);
    state.export.includeIva = (app.querySelector('[data-cq="includeIva"]') || {}).checked || false;
    state.export.quoteEmail = $('cq-quoteEmail') || state.export.quoteEmail;
  }

  // ── Render functions ──

  function renderProducts() {
    const container = app.querySelector('[data-cq-products]');
    if (!container) return;
    if (!state.products.length) {
      container.innerHTML = '<p class="cq-empty">Aún no hay productos. Agregá el primer ítem con el botón «Agregar producto».</p>';
      return;
    }
    const wholesaleOn = state.wholesaleMode;
    const result = computeAll();

    container.innerHTML = state.products.map((p, idx) => {
      const pr = (result.products && result.products[idx]) || { product: p, line: computeLine(p, Math.max(1, num(p.quantity)), 0) };
      const m = pr.line;
      const saleDisplay = p.salePriceTouched ? p.salePriceManual : Math.round(m.suggestedPrice);
      const qty = Math.max(1, num(p.quantity, 1));
      const canRemove = state.products.length > 1;
      const additionals = getProductAdditionals(p);

      const gramsLabel = p.qtyInputMode === 'total_batch' ? 'Gramos (total lote)' : 'Gramos / unidad';
      const hoursLabel = p.qtyInputMode === 'total_batch' ? 'Horas impresión (total lote)' : 'Horas impresión / unidad';

      let addsHtml = '';
      additionals.forEach(a => {
        addsHtml += `<div class="cq-additional-row" data-cq-additional>
          <input class="cq-field__input cq-field__input--sm" data-cq-additional-desc value="${escapeHtml(a.description)}" placeholder="Descripción" maxlength="200">
          <input class="cq-field__input cq-field__input--sm cq-field__input--num" data-cq-additional-price value="${a.price || ''}" placeholder="0" type="number" min="0" step="1">
          <label class="cq-switch cq-switch--compact"><input type="checkbox" data-cq-additional-show ${a.showOnInvoice !== false ? 'checked' : ''}><span class="cq-switch__label">Mostrar</span></label>
        </div>`;
      });

      return `<section class="cq-card cq-card--editable cq-card--product" data-cq-product-line data-product-id="${escapeHtml(p.id || '')}">
        <div class="cq-card__head-row">
          <h3 class="cq-card__title">Producto ${idx + 1}</h3>
          ${canRemove ? `<button type="button" class="cq-btn cq-btn--rm cq-btn--danger" data-cq-remove-product="${idx}">✕ Eliminar</button>` : ''}
        </div>
        <div class="cq-qty-mode-bar">
          <div class="cq-field">
            <label class="cq-field__label">Nombre</label>
            <input class="cq-field__input" type="text" data-cq-product-name value="${escapeHtml(p.name || '')}" placeholder="Ej. Copa Mundial" maxlength="200">
          </div>
          <div class="cq-field">
            <label class="cq-field__label">Cantidad</label>
            <input class="cq-field__input cq-field__input--num" type="number" data-cq-product-qty value="${qty}" min="1" step="1">
          </div>
          <div class="cq-field">
            <label class="cq-field__label">${gramsLabel}</label>
            <input class="cq-field__input cq-field__input--num" type="number" data-cq-product-grams value="${p.grams || 0}" min="0" step="0.1">
          </div>
          <div class="cq-field">
            <label class="cq-field__label">${hoursLabel}</label>
            <input class="cq-field__input cq-field__input--num" type="number" data-cq-product-hours value="${p.printHours || 0}" min="0" step="0.1">
          </div>
          <div class="cq-mode-toggle">
            <button type="button" class="${p.qtyInputMode !== 'total_batch' ? 'active' : ''}" data-cq-product-mode-btn="${idx}" data-mode="per_unit">Por unidad</button>
            <button type="button" class="${p.qtyInputMode === 'total_batch' ? 'active' : ''}" data-cq-product-mode-btn="${idx}" data-mode="total_batch">Total lote</button>
          </div>
        </div>
        <div class="cq-additionals-section">
          <div class="cq-additionals-section__head">
            <h4>Adicionales</h4>
            <button type="button" class="cq-btn cq-btn--sm cq-btn--ghost" data-cq-add-additional="${idx}">+ Agregar adicional</button>
          </div>
          ${addsHtml}
        </div>
        <div class="cq-product-line__xtra">
          <div class="cq-field cq-field--switch">
            <label class="cq-switch"><input type="checkbox" data-cq-product-sale-touched ${p.salePriceTouched ? 'checked' : ''}><span class="cq-switch__label">Precio manual</span></label>
            <input class="cq-field__input cq-field__input--num cq-field__input--sm" type="number" data-cq-product-sale-price value="${saleDisplay}" min="0" step="1">
          </div>
          <div class="cq-field cq-field--switch">
            <label class="cq-switch"><input type="checkbox" data-cq-product-discount-enabled ${p.saleDiscountEnabled ? 'checked' : ''}><span class="cq-switch__label">Descuento</span></label>
            <input class="cq-field__input cq-field__input--num cq-field__input--sm" type="number" data-cq-product-discount-pct value="${p.saleDiscountPercent || 0}" min="0" max="100" step="1">
            <span class="cq-field__suffix">%</span>
          </div>
        </div>
        <div class="cq-bd-row">
          <div class="cq-bd-cell"><span class="cq-bd-label">Costo mat.</span><span class="cq-bd-val">${fmtCrc(m.materialCost)}</span></div>
          <div class="cq-bd-cell"><span class="cq-bd-label">Costo tiempo</span><span class="cq-bd-val">${fmtCrc(m.timeCost)}</span></div>
          <div class="cq-bd-cell"><span class="cq-bd-label">Prod /u</span><span class="cq-bd-val">${fmtCrc(m.materialCost + m.timeCost)}</span></div>
          <div class="cq-bd-cell"><span class="cq-bd-label">Sugerido</span><span class="cq-bd-val">${fmtCrc(m.suggestedPrice)}</span></div>
          <div class="cq-bd-cell cq-bd-cell--highlight"><span class="cq-bd-label">Venta/u</span><span class="cq-bd-val">${fmtCrc(m.saleUnit)}</span></div>
          <div class="cq-bd-cell"><span class="cq-bd-label">Total venta</span><span class="cq-bd-val">${fmtCrc(m.saleUnit * qty)}</span></div>
        </div>
      </section>`;
    }).join('');
  }

  function renderResults() {
    const wrap = app.querySelector('[data-cq-results]');
    if (!wrap) return;
    if (!state.products.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';

    const result = computeAll();
    const m = result.main;
    if (!m || !m.quantity) { wrap.style.display = 'none'; return; }
    const multi = m.productCount > 1;

    wrap.innerHTML = `<div class="cq-results-grid">
      <div class="cq-r-item"><span class="cq-r-label">Precio sugerido ${multi ? 'total' : '/ unidad'}</span><span class="cq-r-val">${fmtCrc(multi ? m.suggestedTotal : m.suggestedPrice)}</span></div>
      ${multi ? `<div class="cq-r-item"><span class="cq-r-label">Precio sugerido prom. / uds</span><span class="cq-r-val">${fmtCrc(m.suggestedUnitAvg)}</span></div>` : ''}
      <div class="cq-r-item"><span class="cq-r-label">Subtotal venta</span><span class="cq-r-val">${fmtCrc(m.subtotalGross)}</span></div>
      <div class="cq-r-item"><span class="cq-r-label">Total productos + diseño</span><span class="cq-r-val">${fmtCrc(m.clientTotal)}</span></div>
      ${state.globalDiscount.enabled && state.globalDiscount.percent > 0 ? `<div class="cq-r-item cq-r-item--discount"><span class="cq-r-label">Descuento global (${state.globalDiscount.percent}%)</span><span class="cq-r-val">-${fmtCrc(m.globalDiscountAmount)}</span></div>` : ''}
    </div>
    <div class="cq-price-row">
      <div class="cq-profit-block cq-profit-block--alex">
        <h4>Ganancia Alex (+ diseño)</h4>
        <span class="cq-profit-val">${fmtCrc(m.alexShare)}</span>
        <span class="cq-profit-unit">${fmtCrc(m.alexUnitShare)} /u</span>
        <small>${state.alexPercent}%</small>
      </div>
      <div class="cq-profit-block cq-profit-block--luis">
        <h4>Ganancia Luis</h4>
        <span class="cq-profit-val">${fmtCrc(m.luisShare)}</span>
        <span class="cq-profit-unit">${fmtCrc(m.luisUnitShare)} /u</span>
        <small>${state.luisPercent}%</small>
      </div>
    </div>
    ${state.wholesaleMode ? renderScenarios(result) : ''}`;
  }

  function renderScenarios(result) {
    return `<div class="cq-scenarios">
      <h3 class="cq-section-title">Rangos con descuento</h3>
      <div class="cq-scenarios-grid">
        ${result.scenarios.map(sc => `<div class="cq-scenario-card">
          <div class="cq-scenario-card__head">${escapeHtml(sc.label)}</div>
          <div class="cq-scenario-card__disc">${sc.discount}% desc.</div>
          <div class="cq-scenario-card__body">
            <div class="cq-sc-row"><span>Precio / u</span><span>${fmtCrc(sc.line.saleUnit)}</span></div>
            <div class="cq-sc-row"><span>Total + diseño</span><span>${fmtCrc(sc.line.clientTotal)}</span></div>
            <div class="cq-sc-row"><span>Gan. neta</span><span>${fmtCrc(sc.line.netTotal)}</span></div>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  function renderCatalogPanel(type) {
    const container = app.querySelector('[data-cq-catalog-panel]');
    if (!container) return;
    if (type === 'impresoras') {
      container.innerHTML = catalog.printers.map(p => `
        <div class="cq-catalog-row"><span class="cq-catalog-row__name">${escapeHtml(p.name)}</span><span class="cq-catalog-row__val">${fmtCrc(p.hourRate)}/h</span>
        <button class="cq-btn cq-btn--sm cq-btn--ghost" data-cq-catalog-edit="printer" data-cq-catalog-id="${escapeHtml(p.id)}">Editar</button>
        <button class="cq-btn cq-btn--sm cq-btn--danger" data-cq-catalog-delete="printer" data-cq-catalog-id="${escapeHtml(p.id)}">✕</button></div>`).join('')
        + '<div class="cq-catalog-add"><input type="text" id="cq-new-printer-name" placeholder="Nombre"><input type="number" id="cq-new-printer-rate" placeholder="₡/h" min="0"><button class="cq-btn cq-btn--primary cq-btn--sm" data-cq-catalog-save="printer">Guardar</button></div>';
    } else if (type === 'materiales') {
      container.innerHTML = catalog.materials.map(m => `
        <div class="cq-catalog-row"><span class="cq-catalog-row__name">${escapeHtml(m.name)}</span><span class="cq-catalog-row__val">${fmtCrc(m.kgPrice)}/kg</span>
        <button class="cq-btn cq-btn--sm cq-btn--ghost" data-cq-catalog-edit="material" data-cq-catalog-id="${escapeHtml(m.id)}">Editar</button>
        <button class="cq-btn cq-btn--sm cq-btn--danger" data-cq-catalog-delete="material" data-cq-catalog-id="${escapeHtml(m.id)}">✕</button></div>`).join('')
        + '<div class="cq-catalog-add"><input type="text" id="cq-new-material-name" placeholder="Nombre"><input type="number" id="cq-new-material-rate" placeholder="₡/kg" min="0"><button class="cq-btn cq-btn--primary cq-btn--sm" data-cq-catalog-save="material">Guardar</button></div>';
    } else if (type === 'adicionales') {
      container.innerHTML = catalog.additionals.map(a => `
        <div class="cq-catalog-row"><span class="cq-catalog-row__name">${escapeHtml(a.description)}</span><span class="cq-catalog-row__val">${fmtCrc(a.price)}</span>
        <button class="cq-btn cq-btn--sm cq-btn--ghost" data-cq-catalog-edit="additional" data-cq-catalog-id="${escapeHtml(a.id)}">Editar</button>
        <button class="cq-btn cq-btn--sm cq-btn--danger" data-cq-catalog-delete="additional" data-cq-catalog-id="${escapeHtml(a.id)}">✕</button></div>`).join('')
        + '<div class="cq-catalog-add"><input type="text" id="cq-new-additional-desc" placeholder="Descripción"><input type="number" id="cq-new-additional-price" placeholder="₡" min="0"><button class="cq-btn cq-btn--primary cq-btn--sm" data-cq-catalog-save="additional">Guardar</button></div>';
    }
  }

  function renderExportSection() {
    const exp = state.export;
    app.querySelector('[data-cq-export]').innerHTML = `
      <div class="cq-grid cq-grid--3">
        <div class="cq-field"><label class="cq-field__label">Cliente</label><input class="cq-field__input" type="text" id="cq-clientName" value="${escapeHtml(exp.clientName)}" placeholder="Nombre del cliente"></div>
        <div class="cq-field"><label class="cq-field__label">Email</label><input class="cq-field__input" type="email" id="cq-clientEmail" value="${escapeHtml(exp.clientEmail)}" placeholder="email@ejemplo.com"></div>
        <div class="cq-field"><label class="cq-field__label">Teléfono</label><input class="cq-field__input" type="text" id="cq-clientPhone" value="${escapeHtml(exp.clientPhone)}" placeholder="+506 8888-8888"></div>
      </div>
      <div class="cq-grid cq-grid--2">
        <div class="cq-field"><label class="cq-field__label">Título de orden</label><input class="cq-field__input" type="text" id="cq-orderTitle" value="${escapeHtml(exp.orderTitle)}" placeholder="Ej. Pedido Copa Mundial"></div>
        <div class="cq-field"><label class="cq-field__label">Descripción</label><textarea class="cq-field__input" id="cq-description" rows="2" placeholder="Viñetas (una por línea)">${escapeHtml(exp.description)}</textarea></div>
      </div>
      <div class="cq-grid cq-grid--4">
        <div class="cq-field"><label class="cq-field__label">Días entrega</label><input class="cq-field__input cq-field__input--num" type="number" id="cq-deliveryDays" value="${exp.deliveryDays || ''}" min="0"></div>
        <div class="cq-field"><label class="cq-field__label">Validez (días)</label><input class="cq-field__input cq-field__input--num" type="number" id="cq-validDays" value="${exp.validDays || 15}" min="0"></div>
        <div class="cq-field"><label class="cq-field__label">Envío (₡)</label><input class="cq-field__input cq-field__input--num" type="number" id="cq-shippingCost" value="${exp.shippingCost || 0}" min="0" step="100"></div>
        <div class="cq-field cq-field--switch"><label class="cq-switch"><input type="checkbox" data-cq="includeIva" ${exp.includeIva ? 'checked' : ''}><span class="cq-switch__label">Incluir IVA</span></label></div>
      </div>
      <div class="cq-grid cq-grid--2">
        <div class="cq-field"><label class="cq-field__label">Términos de pago</label><input class="cq-field__input" type="text" id="cq-paymentTerms" value="${escapeHtml(exp.paymentTerms)}"></div>
        <div class="cq-field"><label class="cq-field__label">Garantía</label><input class="cq-field__input" type="text" id="cq-warranty" value="${escapeHtml(exp.warranty)}"></div>
      </div>
      <div class="cq-field"><label class="cq-field__label">Notas extra</label><textarea class="cq-field__input" id="cq-extraNotes" rows="2" placeholder="Notas adicionales">${escapeHtml(exp.extraNotes || '')}</textarea></div>
      <div class="cq-field"><label class="cq-field__label">Email cotización</label><select class="cq-field__input" id="cq-quoteEmail">
        <option value="info@ninjalab3d.com" ${exp.quoteEmail === 'info@ninjalab3d.com' ? 'selected' : ''}>info@ninjalab3d.com</option>
        <option value="lquijano@ninjalab3d.com" ${exp.quoteEmail === 'lquijano@ninjalab3d.com' ? 'selected' : ''}>lquijano@ninjalab3d.com</option>
        <option value="badilla@ninjalab3d.com" ${exp.quoteEmail === 'badilla@ninjalab3d.com' ? 'selected' : ''}>badilla@ninjalab3d.com</option>
      </select></div>`;
  }

  function render() {
    readStateFromDom();
    renderProducts();
    renderResults();
    renderExportSection();
    if (activeTab !== 'cotizacion') renderCatalogPanel(activeTab);
  }

  // ── Event handlers ──

  app.addEventListener('click', e => {
    // Tab switching
    const tab = e.target.closest('[data-cq-tab]');
    if (tab) {
      activeTab = tab.dataset.cqTab;
      app.querySelectorAll('[data-cq-tab]').forEach(t => t.classList.toggle('active', t === tab));
      app.querySelectorAll('[data-cq-panel]').forEach(p => p.classList.toggle('active', p.dataset.cqPanel === activeTab));
      if (activeTab === 'cotizacion') render();
      else renderCatalogPanel(activeTab);
      return;
    }

    // Catalog save
    const catSave = e.target.closest('[data-cq-catalog-save]');
    if (catSave) {
      const type = catSave.dataset.cqCatalogSave;
      saveCatalogItem(type);
      return;
    }

    // Catalog delete
    const catDel = e.target.closest('[data-cq-catalog-delete]');
    if (catDel) {
      deleteCatalogItem(catDel.dataset.cqCatalogType, catDel.dataset.cqCatalogId);
      return;
    }

    // Catalog edit
    const catEdit = e.target.closest('[data-cq-catalog-edit]');
    if (catEdit) {
      const type = catEdit.dataset.cqCatalogType;
      const id = catEdit.dataset.cqCatalogId;
      const list = type === 'additional' ? catalog.additionals : type === 'printer' ? catalog.printers : catalog.materials;
      const item = list.find(x => x.id === id);
      if (item) {
        // Pre-fill the add form with existing values
        if (type === 'printer') {
          app.querySelector('#cq-new-printer-name').value = item.name;
          app.querySelector('#cq-new-printer-rate').value = item.hourRate;
        } else if (type === 'material') {
          app.querySelector('#cq-new-material-name').value = item.name;
          app.querySelector('#cq-new-material-rate').value = item.kgPrice;
        } else {
          app.querySelector('#cq-new-additional-desc').value = item.description;
          app.querySelector('#cq-new-additional-price').value = item.price;
        }
      }
      return;
    }

    // Add product
    const addBtn = e.target.closest('[data-cq-add-product]');
    if (addBtn) {
      state.products.push(defaultProduct());
      render();
      return;
    }

    // Remove product
    const rmBtn = e.target.closest('[data-cq-remove-product]');
    if (rmBtn) {
      const idx = parseInt(rmBtn.dataset.cqRemoveProduct, 10);
      if (state.products.length > 1) { state.products.splice(idx, 1); render(); }
      return;
    }

    // Add additional
    const addAddBtn = e.target.closest('[data-cq-add-additional]');
    if (addAddBtn) {
      const idx = parseInt(addAddBtn.dataset.cqAddAdditional, 10);
      if (state.products[idx]) {
        if (!state.products[idx].additionals) state.products[idx].additionals = [];
        state.products[idx].additionals.push({ price: 0, description: '', showOnInvoice: true });
        render();
      }
      return;
    }

    // Product mode toggle
    const modeBtn = e.target.closest('[data-cq-product-mode-btn]');
    if (modeBtn) {
      const idx = parseInt(modeBtn.dataset.cqProductModeBtn, 10);
      const mode = modeBtn.dataset.mode;
      if (state.products[idx]) {
        state.products[idx].qtyInputMode = mode;
        render();
      }
      return;
    }

    // Save quote
    const saveBtn = e.target.closest('[data-cq-save-quote]');
    if (saveBtn) {
      saveQuote();
      return;
    }

    // Load quote
    const loadBtn = e.target.closest('[data-cq-load-quote]');
    if (loadBtn) {
      loadQuote(loadBtn.dataset.cqLoadQuote);
      return;
    }

    // Delete quote
    const delBtn = e.target.closest('[data-cq-delete-quote]');
    if (delBtn) {
      deleteQuote(delBtn.dataset.cqDeleteQuote);
      return;
    }

    // New quote
    const newBtn = e.target.closest('[data-cq-new-quote]');
    if (newBtn) {
      state.products = [defaultProduct()];
      state.currentSavedQuoteId = '';
      state.export = { ...state.export, clientName: '', clientEmail: '', clientPhone: '', orderTitle: '', description: '', includeIva: false, shippingCost: 0 };
      render();
      return;
    }

    // Export PDF
    const pdfBtn = e.target.closest('[data-cq-export-pdf]');
    if (pdfBtn) {
      exportPdf();
      return;
    }

    // Send email
    const emailBtn = e.target.closest('[data-cq-send-email]');
    if (emailBtn) {
      sendEmail();
      return;
    }
  });

  // Re-render on input changes (debounced)
  let renderTimeout;
  app.addEventListener('input', e => {
    if (e.target.closest('[data-cq-products]') || e.target.closest('[data-cq="wholesaleMode"]') ||
        e.target.closest('[data-cq="globalDiscountEnabled"]') || e.target.closest('[data-cq="globalDiscountPct"]') ||
        e.target.closest('#cq-alexPercent')) {
      clearTimeout(renderTimeout);
      renderTimeout = setTimeout(render, 150);
    }
  });

  // ── Catalog operations ──

  async function saveCatalogItem(type) {
    let body;
    if (type === 'additional') {
      const desc = app.querySelector('#cq-new-additional-desc')?.value?.trim();
      const price = num(app.querySelector('#cq-new-additional-price')?.value);
      if (!desc) return alert('Indicá la descripción del adicional.');
      body = { id: '', description: desc, price };
    } else if (type === 'printer') {
      const name = app.querySelector('#cq-new-printer-name')?.value?.trim();
      const rate = num(app.querySelector('#cq-new-printer-rate')?.value);
      if (!name) return alert('Indicá el nombre de la impresora.');
      body = { id: '', name, hourRate: rate };
    } else {
      const name = app.querySelector('#cq-new-material-name')?.value?.trim();
      const rate = num(app.querySelector('#cq-new-material-rate')?.value);
      if (!name) return alert('Indicá el nombre del material.');
      body = { id: '', name, kgPrice: rate };
    }
    try {
      const data = await api('/admin/cotizacion-3d/catalog', { method: 'POST', body: { type, item: body } });
      if (data.catalog) {
        catalog.additionals = data.catalog.additionals || [];
        catalog.printers = data.catalog.printers || [];
        catalog.materials = data.catalog.materials || [];
      }
      renderCatalogPanel(activeTab);
    } catch (err) { alert(err.message); }
  }

  async function deleteCatalogItem(type, id) {
    if (!confirm('¿Eliminar este ítem del catálogo?')) return;
    try {
      const data = await api(`/admin/cotizacion-3d/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (data.catalog) {
        catalog.additionals = data.catalog.additionals || [];
        catalog.printers = data.catalog.printers || [];
        catalog.materials = data.catalog.materials || [];
      }
      renderCatalogPanel(activeTab);
    } catch (err) { alert(err.message); }
  }

  // ── Quote operations ──

  async function saveQuote() {
    readStateFromDom();
    const result = computeAll();
    const name = state.export.orderTitle || (state.products[0]?.name || 'Cotización');
    try {
      const data = await api('/admin/cotizacion-3d/quotes', {
        method: 'POST',
        body: { snapshot: state, name, totalCrc: result.main?.clientTotal || 0 }
      });
      if (data.ok || data.id) {
        state.currentSavedQuoteId = data.id;
        alert('Cotización guardada.');
        loadSavedQuotes();
      }
    } catch (err) { alert(err.message); }
  }

  async function loadQuote(id) {
    try {
      const data = await api(`/admin/cotizacion-3d/quotes/${encodeURIComponent(id)}`);
      if (data.payload) {
        Object.assign(state, data.payload);
        state.currentSavedQuoteId = id;
        render();
      }
    } catch (err) { alert(err.message); }
  }

  async function deleteQuote(id) {
    if (!confirm('¿Eliminar esta cotización?')) return;
    try {
      await api(`/admin/cotizacion-3d/quotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.currentSavedQuoteId = '';
      loadSavedQuotes();
    } catch (err) { alert(err.message); }
  }

  async function loadSavedQuotes() {
    try {
      const data = await api('/admin/cotizacion-3d/quotes/list');
      if (Array.isArray(data)) {
        renderSavedQuotesList(data);
      }
    } catch (err) { console.error('Error loading saved quotes:', err); }
  }

  function renderSavedQuotesList(quotes) {
    const container = app.querySelector('[data-cq-saved-list]');
    if (!container) return;
    container.innerHTML = quotes.map(q => `
      <div class="cq-saved-row">
        <span class="cq-saved-row__name">${escapeHtml(q.productName || 'Sin nombre')}</span>
        <span class="cq-saved-row__status">${escapeHtml(q.workflowStatus || 'pendiente')}</span>
        <span class="cq-saved-row__total">${fmtCrc(q.totalCrc)}</span>
        <button class="cq-btn cq-btn--sm cq-btn--ghost" data-cq-load-quote="${escapeHtml(q.id)}">Cargar</button>
        <button class="cq-btn cq-btn--sm cq-btn--danger" data-cq-delete-quote="${escapeHtml(q.id)}">✕</button>
      </div>`).join('');
  }

  // ── PDF Export (html2canvas + jsPDF) ──

  async function exportPdf() {
    readStateFromDom();
    if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
      alert('Cargando librerías de PDF...');
      return;
    }
    try {
      const data = await api('/admin/cotizacion-3d/pdf-data', {
        method: 'POST', body: { snapshot: state }
      });
      const pdfData = data.pdfData || {};

      // Render offscreen HTML for PDF
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-9999px;top:0;width:1080px;';
      container.innerHTML = buildPdfHtml(state, computeAll(), pdfData.logo || '');
      document.body.appendChild(container);

      // Wait for images to load
      await new Promise(r => setTimeout(r, 500));

      const { jsPDF } = jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const canvas = await html2canvas(container.firstElementChild, {
        scale: 2, useCORS: true, backgroundColor: '#ffffff',
        width: 1080, windowWidth: 1080,
      });
      document.body.removeChild(container);

      const imgData = canvas.toDataURL('image/png');
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);

      // Generate filename: NinjaLab_cotizacion_Cliente_DDMMYY.pdf
      const clientName = state.export.clientName || 'Cliente';
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const aa = String(d.getFullYear()).slice(-2);
      const safe = clientName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '') || 'Cliente';
      const filename = `NinjaLab_cotizacion_${safe}_${dd}${mm}${aa}.pdf`;

      pdf.save(filename);
    } catch (err) {
      console.error('PDF error:', err);
      alert('Error al generar PDF: ' + err.message);
    }
  }

  function buildPdfHtml(state, result, logoUrl) {
    const exp = state.export || {};
    const m = result.main || {};
    const includeIva = !!exp.includeIva;
    const wholesaleMode = !!state.wholesaleMode;
    const designCost = roundMoney(state.costs.designCost);
    const validDays = exp.validDays || 15;
    const deliveryDays = exp.deliveryDays || 5;
    const products = result.products || [];
    const qty = m.quantity || 1;

    function withIvaLocal(amount) { return includeIva ? roundMoney(amount * (1 + IVA_RATE)) : roundMoney(amount); }

    let rows = '';
    products.forEach((pr, idx) => {
      const p = pr.product;
      const l = pr.line;
      const pqty = l.quantity;
      const baseSale = roundMoney(l.baseSale || l.suggestedPrice);
      const visibleExtraTotal = sumVisibleAdditionals(p);
      const unitPrice = roundMoney(baseSale - visibleExtraTotal);
      const discPct = l.discountPercent || 0;
      const discPerUnit = discPct > 0 ? roundMoney(unitPrice * (discPct / 100)) : 0;
      const total = roundMoney((unitPrice - discPerUnit) * pqty);

      rows += `<tr><td class="num">${idx + 1}</td><td class="service">${escapeHtml(p.name || 'Impresión 3D')}</td>
        <td class="description">${escapeHtml((idx === 0 ? exp.description : p.description) || 'Impresión 3D de alta calidad')}</td>
        <td class="center">${pqty}</td>
        <td class="money">${fmtMoney(withIvaLocal(unitPrice))}</td>
        ${discPct > 0 ? `<td class="money discount">-${fmtMoney(withIvaLocal(discPerUnit))}</td>` : '<td class="center">—</td>'}
        <td class="money"><strong>${fmtMoney(withIvaLocal(total))}</strong></td></tr>`;

      // Visible additionals
      getProductAdditionals(p).forEach(extra => {
        if (!extra.showOnInvoice || extra.price <= 0) return;
        rows += `<tr><td></td><td class="service">${escapeHtml(extra.description || 'Adicional')}</td>
          <td class="description">Servicio complementario</td><td class="center">${pqty}</td>
          <td class="money">${fmtMoney(withIvaLocal(extra.price))}</td>
          <td class="center">—</td>
          <td class="money"><strong>${fmtMoney(withIvaLocal(extra.price * pqty))}</strong></td></tr>`;
      });
    });

    // Design line
    if (!wholesaleMode && designCost > 0) {
      rows += `<tr><td></td><td class="service">Diseño personalizado</td><td>Diseño de modelo y adaptación para impresión</td><td class="center">1</td><td class="money">${fmtMoney(withIvaLocal(designCost))}</td><td class="center">—</td><td class="money"><strong>${fmtMoney(withIvaLocal(designCost))}</strong></td></tr>`;
    }

    // Totals
    const itemCalc = products.reduce((s, pr) => {
      const p = pr.product;
      const unitBase = roundMoney(pr.line.baseSale || pr.line.suggestedPrice);
      const visibleAdd = sumVisibleAdditionals(p);
      const unit = roundMoney(unitBase - visibleAdd);
      const disc = pr.line.discountPercent || 0;
      const discPer = disc > 0 ? roundMoney(unit * (disc / 100)) : 0;
      return s + roundMoney((unit - discPer) * pr.line.quantity);
    }, 0);

    const shippingWithIva = withIvaLocal(exp.shippingCost || 0);
    const totalBeforeDesign = itemCalc + (wholesaleMode ? 0 : designCost);
    const grandTotal = roundMoney(totalBeforeDesign + shippingWithIva);

    let ivaDisplay = '—';
    if (includeIva) {
      const ivaPart = roundMoney(grandTotal - grandTotal / (1 + IVA_RATE));
      ivaDisplay = fmtMoney(ivaPart);
    }

    const showDiscountCol = products.some(pr => (pr.line.discountPercent || 0) > 0);
    const footerEmail = exp.quoteEmail || 'info@ninjalab3d.com';

    return `<div class="cq-pdf-root"><main class="quote-page">
<header class="header">
  <div class="brand">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" class="logo-full" alt="Logo">` : '<span class="logo-text">Ninja Lab 3D</span>'}</div>
  <div class="title-box"><h1 class="title"><span class="arrows">»</span>Cotización</h1><div class="date">Fecha: ${new Date().toLocaleDateString('es-CR')}</div></div>
</header>
<section class="top-info">
  <div class="client"><h2>Cliente:</h2><div class="client-name">${escapeHtml(exp.clientName || 'Cliente')}</div><div class="client-subtitle">${escapeHtml(exp.orderTitle || '')}</div></div>
  <div class="cards">
    <div class="info-card"><div class="icon-circle">📅</div><div><small>Válida por:</small><strong>${validDays} días</strong></div></div>
    ${deliveryDays > 0 ? `<div class="info-card"><div class="icon-circle">⏱</div><div><small>Entrega estimada:</small><strong>${deliveryDays} días hábiles</strong></div></div>` : ''}
    <div class="info-card"><div class="icon-circle">📦</div><div><small>Productos:</small><strong>${products.length}</strong></div></div>
  </div>
</section>
<section class="items">
  <table class="quote-table"><thead><tr><th>#</th><th>Servicio</th><th>Descripción</th><th>Cant.</th><th>Precio/u</th>${showDiscountCol ? '<th>Desc.</th>' : ''}<th>Total</th></tr></thead><tbody>${rows}</tbody></table>
</section>
<section class="summary-section">
  <div class="summary-box">
    <div class="summary-row"><strong>Subtotal</strong><span>${fmtMoney(itemCalc)}</span></div>
    ${designCost > 0 && !wholesaleMode ? `<div class="summary-row"><strong>* Diseño</strong><span>${fmtMoney(withIvaLocal(designCost))}</span></div>` : ''}
    ${shippingWithIva > 0 ? `<div class="summary-row"><strong>Envío</strong><span>${fmtMoney(shippingWithIva)}</span></div>` : ''}
    <div class="summary-row"><strong>IVA</strong><span>${ivaDisplay}</span></div>
    <div class="summary-row summary-total"><strong>TOTAL</strong><span>${fmtMoney(grandTotal)}</span></div>
  </div>
</section>
<section class="notes">
  ${deliveryDays > 0 ? `<div class="note"><span class="note-icon">⏱</span>Entrega estimada: ${deliveryDays} días hábiles posteriores a la confirmación del pago.</div>` : ''}
  <div class="note"><span class="note-icon">💳</span>${escapeHtml(exp.paymentTerms)}</div>
  <div class="note"><span class="note-icon">🛡</span>${escapeHtml(exp.warranty)}</div>
  <div class="note"><span class="note-icon">✓</span>Precios ${includeIva ? 'incluyen' : 'no incluyen'} IVA.</div>
  ${exp.extraNotes ? `<div class="note"><span class="note-icon">✓</span>${escapeHtml(exp.extraNotes)}</div>` : ''}
</section>
<section class="transfer-info">
  <h3>Datos para transferencia:</h3>
  <div>Titular: Luis Quijano Aguilar</div>
  <div>Cédula: 1-1461-0619</div>
  <div>IBAN: CR85016111116160804858</div>
  <div>SINPE Móvil: 8614-3452</div>
</section>
<footer class="footer">
  <div>${escapeHtml(footerEmail)} · (506) 7024-0270 · www.ninjalab3d.com</div>
</footer>
</main></div>`;
  }

  // ── Email send ──

  async function sendEmail() {
    readStateFromDom();
    const exp = state.export;
    if (!exp.clientEmail) return alert('Indicá el email del cliente.');
    try {
      const data = await api('/admin/cotizacion-3d/send-email', {
        method: 'POST',
        body: { snapshot: state, clientEmail: exp.clientEmail, clientName: exp.clientName }
      });
      if (data.ok) alert('Cotización enviada por email.');
      else alert(data.error || 'Error al enviar.');
    } catch (err) { alert(err.message); }
  }

  // ── Initial render ──
  activeTab = 'cotizacion';
  render();
  loadSavedQuotes();

})();
