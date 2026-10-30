/**
 * Cost-quote calculation functions — per-product costing + taxMode.
 * Product parameters resolve via costOverrides.enabled ? override : state.costs.
 */

const IVA_RATE = 0.13;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fallback || 0);
}

function roundMoney(n) {
  return Math.round(num(n));
}

function fmtCrc(n) {
  return '\u20A1' + roundMoney(n).toLocaleString('es-CR');
}

// ── Additionals helpers ──

function normalizeAdditional(v) {
  if (v && typeof v === 'object') {
    return {
      price: roundMoney(v.price),
      description: String(v.description || ''),
      showOnInvoice: v.showOnInvoice !== false,
    };
  }
  return { price: roundMoney(v), description: '', showOnInvoice: true };
}

function getProductAdditionals(p) {
  if (!p) return [];
  if (Array.isArray(p.additionals) && p.additionals.length) {
    return p.additionals.map(normalizeAdditional);
  }
  return [1, 2, 3].map(i => normalizeAdditional(p['additional' + i]));
}

function sumAdditionals(p) {
  return getProductAdditionals(p).reduce((s, a) => s + a.price, 0);
}

function sumVisibleAdditionals(p) {
  return getProductAdditionals(p).filter(a => a.showOnInvoice).reduce((s, a) => s + a.price, 0);
}

function sumHiddenAdditionals(p) {
  return getProductAdditionals(p).filter(a => !a.showOnInvoice).reduce((s, a) => s + a.price, 0);
}

// ── Discount ranges ──

function getDiscountRanges(state) {
  const dr = (state && state.discountRanges) || {};
  return {
    range10_50: {
      min: Math.max(1, num(dr.range10_50 && dr.range10_50.min, 10)),
      max: Math.max(1, num(dr.range10_50 && dr.range10_50.max, 50)),
    },
    range50_100: {
      min: Math.max(1, num(dr.range50_100 && dr.range50_100.min, 50)),
      max: Math.max(1, num(dr.range50_100 && dr.range50_100.max, 100)),
    },
    range100plus: {
      min: Math.max(1, num(dr.range100plus && dr.range100plus.min, 100)),
      max: null,
    },
  };
}

function getTierDiscountPercent(state, qty, wholesaleMode) {
  if (!wholesaleMode) return 0;
  const d = (state && state.discounts) || {};
  const r = getDiscountRanges(state);
  const n = num(qty);
  if (n >= r.range100plus.min) return num(d.range100plus);
  if (n >= r.range50_100.min) return num(d.range50_100);
  if (n >= r.range10_50.min) return num(d.range10_50);
  return 0;
}

// ── Product cost parameter resolver ──

function emptyCostOverrides() {
  return {
    enabled: false,
    printerId: '',
    printerName: '',
    electricityCostPerHour: 0,
    machineWearCostPerHour: 0,
    hourRate: 0,
    materialId: '',
    materialName: '',
    kgPrice: 0,
    designCost: 0,
    profitPercent: 100,
  };
}

/**
 * Normalize a raw costs / override blob into a canonical param shape.
 * Legacy hourRate-only → electricity=0, wear=hourRate.
 * hourRate always = electricity + wear.
 */
function normalizeCostParams(raw, source) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hasElec = r.electricityCostPerHour != null;
  const hasWear = r.machineWearCostPerHour != null;
  let electricityCostPerHour = num(r.electricityCostPerHour);
  let machineWearCostPerHour = num(r.machineWearCostPerHour);
  let hourRate = num(r.hourRate, 300);

  if (!hasElec && !hasWear) {
    electricityCostPerHour = 0;
    machineWearCostPerHour = hourRate;
  } else {
    hourRate = electricityCostPerHour + machineWearCostPerHour;
  }

  return {
    source: source === 'override' ? 'override' : 'base',
    printerId: String(r.printerId || ''),
    printerName: String(r.printerName || ''),
    electricityCostPerHour,
    machineWearCostPerHour,
    hourRate,
    materialId: String(r.materialId || ''),
    materialName: String(r.materialName || ''),
    kgPrice: num(r.kgPrice, 20500),
    designCost: num(r.designCost),
    profitPercent: num(r.profitPercent, 100),
  };
}

