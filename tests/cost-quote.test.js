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
      export: { clientName: 'Cliente Test', clientEmail: 'cliente@test.com' },
    };

    const created = await quoteStore.saveCostQuote(snapshot, 'Producto A +1 más', {
      clientEmail: 'cliente@test.com',
      clientName: 'Cliente Test',
    });
    assert.equal(created.ok, true);
    assert.ok(created.id);

    const loaded = await quoteStore.getCostQuoteRecord(created.id);
    assert.equal(loaded.payload.costs.printerId, String(printer.id));
    assert.equal(loaded.payload.costs.materialId, String(material.id));
    assert.equal(loaded.payload.products.length, 2);
    assert.equal(loaded.payload.alexPercent, 60);

    const updated = await quoteStore.saveCostQuote(
      {
        ...snapshot,
        products: [{ ...snapshot.products[0], name: 'Producto A Editado' }],
      },
      'Producto A Editado',
      { id: created.id, clientEmail: 'cliente@test.com', clientName: 'Cliente Test' }
    );
    assert.equal(updated.ok, true);
    assert.equal(updated.id, created.id);

    const reloaded = await quoteStore.getCostQuoteRecord(created.id);
    assert.equal(reloaded.productName, 'Producto A Editado');
    assert.equal(reloaded.payload.products[0].name, 'Producto A Editado');

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
    assert.equal(MIGRATION_REGISTRY[MIGRATION_REGISTRY.length - 1].name, 'migrateCostQuotePrinterCosts');
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
    // Override by injecting known production through manual sale only.
    // Set design via costs so production.designCost = 0*products... wait design from costs once per product
    state.costs.designCost = 0;
    // Manufacture: products 30000, shipping 3000, cost 10000 via additionals
    state.products[0].additionals = [{ price: 10000, showOnInvoice: true }];
    // With profit 0 and sale manual, productionCost includes additionals
    const all = calculator.computeAll(state);
    assert.equal(all.main.grandTotal, 33000); // client includes shipping
    assert.equal(all.main.businessRevenue, 30000); // no shipping
    assert.equal(all.main.grossProfit, 20000); // 30000 - 10000
    assert.equal(all.main.alexShare, 6000);
    assert.equal(all.main.luisShare, 14000);
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
      /businessRevenue = applyTaxModeLocal\(\s*Math\.max\(0, Math\.round\(subtotalAfterGlobal \+ designCost\)\),\s*taxMode\s*\)\.base/
    );
    assert.match(src, /taxableBase = Math\.max\(0, Math\.round\(subtotalAfterGlobal \+ designCost \+ shipping\)\)/);

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
      const expectedRev = calculator.computeTaxNeutralRevenue(25000, 5000, mode);
      assert.equal(all.main.businessRevenue, expectedRev, mode + ' businessRevenue');
      assert.equal(all.main.grossProfit, expectedRev - all.main.productionCost, mode + ' grossProfit');
      assert.equal(all.main.alexShare, all.main.grossProfit * 0.3, mode + ' alex');
      assert.equal(all.main.luisShare, all.main.grossProfit * 0.7, mode + ' luis');
      // Client total still includes shipping
      assert.ok(all.main.grandTotal >= 25000 + 5000 + 3000 || mode === 'included');
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

const pool = require('../config/db');
const { after } = require('node:test');
after(async () => {
  try {
    await pool.end();
  } catch (_) {}
});
