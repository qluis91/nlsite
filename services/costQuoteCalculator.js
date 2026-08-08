/**
 * Shared cost-quote calculation functions.
 * These are the authoritative formulas — used by server and mirrored in client JS.
 */

/**
 * Material cost: grams / 1000 × kgPrice
 */
function materialCost(grams, kgPrice) {
  return (grams / 1000) * kgPrice;
}

/**
 * Printing/time cost: printHours × hourRate
 */
function printingCost(printHours, hourRate) {
  return printHours * hourRate;
}

/**
 * Production cost: material + printing
 */
function productionCost(grams, kgPrice, printHours, hourRate) {
  return materialCost(grams, kgPrice) + printingCost(printHours, hourRate);
}

/**
 * Suggested sale price (per unit): productionCost × (1 + profit/100) + additionals
 */
function suggestedSalePrice(grams, kgPrice, printHours, hourRate, profitPct, additionalCosts) {
  const prod = productionCost(grams, kgPrice, printHours, hourRate);
  return prod * (1 + profitPct / 100) + (additionalCosts || 0);
}

/**
 * Effective quantity for a single product line:
 *   - "per_unit" → quantity (each unit has the given grams/hours)
 *   - "total_batch" → 1 (grams/hours already represent the whole batch)
 */
function effectiveQty(quantity, inputMode) {
  return inputMode === 'total_batch' ? 1 : (quantity || 1);
}

/**
 * Apply discount to a price.
 */
function applyDiscount(price, discountEnabled, discountPct) {
  if (!discountEnabled || !discountPct) return price;
  return price * (1 - discountPct / 100);
}

/**
 * Get wholesale discount percentage for a given total quantity.
 * tiers: [{min: 10, max: 50, pct: 5}, ...]
 */
function wholesaleDiscountPct(totalQty, tiers) {
  if (!tiers || !tiers.length) return 0;
  for (const tier of tiers) {
    if (totalQty >= tier.min && totalQty <= tier.max) return tier.pct;
  }
  // If quantity exceeds last tier max, use last tier
  const last = tiers[tiers.length - 1];
  if (totalQty > last.max) return last.pct;
  return 0;
}

/**
 * Apply IVA (13%) to a price.
 */
function applyIva(price, includeIva) {
  return includeIva ? price * 1.13 : price;
}

/**
 * Compute a single product line's totals.
 * Returns per-unit and total values.
 */
function computeProductLine(product, cfg) {
  const {
    hourRate, kgPrice, profitPct, designCost, designCostTotalQty,
  } = cfg;

  const qty = product.quantity || 1;
  const mode = product.inputMode || 'per_unit';
  const effQty = effectiveQty(qty, mode);

  // Grams and hours per effective unit
  const gPerUnit = (mode === 'total_batch') ? (product.grams || 0) : (product.grams || 0);
  const hPerUnit = (mode === 'total_batch') ? (product.printHours || 0) : (product.printHours || 0);

  const gTotal = gPerUnit * effQty;
  const hTotal = hPerUnit * effQty;

  const matPerUnit = materialCost(gPerUnit, kgPrice);
  const printPerUnit = printingCost(hPerUnit, hourRate);
  const prodPerUnit = matPerUnit + printPerUnit;
  const prodTotal = prodPerUnit * effQty;

  const additionalPerUnit = (product.additionalCosts || 0) / qty;
  const suggestedPerUnit = suggestedSalePrice(gPerUnit, kgPrice, hPerUnit, hourRate, profitPct, additionalPerUnit);

  // Manual price override
  const useManualPrice = product.manualPriceEnabled && (product.manualPrice > 0);
  const baseSalePerUnit = useManualPrice ? product.manualPrice : suggestedPerUnit;

  // Design cost distribution: split across all products by total design qty weight
  const designShare = designCostTotalQty > 0
    ? designCost * (qty / designCostTotalQty)
    : 0;

  // Per-product discount
  const discountedPerUnit = applyDiscount(baseSalePerUnit, product.discountEnabled, product.discountPct);
  const saleTotal = discountedPerUnit * qty + designShare;

  return {
    name: product.name || '',
    quantity: qty,
    inputMode: mode,
    grams: gPerUnit, gramsTotal: gTotal,
    printHours: hPerUnit, printHoursTotal: hTotal,
    materialPerUnit: matPerUnit, materialTotal: matPerUnit * qty,
    printingPerUnit: printPerUnit, printingTotal: printPerUnit * qty,
    productionPerUnit: prodPerUnit, productionTotal: prodTotal,
    additionalPerUnit,
    additionalTotal: additionalPerUnit * qty,
    suggestedPerUnit,
    useManualPrice,
    baseSalePerUnit,
    discountedPerUnit,
    designShare,
    saleTotal,
    netProfitPerUnit: discountedPerUnit - prodPerUnit - additionalPerUnit,
    netProfitTotal: (discountedPerUnit - prodPerUnit - additionalPerUnit) * qty,
  };
}