/**
 * Canonical product parameter resolver.
 * Override ON → product.costOverrides; else → state.costs.
 */
function resolveProductCostParams(state, product) {
  const overrides = product && product.costOverrides;
  if (overrides && overrides.enabled === true) {
    return normalizeCostParams(overrides, 'override');
  }
  return normalizeCostParams((state && state.costs) || {}, 'base');
}

/** @deprecated Prefer resolveProductCostParams — kept for callers expecting global costs. */
function getEffectiveCosts(state) {
  const c = normalizeCostParams((state && state.costs) || {}, 'base');
  return {
    hourRate: c.hourRate,
    kgPrice: c.kgPrice,
    profitPercent: c.profitPercent,
    designCost: c.designCost,
    electricityCostPerHour: c.electricityCostPerHour,
    machineWearCostPerHour: c.machineWearCostPerHour,
    printerId: c.printerId,
    materialId: c.materialId,
  };
}

/**
 * Canonical product sale pricing: unit-mode or total-mode.
 * Total mode preserves the exact entered product total (no unit round-trip).
 */
function normalizeSalePriceInputMode(value) {
  return value === 'total' ? 'total' : 'unit';
}

function resolveProductSalePrice(product, quantity, suggestedUnitPrice) {
  const p = product || {};
  const qty = Math.max(0, num(quantity, 0));
  const suggestedUnit = roundMoney(suggestedUnitPrice);
  const inputMode = normalizeSalePriceInputMode(p.salePriceInputMode);
  const manual = !!p.salePriceTouched;

  if (!manual) {
    const productTotal = roundMoney(suggestedUnit * qty);
    return {
      inputMode,
      manual: false,
      unitPrice: suggestedUnit,
      productTotal,
      enteredUnit: suggestedUnit,
      enteredTotal: productTotal,
    };
  }

  if (inputMode === 'total') {
    const enteredTotal = roundMoney(num(p.salePriceTotalManual));
    const unitPrice = qty > 0 ? enteredTotal / qty : 0;
    return {
      inputMode: 'total',
      manual: true,
      unitPrice,
      productTotal: enteredTotal,
      enteredUnit: unitPrice,
      enteredTotal,
    };
  }

  const enteredUnit = roundMoney(num(p.salePriceManual));
  const productTotal = roundMoney(enteredUnit * qty);
  return {
    inputMode: 'unit',
    manual: true,
    unitPrice: enteredUnit,
    productTotal,
    enteredUnit,
    enteredTotal: productTotal,
  };
}

/**
 * Apply discount to resolved sale pricing.
 * Total-mode discounts the exact product total; unit-mode keeps prior unit semantics.
 */
function applyDiscountToSalePrice(sale, quantity, discountPercent) {
  const qty = Math.max(0, num(quantity, 0));
  const discount = Math.max(0, Math.min(100, num(discountPercent)));
  if (discount <= 0) {
    return {
      baseSale: sale.unitPrice,
      baseSaleTotal: sale.productTotal,
      saleUnit: sale.unitPrice,
      clientTotal: sale.productTotal,
      discountPercent: 0,
    };
  }
  if (sale.inputMode === 'total' && sale.manual) {
    const clientTotal = roundMoney(sale.productTotal * (1 - discount / 100));
    return {
      baseSale: sale.unitPrice,
      baseSaleTotal: sale.productTotal,
      saleUnit: qty > 0 ? clientTotal / qty : 0,
      clientTotal,
      discountPercent: discount,
    };
  }
  const saleUnit = sale.unitPrice * (1 - discount / 100);
  return {
    baseSale: sale.unitPrice,
    baseSaleTotal: sale.productTotal,
    saleUnit,
    clientTotal: saleUnit * qty,
    discountPercent: discount,
  };
}

/**
 * Legacy computeLine(state, product, quantity, discountPercent)
 * grams/printHours are always per-unit (qtyInputMode normalized before call).
 * Design is charged once per product (not × quantity).
 */
