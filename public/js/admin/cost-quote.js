/**
 * Cotización 3D — Client calculator & admin module.
 * Mirrors services/costQuoteCalculator.js formulas exactly.
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
    // Read wholesale tiers from DOM
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
      const gTotal = gPerUnit * effQty;
      const hTotal = hPerUnit * effQty;
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
        gramsPerUnit: gPerUnit, gramsTotal: gTotal,
        hoursPerUnit: hPerUnit, hoursTotal: hTotal,
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
    const totalDesign = cfg.designCost;

    let wholesalePct = 0;
    if (cfg.wholesaleEnabled && cfg.wholesaleTiers && cfg.wholesaleTiers.length) {
      const qtyForTier = cfg.wholesaleScenarioQty || totalQty;
      wholesalePct = wholesaleDiscountPct(qtyForTier, cfg.wholesaleTiers);
      if (wholesalePct > 0) {
        subtotal = subtotal * (1 - wholesalePct / 100);
      }
    }

    let globalDiscountAmt = 0;
    if (cfg.globalDiscountEnabled && cfg.globalDiscountPct > 0) {
      globalDiscountAmt = subtotal * (cfg.globalDiscountPct / 100);
      subtotal = subtotal - globalDiscountAmt;
    }

    const subtotalBeforeTax = subtotal;
    subtotal += cfg.shippingCost;
    const ivaAmount = cfg.includeIva ? subtotal * 0.13 : 0;
    const grandTotal = subtotal + ivaAmount;

    const totalNetProfit = grandTotal - totalProduction - totalAdditional - totalDesign - cfg.shippingCost - ivaAmount;
    const alexShare = totalNetProfit * (cfg.alexPct / 100);
    const luisShare = totalNetProfit * ((100 - cfg.alexPct) / 100);

    // Render results
    const body = document.querySelector('[data-cq-results-body]');
    if (!body) return;

    const fmt = (n) => '₡' + round2(n).toLocaleString('es-CR', { minimumFractionDigits: 2 });

    let html = '<div style="overflow-x:auto"><table><thead><tr>';
    html += '<th>Producto</th><th>Cant</th><th>Modo</th><th>Mat/unit</th><th>Impr/unit</th><th>Prod/unit</th>';
    html += '<th>Sugerido</th><th>Venta/unit</th><th>Total</th><th>Neto/unit</th>';
    html += '</tr></thead><tbody>';
    lines.forEach(l => {
      html += `<tr>
        <td>${l.name}</td><td>${l.quantity}</td><td>${l.inputMode === 'total_batch' ? 'Total' : 'Unit'}</td>
        <td>${fmt(l.materialPerUnit)}</td><td>${fmt(l.printingPerUnit)}</td><td>${fmt(l.productionPerUnit)}</td>
        <td>${fmt(l.suggestedPerUnit)}${l.useManualPrice ? ' ✎' : ''}</td>
        <td>${fmt(l.discountedPerUnit)}</td><td>${fmt(l.saleTotal)}</td><td>${fmt(l.netProfitPerUnit)}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';

    // Totals
    html += '<div class="cq-results__totals"><dl>';
    html += `<dt>Costo producción total</dt><dd>${fmt(totalProduction)}</dd>`;
    html += `<dt>Adicionales total</dt><dd>${fmt(totalAdditional)}</dd>`;
    html += `<dt>Diseño</dt><dd>${fmt(totalDesign)}</dd>`;
    if (wholesalePct > 0) html += `<dt>Mayorista (${round2(wholesalePct)}%)</dt><dd>-${fmt(subtotalBeforeTax * wholesalePct / 100)}</dd>`;
    if (cfg.globalDiscountEnabled && cfg.globalDiscountPct > 0) html += `<dt>Descuento global (${cfg.globalDiscountPct}%)</dt><dd>-${fmt(globalDiscountAmt)}</dd>`;
    html += `<dt>Envío</dt><dd>${fmt(cfg.shippingCost)}</dd>`;
    html += `<dt>Subtotal</dt><dd>${fmt(subtotalBeforeTax + cfg.shippingCost)}</dd>`;
    if (cfg.includeIva) html += `<dt>IVA (13%)</dt><dd>${fmt(ivaAmount)}</dd>`;
    html += `<dt class="cq-total-grand">Total cliente</dt><dd class="cq-total-grand">${fmt(grandTotal)}</dd>`;
    html += `<dt>Ganancia neta total</dt><dd>${fmt(totalNetProfit)}</dd>`;
    html += `<dt>Alex (${cfg.alexPct}%)</dt><dd>${fmt(alexShare)}</dd>`;
    html += `<dt>Luis (${100 - cfg.alexPct}%)</dt><dd>${fmt(luisShare)}</dd>`;
    html += '</dl></div>';

    body.innerHTML = html;
  }

  // ── Render product lines from state ──
  function renderProducts() {
    const container = document.querySelector('[data-cq-products]');
    if (!container) return;
    if (!state.products.length) {
      container.innerHTML = '<p class="cq-empty">Sin productos. Agrega uno para empezar.</p>';
      return;
    }
    container.innerHTML = state.products.map((p, i) => `
      <div class="cq-product-line" data-cq-product-line>
        <div class="cq-product-line__header">
          <input type="text" data-cq-product-name value="${(p.name||'').replace(/"/g,'&quot;')}" placeholder="Nombre" maxlength="200" class="cq-input--sm">
          <button type="button" class="cq-btn cq-btn--sm cq-btn--danger" data-cq-product-remove data-idx="${i}">✕</button>
        </div>
        <div class="cq-product-line__body">
          <label class="cq-label">Cantidad <input type="number" data-cq-product-qty value="${p.quantity||1}" min="1"></label>
          <label class="cq-label">Gramos <input type="number" data-cq-product-grams value="${p.grams||0}" step="0.1" min="0"></label>
          <label class="cq-label">Horas impresión <input type="number" data-cq-product-hours value="${p.printHours||0}" step="0.1" min="0"></label>
          <label class="cq-label">Modo <select data-cq-product-mode>
            <option value="per_unit" ${p.inputMode!=='total_batch'?'selected':''}>Por unidad</option>
            <option value="total_batch" ${p.inputMode==='total_batch'?'selected':''}>Total lote</option>
          </select></label>
          <label class="cq-label">Adicionales ₡<input type="number" data-cq-product-additional value="${p.additionalCosts||0}" step="100" min="0"></label>
          <label class="cq-check"><input type="checkbox" data-cq-product-manual-enabled ${p.manualPriceEnabled?'checked':''}> Precio manual</label>
          <label class="cq-label">Precio manual ₡<input type="number" data-cq-product-manual-price value="${p.manualPrice||0}" step="100" min="0"></label>
          <label class="cq-check"><input type="checkbox" data-cq-product-discount-enabled ${p.discountEnabled?'checked':''}> Descuento</label>
          <label class="cq-label">% Desc <input type="number" data-cq-product-discount-pct value="${p.discountPct||0}" step="1" min="0" max="100"></label>
        </div>
      </div>
    `).join('');
  }

  // ── Event delegation ──
  document.getElementById('cost-quote-app').addEventListener('click', function (e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    // Add product
    if (btn.hasAttribute('data-cq-add-product')) {
      state.products.push({
        name: '', quantity: 1, grams: 0, printHours: 0, inputMode: 'per_unit',
        additionalCosts: 0, manualPriceEnabled: false, manualPrice: 0,
        discountEnabled: false, discountPct: 0,
      });
      renderProducts();
      return;
    }

    // Remove product
    if (btn.hasAttribute('data-cq-product-remove')) {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      state.products.splice(idx, 1);
      renderProducts();
      recompute();
      return;
    }

    // Recompute
    if (btn.hasAttribute('data-cq-recompute')) {
      recompute();
      return;
    }

    // Save quote
    if (btn.hasAttribute('data-cq-save')) {
      readState();
      saveQuote();
      return;
    }

    // Export PDF
    if (btn.hasAttribute('data-cq-export-pdf')) {
      readState();
      recompute();
      generatePDF();
      return;
    }

    // Tab switching
    if (btn.hasAttribute('data-cq-tab')) {
      const tab = btn.getAttribute('data-cq-tab');
      document.querySelectorAll('.cq-tab').forEach(t => t.classList.toggle('active', t === btn));
      document.querySelectorAll('.cq-panel').forEach(p => p.classList.toggle('active', p.getAttribute('data-cq-panel') === tab));
      return;
    }

    // Catalog save
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

    // Catalog delete
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

    // Catalog create
    if (btn.hasAttribute('data-cq-catalog-create')) {
      const catType = btn.getAttribute('data-type');
      const container = btn.closest('[data-cq-catalog]');
      const data = {
        catalog_type: catType,
        name: container.querySelector('[data-cq-new-name]')?.value || '',
        unit_label: container.querySelector('[data-cq-new-unit-label]')?.value || '',
        unit_cost: container.querySelector('[data-cq-new-unit-cost]')?.value || '0',
        price: container.querySelector('[data-cq-new-price]')?.value || '0',
        is_resin: container.querySelector('[data-cq-new-resin]')?.checked ? '1' : '0',
      };
      fetch('/admin/cotizacion-3d/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CSRF-Token': csrfToken },
        body: new URLSearchParams({ ...data, _csrf: csrfToken }),
      }).then(r => r.json()).then(d => { if (d.id) location.reload(); else alert(d.error); });
      return;
    }

    // Quote load
    if (btn.hasAttribute('data-cq-quote-load')) {
      const id = btn.getAttribute('data-id');
      fetch(`/admin/cotizacion-3d/quotes/${id}`)
        .then(r => r.json())
        .then(q => {
          loadQuoteIntoState(q);
          renderProducts();
          recompute();
          // Switch to cotización tab
          document.querySelector('[data-cq-tab="cotizacion"]').click();
        });
      return;
    }

    // Quote delete
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

  // Input change → recompute-lite on key fields
  document.getElementById('cost-quote-app').addEventListener('input', function (e) {
    // Recompute only for numeric inputs in calculator section
    const field = e.target;
    if (field.closest('[data-cq-products]') || field.hasAttribute('data-cq') || field.hasAttribute('data-cq-product-hours') || field.hasAttribute('data-cq-product-grams') || field.hasAttribute('data-cq-product-qty')) {
      // Debounce
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
    // Toggle wholesale tiers
    if (field.hasAttribute('data-cq') && field.getAttribute('data-cq') === 'wholesaleEnabled') {
      const tiers = document.querySelector('[data-cq-wholesale-tiers]');
      if (tiers) tiers.style.display = field.checked ? '' : 'none';
    }
    // Auto-update Luis %
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
      if (d.id) {
        state.currentQuoteId = d.id;
        alert('Cotización guardada.');
      } else {
        alert(d.error || 'Error al guardar.');
      }
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
    // Restore wholesale tiers to DOM
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

  // ── PDF export (simple print-based) ──
  function generatePDF() {
    const results = document.querySelector('[data-cq-results-body]')?.innerHTML || '';
    const printWin = window.open('', '_blank', 'width=800,height=600');
    printWin.document.write(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>Cotización 3D</title>
      <style>
        body { font-family: sans-serif; font-size: 11pt; color: #111; padding: 1.5rem; max-width: 800px; margin: auto; }
        table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
        th, td { padding: 4px 8px; border: 1px solid #ccc; text-align: left; font-size: 10pt; }
        th { background: #f0f0f0; }
        h1 { font-size: 18pt; margin: 0 0 0.5rem; }
        .meta { color: #555; margin-bottom: 1rem; font-size: 10pt; }
        .totals { margin-top: 1rem; padding-top: 0.5rem; border-top: 2px solid #000; }
        .totals dl { display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; }
        .totals dt { color: #555; }
        .totals dd { font-weight: bold; text-align: right; margin: 0; }
        .grand { border-top: 2px solid #000; padding-top: 4px; font-size: 14pt; }
      </style></head><body>
      <h1>${state.title || 'Cotización 3D'}</h1>
      <div class="meta">
        <p>Cliente: ${state.clientName || '—'} | Email: ${state.clientEmail || '—'} | Tel: ${state.clientPhone || '—'}</p>
        <p>Entrega: ${state.deliveryDays || '—'} días | Vigencia: ${state.validityDays || 15} días | Envío: ₡${round2(state.shippingCost).toLocaleString()}</p>
        <p>${state.description || ''}</p>
      </div>
      ${results}
      <p style="margin-top:1rem;font-size:10pt;color:#555">${state.paymentTerms || ''}</p>
      <p style="font-size:10pt;color:#555">${state.warranty || ''}</p>
      <p style="font-size:10pt;color:#555">${state.extraNotes || ''}</p>
      <script>window.onload=function(){window.print();}<\/script>
      </body></html>
    `);
    printWin.document.close();
  }

  // ── Init ──
  renderProducts();
})();