/**
 * Compute full quote totals from products array and config.
 */
function computeQuoteTotals(products, cfg) {
  const {
    hourRate, kgPrice, profitPct, alexPct, luisPct,
    designCost, shippingCost, includeIva,
    wholesaleEnabled, wholesaleTiers, wholesaleScenarioQty,
    globalDiscountEnabled, globalDiscountPct,
  } = cfg;

  const totalQty = products.reduce((s, p) => s + (p.quantity || 1), 0);
  const designCostTotalQty = totalQty;

  const lines = products.map(p => computeProductLine(p, {
    hourRate, kgPrice, profitPct, designCost, designCostTotalQty,
  }));

  let subtotal = lines.reduce((s, l) => s + l.saleTotal, 0);
  let totalProduction = lines.reduce((s, l) => s + l.productionTotal, 0);
  let totalAdditional = lines.reduce((s, l) => s + l.additionalTotal, 0);
  let totalDesign = designCost;

  // Wholesale discount
  let wholesalePct = 0;
  if (wholesaleEnabled && wholesaleTiers && wholesaleTiers.length) {
    const qtyForTier = wholesaleScenarioQty || totalQty;
    wholesalePct = wholesaleDiscountPct(qtyForTier, wholesaleTiers);
    if (wholesalePct > 0) {
      subtotal = subtotal * (1 - wholesalePct / 100);
    }
  }

  // Global discount
  let globalDiscountAmt = 0;
  if (globalDiscountEnabled && globalDiscountPct > 0) {
    globalDiscountAmt = subtotal * (globalDiscountPct / 100);
    subtotal = subtotal - globalDiscountAmt;
  }

  // Add shipping
  subtotal += (shippingCost || 0);

  // IVA
  const ivaAmount = includeIva ? subtotal * 0.13 : 0;
  const grandTotal = subtotal + ivaAmount;

  // Profit breakdown
  const totalNetProfit = grandTotal - totalProduction - totalAdditional - totalDesign - (shippingCost || 0) - ivaAmount;
  const alexShare = totalNetProfit * (alexPct / 100);
  const luisShare = totalNetProfit * (luisPct / 100);

  return {
    lines,
    totalQty,
    subtotal: round2(subtotal - (shippingCost || 0) - ivaAmount + globalDiscountAmt),
    totalProduction: round2(totalProduction),
    totalAdditional: round2(totalAdditional),
    totalDesign: round2(totalDesign),
    shippingCost: round2(shippingCost || 0),
    globalDiscountPct: globalDiscountEnabled ? globalDiscountPct : 0,
    globalDiscountAmt: round2(globalDiscountAmt),
    wholesalePct: round2(wholesalePct),
    ivaAmount: round2(ivaAmount),
    grandTotal: round2(grandTotal),
    totalNetProfit: round2(totalNetProfit),
    alexShare: round2(alexShare),
    luisShare: round2(luisShare),
  };
}

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

module.exports = {
  materialCost, printingCost, productionCost, suggestedSalePrice,
  effectiveQty, applyDiscount, wholesaleDiscountPct, applyIva,
  computeProductLine, computeQuoteTotals, round2,
};