function computeLine(state, product, quantity, discountPercent) {
  const p = product || {};
  const resolved = resolveProductCostParams(state, p);
  const qty = Math.max(0, num(quantity, 0));

  const materialCost = (num(p.grams) / 1000) * num(resolved.kgPrice);
  const electricityCost = num(p.printHours) * num(resolved.electricityCostPerHour);
  const machineWearCost = num(p.printHours) * num(resolved.machineWearCostPerHour);
  const timeCost = electricityCost + machineWearCost;
  const additionalsCost = sumAdditionals(p);

  // Suggested sale formula (unchanged philosophy): markup on material+time, then + additionals.
  const markupBase = materialCost + timeCost;
  const unitCost = markupBase + additionalsCost;
  const totalCost = unitCost * qty;
  const suggestedPrice = Math.round(
    markupBase * (1 + num(resolved.profitPercent) / 100) + additionalsCost
  );
  const sale = resolveProductSalePrice(p, qty, suggestedPrice);
  const priced = applyDiscountToSalePrice(sale, qty, discountPercent);
  const saleUnit = priced.saleUnit;
  const baseSale = priced.baseSale;
  const clientTotal = priced.clientTotal;
  const discount = priced.discountPercent;

  const designCost = num(resolved.designCost); // once per product
  const materialCostTotal = materialCost * qty;
  const electricityCostTotal = electricityCost * qty;
  const machineWearCostTotal = machineWearCost * qty;
  const additionalsCostTotal = additionalsCost * qty;
  const productionCost =
    materialCostTotal +
    electricityCostTotal +
    machineWearCostTotal +
    additionalsCostTotal +
    designCost;

  // Per-unit margin excludes design (design is a one-shot charge).
  const netTotal = clientTotal - unitCost * qty;
  const netUnit = qty > 0 ? netTotal / qty : 0;
  const alexPct = num(state.alexPercent, 30);
  const luisPct = num(state.luisPercent, 100 - alexPct);

  return {
    quantity: qty,
    resolvedParams: resolved,
    materialCost,
    electricityCost,
    machineWearCost,
    timeCost,
    additionalsCost,
    designCost,
    materialCostTotal,
    electricityCostTotal,
    machineWearCostTotal,
    additionalsCostTotal,
    productionCost,
    unitCost,
    totalCost,
    suggestedPrice,
    suggestedTotal: suggestedPrice * qty,
    saleUnit,
    baseSale,
    baseSaleTotal: priced.baseSaleTotal,
    salePriceInputMode: sale.inputMode,
    discountPercent: discount,
    netUnit,
    netTotal,
    alexUnitShare: netUnit * (alexPct / 100),
    luisUnitShare: netUnit * (luisPct / 100),
    alexShare: netTotal * (alexPct / 100),
    luisShare: netTotal * (luisPct / 100),
    clientTotal,
  };
}

function sumProductDesignCosts(productResults) {
  return productResults.reduce((s, pr) => s + num(pr.line && pr.line.designCost), 0);
}

function buildProductionTotals(productResults) {
  const totals = {
    materialCost: 0,
    electricityCost: 0,
    machineWearCost: 0,
    additionalsCost: 0,
    designCost: 0,
    productionCost: 0,
  };
  productResults.forEach((pr) => {
    const l = pr.line || {};
    totals.materialCost += num(l.materialCostTotal);
    totals.electricityCost += num(l.electricityCostTotal);
    totals.machineWearCost += num(l.machineWearCostTotal);
    totals.additionalsCost += num(l.additionalsCostTotal);
    totals.designCost += num(l.designCost);
    totals.productionCost += num(l.productionCost);
  });
  return {
    materialCost: roundMoney(totals.materialCost),
    electricityCost: roundMoney(totals.electricityCost),
    machineWearCost: roundMoney(totals.machineWearCost),
    additionalsCost: roundMoney(totals.additionalsCost),
    designCost: roundMoney(totals.designCost),
    productionCost: roundMoney(totals.productionCost),
  };
}

/**
 * Tax-neutral business revenue for profit (excludes shipping + IVA).
 */
