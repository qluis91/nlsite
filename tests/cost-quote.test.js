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

  it('withIva does not inflate (prices already final)', () => {
    assert.equal(calculator.withIva(1000, true), 1000);
    assert.equal(calculator.withIva(1000, false), 1000);
  });

  it('extractIncludedIva splits gross without ₡1 drift', () => {
    const split = calculator.extractIncludedIva(31800);
    assert.equal(split.gross, 31800);
    assert.equal(split.net, 28142);
    assert.equal(split.iva, 3658);
    assert.equal(split.net + split.iva, split.gross);
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

  it('included/excluded keep base payable; add applies 13%', () => {
    const base = {
      costs: { hourRate: 300, kgPrice: 20500, profitPercent: 100, designCost: 500 },
      products: [{ name: 'Test', quantity: 1, grams: 100, printHours: 1 }],
    };
    // sale=4700 + design=500 + shipping=1000 = 6200
    const excluded = calculator.computeQuoteTotal({
      ...base,
      export: { shippingCost: 1000, taxMode: 'excluded' },
    });
    const included = calculator.computeQuoteTotal({
      ...base,
      export: { shippingCost: 1000, taxMode: 'included' },
    });
    const add = calculator.computeQuoteTotal({
      ...base,
      export: { shippingCost: 1000, taxMode: 'add' },
    });
    assert.equal(excluded, 6200);
    assert.equal(included, 6200);
    assert.equal(add, 7006); // 6200 + round(6200*0.13)=6200+806
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
    // + design once per product (2000×2=4000) + shipping(1500) = 51560
    assert.equal(total, 51560);
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

  it('Tilopay fees for production regression base 31800', () => {
    const p = calculator.computeTilopayPricing(31800);
    assert.equal(p.percentFee, 5565);
    assert.equal(p.fixedFee, 185);
    assert.equal(p.tilopayTotal, 37550);
  });
});

describe('taxMode — included / add / excluded', () => {
  const productionRegression = {
    costs: { designCost: 0, hourRate: 300, kgPrice: 20500, profitPercent: 100 },
    export: { taxMode: 'included', shippingCost: 0 },
    products: [
      {
        name: 'rotulo 20x10cm',
        quantity: 1,
        grams: 1,
        printHours: 0,
        salePriceTouched: true,
        salePriceManual: 15000,
        additionals: [],
      },
      {
        name: 'rotulo 8.5x5.5cm',
        quantity: 6,
        grams: 1,
        printHours: 0,
        salePriceTouched: true,
        salePriceManual: 2800,
        additionals: [],
      },
    ],
  };

  function loadPdf() {
    const vm = require('node:vm');
    const pdfSrc = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    const sandbox = { console };
    vm.runInNewContext(pdfSrc, sandbox);
    return sandbox.AdminCostQuotePdf;
  }

  it('normalizeTaxMode rejects unknown values', () => {
    assert.equal(calculator.normalizeTaxMode('included'), 'included');
    assert.equal(calculator.normalizeTaxMode('add'), 'add');
    assert.equal(calculator.normalizeTaxMode('excluded'), 'excluded');
    assert.equal(calculator.normalizeTaxMode('nope'), 'excluded');
    assert.equal(calculator.normalizeTaxMode(null), 'excluded');
  });

  it('applyTaxMode included: base 10000 → payable 10000, net+iva=10000', () => {
    const tax = calculator.applyTaxMode(10000, 'included');
    assert.equal(tax.total, 10000);
    assert.equal(tax.base, 8850);
    assert.equal(tax.iva, 1150);
    assert.equal(tax.base + tax.iva, 10000);
  });

  it('applyTaxMode add: base 10000 → iva 1300, total 11300', () => {
    const tax = calculator.applyTaxMode(10000, 'add');
    assert.equal(tax.iva, 1300);
    assert.equal(tax.total, 11300);
  });

  it('applyTaxMode excluded: base 10000 → iva 0, total 10000', () => {
    const tax = calculator.applyTaxMode(10000, 'excluded');
    assert.equal(tax.iva, 0);
    assert.equal(tax.total, 10000);
  });

  it('legacy includeIva true → included; false → excluded', () => {
    assert.equal(calculator.resolveTaxMode({ includeIva: true }), 'included');
    assert.equal(calculator.resolveTaxMode({ includeIva: false }), 'excluded');
    assert.equal(calculator.resolveTaxMode({}), 'excluded');
  });

  it('taxMode wins over legacy includeIva', () => {
    assert.equal(calculator.resolveTaxMode({ taxMode: 'add', includeIva: true }), 'add');
    assert.equal(calculator.resolveTaxMode({ taxMode: 'excluded', includeIva: true }), 'excluded');
  });

  it('real case included: TOTAL 31800, net 28142, iva 3658', () => {
    assert.equal(calculator.computeQuoteTotal(productionRegression), 31800);
    const tax = calculator.applyTaxMode(31800, 'included');
    assert.equal(tax.base, 28142);
    assert.equal(tax.iva, 3658);
    assert.equal(tax.total, 31800);
  });

  it('real case add: Subtotal 31800, IVA 4134, TOTAL 35934', () => {
    const state = {
      ...productionRegression,
      export: { taxMode: 'add', shippingCost: 0 },
    };
    assert.equal(calculator.computeQuoteTotal(state), 35934);
    const tax = calculator.applyTaxMode(31800, 'add');
    assert.equal(tax.iva, 4134);
    assert.equal(tax.total, 35934);
  });

  it('real case excluded: TOTAL 31800, no IVA charged', () => {
    const state = {
      ...productionRegression,
      export: { taxMode: 'excluded', shippingCost: 0 },
    };
    assert.equal(calculator.computeQuoteTotal(state), 31800);
    const tax = calculator.applyTaxMode(31800, 'excluded');
    assert.equal(tax.iva, 0);
    assert.equal(tax.total, 31800);
  });

  it('discount before tax: included extracts from 9000', () => {
    const state = {
      costs: { designCost: 0 },
      export: { taxMode: 'included', shippingCost: 0 },
      products: [{
        name: 'disc',
        quantity: 1,
        salePriceTouched: true,
        salePriceManual: 10000,
        saleDiscountEnabled: true,
        saleDiscountPercent: 10,
        additionals: [],
      }],
    };
    assert.equal(calculator.computeQuoteTotal(state), 9000);
    const tax = calculator.applyTaxMode(9000, 'included');
    assert.equal(tax.base + tax.iva, 9000);
  });

  it('discount before tax: add charges 13% on 9000', () => {
    const state = {
      costs: { designCost: 0 },
      export: { taxMode: 'add', shippingCost: 0 },
      products: [{
        name: 'disc',
        quantity: 1,
        salePriceTouched: true,
        salePriceManual: 10000,
        saleDiscountEnabled: true,
        saleDiscountPercent: 10,
        additionals: [],
      }],
    };
    assert.equal(calculator.computeQuoteTotal(state), 10170);
  });

  it('shipping/design participate in taxable base for add mode', () => {
    const state = {
      costs: { designCost: 5000 },
      export: { taxMode: 'add', shippingCost: 3000 },
      products: [{
        name: 'ship',
        quantity: 1,
        salePriceTouched: true,
        salePriceManual: 10000,
        additionals: [],
      }],
    };
    // base 18000 + 13% = 20340
    assert.equal(calculator.computeQuoteTotal(state), 20340);
  });

  it('included does not inflate shipping/design', () => {
    const state = {
      costs: { designCost: 5000 },
      export: { taxMode: 'included', shippingCost: 3000 },
      products: [{
        name: 'ship',
        quantity: 1,
        salePriceTouched: true,
        salePriceManual: 10000,
        additionals: [],
      }],
    };
    assert.equal(calculator.computeQuoteTotal(state), 18000);
  });

  it('server/PDF parity for each taxMode on 31800 base', () => {
    const pdf = loadPdf();
    ['included', 'add', 'excluded'].forEach((mode) => {
      const state = {
        ...productionRegression,
        export: { taxMode: mode, shippingCost: 0 },
      };
      const result = calculator.computeAll(state);
      const server = calculator.computeQuoteTotal(state);
      const grand = pdf.computeGrandTotal({ state, result, taxMode: mode });
      assert.equal(grand, server, 'parity for ' + mode);
    });
    assert.equal(
      calculator.computeQuoteTotal({ ...productionRegression, export: { taxMode: 'add', shippingCost: 0 } }),
      35934
    );
    assert.equal(
      calculator.computeQuoteTotal({ ...productionRegression, export: { taxMode: 'included', shippingCost: 0 } }),
      31800
    );
  });

  it('legacy includeIva true still maps PDF/server to included 31800', () => {
    const pdf = loadPdf();
    const legacy = {
      ...productionRegression,
      export: { includeIva: true, shippingCost: 0 },
    };
    assert.equal(calculator.resolveTaxMode(legacy.export), 'included');
    assert.equal(calculator.computeQuoteTotal(legacy), 31800);
    const result = calculator.computeAll(legacy);
    assert.equal(pdf.computeGrandTotal({ state: legacy, result }), 31800);
  });

  it('Tilopay fee base uses payable total after taxMode', () => {
    const included = calculator.computeTilopayPricing(31800);
    const add = calculator.computeTilopayPricing(35934);
    assert.equal(included.tilopayTotal, 37550);
    assert.ok(add.tilopayTotal > included.tilopayTotal);
  });

  it('UI exposes two exclusive tax checkboxes with exact labels', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'),
      'utf8'
    );
    assert.match(src, /Precios incluyen IVA \(13%\)/);
    assert.match(src, /Incluir IVA \(13%\) al total/);
    assert.match(src, /cq-taxIncluded/);
    assert.match(src, /cq-taxAdd/);
    assert.match(src, /taxMode:\s*'excluded'/);
    assert.match(src, /migrateExportTaxMode/);
    assert.match(src, /taxAddCheck\.checked\s*=\s*false/);
    assert.match(src, /taxIncludedCheck\.checked\s*=\s*false/);
    assert.match(src, /Si ninguna opción está marcada, la cotización se considera sin IVA/);
  });

  it('PDF notes and summary labels cover all three modes', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    assert.match(src, /Subtotal sin IVA/);
    assert.match(src, /IVA incluido/);
    assert.match(src, /agregado al total de la cotizaci/);
    assert.match(src, /Los precios indicados no incluyen IVA/);
    assert.match(src, /factura electr/);
    assert.match(src, /applyTaxMode/);
    assert.match(src, /normalizeTaxMode/);
    assert.doesNotMatch(src, /base \* \(1 \+ IVA_RATE\)/);
  });

  it('line prices are not inflated by withIva helper', () => {
    const pdf = loadPdf();
    assert.equal(pdf.withIva(15000, true), 15000);
    assert.equal(pdf.withIva(2800, true), 2800);
    assert.notEqual(pdf.withIva(15000, true), 16950);
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

  it('proven API contract paths are exported', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../routes/adminCostQuoteRoutes.js'), 'utf8');
    assert.ok(src.includes('/cost-quote-catalog'), 'catalog path');
    assert.ok(src.includes('/cost-quotes'), 'quotes path');
    assert.ok(src.includes('apiRouter'), 'api router export');
  });

  it('public route mounted outside admin auth in app.js', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
    assert.ok(src.includes('cotizacion-3d/pago/:token'), 'public route in app.js');
    assert.ok(src.includes("app.use('/api/admin'"), 'api mount in app.js');
  });

  it('CSRF accepts header tokens for JSON APIs', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../config/csrf.js'), 'utf8');
    assert.ok(src.includes("x-csrf-token"), 'reads x-csrf-token header');
  });

  it('API CSRF/500 failures return JSON for /api/ paths', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
    assert.ok(src.includes('wantsApiJson'), 'api json helper');
    assert.ok(src.includes("path.startsWith('/api/')"), 'scopes to /api/');
    assert.match(src, /EBADCSRFTOKEN[\s\S]*wantsApiJson[\s\S]*\.json\(/);
  });

  it('API auth failures return JSON instead of HTML redirects', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../middlewares/authMiddleware.js'), 'utf8');
    assert.ok(src.includes("startsWith('/api/')"));
    assert.ok(src.includes('status(401).json'));
    assert.ok(src.includes('status(403).json'));
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

  it('historical migrate-cost-quote exports only migrate (no repair helpers)', () => {
    const mod = require('../scripts/migrate-cost-quote');
    assert.equal(typeof mod.migrate, 'function');
    assert.equal(mod.COST_QUOTES_REQUIRED_COLUMNS, undefined);
    assert.equal(mod.ensureCostQuotesColumns, undefined);
    assert.equal(mod.ensureColumn, undefined);
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-cost-quote.js'), 'utf8');
    assert.ok(!src.includes('COST_QUOTES_REQUIRED_COLUMNS'));
    assert.ok(!src.includes('ensureCostQuotesColumns'));
    assert.match(src, /module\.exports\s*=\s*\{\s*migrate\s*\}/);
  });

  it('seeds default printer and material', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-cost-quote.js'), 'utf8');
    assert.ok(src.includes("'printer'"), 'seeds printer');
    assert.ok(src.includes("'material'"), 'seeds material');
  });
});

describe('Cost quote schema repair helpers', () => {
  it('lists every modern persistence column', () => {
    const {
      COST_QUOTES_REQUIRED_COLUMNS,
    } = require('../scripts/cost-quote-schema-repair-helpers');
    const names = COST_QUOTES_REQUIRED_COLUMNS.map(([col]) => col);
    for (const required of [
      'product_name', 'payload', 'workflow_status', 'public_token',
      'client_email', 'client_name', 'total_crc',
      'linked_order_id', 'pdf_filename', 'workflow_data',
      'created_by', 'created_at', 'updated_at',
    ]) {
      assert.ok(names.includes(required), `must repair ${required}`);
    }
  });

  it('repairs an existing legacy cost_quotes table missing required columns', async () => {
    const {
      ensureCostQuotesColumns,
      COST_QUOTES_REQUIRED_COLUMNS,
    } = require('../scripts/cost-quote-schema-repair-helpers');

    const present = new Set(['id', 'created_at', 'updated_at']);
    const alters = [];

    const fakePool = {
      async query(sql, params) {
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
          const col = params?.[1];
          return [[{ cnt: present.has(col) ? 1 : 0 }], []];
        }
        if (/ALTER TABLE/.test(sql)) {
          const col = params?.[1];
          alters.push(col);
          present.add(col);
          return [{ affectedRows: 1 }, []];
        }
        throw new Error('Unexpected query: ' + String(sql).slice(0, 80));
      },
    };

    const added = await ensureCostQuotesColumns(fakePool);
    for (const col of [
      'product_name', 'payload', 'workflow_status', 'public_token',
      'client_email', 'client_name', 'total_crc',
      'linked_order_id', 'pdf_filename', 'workflow_data', 'created_by',
    ]) {
      assert.ok(alters.includes(col), `legacy repair must ADD ${col}`);
      assert.ok(present.has(col), `${col} must exist after repair`);
    }
    assert.ok(!alters.includes('created_at'), 'must not recreate existing created_at');
    assert.ok(!alters.includes('updated_at'), 'must not recreate existing updated_at');
    assert.equal(added.length, COST_QUOTES_REQUIRED_COLUMNS.length - 2);
  });

  it('second repair pass is idempotent (no ALTER when columns exist)', async () => {
    const {
      ensureCostQuotesColumns,
      COST_QUOTES_REQUIRED_COLUMNS,
    } = require('../scripts/cost-quote-schema-repair-helpers');
    const present = new Set(COST_QUOTES_REQUIRED_COLUMNS.map(([col]) => col).concat('id'));
    let alterCount = 0;
    const fakePool = {
      async query(sql, params) {
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
          return [[{ cnt: present.has(params[1]) ? 1 : 0 }], []];
        }
        if (/ALTER TABLE/.test(sql)) {
          alterCount += 1;
          return [{ affectedRows: 1 }, []];
        }
        throw new Error('Unexpected query');
      },
    };
    const added = await ensureCostQuotesColumns(fakePool);
    assert.deepEqual(added, []);
    assert.equal(alterCount, 0);
  });
});


