/**
 * Cost-quote calculation functions — legacy parity v2.
 * Every formula, rounding, and conditional mirrors nllegacy admin-cost-quote.js computeLine/computeAll/computeQuoteTotal.
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

/**
 * Normalize an additional from legacy formats:
 *   { price, description, showOnInvoice }
 *   or legacy "additional1"/"additional2"/"additional3"
 *   or flat number
 */
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
  // Legacy backward compatibility: additional1/2/3 flat fields
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

// ── Core computeLine (matches legacy exactly) ──

function getEffectiveCosts(state) {
  return {
    hourRate: num(state.costs && state.costs.hourRate, 300),
    kgPrice: num(state.costs && state.costs.kgPrice, 20500),
    profitPercent: num(state.costs && state.costs.profitPercent, 100),
    designCost: num(state.costs && state.costs.designCost),
  };
}

/**
 * Legacy computeLine(state, product, quantity, discountPercent)
 */
function computeLine(state, product, quantity, discountPercent) {
  const c = getEffectiveCosts(state);
  const p = product || {};
  const qty = Math.max(0, num(quantity, 0));
  const materialCost = (num(p.grams) / 1000) * num(c.kgPrice);
  const timeCost = num(p.printHours) * num(c.hourRate);
  const additionalsCost = sumAdditionals(p);
  const productionCost = materialCost + timeCost;
  const unitCost = productionCost + additionalsCost;
  const totalCost = unitCost * qty;
  const suggestedPrice = Math.round(productionCost * (1 + num(c.profitPercent) / 100) + additionalsCost);
  const baseSale = p.salePriceTouched ? num(p.salePriceManual) : suggestedPrice;
  const discount = Math.max(0, Math.min(100, num(discountPercent)));
  const saleUnit = baseSale * (1 - discount / 100);
  const netUnit = saleUnit - unitCost;
  const netTotal = netUnit * qty;
  const alexPct = num(state.alexPercent, 30);
  const luisPct = num(state.luisPercent, 100 - alexPct);

  return {
    quantity: qty,
    materialCost,
    timeCost,
    unitCost,
    totalCost,
    suggestedPrice,
    suggestedTotal: suggestedPrice * qty,
    saleUnit,
    baseSale,
    discountPercent: discount,
    netUnit,
    netTotal,
    alexUnitShare: netUnit * (alexPct / 100),
    luisUnitShare: netUnit * (luisPct / 100),
    alexShare: netTotal * (alexPct / 100),
    luisShare: netTotal * (luisPct / 100),
    designCost: 0,
    clientTotal: saleUnit * qty,
  };
}

// ── Aggregate functions ──

function aggregateMain(state, productResults) {
  const c = getEffectiveCosts(state);
  const designCost = num(c.designCost);
  const subtotalGross = productResults.reduce((s, pr) => s + pr.line.saleUnit * pr.line.quantity, 0);
  const suggestedTotal = productResults.reduce((s, pr) => s + pr.line.suggestedPrice * pr.line.quantity, 0);
  const globalDisc =
    !state.wholesaleMode && state.globalDiscount && state.globalDiscount.enabled
      ? Math.max(0, Math.min(100, num(state.globalDiscount.percent)))
      : 0;
  const globalDiscAmount = Math.round(subtotalGross * (globalDisc / 100));
  const subtotalAfterGlobal = subtotalGross - globalDiscAmount;
  const totalQty = productResults.reduce((s, pr) => s + pr.line.quantity, 0);
  const netTotalBeforeGlobal = productResults.reduce((s, pr) => s + pr.line.netTotal, 0);
  const netAfterGlobal = netTotalBeforeGlobal - Math.round(netTotalBeforeGlobal * (globalDisc / 100));
  const alexPct = num(state.alexPercent, 30);
  const luisPct = num(state.luisPercent, 70);
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
    clientTotal: subtotalAfterGlobal + designCost,
    designCost,
    netTotal: netAfterGlobal,
    netUnit: totalQty > 0 ? netAfterGlobal / totalQty : 0,
    alexUnitShare: totalQty > 0 ? (netAfterGlobal * (alexPct / 100)) / totalQty : 0,
    luisUnitShare: totalQty > 0 ? (netAfterGlobal * (luisPct / 100)) / totalQty : 0,
    alexShare: netAfterGlobal * (alexPct / 100) + designCost,
    luisShare: netAfterGlobal * (luisPct / 100),
    materialCost: productResults.reduce((s, pr) => s + pr.line.materialCost, 0),
    timeCost: productResults.reduce((s, pr) => s + pr.line.timeCost, 0),
    unitCost: productResults.reduce((s, pr) => s + pr.line.unitCost, 0),
    totalCost: productResults.reduce((s, pr) => s + pr.line.totalCost, 0),
  };
}

function aggregateScenarioLine(state, productResults, discountPct) {
  let subtotal = 0, totalCost = 0, qty = 0, netTotal = 0;
  productResults.forEach(pr => {
    const l = computeLine(state, pr.product, pr.product.quantity, discountPct);
    subtotal += l.saleUnit * l.quantity;
    totalCost += l.totalCost;
    netTotal += l.netTotal;
    qty += l.quantity;
  });
  const designCost = num(getEffectiveCosts(state).designCost);
  const alexPct = num(state.alexPercent, 30);
  const luisPct = num(state.luisPercent, 70);
  return {
    clientTotal: subtotal + designCost,
    quantity: qty,
    saleUnit: qty > 0 ? Math.round(subtotal / qty) : subtotal,
    baseSale: subtotal,
    suggestedPrice: subtotal,
    netTotal,
    netUnit: qty > 0 ? netTotal / qty : 0,
    alexUnitShare: qty > 0 ? (netTotal * (alexPct / 100)) / qty : 0,
    luisUnitShare: qty > 0 ? (netTotal * (luisPct / 100)) / qty : 0,
    alexShare: netTotal * (alexPct / 100),
    luisShare: netTotal * (luisPct / 100),
    designCost,
  };
}