function computeTaxNeutralRevenue(productSaleTotal, designTotal, taxMode) {
  const entered = roundMoney(Math.max(0, productSaleTotal + designTotal));
  const tax = applyTaxMode(entered, taxMode);
  // included → net (embedded IVA removed); add/excluded → entered base
  return tax.base;
}

/**
 * Resolve product description for in-memory legacy migration.
 * Missing property on first product may inherit export.description.
 * Explicit '' must remain blank.
 */
function resolveLegacyProductDescription(opts) {
  const o = opts || {};
  if (o.descriptionPropertyPresent) {
    return o.descriptionValue == null ? '' : String(o.descriptionValue);
  }
  if (
    o.isFirstProduct &&
    o.legacyExportDescription != null &&
    String(o.legacyExportDescription).trim() !== ''
  ) {
    return String(o.legacyExportDescription);
  }
  return '';
}

function aggregateMain(state, productResults) {
  const production = buildProductionTotals(productResults);
  const designCost = production.designCost;
  const subtotalGross = productResults.reduce((s, pr) => s + num(pr.line.clientTotal), 0);
  const suggestedTotal = productResults.reduce((s, pr) => s + pr.line.suggestedPrice * pr.line.quantity, 0);
  const globalDisc =
    !state.wholesaleMode && state.globalDiscount && state.globalDiscount.enabled
      ? Math.max(0, Math.min(100, num(state.globalDiscount.percent)))
      : 0;
  const globalDiscAmount = Math.round(subtotalGross * (globalDisc / 100));
  const subtotalAfterGlobal = subtotalGross - globalDiscAmount;
  const totalQty = productResults.reduce((s, pr) => s + pr.line.quantity, 0);

  const taxMode = resolveTaxMode(state.export || state);
  const shipping = num((state.export || {}).shippingCost);
  const taxableBase = roundMoney(Math.max(0, subtotalAfterGlobal + designCost + shipping));
  const taxSummary = applyTaxMode(taxableBase, taxMode);

  const businessRevenue = computeTaxNeutralRevenue(subtotalAfterGlobal, designCost, taxMode);
  const grossProfit = businessRevenue - production.productionCost;
  const alexPct = num(state.alexPercent, 30);
  const luisPct = num(state.luisPercent, 70);
  const alexShare = grossProfit * (alexPct / 100);
  const luisShare = grossProfit * (luisPct / 100);

  return {
    quantity: totalQty,
    productCount: productResults.length,
    suggestedPrice: productResults.length === 1 ? productResults[0].line.suggestedPrice : 0,
    suggestedTotal,
    suggestedUnitAvg: totalQty > 0 ? Math.round(suggestedTotal / totalQty) : 0,
    saleUnit: totalQty > 0 ? Math.round(subtotalAfterGlobal / totalQty) : 0,
    saleTotal: subtotalAfterGlobal,
    baseSale: productResults.length === 1 ? productResults[0].line.baseSale : subtotalGross,
    subtotalGross,
    discountPercent: globalDisc,
    globalDiscountAmount: globalDiscAmount,
    clientTotal: taxSummary.total,
    designCost,
    shippingCost: shipping,
    taxMode: taxSummary.taxMode,
    enteredSubtotal: taxableBase,
    subtotalBeforeTax: taxSummary.taxMode === 'included' ? taxSummary.base : taxableBase,
    ivaAmount: taxSummary.iva,
    grandTotal: taxSummary.total,
    production,
    productionCost: production.productionCost,
    businessRevenue,
    grossProfit,
    netTotal: grossProfit,
    netUnit: totalQty > 0 ? grossProfit / totalQty : 0,
    alexUnitShare: totalQty > 0 ? alexShare / totalQty : 0,
    luisUnitShare: totalQty > 0 ? luisShare / totalQty : 0,
    alexShare,
    luisShare,
    materialCost: production.materialCost,
    electricityCost: production.electricityCost,
    machineWearCost: production.machineWearCost,
    additionalsCost: production.additionalsCost,
    timeCost: production.electricityCost + production.machineWearCost,
    unitCost: productResults.reduce((s, pr) => s + pr.line.unitCost, 0),
    totalCost: productResults.reduce((s, pr) => s + pr.line.totalCost, 0),
  };
}