// ───────────────────────────────────────────────────────
// 8. Catalog + quote store contracts (ported API shapes)
// ───────────────────────────────────────────────────────
describe('Catalog store shapes', () => {
  const catalogStore = require('../services/costQuoteCatalogStore');

  it('normalizePrinter/material/additional return source shapes', () => {
    assert.deepEqual(
      catalogStore.normalizePrinter({ id: '1', name: 'X', hourRate: 300.4 }),
      {
        id: '1',
        name: 'X',
        electricityCostPerHour: 0,
        machineWearCostPerHour: 300,
        hourRate: 300,
      }
    );
    assert.deepEqual(
      catalogStore.normalizePrinter({
        id: '2',
        name: 'Y',
        electricityCostPerHour: 35.4,
        machineWearCostPerHour: 165.2,
      }),
      {
        id: '2',
        name: 'Y',
        electricityCostPerHour: 35,
        machineWearCostPerHour: 165,
        hourRate: 200,
      }
    );
    assert.deepEqual(
      catalogStore.normalizeMaterial({ id: '2', name: 'PLA', kgPrice: 20500.4 }),
      { id: '2', name: 'PLA', kgPrice: 20500 }
    );
    assert.deepEqual(
      catalogStore.normalizeAdditional({ id: '3', description: 'Lija', price: 500.2 }),
      { id: '3', description: 'Lija', price: 500 }
    );
  });

  it('prevents deleting last printer/material', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../services/costQuoteCatalogStore.js'), 'utf8');
    assert.ok(src.includes('Debe quedar al menos una impresora.'));
    assert.ok(src.includes('Debe quedar al menos un material.'));
  });

  it('upsertPrinter updates by id instead of always inserting', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../services/costQuoteCatalogStore.js'), 'utf8');
    assert.ok(src.includes('editId'));
    assert.ok(src.includes("catalog_type = 'printer'"));
    assert.ok(src.includes('UPDATE cost_quote_catalog'));
  });

  it('normalizes and validates quotation emails', () => {
    assert.deepEqual(
      catalogStore.normalizeEmail({
        id: '9',
        email: ' Ventas@NinjaLabCR.com ',
        label: 'Ventas',
        isDefault: true,
      }),
      { id: '9', email: 'ventas@ninjalabcr.com', label: 'Ventas', isDefault: true }
    );
    assert.equal(catalogStore.validateEmailAddress(''), 'Indicá el correo electrónico.');
    assert.equal(catalogStore.validateEmailAddress('not-an-email'), 'El correo no es válido.');
    assert.equal(catalogStore.validateEmailAddress('ok@ninjalab3d.com'), null);
  });

  it('exposes email catalog CRUD helpers', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../services/costQuoteCatalogStore.js'), 'utf8');
    assert.ok(src.includes("catalog_type='email'") || src.includes("catalog_type = 'email'"));
    assert.ok(typeof catalogStore.upsertEmail === 'function');
    assert.ok(typeof catalogStore.deleteEmail === 'function');
    assert.ok(typeof catalogStore.setDefaultEmail === 'function');
    assert.ok(src.includes('Debe quedar al menos un correo'));
  });
});

describe('Quotation email catalog + default description UX', () => {
  it('registers migrateCostQuotePrinterCosts last in tracker', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrationTracker.js'), 'utf8');
    assert.match(src, /migrateCostQuoteEmails/);
    assert.match(src, /migrateCostQuotePrinterCosts/);
    const idxPrinter = src.lastIndexOf('migrateCostQuotePrinterCosts');
    const idxEmails = src.lastIndexOf("name: 'migrateCostQuoteEmails'");
    const idxQuotes = src.lastIndexOf('migrateQuoteRequests');
    assert.ok(idxPrinter > idxEmails);
    assert.ok(idxEmails > idxQuotes);
  });

  it('email migration seeds legacy addresses idempotently', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-cost-quote-emails.js'), 'utf8');
    assert.match(src, /info@ninjalab3d\.com/);
    assert.match(src, /lquijano@ninjalab3d\.com/);
    assert.match(src, /badilla@ninjalab3d\.com/);
    assert.match(src, /Email rows already present/);
    assert.match(src, /Does not edit historical migrate-cost-quote\.js/);
    assert.doesNotMatch(src, /require\(['"]\.\/migrate-cost-quote['"]\)/);
  });

  it('API routes expose email catalog endpoints with CSRF', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../routes/adminCostQuoteRoutes.js'), 'utf8');
    assert.match(src, /cost-quote-catalog\/emails/);
    assert.match(src, /emails\/:id\/default/);
    assert.match(src, /upsertEmail/);
    assert.match(src, /deleteEmail/);
    assert.match(src, /setDefaultEmail/);
  });

  it('frontend uses catalog emails and per-product default description', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');
    assert.match(src, /DEFAULT_SERVICE_DESCRIPTION/);
    assert.match(src, /Impresión 3D de alta calidad\\n/);
    assert.match(src, /Descripción del producto/);
    assert.match(src, /cq-productDescription-/);
    assert.doesNotMatch(src, /Descripción del servicio/);
    assert.match(src, /buildQuoteEmailOptions/);
    assert.match(src, /guardado en esta cotización/);
    assert.match(src, /Correos de cotización/);
    assert.doesNotMatch(src, /var QUOTE_EMAILS\s*=/);
    assert.doesNotMatch(src, /function normalizeQuoteEmail/);
  });

  it('PDF uses snapshot quoteEmail without hardcoded allow-list', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'), 'utf8');
    assert.match(src, /function resolveQuoteEmail/);
    assert.doesNotMatch(src, /var QUOTE_EMAILS\s*=/);
  });
});

describe('PDF presentation polish', () => {
  const pdfSrc = fs.readFileSync(
    path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
    'utf8'
  );

  it('footer brand website is ninjalabcr.com', () => {
    assert.match(pdfSrc, /web:\s*'www\.ninjalabcr\.com'/);
    assert.doesNotMatch(pdfSrc, /web:\s*'www\.ninjalab3d\.com'/);
  });

  it('does not render Total con pago web in PDF HTML', () => {
    const footerFn = pdfSrc.slice(
      pdfSrc.indexOf('function renderTilopayNote'),
      pdfSrc.indexOf('function renderSummaryRows')
    );
    assert.match(footerFn, /return ''/);
    // No rendered HTML/template string for the payment-web line
    assert.doesNotMatch(footerFn, /summary-tilopay-note__total/);
    assert.doesNotMatch(footerFn, /Total con pago web:\s*<strong>/);
    // Calculation helper must remain available elsewhere
    assert.match(pdfSrc, /NLTilopayFees/);
  });

  it('table subtotal footer leaves Precio unit. cell empty', () => {
    const fn = pdfSrc.slice(
      pdfSrc.indexOf('function renderTableFooter'),
      pdfSrc.indexOf('function renderTilopayNote')
    );
    assert.match(fn, /<td class="money"><\/td>/);
    assert.doesNotMatch(fn, /showUnitSubtotal/);
    assert.doesNotMatch(fn, /fmtMoney\(unitSum\)/);
    // Total column still shows grossSub
    assert.match(fn, /fmtMoney\(grossSub\)/);
    // 6 columns without discount: colspan 4 + empty unit + total
    assert.match(fn, /colspan="'\s*\+\s*labelCols/);
  });
});

describe('Quote store contracts', () => {
  const quoteStore = require('../services/costQuoteStore');

  it('buildPayload preserves complete snapshot fields', () => {
    const payload = quoteStore.buildPayload(
      {
        costs: { hourRate: 300, kgPrice: 20500 },
        discounts: { range10_50: 5 },
        discountRanges: { range10_50: { min: 10, max: 50 } },
        products: [{ name: 'Casco', quantity: 2, grams: 100, printHours: 1 }],
        alexPercent: 50,
        globalDiscount: { enabled: true, percent: 10 },
        scenarioQty: { a: 10 },
        wholesaleMode: true,
        export: { clientName: 'Ana', clientEmail: 'a@b.com' },
      },
      'Casco'
    );
    assert.equal(payload.products[0].name, 'Casco');
    assert.equal(payload.product.name, 'Casco');
    assert.equal(payload.alexPercent, 50);
    assert.equal(payload.wholesaleMode, true);
    assert.equal(payload.export.clientEmail, 'a@b.com');
    assert.equal(payload.globalDiscount.percent, 10);
  });

  it('quotation name uses order title, not first product (multi-product)', () => {
    const snapshot = {
      products: [
        { name: 'Figura 3D', quantity: 1 },
        { name: 'Base LED', quantity: 1 },
      ],
      export: { orderTitle: 'Pedido personalizado Naruto' },
    };
    assert.equal(
      quoteStore.getQuoteDisplayName(snapshot),
      'Pedido personalizado Naruto'
    );
    assert.notEqual(quoteStore.getQuoteDisplayName(snapshot), 'Figura 3D');
    const payload = quoteStore.buildPayload(snapshot, quoteStore.getQuoteDisplayName(snapshot));
    assert.equal(payload.products[0].name, 'Figura 3D');
    assert.equal(payload.products[1].name, 'Base LED');
  });

  it('quotation name uses order title for single product', () => {
    const snapshot = {
      products: [{ name: 'Pieza impresa', quantity: 1 }],
      export: { orderTitle: 'Repuesto personalizado Honda' },
    };
    assert.equal(
      quoteStore.getQuoteDisplayName(snapshot),
      'Repuesto personalizado Honda'
    );
    assert.notEqual(quoteStore.getQuoteDisplayName(snapshot), 'Pieza impresa');
  });

  it('buildPayload does not overwrite product names with order title', () => {
    const payload = quoteStore.buildPayload(
      {
        products: [
          { name: 'Figura 3D', quantity: 1 },
          { name: 'Base personalizada', quantity: 1 },
        ],
        export: { orderTitle: 'Figura personalizada Goku' },
      },
      'Figura personalizada Goku'
    );
    assert.equal(payload.products[0].name, 'Figura 3D');
    assert.equal(payload.products[1].name, 'Base personalizada');
    assert.equal(payload.product.name, 'Figura 3D');
    assert.equal(payload.export.orderTitle, 'Figura personalizada Goku');
  });

  it('product-name fallback only when orderTitle absent (legacy display helper)', () => {
    const legacy = {
      products: [
        { name: 'Figura 3D', quantity: 1 },
        { name: 'Base LED', quantity: 1 },
      ],
      export: {},
    };
    assert.equal(quoteStore.getOrderTitle(legacy), '');
    assert.equal(quoteStore.getQuoteDisplayName(legacy), 'Figura 3D +1 más');
    const withTitle = {
      ...legacy,
      export: { orderTitle: 'Pedido personalizado Naruto' },
    };
    assert.equal(quoteStore.getQuoteDisplayName(withTitle), 'Pedido personalizado Naruto');
  });

  it('saveCostQuote without orderTitle/productName does not invent Product 1 name', async () => {
    const r = await quoteStore.saveCostQuote(
      {
        products: [{ name: 'Figura 3D', quantity: 1, grams: 0, printHours: 0 }],
        costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
        discounts: {},
        discountRanges: {},
        export: { clientName: 'X' },
      },
      ''
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /título de la orden/i);
  });

  it('frontend save requires getOrderTitle (source)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'),
      'utf8'
    );
    assert.match(src, /function getOrderTitle\(state\)/);
    assert.match(src, /if \(orderTitle\) return orderTitle/);
    assert.match(src, /var name = getOrderTitle\(state\)/);
    assert.match(src, /título de la orden antes de guardar/i);
  });

  it('blocks approved quote edits', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../services/costQuoteStore.js'), 'utf8');
    assert.ok(src.includes("workflowStatus === 'aprobada'"));
    assert.ok(src.includes('no se puede editar'));
  });

  it('save existing quote reuses id option', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../services/costQuoteStore.js'), 'utf8');
    assert.ok(src.includes('existingId'));
    assert.ok(src.includes('opts.id'));
  });
});

describe('Controller + frontend port wiring', () => {
  it('has publicQuote and publicConfirm handlers', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('publicQuote'));
    assert.ok(src.includes('publicConfirm'));
  });

  it('loads proven scripts in pageScripts order', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../controllers/adminCostQuoteController.js'), 'utf8');
    assert.ok(src.includes('admin-cost-quote-pdf.js'));
    assert.ok(src.includes('admin-cost-quote.js'));
    assert.ok(src.includes('admin-cost-quote-boot.js'));
    assert.ok(src.includes('tilopay-fees.js'));
  });

  it('references the existing LogoCompleto.png asset for the PDF logo', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'), 'utf8');
    assert.ok(src.includes("var LOGO_URL = '/images/LogoCompleto.png';"));
    assert.ok(!src.includes('/images/logo-combo.png'));
  });

  it('thin mount page targets admin-cost-quote-app', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../views/pages/admin/cost-quote.ejs'), 'utf8');
    assert.ok(src.includes('id="admin-cost-quote-app"'));
    assert.ok(src.includes('csrf-token'));
    assert.doesNotMatch(src, /data-catalog=/);
  });

  it('frontend api helper sends CSRF headers', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');
    assert.ok(src.includes("headers['x-csrf-token']") || src.includes("'x-csrf-token'"));
    assert.ok(src.includes('/api/admin/cost-quotes'));
    assert.ok(src.includes('/api/admin/cost-quote-catalog'));
    assert.ok(src.includes('AdminCostQuote'));
  });

  it('never sends duplicate case-variant CSRF headers', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');
    assert.equal(src.includes('X-CSRF-Token'), false, 'must not set X-CSRF-Token');
    const lowerCount = (src.match(/['"]x-csrf-token['"]/g) || []).length;
    assert.ok(lowerCount >= 1, 'must set x-csrf-token at least once');
    // No adjacent dual assignment of both casings
    assert.doesNotMatch(
      src,
      /X-CSRF-Token[\s\S]{0,80}x-csrf-token|x-csrf-token[\s\S]{0,80}X-CSRF-Token/
    );
  });

  it('resin filtering remains name-based in frontend', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');
    assert.ok(src.includes('isResinaName'));
    assert.ok(src.includes('resina'));
  });

  it('custom Tab navigation excludes catalog CRUD form fields', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');
    const tabFn = src.slice(src.indexOf('function getTabOrder'), src.indexOf('function focusFieldById'));
    assert.ok(tabFn.includes('cq-catalog-form'), 'excludes catalog form');
    assert.ok(tabFn.includes('cq-catalog-panel'), 'excludes catalog panel');
    assert.ok(tabFn.includes('closest('), 'uses closest exclusion');
    assert.match(tabFn, /cq-catalog-form[\s\S]*return false/);
  });
});

