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

  it('ensureColumn repairs every CREATE TABLE column including client_email, total_crc, created_by', () => {
    const {
      COST_QUOTES_REQUIRED_COLUMNS,
    } = require('../scripts/migrate-cost-quote');
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
      migrate,
      COST_QUOTES_REQUIRED_COLUMNS,
    } = require('../scripts/migrate-cost-quote');

    // Simulate a pre-parity table that only has id + timestamps.
    const present = new Set(['id', 'created_at', 'updated_at']);
    const alters = [];

    const fakePool = {
      async query(sql, params) {
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return [[], []];
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
        if (/SELECT catalog_type, COUNT/.test(sql)) {
          return [[{ catalog_type: 'printer', cnt: 1 }, { catalog_type: 'material', cnt: 1 }], []];
        }
        if (/payload IS NULL AND products IS NOT NULL/.test(sql)) return [[], []];
        throw new Error('Unexpected query: ' + String(sql).slice(0, 80));
      },
    };

    await migrate(fakePool);

    // created_at/updated_at were already present; everything else must be added.
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
    assert.equal(
      alters.length,
      COST_QUOTES_REQUIRED_COLUMNS.length - 2,
      'only missing columns are added'
    );
  });

  it('second repair pass is idempotent (no ALTER when columns exist)', async () => {
    const { ensureCostQuotesColumns, COST_QUOTES_REQUIRED_COLUMNS } = require('../scripts/migrate-cost-quote');
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

  it('seeds default printer and material', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/migrate-cost-quote.js'), 'utf8');
    assert.ok(src.includes("'printer'"), 'seeds printer');
    assert.ok(src.includes("'material'"), 'seeds material');
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
      { id: '1', name: 'X', hourRate: 300 }
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

  it('thin mount page targets admin-cost-quote-app', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../views/pages/admin/cost-quote.ejs'), 'utf8');
    assert.ok(src.includes('id="admin-cost-quote-app"'));
    assert.ok(src.includes('csrf-token'));
    assert.doesNotMatch(src, /data-catalog=/);
  });

  it('frontend api helper sends CSRF headers', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');
    assert.ok(src.includes('X-CSRF-Token'));
    assert.ok(src.includes('/api/admin/cost-quotes'));
    assert.ok(src.includes('/api/admin/cost-quote-catalog'));
    assert.ok(src.includes('AdminCostQuote'));
  });

  it('resin filtering remains name-based in frontend', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/admin/admin-cost-quote.js'), 'utf8');
    assert.ok(src.includes('isResinaName'));
    assert.ok(src.includes('resina'));
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
});

const pool = require('../config/db');
const { after } = require('node:test');
after(async () => {
  try {
    await pool.end();
  } catch (_) {}
});