function aggregateScenarioLine(state, productResults, discountPct) {
  let subtotal = 0;
  let qty = 0;
  const lines = [];
  productResults.forEach(pr => {
    const l = computeLine(state, pr.product, pr.product.quantity, discountPct);
    lines.push({ product: pr.product, line: l });
    subtotal += num(l.clientTotal);
    qty += l.quantity;
  });
  const production = buildProductionTotals(lines);
  const designCost = production.designCost;
  const taxMode = resolveTaxMode(state.export || state);
  const businessRevenue = computeTaxNeutralRevenue(subtotal, designCost, taxMode);
  const grossProfit = businessRevenue - production.productionCost;
  const alexPct = num(state.alexPercent, 30);
  const luisPct = num(state.luisPercent, 70);
  return {
    clientTotal: subtotal + designCost,
    quantity: qty,
    saleUnit: qty > 0 ? Math.round(subtotal / qty) : subtotal,
    baseSale: subtotal,
    suggestedPrice: subtotal,
    netTotal: grossProfit,
    netUnit: qty > 0 ? grossProfit / qty : 0,
    alexUnitShare: qty > 0 ? (grossProfit * (alexPct / 100)) / qty : 0,
    luisUnitShare: qty > 0 ? (grossProfit * (luisPct / 100)) / qty : 0,
    alexShare: grossProfit * (alexPct / 100),
    luisShare: grossProfit * (luisPct / 100),
    designCost,
    productionCost: production.productionCost,
  };
}

function syncSalePriceFromSuggested(state, product) {
  if (!product.salePriceTouched) {
    const qty = Math.max(1, num(product.quantity, 1));
    const line = computeLine(state, product, qty, 0);
    product.salePriceManual = Math.round(line.suggestedPrice);
    product.salePriceTotalManual = Math.round(line.suggestedPrice) * qty;
    if (product.salePriceInputMode !== 'total') product.salePriceInputMode = 'unit';
  }
}

function emptyMain() {
  return {
    quantity: 0, productCount: 0, suggestedPrice: 0, suggestedTotal: 0,
    suggestedUnitAvg: 0, saleUnit: 0, saleTotal: 0, baseSale: 0,
    subtotalGross: 0, discountPercent: 0, globalDiscountAmount: 0,
    clientTotal: 0, designCost: 0, shippingCost: 0,
    taxMode: 'excluded', enteredSubtotal: 0, subtotalBeforeTax: 0,
    ivaAmount: 0, grandTotal: 0,
    production: {
      materialCost: 0, electricityCost: 0, machineWearCost: 0,
      additionalsCost: 0, designCost: 0, productionCost: 0,
    },
    productionCost: 0, businessRevenue: 0, grossProfit: 0,
    netTotal: 0, netUnit: 0,
    alexUnitShare: 0, luisUnitShare: 0, alexShare: 0, luisShare: 0,
    materialCost: 0, electricityCost: 0, machineWearCost: 0,
    additionalsCost: 0, timeCost: 0, unitCost: 0, totalCost: 0,
  };
}

function computeAll(state) {
  const products = Array.isArray(state.products) && state.products.length
    ? state.products
    : (state.product ? [state.product] : []);
  if (!products.length) {
    return { products: [], main: emptyMain(), scenarios: [] };
  }

  const d = state.discounts || {};
  const ranges = getDiscountRanges(state);
  const totalQty = products.reduce((s, p) => s + num(p.quantity), 0);
  const wholesaleTier = state.wholesaleMode ? getTierDiscountPercent(state, totalQty, true) : 0;

  const productResults = products.map(prod => {
    const qty = Math.max(1, num(prod.quantity, 1));
    let disc = 0;
    if (state.wholesaleMode) {
      disc = wholesaleTier;
    } else if (prod.saleDiscountEnabled) {
      disc = Math.max(0, Math.min(100, num(prod.saleDiscountPercent)));
    }
    if (!prod.salePriceTouched) {
      syncSalePriceFromSuggested(state, prod);
    }
    const line = computeLine(state, prod, qty, disc);
    return { product: prod, line, resolvedParams: line.resolvedParams };
  });

  const main = aggregateMain(state, productResults);
  const scenarioDefs = [
    { key: 'range10_50', discount: num(d.range10_50) },
    { key: 'range50_100', discount: num(d.range50_100) },
    { key: 'range100plus', discount: num(d.range100plus) },
  ];
  const scenarios = scenarioDefs.map(def => ({
    key: def.key,
    range: ranges[def.key],
    label: formatRangeLabel(ranges[def.key], def.key),
    discount: def.discount,
    line: aggregateScenarioLine(state, productResults, def.discount),
  }));

  return { products: productResults, main, scenarios };
}