describe('Integration catalog/quote round-trip', () => {
  const catalogStore = require('../services/costQuoteCatalogStore');
  const quoteStore = require('../services/costQuoteStore');

  it('printer CRUD updates same record and enforces last-item rule', async () => {
    const created = await catalogStore.upsertPrinter({ name: 'Test Printer Port', hourRate: 350 });
    assert.equal(created.ok, true);
    assert.ok(created.item.id);
    assert.equal(created.item.hourRate, 350);

    const updated = await catalogStore.upsertPrinter({
      id: created.item.id,
      name: 'Test Printer Port Edited',
      hourRate: 400,
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.item.id, String(created.item.id));
    assert.equal(updated.item.hourRate, 400);
    assert.equal(updated.catalog.printers.filter((p) => p.id === String(created.item.id)).length, 1);

    const deleted = await catalogStore.deletePrinter(created.item.id);
    assert.equal(deleted.ok, true);
  });

  it('material CRUD updates same record', async () => {
    const created = await catalogStore.upsertMaterial({ name: 'Test Material Port', kgPrice: 21000 });
    assert.equal(created.ok, true);
    const updated = await catalogStore.upsertMaterial({
      id: created.item.id,
      name: 'Test Material Port Edited',
      kgPrice: 22000,
    });
    assert.equal(updated.item.id, String(created.item.id));
    assert.equal(updated.item.kgPrice, 22000);
    await catalogStore.deleteMaterial(created.item.id);
  });

  it('additional CRUD works', async () => {
    const created = await catalogStore.upsertAdditional({ description: 'Lijado test', price: 750 });
    assert.equal(created.ok, true);
    assert.equal(created.item.description, 'Lijado test');
    const updated = await catalogStore.upsertAdditional({
      id: created.item.id,
      description: 'Lijado test 2',
      price: 800,
    });
    assert.equal(updated.item.id, String(created.item.id));
    assert.equal(updated.item.price, 800);
    await catalogStore.deleteAdditional(created.item.id);
  });

  it('quote create/update/load/delete preserves full snapshot and ids', async () => {
    const catalog = await catalogStore.getCatalog();
    const printer = catalog.printers[0];
    const material = catalog.materials[0];
    assert.ok(printer && material, 'catalog must have defaults');

    const snapshot = {
      costs: {
        hourRate: printer.hourRate,
        kgPrice: material.kgPrice,
        profitPercent: 100,
        designCost: 0,
        printerId: String(printer.id),
        materialId: String(material.id),
      },
      discounts: { range10_50: 5, range50_100: 10, range100plus: 15 },
      discountRanges: {
        range10_50: { min: 10, max: 50 },
        range50_100: { min: 50, max: 100 },
        range100plus: { min: 100, max: null },
      },
      products: [
        {
          id: 'p1',
          name: 'Producto A',
          quantity: 2,
          grams: 100,
          printHours: 1,
          additionals: [{ description: 'Extra', price: 200, showOnInvoice: true }],
        },
        { id: 'p2', name: 'Producto B', quantity: 1, grams: 50, printHours: 0.5, additionals: [] },
      ],
      alexPercent: 60,
      globalDiscount: { enabled: false, percent: 0 },
      scenarioQty: {},
      wholesaleMode: false,
      export: {
        clientName: 'Cliente Test',
        clientEmail: 'cliente@test.com',
        orderTitle: 'Pedido personalizado Naruto',
      },
    };

    const created = await quoteStore.saveCostQuote(
      snapshot,
      quoteStore.getQuoteDisplayName(snapshot),
      {
        clientEmail: 'cliente@test.com',
        clientName: 'Cliente Test',
      }
    );
    assert.equal(created.ok, true);
    assert.ok(created.id);

    const loaded = await quoteStore.getCostQuoteRecord(created.id);
    assert.equal(loaded.payload.costs.printerId, String(printer.id));
    assert.equal(loaded.payload.costs.materialId, String(material.id));
    assert.equal(loaded.payload.products.length, 2);
    assert.equal(loaded.payload.alexPercent, 60);
    assert.equal(loaded.productName, 'Pedido personalizado Naruto');
    assert.equal(loaded.payload.products[0].name, 'Producto A');
    assert.notEqual(loaded.productName, 'Producto A');

    const updatedSnapshot = {
      ...snapshot,
      products: [{ ...snapshot.products[0], name: 'Producto A Editado' }],
      export: { ...snapshot.export, orderTitle: 'Repuesto personalizado Honda' },
    };
    const updated = await quoteStore.saveCostQuote(
      updatedSnapshot,
      quoteStore.getQuoteDisplayName(updatedSnapshot),
      { id: created.id, clientEmail: 'cliente@test.com', clientName: 'Cliente Test' }
    );
    assert.equal(updated.ok, true);
    assert.equal(updated.id, created.id);

    const reloaded = await quoteStore.getCostQuoteRecord(created.id);
    assert.equal(reloaded.productName, 'Repuesto personalizado Honda');
    assert.equal(reloaded.payload.products[0].name, 'Producto A Editado');
    assert.equal(reloaded.payload.export.orderTitle, 'Repuesto personalizado Honda');

    await quoteStore.setWorkflowStatus(created.id, 'aprobada', { approvedAt: Date.now() });
    const blocked = await quoteStore.saveCostQuote(snapshot, 'X', { id: created.id });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /aprobada/);

    await quoteStore.setWorkflowStatus(created.id, 'pendiente', {});
    const del = await quoteStore.deleteCostQuote(created.id);
    assert.equal(del.ok, true);
  });
});

describe('Cost quote varchar-id migration', () => {
  it('is registered after migrateCostQuote', () => {
    const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');
    const names = MIGRATION_REGISTRY.map((e) => e.name);
    const iCost = names.indexOf('migrateCostQuote');
    const iFix = names.indexOf('migrateCostQuoteVarcharId');
    assert.ok(iCost >= 0);
    assert.ok(iFix > iCost);
  });

  it('imports repair helpers from the helper module, not historical migrate-cost-quote', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../scripts/migrate-cost-quote-varchar-id.js'),
      'utf8'
    );
    assert.ok(src.includes("require('./cost-quote-schema-repair-helpers')"));
    assert.ok(!src.includes("require('./migrate-cost-quote')"));
  });

  it('converts int id and relaxes legacy required columns', async () => {
    const { migrateCostQuoteVarcharId } = require('../scripts/migrate-cost-quote-varchar-id');
    const present = new Map([
      ['id', { DATA_TYPE: 'int', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: 'auto_increment' }],
      ['title', { DATA_TYPE: 'varchar', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: '' }],
      ['products', { DATA_TYPE: 'longtext', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: '' }],
    ]);
    // Pretend payload-era columns already exist so ensureCostQuotesColumns is a no-op.
    for (const col of [
      'product_name', 'payload', 'workflow_status', 'public_token', 'client_email', 'client_name',
      'total_crc', 'linked_order_id', 'pdf_filename', 'workflow_data', 'created_by', 'created_at', 'updated_at',
    ]) {
      present.set(col, { DATA_TYPE: 'varchar', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null, EXTRA: '' });
    }
    const alters = [];
    const fakePool = {
      async query(sql, params) {
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql) && /COUNT\(\*\)/.test(sql)) {
          const col = params?.[1];
          return [[{ cnt: present.has(col) ? 1 : 0 }], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
          const col = params?.[1];
          const meta = present.get(col);
          return [meta ? [Object.assign({ COLUMN_NAME: col, COLUMN_TYPE: meta.DATA_TYPE }, meta)] : [], []];
        }
        if (/INFORMATION_SCHEMA\.STATISTICS/.test(sql)) return [[{ cnt: 1 }], []];
        if (/ALTER TABLE/.test(sql)) {
          alters.push(String(sql));
          return [{ affectedRows: 1 }, []];
        }
        throw new Error('Unexpected: ' + String(sql).slice(0, 100));
      },
    };
    await migrateCostQuoteVarcharId(fakePool);
    assert.ok(alters.some((s) => /id VARCHAR\(64\)/i.test(s)));
    assert.ok(alters.some((s) => /title VARCHAR\(200\).*DEFAULT ''/i.test(s)));
    assert.ok(alters.some((s) => /products LONGTEXT NULL/i.test(s)));
  });

  it('already-current schema remains unchanged (idempotent)', async () => {
    const { migrateCostQuoteVarcharId } = require('../scripts/migrate-cost-quote-varchar-id');
    const present = new Map([
      ['id', { DATA_TYPE: 'varchar', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null, EXTRA: '' }],
    ]);
    for (const col of [
      'product_name', 'payload', 'workflow_status', 'public_token', 'client_email', 'client_name',
      'total_crc', 'linked_order_id', 'pdf_filename', 'workflow_data', 'created_by', 'created_at', 'updated_at',
    ]) {
      present.set(col, { DATA_TYPE: 'varchar', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null, EXTRA: '' });
    }
    let alterCount = 0;
    const fakePool = {
      async query(sql, params) {
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql) && /COUNT\(\*\)/.test(sql)) {
          return [[{ cnt: present.has(params?.[1]) ? 1 : 0 }], []];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
          const col = params?.[1];
          const meta = present.get(col);
          return [meta ? [Object.assign({ COLUMN_NAME: col, COLUMN_TYPE: meta.DATA_TYPE }, meta)] : [], []];
        }
        if (/INFORMATION_SCHEMA\.STATISTICS/.test(sql)) return [[{ cnt: 1 }], []];
        if (/ALTER TABLE/.test(sql)) {
          alterCount += 1;
          return [{ affectedRows: 1 }, []];
        }
        throw new Error('Unexpected: ' + String(sql).slice(0, 100));
      },
    };
    await migrateCostQuoteVarcharId(fakePool);
    assert.equal(alterCount, 0);
  });
});

describe('Per-product costing + printer electricity/wear', () => {
  it('resolveProductCostParams inherits base when override off', () => {
    const state = {
      costs: {
        printerId: 'a',
        printerName: 'Printer A',
        materialId: 'pla',
        materialName: 'PLA',
        electricityCostPerHour: 35,
        machineWearCostPerHour: 165,
        hourRate: 200,
        kgPrice: 20000,
        designCost: 5000,
        profitPercent: 100,
      },
      products: [{ name: 'A', costOverrides: { enabled: false } }],
    };
    const r = calculator.resolveProductCostParams(state, state.products[0]);
    assert.equal(r.source, 'base');
    assert.equal(r.printerName, 'Printer A');
    assert.equal(r.materialName, 'PLA');
    assert.equal(r.designCost, 5000);
    assert.equal(r.profitPercent, 100);
    assert.equal(r.hourRate, 200);
  });

  it('override product uses custom params; base sibling stays base', () => {
    const state = {
      costs: {
        printerName: 'Printer A',
        materialName: 'PLA',
        electricityCostPerHour: 0,
        machineWearCostPerHour: 300,
        hourRate: 300,
        kgPrice: 20500,
        designCost: 5000,
        profitPercent: 100,
      },
      products: [
        { name: 'A', costOverrides: { enabled: false } },
        {
          name: 'B',
          costOverrides: {
            enabled: true,
            printerName: 'Printer B',
            materialName: 'PETG',
            electricityCostPerHour: 40,
            machineWearCostPerHour: 160,
            hourRate: 200,
            kgPrice: 22000,
            designCost: 8000,
            profitPercent: 70,
          },
        },
      ],
    };
    const a = calculator.resolveProductCostParams(state, state.products[0]);
    const b = calculator.resolveProductCostParams(state, state.products[1]);
    assert.equal(a.materialName, 'PLA');
    assert.equal(a.designCost, 5000);
    assert.equal(b.source, 'override');
    assert.equal(b.materialName, 'PETG');
    assert.equal(b.designCost, 8000);
    assert.equal(b.profitPercent, 70);
    state.costs.materialName = 'TPU';
    assert.equal(calculator.resolveProductCostParams(state, state.products[0]).materialName, 'TPU');
    assert.equal(calculator.resolveProductCostParams(state, state.products[1]).materialName, 'PETG');
  });

  it('design is charged once per product regardless of qty', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 300,
        hourRate: 300,
        kgPrice: 20500,
        designCost: 5000,
        profitPercent: 100,
      },
      export: { taxMode: 'excluded', shippingCost: 0 },
      products: [{
        name: 'Bulk',
        quantity: 20,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceManual: 1000,
        additionals: [],
        costOverrides: { enabled: false },
      }],
    };
    const line = calculator.computeLine(state, state.products[0], 20, 0);
    assert.equal(line.designCost, 5000);
    assert.equal(line.productionCost, 5000);
    assert.equal(calculator.computeQuoteTotal(state), 1000 * 20 + 5000);
  });

  it('multiple products accumulate per-product design', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 300,
        hourRate: 300,
        kgPrice: 20500,
        designCost: 5000,
        profitPercent: 100,
      },
      export: { taxMode: 'excluded', shippingCost: 0 },
      products: [
        {
          name: 'A', quantity: 1, grams: 0, printHours: 0,
          salePriceTouched: true, salePriceManual: 1000, additionals: [],
          costOverrides: { enabled: false },
        },
        {
          name: 'B', quantity: 1, grams: 0, printHours: 0,
          salePriceTouched: true, salePriceManual: 1000, additionals: [],
          costOverrides: {
            enabled: true, designCost: 8000, profitPercent: 100,
            electricityCostPerHour: 0, machineWearCostPerHour: 300, hourRate: 300, kgPrice: 20500,
          },
        },
        {
          name: 'C', quantity: 1, grams: 0, printHours: 0,
          salePriceTouched: true, salePriceManual: 1000, additionals: [],
          costOverrides: { enabled: false },
        },
      ],
    };
    const all = calculator.computeAll(state);
    assert.equal(all.main.designCost, 18000);
    assert.equal(calculator.computeQuoteTotal(state), 3000 + 18000);
  });

  it('printer electricity+wear split matches hourRate invariant', () => {
    const state = {
      costs: {
        electricityCostPerHour: 35,
        machineWearCostPerHour: 165,
        hourRate: 200,
        kgPrice: 20000,
        designCost: 0,
        profitPercent: 100,
      },
      products: [{
        name: 'P', quantity: 1, grams: 0, printHours: 10,
        salePriceTouched: true, salePriceManual: 5000, additionals: [],
      }],
    };
    const line = calculator.computeLine(state, state.products[0], 1, 0);
    assert.equal(line.electricityCost, 350);
    assert.equal(line.machineWearCost, 1650);
    assert.equal(line.timeCost, 2000);
    assert.equal(line.timeCost, 10 * 200);
  });

  it('material cost uses grams/1000 * kgPrice', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 20000,
        designCost: 0,
        profitPercent: 0,
      },
      products: [{ name: 'M', quantity: 1, grams: 250, printHours: 0, additionals: [] }],
    };
    const line = calculator.computeLine(state, state.products[0], 1, 0);
    assert.equal(line.materialCost, 5000);
  });

  it('hidden additionals still count in production cost', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      products: [{
        name: 'H',
        quantity: 2,
        grams: 0,
        printHours: 0,
        additionals: [{ price: 1000, showOnInvoice: false, description: 'hidden' }],
        salePriceTouched: true,
        salePriceManual: 5000,
      }],
    };
    const line = calculator.computeLine(state, state.products[0], 2, 0);
    assert.equal(line.additionalsCost, 1000);
    assert.equal(line.additionalsCostTotal, 2000);
    assert.equal(line.productionCost, 2000);
  });

  it('legacy hourRate-only costs migrate to electricity=0 wear=hourRate', () => {
    const r = calculator.normalizeCostParams({ hourRate: 300, kgPrice: 20500 }, 'base');
    assert.equal(r.electricityCostPerHour, 0);
    assert.equal(r.machineWearCostPerHour, 300);
    assert.equal(r.hourRate, 300);
  });

  it('Costos generales components sum to productionCost', () => {
    const state = {
      costs: {
        electricityCostPerHour: 35,
        machineWearCostPerHour: 165,
        hourRate: 200,
        kgPrice: 20000,
        designCost: 5000,
        profitPercent: 100,
      },
      export: { taxMode: 'excluded', shippingCost: 0 },
      products: [{
        name: 'A',
        quantity: 2,
        grams: 100,
        printHours: 1,
        additionals: [{ price: 500, showOnInvoice: true }],
        salePriceTouched: true,
        salePriceManual: 10000,
      }],
    };
    const all = calculator.computeAll(state);
    const p = all.main.production;
    assert.equal(
      p.materialCost + p.electricityCost + p.machineWearCost + p.additionalsCost + p.designCost,
      p.productionCost
    );
  });

  it('IVA is not treated as profit for add and included modes', () => {
    const baseState = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      products: [
        {
          name: 'rotulo 20x10cm',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 15000,
          additionals: [],
        },
        {
          name: 'rotulo 8.5x5.5cm',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 2800,
          additionals: [],
        },
      ],
    };
    const add = calculator.computeAll({
      ...baseState,
      export: { taxMode: 'add', shippingCost: 0 },
      alexPercent: 30,
      luisPercent: 70,
    });
    assert.equal(add.main.grandTotal, 35934);
    assert.equal(add.main.businessRevenue, 31800);
    assert.equal(add.main.grossProfit, 31800);

    const included = calculator.computeAll({
      ...baseState,
      export: { taxMode: 'included', shippingCost: 0 },
      alexPercent: 30,
      luisPercent: 70,
    });
    assert.equal(included.main.grandTotal, 31800);
    assert.equal(included.main.businessRevenue, 28142);
    assert.equal(included.main.grossProfit, 28142);
  });

  it('printer cost migration is registered and additive', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../scripts/migrate-cost-quote-printer-costs.js'),
      'utf8'
    );
    assert.match(src, /electricity_cost_per_hour/);
    assert.match(src, /machine_wear_cost_per_hour/);
    assert.match(src, /machine_wear_cost_per_hour = unit_cost/);
    assert.doesNotMatch(src, /migrate-cost-quote\.js/);
    const tracker = fs.readFileSync(
      path.resolve(__dirname, '../scripts/migrationTracker.js'),
      'utf8'
    );
    assert.match(tracker, /migrateCostQuotePrinterCosts/);
    const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');
    assert.ok(MIGRATION_REGISTRY.some((e) => e.name === 'migrateCostQuotePrinterCosts'));
  });

  it('UI exposes Cambiar parámetros and Costos generales', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'),
      'utf8'
    );
    assert.match(src, /Cambiar parámetros/);
    assert.match(src, /Costos generales/);
    assert.match(src, /Desgaste de impresoras/);
    assert.match(src, /Resumen final/);
    assert.match(src, /resolveProductCostParams/);
    assert.match(src, /cq-catalog-printer-electricity/);
    assert.doesNotMatch(src, /Costo Unitario/);
  });

  it('PDF appends Material line from resolved params per product', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    assert.match(src, /Material: /);
    assert.match(src, /productDescriptionBullets/);
    assert.match(src, /resolveProductCostParams/);
    assert.match(src, /Dise\\u00f1o personalizado \\u2014/);
  });
});

