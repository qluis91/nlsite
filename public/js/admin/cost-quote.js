/**
 * Cotización 3D — Client calculator & admin module.
 * Mirrors services/costQuoteCalculator.js formulas exactly.
 * Renders legacy-parity card-based UI.
 */
(function () {
  'use strict';

  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

  // ── Formula helpers (mirrors server calculator) ──
  const round2 = (n) => Math.round((n || 0) * 100) / 100;
  const materialCost = (g, kg) => (g / 1000) * kg;
  const printingCost = (h, rate) => h * rate;
  const productionCost = (g, kg, h, rate) => materialCost(g, kg) + printingCost(h, rate);
  const suggestedSale = (g, kg, h, rate, profit, adds) =>
    productionCost(g, kg, h, rate) * (1 + profit / 100) + (adds || 0);
  const applyDiscount = (price, enabled, pct) =>
    !enabled || !pct ? price : price * (1 - pct / 100);
  const effectiveQty = (qty, mode) => mode === 'total_batch' ? 1 : (qty || 1);
  const wholesaleDiscountPct = (qty, tiers) => {
    if (!tiers || !tiers.length) return 0;
    for (const t of tiers) {
      if (qty >= t.min && qty <= t.max) return t.pct;
    }
    const last = tiers[tiers.length - 1];
    return qty > last.max ? last.pct : 0;
  };

  // ── State ──
  const state = {
    selectedPrinterId: '',
    selectedMaterialId: '',
    hourRate: 300,
    kgPrice: 20500,
    profitPct: 100,
    alexPct: 30,
    designCost: 0,
    products: [],
    globalDiscountEnabled: false,
    globalDiscountPct: 0,
    wholesaleEnabled: false,
    wholesaleTiers: [
      { min: 10, max: 50, pct: 5 },
      { min: 50, max: 100, pct: 10 },
      { min: 100, max: 999999, pct: 15 },
    ],
    wholesaleScenarioQty: null,
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    title: '',
    description: '',
    deliveryDays: null,
    validityDays: 15,
    shippingCost: 0,
    paymentTerms: '50% anticipo, 50% contra entrega.',
    warranty: '30 días por defectos de fabricación.',
    extraNotes: '',
    includeIva: false,
    quoteEmail: '',
    currentQuoteId: null,
  };

  function getVal(sel) {
    const el = document.querySelector(`[data-cq="${sel}"]`);
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  }

  function setVal(sel, val) {
    const el = document.querySelector(`[data-cq="${sel}"]`);
    if (!el) return;
    if (el.type === 'checkbox') { el.checked = !!val; return; }
    el.value = val ?? '';
  }

  // ── Snapshot products from DOM ──
  function snapshotProducts() {
    const lines = document.querySelectorAll('[data-cq-product-line]');
    const products = [];
    lines.forEach(line => {
      products.push({
        name: line.querySelector('[data-cq-product-name]')?.value || '',
        quantity: parseInt(line.querySelector('[data-cq-product-qty]')?.value, 10) || 1,
        grams: parseFloat(line.querySelector('[data-cq-product-grams]')?.value) || 0,
        printHours: parseFloat(line.querySelector('[data-cq-product-hours]')?.value) || 0,
        inputMode: line.querySelector('[data-cq-product-mode]')?.value || 'per_unit',
        additionalCosts: parseFloat(line.querySelector('[data-cq-product-additional]')?.value) || 0,
        manualPriceEnabled: line.querySelector('[data-cq-product-manual-enabled]')?.checked || false,
        manualPrice: parseFloat(line.querySelector('[data-cq-product-manual-price]')?.value) || 0,
        discountEnabled: line.querySelector('[data-cq-product-discount-enabled]')?.checked || false,
        discountPct: parseFloat(line.querySelector('[data-cq-product-discount-pct]')?.value) || 0,
      });
    });
    return products;
  }

  function readState() {
    state.selectedPrinterId = getVal('selectedPrinterId');
    state.selectedMaterialId = getVal('selectedMaterialId');
    state.hourRate = parseFloat(getVal('hourRate')) || 300;
    state.kgPrice = parseFloat(getVal('kgPrice')) || 20500;
    state.profitPct = parseFloat(getVal('profitPct')) || 100;
    state.alexPct = parseFloat(getVal('alexPct')) || 30;
    state.designCost = parseFloat(getVal('designCost')) || 0;
    state.globalDiscountEnabled = getVal('globalDiscountEnabled');
    state.globalDiscountPct = parseFloat(getVal('globalDiscountPct')) || 0;
    state.wholesaleEnabled = getVal('wholesaleEnabled');
    state.wholesaleScenarioQty = parseInt(getVal('wholesaleScenarioQty'), 10) || null;
    const tierEls = document.querySelectorAll('[data-cq-wholesale-tier]');
    if (tierEls.length) {
      const mins = [10, 50, 100], maxs = [50, 100, 999999];
      state.wholesaleTiers = Array.from(tierEls).map((el, i) => ({
        min: mins[i], max: maxs[i], pct: parseFloat(el.value) || 0,
      }));
    }
    state.clientName = getVal('clientName');
    state.clientEmail = getVal('clientEmail');
    state.clientPhone = getVal('clientPhone');
    state.title = getVal('title');
    state.description = getVal('description');
    state.deliveryDays = parseInt(getVal('deliveryDays'), 10) || null;
    state.validityDays = parseInt(getVal('validityDays'), 10) || 15;
    state.shippingCost = parseFloat(getVal('shippingCost')) || 0;
    state.paymentTerms = getVal('paymentTerms');
    state.warranty = getVal('warranty');
    state.extraNotes = getVal('extraNotes');
    state.includeIva = getVal('includeIva');
    state.quoteEmail = getVal('quoteEmail');
    state.products = snapshotProducts();
  }

  // ── Recompute ──
  function recompute() {
    readState();

    const cfg = {
      hourRate: state.hourRate,
      kgPrice: state.kgPrice,
      profitPct: state.profitPct,
      alexPct: state.alexPct,
      luisPct: 100 - state.alexPct,
      designCost: state.designCost,
      shippingCost: state.shippingCost,
      includeIva: state.includeIva,
      wholesaleEnabled: state.wholesaleEnabled,
      wholesaleTiers: state.wholesaleTiers,
      wholesaleScenarioQty: state.wholesaleScenarioQty,
      globalDiscountEnabled: state.globalDiscountEnabled,
      globalDiscountPct: state.globalDiscountPct,
    };

    const totalQty = state.products.reduce((s, p) => s + (p.quantity || 1), 0);
    const designCostTotalQty = totalQty;

    const lines = state.products.map((product, idx) => {
      const qty = product.quantity || 1;
      const mode = product.inputMode || 'per_unit';
      const effQty = effectiveQty(qty, mode);
      const gPerUnit = product.grams || 0;
      const hPerUnit = product.printHours || 0;
      const matPerUnit = materialCost(gPerUnit, cfg.kgPrice);
      const printPerUnit = printingCost(hPerUnit, cfg.hourRate);
      const prodPerUnit = matPerUnit + printPerUnit;
      const prodTotal = prodPerUnit * effQty;
      const addPerUnit = (product.additionalCosts || 0) / qty;
      const suggestedPerUnit = suggestedSale(gPerUnit, cfg.kgPrice, hPerUnit, cfg.hourRate, cfg.profitPct, addPerUnit);
      const useManualPrice = product.manualPriceEnabled && product.manualPrice > 0;
      const basePerUnit = useManualPrice ? product.manualPrice : suggestedPerUnit;
      const designShare = designCostTotalQty > 0 ? cfg.designCost * (qty / designCostTotalQty) : 0;
      const discountedPerUnit = applyDiscount(basePerUnit, product.discountEnabled, product.discountPct);
      const saleTotal = discountedPerUnit * qty + designShare;
      return {
        idx, name: product.name || `Producto ${idx + 1}`,
        quantity: qty, inputMode: mode,
        gramsPerUnit: gPerUnit, gramsTotal: gPerUnit * effQty,
        hoursPerUnit: hPerUnit, hoursTotal: hPerUnit * effQty,
        materialPerUnit: matPerUnit, materialTotal: matPerUnit * qty,
        printingPerUnit: printPerUnit, printingTotal: printPerUnit * qty,
        productionPerUnit: prodPerUnit, productionTotal: prodTotal,
        additionalPerUnit: addPerUnit, additionalTotal: addPerUnit * qty,
        suggestedPerUnit, useManualPrice, basePerUnit,
        discountedPerUnit, designShare, saleTotal,
        netProfitPerUnit: discountedPerUnit - prodPerUnit - addPerUnit,
        netProfitTotal: (discountedPerUnit - prodPerUnit - addPerUnit) * qty,
      };
    });

    let subtotal = lines.reduce((s, l) => s + l.saleTotal, 0);
    const totalProduction = lines.reduce((s, l) => s + l.productionTotal, 0);
    const totalAdditional = lines.reduce((s, l) => s + l.additionalTotal, 0);

    let wholesalePct = 0;
    let wholesaleAmt = 0;
    if (cfg.wholesaleEnabled && cfg.wholesaleTiers && cfg.wholesaleTiers.length) {
      const qtyForTier = cfg.wholesaleScenarioQty || totalQty;
      wholesalePct = wholesaleDiscountPct(qtyForTier, cfg.wholesaleTiers);
      if (wholesalePct > 0) {
        wholesaleAmt = subtotal * (wholesalePct / 100);
        subtotal = subtotal - wholesaleAmt;
      }
    }

    const subtotalBeforeDiscount = subtotal + wholesaleAmt;
    let globalDiscountAmt = 0;
    if (cfg.globalDiscountEnabled && cfg.globalDiscountPct > 0) {
      globalDiscountAmt = subtotal * (cfg.globalDiscountPct / 100);
      subtotal = subtotal - globalDiscountAmt;
    }

    subtotal += cfg.shippingCost;
    const ivaAmount = cfg.includeIva ? subtotal * 0.13 : 0;
    const grandTotal = subtotal + ivaAmount;

    const totalNetProfit = grandTotal - totalProduction - totalAdditional - cfg.designCost - cfg.shippingCost - ivaAmount;
    const alexShare = totalNetProfit * (cfg.alexPct / 100);
    const luisShare = totalNetProfit * ((100 - cfg.alexPct) / 100);

    // Render results
    const wrap = document.querySelector('[data-cq-results]');
    if (!wrap) return;
    const hasProducts = lines.length > 0;
    wrap.style.display = hasProducts ? '' : 'none';
    if (!hasProducts) { updateProductBreakdowns(lines); return; }

    const fmt = (n) => '₡' + round2(n).toLocaleString('es-CR', { minimumFractionDigits: 2 });
    let html = '';

    // Summary grid
    html += '<div class="cq-results-grid">';
    html += `<div class="cq-results-grid__item"><span class="cq-r-label">Costo producción</span><span class="cq-r-value">${fmt(totalProduction)}</span></div>`;
    html += `<div class="cq-results-grid__item"><span class="cq-r-label">Adicionales</span><span class="cq-r-value">${fmt(totalAdditional)}</span></div>`;
    html += `<div class="cq-results-grid__item"><span class="cq-r-label">Diseño</span><span class="cq-r-value">${fmt(cfg.designCost)}</span></div>`;
    if (wholesalePct > 0) {
      html += `<div class="cq-results-grid__item"><span class="cq-r-label">Desc. mayorista (${round2(wholesalePct)}%)</span><span class="cq-r-value">-${fmt(wholesaleAmt)}</span></div>`;
    }
    if (cfg.globalDiscountEnabled && cfg.globalDiscountPct > 0) {
      html += `<div class="cq-results-grid__item"><span class="cq-r-label">Desc. global (${cfg.globalDiscountPct}%)</span><span class="cq-r-value">-${fmt(globalDiscountAmt)}</span></div>`;
    }
    html += `<div class="cq-results-grid__item"><span class="cq-r-label">Envío</span><span class="cq-r-value">${fmt(cfg.shippingCost)}</span></div>`;
    html += `<div class="cq-results-grid__item"><span class="cq-r-label">Subtotal</span><span class="cq-r-value">${fmt(subtotalBeforeDiscount - wholesaleAmt - globalDiscountAmt + cfg.shippingCost)}</span></div>`;
    if (cfg.includeIva) {
      html += `<div class="cq-results-grid__item"><span class="cq-r-label">IVA (13%)</span><span class="cq-r-value">${fmt(ivaAmount)}</span></div>`;
    }
    html += '</div>';

    // Big price row
    html += `<div class="cq-price-row"><span class="cq-price-row__label">Total cliente</span><span class="cq-price-row__value">${fmt(grandTotal)}</span></div>`;

    // Alex / Luis blocks
    html += '<div class="cq-profit-blocks">';
    html += `<div class="cq-profit-block"><div class="cq-profit-block__label">Alex</div><div class="cq-profit-block__value">${fmt(alexShare)}</div><div class="cq-profit-block__pct">${cfg.alexPct}% — Ganancia neta: ${fmt(totalNetProfit)}</div></div>`;
    html += `<div class="cq-profit-block"><div class="cq-profit-block__label">Luis</div><div class="cq-profit-block__value">${fmt(luisShare)}</div><div class="cq-profit-block__pct">${100 - cfg.alexPct}%</div></div>`;
    html += '</div>';

    // Per-product breakdown table
    if (lines.length) {
      html += '<table class="cq-results-table"><thead><tr>';
      html += '<th>Producto</th><th class="cq-results-table__num">Venta/u</th><th class="cq-results-table__num">Total</th><th class="cq-results-table__num">Neto</th>';
      html += '</tr></thead><tbody>';
      lines.forEach(l => {
        html += `<tr>
          <td>${l.name} ×${l.quantity} <span style="color:#555">(${l.inputMode==='total_batch'?'Total':'Unit'})</span></td>
          <td class="cq-results-table__num">${fmt(l.discountedPerUnit)}</td>
          <td class="cq-results-table__num">${fmt(l.saleTotal)}</td>
          <td class="cq-results-table__num">${fmt(l.netProfitTotal)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }

    wrap.innerHTML = html;

    // Update inline product breakdowns
    updateProductBreakdowns(lines);
  }

  function updateProductBreakdowns(lines) {
    const fmt = (n) => '₡' + round2(n).toLocaleString('es-CR', { minimumFractionDigits: 2 });
    const productLines = document.querySelectorAll('[data-cq-product-line]');
    productLines.forEach((el, i) => {
      const l = lines[i];
      if (!l) return;
      let bd = el.querySelector('[data-cq-product-breakdown]');
      if (!bd) {
        bd = document.createElement('div');
        bd.className = 'cq-product-line__breakdown';
        bd.setAttribute('data-cq-product-breakdown', '');
        el.appendChild(bd);
      }
      bd.innerHTML = `
        <div class="cq-bd-cell"><span class="cq-bd-cell__label">Material</span><span class="cq-bd-cell__value">${fmt(l.materialPerUnit)}</span></div>
        <div class="cq-bd-cell"><span class="cq-bd-cell__label">Impresión</span><span class="cq-bd-cell__value">${fmt(l.printingPerUnit)}</span></div>
        <div class="cq-bd-cell"><span class="cq-bd-cell__label">Prod.</span><span class="cq-bd-cell__value">${fmt(l.productionPerUnit)}</span></div>
        <div class="cq-bd-cell"><span class="cq-bd-cell__label">Sugerido${l.useManualPrice?' ✎':''}</span><span class="cq-bd-cell__value">${fmt(l.suggestedPerUnit)}</span></div>
        <div class="cq-bd-cell cq-bd-cell--highlight"><span class="cq-bd-cell__label">Venta/u</span><span class="cq-bd-cell__value">${fmt(l.discountedPerUnit)}</span></div>
        <div class="cq-bd-cell"><span class="cq-bd-cell__label">Total venta</span><span class="cq-bd-cell__value">${fmt(l.saleTotal)}</span></div>
      `;
    });
  }

  // ── Render product lines ──
  function renderProducts() {
    const container = document.querySelector('[data-cq-products]');
    if (!container) return;
    if (!state.products.length) {
      container.innerHTML = '<p class="cq-empty">Aún no hay productos. Usa el botón «Agregar producto» para añadir el primer ítem de la cotización.</p>';
      // Hide results when products removed
      const wrap = document.querySelector('[data-cq-results]');
      if (wrap) wrap.style.display = 'none';
      return;
    }
    container.innerHTML = state.products.map((p, i) => `
      <div class="cq-product-line" data-cq-product-line>
        <div class="cq-product-line__top">
          <input type="text" class="cq-product-line__name" data-cq-product-name value="${(p.name||'').replace(/"/g,'&quot;')}" placeholder="Nombre del producto" maxlength="200">
          <button type="button" class="cq-btn cq-btn--rm cq-btn--danger" data-cq-product-remove data-idx="${i}">✕</button>
        </div>
        <div class="cq-qty-mode-bar">
          <div class="cq-field">
            <label class="cq-field__label">Cantidad</label>
            <input class="cq-field__input" type="number" data-cq-product-qty value="${p.quantity||1}" min="1">
          </div>
          <div class="cq-field">
            <label class="cq-field__label">Gramos</label>
            <input class="cq-field__input" type="number" data-cq-product-grams value="${p.grams||0}" step="0.1" min="0">
          </div>
          <div class="cq-field">
            <label class="cq-field__label">Horas impresión</label>
            <input class="cq-field__input" type="number" data-cq-product-hours value="${p.printHours||0}" step="0.1" min="0">
          </div>
          <div class="cq-mode-toggle">
            <button type="button" class="${p.inputMode!=='total_batch'?'active':''}" data-cq-product-mode-btn data-idx="${i}" data-mode="per_unit">Por unidad</button>
            <button type="button" class="${p.inputMode==='total_batch'?'active':''}" data-cq-product-mode-btn data-idx="${i}" data-mode="total_batch">Total lote</button>
          </div>
        </div>
        <div class="cq-product-line__xtra">
          <div class="cq-field">
            <label class="cq-field__label">Adicionales</label>
            <input class="cq-field__input" type="number" data-cq-product-additional value="${p.additionalCosts||0}" step="100" min="0">
          </div>
          <div class="cq-field">
            <label class="cq-field__label">Precio manual</label>
            <input class="cq-field__input" type="number" data-cq-product-manual-price value="${p.manualPrice||0}" step="100" min="0">
          </div>
          <div class="cq-field cq-field--switch">
            <label class="cq-switch"><input type="checkbox" data-cq-product-manual-enabled ${p.manualPriceEnabled?'checked':''}><span class="cq-switch__label">Usar manual</span></label>
          </div>
          <div class="cq-field cq-field--discount">
            <label class="cq-switch"><input type="checkbox" data-cq-product-discount-enabled ${p.discountEnabled?'checked':''}><span class="cq-switch__label">Desc.</span></label>
            <input class="cq-field__input cq-field__input--sm" type="number" data-cq-product-discount-pct value="${p.discountPct||0}" step="1" min="0" max="100">
            <span class="cq-field__suffix">%</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  // ── Event delegation ──
  document.getElementById('cost-quote-app').addEventListener('click', function (e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.hasAttribute('data-cq-add-product')) {
      state.products.push({
        name: '', quantity: 1, grams: 0, printHours: 0, inputMode: 'per_unit',
        additionalCosts: 0, manualPriceEnabled: false, manualPrice: 0,
        discountEnabled: false, discountPct: 0,
      });
      renderProducts();
      return;
    }

    if (btn.hasAttribute('data-cq-product-remove')) {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      state.products.splice(idx, 1);
      renderProducts();
      recompute();
      return;
    }

    // Mode toggle
    if (btn.hasAttribute('data-cq-product-mode-btn')) {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      state.products[idx].inputMode = btn.getAttribute('data-mode');
      renderProducts();
      recompute();
      return;
    }

    if (btn.hasAttribute('data-cq-recompute')) { recompute(); return; }
    if (btn.hasAttribute('data-cq-save')) { readState(); saveQuote(); return; }
    if (btn.hasAttribute('data-cq-export-pdf')) { readState(); recompute(); generatePDF(); return; }

    if (btn.hasAttribute('data-cq-tab')) {
      const tab = btn.getAttribute('data-cq-tab');
      document.querySelectorAll('.cq-tab').forEach(t => t.classList.toggle('active', t === btn));
      document.querySelectorAll('.cq-panel').forEach(p => p.classList.toggle('active', p.getAttribute('data-cq-panel') === tab));
      return;
    }

    if (btn.hasAttribute('data-cq-catalog-save')) {
      const id = btn.getAttribute('data-id');
      const item = btn.closest('[data-cq-catalog-id]');
      if (!item) return;
      const data = {
        name: item.querySelector('[data-field="name"]')?.value || '',
        unit_cost: item.querySelector('[data-field="unit_cost"]')?.value || '0',
        price: item.querySelector('[data-field="price"]')?.value || '',
        description: item.querySelector('[data-field="description"]')?.value || '',
        is_resin: item.querySelector('[data-field="is_resin"]')?.checked ? '1' : '0',
      };
      fetch(`/admin/cotizacion-3d/catalog/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CSRF-Token': csrfToken },
        body: new URLSearchParams({ ...data, _csrf: csrfToken }),
      }).then(r => r.json()).then(d => { if (d.ok) location.reload(); else alert(d.error); });
      return;
    }

    if (btn.hasAttribute('data-cq-catalog-delete')) {
      if (!confirm('¿Eliminar este elemento?')) return;
      const id = btn.getAttribute('data-id');
      fetch(`/admin/cotizacion-3d/catalog/${id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CSRF-Token': csrfToken },
        body: new URLSearchParams({ _csrf: csrfToken }),
      }).then(r => r.json()).then(d => { if (d.ok) location.reload(); else alert(d.error); });
      return;
    }

    if (btn.hasAttribute('data-cq-catalog-create')) {
      const catType = btn.getAttribute('data-type');
      const cont = btn.closest('[data-cq-catalog]');
      const data = {
        catalog_type: catType,
        name: cont.querySelector('[data-cq-new-name]')?.value || '',
        unit_label: cont.querySelector('[data-cq-new-unit-label]')?.value || '',
        unit_cost: cont.querySelector('[data-cq-new-unit-cost]')?.value || '0',
        price: cont.querySelector('[data-cq-new-price]')?.value || '0',
        is_resin: cont.querySelector('[data-cq-new-resin]')?.checked ? '1' : '0',
      };
      fetch('/admin/cotizacion-3d/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CSRF-Token': csrfToken },
        body: new URLSearchParams({ ...data, _csrf: csrfToken }),
      }).then(r => r.json()).then(d => { if (d.id) location.reload(); else alert(d.error); });
      return;
    }

    if (btn.hasAttribute('data-cq-quote-load')) {
      const id = btn.getAttribute('data-id');
      fetch(`/admin/cotizacion-3d/quotes/${id}`)
        .then(r => r.json())
        .then(q => {
          loadQuoteIntoState(q);
          renderProducts();
          recompute();
          document.querySelector('[data-cq-tab="cotizacion"]').click();
        });
      return;
    }

    if (btn.hasAttribute('data-cq-quote-delete')) {
      if (!confirm('¿Eliminar esta cotización?')) return;
      const id = btn.getAttribute('data-id');
      fetch(`/admin/cotizacion-3d/quotes/${id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CSRF-Token': csrfToken },
        body: new URLSearchParams({ _csrf: csrfToken }),
      }).then(r => r.json()).then(d => { if (d.ok) location.reload(); else alert(d.error); });
      return;
    }
  });

  document.getElementById('cost-quote-app').addEventListener('input', function (e) {
    const field = e.target;
    if (field.closest('[data-cq-products]') || field.hasAttribute('data-cq') || field.hasAttribute('data-cq-product-hours') || field.hasAttribute('data-cq-product-grams') || field.hasAttribute('data-cq-product-qty')) {
      clearTimeout(window.__cqRecomputeTimer);
      window.__cqRecomputeTimer = setTimeout(recompute, 400);
    }
  });

  document.getElementById('cost-quote-app').addEventListener('change', function (e) {
    const field = e.target;
    if (field.hasAttribute('data-cq') || field.hasAttribute('data-cq-product-mode') || field.hasAttribute('data-cq-product-manual-enabled') || field.hasAttribute('data-cq-product-discount-enabled') || field.hasAttribute('data-cq-wholesale-tier')) {
      clearTimeout(window.__cqRecomputeTimer);
      window.__cqRecomputeTimer = setTimeout(recompute, 300);
    }
    if (field.hasAttribute('data-cq') && field.getAttribute('data-cq') === 'wholesaleEnabled') {
      const tiers = document.querySelector('[data-cq-wholesale-tiers]');
      if (tiers) tiers.style.display = field.checked ? '' : 'none';
    }
    if (field.hasAttribute('data-cq') && field.getAttribute('data-cq') === 'alexPct') {
      const luisEl = document.querySelector('[data-cq="luisPctDisplay"]');
      if (luisEl) luisEl.textContent = (100 - (parseFloat(field.value) || 0));
    }
  });

  // ── Save / Load ──
  function saveQuote() {
    const body = new URLSearchParams();
    body.append('_csrf', csrfToken);
    const fields = [
      'title','clientName','clientEmail','clientPhone','description',
      'deliveryDays','validityDays','shippingCost','paymentTerms','warranty','extraNotes',
      'includeIva','quoteEmail','globalDiscountEnabled','globalDiscountPct',
      'wholesaleEnabled','wholesaleScenarioQty',
      'designCost','profitPct','alexPct','hourRate','kgPrice',
      'selectedPrinterId','selectedMaterialId',
    ];
    fields.forEach(f => {
      const val = state[f];
      if (typeof val === 'boolean') body.append(f, val ? '1' : '0');
      else if (val !== null && val !== undefined) body.append(f, String(val));
    });
    body.append('luisPct', String(100 - state.alexPct));
    body.append('wholesaleTiers', JSON.stringify(state.wholesaleTiers));
    body.append('products', JSON.stringify(state.products));

    const url = state.currentQuoteId
      ? `/admin/cotizacion-3d/quotes/${state.currentQuoteId}`
      : '/admin/cotizacion-3d/quotes';

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CSRF-Token': csrfToken },
      body,
    }).then(r => r.json()).then(d => {
      if (d.id) { state.currentQuoteId = d.id; alert('Cotización guardada.'); }
      else alert(d.error || 'Error al guardar.');
    }).catch(() => alert('Error de conexión.'));
  }

  function loadQuoteIntoState(q) {
    state.currentQuoteId = q.id;
    setVal('title', q.title);
    setVal('clientName', q.client_name);
    setVal('clientEmail', q.client_email);
    setVal('clientPhone', q.client_phone);
    setVal('description', q.description);
    setVal('deliveryDays', q.delivery_days);
    setVal('validityDays', q.validity_days);
    setVal('shippingCost', q.shipping_cost);
    setVal('paymentTerms', q.payment_terms);
    setVal('warranty', q.warranty);
    setVal('extraNotes', q.extra_notes);
    setVal('includeIva', q.include_iva);
    setVal('quoteEmail', q.quote_email);
    setVal('globalDiscountEnabled', q.global_discount_enabled);
    setVal('globalDiscountPct', q.global_discount_pct);
    setVal('wholesaleEnabled', q.wholesale_enabled);
    setVal('wholesaleScenarioQty', q.wholesale_scenario_qty);
    setVal('designCost', q.design_cost);
    setVal('profitPct', q.profit_pct);
    setVal('alexPct', q.alex_pct);
    setVal('hourRate', q.hour_rate);
    setVal('kgPrice', q.kg_price);
    setVal('selectedPrinterId', q.selected_printer_id);
    setVal('selectedMaterialId', q.selected_material_id);
    document.querySelector('[data-cq="luisPctDisplay"]').textContent = q.luis_pct;

    state.products = typeof q.products === 'string' ? JSON.parse(q.products) : (q.products || []);
    state.wholesaleTiers = typeof q.wholesale_tiers === 'string' ? JSON.parse(q.wholesale_tiers) : (q.wholesale_tiers || []);
    if (state.wholesaleTiers && state.wholesaleTiers.length) {
      state.wholesaleTiers.forEach((t, i) => {
        const el = document.querySelector(`[data-cq-wholesale-tier="${i}"]`);
        if (el) el.value = t.pct;
      });
    }
    const tiersPanel = document.querySelector('[data-cq-wholesale-tiers]');
    if (tiersPanel) tiersPanel.style.display = state.wholesaleEnabled ? '' : 'none';
    readState();
  }

  function generatePDF() {
    const wrap = document.querySelector('[data-cq-results]')?.innerHTML || '';
    const printWin = window.open('', '_blank', 'width=800,height=600');
    printWin.document.write(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Cotización 3D</title>
      <style>
        body { font-family:sans-serif; font-size:11pt; color:#111; padding:1.5rem; max-width:800px; margin:auto }
        table { width:100%; border-collapse:collapse; margin:1rem 0 }
        th,td { padding:4px 8px; border:1px solid #ccc; text-align:left; font-size:10pt }
        th { background:#f0f0f0 } h1 { font-size:18pt; margin:0 0 .5rem }
        .meta { color:#555; margin-bottom:1rem; font-size:10pt }
      </style></head><body>
      <h1>${state.title||'Cotización 3D'}</h1>
      <div class="meta"><p>Cliente: ${state.clientName||'—'} | ${state.clientEmail||''} | ${state.clientPhone||''}</p>
      <p>Entrega: ${state.deliveryDays||'—'}d | Vigencia: ${state.validityDays||15}d | Envío: ₡${round2(state.shippingCost)}</p>
      <p>${state.description||''}</p></div>
      ${wrap}
      <p style="margin-top:1rem;font-size:10pt;color:#555">${state.paymentTerms||''}</p>
      <p style="font-size:10pt;color:#555">${state.warranty||''}</p>
      <p style="font-size:10pt;color:#555">${state.extraNotes||''}</p>
      <script>window.onload=function(){window.print()}<\\/script></body></html>`);
    printWin.document.close();
  }

  renderProducts();
})();
