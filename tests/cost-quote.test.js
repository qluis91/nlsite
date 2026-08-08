/**
 * Cotización 3D — focused tests.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const calculator = require('../services/costQuoteCalculator');

// ───────────────────────────────────────────────────────
// 1. Calculator formulas
// ───────────────────────────────────────────────────────
describe('Calculator formulas', () => {
  it('materialCost: grams / 1000 * kgPrice', () => {
    assert.equal(calculator.materialCost(500, 20500), 10250); // 500g of ₡20,500/kg = ₡10,250
    assert.equal(calculator.materialCost(0, 20500), 0);
    assert.equal(calculator.materialCost(1000, 20000), 20000);
  });

  it('printingCost: hours * rate', () => {
    assert.equal(calculator.printingCost(2, 300), 600);
    assert.equal(calculator.printingCost(0.5, 400), 200);
  });

  it('productionCost: material + printing', () => {
    assert.equal(calculator.productionCost(500, 20500, 2, 300), 10250 + 600);
  });

  it('suggestedSalePrice: prod * (1 + profit/100) + additionals', () => {
    const prod = 10850;
    const profit = 100;
    const adds = 300;
    const expected = prod * 2 + 300; // 22000
    assert.equal(calculator.suggestedSalePrice(500, 20500, 2, 300, profit, adds), expected);
  });

  it('effectiveQty: per_unit returns qty, total_batch returns 1', () => {
    assert.equal(calculator.effectiveQty(5, 'per_unit'), 5);
    assert.equal(calculator.effectiveQty(5, 'total_batch'), 1);
  });

  it('applyDiscount: reduces price by discount%', () => {
    assert.equal(calculator.applyDiscount(1000, true, 10), 900);
    assert.equal(calculator.applyDiscount(1000, false, 10), 1000);
    assert.equal(calculator.applyDiscount(1000, true, 0), 1000);
  });

  it('wholesaleDiscountPct: selects correct tier', () => {
    const tiers = [
      { min: 10, max: 50, pct: 5 },
      { min: 50, max: 100, pct: 10 },
      { min: 100, max: 999999, pct: 15 },
    ];
    assert.equal(calculator.wholesaleDiscountPct(5, tiers), 0);
    assert.equal(calculator.wholesaleDiscountPct(10, tiers), 5);
    assert.equal(calculator.wholesaleDiscountPct(70, tiers), 10);
    assert.equal(calculator.wholesaleDiscountPct(150, tiers), 15);
  });

  it('applyIva: adds 13%', () => {
    assert.equal(calculator.applyIva(1000, true), 1130);
    assert.equal(calculator.applyIva(1000, false), 1000);
  });
});

// ───────────────────────────────────────────────────────
// 2. Product line computation
// ───────────────────────────────────────────────────────
describe('Product line computation', () => {
  const baseCfg = { hourRate: 300, kgPrice: 20500, profitPct: 100, designCost: 0, designCostTotalQty: 1 };

  it('per-unit mode computes per-unit costs', () => {
    const product = { name: 'Test', quantity: 2, grams: 100, printHours: 1, inputMode: 'per_unit', additionalCosts: 500 };
    const line = calculator.computeProductLine(product, baseCfg);
    // g=100, kg=20500 → mat = 2.05; h=1, rate=300 → print=300; prod=302.05
    // gramsTotal = gPerUnit * effQty = 100 * 2 = 200
    assert.equal(line.grams, 100);
    assert.equal(line.gramsTotal, 200);
    assert.equal(line.productionPerUnit, calculator.round2(100 / 1000 * 20500 + 1 * 300));
    // additionalPerUnit = 500 / 2 = 250
    const expectedSuggested = calculator.suggestedSalePrice(100, 20500, 1, 300, 100, 250);
    assert.equal(line.suggestedPerUnit, expectedSuggested);
    assert.equal(line.quantity, 2);
  });

  it('total_batch mode treats grams/hours as totals', () => {
    const product = { name: 'Batch', quantity: 5, grams: 500, printHours: 10, inputMode: 'total_batch', additionalCosts: 0 };
    const line = calculator.computeProductLine(product, baseCfg);
    // effQty=1 → gPerUnit=500, hPerUnit=10
    assert.equal(line.grams, 500);
    assert.equal(line.inputMode, 'total_batch');
    assert.equal(line.materialPerUnit, 500 / 1000 * 20500); // 10250
    assert.equal(line.printingPerUnit, 10 * 300); // 3000
  });

  it('manual price override uses manual price instead of suggested', () => {
    const product = { name: 'Manual', quantity: 1, grams: 100, printHours: 1, inputMode: 'per_unit', additionalCosts: 0, manualPriceEnabled: true, manualPrice: 5000, discountEnabled: false, discountPct: 0 };
    const line = calculator.computeProductLine(product, baseCfg);
    assert.equal(line.useManualPrice, true);
    assert.equal(line.baseSalePerUnit, 5000);
  });

  it('per-product discount reduces sale price', () => {
    const product = { name: 'Disc', quantity: 1, grams: 100, printHours: 1, inputMode: 'per_unit', additionalCosts: 0, manualPriceEnabled: false, manualPrice: 0, discountEnabled: true, discountPct: 10 };
    const line = calculator.computeProductLine(product, baseCfg);
    const suggested = calculator.suggestedSalePrice(100, 20500, 1, 300, 100, 0);
    assert.equal(line.discountedPerUnit, calculator.round2(suggested * 0.9));
  });
});

// ───────────────────────────────────────────────────────
// 3. Quote totals
// ───────────────────────────────────────────────────────
describe('Quote totals', () => {
  const cfg = {
    hourRate: 300, kgPrice: 20500, profitPct: 100,
    alexPct: 30, luisPct: 70,
    designCost: 1000, shippingCost: 2000,
    includeIva: false,
    wholesaleEnabled: false, wholesaleTiers: [], wholesaleScenarioQty: null,
    globalDiscountEnabled: false, globalDiscountPct: 0,
  };

  it('computes totals for multiple products', () => {
    const products = [
      { name: 'A', quantity: 1, grams: 100, printHours: 2, inputMode: 'per_unit', additionalCosts: 0, manualPriceEnabled: false, manualPrice: 0, discountEnabled: false, discountPct: 0 },
      { name: 'B', quantity: 2, grams: 50, printHours: 0.5, inputMode: 'per_unit', additionalCosts: 100, manualPriceEnabled: false, manualPrice: 0, discountEnabled: false, discountPct: 0 },
    ];
    const r = calculator.computeQuoteTotals(products, cfg);
    assert.equal(r.totalQty, 3);
    assert.equal(r.totalDesign, 1000);
    assert.equal(r.shippingCost, 2000);
    assert.ok(r.lines.length === 2);
    assert.ok(r.grandTotal > 0);
  });

  it('global discount reduces subtotal', () => {
    const products = [
      { name: 'X', quantity: 1, grams: 200, printHours: 3, inputMode: 'per_unit', additionalCosts: 0, manualPriceEnabled: false, manualPrice: 0, discountEnabled: false, discountPct: 0 },
    ];
    const noDiscount = calculator.computeQuoteTotals(products, cfg);
    const withDiscount = calculator.computeQuoteTotals(products, {
      ...cfg, globalDiscountEnabled: true, globalDiscountPct: 10,
    });
    assert.ok(withDiscount.globalDiscountAmt > 0);
    assert.ok(withDiscount.grandTotal < noDiscount.grandTotal);
  });

  it('IVA adds 13%', () => {
    const products = [
      { name: 'X', quantity: 1, grams: 100, printHours: 1, inputMode: 'per_unit', additionalCosts: 0, manualPriceEnabled: false, manualPrice: 0, discountEnabled: false, discountPct: 0 },
    ];
    const withoutIva = calculator.computeQuoteTotals(products, { ...cfg, includeIva: false });
    const withIva = calculator.computeQuoteTotals(products, { ...cfg, includeIva: true });
    assert.ok(withIva.ivaAmount > 0);
    assert.ok(withIva.grandTotal > withoutIva.grandTotal);
  });

  it('Alex/Luis split sums to total net profit', () => {
    const products = [
      { name: 'X', quantity: 1, grams: 200, printHours: 3, inputMode: 'per_unit', additionalCosts: 0, manualPriceEnabled: false, manualPrice: 0, discountEnabled: false, discountPct: 0 },
    ];
    const r = calculator.computeQuoteTotals(products, { ...cfg, alexPct: 40, luisPct: 60 });
    const diff = Math.abs((r.alexShare + r.luisShare) - r.totalNetProfit);
    assert.ok(diff < 0.02, `Alex (${r.alexShare}) + Luis (${r.luisShare}) ~= total (${r.totalNetProfit})`);
  });

  it('wholesale tier selects correctly based on scenario qty', () => {
    const products = [
      { name: 'X', quantity: 1, grams: 100, printHours: 1, inputMode: 'per_unit', additionalCosts: 0, manualPriceEnabled: false, manualPrice: 0, discountEnabled: false, discountPct: 0 },
    ];
    const wsCfg = {
      ...cfg, wholesaleEnabled: true,
      wholesaleTiers: [{ min: 10, max: 50, pct: 5 }, { min: 50, max: 100, pct: 10 }, { min: 100, max: 999999, pct: 15 }],
      wholesaleScenarioQty: 75,
    };
    const r = calculator.computeQuoteTotals(products, wsCfg);
    assert.equal(r.wholesalePct, 10);
  });
});

// ───────────────────────────────────────────────────────
// 4. Security & access
// ───────────────────────────────────────────────────────
describe('Security', () => {
  it('admin cost-quote routes require authentication', () => {
    const appSrc = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
    assert.ok(appSrc.includes("adminCostQuoteRoutes"), 'must load routes');
    assert.ok(appSrc.includes("isAuthenticated"), 'must require auth');
  });

  it('mutation routes include CSRF protection', () => {
    const routesSrc = fs.readFileSync(path.resolve(__dirname, '../routes/adminCostQuoteRoutes.js'), 'utf8');
    assert.ok(routesSrc.includes('csrfSynchronisedProtection'), 'must include CSRF');
    assert.ok(routesSrc.includes('csrf,'), 'must apply CSRF to mutation routes');
  });

  it('no public route exposes cost data', () => {
    const controllerSrc = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(!controllerSrc.includes('exports.publicShow'), 'no public route exists');
    assert.ok(controllerSrc.includes("cost_quote_catalog"), 'only admin catalog access');
  });
});

// ───────────────────────────────────────────────────────
// 5. Migration
// ───────────────────────────────────────────────────────
describe('Migration', () => {
  it('migration is registered in tracker', () => {
    const tracker = fs.readFileSync(path.resolve(__dirname, '../scripts/migrationTracker.js'), 'utf8');
    assert.ok(tracker.includes('migrateCostQuote'), 'must be in migration tracker');
  });

  it('migration creates cost_quote_catalog and cost_quotes tables', () => {
    const migSrc = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-cost-quote.js'), 'utf8');
    assert.ok(migSrc.includes('cost_quote_catalog'), 'creates catalog table');
    assert.ok(migSrc.includes('cost_quotes'), 'creates quotes table');
    assert.ok(migSrc.includes('CREATE TABLE IF NOT EXISTS'), 'idempotent');
  });

  it('seeds at least one default printer and material', () => {
    const migSrc = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-cost-quote.js'), 'utf8');
    assert.ok(migSrc.includes("'printer'"), 'seeds printer');
    assert.ok(migSrc.includes("'material'"), 'seeds material');
  });
});

// ───────────────────────────────────────────────────────
// 6. Controller validation
// ───────────────────────────────────────────────────────
describe('Controller validation', () => {
  it('createQuote requires title', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('titleTrim'), 'validates title');
    assert.ok(src.includes('Título requerido'), 'returns validation error');
  });

  it('updateQuote blocks approved quote edits', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes("status === 'approved'"), 'checks approved status');
    assert.ok(src.includes('aprobada'), 'returns approval error');
  });

  it('deleteCatalogItem prevents last item deletion', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('cnt <= 1'), 'checks minimum count');
    assert.ok(src.includes('al menos un elemento'), 'returns error');
  });
});