// ───────────────────────────────────────────────────────
// Snapshot preservation / profit parity / legacy description
// ───────────────────────────────────────────────────────
describe('Historical snapshot preservation + profit + legacy description', () => {
  const adminSrc = () =>
    fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');

  it('syncCostSelections defaults to preserve for saved quotes and catalog for new', () => {
    const src = adminSrc();
    assert.match(src, /mode = currentSavedQuoteId \? 'preserve' : 'catalog'/);
    assert.match(src, /syncCostSelections\(state, \{ mode: 'preserve' \}\)/);
    assert.match(src, /function applyCatalogSnapshotIfSelectionChanged/);
    assert.match(src, /applyCatalogSnapshotIfSelectionChanged\(state\.costs, prevCosts, 'both'\)/);
    assert.match(
      src,
      /applyCatalogSnapshotIfSelectionChanged\(prod\.costOverrides, prevOv, 'both'\)/
    );
    // readStateFromDom must not blanket re-sync catalog after quoteEmail
    assert.match(
      src,
      /quoteEmail = resolveQuoteEmailSelection[\s\S]{0,280}applyCatalogSnapshotIfSelectionChanged\(state\.costs/
    );
  });

  it('deleted catalog items keep snapshot selector labels', () => {
    const src = adminSrc();
    assert.match(src, /guardado en esta cotización/);
    assert.ok(
      (src.match(/guardado en esta cotización/g) || []).length >= 4,
      'base + override printer/material ghost options'
    );
  });

  it('shipping is excluded from manufacturing profit (excluded mode)', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      export: { taxMode: 'excluded', shippingCost: 3000 },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 25000,
          additionals: [],
        },
        {
          name: 'B',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 5000,
          additionals: [],
        },
      ],
    };
    // Force production cost via calculator path: zero print/material → production = design 0
    // Manual BASE sale + additional surcharge (additionals always compose into client sale).
    state.costs.designCost = 0;
    // A: base 25000 + add 10000 = 35000; B: 5000 → products 40000; shipping 3000
    state.products[0].additionals = [{ price: 10000, showOnInvoice: true }];
    const all = calculator.computeAll(state);
    assert.equal(all.products[0].line.productPreDiscountTotal, 35000);
    assert.equal(all.main.grandTotal, 43000); // client includes shipping
    assert.equal(all.main.businessRevenue, 40000); // no shipping
    assert.equal(all.main.grossProfit, 30000); // 40000 - 10000 production
    assert.equal(all.main.alexShare, 9000);
    assert.equal(all.main.luisShare, 21000);
  });

  it('shipping + add IVA: client taxed on shipping, profit is tax-neutral products+design', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      export: { taxMode: 'add', shippingCost: 3000 },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 30000,
          additionals: [],
        },
      ],
    };
    const all = calculator.computeAll(state);
    assert.equal(all.main.enteredSubtotal, 33000);
    assert.equal(all.main.grandTotal, Math.round(33000 * 1.13));
    assert.equal(all.main.businessRevenue, 30000);
    assert.equal(all.main.grossProfit, 30000);
  });

  it('shipping + included IVA: profit does not treat shipping net as revenue', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      export: { taxMode: 'included', shippingCost: 3000 },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 30000,
          additionals: [],
        },
      ],
    };
    const all = calculator.computeAll(state);
    assert.equal(all.main.grandTotal, 33000);
    // Tax-neutral from products+design only (30000), not from 33000
    const expectedRevenue = calculator.computeTaxNeutralRevenue(30000, 0, 'included');
    assert.equal(all.main.businessRevenue, expectedRevenue);
    assert.equal(all.main.businessRevenue, calculator.extractIncludedIva(30000).net);
    assert.notEqual(
      all.main.businessRevenue,
      calculator.extractIncludedIva(33000).net,
      'must not strip IVA from shipping-inclusive base for profit'
    );
  });

  it('frontend/server profit parity helpers match for all tax modes with shipping', () => {
    const src = adminSrc();
    assert.match(
      src,
      /businessRevenue = applyTaxModeLocal\(\s*Math\.max\(0, Math\.round\(productsSubtotalAfterGlobal \+ designCost\)\),\s*taxMode\s*\)\.base/
    );
    assert.match(
      src,
      /taxableBase = Math\.max\(0, Math\.round\(productsSubtotalAfterGlobal \+ designCost \+ shipping\)\)/
    );
    assert.match(src, /function allocatePartnerProfit/);

    for (const mode of ['excluded', 'add', 'included']) {
      const state = {
        costs: {
          electricityCostPerHour: 0,
          machineWearCostPerHour: 0,
          hourRate: 0,
          kgPrice: 0,
          designCost: 5000,
          profitPercent: 0,
        },
        alexPercent: 30,
        luisPercent: 70,
        export: { taxMode: mode, shippingCost: 3000 },
        products: [
          {
            name: 'A',
            quantity: 1,
            grams: 0,
            printHours: 0,
            salePriceTouched: true,
            salePriceManual: 25000,
            additionals: [{ price: 10000, showOnInvoice: true }],
          },
        ],
      };
      const all = calculator.computeAll(state);
      // Manual base 25000 + additional 10000 = 35000 product sale before design/shipping
      assert.equal(all.products[0].line.productPreDiscountTotal, 35000, mode + ' pre-discount');
      const expectedRev = calculator.computeTaxNeutralRevenue(35000, 5000, mode);
      assert.equal(all.main.businessRevenue, expectedRev, mode + ' businessRevenue');
      // sharedProfit excludes design assignment; estimatedTotalGain = shared + design→Alex
      assert.equal(all.main.sharedProfit, expectedRev - all.main.productionCost, mode + ' sharedProfit');
      assert.equal(
        all.main.estimatedTotalGain,
        all.main.alexShare + all.main.luisShare,
        mode + ' estimatedTotalGain'
      );
      assert.equal(all.main.designAssignedToAlex, 5000, mode + ' design→Alex');
      // Client total still includes shipping
      assert.ok(all.main.grandTotal >= 35000 + 5000 + 3000 || mode === 'included');
    }
  });

  it('resolveLegacyProductDescription: missing first inherits export.description', () => {
    assert.equal(
      calculator.resolveLegacyProductDescription({
        descriptionPropertyPresent: false,
        descriptionValue: undefined,
        legacyExportDescription: 'Texto histórico',
        isFirstProduct: true,
      }),
      'Texto histórico'
    );
  });

  it('resolveLegacyProductDescription: explicit empty stays blank', () => {
    assert.equal(
      calculator.resolveLegacyProductDescription({
        descriptionPropertyPresent: true,
        descriptionValue: '',
        legacyExportDescription: 'Legacy text',
        isFirstProduct: true,
      }),
      ''
    );
  });

  it('resolveLegacyProductDescription: second product does not inherit', () => {
    assert.equal(
      calculator.resolveLegacyProductDescription({
        descriptionPropertyPresent: false,
        descriptionValue: undefined,
        legacyExportDescription: 'Legacy',
        isFirstProduct: false,
      }),
      ''
    );
  });

  it('frontend migrateState captures description ownership before defaults', () => {
    const src = adminSrc();
    assert.match(src, /Object\.prototype\.hasOwnProperty\.call\(p, 'description'\)/);
    assert.match(src, /descriptionPresentFlags/);
    assert.match(src, /resolveLegacyProductDescription/);
    // Must not gate legacy copy on === undefined after migrateProduct defaulted to ''
    assert.doesNotMatch(
      src,
      /first\.description === undefined \|\|\s*first\.description === null/
    );
  });

  it('server calculator still preserves 31800 IVA + design-once regressions', () => {
    const productionRegression = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      products: [
        {
          name: 'rotulo 20x10cm',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 15000,
          additionals: [],
        },
        {
          name: 'rotulo 8.5x5.5cm',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 2800,
          additionals: [],
        },
      ],
    };
    assert.equal(
      calculator.computeQuoteTotal({
        ...productionRegression,
        export: { taxMode: 'included', shippingCost: 0 },
      }),
      31800
    );
    assert.equal(
      calculator.computeQuoteTotal({
        ...productionRegression,
        export: { taxMode: 'add', shippingCost: 0 },
      }),
      35934
    );
    assert.equal(
      calculator.computeQuoteTotal({
        ...productionRegression,
        export: { taxMode: 'excluded', shippingCost: 0 },
      }),
      31800
    );

    const designOnce = calculator.computeAll({
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 5000,
        profitPercent: 0,
      },
      export: { taxMode: 'excluded', shippingCost: 0 },
      products: [
        {
          name: 'A',
          quantity: 20,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 1000,
          additionals: [],
        },
      ],
    });
    assert.equal(designOnce.main.designCost, 5000);
  });
});

describe('Sale price input mode + clean default products', () => {
  const adminSrc = () =>
    fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');

  it('DEFAULT_PRODUCT is clean (no Copa Mundial demo values)', () => {
    const src = adminSrc();
    assert.match(src, /name:\s*''/);
    assert.match(src, /quantity:\s*1/);
    assert.match(src, /grams:\s*''/);
    assert.match(src, /printHours:\s*''/);
    assert.match(src, /salePriceInputMode:\s*'unit'/);
    assert.match(src, /salePriceTotalManual:\s*0/);
    assert.match(src, /DEFAULT_SERVICE_DESCRIPTION/);
    assert.doesNotMatch(src, /name:\s*'Copa Mundial'/);
    assert.doesNotMatch(src, /quantity:\s*2,\s*\n\s*grams:\s*385/);
    assert.match(src, /keepProductName:\s*false/);
    assert.match(src, /state\.products\.push\(defaultProduct\(\)\)/);
  });

  it('unit manual price yields exact product total', () => {
    const line = calculator.computeLine(
      {
        costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
        alexPercent: 30,
        luisPercent: 70,
      },
      {
        quantity: 2,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'unit',
        salePriceManual: 22500,
        additionals: [],
      },
      2,
      0
    );
    assert.equal(line.saleUnit, 22500);
    assert.equal(line.clientTotal, 45000);
  });

  it('total manual price yields exact total and derived unit', () => {
    const line = calculator.computeLine(
      {
        costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
        alexPercent: 30,
        luisPercent: 70,
      },
      {
        quantity: 2,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 45000,
        salePriceManual: 0,
        additionals: [],
      },
      2,
      0
    );
    assert.equal(line.clientTotal, 45000);
    assert.equal(line.saleUnit, 22500);
  });

  it('non-divisible total preserves exact 10000 (never 9999)', () => {
    const sale = calculator.resolveProductSalePrice(
      {
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 10000,
      },
      3,
      0
    );
    assert.equal(sale.productTotal, 10000);
    assert.ok(Math.abs(sale.unitPrice - 10000 / 3) < 1e-9);
    const line = calculator.computeLine(
      {
        costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
        alexPercent: 30,
        luisPercent: 70,
      },
      {
        quantity: 3,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 10000,
        additionals: [],
      },
      3,
      0
    );
    assert.equal(line.clientTotal, 10000);
    assert.notEqual(line.clientTotal, 9999);
    assert.notEqual(line.clientTotal, 10001);
  });

  it('total mode + 10% discount applies to exact source total', () => {
    const line = calculator.computeLine(
      {
        costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
        alexPercent: 30,
        luisPercent: 70,
      },
      {
        quantity: 3,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 10000,
        saleDiscountEnabled: true,
        saleDiscountPercent: 10,
        additionals: [],
      },
      3,
      10
    );
    assert.equal(line.clientTotal, 9000);
    assert.equal(line.baseSaleTotal, 10000);
  });

  it('historical unit mode without new fields stays unit semantics', () => {
    const sale = calculator.resolveProductSalePrice(
      {
        salePriceTouched: true,
        salePriceManual: 2800,
        // no salePriceInputMode / salePriceTotalManual
      },
      6,
      0
    );
    assert.equal(sale.inputMode, 'unit');
    assert.equal(sale.unitPrice, 2800);
    assert.equal(sale.productTotal, 16800);
  });

  it('total-mode IVA regression still yields 31800 base', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'total',
          salePriceTotalManual: 15000,
          additionals: [],
        },
        {
          name: 'B',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'total',
          salePriceTotalManual: 16800,
          additionals: [],
        },
      ],
    };
    assert.equal(
      calculator.computeQuoteTotal({ ...state, export: { taxMode: 'included', shippingCost: 0 } }),
      31800
    );
    assert.equal(
      calculator.computeQuoteTotal({ ...state, export: { taxMode: 'add', shippingCost: 0 } }),
      35934
    );
    assert.equal(
      calculator.computeQuoteTotal({ ...state, export: { taxMode: 'excluded', shippingCost: 0 } }),
      31800
    );
  });

  it('switching conceptual mode does not change economics for unit-priced product', () => {
    const base = {
      costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
      alexPercent: 30,
      luisPercent: 70,
    };
    const unitLine = calculator.computeLine(
      base,
      {
        quantity: 2,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'unit',
        salePriceManual: 22500,
        salePriceTotalManual: 45000,
        additionals: [],
      },
      2,
      0
    );
    const asTotal = calculator.computeLine(
      base,
      {
        quantity: 2,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceManual: 22500,
        salePriceTotalManual: 45000,
        additionals: [],
      },
      2,
      0
    );
    assert.equal(unitLine.clientTotal, 45000);
    assert.equal(asTotal.clientTotal, 45000);
  });

  it('manual sale mode change does not alter production costs', () => {
    const costs = {
      electricityCostPerHour: 35,
      machineWearCostPerHour: 165,
      hourRate: 200,
      kgPrice: 20000,
      designCost: 5000,
      profitPercent: 100,
    };
    const shared = {
      quantity: 2,
      grams: 100,
      printHours: 1,
      additionals: [{ price: 500, showOnInvoice: true }],
      salePriceTouched: true,
    };
    const unit = calculator.computeLine(
      { costs, alexPercent: 30, luisPercent: 70 },
      { ...shared, salePriceInputMode: 'unit', salePriceManual: 20000 },
      2,
      0
    );
    const total = calculator.computeLine(
      { costs, alexPercent: 30, luisPercent: 70 },
      { ...shared, salePriceInputMode: 'total', salePriceTotalManual: 40000 },
      2,
      0
    );
    assert.equal(unit.productionCost, total.productionCost);
    assert.equal(unit.materialCostTotal, total.materialCostTotal);
    assert.equal(unit.electricityCostTotal, total.electricityCostTotal);
    assert.equal(unit.machineWearCostTotal, total.machineWearCostTotal);
    assert.equal(unit.additionalsCostTotal, total.additionalsCostTotal);
    assert.equal(unit.designCost, total.designCost);
  });

  it('frontend wires salePriceInputMode + blank grams/hours + Nueva cotización reset', () => {
    const src = adminSrc();
    assert.match(src, /function resolveProductSalePrice/);
    assert.match(src, /cq-salePriceTotal-/);
    assert.match(src, /function renderSalePriceFields/);
    assert.match(src, /isBlankNumericField/);
    assert.match(src, /resetQuoteProductForNew\(\{ keepProductName: false, resetExport: true \}\)/);
    assert.doesNotMatch(src, /keepProductName:\s*true/);
  });

  it('PDF resolves sale totals via canonical helper / clientTotal', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    assert.match(src, /function resolveProductSalePrice/);
    assert.match(src, /exactClientTotal|m\.clientTotal/);
  });
});