function formatRangeLabel(range, key) {
  if (key === 'range100plus' || range.max == null) return range.min + '+ uds';
  return range.min + ' a ' + range.max + ' uds';
}

function computeProductLineTotal(state, p) {
  const qty = Math.max(1, num(p.quantity, 1));
  const resolved = resolveProductCostParams(state, p);
  const materialCost = (num(p.grams) / 1000) * num(resolved.kgPrice);
  const timeCost =
    num(p.printHours) * num(resolved.electricityCostPerHour) +
    num(p.printHours) * num(resolved.machineWearCostPerHour);
  const additionals = sumAdditionals(p);
  const markupBase = materialCost + timeCost;
  const suggested = Math.round(markupBase * (1 + num(resolved.profitPercent) / 100) + additionals);
  const sale = resolveProductSalePrice(p, qty, suggested);
  let disc = 0;
  if (!state.wholesaleMode && p.saleDiscountEnabled) {
    disc = Math.max(0, Math.min(100, num(p.saleDiscountPercent)));
  }
  // Preserve prior unit-mode rounding when discounting unit prices.
  if (sale.inputMode === 'unit' && sale.manual && disc > 0) {
    return roundMoney(sale.unitPrice * (1 - disc / 100)) * qty;
  }
  if (!sale.manual && disc > 0) {
    return roundMoney(suggested * (1 - disc / 100)) * qty;
  }
  return applyDiscountToSalePrice(sale, qty, disc).clientTotal;
}

function computeQuoteTotal(snapshot) {
  const state = (snapshot && typeof snapshot === 'object') ? snapshot : {};
  const products = Array.isArray(state.products) && state.products.length
    ? state.products
    : (state.product ? [state.product] : []);
  const totalQty = products.reduce((sum, p) => sum + Math.max(1, num(p.quantity, 1)), 0);
  let subtotal = 0;
  let designTotal = 0;

  products.forEach(p => {
    const resolved = resolveProductCostParams(state, p);
    designTotal += num(resolved.designCost);

    let lineTotal = computeProductLineTotal(state, p);
    if (state.wholesaleMode) {
      const qty = Math.max(1, num(p.quantity, 1));
      const materialCost = (num(p.grams) / 1000) * num(resolved.kgPrice);
      const timeCost =
        num(p.printHours) * num(resolved.electricityCostPerHour) +
        num(p.printHours) * num(resolved.machineWearCostPerHour);
      const additionals = sumAdditionals(p);
      const markupBase = materialCost + timeCost;
      const suggested = Math.round(
        markupBase * (1 + num(resolved.profitPercent) / 100) + additionals
      );
      const sale = resolveProductSalePrice(p, qty, suggested);
      const tierDisc = getTierDiscountPercent(state, totalQty, true);
      if (sale.inputMode === 'total' && sale.manual) {
        lineTotal = applyDiscountToSalePrice(sale, qty, tierDisc).clientTotal;
      } else {
        const unitSale = roundMoney(sale.unitPrice * (1 - tierDisc / 100));
        lineTotal = unitSale * qty;
      }
    }
    subtotal += lineTotal;
  });

  if (!state.wholesaleMode && state.globalDiscount && state.globalDiscount.enabled) {
    const globalDisc = Math.max(0, Math.min(100, num(state.globalDiscount.percent)));
    subtotal = Math.round(subtotal * (1 - globalDisc / 100));
  }

  const shipping = num((state.export || state).shippingCost);
  const taxableBase = roundMoney(Math.max(0, Math.round(subtotal + designTotal + shipping)));
  const taxMode = resolveTaxMode(state.export || state);
  return applyTaxMode(taxableBase, taxMode).total;
}

