/**
 * PDF cotización — plantilla HTML Ninja Lab 3D + html2pdf.js
 */
(function (global) {
  'use strict';

  var PDF_PAGE_WIDTH_PX = 1080;
  var PX_TO_MM = 25.4 / 96;
  var IVA_RATE = 0.13;
  var LOGO_URL = '/images/logo-combo.png';
  var CSS_URL = '/css/cost-quote-pdf-template.css';
  var TRANSFER = {
    name: 'Luis Quijano Aguilar',
    cedula: '1-1461-0619',
    iban: 'CR85016111116160804858',
    sinpe: '8614 - 3452',
  };
  var BRAND = {
    phone: '(506) 7024-0270',
    web: 'www.ninjalab3d.com',
    email: 'lquijano@ninjalab3d.com',
  };
  var QUOTE_EMAILS = [
    'info@ninjalab3d.com',
    'lquijano@ninjalab3d.com',
    'badilla@ninjalab3d.com',
  ];

  function resolveQuoteEmail(state) {
    var exp = (state && state.export) || {};
    var raw = String(exp.quoteEmail || BRAND.email)
      .trim()
      .toLowerCase();
    if (QUOTE_EMAILS.indexOf(raw) !== -1) return raw;
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

  function withIva(amount, includeIva) {
    var base = roundMoney(amount);
    return includeIva ? roundMoney(base * (1 + IVA_RATE)) : base;
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
    return [1, 2, 3].map(function (i) {
      return normalizeAdditional(p['additional' + i]);
    });
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

  function getGrossUnitBeforeDiscount(state, product) {
    var p = product || getLegacyProduct(state);
    var c = state.costs;
    var additionals = sumAdditionalsAmount(p);
    var materialCost = ((Number(p.grams) || 0) / 1000) * (Number(c.kgPrice) || 0);
    var timeCost = (Number(p.printHours) || 0) * (Number(c.hourRate) || 0);
    var productionCost = materialCost + timeCost;
    var suggestedFull = roundMoney(
      productionCost * (1 + (Number(c.profitPercent) || 0) / 100) + additionals
    );
    if (p.salePriceTouched) {
      return roundMoney(Number(p.salePriceManual) || 0);
    }
    return suggestedFull;
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
    if (p.salePriceTouched) {
      return roundMoney(Number(p.salePriceManual) || 0);
    }
    return roundMoney(getGrossUnitBeforeDiscount(state, p) - additionals);
  }

  function computeWholesalePricing(state, product, quantity, discountPct, includeIva) {
    var grossPerUnit = getGrossUnitBeforeDiscount(state, product);
    var pct = Math.max(0, Math.min(100, Number(discountPct) || 0));
    var discountPerUnit = roundMoney(grossPerUnit * (pct / 100));
    var netPerUnit = roundMoney(grossPerUnit - discountPerUnit);
    var design = roundMoney(state.costs.designCost);
    var qty = Math.max(0, Math.round(Number(quantity) || 0));
    return {
      qty: qty,
      discountPerUnit: withIva(discountPerUnit, includeIva),
      netPerUnit: withIva(netPerUnit, includeIva),
      design: withIva(design, includeIva),
      total: withIva(netPerUnit * qty + design, includeIva),
    };
  }

  function buildLineItemsForProduct(state, product, line, includeIva, wholesaleMode, bullets) {
    var p = product;
    var m = line;
    var items = [];
    var qty = m.quantity;
    bullets = bullets || [];

    if (wholesaleMode) {
      var hiddenPerUnit = sumHiddenAdditionalsAmount(p);
      var productGross = roundMoney(getProductGrossUnit(state, p) + hiddenPerUnit);
      var tierPct = getTierDiscountPercent(state, qty, true);
      var productDiscount = roundMoney(productGross * (tierPct / 100));
      items.push({
        service: p.name || 'Impresi\u00f3n 3D',
        bullets: bullets.length ? bullets : ['Impresi\u00f3n 3D de alta calidad'],
        text: '',
        qty: qty,
        unitPrice: withIva(productGross, includeIva),
        discountPerUnit: withIva(productDiscount, includeIva),
        total: withIva(productGross * qty, includeIva),
      });

      getProductAdditionals(p).forEach(function (extra, idx) {
        if (!extra.showOnInvoice) return;
        var perUnit = roundMoney(extra.price);
        if (perUnit <= 0) return;
        var addDiscount = roundMoney(perUnit * (tierPct / 100));
        var label = String(extra.description || '').trim() || 'Servicio adicional ' + (idx + 1);
        items.push({
          service: label,
          bullets: [],
          text: String(extra.description || '').trim() || 'Servicio complementario',
          qty: qty,
          unitPrice: withIva(perUnit, includeIva),
          discountPerUnit: withIva(addDiscount, includeIva),
          total: withIva(perUnit * qty, includeIva),
        });
      });

      return items;
    }

    var visiblePerUnit = sumVisibleAdditionalsAmount(p);
    var baseSale = roundMoney(m.baseSale || m.suggestedPrice);
    var regularUnit = roundMoney(baseSale - visiblePerUnit);
    var manualPct = Math.max(0, Math.min(100, Number(m.discountPercent) || 0));
    var useGrossLayout = manualPct > 0;
    var bundleDiscPerUnit = useGrossLayout ? roundMoney(baseSale * (manualPct / 100)) : 0;

    if (useGrossLayout) {
      items.push({
        service: p.name || 'Impresi\u00f3n 3D',
        bullets: bullets.length ? bullets : ['Impresi\u00f3n 3D de alta calidad'],
        text: '',
        qty: qty,
        unitPrice: withIva(regularUnit, includeIva),
        discountPerUnit: withIva(bundleDiscPerUnit, includeIva),
        total: withIva(regularUnit * qty, includeIva),
      });
    } else {
      var tierPct2 = getTierDiscountPercent(state, qty, false);
      var tierDiscountPerUnit = tierPct2 > 0 ? roundMoney(regularUnit * (tierPct2 / 100)) : 0;
      var netUnit = roundMoney(regularUnit - tierDiscountPerUnit);
      if (!tierPct2) {
        netUnit = roundMoney(m.saleUnit - visiblePerUnit);
        tierDiscountPerUnit = 0;
      }

      items.push({
        service: p.name || 'Impresi\u00f3n 3D',
        bullets: bullets.length ? bullets : ['Impresi\u00f3n 3D de alta calidad'],
        text: '',
        qty: qty,
        unitPrice: withIva(regularUnit, includeIva),
        discountPerUnit: withIva(tierDiscountPerUnit, includeIva),
        total: withIva(netUnit * qty, includeIva),
      });
    }

    getProductAdditionals(p).forEach(function (extra, idx) {
      if (!extra.showOnInvoice) return;
      var perUnit = roundMoney(extra.price);
      if (perUnit <= 0) return;
      var q = qty;
      var label = String(extra.description || '').trim() || 'Servicio adicional ' + (idx + 1);
      items.push({
        service: label,
        bullets: [],
        text: String(extra.description || '').trim() || 'Servicio complementario',
        qty: q,
        unitPrice: withIva(perUnit, includeIva),
        discountPerUnit: 0,
        total: withIva(perUnit * q, includeIva),
      });
    });

    return items;
  }

  function buildLineItems(state, result, includeIva, wholesaleMode) {
    var items = [];
    var bullets = parseBullets(state.export && state.export.description);
    var productLines = (result && result.products) || [];
    if (!productLines.length) {
      productLines = [{ product: getLegacyProduct(state), line: result.main }];
    }
    productLines.forEach(function (pr, idx) {
      items = items.concat(
        buildLineItemsForProduct(
          state,
          pr.product,
          pr.line,
          includeIva,
          wholesaleMode,
          idx === 0 ? bullets : []
        )
      );
    });

    if (!wholesaleMode) {
      var design = roundMoney((state.costs && state.costs.designCost) || 0);
      if (design > 0) {
        items.push({
          service: 'Dise\u00f1o personalizado',
          bullets: [],
          text: 'Dise\u00f1o de modelo y adaptaci\u00f3n para impresi\u00f3n',
          qty: 1,
          unitPrice: withIva(design, includeIva),
          discountPerUnit: 0,
          total: withIva(design, includeIva),
        });
      }
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

  function buildSummary(items, shipping, includeIva, wholesaleMode, designCost, useGrossDiscountLayout, globalDiscountAmount) {
    var unitPriceSum = sumUnitPrices(items);
    var discountTotal = 0;
    items.forEach(function (it) {
      discountTotal += it.discountPerUnit * it.qty;
    });
    var shippingAmt = withIva(shipping, includeIva);
    var linesTotal = items.reduce(function (s, it) {
      return s + it.total;
    }, 0);
    var designAmt = wholesaleMode && designCost > 0 ? withIva(designCost, includeIva) : 0;
    var grossDiscount = wholesaleMode || !!useGrossDiscountLayout;
    var netLines = grossDiscount ? roundMoney(linesTotal - discountTotal) : linesTotal;
    var extraDesign = wholesaleMode ? designAmt : 0;
    var globalDiscAmt = withIva(Math.max(0, Number(globalDiscountAmount) || 0), includeIva);
    var grandTotal = grossDiscount
      ? netLines + extraDesign + shippingAmt
      : linesTotal + extraDesign + shippingAmt;
    if (globalDiscAmt > 0) {
      grandTotal = Math.max(0, roundMoney(grandTotal - globalDiscAmt));
    }
    var ivaDisplay = '—';
    if (includeIva) {
      var ivaPart = roundMoney(grandTotal - grandTotal / (1 + IVA_RATE));
      ivaDisplay = fmtMoney(ivaPart);
    }

    var breakdown = [];
    if (!wholesaleMode && designAmt > 0) {
      breakdown.push({ label: '* Dise\u00f1o personalizado', amount: designAmt });
    }
    if (shippingAmt > 0) {
      breakdown.push({ label: 'Env\u00edo', amount: shippingAmt });
    }
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
      designAmount: designAmt,
      ivaDisplay: ivaDisplay,
      grandTotal: grandTotal,
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
    if (!exp.includeIva) {
      notes.push({ icon: 'check', text: 'Precios no incluyen IVA ni costo de env\u00edo (salvo indicado).' });
    } else {
      notes.push({ icon: 'check', text: 'Precios incluyen IVA (' + Math.round(IVA_RATE * 100) + '%).' });
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
    var unitSum = sumUnitPrices(items);
    var grossSub = items.reduce(function (sum, it) {
      return sum + it.total;
    }, 0);
    var discSub = items.reduce(function (sum, it) {
      return sum + it.discountPerUnit * it.qty;
    }, 0);
    var lineQty = items.length ? Math.max(0, Math.round(Number(items[0].qty) || 0)) : 1;
    var showUnitSubtotal = lineQty > 1;
    var html = '<tfoot>';
    html +=
      '<tr class="quote-table-subtotal">' +
      '<td colspan="' +
      labelCols +
      '" class="subtotal-label"><strong>Subtotal</strong></td>' +
      '<td class="money">' +
      (showUnitSubtotal ? '<strong>' + fmtMoney(unitSum) + '</strong>' : '') +
      '</td>' +
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
    var fees =
      global.NLTilopayFees && typeof global.NLTilopayFees.computeTilopayPricing === 'function'
        ? global.NLTilopayFees.computeTilopayPricing(grandTotal)
        : null;
    if (!fees || fees.serviceFees <= 0) return '';
    return (
      '<div class="summary-tilopay-note">' +
      '<div class="summary-tilopay-note__total">Total con pago web: <strong>' +
      fmtMoney(fees.tilopayTotal) +
      '</strong></div></div>'
    );
  }

  function renderSummaryRows(summary, wholesaleMode, useGrossDiscountLayout) {
    var html = '';
    var grossLayout = wholesaleMode || !!useGrossDiscountLayout;
    if (grossLayout) {
      html +=
        '<div class="summary-row"><strong>Subtotal</strong><span>' +
        fmtMoney(summary.linesTotal) +
        '</span></div>';
      if (summary.discountTotal > 0) {
        html +=
          '<div class="summary-row"><strong>' +
          (wholesaleMode ? 'Descuento mayorista' : 'Descuento') +
          '</strong><span class="discount">' +
          fmtMoneyNeg(summary.discountTotal) +
          '</span></div>';
      }
    } else {
      if (summary.discountTotal > 0) {
        html +=
          '<div class="summary-row"><strong>Descuento</strong><span class="discount">' +
          fmtMoneyNeg(summary.discountTotal) +
          '</span></div>';
      }
      html +=
        '<div class="summary-row"><strong>Subtotal</strong><span>' +
        fmtMoney(summary.linesTotal) +
        '</span></div>';
    }
    summary.breakdown.forEach(function (row) {
      html +=
        '<div class="summary-row"><strong>' +
        escapeHtml(row.label) +
        '</strong><span>' +
        fmtMoney(row.amount) +
        '</span></div>';
    });
    html +=
      '<div class="summary-row"><strong>IVA</strong><span>' +
      summary.ivaDisplay +
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
    var includeIva = !!exp.includeIva;
    var wholesaleMode = !!(data.wholesaleMode || state.wholesaleMode);
    var designCost = roundMoney(state.costs.designCost);
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
      Number(exp.shippingCost) || 0,
      includeIva,
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
    var includeIva = data.includeIva != null ? !!data.includeIva : !!exp.includeIva;
    var wholesaleMode = !!(data.wholesaleMode || state.wholesaleMode);
    var designCost = roundMoney(state.costs && state.costs.designCost);
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
      Number(exp.shippingCost) || 0,
      includeIva,
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
    buildFilename: safeFilename,
    withIva: withIva,
    fmtPdfMoney: fmtMoney,
    IVA_RATE: IVA_RATE,
  };
})(typeof window !== 'undefined' ? window : this);