describe('Additionals pricingMode + discounts + Alex design profit + Resumen', () => {
  const adminSrc = () =>
    fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');

  it('normalizeAdditional defaults missing pricingMode to per_product', () => {
    const a = calculator.normalizeAdditional({ price: 500, description: 'Pintura' });
    assert.equal(a.pricingMode, 'per_product');
    const legacy = calculator.normalizeAdditional(500);
    assert.equal(legacy.pricingMode, 'per_product');
  });

  it('per_product additional multiplies by qty; total does not', () => {
    const per = calculator.resolveProductAdditionals(
      { additionals: [{ price: 500, pricingMode: 'per_product' }] },
      4
    );
    assert.equal(per.totalCost, 2000);
    const tot = calculator.resolveProductAdditionals(
      { additionals: [{ price: 500, pricingMode: 'total' }] },
      4
    );
    assert.equal(tot.totalCost, 500);
  });

  it('mixed additionals sum correctly into production', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      export: { taxMode: 'excluded', shippingCost: 0 },
      products: [
        {
          name: 'A',
          quantity: 4,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 0,
          additionals: [
            { price: 500, pricingMode: 'per_product', showOnInvoice: true },
            { price: 500, pricingMode: 'total', showOnInvoice: true },
          ],
        },
      ],
    };
    const all = calculator.computeAll(state);
    assert.equal(all.main.production.additionalsCost, 2500);
    assert.equal(all.products[0].line.suggestedTotal, 2500);
  });

  it('hidden total additional still counts in production and suggested, not PDF rows', () => {
    const product = {
      quantity: 2,
      grams: 0,
      printHours: 0,
      additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: false, description: 'Hidden' }],
    };
    const line = calculator.computeLine(
      {
        costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
        alexPercent: 30,
        luisPercent: 70,
      },
      product,
      2,
      0
    );
    assert.equal(line.additionalsCostTotal, 1000);
    assert.equal(line.suggestedTotal, 1000);
    const pdfSrc = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    assert.match(pdfSrc, /pricingMode === 'total'/);
    assert.match(pdfSrc, /if \(!extra\.showOnInvoice\) return/);
  });

  it('product + global discounts apply in canonical order (8100)', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      globalDiscount: { enabled: true, percent: 10 },
      export: { taxMode: 'excluded', shippingCost: 0 },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 10000,
          saleDiscountEnabled: true,
          saleDiscountPercent: 10,
          additionals: [],
        },
      ],
    };
    const all = calculator.computeAll(state);
    assert.equal(all.products[0].line.clientTotal, 9000);
    assert.equal(all.main.productsSubtotalBeforeGlobal, 9000);
    assert.equal(all.main.globalDiscountAmount, 900);
    assert.equal(all.main.productsSubtotalAfterGlobal, 8100);
    assert.equal(all.main.grandTotal, 8100);
  });

  it('global discount does not reduce design or shipping', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 1000,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      globalDiscount: { enabled: true, percent: 10 },
      export: { taxMode: 'add', shippingCost: 500 },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 10000,
          saleDiscountEnabled: true,
          saleDiscountPercent: 10,
          additionals: [],
        },
      ],
    };
    const all = calculator.computeAll(state);
    assert.equal(all.main.productsSubtotalAfterGlobal, 8100);
    assert.equal(all.main.globalDiscountAmount, 900);
    assert.equal(all.main.displaySubtotal, 10500); // 9000 + 1000 + 500
    assert.equal(all.main.enteredSubtotal, 9600); // 8100 + 1000 + 500
    assert.equal(all.main.ivaAmount, 1248);
    assert.equal(all.main.grandTotal, 10848);
  });

  it('exact total-mode sale + product discount stays 9000', () => {
    const line = calculator.computeLine(
      {
        costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
        alexPercent: 30,
        luisPercent: 70,
      },
      {
        quantity: 3,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 10000,
        additionals: [],
      },
      3,
      10
    );
    assert.equal(line.clientTotal, 9000);
  });

  it('all design is assigned to Alex; estimatedTotalGain = alex + luis', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 3000,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      export: { taxMode: 'excluded', shippingCost: 0 },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 23000, // revenue 23000; production = design 3000 → shared 20000? 
          // businessRevenue = 23000+0 wait design is in revenue too via computeTaxNeutralRevenue(products, design)
          // products after global = 23000, design 3000, businessRevenue = 26000
          // productionCost = 3000, sharedProfit = 23000
          // Wait: businessRevenue = productSale + design = 23000 + 3000 = 26000
          // production includes design 3000, shared = 23000
          // That doesn't match the example. Example:
          // sharedProfit = 10000, design = 3000 → alex 6000, luis 7000, total 13000
          additionals: [],
        },
      ],
    };
    // Force sharedProfit = 10000 via: businessRevenue - production = 10000
    // production = design 3000 + 0 = 3000 → need businessRevenue = 13000
    // computeTaxNeutralRevenue(productSale, design) = productSale + design (excluded)
    // productSale + 3000 = 13000 → productSale = 10000
    state.products[0].salePriceManual = 10000;
    const all = calculator.computeAll(state);
    // businessRevenue = 10000 + 3000 = 13000; production = 3000; shared = 10000
    assert.equal(all.main.sharedProfit, 10000);
    assert.equal(all.main.alexSharedProfit, 3000);
    assert.equal(all.main.designAssignedToAlex, 3000);
    assert.equal(all.main.alexShare, 6000);
    assert.equal(all.main.luisShare, 7000);
    assert.equal(all.main.estimatedTotalGain, 13000);
    assert.equal(all.main.estimatedTotalGain, all.main.alexShare + all.main.luisShare);
  });

  it('multiple product designs sum into Alex assignment', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 3000,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      export: { taxMode: 'excluded', shippingCost: 0 },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 5000,
          costOverrides: {
            enabled: true,
            designCost: 3000,
            profitPercent: 0,
            electricityCostPerHour: 0,
            machineWearCostPerHour: 0,
            hourRate: 0,
            kgPrice: 0,
          },
          additionals: [],
        },
        {
          name: 'B',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 5000,
          costOverrides: {
            enabled: true,
            designCost: 2000,
            profitPercent: 0,
            electricityCostPerHour: 0,
            machineWearCostPerHour: 0,
            hourRate: 0,
            kgPrice: 0,
          },
          additionals: [],
        },
      ],
    };
    const all = calculator.computeAll(state);
    assert.equal(all.main.designCost, 5000);
    assert.equal(all.main.designAssignedToAlex, 5000);
  });

  it('Resumen final is client-only; Ganancias shows production + design note', () => {
    const src = adminSrc();
    assert.match(src, /TOTAL CLIENTE/);
    assert.match(src, /Ganancia estimada total/);
    assert.match(src, /de diseño/);
    assert.match(src, /designAssignedToAlex/);
    assert.match(src, /function allocatePartnerProfit/);
    assert.match(src, /pricingMode/);
    assert.match(src, /Por producto/);
    // Resumen must not embed internal profit rows inside the final card body
    assert.doesNotMatch(
      src,
      /cq-stat-card--final[\s\S]{0,800}Costo de producción[\s\S]{0,400}Ganancia estimada/
    );
  });

  it('product cards have card separation styles', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../public/css/admin-cost-quote.css'),
      'utf8'
    );
    assert.match(css, /\.cq-product-item\s*\{[^}]*border-radius/s);
    assert.match(css, /\.cq-product-item\s*\{[^}]*padding:\s*16px/s);
  });
});

describe('Manual sale + additionals composition', () => {
  const baseState = {
    costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
    alexPercent: 30,
    luisPercent: 70,
    wholesaleMode: false,
    export: { taxMode: 'excluded', shippingCost: 0 },
  };

  it('manual unit + per_product: 6×1000 + 1000×6 = 12000', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 6,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'unit',
        salePriceManual: 1000,
        additionals: [{ price: 1000, pricingMode: 'per_product', showOnInvoice: true }],
      },
      6,
      0
    );
    assert.equal(line.baseProductSaleTotal, 6000);
    assert.equal(line.additionalsTotal, 6000);
    assert.equal(line.productPreDiscountTotal, 12000);
    assert.equal(line.clientTotal, 12000);
  });

  it('manual unit + total additional: 6×1000 + 1000 = 7000', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 6,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'unit',
        salePriceManual: 1000,
        additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: true }],
      },
      6,
      0
    );
    assert.equal(line.baseProductSaleTotal, 6000);
    assert.equal(line.additionalsTotal, 1000);
    assert.equal(line.productPreDiscountTotal, 7000);
    assert.equal(line.clientTotal, 7000);
  });

  it('manual exact total + per_product / total additionals', () => {
    const per = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 6,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 6000,
        additionals: [{ price: 1000, pricingMode: 'per_product', showOnInvoice: true }],
      },
      6,
      0
    );
    assert.equal(per.baseProductSaleTotal, 6000);
    assert.equal(per.productPreDiscountTotal, 12000);

    const once = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 6,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 6000,
        additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: true }],
      },
      6,
      0
    );
    assert.equal(once.productPreDiscountTotal, 7000);
  });

  it('mixed additionals: 6000 + 1800 + 1000 = 8800', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 6,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'unit',
        salePriceManual: 1000,
        additionals: [
          { price: 300, pricingMode: 'per_product', showOnInvoice: true },
          { price: 1000, pricingMode: 'total', showOnInvoice: true },
        ],
      },
      6,
      0
    );
    assert.equal(line.additionalsTotal, 2800);
    assert.equal(line.productPreDiscountTotal, 8800);
  });

  it('automatic suggested includes additionals exactly once (no double charge)', () => {
    const line = calculator.computeLine(
      {
        ...baseState,
        costs: { hourRate: 100, kgPrice: 0, profitPercent: 0, designCost: 0 },
      },
      {
        name: 'A',
        quantity: 2,
        grams: 0,
        printHours: 1,
        salePriceTouched: false,
        additionals: [
          { price: 500, pricingMode: 'per_product', showOnInvoice: true },
          { price: 1000, pricingMode: 'total', showOnInvoice: true },
        ],
      },
      2,
      0
    );
    // manufacturing = 100×1 = 100/unit → 200; adds = 500×2 + 1000 = 2000; total 2200
    assert.equal(line.manufacturingSuggestedTotal, 200);
    assert.equal(line.additionalsTotal, 2000);
    assert.equal(line.suggestedTotal, 2200);
    assert.equal(line.productPreDiscountTotal, 2200);
    assert.equal(line.clientTotal, 2200);
  });

  it('product discount 50% applies once to base+additionals (12000 → 6000)', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 6,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'unit',
        salePriceManual: 1000,
        saleDiscountEnabled: true,
        saleDiscountPercent: 50,
        additionals: [{ price: 1000, pricingMode: 'per_product', showOnInvoice: true }],
      },
      6,
      50
    );
    assert.equal(line.productPreDiscountTotal, 12000);
    assert.equal(line.productDiscountAmount, 6000);
    assert.equal(line.productPostDiscountTotal, 6000);
    assert.equal(line.clientTotal, 6000);
  });

  it('non-divisible base total + total additional stays exact after discount', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 3,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 10000,
        saleDiscountEnabled: true,
        saleDiscountPercent: 10,
        additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: true }],
      },
      3,
      10
    );
    assert.equal(line.productPreDiscountTotal, 11000);
    assert.equal(line.clientTotal, 9900);
  });

  it('hidden total additional still composes into sale; PDF row contract uses showOnInvoice', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 6,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'unit',
        salePriceManual: 1000,
        additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: false }],
      },
      6,
      0
    );
    assert.equal(line.productPreDiscountTotal, 7000);
    assert.equal(line.productionCost, 1000);
    assert.equal(line.additionals.visibleTotal, 0);
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    assert.match(src, /composeProductSaleWithAdditionals/);
    assert.match(src, /if \(!extra\.showOnInvoice\) return/);
  });

  it('removing additional returns to base total without mutating stored manual unit', () => {
    const withAdd = {
      name: 'A',
      quantity: 6,
      grams: 0,
      printHours: 0,
      salePriceTouched: true,
      salePriceInputMode: 'unit',
      salePriceManual: 1000,
      additionals: [{ price: 1000, pricingMode: 'per_product', showOnInvoice: true }],
    };
    assert.equal(calculator.computeLine(baseState, withAdd, 6, 0).clientTotal, 12000);
    const cleared = { ...withAdd, additionals: [] };
    const line = calculator.computeLine(baseState, cleared, 6, 0);
    assert.equal(cleared.salePriceManual, 1000);
    assert.equal(line.baseProductSaleTotal, 6000);
    assert.equal(line.clientTotal, 6000);
  });

  it('Frecuente catalog selector still fills description/price (source)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'),
      'utf8'
    );
    assert.match(src, /Frecuente/);
    assert.match(src, /data-cq-additional-pick/);
    assert.match(src, /cq-additional-.*-desc/);
    assert.match(src, /cq-additional-.*-price/);
    assert.match(src, /composeProductSaleWithAdditionals/);
  });

  it('Admin/server/PDF parity for manual+additional compositions', () => {
    const vm = require('node:vm');
    const pdfSrc = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    const sandbox = { console };
    vm.runInNewContext(pdfSrc, sandbox);
    const pdf = sandbox.AdminCostQuotePdf;
    const cases = [
      {
        name: 'unit+per_product',
        products: [
          {
            name: 'A',
            quantity: 6,
            grams: 0,
            printHours: 0,
            salePriceTouched: true,
            salePriceInputMode: 'unit',
            salePriceManual: 1000,
            additionals: [{ price: 1000, pricingMode: 'per_product', showOnInvoice: true }],
          },
        ],
        expected: 12000,
      },
      {
        name: 'unit+total',
        products: [
          {
            name: 'A',
            quantity: 6,
            grams: 0,
            printHours: 0,
            salePriceTouched: true,
            salePriceInputMode: 'unit',
            salePriceManual: 1000,
            additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: true }],
          },
        ],
        expected: 7000,
      },
      {
        name: 'wholesale unit+total',
        wholesaleMode: true,
        products: [
          {
            name: 'A',
            quantity: 20,
            grams: 0,
            printHours: 0,
            salePriceTouched: true,
            salePriceInputMode: 'unit',
            salePriceManual: 1000,
            additionals: [{ price: 5000, pricingMode: 'total', showOnInvoice: true }],
          },
        ],
        // gross 20000+5000=25000; discounts min range from wholesaleBase-like defaults may apply
      },
    ];

    cases.forEach((c) => {
      const state = {
        ...baseState,
        wholesaleMode: !!c.wholesaleMode,
        discounts: c.wholesaleMode
          ? { range10_50: 10, range50_100: 10, range100plus: 15 }
          : {},
        discountRanges: c.wholesaleMode
          ? {
              range10_50: { min: 1, max: 50 },
              range50_100: { min: 50, max: 100 },
              range100plus: { min: 100, max: null },
            }
          : {},
        products: c.products,
      };
      const result = calculator.computeAll(state);
      const server = calculator.computeQuoteTotal(state);
      const grand = pdf.computeGrandTotal({
        state,
        result,
        wholesaleMode: !!c.wholesaleMode,
      });
      assert.equal(result.main.grandTotal, server, c.name + ' admin/server');
      assert.equal(grand, server, c.name + ' PDF/server');
      if (c.expected != null) assert.equal(server, c.expected, c.name + ' total');
    });
  });
});