// ── IVA / taxMode helpers ──

function normalizeTaxMode(value) {
  return ['included', 'add', 'excluded'].includes(value) ? value : 'excluded';
}

function resolveTaxMode(exportOrState) {
  const exp = (exportOrState && typeof exportOrState === 'object')
    ? (exportOrState.export || exportOrState)
    : {};
  if (exp.taxMode != null && String(exp.taxMode).trim() !== '') {
    return normalizeTaxMode(exp.taxMode);
  }
  return exp.includeIva === true ? 'included' : 'excluded';
}

function withIva(amount, _includeIva) {
  return roundMoney(amount);
}

function extractIncludedIva(grossAmount) {
  const gross = roundMoney(grossAmount);
  if (gross <= 0) {
    return { gross: 0, net: 0, iva: 0 };
  }
  const iva = roundMoney(gross - gross / (1 + IVA_RATE));
  return {
    gross,
    net: gross - iva,
    iva,
  };
}

function applyTaxMode(baseAmount, taxMode) {
  const base = roundMoney(baseAmount);
  const mode = normalizeTaxMode(taxMode);

  if (mode === 'add') {
    const iva = roundMoney(base * IVA_RATE);
    return {
      taxMode: mode,
      base,
      iva,
      total: base + iva,
    };
  }

  if (mode === 'included') {
    const split = extractIncludedIva(base);
    return {
      taxMode: mode,
      base: split.net,
      iva: split.iva,
      total: split.gross,
    };
  }

  return {
    taxMode: 'excluded',
    base,
    iva: 0,
    total: base,
  };
}

// ── Tilopay fees ──

const TILOPAY_FEE_PERCENT = 0.175;
const TILOPAY_FEE_FIXED_CRC = 185;

function computeTilopayPricing(baseTotalCrc) {
  const baseTotal = Math.max(0, roundMoney(baseTotalCrc));
  const percentFee = roundMoney(baseTotal * TILOPAY_FEE_PERCENT);
  const fixedFee = TILOPAY_FEE_FIXED_CRC;
  const serviceFees = percentFee + fixedFee;
  const tilopayTotal = baseTotal + serviceFees;
  return {
    baseTotal,
    percentFee,
    fixedFee,
    feeSubtotal: serviceFees,
    feeIva: 0,
    serviceFees,
    tilopayTotal,
    percentLabel: `${(TILOPAY_FEE_PERCENT * 100).toFixed(1)}%`,
    ivaRate: 0,
  };
}

function formatFeeBreakdown(pricing) {
  const p = pricing || computeTilopayPricing(0);
  return `${p.percentLabel} + ₡${p.fixedFee.toLocaleString('es-CR')}`;
}

module.exports = {
  IVA_RATE,
  num,
  roundMoney,
  fmtCrc,
  normalizeAdditional,
  getProductAdditionals,
  sumAdditionals,
  sumVisibleAdditionals,
  sumHiddenAdditionals,
  getDiscountRanges,
  getTierDiscountPercent,
  emptyCostOverrides,
  normalizeCostParams,
  resolveProductCostParams,
  getEffectiveCosts,
  computeLine,
  resolveProductSalePrice,
  normalizeSalePriceInputMode,
  applyDiscountToSalePrice,
  aggregateMain,
  aggregateScenarioLine,
  computeAll,
  computeQuoteTotal,
  computeProductLineTotal,
  buildProductionTotals,
  computeTaxNeutralRevenue,
  resolveLegacyProductDescription,
  withIva,
  extractIncludedIva,
  normalizeTaxMode,
  resolveTaxMode,
  applyTaxMode,
  computeTilopayPricing,
  formatFeeBreakdown,
  TILOPAY_FEE_PERCENT,
  TILOPAY_FEE_FIXED_CRC,
  formatRangeLabel,
};
