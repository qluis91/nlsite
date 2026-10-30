/**
 * PDF cotización — plantilla HTML Ninja Lab 3D + html2pdf.js
 */
(function (global) {
  'use strict';

  var PDF_PAGE_WIDTH_PX = 1080;
  var PX_TO_MM = 25.4 / 96;
  var IVA_RATE = 0.13;
  var LOGO_URL = '/images/LogoCompleto.png';
  var CSS_URL = '/css/cost-quote-pdf-template.css';
  var TRANSFER = {
    name: 'Luis Quijano Aguilar',
    cedula: '1-1461-0619',
    iban: 'CR85016111116160804858',
    sinpe: '8614 - 3452',
  };
  var BRAND = {
    phone: '(506) 7024-0270',
    web: 'www.ninjalabcr.com',
    email: 'lquijano@ninjalab3d.com',
  };
  function resolveQuoteEmail(state) {
    var exp = (state && state.export) || {};
    var raw = String(exp.quoteEmail || '')
      .trim()
      .toLowerCase();
    // Use the quote snapshot email as-is for historical reproducibility.
    if (raw) return raw;
    return BRAND.email;
  }

  var ICONS = {
    calendar:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    truck:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    shield:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    card:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    medal:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M8.21 13.89 7 22l5-3 5 3-1.21-8.11"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    phone:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    globe:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    mail:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></svg>',
  };

  function icon(name) {
    return ICONS[name] || ICONS.check;
  }

  function roundMoney(n) {
    return Math.round(Number(n) || 0);
  }

  /**
   * Line-item amounts are never inflated here — tax is applied only in summary/total.
   */
  function withIva(amount, _includeIva) {
    return roundMoney(amount);
  }

  function normalizeTaxMode(value) {
    return value === 'included' || value === 'add' || value === 'excluded' ? value : 'excluded';
  }

  function resolveTaxMode(exp, data) {
    if (data && data.taxMode != null && String(data.taxMode).trim() !== '') {
      return normalizeTaxMode(data.taxMode);
    }
    var exportObj = exp || {};
    if (exportObj.taxMode != null && String(exportObj.taxMode).trim() !== '') {
      return normalizeTaxMode(exportObj.taxMode);
    }
    if (data && data.includeIva != null) {
      return data.includeIva ? 'included' : 'excluded';
    }
    return exportObj.includeIva === true ? 'included' : 'excluded';
  }

  var SHIPPING_MODES = [
    'priced',
    'pending_quote',
    'free',
    'local_pickup',
    'not_applicable',
  ];

  var SHIPPING_MODE_CLIENT_LABELS = {
    priced: 'Envío',
    pending_quote: 'Costo de envío no incluido',
    free: 'Envío: Gratis',
    local_pickup: 'Retiro en local — sin costo de envío',
    not_applicable: '',
  };

  function normalizeShippingMode(value, shippingCost) {
    var raw = value != null ? String(value).trim() : '';
    if (SHIPPING_MODES.indexOf(raw) !== -1) return raw;
    return Number(shippingCost) > 0 ? 'priced' : 'pending_quote';
  }

  function resolveQuoteShipping(exportData) {
    var exp = exportData && typeof exportData === 'object' ? exportData : {};
    var rawCost = Math.max(0, roundMoney(exp.shippingCost));
    var mode = normalizeShippingMode(exp.shippingMode, rawCost);
    var amount = mode === 'priced' ? rawCost : 0;
    var displayText = null;
    var showInPdf = true;
    if (mode === 'pending_quote') {
      displayText = SHIPPING_MODE_CLIENT_LABELS.pending_quote;
    } else if (mode === 'free') {
      displayText = SHIPPING_MODE_CLIENT_LABELS.free;
    } else if (mode === 'local_pickup') {
      displayText = SHIPPING_MODE_CLIENT_LABELS.local_pickup;
    } else if (mode === 'not_applicable') {
      showInPdf = false;
      displayText = null;
    }
    return {
      mode: mode,
      amount: amount,
      includedInTotal: mode === 'priced',
      showInPdf: showInPdf,
      displayLabel: SHIPPING_MODE_CLIENT_LABELS[mode] || '',
      displayText: displayText,
    };
  }

  /**
   * Split a gross (IVA-included) amount into net + embedded IVA.
   * Guarantees net + iva === gross after rounding.
   */
  function extractIncludedIva(grossAmount) {
    var gross = roundMoney(grossAmount);
    if (gross <= 0) {
      return { gross: 0, net: 0, iva: 0 };
    }
    var iva = roundMoney(gross - gross / (1 + IVA_RATE));
    return {
      gross: gross,
      net: gross - iva,
      iva: iva,
    };
  }

  function applyTaxMode(baseAmount, taxMode) {
    var base = roundMoney(baseAmount);
    var mode = normalizeTaxMode(taxMode);
    if (mode === 'add') {
      var ivaAdd = roundMoney(base * IVA_RATE);
      return { taxMode: mode, base: base, iva: ivaAdd, total: base + ivaAdd };
    }
    if (mode === 'included') {
      var split = extractIncludedIva(base);
      return { taxMode: mode, base: split.net, iva: split.iva, total: split.gross };
    }
    return { taxMode: 'excluded', base: base, iva: 0, total: base };
  }

  function fmtMoney(n) {
    return '\u20A1' + roundMoney(n).toLocaleString('es-CR');
  }

  function fmtMoneyNeg(n) {
    return '-' + fmtMoney(n);
  }

  function fmtDate(d) {
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    return day + ' / ' + month + ' / ' + d.getFullYear();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeFilename(clientName, date) {
    var d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var aa = String(d.getFullYear()).slice(-2);
    var safe = String(clientName || 'Cliente')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '');
    return 'NinjaLab_cotizacion_' + (safe || 'Cliente') + '_' + dd + mm + aa + '.pdf';
  }

  function parseBullets(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(function (l) {
        return l.replace(/^[\s\-*•]+/, '').trim();
      })
      .filter(Boolean);
  }

  function getDiscountRanges(state) {
    var dr = (state && state.discountRanges) || {};
    return {
      range10_50: {
        min: Math.max(1, Number(dr.range10_50 && dr.range10_50.min) || 10),
        max: Math.max(1, Number(dr.range10_50 && dr.range10_50.max) || 50),
      },
      range50_100: {
        min: Math.max(1, Number(dr.range50_100 && dr.range50_100.min) || 50),
        max: Math.max(1, Number(dr.range50_100 && dr.range50_100.max) || 100),
      },
      range100plus: {
        min: Math.max(1, Number(dr.range100plus && dr.range100plus.min) || 100),
        max: null,
      },
    };
  }

  function formatRangeLabel(range, key) {
    if (key === 'range100plus' || range.max == null) {
      return range.min + '+ uds';
    }
    return range.min + ' a ' + range.max + ' uds';
  }

  function repQtyForRange(range, key) {
    if (key === 'range100plus' || range.max == null) {
      return range.min;
    }
    return Math.max(range.min, Math.floor((range.min + range.max) / 2));
  }

  function getTierDiscountPercent(state, qty, wholesaleMode) {
    if (!wholesaleMode) return 0;
    var d = state.discounts;
    var r = getDiscountRanges(state);
    qty = Number(qty) || 0;
    if (qty >= r.range100plus.min) return Number(d.range100plus) || 0;
    if (qty >= r.range50_100.min) return Number(d.range50_100) || 0;
    if (qty >= r.range10_50.min) return Number(d.range10_50) || 0;
    return 0;
  }

  function normalizeAdditionalPricingMode(value) {
    return value === 'total' ? 'total' : 'per_product';
  }

  function normalizeAdditional(v) {
    if (v && typeof v === 'object') {
      return {
        price: roundMoney(v.price),
        description: String(v.description || ''),
        showOnInvoice: v.showOnInvoice !== false,
        pricingMode: normalizeAdditionalPricingMode(v.pricingMode),
      };
    }
    return {
      price: roundMoney(v),
      description: '',
      showOnInvoice: true,
      pricingMode: 'per_product',
    };
  }

  function getProductAdditionals(p) {
    if (!p) return [];
    if (Array.isArray(p.additionals) && p.additionals.length) {
      return p.additionals.map(normalizeAdditional);
    }
    return [1, 2, 3].map(function (i) {
      return normalizeAdditional(p['additional' + i]);
    });
  }

  function resolveProductAdditionals(product, quantity) {
    var qty = Math.max(0, Number(quantity) || 0);
    var list = getProductAdditionals(product);
    var perProductAmount = 0;
    var oneTimeTotal = 0;
    var visiblePerProductAmount = 0;
    var visibleOneTimeTotal = 0;
    list.forEach(function (a) {
      var price = roundMoney(a.price);
      if (a.pricingMode === 'total') {
        oneTimeTotal += price;
        if (a.showOnInvoice) visibleOneTimeTotal += price;
      } else {
        perProductAmount += price;
        if (a.showOnInvoice) visiblePerProductAmount += price;
      }
    });
    var perProductTotal = roundMoney(perProductAmount * qty);
    var visiblePerProductTotal = roundMoney(visiblePerProductAmount * qty);
    return {
      perProductAmount: roundMoney(perProductAmount),
      perProductTotal: perProductTotal,
      oneTimeTotal: roundMoney(oneTimeTotal),
      totalCost: roundMoney(perProductTotal + oneTimeTotal),
      visiblePerProductAmount: roundMoney(visiblePerProductAmount),
      visiblePerProductTotal: visiblePerProductTotal,
      visibleOneTimeTotal: roundMoney(visibleOneTimeTotal),
      visibleTotal: roundMoney(visiblePerProductTotal + visibleOneTimeTotal),
    };
  }

  function sumAdditionalsAmount(p) {
    return roundMoney(
      getProductAdditionals(p).reduce(function (sum, a) {
        return sum + a.price;
      }, 0)
    );
  }

  function sumVisibleAdditionalsAmount(p) {
    return roundMoney(
      getProductAdditionals(p).reduce(function (sum, a) {
        return sum + (a.showOnInvoice ? a.price : 0);
      }, 0)
    );
  }

  function sumHiddenAdditionalsAmount(p) {
    return roundMoney(
      getProductAdditionals(p).reduce(function (sum, a) {
        return sum + (!a.showOnInvoice ? a.price : 0);
      }, 0)
    );
  }

  function normalizeCostParams(raw, source) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var hasElec = r.electricityCostPerHour != null;
    var hasWear = r.machineWearCostPerHour != null;
    var electricityCostPerHour = Number(r.electricityCostPerHour) || 0;
    var machineWearCostPerHour = Number(r.machineWearCostPerHour) || 0;
    var hourRate = Number(r.hourRate);
    if (!Number.isFinite(hourRate)) hourRate = 300;
    if (!hasElec && !hasWear) {
      electricityCostPerHour = 0;
      machineWearCostPerHour = hourRate;
    } else {
      hourRate = electricityCostPerHour + machineWearCostPerHour;
    }
    var kg = Number(r.kgPrice);
    if (!Number.isFinite(kg)) kg = 20500;
    var profit = Number(r.profitPercent);
    if (!Number.isFinite(profit)) profit = 100;
    return {
      source: source === 'override' ? 'override' : 'base',
      printerId: String(r.printerId || ''),
      printerName: String(r.printerName || ''),
      electricityCostPerHour: electricityCostPerHour,
      machineWearCostPerHour: machineWearCostPerHour,
      hourRate: hourRate,
      materialId: String(r.materialId || ''),
      materialName: String(r.materialName || ''),
      kgPrice: kg,
      designCost: Number(r.designCost) || 0,
      profitPercent: profit,
    };
  }

  function resolveProductCostParams(state, product) {
    var overrides = product && product.costOverrides;
    if (overrides && overrides.enabled === true) {
      return normalizeCostParams(overrides, 'override');
    }
    return normalizeCostParams((state && state.costs) || {}, 'base');
  }

  function normalizeSalePriceInputMode(value) {
    return value === 'total' ? 'total' : 'unit';
  }

  function resolveProductSalePrice(product, quantity, suggestedUnitPrice, suggestedProductTotal) {
    var p = product || {};
    var qty = Math.max(0, Number(quantity) || 0);
    var suggestedUnit = roundMoney(suggestedUnitPrice);
    var inputMode = normalizeSalePriceInputMode(p.salePriceInputMode);
    if (!p.salePriceTouched) {
      var productTotal =
        suggestedProductTotal != null
          ? roundMoney(suggestedProductTotal)
          : roundMoney(suggestedUnit * qty);
      return {
        inputMode: inputMode,
        manual: false,
        unitPrice: qty > 0 ? productTotal / qty : suggestedUnit,
        productTotal: productTotal,
      };
    }
    if (inputMode === 'total') {
      var enteredTotal = roundMoney(Number(p.salePriceTotalManual) || 0);
      return {
        inputMode: 'total',
        manual: true,
        unitPrice: qty > 0 ? enteredTotal / qty : 0,
        productTotal: enteredTotal,
      };
    }
    var enteredUnit = roundMoney(Number(p.salePriceManual) || 0);
    return {
      inputMode: 'unit',
      manual: true,
      unitPrice: enteredUnit,
      productTotal: roundMoney(enteredUnit * qty),
    };
  }

  function composeProductSaleWithAdditionals(baseSale, adds, quantity) {
    var qty = Math.max(0, Number(quantity) || 0);
    var additionalsTotal = roundMoney(adds && adds.totalCost);
    var baseProductSaleTotal = roundMoney(baseSale.productTotal);
    var baseProductSaleUnit = baseSale.unitPrice;
    var productTotal = roundMoney(baseProductSaleTotal + additionalsTotal);
    return Object.assign({}, baseSale, {
      baseProductSaleUnit: baseProductSaleUnit,
      baseProductSaleTotal: baseProductSaleTotal,
      additionalsTotal: additionalsTotal,
      productTotal: productTotal,
      unitPrice: qty > 0 ? productTotal / qty : baseProductSaleUnit,
    });
  }

  function getGrossUnitBeforeDiscount(state, product) {
    var p = product || getLegacyProduct(state);
    var c = resolveProductCostParams(state, p);
    var qty = Math.max(1, Number(p.quantity) || 1);
    var adds = resolveProductAdditionals(p, qty);
    var materialCost = ((Number(p.grams) || 0) / 1000) * (Number(c.kgPrice) || 0);
    var timeCost = (Number(p.printHours) || 0) * (Number(c.hourRate) || 0);
    var manufacturingSuggestedUnit = roundMoney(
      (materialCost + timeCost) * (1 + (Number(c.profitPercent) || 0) / 100)
    );
    var manufacturingSuggestedTotal = roundMoney(manufacturingSuggestedUnit * qty);
    var baseSale = resolveProductSalePrice(
      p,
      qty,
      manufacturingSuggestedUnit,
      manufacturingSuggestedTotal
    );
    var sale = composeProductSaleWithAdditionals(baseSale, adds, qty);
    return sale.unitPrice;
  }

  function getLegacyProduct(state) {
    if (state && Array.isArray(state.products) && state.products[0]) return state.products[0];
    return state.product || {};
  }

  function getProductsFromState(state) {
    if (state && Array.isArray(state.products) && state.products.length) return state.products;
    if (state && state.product) return [state.product];
    return [];
  }

  function getProductGrossUnit(state, product) {
    var p = product || getLegacyProduct(state);
    var additionals = sumAdditionalsAmount(p);
    return roundMoney(getGrossUnitBeforeDiscount(state, p) - additionals);
  }

  function computeWholesalePricing(state, product, quantity, discountPct, includeIva) {
    var grossPerUnit = getGrossUnitBeforeDiscount(state, product);
    var pct = Math.max(0, Math.min(100, Number(discountPct) || 0));
    var discountPerUnit = roundMoney(grossPerUnit * (pct / 100));
    var netPerUnit = roundMoney(grossPerUnit - discountPerUnit);
    var resolved = resolveProductCostParams(state, product);
    var design = roundMoney(resolved.designCost);
    var qty = Math.max(0, Math.round(Number(quantity) || 0));
    return {
      qty: qty,
      discountPerUnit: withIva(discountPerUnit, includeIva),
      netPerUnit: withIva(netPerUnit, includeIva),
      design: withIva(design, includeIva),
      total: withIva(netPerUnit * qty + design, includeIva),
    };
  }

  function productDescriptionBullets(state, product) {
    var bullets = parseBullets(product && product.description);
    var resolved = resolveProductCostParams(state, product);
    var materialName = String(resolved.materialName || '').trim();
    if (materialName) {
      bullets = bullets.concat(['Material: ' + materialName]);
    }
    return bullets;
  }

  function sumResolvedDesignCosts(state, result) {
    var productLines = (result && result.products) || [];
    if (!productLines.length) {
      return roundMoney(resolveProductCostParams(state, getLegacyProduct(state)).designCost);
    }
    return roundMoney(
      productLines.reduce(function (sum, pr) {
        return sum + resolveProductCostParams(state, pr.product).designCost;
      }, 0)
    );
  }

  function buildLineItemsForProduct(
    state,
    product,
    line,
    includeIva,
    wholesaleMode,
    bullets,
    wholesaleTierPct
  ) {
    var p = product;
    var m = line;
    var items = [];
    var qty = m.quantity;
    bullets = bullets || [];

    if (wholesaleMode) {
      // buildSummary(wholesale) expects GROSS line totals and subtracts discountPerUnit×qty.
      // Tier % is quote-level (total qty across all products), never per-product qty.
      var addsW = resolveProductAdditionals(p, qty);
      var cW = resolveProductCostParams(state, p);
      var materialCostW = ((Number(p.grams) || 0) / 1000) * (Number(cW.kgPrice) || 0);
      var timeCostW = (Number(p.printHours) || 0) * (Number(cW.hourRate) || 0);
      var manufacturingSuggestedUnitW = roundMoney(
        (materialCostW + timeCostW) * (1 + (Number(cW.profitPercent) || 0) / 100)
      );
      var manufacturingSuggestedTotalW = roundMoney(manufacturingSuggestedUnitW * qty);
      var baseSaleW = resolveProductSalePrice(
        p,
        qty,
        manufacturingSuggestedUnitW,
        manufacturingSuggestedTotalW
      );
      var saleW = composeProductSaleWithAdditionals(baseSaleW, addsW, qty);
      var tierPct = Number(wholesaleTierPct) || 0;
      var grossTotalW = roundMoney(saleW.productTotal);
      var useLegacyUnitRoundW =
        saleW.manual &&
        saleW.inputMode === 'unit' &&
        addsW.totalCost === 0 &&
        tierPct > 0;
      var netTotalW = grossTotalW;
      if (tierPct > 0) {
        if (useLegacyUnitRoundW) {
          netTotalW = roundMoney(saleW.baseProductSaleUnit * (1 - tierPct / 100)) * qty;
        } else {
          netTotalW = roundMoney(grossTotalW * (1 - tierPct / 100));
        }
      }
      var targetDiscW = roundMoney(grossTotalW - netTotalW);

      var visibleGrossW = addsW.visibleTotal;
      var visibleAddRows = [];
      var allocatedDiscW = 0;
      getProductAdditionals(p).forEach(function (extra, idx) {
        if (!extra.showOnInvoice) return;
        var price = roundMoney(extra.price);
        if (price <= 0) return;
        var isTotalMode = extra.pricingMode === 'total';
        var addQty = isTotalMode ? 1 : qty;
        var addGross = price * addQty;
        var addDisc = tierPct > 0 ? roundMoney(addGross * (tierPct / 100)) : 0;
        allocatedDiscW += addDisc;
        var label = String(extra.description || '').trim() || 'Servicio adicional ' + (idx + 1);
        visibleAddRows.push({
          service: label,
          bullets: [],
          text: String(extra.description || '').trim() || 'Servicio complementario',
          qty: addQty,
          unitPrice: withIva(price, includeIva),
          discountPerUnit: withIva(addQty > 0 ? addDisc / addQty : 0, includeIva),
          // Exact discount — avoid round(discountPerUnit)×qty drift
          discountAmount: addDisc,
          total: withIva(addGross, includeIva),
        });
      });

      var productGrossW = roundMoney(grossTotalW - visibleGrossW);
      // Remainder discount so product + adds discounts == canonical target.
      var productDiscW = Math.max(0, roundMoney(targetDiscW - allocatedDiscW));
      items.push({
        service: p.name || 'Impresi\u00f3n 3D',
        bullets: bullets.length ? bullets : ['Impresi\u00f3n 3D de alta calidad'],
        text: '',
        qty: qty,
        unitPrice: withIva(qty > 0 ? productGrossW / qty : 0, includeIva),
        discountPerUnit: withIva(qty > 0 ? productDiscW / qty : 0, includeIva),
        discountAmount: productDiscW,
        total: withIva(productGrossW, includeIva),
      });
      visibleAddRows.forEach(function (row) {
        items.push(row);
      });

      return items;
    }

    var adds = resolveProductAdditionals(p, qty);
    var visibleTotal = adds.visibleTotal;
    var productPreDiscountTotal =
      m.productPreDiscountTotal != null
        ? roundMoney(m.productPreDiscountTotal)
        : m.baseSaleTotal != null
          ? roundMoney(m.baseSaleTotal)
          : roundMoney((Number(m.baseSale != null ? m.baseSale : m.suggestedPrice) || 0) * qty);
    var productDiscountAmount =
      m.productDiscountAmount != null
        ? roundMoney(m.productDiscountAmount)
        : 0;
    var manualPct = Math.max(0, Math.min(100, Number(m.discountPercent) || 0));
    var useGrossLayout = manualPct > 0 || productDiscountAmount > 0;
    var exactClientTotal =
      m.clientTotal != null
        ? roundMoney(m.clientTotal)
        : roundMoney(productPreDiscountTotal - productDiscountAmount);

    if (useGrossLayout) {
      // GROSS rows + allocated discounts. Summary subtracts discount once.
      // Cap each visible-additional discount so sum(row discounts) === productDiscountAmount.
      var targetDisc = productDiscountAmount;
      if (targetDisc <= 0 && manualPct > 0) {
        targetDisc = roundMoney(productPreDiscountTotal * (manualPct / 100));
      }
      var remainingDisc = Math.max(0, roundMoney(targetDisc));
      var visibleAddRows = [];
      getProductAdditionals(p).forEach(function (extra, idx) {
        if (!extra.showOnInvoice) return;
        var price = roundMoney(extra.price);
        if (price <= 0) return;
        var isTotalMode = extra.pricingMode === 'total';
        var addQty = isTotalMode ? 1 : qty;
        var addGross = price * addQty;
        var proposedDisc = manualPct > 0 ? roundMoney(addGross * (manualPct / 100)) : 0;
        var addDisc = Math.min(proposedDisc, remainingDisc);
        remainingDisc = Math.max(0, roundMoney(remainingDisc - addDisc));
        var label = String(extra.description || '').trim() || 'Servicio adicional ' + (idx + 1);
        visibleAddRows.push({
          service: label,
          bullets: [],
          text: String(extra.description || '').trim() || 'Servicio complementario',
          qty: addQty,
          unitPrice: withIva(price, includeIva),
          discountPerUnit: withIva(addQty > 0 ? addDisc / addQty : 0, includeIva),
          discountAmount: addDisc,
          total: withIva(addGross, includeIva),
        });
      });

      var productGross = roundMoney(productPreDiscountTotal - visibleTotal);
      // Remainder of canonical discount always lands on the product row (incl. hidden adds).
      var productDisc = remainingDisc;
      items.push({
        service: p.name || 'Impresi\u00f3n 3D',
        bullets: bullets.length ? bullets : ['Impresi\u00f3n 3D de alta calidad'],
        text: '',
        qty: qty,
        unitPrice: withIva(qty > 0 ? productGross / qty : 0, includeIva),
        discountPerUnit: withIva(qty > 0 ? productDisc / qty : 0, includeIva),
        discountAmount: productDisc,
        total: withIva(productGross, includeIva),
      });
      visibleAddRows.forEach(function (row) {
        items.push(row);
      });
      return items;
    }

    // No product discount: emit net product portion + gross visible additionals
    // (linesTotal already equals client product total; summary does not re-subtract).
    var exactProductLineTotal = roundMoney(exactClientTotal - visibleTotal);
    var regularUnit = qty > 0 ? exactProductLineTotal / qty : 0;
    items.push({
      service: p.name || 'Impresi\u00f3n 3D',
      bullets: bullets.length ? bullets : ['Impresi\u00f3n 3D de alta calidad'],
      text: '',
      qty: qty,
      unitPrice: withIva(regularUnit, includeIva),
      discountPerUnit: 0,
      total: withIva(exactProductLineTotal, includeIva),
    });

    getProductAdditionals(p).forEach(function (extra, idx) {
      if (!extra.showOnInvoice) return;
      var price = roundMoney(extra.price);
      if (price <= 0) return;
      var isTotalMode = extra.pricingMode === 'total';
      var q = isTotalMode ? 1 : qty;
      var label = String(extra.description || '').trim() || 'Servicio adicional ' + (idx + 1);
      items.push({
        service: label,
        bullets: [],
        text: String(extra.description || '').trim() || 'Servicio complementario',
        qty: q,
        unitPrice: withIva(price, includeIva),
        discountPerUnit: 0,
        total: withIva(price * q, includeIva),
      });
    });

    return items;
  }

  function buildLineItems(state, result, includeIva, wholesaleMode) {
    var items = [];
    var productLines = (result && result.products) || [];
    if (!productLines.length) {
      productLines = [{ product: getLegacyProduct(state), line: result.main }];
    }
    var totalWholesaleQty = productLines.reduce(function (sum, pr) {
      return (
        sum +
        Math.max(
          1,
          Number(pr.line && pr.line.quantity) ||
            Number(pr.product && pr.product.quantity) ||
            1
        )
      );
    }, 0);
    var wholesaleTierPct = wholesaleMode
      ? getTierDiscountPercent(state, totalWholesaleQty, true)
      : 0;
    productLines.forEach(function (pr) {
      var bullets = productDescriptionBullets(state, pr.product);
      items = items.concat(
        buildLineItemsForProduct(
          state,
          pr.product,
          pr.line,
          includeIva,
          wholesaleMode,
          bullets,
          wholesaleTierPct
        )
      );
    });

    if (!wholesaleMode) {
      productLines.forEach(function (pr) {
        var resolved = resolveProductCostParams(state, pr.product);
        var design = roundMoney(resolved.designCost);
        if (design <= 0) return;
        var pname = String((pr.product && pr.product.name) || '').trim() || 'Producto';
        items.push({
          service: 'Dise\u00f1o personalizado \u2014 ' + pname,
          bullets: [],
          text: 'Dise\u00f1o de modelo y adaptaci\u00f3n para impresi\u00f3n',
          qty: 1,
          unitPrice: withIva(design, includeIva),
          discountPerUnit: 0,
          total: withIva(design, includeIva),
        });
      });
    }

    return items;
  }

  function hasTableDiscount(items) {
    return items.some(function (it) {
      return (it.discountPerUnit || 0) > 0;
    });
  }

  function sumUnitPrices(items) {
    return items.reduce(function (sum, it) {
      return sum + (it.unitPrice || 0);
    }, 0);
  }

  function buildSummary(
    items,
    shippingOrResolved,
    taxMode,
    wholesaleMode,
    designCost,
    useGrossDiscountLayout,
    globalDiscountAmount
  ) {
    var mode = normalizeTaxMode(taxMode);
    var unitPriceSum = sumUnitPrices(items);
    var discountTotal = 0;
    items.forEach(function (it) {
      if (it.discountAmount != null) {
        discountTotal += Number(it.discountAmount) || 0;
      } else {
        discountTotal += it.discountPerUnit * it.qty;
      }
    });
    var shippingResolved =
      shippingOrResolved && typeof shippingOrResolved === 'object' && shippingOrResolved.mode
        ? shippingOrResolved
        : resolveQuoteShipping({
            shippingMode: 'priced',
            shippingCost: shippingOrResolved,
          });
    var shippingAmt = roundMoney(shippingResolved.amount);
    var linesTotal = items.reduce(function (s, it) {
      return s + it.total;
    }, 0);
    var designAmt = wholesaleMode && designCost > 0 ? roundMoney(designCost) : 0;
    var grossDiscount = wholesaleMode || !!useGrossDiscountLayout;
    var netLines = grossDiscount ? roundMoney(linesTotal - discountTotal) : linesTotal;
    var extraDesign = wholesaleMode ? designAmt : 0;
    var globalDiscAmt = roundMoney(Math.max(0, Number(globalDiscountAmount) || 0));
    var enteredSubtotal = grossDiscount
      ? netLines + extraDesign + shippingAmt
      : linesTotal + extraDesign + shippingAmt;
    if (globalDiscAmt > 0) {
      enteredSubtotal = Math.max(0, roundMoney(enteredSubtotal - globalDiscAmt));
    }
    enteredSubtotal = roundMoney(enteredSubtotal);

    var tax = applyTaxMode(enteredSubtotal, mode);
    var breakdown = [];
    if (!wholesaleMode && designAmt > 0) {
      breakdown.push({ label: '* Dise\u00f1o personalizado', amount: designAmt });
    }
    if (shippingResolved.mode === 'priced' && shippingAmt > 0) {
      breakdown.push({ label: 'Env\u00edo', amount: shippingAmt });
    } else if (shippingResolved.mode === 'pending_quote') {
      breakdown.push({
        label: 'Env\u00edo',
        displayText: 'Costo de env\u00edo no incluido',
      });
    } else if (shippingResolved.mode === 'free') {
      breakdown.push({ label: 'Env\u00edo', displayText: 'Gratis' });
    } else if (shippingResolved.mode === 'local_pickup') {
      breakdown.push({
        label: 'Env\u00edo',
        displayText: 'Retiro en local \u2014 sin costo de env\u00edo',
      });
    }
    // not_applicable: omit shipping row
    if (globalDiscAmt > 0) {
      breakdown.push({ label: 'Descuento general', amount: -globalDiscAmt });
    }

    return {
      unitPriceSum: unitPriceSum,
      discountTotal: discountTotal + globalDiscAmt,
      linesTotal: linesTotal,
      netLines: netLines,
      breakdown: breakdown,
      shipping: shippingAmt,
      shippingMode: shippingResolved.mode,
      shippingResolved: shippingResolved,
      designAmount: designAmt,
      taxMode: mode,
      includeIva: mode === 'included',
      enteredSubtotal: enteredSubtotal,
      subtotalBeforeTax: mode === 'included' ? tax.base : enteredSubtotal,
      subtotalExVat: mode === 'included' ? tax.base : enteredSubtotal,
      ivaAmount: tax.iva,
      ivaIncluded: mode === 'included' ? tax.iva : 0,
      ivaDisplay: tax.iva > 0 ? fmtMoney(tax.iva) : '\u2014',
      grandTotal: tax.total,
    };
  }

  function buildNotes(data, state, result) {
    var exp = state.export || {};
    var wholesaleMode = !!(data.wholesaleMode || state.wholesaleMode);
    var notes = [];
    if (wholesaleMode && data.discountNote) {
      notes.push({ icon: 'shield', text: data.discountNote.replace(/^\*\s*/, '') });
    } else if (wholesaleMode && getTierDiscountPercent(state, result.main.quantity, true) > 0) {
      notes.push({
        icon: 'shield',
        text:
          'Aplicado beneficio de Precio Mayorista por compra de ' +
          result.main.quantity +
          ' unidades.',
      });
    }
    if (exp.deliveryDays > 0) {
      notes.push({
        icon: 'clock',
        text:
          'Entrega estimada: ' +
          exp.deliveryDays +
          ' d\u00edas h\u00e1biles posteriores a la confirmaci\u00f3n del pago.',
      });
    }
    if (exp.paymentTerms) {
      notes.push({ icon: 'card', text: exp.paymentTerms });
    }
    if (exp.warranty) {
      notes.push({ icon: 'medal', text: exp.warranty });
    }
    var taxMode = resolveTaxMode(exp, data);
    if (taxMode === 'included') {
      notes.push({
        icon: 'check',
        text: 'Precios incluyen IVA (' + Math.round(IVA_RATE * 100) + '%).',
      });
    } else if (taxMode === 'add') {
      notes.push({
        icon: 'check',
        text: 'IVA (' + Math.round(IVA_RATE * 100) + '%) agregado al total de la cotizaci\u00f3n.',
      });
    } else {
      notes.push({
        icon: 'check',
        text:
          'Los precios indicados no incluyen IVA. En caso de requerir factura electr\u00f3nica, se agregar\u00e1 el 13% de IVA correspondiente.',
      });
    }
    if (exp.extraNotes) {
      exp.extraNotes
        .split('\n')
        .map(function (l) {
          return l.trim();
        })
        .filter(Boolean)
        .forEach(function (l) {
          notes.push({ icon: 'check', text: l.replace(/^\*\s*/, '') });
        });
    }
    return notes;
  }

  function renderTableRows(items, showDiscountCol) {
    return items
      .map(function (it, idx) {
        var descHtml = it.bullets.length
          ? it.bullets
              .map(function (b) {
                return escapeHtml(b);
              })
              .join('<br>')
          : escapeHtml(it.text);
        var disc = '';
        if (showDiscountCol) {
          disc =
            it.discountPerUnit > 0
              ? '<td class="money discount">' + fmtMoneyNeg(it.discountPerUnit) + '</td>'
              : '<td class="center">\u2014</td>';
        }
        return (
          '<tr>' +
          '<td class="num">' +
          (idx + 1) +
          '</td>' +
          '<td class="service">' +
          escapeHtml(it.service) +
          '</td>' +
          '<td class="description">' +
          descHtml +
          '</td>' +
          '<td class="center">' +
          it.qty +
          '</td>' +
          '<td class="money">' +
          fmtMoney(it.unitPrice) +
          '</td>' +
          disc +
          '<td class="money"><strong>' +
          fmtMoney(it.total) +
          '</strong></td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function renderTableFooter(items, showDiscountCol, wholesaleMode, designCost, includeIva) {
    var labelCols = 4;
    var grossSub = items.reduce(function (sum, it) {
      return sum + it.total;
    }, 0);
    var discSub = items.reduce(function (sum, it) {
      return sum + it.discountPerUnit * it.qty;
    }, 0);
    // Precio unit. footer cell stays empty — only the Total column shows the subtotal.
    var html = '<tfoot>';
    html +=
      '<tr class="quote-table-subtotal">' +
      '<td colspan="' +
      labelCols +
      '" class="subtotal-label"><strong>Subtotal</strong></td>' +
      '<td class="money"></td>' +
      (showDiscountCol
        ? '<td class="money discount">' +
          (discSub > 0 ? '<strong>' + fmtMoneyNeg(discSub) + '</strong>' : '') +
          '</td>'
        : '') +
      '<td class="money"><strong>' +
      fmtMoney(grossSub) +
      '</strong></td>' +
      '</tr>';
    if (wholesaleMode && designCost > 0) {
      var designLeading = showDiscountCol ? 6 : 5;
      html +=
        '<tr class="quote-table-design">' +
        '<td colspan="' +
        designLeading +
        '" class="subtotal-label">' +
        '<strong>* Dise\u00f1o personalizado</strong>' +
        ' <span class="quote-table-design-note">(se cobra una sola vez por pedido)</span></td>' +
        '<td class="money"><strong>' +
        fmtMoney(withIva(designCost, includeIva)) +
        '</strong></td>' +
        '</tr>';
    }
    html += '</tfoot>';
    return html;
  }

  function renderTilopayNote(grandTotal) {
    // PDF presentation: hide "Total con pago web" for now.
    // Tilopay fee calculation remains available via NLTilopayFees for other workflows.
    void grandTotal;
    return '';
  }

  function renderSummaryRows(summary, wholesaleMode, useGrossDiscountLayout) {
    var html = '';
    var grossLayout = wholesaleMode || !!useGrossDiscountLayout;
    var mode = normalizeTaxMode(summary.taxMode);

    function appendDiscountAndBreakdown() {
      if (grossLayout && summary.discountTotal > 0) {
        html +=
          '<div class="summary-row"><strong>' +
          (wholesaleMode ? 'Descuento mayorista' : 'Descuento') +
          '</strong><span class="discount">' +
          fmtMoneyNeg(summary.discountTotal) +
          '</span></div>';
      } else if (!grossLayout && summary.discountTotal > 0) {
        html +=
          '<div class="summary-row"><strong>Descuento</strong><span class="discount">' +
          fmtMoneyNeg(summary.discountTotal) +
          '</span></div>';
      }
      summary.breakdown.forEach(function (row) {
        if (row.displayText != null && row.displayText !== '') {
          html +=
            '<div class="summary-row summary-row--text"><strong>' +
            escapeHtml(row.label) +
            '</strong><span>' +
            escapeHtml(row.displayText) +
            '</span></div>';
          return;
        }
        html +=
          '<div class="summary-row"><strong>' +
          escapeHtml(row.label) +
          '</strong><span>' +
          fmtMoney(row.amount) +
          '</span></div>';
      });
    }

    if (mode === 'included') {
      appendDiscountAndBreakdown();
      html +=
        '<div class="summary-row"><strong>Subtotal sin IVA</strong><span>' +
        fmtMoney(summary.subtotalExVat) +
        '</span></div>';
      html +=
        '<div class="summary-row"><strong>IVA incluido (' +
        Math.round(IVA_RATE * 100) +
        '%)</strong><span>' +
        fmtMoney(summary.ivaAmount) +
        '</span></div>';
      return html;
    }

    if (mode === 'add') {
      appendDiscountAndBreakdown();
      html +=
        '<div class="summary-row"><strong>Subtotal</strong><span>' +
        fmtMoney(summary.enteredSubtotal) +
        '</span></div>';
      html +=
        '<div class="summary-row"><strong>IVA (' +
        Math.round(IVA_RATE * 100) +
        '%)</strong><span>' +
        fmtMoney(summary.ivaAmount) +
        '</span></div>';
      return html;
    }

    // excluded — no IVA row
    appendDiscountAndBreakdown();
    html +=
      '<div class="summary-row"><strong>Subtotal</strong><span>' +
      fmtMoney(summary.enteredSubtotal != null ? summary.enteredSubtotal : summary.linesTotal) +
      '</span></div>';
    return html;
  }

  function renderWholesaleTableHtml(state, result, includeIva) {
    var refProduct = getProductsFromState(state)[0] || getLegacyProduct(state);
    var rows = result.scenarios.map(function (sc) {
      var range = sc.range || getDiscountRanges(state)[sc.key];
      var repQty = repQtyForRange(range, sc.key);
      var pricing = computeWholesalePricing(state, refProduct, repQty, sc.discount, includeIva);
      return {
        label: sc.label || formatRangeLabel(range, sc.key),
        discountPerUnit: pricing.discountPerUnit,
        netPerUnit: pricing.netPerUnit,
      };
    });
    return (
      '<section class="wholesale-prices">' +
      '<h3 class="wholesale-prices__title">Precio por unidad</h3>' +
      '<table class="quote-table wholesale-table"><thead><tr>' +
      '<th>Cantidades</th><th>Descuento</th><th>Precio / uds</th>' +
      '</tr></thead><tbody>' +
      rows
        .map(function (r) {
          var disc =
            r.discountPerUnit > 0
              ? '<td class="money discount">' + fmtMoneyNeg(r.discountPerUnit) + '</td>'
              : '<td class="center">\u2014</td>';
          return (
            '<tr><td class="center">' +
            escapeHtml(r.label) +
            '</td>' +
            disc +
            '<td class="money"><strong>' +
            fmtMoney(r.netPerUnit) +
            '</strong></td></tr>'
          );
        })
        .join('') +
      '</tbody></table></section>'
    );
  }

  function buildQuoteHtml(data, state, result, logoDataUrl) {
    var exp = state.export || {};
    var taxMode = resolveTaxMode(exp, data);
    var includeIva = taxMode === 'included';
    var wholesaleMode = !!(data.wholesaleMode || state.wholesaleMode);
    var designCost = sumResolvedDesignCosts(state, result);
    var items = buildLineItems(state, result, includeIva, wholesaleMode);
    var hasProductDiscount =
      (result.products || []).some(function (pr) {
        return Math.max(0, Number(pr.line && pr.line.discountPercent) || 0) > 0;
      });
    var useGrossDiscountLayout =
      !wholesaleMode &&
      (Math.max(0, Number(result.main && result.main.discountPercent) || 0) > 0 || hasProductDiscount);
    var summary = buildSummary(
      items,
      resolveQuoteShipping(exp),
      taxMode,
      wholesaleMode,
      designCost,
      useGrossDiscountLayout,
      result.main && result.main.globalDiscountAmount
    );
    var notes = buildNotes(data, state, result);
    var logoSrc = logoDataUrl || LOGO_URL;
    var validDays = Number(exp.validDays) || 15;
    var deliveryDays = Number(exp.deliveryDays) || 5;
    var showDiscountCol = !wholesaleMode && !useGrossDiscountLayout && hasTableDiscount(items);
    var footerEmail = resolveQuoteEmail(state);

    return (
      '<div class="cq-pdf-root">' +
      '<main class="quote-page">' +
      '<header class="header">' +
      '<div class="brand"><img src="' +
      escapeHtml(logoSrc) +
      '" class="logo-full" alt="Ninja Lab 3D" /></div>' +
      '<div class="title-box">' +
      '<h1 class="title"><span class="arrows">\u00bb</span>Cotizaci\u00f3n</h1>' +
      '<div class="date">Fecha: ' +
      fmtDate(new Date()) +
      '</div></div></header>' +
      '<section class="top-info">' +
      '<div class="client">' +
      '<h2>Cliente:</h2>' +
      '<div class="client-name">' +
      escapeHtml(data.clientName) +
      '</div>' +
      '<div class="client-subtitle">' +
      escapeHtml(data.orderTitle || '') +
      '</div></div>' +
      '<div class="cards">' +
      '<div class="info-card"><div class="icon-circle">' +
      icon('calendar') +
      '</div><div><small>V\u00e1lida por:</small><strong>' +
      validDays +
      ' d\u00edas</strong></div></div>' +
      '<div class="info-card"><div class="icon-circle">' +
      icon('truck') +
      '</div><div><small>Entrega estimada:</small><strong>' +
      deliveryDays +
      ' d\u00edas h\u00e1biles</strong></div></div>' +
      '</div></section>' +
      '<table class="quote-table"><thead><tr>' +
      '<th>#</th><th>Servicio</th><th>Descripci\u00f3n</th><th>Cantidad</th><th>Precio unit.</th>' +
      (showDiscountCol ? '<th>Descuento</th>' : '') +
      '<th>Total</th>' +
      '</tr></thead><tbody>' +
      renderTableRows(items, showDiscountCol) +
      '</tbody>' +
      renderTableFooter(items, showDiscountCol, wholesaleMode, designCost, includeIva) +
      '</table>' +
      (wholesaleMode ? renderWholesaleTableHtml(state, result, includeIva) : '') +
      '<section class="content-bottom">' +
      '<div class="notes"><h3>CONDICIONES Y ANOTACIONES</h3>' +
      notes
        .map(function (n) {
          return (
            '<div class="note-item"><div class="note-icon">' +
            icon(n.icon) +
            '</div><div>' +
            escapeHtml(n.text) +
            '</div></div>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="summary"><div class="summary-content">' +
      renderSummaryRows(summary, wholesaleMode, useGrossDiscountLayout) +
      '</div><div class="summary-total"><span>TOTAL</span><span>' +
      fmtMoney(summary.grandTotal) +
      '</span></div>' +
      renderTilopayNote(summary.grandTotal) +
      '</div></section>' +
      '<section class="bank"><h3>DETALLES DE TRANSFERENCIA</h3>' +
      '<div class="bank-name">A nombre de: <strong>' +
      escapeHtml(TRANSFER.name) +
      '</strong> (C\u00e9d. ' +
      escapeHtml(TRANSFER.cedula) +
      ')</div>' +
      '<div class="bank-grid"><div><div class="bank-label">CUENTA IBAN</div><div class="bank-value">' +
      escapeHtml(TRANSFER.iban) +
      '</div></div><div><div class="bank-label">SINPE M\u00d3VIL</div><div class="bank-value">' +
      escapeHtml(TRANSFER.sinpe) +
      '</div></div></div></section>' +
      '<div class="footer-deco">' +
      '<div class="footer-stripes"></div>' +
      '<div class="footer-green-fill"></div>' +
      '</div>' +
      '<footer class="footer">' +
      '<div class="footer-item"><span class="footer-icon-wrap"><span class="footer-icon">' +
      icon('phone') +
      '</span></span><span>' +
      escapeHtml(BRAND.phone) +
      '</span></div>' +
      '<div class="footer-item"><span class="footer-icon-wrap"><span class="footer-icon">' +
      icon('globe') +
      '</span></span><span>' +
      escapeHtml(BRAND.web) +
      '</span></div>' +
      '<div class="footer-item"><span class="footer-icon-wrap"><span class="footer-icon">' +
      icon('mail') +
      '</span></span><span>' +
      escapeHtml(footerEmail) +
      '</span></div></footer>' +
      '</main></div>'
    );
  }

  var cssCache = null;

  function loadCssText() {
    if (cssCache) return Promise.resolve(cssCache);
    return fetch(CSS_URL, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('No se pudo cargar la plantilla CSS.');
        return r.text();
      })
      .then(function (text) {
        cssCache = text;
        return text;
      });
  }

  function loadLogoDataUrl() {
    return fetch(LOGO_URL, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('logo');
        return r.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () {
            resolve(reader.result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })
      .catch(function () {
        return null;
      });
  }

  function injectExportStyles(cssText) {
    var el = document.getElementById('cq-pdf-export-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'cq-pdf-export-style';
      document.head.appendChild(el);
    }
    el.textContent = cssText;
    return el;
  }

  function removeExportStyles() {
    var el = document.getElementById('cq-pdf-export-style');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function getJsPDF() {
    if (global.jspdf && global.jspdf.jsPDF) return global.jspdf.jsPDF;
    if (global.jsPDF) return global.jsPDF;
    return null;
  }

  function waitForImages(root) {
    var imgs = root.querySelectorAll('img');
    return Promise.all(
      Array.prototype.map.call(imgs, function (img) {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise(function (resolve) {
          img.onload = resolve;
          img.onerror = resolve;
        });
      })
    );
  }

  function mountExportRoot(bodyHtml) {
    var existing = document.getElementById('cq-pdf-export-mount');
    if (existing) existing.parentNode.removeChild(existing);

    var wrap = document.createElement('div');
    wrap.id = 'cq-pdf-export-mount';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText =
      'position:fixed;left:0;top:0;width:' +
      PDF_PAGE_WIDTH_PX +
      'px;margin:0;padding:0;background:#ffffff;z-index:2147483647;overflow:visible;';
    wrap.innerHTML = bodyHtml;
    document.body.appendChild(wrap);

    var root = wrap.querySelector('.cq-pdf-root');
    var page = wrap.querySelector('.quote-page');
    if (root) {
      root.style.background = '#ffffff';
      root.style.width = PDF_PAGE_WIDTH_PX + 'px';
      root.style.color = '#111111';
    }
    if (page) {
      page.style.width = PDF_PAGE_WIDTH_PX + 'px';
      page.style.minHeight = 'auto';
    }
    return { wrap: wrap, root: root, page: page };
  }

  function cleanupExport(mount) {
    removeExportStyles();
    if (mount && mount.wrap && mount.wrap.parentNode) {
      mount.wrap.parentNode.removeChild(mount.wrap);
    }
  }

  function buildPdfFromCanvas(canvas, cssWidth, cssHeight) {
    var JsPDF = getJsPDF();
    if (!JsPDF) {
      throw new Error('jsPDF no cargado. Recarg\u00e1 la p\u00e1gina.');
    }
    var pageWmm = cssWidth * PX_TO_MM;
    var pageHmm = cssHeight * PX_TO_MM;
    var pdf = new JsPDF({
      unit: 'mm',
      format: [pageWmm, pageHmm],
      orientation: 'portrait',
      compress: true,
    });
    pdf.addImage(
      canvas.toDataURL('image/jpeg', 0.95),
      'JPEG',
      0,
      0,
      pageWmm,
      pageHmm,
      undefined,
      'MEDIUM'
    );
    return pdf;
  }

  function canvasToPdf(canvas, filename, cssWidth, cssHeight) {
    buildPdfFromCanvas(canvas, cssWidth, cssHeight).save(filename);
  }

  function canvasToPdfBlob(canvas, cssWidth, cssHeight) {
    return buildPdfFromCanvas(canvas, cssWidth, cssHeight).output('blob');
  }

  function captureRootToCanvas(target, cssText) {
    if (!global.html2canvas) {
      return Promise.reject(new Error('html2canvas no cargado. Recarg\u00e1 la p\u00e1gina.'));
    }
    var cssWidth = target.offsetWidth || PDF_PAGE_WIDTH_PX;
    var cssHeight = target.scrollHeight || target.offsetHeight;
    return global.html2canvas(target, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: true,
      logging: false,
      imageTimeout: 15000,
      width: cssWidth,
      height: cssHeight,
      windowWidth: cssWidth,
      windowHeight: cssHeight,
      scrollX: 0,
      scrollY: 0,
      onclone: function (clonedDoc) {
        var style = clonedDoc.createElement('style');
        style.textContent = cssText;
        clonedDoc.head.appendChild(style);
        var cloned = clonedDoc.querySelector('.quote-page') || clonedDoc.querySelector('.cq-pdf-root');
        if (cloned) {
          cloned.style.opacity = '1';
          cloned.style.visibility = 'visible';
          cloned.style.background = '#ffffff';
          cloned.style.width = PDF_PAGE_WIDTH_PX + 'px';
          cloned.style.minHeight = 'auto';
          cloned.style.height = 'auto';
          cloned.style.overflow = 'visible';
        }
      },
    });
  }

  function renderCostQuotePdfCanvas(data) {
    var JsPDF = getJsPDF();
    if (!global.html2canvas || !JsPDF) {
      return Promise.reject(
        new Error('Bibliotecas PDF no cargadas. Recarg\u00e1 la p\u00e1gina con Ctrl+F5.')
      );
    }
    var clientName = String(data.clientName || '').trim();
    if (!clientName) {
      return Promise.reject(new Error('Indic\u00e1 el nombre del cliente.'));
    }
    var state = data.state;
    var result = data.result;
    var mount = null;

    return Promise.all([loadCssText(), loadLogoDataUrl()])
      .then(function (parts) {
        var cssText = parts[0];
        var logoDataUrl = parts[1];
        var bodyHtml = buildQuoteHtml(data, state, result, logoDataUrl);
        injectExportStyles(cssText);
        mount = mountExportRoot(bodyHtml);
        if (!mount.root || !mount.page) {
          throw new Error('No se pudo montar la plantilla PDF.');
        }
        var captureTarget = mount.page;
        var cssWidth = captureTarget.offsetWidth || PDF_PAGE_WIDTH_PX;
        var cssHeight = captureTarget.scrollHeight || captureTarget.offsetHeight;
        return waitForImages(mount.root).then(function () {
          return new Promise(function (r) {
            setTimeout(r, 300);
          });
        }).then(function () {
          cssHeight = captureTarget.scrollHeight || captureTarget.offsetHeight;
          return captureRootToCanvas(captureTarget, cssText).then(function (canvas) {
            return { canvas: canvas, cssWidth: cssWidth, cssHeight: cssHeight, clientName: clientName };
          });
        });
      })
      .then(function (capture) {
        var canvas = capture.canvas;
        if (!canvas || canvas.width < 10 || canvas.height < 10) {
          throw new Error('La captura sali\u00f3 vac\u00eda. Prob\u00e1 de nuevo.');
        }
        return capture;
      })
      .finally(function () {
        cleanupExport(mount);
      });
  }

  function generateCostQuotePdf(data) {
    return renderCostQuotePdfCanvas(data).then(function (capture) {
      canvasToPdf(capture.canvas, safeFilename(capture.clientName), capture.cssWidth, capture.cssHeight);
    });
  }

  function generateCostQuotePdfBlob(data) {
    return renderCostQuotePdfCanvas(data).then(function (capture) {
      return {
        blob: canvasToPdfBlob(capture.canvas, capture.cssWidth, capture.cssHeight),
        filename: safeFilename(capture.clientName),
      };
    });
  }

  function computeGrandTotal(data) {
    var state = data.state;
    var result = data.result;
    if (!state || !result) return 0;
    var exp = state.export || {};
    var taxMode = resolveTaxMode(exp, data);
    var includeIva = taxMode === 'included';
    var wholesaleMode = !!(data.wholesaleMode || state.wholesaleMode);
    var designCost = sumResolvedDesignCosts(state, result);
    var items = buildLineItems(state, result, includeIva, wholesaleMode);
    var hasProductDiscount =
      (result.products || []).some(function (pr) {
        return Math.max(0, Number(pr.line && pr.line.discountPercent) || 0) > 0;
      });
    var useGrossDiscountLayout =
      !wholesaleMode &&
      (Math.max(0, Number(result.main && result.main.discountPercent) || 0) > 0 || hasProductDiscount);
    var summary = buildSummary(
      items,
      resolveQuoteShipping(exp),
      taxMode,
      wholesaleMode,
      designCost,
      useGrossDiscountLayout,
      result.main && result.main.globalDiscountAmount
    );
    return summary.grandTotal;
  }

  global.AdminCostQuotePdf = {
    generate: generateCostQuotePdf,
    generateBlob: generateCostQuotePdfBlob,
    computeGrandTotal: computeGrandTotal,
    buildLineItems: buildLineItems,
    buildSummary: buildSummary,
    buildFilename: safeFilename,
    withIva: withIva,
    extractIncludedIva: extractIncludedIva,
    normalizeTaxMode: normalizeTaxMode,
    resolveTaxMode: resolveTaxMode,
    applyTaxMode: applyTaxMode,
    normalizeShippingMode: normalizeShippingMode,
    resolveQuoteShipping: resolveQuoteShipping,
    resolveProductCostParams: resolveProductCostParams,
    fmtPdfMoney: fmtMoney,
    IVA_RATE: IVA_RATE,
  };
})(typeof window !== 'undefined' ? window : this);