describe('Product discount panel: unit discount + total discount', () => {
  const baseState = {
    costs: { hourRate: 0, kgPrice: 0, profitPercent: 0, designCost: 0 },
    alexPercent: 30,
    luisPercent: 70,
    wholesaleMode: false,
    export: { taxMode: 'excluded', shippingCost: 0 },
  };

  it('unit pricing qty 6 @ 2800 with 50% → unit disc 1400, total disc 8400', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 6,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'unit',
        salePriceManual: 2800,
        saleDiscountEnabled: true,
        saleDiscountPercent: 50,
        additionals: [],
      },
      6,
      50
    );
    assert.equal(line.baseSale, 2800);
    assert.equal(Math.round(line.baseSale * 0.5), 1400);
    assert.equal(line.productDiscountAmount, 8400);
    assert.equal(line.clientTotal, 8400);
  });

  it('total pricing qty 6 @ 16800 with 50% → same canonical total discount 8400', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 6,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 16800,
        saleDiscountEnabled: true,
        saleDiscountPercent: 50,
        additionals: [],
      },
      6,
      50
    );
    assert.equal(line.productPreDiscountTotal, 16800);
    assert.equal(line.productDiscountAmount, 8400);
    assert.equal(Math.round(line.baseSale * 0.5), 1400);
    assert.equal(line.clientTotal, 8400);
  });

  it('non-even total: productDiscountAmount is canonical (not unit×qty rebuild)', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 3,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'total',
        salePriceTotalManual: 10000,
        saleDiscountEnabled: true,
        saleDiscountPercent: 10,
        additionals: [],
      },
      3,
      10
    );
    assert.equal(line.productDiscountAmount, 1000);
    assert.equal(line.clientTotal, 9000);
    // Unit display follows baseSale rounding; must not force 1000 via unit×qty identity alone
    const unitDiscDisplay = Math.round(line.baseSale * 0.1);
    assert.ok(Number.isFinite(unitDiscDisplay));
    assert.notEqual(unitDiscDisplay * 3, line.productDiscountAmount);
  });

  it('quantity 1: unit and total discount match', () => {
    const line = calculator.computeLine(
      baseState,
      {
        name: 'A',
        quantity: 1,
        grams: 0,
        printHours: 0,
        salePriceTouched: true,
        salePriceInputMode: 'unit',
        salePriceManual: 2800,
        saleDiscountEnabled: true,
        saleDiscountPercent: 50,
        additionals: [],
      },
      1,
      50
    );
    assert.equal(Math.round(line.baseSale * 0.5), 1400);
    assert.equal(line.productDiscountAmount, 1400);
  });

  it('UI discount block shows Monto descuento total, not Monto con descuento / uds', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'),
      'utf8'
    );
    const fn = src.slice(
      src.indexOf('function renderSaleDiscountBlock'),
      src.indexOf('function renderGlobalDiscountBlock')
    );
    assert.match(fn, /Monto descuento \/ uds/);
    assert.match(fn, /Monto descuento total/);
    assert.match(fn, /productDiscountAmount/);
    assert.doesNotMatch(fn, /Monto con descuento \/ uds/);
  });
});

describe('Wholesale + total additionals exact pricing', () => {
  function loadPdf() {
    const vm = require('node:vm');
    const pdfSrc = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    const sandbox = { console };
    vm.runInNewContext(pdfSrc, sandbox);
    return sandbox.AdminCostQuotePdf;
  }

  function wholesaleBase(overrides) {
    return {
      wholesaleMode: true,
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      discounts: { range10_50: 10, range50_100: 10, range100plus: 15 },
      discountRanges: {
        range10_50: { min: 1, max: 50 },
        range50_100: { min: 50, max: 100 },
        range100plus: { min: 100, max: null },
      },
      alexPercent: 30,
      luisPercent: 70,
      export: { taxMode: 'excluded', shippingCost: 0 },
      ...overrides,
    };
  }

  it('wholesale total additional is not multiplied by qty', () => {
    const state = wholesaleBase({
      discounts: { range10_50: 0, range50_100: 0, range100plus: 0 },
      products: [
        {
          name: 'A',
          quantity: 20,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [{ price: 5000, pricingMode: 'total', showOnInvoice: true }],
        },
      ],
    });
    const wp = calculator.resolveWholesaleProductPricing(state, state.products[0], 20, 0);
    assert.equal(wp.grossTotal, 5000);
    assert.equal(wp.netTotal, 5000);
    assert.equal(calculator.computeQuoteTotal(state), 5000);
    assert.notEqual(calculator.computeQuoteTotal(state), 100000);
  });

  it('wholesale total additional with 10% discount → 4500', () => {
    const state = wholesaleBase({
      products: [
        {
          name: 'A',
          quantity: 20,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [{ price: 5000, pricingMode: 'total', showOnInvoice: true }],
        },
      ],
    });
    const wp = calculator.resolveWholesaleProductPricing(state, state.products[0], 20, 10);
    assert.equal(wp.grossTotal, 5000);
    assert.equal(wp.netTotal, 4500);
    assert.equal(calculator.computeQuoteTotal(state), 4500);
  });

  it('wholesale per_product additional: 500×20 → 10000, 10% → 9000', () => {
    const state = wholesaleBase({
      products: [
        {
          name: 'A',
          quantity: 20,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [{ price: 500, pricingMode: 'per_product', showOnInvoice: true }],
        },
      ],
    });
    const wp = calculator.resolveWholesaleProductPricing(state, state.products[0], 20, 10);
    assert.equal(wp.grossTotal, 10000);
    assert.equal(wp.netTotal, 9000);
  });

  it('wholesale mixed additionals: 2000+500 → 2500, 10% → 2250', () => {
    const state = wholesaleBase({
      products: [
        {
          name: 'A',
          quantity: 4,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [
            { price: 500, pricingMode: 'per_product', showOnInvoice: true },
            { price: 500, pricingMode: 'total', showOnInvoice: true },
          ],
        },
      ],
    });
    const wp = calculator.resolveWholesaleProductPricing(state, state.products[0], 4, 10);
    assert.equal(wp.adds.totalCost, 2500);
    assert.equal(wp.grossTotal, 2500);
    assert.equal(wp.netTotal, 2250);
  });

  it('wholesale non-divisible exact total stays 9000 after 10%', () => {
    const state = wholesaleBase({
      products: [
        {
          name: 'A',
          quantity: 3,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'total',
          salePriceTotalManual: 10000,
          additionals: [],
        },
      ],
    });
    const wp = calculator.resolveWholesaleProductPricing(state, state.products[0], 3, 10);
    assert.equal(wp.netTotal, 9000);
    assert.equal(calculator.computeQuoteTotal(state), 9000);
  });

  it('PDF wholesale rows: total additional qty=1; per_product qty=product qty', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    assert.match(src, /if \(wholesaleMode\)/);
    assert.match(src, /resolveProductAdditionals\(p, qty\)/);
    assert.match(src, /pricingMode === 'total'/);
    assert.match(src, /addQty = isTotalMode \? 1 : qty/);
  });

  it('server/PDF wholesale parity for total/per_product/mixed/hidden/manual', () => {
    const pdf = loadPdf();
    const cases = [
      {
        name: 'total only',
        products: [
          {
            name: 'A',
            quantity: 20,
            grams: 0,
            printHours: 0,
            salePriceTouched: false,
            additionals: [{ price: 5000, pricingMode: 'total', showOnInvoice: true }],
          },
        ],
      },
      {
        name: 'per_product only',
        products: [
          {
            name: 'A',
            quantity: 20,
            grams: 0,
            printHours: 0,
            salePriceTouched: false,
            additionals: [{ price: 500, pricingMode: 'per_product', showOnInvoice: true }],
          },
        ],
      },
      {
        name: 'mixed',
        products: [
          {
            name: 'A',
            quantity: 4,
            grams: 0,
            printHours: 0,
            salePriceTouched: false,
            additionals: [
              { price: 500, pricingMode: 'per_product', showOnInvoice: true },
              { price: 500, pricingMode: 'total', showOnInvoice: true },
            ],
          },
        ],
      },
      {
        name: 'hidden total',
        products: [
          {
            name: 'A',
            quantity: 20,
            grams: 0,
            printHours: 0,
            salePriceTouched: false,
            additionals: [{ price: 5000, pricingMode: 'total', showOnInvoice: false }],
          },
        ],
      },
      {
        name: 'manual unit',
        products: [
          {
            name: 'A',
            quantity: 20,
            grams: 0,
            printHours: 0,
            salePriceTouched: true,
            salePriceInputMode: 'unit',
            salePriceManual: 1000,
            additionals: [{ price: 5000, pricingMode: 'total', showOnInvoice: true }],
          },
        ],
      },
      {
        name: 'manual total',
        products: [
          {
            name: 'A',
            quantity: 3,
            grams: 0,
            printHours: 0,
            salePriceTouched: true,
            salePriceInputMode: 'total',
            salePriceTotalManual: 10000,
            additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: true }],
          },
        ],
      },
    ];

    cases.forEach((c) => {
      const state = wholesaleBase({ products: c.products });
      // Manual total case: salePriceTotalManual already includes intent; additional is separate
      // in production but manual sale is authoritative for client price.
      const result = calculator.computeAll(state);
      const server = calculator.computeQuoteTotal(state);
      const grand = pdf.computeGrandTotal({ state, result, wholesaleMode: true });
      assert.equal(grand, server, 'wholesale PDF/server parity: ' + c.name);
      assert.equal(result.main.grandTotal, server, 'wholesale admin/server parity: ' + c.name);
    });
  });
});

