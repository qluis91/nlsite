/**
 * Cotización 3D — legacy parity tests v2.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const calculator = require('../services/costQuoteCalculator');

// ───────────────────────────────────────────────────────
// 1. Core helpers
// ───────────────────────────────────────────────────────
describe('Core helpers', () => {
  it('roundMoney rounds to nearest integer', () => {
    assert.equal(calculator.roundMoney(100.4), 100);
    assert.equal(calculator.roundMoney(100.5), 101);
  });

  it('num returns number or fallback', () => {
    assert.equal(calculator.num('123'), 123);
    assert.equal(calculator.num(undefined, 50), 50);
  });

  it('getProductAdditionals handles array and legacy formats', () => {
    const p1 = { additionals: [{ price: 100, description: 'Lijado', showOnInvoice: true }] };
    assert.equal(calculator.getProductAdditionals(p1).length, 1);
    const adds2 = calculator.getProductAdditionals({});
    assert.equal(adds2.length, 3); // legacy additional1/2/3 fallback
  });

  it('sumAdditionals totals all prices', () => {
    const p = { additionals: [{ price: 100 }, { price: 200 }] };
    assert.equal(calculator.sumAdditionals(p), 300);
  });

  it('withIva applies 13%', () => {
    assert.equal(calculator.withIva(1000, true), 1130);
    assert.equal(calculator.withIva(1000, false), 1000);
  });

  it('getTierDiscountPercent works correctly', () => {
    const state = { discounts: { range10_50: 5, range50_100: 10, range100plus: 15 } };
    assert.equal(calculator.getTierDiscountPercent(state, 5, true), 0);
    assert.equal(calculator.getTierDiscountPercent(state, 10, true), 5);
    assert.equal(calculator.getTierDiscountPercent(state, 55, true), 10);
    assert.equal(calculator.getTierDiscountPercent(state, 150, true), 15);
  });
});

// ───────────────────────────────────────────────────────
// 2. computeLine — per-product legacy calculation
// ───────────────────────────────────────────────────────
describe('computeLine', () => {
  const defaultState = {
    costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100 },
    alexPercent: 30, luisPercent: 70,
    globalDiscount: { enabled: false, percent: 0 },
  };

  it('basic single product — grams=100, hours=1, qty=1', () => {
    const product = { name: 'Test', quantity: 1, grams: 100, printHours: 1 };
    const line = calculator.computeLine(defaultState, product, 1, 0);
    // Legacy: materialCost = (grams/1000) * kgPrice = (100/1000)*20500 = 2050
    assert.equal(line.materialCost, 2050);
    assert.equal(line.timeCost, 300);
    // unitCost = production(2350) + additionals(0) = 2350
    assert.equal(line.unitCost, 2350);
    // suggestedPrice = round(2350 * (1+100/100) + 0) = 4700
    assert.equal(line.suggestedPrice, 4700);
    assert.equal(line.saleUnit, 4700);
  });

  it('with quantity > 1', () => {
    const product = { name: 'Test', quantity: 10, grams: 385, printHours: 14.5 };
    const line = calculator.computeLine(defaultState, product, 10, 0);
    assert.equal(line.quantity, 10);
    // materialCost per unit = 385/1000 * 20500 = 7892.5
    assert.equal(line.materialCost, 7892.5);
    assert.equal(line.timeCost, 4350);
    // suggested = round((7892.5+4350) * 2 + 0) = round(24485) = 24485
    assert.equal(line.suggestedPrice, 24485);
    assert.equal(line.saleUnit, 24485);
    assert.equal(line.suggestedTotal, 244850);
  });

  it('manual price override', () => {
    const p = { name: 'Manual', quantity: 1, grams: 100, printHours: 1,
      salePriceTouched: true, salePriceManual: 50000 };
    const line = calculator.computeLine(defaultState, p, 1, 0);
    assert.equal(line.baseSale, 50000);
    assert.equal(line.saleUnit, 50000);
  });

  it('per-product discount 10%', () => {
    // grams=100, hours=1 → suggested=4700. 10% off → 4700*0.9 = 4230
    const p = { name: 'Disc', quantity: 1, grams: 100, printHours: 1,
      saleDiscountEnabled: true, saleDiscountPercent: 10 };
    const line = calculator.computeLine(defaultState, p, 1, 10);
    assert.equal(line.saleUnit, 4230);
    assert.equal(line.discountPercent, 10);
  });

  it('with additionals: 500+250 = 750 total', () => {
    const p = {
      name: 'Adds', quantity: 1, grams: 100, printHours: 1,
      additionals: [{ price: 500 }, { price: 250 }],
    };
    const line = calculator.computeLine(defaultState, p, 1, 0);
    // production=2350, unitCost=2350+750=3100
    assert.equal(line.unitCost, 3100);
    // suggested = round(2350 * 2 + 750) = round(5450) = 5450
    assert.equal(line.suggestedPrice, 5450);
  });

  it('alex/luis share per unit', () => {
    const state = { ...defaultState, alexPercent: 40 };
    // luisPercent stays 70 (from defaultState), not auto-derived from alex
    const p = { name: 'Test', quantity: 2, grams: 100, printHours: 1 };
    const line = calculator.computeLine(state, p, 2, 0);
    // netUnit = 4700 - 2350 = 2350
    // alexPct=40, luisPct=70 (explicit from state, not auto-calculated)
    const expectedAlexUnit = 2350 * 0.4;  // 940
    const expectedLuisUnit = 2350 * 0.7;  // 1645
    assert.equal(line.alexUnitShare, expectedAlexUnit);
    assert.equal(line.luisUnitShare, expectedLuisUnit);
  });
});

// ───────────────────────────────────────────────────────
// 3. computeAll — full quote computation
// ───────────────────────────────────────────────────────
describe('computeAll', () => {
  it('single product, no discounts', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100, designCost: 0 },
      discounts: { range10_50: 5, range50_100: 10, range100plus: 15 },
      discountRanges: { range10_50: { min: 10, max: 50 }, range50_100: { min: 50, max: 100 }, range100plus: { min: 100, max: null } },
      alexPercent: 30, luisPercent: 70,
      globalDiscount: { enabled: false, percent: 0 },
      wholesaleMode: false,
      products: [{ name: 'Test', quantity: 1, grams: 100, printHours: 1 }],
    };
    const result = calculator.computeAll(state);
    assert.equal(result.products.length, 1);
    assert.equal(result.main.quantity, 1);
    assert.equal(result.main.saleTotal, 4700);
  });

  it('multiple products', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100, designCost: 1000 },
      discounts: { range10_50: 5, range50_100: 10, range100plus: 15 },
      discountRanges: { range10_50: { min: 10, max: 50 }, range50_100: { min: 50, max: 100 }, range100plus: { min: 100, max: null } },
      alexPercent: 40, luisPercent: 60,
      globalDiscount: { enabled: false, percent: 0 },
      wholesaleMode: false,
      products: [
        { name: 'A', quantity: 2, grams: 100, printHours: 2 },
        { name: 'B', quantity: 3, grams: 50, printHours: 0.5 },
      ],
    };
    const result = calculator.computeAll(state);
    assert.equal(result.products.length, 2);
    assert.equal(result.main.productCount, 2);
    assert.equal(result.main.quantity, 5);
  });

  it('global discount reduces subtotal', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100, designCost: 0 },
      discounts: { range10_50: 5, range50_100: 10, range100plus: 15 },
      discountRanges: { range10_50: { min: 10, max: 50 }, range50_100: { min: 50, max: 100 }, range100plus: { min: 100, max: null } },
      alexPercent: 30, luisPercent: 70,
      globalDiscount: { enabled: true, percent: 20 },
      wholesaleMode: false,
      products: [{ name: 'Test', quantity: 1, grams: 100, printHours: 1 }],
    };
    const result = calculator.computeAll(state);
    assert.ok(result.main.globalDiscountAmount > 0);
    assert.equal(result.main.discountPercent, 20);
    assert.ok(result.main.saleTotal < result.main.subtotalGross);
  });

  it('wholesale mode has scenarios', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100, designCost: 0 },
      discounts: { range10_50: 5, range50_100: 10, range100plus: 15 },
      discountRanges: { range10_50: { min: 10, max: 50 }, range50_100: { min: 50, max: 100 }, range100plus: { min: 100, max: null } },
      alexPercent: 30, luisPercent: 70,
      globalDiscount: { enabled: false, percent: 0 },
      wholesaleMode: true,
      products: [{ name: 'Test', quantity: 15, grams: 100, printHours: 1 }],
    };
    const result = calculator.computeAll(state);
    assert.ok(result.scenarios.length === 3);
  });
});

// ───────────────────────────────────────────────────────
// 4. computeQuoteTotal — exact legacy parity
// ───────────────────────────────────────────────────────
describe('computeQuoteTotal', () => {
  it('simple single product, no IVA', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100 },
      products: [{ name: 'Test', quantity: 1, grams: 100, printHours: 1 }],
    };
    // grams=100 → materialCost=(100/1000)*20500=2050
    // hours=1 → timeCost=300, production=2350
    // suggested=round(2350*2+0)=4700
    assert.equal(calculator.computeQuoteTotal(state), 4700);
  });

  it('quantity > 1', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100 },
      products: [{ name: 'Test', quantity: 5, grams: 100, printHours: 1 }],
    };
    // per-unit = 4700, total = 4700 * 5 = 23500
    assert.equal(calculator.computeQuoteTotal(state), 23500);
  });

  it('total-batch grams/hours', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100 },
      products: [{ name: 'Batch', quantity: 5, grams: 500, printHours: 10, qtyInputMode: 'total_batch' }],
    };
    // Legacy uses raw grams/hours directly (not per-unit derived)
    // grams=500 → (500/1000)*20500=10250, hours=10→3000, prod=13250
    // suggested=round(13250*2+0)=26500
    // total = 26500 * 5 = 132500
    assert.equal(calculator.computeQuoteTotal(state), 132500);
  });

  it('manual price', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100 },
      products: [{ name: 'Manual', quantity: 1, grams: 100, printHours: 1,
        salePriceTouched: true, salePriceManual: 10000 }],
    };
    assert.equal(calculator.computeQuoteTotal(state), 10000);
  });

  it('product discount 10%', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100 },
      products: [{ name: 'Disc', quantity: 1, grams: 100, printHours: 1,
        saleDiscountEnabled: true, saleDiscountPercent: 10 }],
    };
    // suggested=4700, round(4700*0.90)=4230
    assert.equal(calculator.computeQuoteTotal(state), 4230);
  });

  it('multiple additionals including hidden', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100 },
      products: [{ name: 'Adds', quantity: 1, grams: 100, printHours: 1,
        additionals: [{ price: 500, showOnInvoice: true }, { price: 300, showOnInvoice: false }] }],
    };
    // additionals=800, production=2350, suggested=round(2350*2+800)=round(5500)=5500
    assert.equal(calculator.computeQuoteTotal(state), 5500);
  });

  it('global discount 10%', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100 },
      globalDiscount: { enabled: true, percent: 10 },
      products: [{ name: 'Disc', quantity: 1, grams: 100, printHours: 1 }],
    };
    // 4700 → round(4700*0.90) = 4230
    assert.equal(calculator.computeQuoteTotal(state), 4230);
  });

  it('wholesale tier 50 units → range50_100 (10%)', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100 },
      discounts: { range10_50: 5, range50_100: 10, range100plus: 15 },
      wholesaleMode: true,
      products: [{ name: 'Test', quantity: 50, grams: 100, printHours: 1 }],
    };
    // qty=50 → 50 >= range50_100.min(=50) → tier 2 = 10% discount
    // suggested=4700, wholesale 10% → round(4700*0.90)=4230
    // total = 4230 * 50 = 211500
    assert.equal(calculator.computeQuoteTotal(state), 211500);
  });

  it('design + shipping, no IVA', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100, designCost: 5000 },
      export: { shippingCost: 3000, includeIva: false },
      products: [{ name: 'Test', quantity: 1, grams: 100, printHours: 1 }],
    };
    // sale=4700, + design=5000 + shipping=3000 = 12700
    assert.equal(calculator.computeQuoteTotal(state), 12700);
  });

  it('IVA applied to design+shipping+sale', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100, designCost: 500 },
      export: { shippingCost: 1000, includeIva: true },
      products: [{ name: 'Test', quantity: 1, grams: 100, printHours: 1 }],
    };
    // sale=4700, design=500 → subtotal=5200
    // with IVA: total = round(5200 * 1.13) = 5876
    // shipping with IVA: round(1000 * 1.13) = 1130
    // grand = 5876 + 1130 = 7006
    assert.equal(calculator.computeQuoteTotal(state), 7006);
  });

  it('multi-product complex quote', () => {
    const state = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100, designCost: 2000 },
      export: { shippingCost: 1500, includeIva: false },
      products: [
        { name: 'Widget A', quantity: 2, grams: 200, printHours: 3,
          additionals: [{ price: 400 }], saleDiscountEnabled: true, saleDiscountPercent: 5 },
        { name: 'Widget B', quantity: 1, grams: 500, printHours: 8,
          additionals: [{ price: 800 }, { price: 200 }] },
      ],
    };
    const total = calculator.computeQuoteTotal(state);
    // Widget A: grams=200 → 200/1000*20500=4100, hours=3→900, prod=5000
    //   adds=400, suggested=round(5000*2+400)=10400
    //   discount 5%: round(10400*0.95)=9880, total = 9880*2 = 19760
    // Widget B: grams=500 → 500/1000*20500=10250, hours=8→2400, prod=12650
    //   adds=1000, suggested=round(12650*2+1000)=26300
    //   total = 26300*1 = 26300
    // subtotal = 19760 + 26300 = 46060
    // + design(2000) + shipping(1500) = 49560
    assert.equal(total, 49560);
  });
});

// ───────────────────────────────────────────────────────
// 5. Tilopay fees
// ───────────────────────────────────────────────────────
describe('Tilopay fees', () => {
  it('computeTilopayPricing calculates 17.5% + ₡185', () => {
    const p = calculator.computeTilopayPricing(10000);
    assert.equal(p.percentFee, 1750);
    assert.equal(p.fixedFee, 185);
    assert.equal(p.serviceFees, 1935);
    assert.equal(p.tilopayTotal, 11935);
  });
});

// ───────────────────────────────────────────────────────
// 6. Security & access
// ───────────────────────────────────────────────────────
describe('Security', () => {
  it('admin routes require authentication', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../routes/adminCostQuoteRoutes.js'), 'utf8');
    assert.ok(src.includes('isAuthenticated'), 'must require auth');
  });

  it('mutation routes use CSRF', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../routes/adminCostQuoteRoutes.js'), 'utf8');
    assert.ok(src.includes('csrfSynchronisedProtection'), 'must include CSRF');
  });

  it('public route has token-based access', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../routes/adminCostQuoteRoutes.js'), 'utf8');
    assert.ok(src.includes('/pago/:token'), 'has public token route');
  });

  it('public route mounted outside admin auth in app.js', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
    assert.ok(src.includes('cotizacion-3d/pago/:token'), 'public route in app.js');
  });
});

// ───────────────────────────────────────────────────────
// 7. Migration
// ───────────────────────────────────────────────────────
describe('Migration', () => {
  it('registered in tracker', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrationTracker.js'), 'utf8');
    assert.ok(src.includes('migrateCostQuote'), 'must be registered');
  });

  it('creates catalog and quotes tables', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-cost-quote.js'), 'utf8');
    assert.ok(src.includes('cost_quote_catalog'), 'creates catalog');
    assert.ok(src.includes('cost_quotes'), 'creates quotes');
    assert.ok(src.includes('CREATE TABLE IF NOT EXISTS'), 'idempotent');
  });

  it('has legacy-parity columns', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-cost-quote.js'), 'utf8');
    assert.ok(src.includes('product_name'), 'product_name');
    assert.ok(src.includes('payload'), 'payload (snapshot)');
    assert.ok(src.includes('workflow_status'), 'workflow_status');
    assert.ok(src.includes('public_token'), 'public_token');
  });

  it('seeds default printer and material', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-cost-quote.js'), 'utf8');
    assert.ok(src.includes("'printer'"), 'seeds printer');
    assert.ok(src.includes("'material'"), 'seeds material');
  });
});

// ───────────────────────────────────────────────────────
// 8. Controller validation
// ───────────────────────────────────────────────────────
describe('Controller validation', () => {
  it('validates product name on create', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('Indicá el nombre del producto'), 'validates name');
  });

  it('blocks approved quote edits', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('aprobada'), 'checks approved');
    assert.ok(src.includes('no se puede editar'), 'approval error');
  });

  it('prevents last catalog item deletion', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('cnt <= 1'), 'minimum count check');
  });

  it('has publicQuote and publicConfirm handlers', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('publicQuote'), 'public quote handler');
    assert.ok(src.includes('publicConfirm'), 'public confirm handler');
  });

  it('has sendEmail and pdfData endpoints', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('sendEmail'), 'email handler');
    assert.ok(src.includes('pdfData'), 'pdf handler');
  });

  it('has setWorkflowStatus handler', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('setWorkflowStatus'), 'workflow handler');
  });

  it('uses snapshot-based save/load', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('snapshot'), 'snapshot param');
    assert.ok(src.includes('payload'), 'payload field');
  });
});