// ── computeAll — main entry point (matches legacy exactly) ──

function syncSalePriceFromSuggested(state, product) {
  if (!product.salePriceTouched) {
    product.salePriceManual = Math.round(
      (num(product.grams) / 1000) * num(state.costs && state.costs.kgPrice, 20500) *
        (1 + num(state.costs && state.costs.profitPercent, 100) / 100) +
      num(product.printHours) * num(state.costs && state.costs.hourRate, 300) *
        (1 + num(state.costs && state.costs.profitPercent, 100) / 100) +
      sumAdditionals(product)
    );
  }
}

function computeAll(state) {
  const products = Array.isArray(state.products) && state.products.length
    ? state.products
    : (state.product ? [state.product] : []);
  if (!products.length) {
    return {
      products: [],
      main: {
        quantity: 0, productCount: 0, suggestedPrice: 0, suggestedTotal: 0,
        suggestedUnitAvg: 0, saleUnit: 0, saleTotal: 0, baseSale: 0,
        subtotalGross: 0, discountPercent: 0, globalDiscountAmount: 0,
        clientTotal: 0, designCost: 0, netTotal: 0, netUnit: 0,
        alexUnitShare: 0, luisUnitShare: 0, alexShare: 0, luisShare: 0,
        materialCost: 0, timeCost: 0, unitCost: 0, totalCost: 0,
      },
      scenarios: [],
    };
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
    return { product: prod, line };
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

// ── computeQuoteTotal (matches legacy costQuoteWorkflow exactly) ──

function computeProductLineTotal(state, p) {
  const c = state.costs || {};
  const qty = Math.max(1, num(p.quantity, 1));
  const materialCost = (num(p.grams) / 1000) * num(c.kgPrice, 20500);
  const timeCost = num(p.printHours) * num(c.hourRate, 300);
  const additionals = sumAdditionals(p);
  const productionCost = materialCost + timeCost;
  let unitSale = p.salePriceTouched
    ? num(p.salePriceManual)
    : Math.round(productionCost * (1 + num(c.profitPercent, 100) / 100) + additionals);
  if (!state.wholesaleMode && p.saleDiscountEnabled) {
    const disc = Math.max(0, Math.min(100, num(p.saleDiscountPercent)));
    unitSale = Math.round(unitSale * (1 - disc / 100));
  }
  return unitSale * qty;
}

function computeQuoteTotal(snapshot) {
  const state = (snapshot && typeof snapshot === 'object') ? snapshot : {};
  const products = Array.isArray(state.products) && state.products.length
    ? state.products
    : (state.product ? [state.product] : []);
  const totalQty = products.reduce((sum, p) => sum + Math.max(1, num(p.quantity, 1)), 0);
  let subtotal = 0;
  products.forEach(p => {
    let lineTotal = computeProductLineTotal(state, p);
    if (state.wholesaleMode) {
      const qty = Math.max(1, num(p.quantity, 1));
      const materialCost = (num(p.grams) / 1000) * num(state.costs && state.costs.kgPrice, 20500);
      const timeCost = num(p.printHours) * num(state.costs && state.costs.hourRate, 300);
      const additionals = sumAdditionals(p);
      const productionCost = materialCost + timeCost;
      let unitSale = p.salePriceTouched
        ? num(p.salePriceManual)
        : Math.round(productionCost * (1 + num(state.costs && state.costs.profitPercent, 100) / 100) + additionals);
      const tierDisc = getTierDiscountPercent(state, totalQty, true);
      unitSale = Math.round(unitSale * (1 - tierDisc / 100));
      lineTotal = unitSale * qty;
    }
    subtotal += lineTotal;
  });

  if (!state.wholesaleMode && state.globalDiscount && state.globalDiscount.enabled) {
    const globalDisc = Math.max(0, Math.min(100, num(state.globalDiscount.percent)));
    subtotal = Math.round(subtotal * (1 - globalDisc / 100));
  }

  const design = num(state.costs && state.costs.designCost);
  let shipping = num((state.export || state).shippingCost);
  let total = subtotal + design;
  if ((state.export || state).includeIva) {
    total = Math.round(total * (1 + IVA_RATE));
    shipping = Math.round(shipping * (1 + IVA_RATE));
  }
  return roundMoney(Math.max(0, Math.round(total + shipping)));
}

// ── IVA helpers ──

function withIva(amount, includeIva) {
  return includeIva ? roundMoney(amount * (1 + IVA_RATE)) : roundMoney(amount);
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

// ── Exports ──

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
  computeLine,
  aggregateMain,
  aggregateScenarioLine,
  computeAll,
  computeQuoteTotal,
  computeProductLineTotal,
  withIva,
  computeTilopayPricing,
  formatFeeBreakdown,
  TILOPAY_FEE_PERCENT,
  TILOPAY_FEE_FIXED_CRC,
  formatRangeLabel,
};