describe('Wholesale quote-level tier (multi-product)', () => {
  function loadPdf() {
    const vm = require('node:vm');
    const pdfSrc = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    const sandbox = { console };
    vm.runInNewContext(pdfSrc, sandbox);
    return sandbox.AdminCostQuotePdf;
  }

  /** 10+ units → 5%; per-product qty 6 alone does NOT qualify. */
  function multiTierBase(overrides) {
    return {
      wholesaleMode: true,
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      discounts: { range10_50: 5, range50_100: 10, range100plus: 15 },
      discountRanges: {
        range10_50: { min: 10, max: 50 },
        range50_100: { min: 50, max: 100 },
        range100plus: { min: 100, max: null },
      },
      alexPercent: 30,
      luisPercent: 70,
      export: { taxMode: 'excluded', shippingCost: 0 },
      ...overrides,
    };
  }

  function assertAdminServerPdfParity(state, label) {
    const pdf = loadPdf();
    const result = calculator.computeAll(state);
    const server = calculator.computeQuoteTotal(state);
    const grand = pdf.computeGrandTotal({ state, result, wholesaleMode: true });
    assert.equal(result.main.grandTotal, server, 'admin/server: ' + label);
    assert.equal(grand, server, 'PDF/server: ' + label);
    return { result, server, grand };
  }

  it('two products 6+6 jointly qualify for 5% (not 0% each)', () => {
    const state = multiTierBase({
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          additionals: [],
        },
        {
          name: 'B',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          additionals: [],
        },
      ],
    });
    assert.equal(calculator.getTierDiscountPercent(state, 6, true), 0);
    assert.equal(calculator.getTierDiscountPercent(state, 12, true), 5);
    const result = calculator.computeAll(state);
    assert.equal(result.main.quantity, 12);
    // Each product net: 6000 * 0.95 = 5700; grand 11400
    assert.equal(result.products[0].line.clientTotal, 5700);
    assert.equal(result.products[1].line.clientTotal, 5700);
    assert.equal(calculator.computeQuoteTotal(state), 11400);
    assert.notEqual(calculator.computeQuoteTotal(state), 12000);
    assertAdminServerPdfParity(state, '6+6 joint tier');
  });

  it('different qtys 3+8 (total 11) both get 5%', () => {
    const state = multiTierBase({
      products: [
        {
          name: 'A',
          quantity: 3,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          additionals: [],
        },
        {
          name: 'B',
          quantity: 8,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          additionals: [],
        },
      ],
    });
    assert.equal(calculator.getTierDiscountPercent(state, 3, true), 0);
    assert.equal(calculator.getTierDiscountPercent(state, 8, true), 0);
    assert.equal(calculator.getTierDiscountPercent(state, 11, true), 5);
    const result = calculator.computeAll(state);
    assert.equal(result.products[0].line.clientTotal, 2850); // 3000 * 0.95
    assert.equal(result.products[1].line.clientTotal, 7600); // 8000 * 0.95
    assertAdminServerPdfParity(state, '3+8 joint tier');
  });

  it('multi-product + total additional: once + quote-level tier', () => {
    // Untouched sale so additionals participate in suggested client price
    const state = multiTierBase({
      discounts: { range10_50: 10, range50_100: 10, range100plus: 15 },
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [],
        },
        {
          name: 'B',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [{ price: 5000, pricingMode: 'total', showOnInvoice: true }],
        },
      ],
    });
    // A: 0; B: 5000 once (not ×6); 10% → 4500
    assert.equal(calculator.computeQuoteTotal(state), 4500);
    assert.notEqual(calculator.computeQuoteTotal(state), 5000 * 6 * 0.9);
    const wpB = calculator.resolveWholesaleProductPricing(state, state.products[1], 6, 10);
    assert.equal(wpB.adds.oneTimeTotal, 5000);
    assert.equal(wpB.grossTotal, 5000);
    assert.equal(wpB.netTotal, 4500);
    assertAdminServerPdfParity(state, 'multi + total additional');
  });

  it('multi-product + per_product additional uses product qty then quote tier', () => {
    const state = multiTierBase({
      discounts: { range10_50: 10, range50_100: 10, range100plus: 15 },
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [{ price: 500, pricingMode: 'per_product', showOnInvoice: true }],
        },
        {
          name: 'B',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [],
        },
      ],
    });
    // A: 500×6 = 3000 → 2700; B: 0; total 2700
    const wpA = calculator.resolveWholesaleProductPricing(state, state.products[0], 6, 10);
    assert.equal(wpA.adds.totalCost, 3000);
    assert.equal(wpA.grossTotal, 3000);
    assert.equal(wpA.netTotal, 2700);
    assert.equal(calculator.computeQuoteTotal(state), 2700);
    assertAdminServerPdfParity(state, 'multi + per_product');
  });

  it('multi-product mixed additionals + quote-level 10%', () => {
    const state = multiTierBase({
      discounts: { range10_50: 10, range50_100: 10, range100plus: 15 },
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [{ price: 500, pricingMode: 'per_product', showOnInvoice: true }],
        },
        {
          name: 'B',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: true }],
        },
      ],
    });
    // A: 3000 → 2700; B: 1000 once → 900; total 3600
    assert.equal(calculator.computeQuoteTotal(state), 3600);
    assertAdminServerPdfParity(state, 'multi mixed additionals');
  });

  it('multi-product manual total keeps exact total + quote-level tier', () => {
    const state = multiTierBase({
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'total',
          salePriceTotalManual: 10000,
          additionals: [],
        },
        {
          name: 'B',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          additionals: [],
        },
      ],
    });
    // A: 10000 * 0.95 = 9500; B: round(1000*0.95)*6 = 5700; total 15200
    const wpA = calculator.resolveWholesaleProductPricing(state, state.products[0], 6, 5);
    assert.equal(wpA.grossTotal, 10000);
    assert.equal(wpA.netTotal, 9500);
    assert.equal(calculator.computeQuoteTotal(state), 15200);
    assertAdminServerPdfParity(state, 'multi manual total');
  });

  it('multi-product manual unit + quote-level tier parity', () => {
    const state = multiTierBase({
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 2000,
          additionals: [],
        },
        {
          name: 'B',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1500,
          additionals: [],
        },
      ],
    });
    // A: round(2000*0.95)*6 = 11400; B: round(1500*0.95)*6 = 8550; total 19950
    assert.equal(calculator.computeQuoteTotal(state), 19950);
    assertAdminServerPdfParity(state, 'multi manual unit');
  });

  it('PDF buildLineItems uses quote-level wholesaleTierPct (source)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    assert.match(src, /var totalWholesaleQty = productLines\.reduce/);
    assert.match(src, /var wholesaleTierPct = wholesaleMode/);
    assert.match(src, /wholesaleTierPct/);
    assert.match(src, /var tierPct = Number\(wholesaleTierPct\) \|\| 0/);
    // Must not select wholesale tier from per-product qty inside wholesale branch
    assert.doesNotMatch(
      src,
      /if \(wholesaleMode\) \{[\s\S]*?getTierDiscountPercent\(state, qty, true\)/
    );
  });

  it('single-product wholesale regression still green', () => {
    const state = multiTierBase({
      discounts: { range10_50: 10, range50_100: 10, range100plus: 15 },
      products: [
        {
          name: 'A',
          quantity: 20,
          grams: 0,
          printHours: 0,
          salePriceTouched: false,
          additionals: [{ price: 5000, pricingMode: 'total', showOnInvoice: true }],
        },
      ],
    });
    assert.equal(calculator.computeQuoteTotal(state), 4500);
    assertAdminServerPdfParity(state, 'single-product regression');
  });
});

describe('PDF non-wholesale product discount reconciliation', () => {
  function loadPdf() {
    const vm = require('node:vm');
    const pdfSrc = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    const sandbox = { console };
    vm.runInNewContext(pdfSrc, sandbox);
    return sandbox.AdminCostQuotePdf;
  }

  function baseState(overrides) {
    return {
      wholesaleMode: false,
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      globalDiscount: { enabled: false, percent: 0 },
      export: { taxMode: 'excluded', shippingCost: 0 },
      ...overrides,
    };
  }

  function assertParity(state, expected, label) {
    const pdf = loadPdf();
    const result = calculator.computeAll(state);
    const server = calculator.computeQuoteTotal(state);
    const grand = pdf.computeGrandTotal({ state, result, wholesaleMode: false });
    assert.equal(result.main.grandTotal, server, label + ' admin/server');
    assert.equal(grand, server, label + ' PDF/server');
    if (expected != null) {
      assert.equal(server, expected, label + ' expected total');
      assert.equal(grand, expected, label + ' PDF expected');
    }
    return { result, server, grand };
  }

  it('PDF source uses gross rows + discountAmount for product discounts', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    const start = src.indexOf('if (useGrossLayout) {');
    const end = src.indexOf('// No product discount:', start);
    assert.ok(start >= 0 && end > start);
    const block = src.slice(start, end);
    assert.match(block, /productPreDiscountTotal/);
    assert.match(block, /var productGross = roundMoney\(productPreDiscountTotal - visibleTotal\)/);
    assert.match(block, /discountAmount: productDisc/);
    assert.match(block, /total: withIva\(productGross/);
    assert.match(block, /Math\.min\(proposedDisc, remainingDisc\)/);
    assert.doesNotMatch(block, /exactClientTotal/);
    assert.doesNotMatch(block, /exactProductLineTotal/);
  });

  function sumRowDiscounts(items) {
    return items.reduce((s, it) => {
      if (it.discountAmount != null) return s + (Number(it.discountAmount) || 0);
      return s + (Number(it.discountPerUnit) || 0) * (Number(it.qty) || 0);
    }, 0);
  }

  function sumRowTotals(items) {
    return items.reduce((s, it) => s + (Number(it.total) || 0), 0);
  }

  it('over-allocation regression: 1+101+101+101 @ 50% → disc 152 not 153', () => {
    const state = baseState({
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1,
          saleDiscountEnabled: true,
          saleDiscountPercent: 50,
          additionals: [
            { price: 101, pricingMode: 'total', showOnInvoice: true },
            { price: 101, pricingMode: 'total', showOnInvoice: true },
            { price: 101, pricingMode: 'total', showOnInvoice: true },
          ],
        },
      ],
    });
    const pdf = loadPdf();
    const result = calculator.computeAll(state);
    const line = result.products[0].line;
    assert.equal(line.productPreDiscountTotal, 304);
    assert.equal(line.productDiscountAmount, 152);
    assert.equal(line.clientTotal, 152);
    // Naive independent rounding would be 51+51+51=153
    assert.notEqual(51 + 51 + 51, line.productDiscountAmount);

    const items = pdf.buildLineItems(state, result, false, false);
    const productItems = items.filter((it) => !String(it.service || '').startsWith('Dise'));
    assert.equal(sumRowTotals(productItems), 304);
    assert.equal(sumRowDiscounts(productItems), 152);
    assertParity(state, 152, 'over-allocation cap');
  });

  it('under-allocation remainder: product row absorbs leftover to match canonical', () => {
    // gross 13, 33% → round(4.29)=4; each add round(1*0.33)=0 → product remainder 4
    const state = baseState({
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 10,
          saleDiscountEnabled: true,
          saleDiscountPercent: 33,
          additionals: [
            { price: 1, pricingMode: 'total', showOnInvoice: true },
            { price: 1, pricingMode: 'total', showOnInvoice: true },
            { price: 1, pricingMode: 'total', showOnInvoice: true },
          ],
        },
      ],
    });
    const pdf = loadPdf();
    const result = calculator.computeAll(state);
    const line = result.products[0].line;
    assert.equal(line.productPreDiscountTotal, 13);
    assert.equal(line.productDiscountAmount, 4);
    const items = pdf.buildLineItems(state, result, false, false);
    const productItems = items.filter((it) => !String(it.service || '').startsWith('Dise'));
    assert.equal(sumRowDiscounts(productItems), line.productDiscountAmount);
    const productRow = productItems.find((it) => it.service === 'A' || it.service === 'Impresión 3D');
    assert.ok(productRow);
    assert.equal(productRow.discountAmount, 4);
    assertParity(state, 9, 'under-allocation remainder');
  });

  it('no additional + 50% discount → Admin/server/PDF = 3000', () => {
    const state = baseState({
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          saleDiscountEnabled: true,
          saleDiscountPercent: 50,
          additionals: [],
        },
      ],
    });
    const { result } = assertParity(state, 3000, 'no-additional 50%');
    assert.equal(result.products[0].line.productPreDiscountTotal, 6000);
    assert.equal(result.products[0].line.productDiscountAmount, 3000);
  });

  it('per_product additional + 50% → 6000 (gross 12000, disc 6000)', () => {
    const state = baseState({
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          saleDiscountEnabled: true,
          saleDiscountPercent: 50,
          additionals: [{ price: 1000, pricingMode: 'per_product', showOnInvoice: true }],
        },
      ],
    });
    const { result } = assertParity(state, 6000, 'per_product + 50%');
    assert.equal(result.products[0].line.productPreDiscountTotal, 12000);
    assert.equal(result.products[0].line.productDiscountAmount, 6000);
    assert.equal(result.products[0].line.productPostDiscountTotal, 6000);
  });

  it('total additional + 50% → 3500', () => {
    const state = baseState({
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          saleDiscountEnabled: true,
          saleDiscountPercent: 50,
          additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: true }],
        },
      ],
    });
    assertParity(state, 3500, 'total additional + 50%');
  });

  it('hidden per_product additional + 50% → 6000, no visible add row contract', () => {
    const state = baseState({
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          saleDiscountEnabled: true,
          saleDiscountPercent: 50,
          additionals: [{ price: 1000, pricingMode: 'per_product', showOnInvoice: false }],
        },
      ],
    });
    const { result } = assertParity(state, 6000, 'hidden + 50%');
    assert.equal(result.products[0].line.additionals.visibleTotal, 0);
    assert.equal(result.products[0].line.productPreDiscountTotal, 12000);
  });

  it('non-divisible exact total + additional + 10% → 9900', () => {
    const state = baseState({
      products: [
        {
          name: 'A',
          quantity: 3,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'total',
          salePriceTotalManual: 10000,
          saleDiscountEnabled: true,
          saleDiscountPercent: 10,
          additionals: [{ price: 1000, pricingMode: 'total', showOnInvoice: true }],
        },
      ],
    });
    assertParity(state, 9900, 'non-divisible 9900');
  });

  it('product 50% then global 10% → 5400', () => {
    const state = baseState({
      globalDiscount: { enabled: true, percent: 10 },
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          saleDiscountEnabled: true,
          saleDiscountPercent: 50,
          additionals: [{ price: 1000, pricingMode: 'per_product', showOnInvoice: true }],
        },
      ],
    });
    // 12000 → product 50% → 6000 → global 10% → 5400
    assertParity(state, 5400, 'product+global');
  });

  it('multi-product: discounted A + plain B PDF parity', () => {
    const state = baseState({
      products: [
        {
          name: 'A',
          quantity: 6,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          saleDiscountEnabled: true,
          saleDiscountPercent: 50,
          additionals: [{ price: 1000, pricingMode: 'per_product', showOnInvoice: true }],
        },
        {
          name: 'B',
          quantity: 2,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 500,
          additionals: [],
        },
      ],
    });
    // A net 6000 + B 1000 = 7000
    assertParity(state, 7000, 'multi-product');
  });

  it('wholesale regression still green with composed additionals', () => {
    const state = {
      wholesaleMode: true,
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      discounts: { range10_50: 10, range50_100: 10, range100plus: 15 },
      discountRanges: {
        range10_50: { min: 1, max: 50 },
        range50_100: { min: 50, max: 100 },
        range100plus: { min: 100, max: null },
      },
      alexPercent: 30,
      luisPercent: 70,
      export: { taxMode: 'excluded', shippingCost: 0 },
      products: [
        {
          name: 'A',
          quantity: 20,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceInputMode: 'unit',
          salePriceManual: 1000,
          additionals: [{ price: 5000, pricingMode: 'total', showOnInvoice: true }],
        },
      ],
    };
    // gross 25000, 10% → 22500
    const pdf = loadPdf();
    const result = calculator.computeAll(state);
    const server = calculator.computeQuoteTotal(state);
    const grand = pdf.computeGrandTotal({ state, result, wholesaleMode: true });
    assert.equal(server, 22500);
    assert.equal(result.main.grandTotal, server);
    assert.equal(grand, server);
  });
});

// ───────────────────────────────────────────────────────
// Explicit shippingMode for Cotización 3D
// ───────────────────────────────────────────────────────
describe('Quote shippingMode semantics', () => {
  function loadPdf() {
    const vm = require('node:vm');
    const pdfSrc = fs.readFileSync(
      path.join(__dirname, '../public/js/admin/admin-cost-quote-pdf.js'),
      'utf8'
    );
    const sandbox = { window: {}, console };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    vm.runInNewContext(pdfSrc, sandbox);
    return sandbox.AdminCostQuotePdf;
  }

  function adminSrc() {
    return fs.readFileSync(path.join(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');
  }

  function baseProductsDesignState(overrides) {
    return {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 5000,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      export: {
        taxMode: 'excluded',
        shippingMode: 'pending_quote',
        shippingCost: 0,
      },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 20000,
          additionals: [],
        },
      ],
      ...(overrides || {}),
    };
  }

  it('normalizeShippingMode migrates legacy cost>0 to priced', () => {
    assert.equal(calculator.normalizeShippingMode(undefined, 3500), 'priced');
    assert.equal(calculator.normalizeShippingMode('', 3500), 'priced');
  });

  it('normalizeShippingMode migrates legacy cost<=0 to pending_quote (not free)', () => {
    assert.equal(calculator.normalizeShippingMode(undefined, 0), 'pending_quote');
    assert.equal(calculator.normalizeShippingMode(null, 0), 'pending_quote');
    assert.notEqual(calculator.normalizeShippingMode(undefined, 0), 'free');
  });

  it('resolveQuoteShipping: only priced yields amount', () => {
    assert.equal(
      calculator.resolveQuoteShipping({ shippingMode: 'priced', shippingCost: 3500 }).amount,
      3500
    );
    for (const mode of ['pending_quote', 'free', 'local_pickup', 'not_applicable']) {
      const r = calculator.resolveQuoteShipping({ shippingMode: mode, shippingCost: 3500 });
      assert.equal(r.mode, mode);
      assert.equal(r.amount, 0, mode);
    }
  });

  it('default new-quote export uses pending_quote', () => {
    const src = adminSrc();
    assert.match(src, /shippingMode:\s*'pending_quote'/);
    assert.match(src, /Estado del envío/);
    assert.match(src, /cq-shippingMode/);
  });

  it('legacy shippingCost=0 migrates to pending_quote with zero charge', () => {
    const state = baseProductsDesignState({
      export: { taxMode: 'excluded', shippingCost: 0 },
    });
    const all = calculator.computeAll(state);
    assert.equal(all.main.shippingMode, 'pending_quote');
    assert.equal(all.main.shippingCost, 0);
    assert.equal(all.main.grandTotal, 25000);
  });

  it('legacy shippingCost=3500 migrates to priced and keeps monetary result', () => {
    const state = baseProductsDesignState({
      export: { taxMode: 'excluded', shippingCost: 3500 },
    });
    const all = calculator.computeAll(state);
    assert.equal(all.main.shippingMode, 'priced');
    assert.equal(all.main.shippingCost, 3500);
    assert.equal(all.main.grandTotal, 28500);
  });

  it('priced adds shipping to grand total', () => {
    const state = baseProductsDesignState({
      export: { taxMode: 'excluded', shippingMode: 'priced', shippingCost: 3500 },
    });
    const all = calculator.computeAll(state);
    assert.equal(all.main.grandTotal, 28500);
    assert.equal(calculator.computeQuoteTotal(state), 28500);
  });

  it('pending_quote / free / local_pickup / not_applicable do not add shipping', () => {
    for (const mode of ['pending_quote', 'free', 'local_pickup', 'not_applicable']) {
      const state = baseProductsDesignState({
        export: { taxMode: 'excluded', shippingMode: mode, shippingCost: 0 },
      });
      assert.equal(calculator.computeAll(state).main.grandTotal, 25000, mode);
      assert.equal(calculator.computeQuoteTotal(state), 25000, mode);
    }
  });

  it('leaving priced clears effective charge even if raw cost leftover was present', () => {
    const free = calculator.resolveQuoteShipping({
      shippingMode: 'free',
      shippingCost: 3500,
    });
    assert.equal(free.mode, 'free');
    assert.equal(free.amount, 0);
    const applied = calculator.applyShippingModeToExport({
      shippingMode: 'free',
      shippingCost: 3500,
    });
    assert.equal(applied.shippingCost, 0);
  });

  it('priced with shippingCost=0 stays priced (not auto-free)', () => {
    const r = calculator.resolveQuoteShipping({
      shippingMode: 'priced',
      shippingCost: 0,
    });
    assert.equal(r.mode, 'priced');
    assert.equal(r.amount, 0);
  });

  it('global discount applies before shipping (shipping not discounted)', () => {
    const state = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      globalDiscount: { enabled: true, percent: 10 },
      alexPercent: 30,
      luisPercent: 70,
      export: { taxMode: 'excluded', shippingMode: 'priced', shippingCost: 3000 },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 10000,
          additionals: [],
        },
      ],
    };
    const all = calculator.computeAll(state);
    assert.equal(all.main.productsSubtotalAfterGlobal, 9000);
    assert.equal(all.main.shippingCost, 3000);
    assert.equal(all.main.grandTotal, 12000);
  });

  it('taxMode parity preserved for priced shipping fixture 31800/35934', () => {
    const base = {
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      alexPercent: 30,
      luisPercent: 70,
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 31800,
          additionals: [],
        },
      ],
    };
    assert.equal(
      calculator.computeQuoteTotal({
        ...base,
        export: { taxMode: 'included', shippingMode: 'priced', shippingCost: 0 },
      }),
      31800
    );
    assert.equal(
      calculator.computeQuoteTotal({
        ...base,
        export: { taxMode: 'add', shippingMode: 'priced', shippingCost: 0 },
      }),
      35934
    );
    assert.equal(
      calculator.computeQuoteTotal({
        ...base,
        export: { taxMode: 'excluded', shippingMode: 'priced', shippingCost: 0 },
      }),
      31800
    );
  });

  it('wholesale: priced adds shipping; pending_quote does not', () => {
    const base = {
      wholesaleMode: true,
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      discounts: { range10_50: 10, range50_100: 10, range100plus: 15 },
      discountRanges: {
        range10_50: { min: 1, max: 50 },
        range50_100: { min: 50, max: 100 },
        range100plus: { min: 100, max: null },
      },
      alexPercent: 30,
      luisPercent: 70,
      products: [
        {
          name: 'A',
          quantity: 20,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 1000,
          additionals: [],
        },
      ],
    };
    // gross 20000, 10% → 18000
    const pending = {
      ...base,
      export: { taxMode: 'excluded', shippingMode: 'pending_quote', shippingCost: 0 },
    };
    const priced = {
      ...base,
      export: { taxMode: 'excluded', shippingMode: 'priced', shippingCost: 2500 },
    };
    assert.equal(calculator.computeQuoteTotal(pending), 18000);
    assert.equal(calculator.computeQuoteTotal(priced), 20500);
  });

  it('Admin/server/PDF parity for every shipping mode', () => {
    const pdf = loadPdf();
    const modes = [
      { mode: 'priced', cost: 3500, total: 28500 },
      { mode: 'pending_quote', cost: 0, total: 25000 },
      { mode: 'free', cost: 0, total: 25000 },
      { mode: 'local_pickup', cost: 0, total: 25000 },
      { mode: 'not_applicable', cost: 0, total: 25000 },
    ];
    for (const m of modes) {
      const state = baseProductsDesignState({
        export: {
          taxMode: 'excluded',
          shippingMode: m.mode,
          shippingCost: m.cost,
        },
      });
      const result = calculator.computeAll(state);
      const server = calculator.computeQuoteTotal(state);
      const grand = pdf.computeGrandTotal({ state, result });
      assert.equal(result.main.grandTotal, m.total, m.mode + ' admin');
      assert.equal(server, m.total, m.mode + ' server');
      assert.equal(grand, m.total, m.mode + ' pdf');
    }
  });

  it('PDF: priced shipping is monetary summary only; non-priced go to Conditions notes', () => {
    const pdf = loadPdf();
    const items = [{ total: 25000, unitPrice: 25000, qty: 1, discountPerUnit: 0 }];

    function summaryFor(mode, cost) {
      return pdf.buildSummary(
        items,
        pdf.resolveQuoteShipping({ shippingMode: mode, shippingCost: cost }),
        'excluded',
        false,
        0,
        false,
        0
      );
    }

    function notesFor(mode, taxMode, shippingCost) {
      return pdf.buildNotes(
        { taxMode: taxMode || 'excluded' },
        {
          export: {
            shippingMode: mode,
            shippingCost: shippingCost != null ? shippingCost : 0,
            deliveryDays: 5,
            paymentTerms: '',
            warranty: '',
            taxMode: taxMode || 'excluded',
            extraNotes: '',
          },
          wholesaleMode: false,
        },
        { main: { quantity: 1 } }
      );
    }

    const priced = summaryFor('priced', 3500);
    assert.ok(priced.breakdown.some((r) => r.label === 'Envío' && r.amount === 3500));
    assert.equal(priced.grandTotal, 28500);
    assert.equal(pdf.buildShippingNote({ shippingMode: 'priced', shippingCost: 3500 }), null);
    const pricedNotes = notesFor('priced', 'excluded', 3500);
    assert.ok(
      !pricedNotes.some((n) =>
        /no incluido|sin costo adicional|Retiro en local|no aplica|pendiente de definir/i.test(
          n.text
        )
      )
    );

    const pricedZero = summaryFor('priced', 0);
    assert.ok(!pricedZero.breakdown.some((r) => /Env/i.test(r.label)), 'priced+0 no money row');
    assert.equal(pricedZero.grandTotal, 25000);
    assert.match(
      pdf.buildShippingNote({ shippingMode: 'priced', shippingCost: 0 }),
      /Costo de envío pendiente de definir/
    );

    for (const mode of ['pending_quote', 'free', 'local_pickup', 'not_applicable']) {
      const sum = summaryFor(mode, 0);
      assert.ok(!sum.breakdown.some((r) => /Env/i.test(r.label)), mode + ' no summary row');
      assert.equal(sum.grandTotal, 25000, mode + ' total');
    }

    assert.match(
      pdf.buildShippingNote({ shippingMode: 'pending_quote', shippingCost: 0 }),
      /Costo de envío no incluido en el total de la cotización/
    );
    assert.match(
      pdf.buildShippingNote({ shippingMode: 'free', shippingCost: 0 }),
      /sin costo adicional/
    );
    assert.match(
      pdf.buildShippingNote({ shippingMode: 'local_pickup', shippingCost: 0 }),
      /Retiro en local/
    );
    assert.match(
      pdf.buildShippingNote({ shippingMode: 'not_applicable', shippingCost: 0 }),
      /Envío: no aplica/
    );

    const pendingNotes = notesFor('pending_quote', 'excluded');
    assert.ok(
      pendingNotes.some((n) => /Costo de envío no incluido en el total de la cotización/.test(n.text))
    );
    assert.ok(pendingNotes.some((n) => /no incluyen IVA/.test(n.text)));
    const shipIdx = pendingNotes.findIndex((n) => /Costo de envío no incluido/.test(n.text));
    const ivaIdx = pendingNotes.findIndex((n) => /no incluyen IVA/.test(n.text));
    assert.ok(shipIdx !== -1 && ivaIdx !== -1 && shipIdx < ivaIdx);
  });

  it('Admin rejects priced shipping with cost <= 0 for finalize actions', () => {
    const vm = require('node:vm');
    const src = fs.readFileSync(
      path.join(__dirname, '../public/js/admin/admin-cost-quote.js'),
      'utf8'
    );
    const store = {};
    const sandbox = {
      console,
      localStorage: {
        getItem(k) {
          return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
        },
        setItem(k, v) {
          store[k] = String(v);
        },
        removeItem(k) {
          delete store[k];
        },
      },
      document: {
        getElementById() {
          return null;
        },
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      },
      window: null,
      setTimeout,
      clearTimeout,
      Promise,
      JSON,
      Math,
      Number,
      String,
      Array,
      Object,
      Date,
      Error,
      TypeError,
      parseInt,
      parseFloat,
      isNaN,
      encodeURIComponent,
      decodeURIComponent,
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.self = sandbox;
    vm.runInNewContext(src, sandbox, { filename: 'admin-cost-quote.js' });
    const validate = sandbox.AdminCostQuote.validatePricedShipping;
    assert.equal(typeof validate, 'function');
    assert.match(
      validate({ shippingMode: 'priced', shippingCost: 0 }),
      /Ingresá un costo de envío mayor a ₡0/
    );
    assert.match(
      validate({ shippingMode: 'priced', shippingCost: -1 }),
      /Ingresá un costo de envío mayor a ₡0/
    );
    assert.equal(validate({ shippingMode: 'priced', shippingCost: 3500 }), '');
    assert.equal(validate({ shippingMode: 'pending_quote', shippingCost: 0 }), '');
    assert.equal(validate({ shippingMode: 'free', shippingCost: 0 }), '');
    assert.equal(validate({ shippingMode: 'local_pickup', shippingCost: 0 }), '');
    assert.equal(validate({ shippingMode: 'not_applicable', shippingCost: 0 }), '');
    assert.match(adminSrc(), /validatePricedShipping\(state\.export\)/);
    assert.match(adminSrc(), /validatePricedShipping\(exp\)/);
    assert.match(adminSrc(), /min:\s*1/);
  });

  it('WIP detection treats non-default shippingMode as work', () => {
    const src = adminSrc();
    assert.match(src, /normalizeShippingMode\(exp\.shippingMode/);
    assert.match(src, /DEFAULTS\.export\.shippingMode/);
  });

  it('shipping still excluded from production profit when priced', () => {
    const state = baseProductsDesignState({
      costs: {
        electricityCostPerHour: 0,
        machineWearCostPerHour: 0,
        hourRate: 0,
        kgPrice: 0,
        designCost: 0,
        profitPercent: 0,
      },
      export: { taxMode: 'excluded', shippingMode: 'priced', shippingCost: 3500 },
      products: [
        {
          name: 'A',
          quantity: 1,
          grams: 0,
          printHours: 0,
          salePriceTouched: true,
          salePriceManual: 20000,
          additionals: [],
        },
      ],
    });
    const all = calculator.computeAll(state);
    assert.equal(all.main.grandTotal, 23500);
    assert.equal(all.main.businessRevenue, 20000);
  });

  it('SHIPPING_MODES assignment appears before var state = loadState()', () => {
    const src = adminSrc();
    const modesIdx = src.indexOf("var SHIPPING_MODES = [");
    const stateIdx = src.indexOf('var state = loadState()');
    assert.ok(modesIdx !== -1, 'SHIPPING_MODES assignment present');
    assert.ok(stateIdx !== -1, 'loadState bootstrap present');
    assert.ok(
      modesIdx < stateIdx,
      'SHIPPING_MODES must be assigned before loadState() bootstrap'
    );
  });
});

describe('Admin cost-quote browser bootstrap (shipping init order)', () => {
  const STORAGE_KEY = 'nl-admin-cost-quote-v1';
  const adminPath = path.join(__dirname, '../public/js/admin/admin-cost-quote.js');

  function createLocalStorage(seed) {
    const store = Object.assign({}, seed || {});
    return {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
      removeItem(key) {
        delete store[key];
      },
      clear() {
        Object.keys(store).forEach((k) => delete store[k]);
      },
    };
  }

  function evaluateAdminScript(localStorageSeed) {
    const vm = require('node:vm');
    const src = fs.readFileSync(adminPath, 'utf8');
    const localStorage = createLocalStorage(localStorageSeed);
    const document = {
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      createElement() {
        return {};
      },
    };
    const sandbox = {
      console,
      localStorage,
      document,
      window: null,
      setTimeout,
      clearTimeout,
      Promise,
      JSON,
      Math,
      Number,
      String,
      Array,
      Object,
      Date,
      Error,
      TypeError,
      parseInt,
      parseFloat,
      isNaN,
      encodeURIComponent,
      decodeURIComponent,
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.self = sandbox;
    assert.doesNotThrow(() => {
      vm.runInNewContext(src, sandbox, { filename: 'admin-cost-quote.js' });
    }, 'admin-cost-quote.js must not throw during module bootstrap / loadState()');
    assert.ok(sandbox.AdminCostQuote, 'AdminCostQuote exported');
    assert.equal(typeof sandbox.AdminCostQuote.getBootstrappedShipping, 'function');
    return sandbox.AdminCostQuote.getBootstrappedShipping();
  }

  it('bootstrap with empty localStorage → pending_quote / 0, no crash', () => {
    const shipping = evaluateAdminScript({});
    assert.equal(shipping.mode, 'pending_quote');
    assert.equal(shipping.amount, 0);
  });

  it('bootstrap with legacy localStorage shippingCost=3500 → priced / 3500, no crash', () => {
    const shipping = evaluateAdminScript({
      [STORAGE_KEY]: JSON.stringify({
        export: { shippingCost: 3500 },
      }),
    });
    assert.equal(shipping.mode, 'priced');
    assert.equal(shipping.amount, 3500);
  });
});

const pool = require('../config/db');
const { after } = require('node:test');
after(async () => {
  try {
    await pool.end();
  } catch (_) {}
});
