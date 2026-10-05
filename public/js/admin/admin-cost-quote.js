/**
 * Admin — Cotización costo 3D (basado en hoja Excel Ninja Lab).
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'nl-admin-cost-quote-v1';
  var CATALOG_STORAGE_KEY = 'nl-admin-cost-quote-catalog-v1';
  var QUOTE_EMAILS = [
    { value: 'info@ninjalab3d.com', label: 'info@ninjalab3d.com' },
    { value: 'lquijano@ninjalab3d.com', label: 'lquijano@ninjalab3d.com' },
    { value: 'badilla@ninjalab3d.com', label: 'badilla@ninjalab3d.com' },
  ];

  var DEFAULT_PRODUCT = {
    name: 'Copa Mundial',
    quantity: 2,
    grams: 385,
    printHours: 14.5,
    qtyInputMode: 'unit',
    additionals: [],
    salePriceManual: 0,
    salePriceTouched: false,
    saleDiscountEnabled: false,
    saleDiscountPercent: 0,
  };

  var DEFAULTS = {
    costs: {
      hourRate: 300,
      designCost: 0,
      kgPrice: 20500,
      profitPercent: 100,
      printerId: '',
      materialId: '',
    },
    discounts: {
      range10_50: 5,
      range50_100: 10,
      range100plus: 15,
    },
    discountRanges: {
      range10_50: { min: 10, max: 50 },
      range50_100: { min: 50, max: 100 },
      range100plus: { min: 100, max: null },
    },
    alexPercent: 30,
    luisPercent: 70,
    globalDiscount: {
      enabled: false,
      percent: 0,
    },
    scenarioQty: {
      range10_50: 12,
      range50_100: 50,
      range100plus: 200,
    },
    export: {
      clientName: '',
      clientEmail: '',
      clientPhone: '',
      orderTitle: '',
      description: '',
      deliveryDays: 5,
      validDays: 15,
      shippingCost: 0,
      paymentTerms: 'Forma de pago: 50% de adelanto y 50% contra entrega.',
      warranty: 'Garantía: 3 meses por defectos de fabricación.',
      extraNotes: '',
      includeIva: false,
      quoteEmail: 'lquijano@ninjalab3d.com',
    },
    wholesaleMode: false,
  };

  var savedQuotes = [];
  var catalog = { additionals: [], printers: [], materials: [] };
  var catalogApiAvailable = true;
  var activePanel = 'quote';
  var mounted = false;
  var partnerMode = false;
  var state = loadState();
  var currentSavedQuoteId = '';
  var workflowMeta = { status: 'pendiente', linkedOrderId: '', clientEmail: '' };
  var pdfReadyInSession = false;
  var costBreakdownOpenByProduct = {};
  var productIdSeq = 1;
  var WORKFLOW_LABELS = {
    pendiente: 'Pendiente',
    enviada: 'Enviada',
    pendiente_aprobacion: 'Pendiente aprobación',
    aprobada: 'Aprobada',
    sin_respuesta: 'Sin respuesta',
    cancelada: 'Cancelada',
  };

  function newProductId() {
    productIdSeq += 1;
    return 'p' + Date.now().toString(36) + productIdSeq;
  }

  function defaultProduct(overrides) {
    var p = deepClone(DEFAULT_PRODUCT);
    p.id = newProductId();
    return mergeDeep(p, overrides || {});
  }

  function ensureProducts(state) {
    if (!state) return [];
    if (Array.isArray(state.products) && state.products.length) {
      state.products.forEach(migrateProduct);
      return state.products;
    }
    if (state.product && typeof state.product === 'object') {
      var legacy = migrateProduct(deepClone(state.product));
      if (!legacy.id) legacy.id = newProductId();
      state.products = [legacy];
      if (state.alexPercent === undefined && legacy.alexPercent !== undefined) {
        state.alexPercent = legacy.alexPercent;
      }
      delete state.product;
    } else {
      state.products = [defaultProduct()];
    }
    if (state.alexPercent === undefined) state.alexPercent = DEFAULTS.alexPercent;
    state.alexPercent = Math.max(0, Math.min(100, num(state.alexPercent, DEFAULTS.alexPercent)));
    state.luisPercent = Math.max(0, Math.min(100, 100 - state.alexPercent));
    if (!state.globalDiscount) state.globalDiscount = deepClone(DEFAULTS.globalDiscount);
    if (state.globalDiscount.enabled === undefined) state.globalDiscount.enabled = false;
    if (state.globalDiscount.percent === undefined) state.globalDiscount.percent = 0;
    return state.products;
  }

  function getQuoteDisplayName(state) {
    ensureProducts(state);
    var names = state.products
      .map(function (p) {
        return String(p.name || '').trim();
      })
      .filter(Boolean);
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    return names[0] + ' +' + (names.length - 1) + ' más';
  }

  function isDefaultProduct(p, idx) {
    if (!p || idx !== 0) return false;
    var d = DEFAULT_PRODUCT;
    if (String(p.name || '').trim() !== d.name) return false;
    if (num(p.quantity) !== d.quantity) return false;
    if (num(p.grams) !== d.grams) return false;
    if (num(p.printHours) !== d.printHours) return false;
    if (p.salePriceTouched) return false;
    if (getProductAdditionals(p).some(function (a) {
      return !isEmptyAdditional(a);
    })) {
      return false;
    }
    return true;
  }

  function isRestrictedPartner() {
    return partnerMode;
  }

  function getSubnavTabs() {
    var tabs = [
      { id: 'quote', label: 'Cotización' },
      { id: 'additionals', label: 'Adicionales' },
    ];
    if (!isRestrictedPartner()) {
      tabs.push({ id: 'printers', label: 'Impresoras' }, { id: 'materials', label: 'Materiales' });
    }
    return tabs;
  }

  function printerOptionLabel(printer) {
    return isRestrictedPartner() ? printer.name : printer.name + ' — ' + fmtCrc(printer.hourRate) + '/h';
  }

  function materialOptionLabel(material) {
    return isRestrictedPartner() ? material.name : material.name + ' — ' + fmtCrc(material.kgPrice) + '/kg';
  }

  function isResinaName(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .indexOf('resina') === 0;
  }

  function getPrinterById(printerId) {
    return catalog.printers.find(function (p) {
      return p.id === printerId;
    });
  }

  function materialsForPrinter(printer) {
    var list = catalog.materials || [];
    if (!printer) return list;
    var resinPrinter = isResinaName(printer.name);
    return list.filter(function (m) {
      var resinMaterial = isResinaName(m.name);
      return resinPrinter ? resinMaterial : !resinMaterial;
    });
  }

  function resolvePrinterSelection(costs) {
    var c = costs || {};
    return (
      catalog.printers.find(function (p) {
        return p.id === c.printerId;
      }) ||
      catalog.printers.find(function (p) {
        return num(p.hourRate) === num(c.hourRate);
      }) ||
      catalog.printers[0] ||
      null
    );
  }

  function resolveMaterialSelection(costs, printer) {
    var c = costs || {};
    var allowed = materialsForPrinter(printer);
    if (!allowed.length) return null;
    return (
      allowed.find(function (m) {
        return m.id === c.materialId;
      }) ||
      allowed.find(function (m) {
        return num(m.kgPrice) === num(c.kgPrice);
      }) ||
      allowed[0]
    );
  }

  function normalizeQuoteEmail(email) {
    var v = String(email || '')
      .trim()
      .toLowerCase();
    var allowed = QUOTE_EMAILS.map(function (o) {
      return o.value;
    });
    if (allowed.indexOf(v) !== -1) return v;
    return QUOTE_EMAILS[1].value;
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function fmtCrc(n) {
    var v = Math.round(Number(n) || 0);
    try {
      return new Intl.NumberFormat('es-CR', {
        style: 'currency',
        currency: 'CRC',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(v);
    } catch (e) {
      return '₡' + v.toLocaleString('es-CR');
    }
  }

  function fmtQuoteDate(ts) {
    return new Date(Number(ts) || Date.now()).toLocaleString('es-CR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  }

  function num(v, fallback) {
    var n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback || 0;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = opts.headers || {};
    var token =
      document.querySelector('meta[name="csrf-token"]')?.content ||
      document.querySelector('input[name="_csrf"]')?.value ||
      '';
    opts.headers['x-csrf-token'] = token;
    if (opts.body && typeof opts.body === 'object') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (text) {
        var data = {};
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (e) {
            var err = new Error(
              'La API no respondió correctamente. Reiniciá o desplegá el servidor con la última versión.'
            );
            err.apiUnavailable = true;
            throw err;
          }
        }
        if (!r.ok) {
          var httpErr = new Error((data && data.error) || 'Error de servidor');
          httpErr.fromApi = true;
          throw httpErr;
        }
        return data;
      });
    }).catch(function (e) {
      if (e.apiUnavailable || e.fromApi) throw e;
      var err = new Error('No se pudo conectar con el servidor.');
      err.apiUnavailable = true;
      throw err;
    });
  }

  function defaultCatalog() {
    return {
      additionals: [],
      printers: [{ id: 'printer-default', name: 'Impresora principal', hourRate: 300 }],
      materials: [{ id: 'material-default', name: 'PLA estándar', kgPrice: 20500 }],
    };
  }

  function loadCatalogLocal() {
    try {
      var raw = localStorage.getItem(CATALOG_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        return {
          additionals: Array.isArray(parsed.additionals) ? parsed.additionals : [],
          printers: Array.isArray(parsed.printers) ? parsed.printers : [],
          materials: Array.isArray(parsed.materials) ? parsed.materials : [],
        };
      }
    } catch (e) { /* ignore */ }
    return defaultCatalog();
  }

  function saveCatalogLocal(data) {
    try {
      localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }

  function newLocalId(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function upsertAdditionalLocal(body) {
    var editId = String((body && body.id) || '').trim();
    var description = String((body && body.description) || '').trim();
    var price = Math.max(0, Math.round(num(body && body.price)));
    if (!description) return { ok: false, error: 'Indicá la descripción del adicional.' };
    var item = { id: editId || newLocalId('add'), description: description, price: price };
    var next = deepClone(catalog);
    if (editId) {
      var idx = next.additionals.findIndex(function (a) {
        return a.id === editId;
      });
      if (idx === -1) return { ok: false, error: 'Adicional no encontrado.' };
      next.additionals[idx] = item;
    } else {
      next.additionals.push(item);
    }
    catalog = next;
    saveCatalogLocal(catalog);
    syncCostSelections(state);
    return { ok: true, catalog: catalog, item: item };
  }

  function deleteAdditionalLocal(id) {
    var next = deepClone(catalog);
    var before = next.additionals.length;
    next.additionals = next.additionals.filter(function (a) {
      return a.id !== String(id || '').trim();
    });
    if (next.additionals.length === before) return { ok: false, error: 'Adicional no encontrado.' };
    catalog = next;
    saveCatalogLocal(catalog);
    return { ok: true, catalog: catalog };
  }

  function upsertPrinterLocal(body) {
    var editId = String((body && body.id) || '').trim();
    var name = String((body && body.name) || '').trim();
    var hourRate = Math.max(0, Math.round(num(body && body.hourRate)));
    if (!name) return { ok: false, error: 'Indicá el nombre de la impresora.' };
    var item = { id: editId || newLocalId('printer'), name: name, hourRate: hourRate };
    var next = deepClone(catalog);
    if (editId) {
      var idx = next.printers.findIndex(function (p) {
        return p.id === editId;
      });
      if (idx === -1) return { ok: false, error: 'Impresora no encontrada.' };
      next.printers[idx] = item;
    } else {
      next.printers.push(item);
    }
    catalog = next;
    saveCatalogLocal(catalog);
    syncCostSelections(state);
    return { ok: true, catalog: catalog, item: item };
  }

  function deletePrinterLocal(id) {
    var pid = String(id || '').trim();
    if (catalog.printers.length <= 1) return { ok: false, error: 'Debe quedar al menos una impresora.' };
    var next = deepClone(catalog);
    var before = next.printers.length;
    next.printers = next.printers.filter(function (p) {
      return p.id !== pid;
    });
    if (next.printers.length === before) return { ok: false, error: 'Impresora no encontrada.' };
    catalog = next;
    saveCatalogLocal(catalog);
    syncCostSelections(state);
    return { ok: true, catalog: catalog };
  }

  function upsertMaterialLocal(body) {
    var editId = String((body && body.id) || '').trim();
    var name = String((body && body.name) || '').trim();
    var kgPrice = Math.max(0, Math.round(num(body && body.kgPrice)));
    if (!name) return { ok: false, error: 'Indicá el nombre del material.' };
    var item = { id: editId || newLocalId('material'), name: name, kgPrice: kgPrice };
    var next = deepClone(catalog);
    if (editId) {
      var idx = next.materials.findIndex(function (m) {
        return m.id === editId;
      });
      if (idx === -1) return { ok: false, error: 'Material no encontrado.' };
      next.materials[idx] = item;
    } else {
      next.materials.push(item);
    }
    catalog = next;
    saveCatalogLocal(catalog);
    syncCostSelections(state);
    return { ok: true, catalog: catalog, item: item };
  }

  function deleteMaterialLocal(id) {
    var mid = String(id || '').trim();
    if (catalog.materials.length <= 1) return { ok: false, error: 'Debe quedar al menos un material.' };
    var next = deepClone(catalog);
    var before = next.materials.length;
    next.materials = next.materials.filter(function (m) {
      return m.id !== mid;
    });
    if (next.materials.length === before) return { ok: false, error: 'Material no encontrado.' };
    catalog = next;
    saveCatalogLocal(catalog);
    syncCostSelections(state);
    return { ok: true, catalog: catalog };
  }

  function saveCatalogViaApi(path, body, localFn) {
    return api(path, { method: 'POST', body: body })
      .then(function (data) {
        catalogApiAvailable = true;
        applyCatalogResponse(data);
        if (data.catalog) saveCatalogLocal(data.catalog);
        return { data: data, localFallback: false };
      })
      .catch(function (e) {
        if (!e.apiUnavailable && catalogApiAvailable) throw e;
        catalogApiAvailable = false;
        var r = localFn(body);
        if (!r.ok) throw new Error(r.error);
        return { data: r, localFallback: true };
      });
  }

  function deleteCatalogViaApi(path, id, localFn) {
    return api(path + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (data) {
        catalogApiAvailable = true;
        applyCatalogResponse(data);
        if (data.catalog) saveCatalogLocal(data.catalog);
        return { data: data, localFallback: false };
      })
      .catch(function (e) {
        if (!e.apiUnavailable && catalogApiAvailable) throw e;
        catalogApiAvailable = false;
        var r = localFn(id);
        if (!r.ok) throw new Error(r.error);
        return { data: r, localFallback: true };
      });
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return migrateState(deepClone(DEFAULTS));
      return migrateState(mergeDeep(deepClone(DEFAULTS), JSON.parse(raw)));
    } catch (e) {
      return migrateState(deepClone(DEFAULTS));
    }
  }

  function defaultAdditional() {
    return { price: 0, description: '', showOnInvoice: true };
  }

  function isEmptyAdditional(a) {
    return !num(a.price) && !String(a.description || '').trim();
  }

  function normalizeAdditional(v) {
    if (v && typeof v === 'object') {
      return {
        price: num(v.price),
        description: String(v.description || ''),
        showOnInvoice: v.showOnInvoice !== false,
      };
    }
    return { price: num(v), description: '', showOnInvoice: true };
  }

  function getProductAdditionals(p) {
    if (!p) return [];
    if (Array.isArray(p.additionals)) {
      return p.additionals.map(normalizeAdditional);
    }
    var legacy = [1, 2, 3].map(function (i) {
      return normalizeAdditional(p['additional' + i]);
    });
    return legacy.filter(function (a) {
      return !isEmptyAdditional(a);
    });
  }

  function pruneEmptyAdditionals(products) {
    (products || []).forEach(function (prod) {
      if (!Array.isArray(prod.additionals)) return;
      prod.additionals = prod.additionals.filter(function (a) {
        return !isEmptyAdditional(a);
      });
    });
  }

  function getProductQty(p) {
    return Math.max(1, num(p && p.quantity, 1));
  }

  function isTotalQtyInputMode(p) {
    return getProductQty(p) > 1 && p.qtyInputMode === 'total';
  }

  function gramsDisplayValue(p) {
    var qty = getProductQty(p);
    var grams = num(p.grams);
    return isTotalQtyInputMode(p) ? grams * qty : grams;
  }

  function printHoursDisplayValue(p) {
    var qty = getProductQty(p);
    var hours = num(p.printHours);
    return isTotalQtyInputMode(p) ? hours * qty : hours;
  }

  function gramsLabelForProduct(p) {
    return isTotalQtyInputMode(p) ? 'Gramos totales' : 'Gramos por unidad';
  }

  function printHoursLabelForProduct(p) {
    return isTotalQtyInputMode(p) ? 'Horas totales de impresión' : 'Horas de impresión';
  }

  function stripLegacyAdditionals(p) {
    if (!p || typeof p !== 'object') return;
    delete p.additional1;
    delete p.additional2;
    delete p.additional3;
  }

  function resetQuoteProductForNew(opts) {
    opts = opts || {};
    var keepNames = !!opts.keepProductName;
    var firstName = keepNames && state.products && state.products[0]
      ? String(state.products[0].name || '').trim()
      : '';
    state.products = [defaultProduct(firstName ? { name: firstName } : {})];
    state.alexPercent = DEFAULTS.alexPercent;
    state.luisPercent = DEFAULTS.luisPercent;
    state.globalDiscount = deepClone(DEFAULTS.globalDiscount);
    if (opts.resetExport) {
      state.export = deepClone(DEFAULTS.export);
    }
    currentSavedQuoteId = '';
    workflowMeta = { status: 'pendiente', linkedOrderId: '', clientEmail: '' };
    pdfReadyInSession = false;
    costBreakdownOpenByProduct = {};
    saveStateLocal(state);
  }

  function hasQuoteWorkInProgress(root) {
    if (root) state = readStateFromDom(root, state);
    ensureProducts(state);
    var exp = state.export || {};
    if (currentSavedQuoteId) return true;
    if (state.products.length > 1) return true;
    var p = state.products[0];
    if (
      getProductAdditionals(p).some(function (a) {
        return !isEmptyAdditional(a);
      })
    ) {
      return true;
    }
    if (String(exp.clientName || '').trim() || String(exp.clientEmail || '').trim()) return true;
    if (String(exp.clientPhone || '').trim()) return true;
    if (String(exp.orderTitle || '').trim() || String(exp.description || '').trim()) return true;
    if (String(exp.extraNotes || '').trim()) return true;
    if (!isDefaultProduct(p, 0)) return true;
    if (state.globalDiscount && state.globalDiscount.enabled) return true;
    if (num(state.alexPercent) !== DEFAULTS.alexPercent) return true;
    if (exp.includeIva !== DEFAULTS.export.includeIva) return true;
    if (num(exp.deliveryDays) !== DEFAULTS.export.deliveryDays) return true;
    if (num(exp.validDays) !== DEFAULTS.export.validDays) return true;
    if (num(exp.shippingCost) !== DEFAULTS.export.shippingCost) return true;
    if (String(exp.paymentTerms || '') !== DEFAULTS.export.paymentTerms) return true;
    if (String(exp.warranty || '') !== DEFAULTS.export.warranty) return true;
    return false;
  }

  function confirmLeaveQuoteWorkflow(root) {
    if (!hasQuoteWorkInProgress(root)) {
      return Promise.resolve(true);
    }
    if (
      window.confirm(
        'Hay datos sin guardar en la cotización 3D.\n\n¿Deseás guardar la cotización antes de salir?\n\nCancelar para seguir editando.'
      )
    ) {
      return saveCurrentQuote(root).then(function () {
        return true;
      });
    }
    return Promise.resolve(false);
  }

  function startFreshQuote(root) {
    resetQuoteProductForNew({ keepProductName: false, resetExport: true });
    activePanel = 'quote';
    var sel = $('#cq-history-select', root);
    if (sel) sel.value = '';
    refresh(root, true);
  }

  function migrateProduct(p) {
    if (!p) return defaultProduct();
    if (!p.id) p.id = newProductId();
    stripLegacyAdditionals(p);
    if (!Array.isArray(p.additionals)) {
      p.additionals = getProductAdditionals(p);
    } else {
      p.additionals = p.additionals.map(normalizeAdditional);
    }
    if (p.qtyInputMode !== 'total') p.qtyInputMode = 'unit';
    if (getProductQty(p) <= 1) p.qtyInputMode = 'unit';
    if (p.saleDiscountEnabled === undefined) p.saleDiscountEnabled = false;
    if (p.saleDiscountPercent === undefined) p.saleDiscountPercent = 0;
    return p;
  }

  function migrateState(s) {
    if (s.wholesaleMode === undefined) s.wholesaleMode = false;
    if (!s.costs) s.costs = {};
    if (s.costs.printerId === undefined) s.costs.printerId = '';
    if (s.costs.materialId === undefined) s.costs.materialId = '';
    if (!s.discountRanges) {
      s.discountRanges = deepClone(DEFAULTS.discountRanges);
    } else {
      ['range10_50', 'range50_100', 'range100plus'].forEach(function (key) {
        if (!s.discountRanges[key]) {
          s.discountRanges[key] = deepClone(DEFAULTS.discountRanges[key]);
        }
      });
    }
    ensureProducts(s);
    if (!s.export) s.export = deepClone(DEFAULTS.export);
    if (!s.export.quoteEmail) s.export.quoteEmail = DEFAULTS.export.quoteEmail;
    if (s.export.clientPhone === undefined) s.export.clientPhone = '';
    s.export.quoteEmail = normalizeQuoteEmail(s.export.quoteEmail);
    return s;
  }

  function getDiscountRanges(state) {
    var dr = (state && state.discountRanges) || {};
    var defs = DEFAULTS.discountRanges;
    return {
      range10_50: {
        min: Math.max(1, num(dr.range10_50 && dr.range10_50.min, defs.range10_50.min)),
        max: Math.max(1, num(dr.range10_50 && dr.range10_50.max, defs.range10_50.max)),
      },
      range50_100: {
        min: Math.max(1, num(dr.range50_100 && dr.range50_100.min, defs.range50_100.min)),
        max: Math.max(1, num(dr.range50_100 && dr.range50_100.max, defs.range50_100.max)),
      },
      range100plus: {
        min: Math.max(1, num(dr.range100plus && dr.range100plus.min, defs.range100plus.min)),
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
    qty = num(qty);
    if (qty >= r.range100plus.min) return num(d.range100plus);
    if (qty >= r.range50_100.min) return num(d.range50_100);
    if (qty >= r.range10_50.min) return num(d.range10_50);
    return 0;
  }

  function syncCostSelections(st) {
    if (!catalog.printers.length && !catalog.materials.length) return st;
    var c = st.costs;
    var printer = resolvePrinterSelection(c);
    var material = resolveMaterialSelection(c, printer);
    if (printer) {
      c.printerId = printer.id;
      c.hourRate = num(printer.hourRate);
    }
    if (material) {
      c.materialId = material.id;
      c.kgPrice = num(material.kgPrice);
    }
    return st;
  }

  function getEffectiveCosts(st) {
    var c = st.costs || {};
    var printer = resolvePrinterSelection(c);
    var material = resolveMaterialSelection(c, printer);
    return {
      hourRate: printer ? num(printer.hourRate) : num(c.hourRate, 300),
      kgPrice: material ? num(material.kgPrice) : num(c.kgPrice, 20500),
      designCost: num(c.designCost),
      profitPercent: num(c.profitPercent),
      printerId: printer ? printer.id : c.printerId,
      materialId: material ? material.id : c.materialId,
    };
  }

  function saveStateLocal(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function mergeDeep(base, patch) {
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
        base[k] = mergeDeep(base[k] || {}, patch[k]);
      } else if (patch[k] !== undefined) {
        base[k] = patch[k];
      }
    });
    return base;
  }

  function sumAdditionals(p) {
    return getProductAdditionals(p).reduce(function (sum, a) {
      return sum + num(a.price);
    }, 0);
  }

  function sumVisibleAdditionals(p) {
    return getProductAdditionals(p).reduce(function (sum, a) {
      return sum + (a.showOnInvoice ? num(a.price) : 0);
    }, 0);
  }

  function syncSalePriceFromSuggested(state, product) {
    var qty = Math.max(1, num(product.quantity, 1));
    var main = computeLine(state, product, qty, 0);
    if (!product.salePriceTouched) {
      product.salePriceManual = Math.round(main.suggestedPrice);
    }
    return main;
  }

  function updateSalePriceTouchedFromDom(root, st, productIdx) {
    var saleEl = $('#cq-salePrice-' + productIdx, root);
    if (!saleEl) return;
    var result = computeAll(st);
    var pr = result.products[productIdx];
    if (!pr) return;
    var suggested = Math.round(pr.line.suggestedPrice);
    var entered = num(saleEl.value);
    pr.product.salePriceTouched = entered !== suggested;
    if (!pr.product.salePriceTouched) {
      pr.product.salePriceManual = suggested;
    }
  }

  function computeLine(state, product, quantity, discountPercent) {
    var c = getEffectiveCosts(state);
    var p = product;
    var qty = Math.max(0, num(quantity, 0));
    var materialCost = (num(p.grams) / 1000) * num(c.kgPrice);
    var timeCost = num(p.printHours) * num(c.hourRate);
    var additionalsCost = sumAdditionals(p);
    var productionCost = materialCost + timeCost;
    var unitCost = productionCost + additionalsCost;
    var totalCost = unitCost * qty;
    var suggestedPrice = Math.round(
      productionCost * (1 + num(c.profitPercent) / 100) + additionalsCost
    );
    var baseSale = p.salePriceTouched ? num(p.salePriceManual) : suggestedPrice;
    var discount = Math.max(0, Math.min(100, num(discountPercent)));
    var saleUnit = baseSale * (1 - discount / 100);
    var netUnit = saleUnit - unitCost;
    var netTotal = netUnit * qty;
    var alexPct = num(state.alexPercent, DEFAULTS.alexPercent);
    var luisPct = num(state.luisPercent, DEFAULTS.luisPercent);
    return {
      quantity: qty,
      materialCost: materialCost,
      timeCost: timeCost,
      unitCost: unitCost,
      totalCost: totalCost,
      suggestedPrice: suggestedPrice,
      suggestedTotal: suggestedPrice * qty,
      saleUnit: saleUnit,
      baseSale: baseSale,
      discountPercent: discount,
      netUnit: netUnit,
      netTotal: netTotal,
      alexUnitShare: netUnit * (alexPct / 100),
      luisUnitShare: netUnit * (luisPct / 100),
      alexShare: netTotal * (alexPct / 100),
      luisShare: netTotal * (luisPct / 100),
      designCost: 0,
      clientTotal: saleUnit * qty,
    };
  }

  function aggregateMain(state, productResults) {
    var c = getEffectiveCosts(state);
    var designCost = num(c.designCost);
    var subtotalGross = productResults.reduce(function (s, pr) {
      return s + pr.line.saleUnit * pr.line.quantity;
    }, 0);
    var suggestedTotal = productResults.reduce(function (s, pr) {
      return s + pr.line.suggestedPrice * pr.line.quantity;
    }, 0);
    var globalDisc =
      !state.wholesaleMode && state.globalDiscount && state.globalDiscount.enabled
        ? Math.max(0, Math.min(100, num(state.globalDiscount.percent)))
        : 0;
    var globalDiscAmount = Math.round(subtotalGross * (globalDisc / 100));
    var subtotalAfterGlobal = subtotalGross - globalDiscAmount;
    var totalQty = productResults.reduce(function (s, pr) {
      return s + pr.line.quantity;
    }, 0);
    var netTotalBeforeGlobal = productResults.reduce(function (s, pr) {
      return s + pr.line.netTotal;
    }, 0);
    var netAfterGlobal = netTotalBeforeGlobal - Math.round(netTotalBeforeGlobal * (globalDisc / 100));
    var alexPct = num(state.alexPercent, DEFAULTS.alexPercent);
    var luisPct = num(state.luisPercent, DEFAULTS.luisPercent);
    return {
      quantity: totalQty,
      productCount: productResults.length,
      suggestedPrice: productResults.length === 1 ? productResults[0].line.suggestedPrice : 0,
      suggestedTotal: suggestedTotal,
      suggestedUnitAvg: totalQty > 0 ? Math.round(suggestedTotal / totalQty) : 0,
      saleUnit: totalQty > 0 ? Math.round(subtotalAfterGlobal / totalQty) : 0,
      saleTotal: subtotalAfterGlobal,
      baseSale: productResults.length === 1 ? productResults[0].line.baseSale : subtotalGross,
      subtotalGross: subtotalGross,
      discountPercent: globalDisc,
      globalDiscountAmount: globalDiscAmount,
      clientTotal: subtotalAfterGlobal + designCost,
      designCost: designCost,
      netTotal: netAfterGlobal,
      netUnit: totalQty > 0 ? netAfterGlobal / totalQty : 0,
      alexUnitShare: totalQty > 0 ? (netAfterGlobal * (alexPct / 100)) / totalQty : 0,
      luisUnitShare: totalQty > 0 ? (netAfterGlobal * (luisPct / 100)) / totalQty : 0,
      alexShare: netAfterGlobal * (alexPct / 100) + designCost,
      luisShare: netAfterGlobal * (luisPct / 100),
      materialCost: productResults.reduce(function (s, pr) {
        return s + pr.line.materialCost;
      }, 0),
      timeCost: productResults.reduce(function (s, pr) {
        return s + pr.line.timeCost;
      }, 0),
      unitCost: productResults.reduce(function (s, pr) {
        return s + pr.line.unitCost;
      }, 0),
      totalCost: productResults.reduce(function (s, pr) {
        return s + pr.line.totalCost;
      }, 0),
    };
  }

  function aggregateScenarioLine(state, productResults, discountPct) {
    var subtotal = 0;
    var totalCost = 0;
    var qty = 0;
    var netTotal = 0;
    productResults.forEach(function (pr) {
      var l = computeLine(state, pr.product, pr.product.quantity, discountPct);
      subtotal += l.saleUnit * l.quantity;
      totalCost += l.totalCost;
      netTotal += l.netTotal;
      qty += l.quantity;
    });
    var designCost = num(getEffectiveCosts(state).designCost);
    var alexPct = num(state.alexPercent, DEFAULTS.alexPercent);
    var luisPct = num(state.luisPercent, DEFAULTS.luisPercent);
    return {
      clientTotal: subtotal + designCost,
      quantity: qty,
      saleUnit: qty > 0 ? Math.round(subtotal / qty) : subtotal,
      baseSale: subtotal,
      suggestedPrice: subtotal,
      netTotal: netTotal,
      netUnit: qty > 0 ? netTotal / qty : 0,
      alexUnitShare: qty > 0 ? (netTotal * (alexPct / 100)) / qty : 0,
      luisUnitShare: qty > 0 ? (netTotal * (luisPct / 100)) / qty : 0,
      alexShare: netTotal * (alexPct / 100),
      luisShare: netTotal * (luisPct / 100),
      designCost: designCost,
    };
  }

  function computeAll(state) {
    ensureProducts(state);
    var d = state.discounts;
    var ranges = getDiscountRanges(state);
    var totalQty = state.products.reduce(function (s, p) {
      return s + num(p.quantity);
    }, 0);
    var wholesaleTier = state.wholesaleMode ? getTierDiscountPercent(state, totalQty, true) : 0;
    var productResults = state.products.map(function (prod) {
      var qty = Math.max(1, num(prod.quantity, 1));
      var disc = 0;
      if (state.wholesaleMode) {
        disc = wholesaleTier;
      } else if (prod.saleDiscountEnabled) {
        disc = Math.max(0, Math.min(100, num(prod.saleDiscountPercent)));
      }
      if (!prod.salePriceTouched) {
        syncSalePriceFromSuggested(state, prod);
      }
      var line = computeLine(state, prod, qty, disc);
      return { product: prod, line: line };
    });
    var main = aggregateMain(state, productResults);
    var scenarioDefs = [
      { key: 'range10_50', discount: num(d.range10_50) },
      { key: 'range50_100', discount: num(d.range50_100) },
      { key: 'range100plus', discount: num(d.range100plus) },
    ];
    return {
      products: productResults,
      main: main,
      scenarios: scenarioDefs.map(function (def) {
        var range = ranges[def.key];
        return {
          key: def.key,
          range: range,
          label: formatRangeLabel(range, def.key),
          discount: def.discount,
          line: aggregateScenarioLine(state, productResults, def.discount),
        };
      }),
    };
  }

  function selectHtml(id, label, value, options, opts) {
    opts = opts || {};
    var compact = opts.compact ? ' cq-field--compact' : '';
    var optsHtml = (options || [])
      .map(function (o) {
        return (
          '<option value="' +
          escapeHtml(o.value) +
          '"' +
          (String(o.value) === String(value) ? ' selected' : '') +
          '>' +
          escapeHtml(o.label) +
          '</option>'
        );
      })
      .join('');
    return (
      '<label class="cq-field cq-field--input' +
      compact +
      '">' +
      '<span class="cq-field__label">' +
      escapeHtml(label) +
      '</span>' +
      '<select id="' +
      id +
      '" class="cq-select" data-cq-field="' +
      id +
      '">' +
      optsHtml +
      '</select></label>'
    );
  }

  function inputHtml(id, label, value, opts) {
    opts = opts || {};
    var type = opts.type || 'number';
    var compact = opts.compact ? ' cq-field--compact' : '';
    var step = opts.step != null ? ' step="' + opts.step + '"' : '';
    var min = opts.min != null ? ' min="' + opts.min + '"' : '';
    var max = opts.max != null ? ' max="' + opts.max + '"' : '';
    var ph = opts.placeholder ? ' placeholder="' + escapeHtml(opts.placeholder) + '"' : '';
    var fieldAttr = opts.noCommit ? '' : ' data-cq-field="' + id + '"';
    return (
      '<label class="cq-field cq-field--input' +
      compact +
      '">' +
      '<span class="cq-field__label">' +
      escapeHtml(label) +
      '</span>' +
      '<input type="' +
      type +
      '" id="' +
      id +
      '"' +
      fieldAttr +
      ' value="' +
      escapeHtml(value) +
      '"' +
      step +
      min +
      max +
      ph +
      ' />' +
      '</label>'
    );
  }

  function resultHtml(label, value, mod) {
    return (
      '<div class="cq-result' +
      (mod ? ' cq-result--' + mod : '') +
      '"><span class="cq-result__label">' +
      escapeHtml(label) +
      '</span><span class="cq-result__value">' +
      escapeHtml(value) +
      '</span></div>'
    );
  }

  function profitShareHtml(label, unitAmount, totalAmount, qty, mod) {
    var q = Math.max(0, Math.round(Number(qty) || 0));
    if (q <= 1) {
      return resultHtml(label, fmtCrc(totalAmount), mod);
    }
    return (
      '<div class="cq-result' +
      (mod ? ' cq-result--' + mod : '') +
      '"><span class="cq-result__label">' +
      escapeHtml(label) +
      '</span><span class="cq-result__value cq-result__value--stack">' +
      '<span class="cq-result__line"><span class="cq-result__line-label">Por unidad</span> ' +
      escapeHtml(fmtCrc(unitAmount)) +
      '</span>' +
      '<span class="cq-result__line"><span class="cq-result__line-label">Por cantidad</span> <strong>' +
      escapeHtml(fmtCrc(totalAmount)) +
      '</strong></span></span></div>'
    );
  }

  function renderSettingsCompact(state) {
    var c = state.costs;
    var alexPct = num(state.alexPercent, DEFAULTS.alexPercent);
    var luisPct = Math.max(0, Math.min(100, 100 - alexPct));
    var printerOptions = catalog.printers.map(function (p) {
      return { value: p.id, label: printerOptionLabel(p) };
    });
    var printer = getPrinterById(c.printerId) || resolvePrinterSelection(c);
    var materialOptions = materialsForPrinter(printer).map(function (m) {
      return { value: m.id, label: materialOptionLabel(m) };
    });
    var materialId = resolveMaterialSelection(c, printer);
    var selectedMaterialId = materialId ? materialId.id : c.materialId;
    return (
      '<section class="cq-settings-compact glass-effect" aria-label="Configuración">' +
      '<div class="cq-settings-compact__head">' +
      '<h3 class="cq-settings-compact__title">Configuración</h3>' +
      '<span class="cq-settings-compact__hint">Cambia poco — valores base</span>' +
      '</div>' +
      '<div class="cq-settings-compact__row">' +
      '<div class="cq-settings-group">' +
      '<span class="cq-settings-group__name">Costos base</span>' +
      '<div class="cq-settings-group__fields">' +
      selectHtml('cq-printerId', 'Impresora', c.printerId, printerOptions, { compact: true }) +
      selectHtml('cq-materialId', 'Material', selectedMaterialId, materialOptions, { compact: true }) +
      inputHtml('cq-designCost', 'Diseño', c.designCost, { min: 0, step: 1, compact: true }) +
      inputHtml('cq-profitPercent', 'Ganancia %', c.profitPercent, { min: 0, step: 1, compact: true }) +
      inputHtml('cq-alexPercent', 'Ganancia Alex %', alexPct, {
        min: 0,
        max: 100,
        step: 0.1,
        compact: true,
      }) +
      '<div class="cq-field cq-field--compact cq-settings-luis-pct">' +
      resultHtml('Ganancia Luis %', luisPct.toFixed(1) + '% (auto)', 'luis') +
      '</div>' +
      '</div></div>' +
      '</div></section>'
    );
  }

  function renderAdditionalPickOptions() {
    return (
      '<option value="">— Personalizado —</option>' +
      catalog.additionals
        .map(function (a) {
          return (
            '<option value="' +
            escapeHtml(a.id) +
            '">' +
            escapeHtml(a.description) +
            ' (' +
            fmtCrc(a.price) +
            ')</option>'
          );
        })
        .join('')
    );
  }

  function renderAdditionalFields(p, productIdx) {
    var pickOpts = renderAdditionalPickOptions();
    var list = getProductAdditionals(p);
    return list
      .map(function (a, idx) {
        var prefix = 'cq-additional-' + productIdx + '-' + idx;
        return (
          '<div class="cq-additional-block" data-cq-additional-index="' +
          productIdx +
          '-' +
          idx +
          '">' +
          '<div class="cq-additional-block__head">' +
          '<span class="cq-additional-block__title">Adicional ' +
          (idx + 1) +
          '</span>' +
          (list.length > 0
            ? '<button type="button" class="btn btn--ghost btn--sm cq-btn-danger" data-cq-remove-additional="' +
              productIdx +
              '-' +
              idx +
              '">Quitar</button>'
            : '') +
          '</div>' +
          '<div class="cq-additional-block__fields">' +
          '<label class="cq-field cq-field--input">' +
          '<span class="cq-field__label">Frecuente</span>' +
          '<select id="' +
          prefix +
          '-pick" class="cq-select" data-cq-additional-pick="' +
          productIdx +
          '-' +
          idx +
          '">' +
          pickOpts +
          '</select></label>' +
          inputHtml(prefix + '-desc', 'Descripción', a.description, {
            type: 'text',
            placeholder: 'Ej. Pintura especial',
          }) +
          inputHtml(prefix + '-price', 'Precio (₡)', a.price, { min: 0, step: 1 }) +
          '<label class="cq-field cq-field--input cq-field--check cq-additional-invoice">' +
          '<span class="cq-field__label">Factura</span>' +
          '<span class="cq-check-row">' +
          '<input type="checkbox" id="' +
          prefix +
          '-invoice" data-cq-field="' +
          prefix +
          '-invoice"' +
          (a.showOnInvoice !== false ? ' checked' : '') +
          ' />' +
          '<span>Mostrar en factura</span></span></label>' +
          '</div></div>'
        );
      })
      .join('');
  }

  function workflowLabel(status) {
    return WORKFLOW_LABELS[status] || status || 'Pendiente';
  }

  function workflowBadgeClass(status) {
    return 'cq-workflow-badge cq-workflow-badge--' + String(status || 'pendiente').replace(/_/g, '-');
  }

  function canSendOrder() {
    if (!currentSavedQuoteId) return false;
    if (workflowMeta.status === 'aprobada' || workflowMeta.status === 'cancelada') return false;
    return true;
  }

  function renderHistoryBar() {
    var opts =
      '<option value="">— Seleccionar cotización guardada —</option>' +
      savedQuotes
        .map(function (q) {
          var statusLabel = workflowLabel(q.workflowStatus);
          return (
            '<option value="' +
            escapeHtml(q.id) +
            '"' +
            (q.id === currentSavedQuoteId ? ' selected' : '') +
            '>' +
            escapeHtml(q.productName) +
            ' · ' +
            escapeHtml(statusLabel) +
            ' · ' +
            escapeHtml(fmtQuoteDate(q.updatedAt)) +
            '</option>'
          );
        })
        .join('');
    return (
      '<div class="cq-history glass-effect">' +
      '<div class="cq-history__fields">' +
      '<label class="cq-field cq-field--compact">' +
      '<span class="cq-field__label">Historial</span>' +
      '<select id="cq-history-select" class="cq-select">' +
      opts +
      '</select></label>' +
      '<button type="button" class="btn btn--ghost btn--sm cq-history-action" id="cq-new-quote">Nueva cotización</button>' +
      '<button type="button" class="btn btn--primary btn--sm cq-history-action" id="cq-save-quote">Guardar</button>' +
      '<button type="button" class="btn btn--ghost btn--sm cq-btn-danger cq-history-action" id="cq-delete-quote">Eliminar</button>' +
      '</div>' +
      '<p id="cq-history-msg" class="cq-history-msg" hidden></p>' +
      '</div>'
    );
  }

  function renderWorkflowBar() {
    if (!currentSavedQuoteId) return '';
    var status = workflowMeta.status || 'pendiente';
    var linked =
      workflowMeta.linkedOrderId
        ? '<p class="cq-workflow-linked">Pedido vinculado: <strong>' +
          escapeHtml(workflowMeta.linkedOrderId) +
          '</strong></p>'
        : '';
    var adminControls = '';
    if (!isRestrictedPartner()) {
      var statusOpts = Object.keys(WORKFLOW_LABELS)
        .map(function (key) {
          return (
            '<option value="' +
            escapeHtml(key) +
            '"' +
            (key === status ? ' selected' : '') +
            '>' +
            escapeHtml(WORKFLOW_LABELS[key]) +
            '</option>'
          );
        })
        .join('');
      adminControls =
        '<div class="cq-workflow__admin">' +
        '<label class="cq-field cq-field--compact">' +
        '<span class="cq-field__label">Cambiar estado</span>' +
        '<select id="cq-workflow-status-select" class="cq-select">' +
        statusOpts +
        '</select></label>' +
        '<button type="button" class="btn btn--primary btn--sm" id="cq-approve-quote"' +
        (status === 'pendiente_aprobacion' ? '' : ' hidden') +
        '>Aprobar y crear pedido</button>' +
        '</div>';
    }
    return (
      '<div class="cq-workflow glass-effect">' +
      '<div class="cq-workflow__head">' +
      '<span class="cq-workflow__label">Estado de la orden</span>' +
      '<span id="cq-workflow-badge" class="' +
      workflowBadgeClass(status) +
      '">' +
      escapeHtml(workflowLabel(status)) +
      '</span></div>' +
      adminControls +
      linked +
      '</div>'
    );
  }

  function buildDiscountNote(state, result) {
    if (!state.wholesaleMode) return '';
    var m = result.main;
    var regular = m.baseSale || m.suggestedPrice;
    var qty = m.quantity;
    var tierPct = getTierDiscountPercent(state, qty, true);
    if (tierPct <= 0) return '';
    return (
      '* Aplicado beneficio mayorista por compra de ' +
      qty +
      ' unidades (Precio regular: ' +
      fmtCrc(regular) +
      ').'
    );
  }

  function renderPdfExportSection(exp) {
    var sendDisabled = !canSendOrder();
    return (
      '<section class="cq-pdf-export glass-effect" aria-labelledby="cq-pdf-title">' +
      '<div class="cq-pdf-export__head">' +
      '<h3 class="cq-pdf-export__title" id="cq-pdf-title">Exportar cotización PDF</h3>' +
      '<p class="cq-muted">Archivo: NinjaLab_cotizacion_ + nombre cliente + _ddmmaa</p>' +
      '</div>' +
      '<div class="cq-grid cq-grid--2">' +
      inputHtml('cq-clientName', 'Nombre del cliente', exp.clientName, {
        type: 'text',
        placeholder: 'Ej. Val\'s Bakery',
      }) +
      inputHtml('cq-clientEmail', 'Correo del cliente', exp.clientEmail || workflowMeta.clientEmail || '', {
        type: 'email',
        placeholder: 'cliente@ejemplo.com',
      }) +
      inputHtml('cq-clientPhone', 'Teléfono del cliente', exp.clientPhone || '', {
        type: 'tel',
        placeholder: 'Ej. +506 8888-8888',
      }) +
      inputHtml('cq-orderTitle', 'Título de la orden', exp.orderTitle, {
        type: 'text',
        placeholder: 'Ej. Orden de piezas personalizadas',
      }) +
      selectHtml(
        'cq-quoteEmail',
        'Correo cotización',
        normalizeQuoteEmail(exp.quoteEmail),
        QUOTE_EMAILS
      ) +
      '</div>' +
      '<label class="cq-field cq-field--input cq-field--wide">' +
      '<span class="cq-field__label">Descripción del servicio (una línea = un bullet en PDF)</span>' +
      '<textarea id="cq-description" data-cq-field="cq-description" rows="4" placeholder="Impresión 3D de alta calidad&#10;Logo personalizado&#10;Color a elegir">' +
      escapeHtml(exp.description) +
      '</textarea></label>' +
      '<div class="cq-grid cq-grid--2">' +
      inputHtml('cq-validDays', 'Válida por (días)', exp.validDays, { min: 1, step: 1 }) +
      inputHtml('cq-deliveryDays', 'Días hábiles de entrega', exp.deliveryDays, { min: 0, step: 1 }) +
      inputHtml('cq-shippingCost', 'Costo de envío (₡)', exp.shippingCost, { min: 0, step: 1 }) +
      '<label class="cq-field cq-field--input cq-field--check">' +
      '<span class="cq-field__label">Impuestos</span>' +
      '<span class="cq-check-row">' +
      '<input type="checkbox" id="cq-includeIva" data-cq-field="cq-includeIva"' +
      (exp.includeIva ? ' checked' : '') +
      ' />' +
      '<span>Incluir IVA (13%)</span></span></label>' +
      '</div>' +
      '<div class="cq-grid cq-grid--2">' +
      inputHtml('cq-paymentTerms', 'Forma de pago', exp.paymentTerms, { type: 'text' }) +
      inputHtml('cq-warranty', 'Garantía', exp.warranty, { type: 'text' }) +
      '</div>' +
      '<label class="cq-field cq-field--input cq-field--wide">' +
      '<span class="cq-field__label">Anotaciones adicionales (opcional)</span>' +
      '<textarea id="cq-extraNotes" data-cq-field="cq-extraNotes" rows="2" placeholder="Notas extra para el cliente">' +
      escapeHtml(exp.extraNotes) +
      '</textarea></label>' +
      '<p id="cq-pdf-msg" class="cq-history-msg" hidden></p>' +
      '<div class="cq-pdf-export__actions">' +
      '<button type="button" class="btn btn--ghost" id="cq-export-pdf">Generar PDF</button>' +
      '<button type="button" class="btn btn--primary" id="cq-save-order">Guardar orden</button>' +
      '<button type="button" class="btn btn--ghost" id="cq-send-order"' +
      (sendDisabled ? ' disabled' : '') +
      '>Enviar orden por correo</button>' +
      '<button type="button" class="btn btn--ghost cq-btn-whatsapp" id="cq-send-whatsapp"' +
      (sendDisabled ? ' disabled' : '') +
      '>Enviar cotización por WhatsApp (manual)</button>' +
      '</div>' +
      '<div class="cq-save-quote-mobile-wrap">' +
      '<button type="button" class="btn btn--primary cq-save-quote-mobile" id="cq-save-quote-mobile">Guardar cotización</button>' +
      '</div>' +
      '</section>'
    );
  }

  function renderScenarioCard(sc) {
    var l = sc.line;
    var r = sc.range;
    var isPlus = sc.key === 'range100plus';
    return (
      '<article class="cq-card cq-card--scenario' +
      (isPlus ? ' cq-card--scenario-plus' : '') +
      ' glass-effect">' +
      '<header class="cq-card__head">' +
      '<div class="cq-range-editor">' +
      inputHtml('cq-range-' + sc.key + '-min', 'Desde', r.min, { min: 1, step: 1, compact: true }) +
      (isPlus
        ? '<div class="cq-range-hasta-slot cq-field cq-field--input cq-field--compact">' +
          '<span class="cq-field__label" aria-hidden="true">Hasta</span>' +
          '<span class="cq-range-plus cq-range-plus--in-slot">+ uds</span></div>'
        : inputHtml('cq-range-' + sc.key + '-max', 'Hasta', r.max, { min: 1, step: 1, compact: true })) +
      '</div>' +
      inputHtml('cq-discount-' + sc.key, 'Descuento %', sc.discount, {
        min: 0,
        max: 100,
        step: 0.1,
        compact: true,
      }) +
      '</header>' +
      '<div class="cq-card__body">' +
      '<div class="cq-results-grid cq-results-grid--2">' +
      resultHtml('Precio venta / uds', fmtCrc(l.saleUnit)) +
      resultHtml('Ganancia neta / uds', fmtCrc(l.netUnit)) +
      resultHtml('Ganancia Alex', fmtCrc(l.alexUnitShare), 'alex') +
      resultHtml('Ganancia Luis', fmtCrc(l.luisUnitShare), 'luis') +
      '</div></div></article>'
    );
  }

  function renderSubnav() {
    return (
      '<nav class="cq-subnav glass-effect" aria-label="Secciones cotización 3D">' +
      getSubnavTabs()
        .map(function (t) {
          return (
            '<button type="button" class="cq-subnav__btn' +
            (activePanel === t.id ? ' is-active' : '') +
            '" data-cq-panel="' +
            t.id +
            '">' +
            escapeHtml(t.label) +
            '</button>'
          );
        })
        .join('') +
      '</nav>'
    );
  }

  function renderCatalogList(kind, items) {
    if (!items.length) {
      return '<p class="cq-muted cq-catalog-empty">Sin registros todavía.</p>';
    }
    return (
      '<ul class="cq-catalog-list">' +
      items
        .map(function (item) {
          var primary = kind === 'additional' ? item.description : item.name;
          var secondary =
            kind === 'additional'
              ? fmtCrc(item.price)
              : kind === 'printer'
                ? fmtCrc(item.hourRate) + ' / h'
                : fmtCrc(item.kgPrice) + ' / kg';
          return (
            '<li class="cq-catalog-list__item">' +
            '<div class="cq-catalog-list__main">' +
            '<strong>' +
            escapeHtml(primary) +
            '</strong>' +
            '<span>' +
            escapeHtml(secondary) +
            '</span></div>' +
            '<div class="cq-catalog-list__actions">' +
            '<button type="button" class="btn btn--ghost btn--sm" data-cq-catalog-edit="' +
            kind +
            '" data-id="' +
            escapeHtml(item.id) +
            '">Editar</button>' +
            '<button type="button" class="btn btn--ghost btn--sm cq-btn-danger" data-cq-catalog-del="' +
            kind +
            '" data-id="' +
            escapeHtml(item.id) +
            '">Eliminar</button>' +
            '</div></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function renderAdditionalsCatalogPanel() {
    return (
      '<section class="cq-catalog-panel glass-effect">' +
      '<h3 class="cq-card__title">Adicionales frecuentes</h3>' +
      '<p class="cq-muted">Se muestran al elegir un adicional en datos del producto.</p>' +
      '<div class="cq-catalog-form">' +
      '<input type="hidden" id="cq-catalog-additional-id" value="" />' +
      '<div class="cq-grid cq-grid--2">' +
      inputHtml('cq-catalog-additional-desc', 'Descripción', '', {
        type: 'text',
        placeholder: 'Ej. Pintura',
        noCommit: true,
      }) +
      inputHtml('cq-catalog-additional-price', 'Precio (₡)', 0, { min: 0, step: 1, noCommit: true }) +
      '</div>' +
      '<div class="cq-catalog-form__actions">' +
      '<button type="button" class="btn btn--primary btn--sm" id="cq-catalog-additional-save">Guardar</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="cq-catalog-additional-cancel" hidden>Cancelar</button>' +
      '</div></div>' +
      renderCatalogList('additional', catalog.additionals) +
      '<p id="cq-catalog-msg" class="cq-history-msg" hidden></p>' +
      '</section>'
    );
  }

  function renderPrintersCatalogPanel() {
    return (
      '<section class="cq-catalog-panel glass-effect">' +
      '<h3 class="cq-card__title">Impresoras</h3>' +
      '<p class="cq-muted">El precio por hora se usa en costos base al elegir la impresora.</p>' +
      '<div class="cq-catalog-form">' +
      '<input type="hidden" id="cq-catalog-printer-id" value="" />' +
      '<div class="cq-grid cq-grid--2">' +
      inputHtml('cq-catalog-printer-name', 'Nombre', '', {
        type: 'text',
        placeholder: 'Ej. Bambu X1',
        noCommit: true,
      }) +
      inputHtml('cq-catalog-printer-rate', 'Precio / hora (₡)', 300, { min: 0, step: 1, noCommit: true }) +
      '</div>' +
      '<div class="cq-catalog-form__actions">' +
      '<button type="button" class="btn btn--primary btn--sm" id="cq-catalog-printer-save">Guardar</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="cq-catalog-printer-cancel" hidden>Cancelar</button>' +
      '</div></div>' +
      renderCatalogList('printer', catalog.printers) +
      '<p id="cq-catalog-msg" class="cq-history-msg" hidden></p>' +
      '</section>'
    );
  }

  function renderMaterialsCatalogPanel() {
    return (
      '<section class="cq-catalog-panel glass-effect">' +
      '<h3 class="cq-card__title">Materiales</h3>' +
      '<p class="cq-muted">El precio por kg se usa en costos base al elegir el material.</p>' +
      '<div class="cq-catalog-form">' +
      '<input type="hidden" id="cq-catalog-material-id" value="" />' +
      '<div class="cq-grid cq-grid--2">' +
      inputHtml('cq-catalog-material-name', 'Nombre', '', {
        type: 'text',
        placeholder: 'Ej. PLA blanco',
        noCommit: true,
      }) +
      inputHtml('cq-catalog-material-price', 'Precio / kg (₡)', 20500, { min: 0, step: 1, noCommit: true }) +
      '</div>' +
      '<div class="cq-catalog-form__actions">' +
      '<button type="button" class="btn btn--primary btn--sm" id="cq-catalog-material-save">Guardar</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="cq-catalog-material-cancel" hidden>Cancelar</button>' +
      '</div></div>' +
      renderCatalogList('material', catalog.materials) +
      '<p id="cq-catalog-msg" class="cq-history-msg" hidden></p>' +
      '</section>'
    );
  }

  function renderCatalogPanel() {
    if (isRestrictedPartner() && activePanel !== 'additionals') return '';
    if (activePanel === 'additionals') return renderAdditionalsCatalogPanel();
    if (activePanel === 'printers') return renderPrintersCatalogPanel();
    if (activePanel === 'materials') return renderMaterialsCatalogPanel();
    return '';
  }

  function renderSaleDiscountBlock(p, m, wholesaleOn, productIdx) {
    if (wholesaleOn) return '';
    var enabled = !!p.saleDiscountEnabled;
    var pct = Math.max(0, Math.min(100, num(p.saleDiscountPercent)));
    var baseSale = num(m.baseSale);
    var discAmount = enabled && pct > 0 ? Math.round(baseSale * (pct / 100)) : 0;
    return (
      '<div class="cq-sale-discount glass-effect">' +
      '<label class="cq-field cq-field--check cq-sale-discount__toggle">' +
      '<span class="cq-check-row">' +
      '<input type="checkbox" id="cq-saleDiscountEnabled-' +
      productIdx +
      '" data-cq-field="cq-saleDiscountEnabled-' +
      productIdx +
      '"' +
      (enabled ? ' checked' : '') +
      ' />' +
      '<span>Descuento en este producto</span></span></label>' +
      (enabled
        ? '<div class="cq-sale-discount__fields">' +
          '<div class="cq-grid cq-grid--3">' +
          inputHtml('cq-saleDiscountPercent-' + productIdx, 'Descuento %', pct, {
            min: 0,
            max: 100,
            step: 0.1,
          }) +
          resultHtml('Monto descuento / uds', fmtCrc(discAmount)) +
          resultHtml('Monto con descuento / uds', fmtCrc(m.saleUnit)) +
          '</div></div>'
        : '') +
      '</div>'
    );
  }

  function renderGlobalDiscountBlock(state, main) {
    if (state.wholesaleMode) return '';
    var gd = state.globalDiscount || DEFAULTS.globalDiscount;
    var enabled = !!gd.enabled;
    var pct = Math.max(0, Math.min(100, num(gd.percent)));
    return (
      '<div class="cq-sale-discount cq-sale-discount--global glass-effect">' +
      '<label class="cq-field cq-field--check cq-sale-discount__toggle">' +
      '<span class="cq-check-row">' +
      '<input type="checkbox" id="cq-globalDiscountEnabled" data-cq-field="cq-globalDiscountEnabled"' +
      (enabled ? ' checked' : '') +
      ' />' +
      '<span>Descuento general en la cotización</span></span></label>' +
      (enabled
        ? '<div class="cq-sale-discount__fields">' +
          '<div class="cq-grid cq-grid--3">' +
          inputHtml('cq-globalDiscountPercent', 'Descuento general %', pct, {
            min: 0,
            max: 100,
            step: 0.1,
          }) +
          resultHtml('Monto descuento total', fmtCrc(main.globalDiscountAmount || 0)) +
          resultHtml('Subtotal con descuento', fmtCrc(main.saleTotal)) +
          '</div></div>'
        : '') +
      '</div>'
    );
  }

  function renderQtyInputModeBar(p, productIdx) {
    var qty = getProductQty(p);
    if (qty <= 1) return '';
    var isTotal = isTotalQtyInputMode(p);
    return (
      '<div class="cq-qty-mode-bar">' +
      '<span class="cq-qty-mode-bar__hint">' +
      (isTotal
        ? 'Gramos, horas y precio sugerido en totales del lote (' + qty + ' uds)'
        : 'Gramos, horas y precio sugerido por unidad') +
      '</span>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-cq-toggle-qty-input-mode="' +
      productIdx +
      '">' +
      (isTotal ? 'Ver por unidad' : 'Ver totales') +
      '</button></div>'
    );
  }

  function renderSuggestedPriceBlock(m, p) {
    var qty = getProductQty(p);
    var unitPrice = fmtCrc(m.suggestedPrice);
    if (qty <= 1) {
      return (
        '<div class="cq-price-pair__suggested">' +
        '<span class="cq-price-pair__label">Precio sugerido / unidad</span>' +
        '<span class="cq-price-pair__value">' +
        unitPrice +
        '</span></div>'
      );
    }
    var totalPrice = fmtCrc(m.suggestedTotal != null ? m.suggestedTotal : m.suggestedPrice * qty);
    var isTotal = isTotalQtyInputMode(p);
    return (
      '<div class="cq-price-pair__suggested cq-price-pair__suggested--dual">' +
      '<div class="cq-price-pair__col' +
      (isTotal ? '' : ' cq-price-pair__col--primary') +
      '">' +
      '<span class="cq-price-pair__label">Precio sugerido / unidad</span>' +
      '<span class="cq-price-pair__value cq-price-pair__value--unit">' +
      unitPrice +
      '</span></div>' +
      '<div class="cq-price-pair__col' +
      (isTotal ? ' cq-price-pair__col--primary' : '') +
      '">' +
      '<span class="cq-price-pair__label">Precio sugerido total</span>' +
      '<span class="cq-price-pair__value">' +
      totalPrice +
      '</span></div></div>'
    );
  }

  function renderCostBreakdownPanel(m, p) {
    return (
      '<div class="cq-cost-breakdown-panel glass-effect">' +
      '<div class="cq-breakdown">' +
      '<h4 class="cq-breakdown__title">Costo unitario</h4>' +
      '<div class="cq-results-grid cq-results-grid--4">' +
      resultHtml('Material', fmtCrc(m.materialCost)) +
      resultHtml('Tiempo', fmtCrc(m.timeCost)) +
      resultHtml('Adicionales', fmtCrc(sumAdditionals(p))) +
      resultHtml('Costo total / uds', fmtCrc(m.unitCost)) +
      '</div></div>' +
      '<div class="cq-results-grid cq-results-grid--3">' +
      resultHtml('Costo total × cantidad', fmtCrc(m.totalCost)) +
      resultHtml('Ganancia neta / uds', fmtCrc(m.netUnit)) +
      resultHtml('Ganancia neta total', fmtCrc(m.netTotal)) +
      '</div></div>'
    );
  }

  function renderProductCard(pr, productIdx, wholesaleOn) {
    var p = pr.product;
    var m = pr.line;
    var saleDisplay = p.salePriceTouched ? p.salePriceManual : Math.round(m.suggestedPrice);
    var additionals = getProductAdditionals(p);
    var canRemove = ensureProducts(state).length > 1;
    var breakdownOpen = !!costBreakdownOpenByProduct[productIdx];
    var qty = getProductQty(p);
    return (
      '<section class="cq-card cq-card--editable cq-card--product glass-effect" data-cq-product-index="' +
      productIdx +
      '">' +
      '<div class="cq-card__head-row">' +
      '<h3 class="cq-card__title">Producto ' +
      (productIdx + 1) +
      '</h3>' +
      (canRemove
        ? '<button type="button" class="btn btn--ghost btn--sm cq-btn-danger" data-cq-remove-product="' +
          productIdx +
          '">Eliminar producto</button>'
        : '') +
      '</div>' +
      renderQtyInputModeBar(p, productIdx) +
      '<div class="cq-grid cq-grid--2">' +
      inputHtml('cq-productName-' + productIdx, 'Nombre del producto', p.name, {
        type: 'text',
        placeholder: 'Ej. Copa Mundial',
      }) +
      inputHtml('cq-quantity-' + productIdx, 'Cantidad', p.quantity, { min: 1, step: 1 }) +
      inputHtml('cq-grams-' + productIdx, gramsLabelForProduct(p), gramsDisplayValue(p), {
        min: 0,
        step: 0.1,
      }) +
      inputHtml('cq-printHours-' + productIdx, printHoursLabelForProduct(p), printHoursDisplayValue(p), {
        min: 0,
        step: 0.1,
      }) +
      '</div>' +
      (additionals.length
        ? '<div class="cq-additionals">' + renderAdditionalFields(p, productIdx) + '</div>'
        : '') +
      '<div class="cq-additionals-actions">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-cq-add-additional="' +
      productIdx +
      '">Agregar adicional</button>' +
      '</div>' +
      '<div class="cq-price-row glass-effect">' +
      renderSuggestedPriceBlock(m, p) +
      '<div class="cq-price-pair__arrow" aria-hidden="true">→</div>' +
      '<div class="cq-price-pair__sale">' +
      inputHtml('cq-salePrice-' + productIdx, 'Precio de venta / unidad', saleDisplay, { min: 0, step: 1 }) +
      (qty > 1
        ? '<div class="cq-price-pair__sale-total">' +
          '<span class="cq-price-pair__label">Precio de venta total</span>' +
          '<span class="cq-price-pair__value cq-price-pair__value--sale-total">' +
          fmtCrc(Math.round(m.saleUnit * qty)) +
          '</span></div>'
        : '') +
      '</div></div>' +
      renderSaleDiscountBlock(p, m, wholesaleOn, productIdx) +
      '<div class="cq-cost-breakdown-toggle-wrap">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-cq-toggle-cost-breakdown="' +
      productIdx +
      '">' +
      (breakdownOpen ? 'Ocultar desglose de costos' : 'Ver desglose de costos') +
      '</button></div>' +
      (breakdownOpen ? renderCostBreakdownPanel(m, p) : '') +
      '</section>'
    );
  }

  function renderQuoteSummary(state, result) {
    var m = result.main;
    var multi = result.products.length > 1;
    return (
      '<section class="cq-card cq-card--summary glass-effect cq-card--wide">' +
      '<h3 class="cq-card__title">Resumen general</h3>' +
      '<div class="cq-results-grid cq-results-grid--2">' +
      (multi
        ? resultHtml('Precio sugerido total', fmtCrc(m.suggestedTotal))
        : resultHtml('Precio sugerido / unidad', fmtCrc(m.suggestedPrice))) +
      (multi ? resultHtml('Precio sugerido prom. / uds', fmtCrc(m.suggestedUnitAvg)) : '') +
      resultHtml('Subtotal venta', fmtCrc(m.subtotalGross)) +
      resultHtml('Total cliente (+ diseño)', fmtCrc(m.clientTotal)) +
      '</div>' +
      renderGlobalDiscountBlock(state, m) +
      '<div class="cq-price-row glass-effect">' +
      '<div class="cq-price-row__profit cq-price-row__profit--alex">' +
      profitShareHtml('Ganancia Alex (+ diseño)', m.alexUnitShare, m.alexShare, m.quantity, 'alex') +
      '</div>' +
      '<div class="cq-price-row__profit cq-price-row__profit--luis">' +
      profitShareHtml('Ganancia Luis', m.luisUnitShare, m.luisShare, m.quantity, 'luis') +
      '</div></div>' +
      '</section>'
    );
  }

  function renderQuotePanel(state, result) {
    var wholesaleOn = !!state.wholesaleMode;

    return (
      renderHistoryBar() +
      renderWorkflowBar() +
      '<div class="cq-layout">' +
      renderSettingsCompact(state) +
      '<div class="cq-products-section">' +
      '<div class="cq-products-section__head">' +
      '<h3 class="cq-section-title">Datos del producto</h3>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="cq-add-product">Agregar producto</button>' +
      '</div>' +
      result.products.map(function (pr, idx) {
        return renderProductCard(pr, idx, wholesaleOn);
      }).join('') +
      '</div>' +
      renderQuoteSummary(state, result) +
      (wholesaleOn
        ? '<section class="cq-scenarios"><h3 class="cq-section-title">Rangos con descuento</h3>' +
          '<div class="cq-scenarios-grid">' +
          result.scenarios.map(renderScenarioCard).join('') +
          '</div></section>'
        : '') +
      renderPdfExportSection(state.export || DEFAULTS.export) +
      '</div>'
    );
  }

  function render(root, state, result) {
    var wholesaleOn = !!state.wholesaleMode;

    root.innerHTML =
      '<div class="cq-hero glass-effect">' +
      '<div><p class="cq-hero__eyebrow">Herramienta interna</p>' +
      '<h2 class="admin-h2">Cotización costo 3D</h2>' +
      '<p class="admin-muted">Costos, precios por volumen y reparto Alex / Luis.</p></div>' +
      '<div class="cq-hero__actions">' +
      (activePanel === 'quote'
        ? '<button type="button" class="btn btn--ghost btn--sm' +
          (wholesaleOn ? ' cq-wholesale-on' : '') +
          '" id="cq-toggle-wholesale">Venta mayorista</button>'
        : '') +
      '<span class="cq-hero__badge">₡ CRC</span></div></div>' +
      renderSubnav() +
      (activePanel === 'quote' ? renderQuotePanel(state, result) : renderCatalogPanel());
  }

  function readStateFromDom(root, prev) {
    var state = deepClone(prev);
    if (activePanel !== 'quote') return state;
    var g = function (id) {
      var el = $('#' + id, root);
      return el ? el.value : '';
    };
    state.costs.printerId = g('cq-printerId') || state.costs.printerId;
    state.costs.materialId = g('cq-materialId') || state.costs.materialId;
    state.costs.designCost = num(g('cq-designCost'), state.costs.designCost);
    state.costs.profitPercent = num(g('cq-profitPercent'), state.costs.profitPercent);
    var eff = getEffectiveCosts(state);
    state.costs.hourRate = eff.hourRate;
    state.costs.kgPrice = eff.kgPrice;
    state.costs.printerId = eff.printerId || state.costs.printerId;
    state.costs.materialId = eff.materialId || state.costs.materialId;
    if (!state.discountRanges) state.discountRanges = deepClone(DEFAULTS.discountRanges);
    ['range10_50', 'range50_100', 'range100plus'].forEach(function (key) {
      var discEl = $('#cq-discount-' + key, root);
      if (discEl) {
        state.discounts[key] = Math.max(0, Math.min(100, num(discEl.value, state.discounts[key])));
      }
      var minVal = num(g('cq-range-' + key + '-min'), state.discountRanges[key].min);
      state.discountRanges[key].min = Math.max(1, minVal);
      if (key !== 'range100plus') {
        var maxVal = num(g('cq-range-' + key + '-max'), state.discountRanges[key].max);
        state.discountRanges[key].max = Math.max(state.discountRanges[key].min, maxVal);
      } else {
        state.discountRanges[key].max = null;
      }
    });
    ensureProducts(state);
    state.alexPercent = Math.max(0, Math.min(100, num(g('cq-alexPercent'), state.alexPercent)));
    state.luisPercent = Math.max(0, Math.min(100, 100 - state.alexPercent));
    if (!state.globalDiscount) state.globalDiscount = deepClone(DEFAULTS.globalDiscount);
    var globalDiscEl = $('#cq-globalDiscountEnabled', root);
    state.globalDiscount.enabled = !!(globalDiscEl && globalDiscEl.checked);
    state.globalDiscount.percent = Math.max(
      0,
      Math.min(100, num(g('cq-globalDiscountPercent'), state.globalDiscount.percent))
    );
    root.querySelectorAll('[data-cq-product-index]').forEach(function (block) {
      var productIdx = parseInt(block.getAttribute('data-cq-product-index'), 10);
      if (!Number.isFinite(productIdx) || !state.products[productIdx]) return;
      var prod = state.products[productIdx];
      prod.name = g('cq-productName-' + productIdx);
      prod.quantity = Math.max(1, num(g('cq-quantity-' + productIdx), prod.quantity));
      if (prod.quantity <= 1) prod.qtyInputMode = 'unit';
      else if (prod.qtyInputMode !== 'total') prod.qtyInputMode = 'unit';
      var gramsInput = num(g('cq-grams-' + productIdx), prod.grams);
      var hoursInput = num(g('cq-printHours-' + productIdx), prod.printHours);
      if (isTotalQtyInputMode(prod)) {
        prod.grams = gramsInput / prod.quantity;
        prod.printHours = hoursInput / prod.quantity;
      } else {
        prod.grams = gramsInput;
        prod.printHours = hoursInput;
      }
      prod.salePriceManual = num(g('cq-salePrice-' + productIdx), prod.salePriceManual);
      var saleDiscEl = $('#cq-saleDiscountEnabled-' + productIdx, root);
      prod.saleDiscountEnabled = !!(saleDiscEl && saleDiscEl.checked);
      prod.saleDiscountPercent = Math.max(
        0,
        Math.min(100, num(g('cq-saleDiscountPercent-' + productIdx), prod.saleDiscountPercent))
      );
      prod.additionals = [];
      block.querySelectorAll('[data-cq-additional-index]').forEach(function (addBlock) {
        var parts = String(addBlock.getAttribute('data-cq-additional-index') || '').split('-');
        var pi = parseInt(parts[0], 10);
        var ai = parseInt(parts[1], 10);
        if (pi !== productIdx || !Number.isFinite(ai)) return;
        var prefix = 'cq-additional-' + pi + '-' + ai;
        var invoiceEl = $('#' + prefix + '-invoice', root);
        prod.additionals.push({
          price: num(g(prefix + '-price')),
          description: g(prefix + '-desc'),
          showOnInvoice: !!(invoiceEl && invoiceEl.checked),
        });
      });
    });
    if (!state.export) state.export = deepClone(DEFAULTS.export);
    state.export.clientName = g('cq-clientName');
    state.export.clientEmail = g('cq-clientEmail');
    state.export.clientPhone = g('cq-clientPhone');
    state.export.orderTitle = g('cq-orderTitle');
    state.export.description = g('cq-description');
    state.export.deliveryDays = num(g('cq-deliveryDays'), state.export.deliveryDays);
    state.export.validDays = num(g('cq-validDays'), state.export.validDays);
    state.export.shippingCost = num(g('cq-shippingCost'), state.export.shippingCost);
    state.export.paymentTerms = g('cq-paymentTerms');
    state.export.warranty = g('cq-warranty');
    state.export.extraNotes = g('cq-extraNotes');
    state.export.quoteEmail = normalizeQuoteEmail(g('cq-quoteEmail') || state.export.quoteEmail);
    syncCostSelections(state);
    var ivaEl = $('#cq-includeIva', root);
    state.export.includeIva = !!(ivaEl && ivaEl.checked);
    return state;
  }

  function showPdfMsg(root, text, isErr) {
    var el = $('#cq-pdf-msg', root);
    if (!el) return;
    if (!text) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = 'cq-history-msg' + (isErr ? ' cq-history-msg--err' : ' cq-history-msg--ok');
  }

  function isMobileLayout() {
    try {
      return window.matchMedia('(max-width: 640px)').matches;
    } catch (e) {
      return false;
    }
  }

  function showHistoryMsg(root, text, isErr) {
    var el = $('#cq-history-msg', root);
    if (!el) return;
    if (!text) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = 'cq-history-msg' + (isErr ? ' cq-history-msg--err' : ' cq-history-msg--ok');
  }

  function loadQuoteFromHistory(root, id, triggerEl) {
    var quoteId = String(id || '').trim();
    if (!quoteId) {
      showHistoryMsg(root, 'Seleccioná una cotización del historial.', true);
      return Promise.resolve();
    }
    if (triggerEl) triggerEl.disabled = true;
    return api('/api/admin/cost-quotes/' + encodeURIComponent(quoteId))
      .then(function (data) {
        state = migrateState(mergeDeep(deepClone(DEFAULTS), data.payload || {}));
        currentSavedQuoteId = quoteId;
        workflowMeta = data.workflow || { status: 'pendiente', linkedOrderId: '' };
        if (workflowMeta.clientEmail && !state.export.clientEmail) {
          state.export.clientEmail = workflowMeta.clientEmail;
        }
        pdfReadyInSession = false;
        syncCostSelections(state);
        refresh(root, true);
        showHistoryMsg(root, 'Cotización cargada.');
      })
      .catch(function (e) {
        showHistoryMsg(root, e.message || 'No se pudo cargar.', true);
      })
      .finally(function () {
        if (triggerEl) triggerEl.disabled = false;
      });
  }

  function buildQuoteSnapshot(src) {
    var snapshot = deepClone(src);
    ensureProducts(snapshot);
    pruneEmptyAdditionals(snapshot.products);
    return snapshot;
  }

  function saveCurrentQuote(root, triggerEl) {
    state = readStateFromDom(root, state);
    var name = getQuoteDisplayName(state);
    if (!name) {
      showHistoryMsg(root, 'Escribí el nombre de al menos un producto antes de guardar.', true);
      return Promise.resolve();
    }
    if (triggerEl) triggerEl.disabled = true;
    var exp = state.export || {};
    return api('/api/admin/cost-quotes', {
      method: 'POST',
      body: {
        snapshot: buildQuoteSnapshot(state),
        productName: name,
        id: currentSavedQuoteId || undefined,
        clientEmail: String(exp.clientEmail || '').trim(),
        clientName: String(exp.clientName || '').trim(),
        pdfGeneratedAt: pdfReadyInSession ? Date.now() : undefined,
      },
    })
      .then(function (data) {
        if (data && data.id) {
          currentSavedQuoteId = data.id;
          if (data.workflowStatus) workflowMeta.status = data.workflowStatus;
        }
        return loadHistoryList().then(function () {
          refresh(root);
          showHistoryMsg(root, 'Cotización «' + name + '» guardada.');
        });
      })
      .catch(function (e) {
        showHistoryMsg(root, e.message || 'No se pudo guardar.', true);
      })
      .finally(function () {
        if (triggerEl) triggerEl.disabled = false;
      });
  }

  function loadHistoryList() {
    return api('/api/admin/cost-quotes')
      .then(function (rows) {
        savedQuotes = Array.isArray(rows) ? rows : [];
      })
      .catch(function () {
        savedQuotes = [];
      });
  }

  function saveOrderFromExport(root, triggerEl) {
    state = readStateFromDom(root, state);
    var name = getQuoteDisplayName(state);
    if (!name) {
      showPdfMsg(root, 'Escribí el nombre de al menos un producto antes de guardar la orden.', true);
      return Promise.resolve();
    }
    if (triggerEl) triggerEl.disabled = true;
    var exp = state.export || {};
    return api('/api/admin/cost-quotes', {
      method: 'POST',
      body: {
        snapshot: buildQuoteSnapshot(state),
        productName: name,
        id: currentSavedQuoteId || undefined,
        clientEmail: String(exp.clientEmail || '').trim(),
        clientName: String(exp.clientName || '').trim(),
        pdfGeneratedAt: pdfReadyInSession ? Date.now() : undefined,
      },
    })
      .then(function (data) {
        if (data && data.id) {
          currentSavedQuoteId = data.id;
          if (data.workflowStatus) workflowMeta.status = data.workflowStatus;
        }
        return loadHistoryList().then(function () {
          refresh(root, true);
          showPdfMsg(root, 'Orden guardada. Ya podés enviarla por correo.');
        });
      })
      .catch(function (e) {
        showPdfMsg(root, e.message || 'No se pudo guardar la orden.', true);
      })
      .finally(function () {
        if (triggerEl) triggerEl.disabled = false;
      });
  }

  function isValidClientPhone(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return false;
    if (digits.length === 8) digits = '506' + digits;
    if (digits.indexOf('506506') === 0) digits = digits.slice(3);
    if (digits.indexOf('506') === 0) return digits.length === 11;
    return digits.length >= 10 && digits.length <= 15;
  }

  function formatClientPhoneDisplay(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 8) return '+506 ' + digits.slice(0, 4) + '-' + digits.slice(4);
    if (digits.indexOf('506') === 0 && digits.length === 11) {
      return '+506 ' + digits.slice(3, 7) + '-' + digits.slice(7);
    }
    return String(phone || '').trim();
  }

  function postQuoteSend(root, triggerEl, opts) {
    opts = opts || {};
    state = readStateFromDom(root, state);
    var exp = state.export || {};
    var clientName = String(exp.clientName || '').trim();
    var clientEmail = String(exp.clientEmail || '').trim();
    if (!currentSavedQuoteId) {
      showPdfMsg(root, 'Guardá la cotización antes de enviar la orden.', true);
      return Promise.resolve();
    }
    if (!clientName) {
      showPdfMsg(root, 'Escribí el nombre del cliente.', true);
      return Promise.resolve();
    }
    if (opts.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      showPdfMsg(root, 'Indicá un correo válido del cliente.', true);
      return Promise.resolve();
    }
    if (triggerEl) triggerEl.disabled = true;
    showPdfMsg(root, opts.preparingMsg || 'Preparando envío…', false);
    var result = computeAll(state);
    var pdfData = {
      clientName: clientName,
      orderTitle: exp.orderTitle,
      description: exp.description || 'Impresión 3D de alta calidad.',
      productTitle: getQuoteDisplayName(state),
      deliveryDays: exp.deliveryDays,
      extraNotes: exp.extraNotes,
      includeIva: !!exp.includeIva,
      wholesaleMode: !!state.wholesaleMode,
      discountNote: buildDiscountNote(state, result),
      state: state,
      result: result,
    };
    var grandTotal =
      global.AdminCostQuotePdf && typeof global.AdminCostQuotePdf.computeGrandTotal === 'function'
        ? global.AdminCostQuotePdf.computeGrandTotal(pdfData)
        : 0;

    function postSend(pdf) {
      var form = new FormData();
      if (pdf && pdf.blob) {
        form.append('pdf', pdf.blob, pdf.filename || 'NinjaLab_cotizacion.pdf');
      }
      form.append('clientName', clientName);
      form.append('snapshot', JSON.stringify(state));
      if (grandTotal > 0) form.append('totalCrc', String(grandTotal));
      if (opts.channel === 'email') form.append('clientEmail', clientEmail);
      var csrfToken =
        document.querySelector('meta[name="csrf-token"]')?.content ||
        document.querySelector('input[name="_csrf"]')?.value ||
        '';
      return fetch(opts.endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': csrfToken,
        },
        body: form,
      }).then(function (r) {
        return r.text().then(function (text) {
          var data = {};
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (e) {
              throw new Error('La API no respondió correctamente.');
            }
          }
          if (!r.ok) throw new Error((data && data.error) || opts.errorMsg || 'No se pudo enviar.');
          return data;
        });
      });
    }

    var pdfPromise = Promise.resolve(null);
    if (global.AdminCostQuotePdf && typeof global.AdminCostQuotePdf.generateBlob === 'function') {
      pdfPromise = global.AdminCostQuotePdf.generateBlob(pdfData).catch(function () {
        return null;
      });
    }

    return pdfPromise
      .then(postSend)
      .then(function (data) {
        workflowMeta.status = 'enviada';
        if (data.quote && data.quote.linkedOrderId) {
          workflowMeta.linkedOrderId = data.quote.linkedOrderId;
        }
        return loadHistoryList().then(function () {
          refresh(root, true);
          showPdfMsg(root, typeof opts.successMsg === 'function' ? opts.successMsg(exp) : opts.successMsg);
        });
      })
      .catch(function (e) {
        showPdfMsg(root, e.message || opts.errorMsg || 'No se pudo enviar.', true);
      })
      .finally(function () {
        if (triggerEl) triggerEl.disabled = false;
      });
  }

  function sendOrderByEmail(root, triggerEl) {
    return postQuoteSend(root, triggerEl, {
      channel: 'email',
      endpoint: '/api/admin/cost-quotes/' + encodeURIComponent(currentSavedQuoteId) + '/send-order',
      errorMsg: 'No se pudo enviar la orden.',
      successMsg: function (exp) {
        return 'Orden enviada por correo a ' + String(exp.clientEmail || '').trim() + '.';
      },
    });
  }

  function downloadPdfBlob(pdf) {
    if (!pdf || !pdf.blob) return;
    var url = URL.createObjectURL(pdf.blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = pdf.filename || 'NinjaLab_cotizacion.pdf';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function sendOrderByWhatsApp(root, triggerEl) {
    state = readStateFromDom(root, state);
    var exp = state.export || {};
    var clientName = String(exp.clientName || '').trim();
    var clientPhone = String(exp.clientPhone || '').trim();
    if (!currentSavedQuoteId) {
      showPdfMsg(root, 'Guardá la cotización antes de enviar por WhatsApp.', true);
      return Promise.resolve();
    }
    if (!clientName) {
      showPdfMsg(root, 'Escribí el nombre del cliente.', true);
      return Promise.resolve();
    }
    if (!isValidClientPhone(clientPhone)) {
      showPdfMsg(root, 'Indicá un teléfono válido del cliente (ej. +506 8888-8888).', true);
      return Promise.resolve();
    }
    if (triggerEl) triggerEl.disabled = true;
    showPdfMsg(root, 'Preparando mensaje y PDF para WhatsApp…', false);

    var result = computeAll(state);
    var pdfData = {
      clientName: clientName,
      orderTitle: exp.orderTitle,
      description: exp.description || 'Impresión 3D de alta calidad.',
      productTitle: getQuoteDisplayName(state),
      deliveryDays: exp.deliveryDays,
      extraNotes: exp.extraNotes,
      includeIva: !!exp.includeIva,
      wholesaleMode: !!state.wholesaleMode,
      discountNote: buildDiscountNote(state, result),
      state: state,
      result: result,
    };
    var grandTotal =
      global.AdminCostQuotePdf && typeof global.AdminCostQuotePdf.computeGrandTotal === 'function'
        ? global.AdminCostQuotePdf.computeGrandTotal(pdfData)
        : 0;

    function postWhatsAppAssist(pdf) {
      var form = new FormData();
      if (pdf && pdf.blob) {
        form.append('pdf', pdf.blob, pdf.filename || 'NinjaLab_cotizacion.pdf');
      }
      form.append('clientName', clientName);
      form.append('clientPhone', clientPhone);
      form.append('snapshot', JSON.stringify(state));
      if (grandTotal > 0) form.append('totalCrc', String(grandTotal));
      var csrfToken =
        document.querySelector('meta[name="csrf-token"]')?.content ||
        document.querySelector('input[name="_csrf"]')?.value ||
        '';
      return fetch(
        '/api/admin/cost-quotes/' + encodeURIComponent(currentSavedQuoteId) + '/whatsapp-assist',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'x-csrf-token': csrfToken,
          },
          body: form,
        }
      ).then(function (r) {
        return r.text().then(function (text) {
          var data = {};
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (e) {
              throw new Error('La API no respondió correctamente.');
            }
          }
          if (!r.ok) throw new Error((data && data.error) || 'No se pudo preparar WhatsApp.');
          return { data: data, pdf: pdf };
        });
      });
    }

    var pdfPromise = Promise.resolve(null);
    if (global.AdminCostQuotePdf && typeof global.AdminCostQuotePdf.generateBlob === 'function') {
      pdfPromise = global.AdminCostQuotePdf.generateBlob(pdfData).catch(function () {
        return null;
      });
    }

    return pdfPromise
      .then(postWhatsAppAssist)
      .then(function (payload) {
        var assist = payload.data && payload.data.assist;
        if (!assist || !assist.waUrl) {
          throw new Error('No se pudo generar el enlace de WhatsApp.');
        }
        if (payload.pdf) downloadPdfBlob(payload.pdf);
        var opened = window.open(assist.waUrl, '_blank', 'noopener,noreferrer');
        if (!opened) {
          showPdfMsg(
            root,
            'El navegador bloqueó la ventana de WhatsApp. Permití ventanas emergentes o usá este enlace: ' +
              assist.waUrl,
            true
          );
          return;
        }
        showPdfMsg(
          root,
          'WhatsApp abierto con el mensaje para ' +
            formatClientPhoneDisplay(clientPhone) +
            '. Revisá el texto, adjuntá el PDF descargado y enviá desde tu WhatsApp Business (+506 7024-0270).',
          false
        );
      })
      .catch(function (e) {
        showPdfMsg(root, e.message || 'No se pudo preparar el envío por WhatsApp.', true);
      })
      .finally(function () {
        if (triggerEl) triggerEl.disabled = false;
      });
  }

  function patchWorkflowStatus(root, status, triggerEl) {
    if (!currentSavedQuoteId) {
      showHistoryMsg(root, 'Guardá o cargá una cotización primero.', true);
      return Promise.resolve();
    }
    if (triggerEl) triggerEl.disabled = true;
    return api('/api/admin/cost-quotes/' + encodeURIComponent(currentSavedQuoteId) + '/status', {
      method: 'PATCH',
      body: { status: status },
    })
      .then(function (data) {
        if (data.quote) {
          workflowMeta.status = data.quote.workflowStatus || status;
          workflowMeta.linkedOrderId = data.quote.linkedOrderId || workflowMeta.linkedOrderId;
        } else {
          workflowMeta.status = status;
        }
        if (data.order && data.order.id) {
          workflowMeta.linkedOrderId = data.order.id;
          workflowMeta.status = 'aprobada';
        }
        return loadHistoryList().then(function () {
          refresh(root, true);
          showHistoryMsg(root, 'Estado actualizado: ' + workflowLabel(workflowMeta.status) + '.');
        });
      })
      .catch(function (e) {
        showHistoryMsg(root, e.message || 'No se pudo actualizar el estado.', true);
      })
      .finally(function () {
        if (triggerEl) triggerEl.disabled = false;
      });
  }

  function loadCatalog() {
    return api('/api/admin/cost-quote-catalog')
      .then(function (data) {
        catalogApiAvailable = true;
        catalog = {
          additionals: Array.isArray(data.additionals) ? data.additionals : [],
          printers: Array.isArray(data.printers) ? data.printers : [],
          materials: Array.isArray(data.materials) ? data.materials : [],
        };
        if (!catalog.printers.length || !catalog.materials.length) {
          var defaults = defaultCatalog();
          if (!catalog.printers.length) catalog.printers = defaults.printers;
          if (!catalog.materials.length) catalog.materials = defaults.materials;
        }
        saveCatalogLocal(catalog);
        syncCostSelections(state);
      })
      .catch(function () {
        catalogApiAvailable = false;
        catalog = loadCatalogLocal();
        if (!catalog.printers.length || !catalog.materials.length) {
          var defaults = defaultCatalog();
          if (!catalog.printers.length) catalog.printers = defaults.printers;
          if (!catalog.materials.length) catalog.materials = defaults.materials;
        }
        syncCostSelections(state);
      });
  }

  function showCatalogMsg(root, text, isErr) {
    var el = $('#cq-catalog-msg', root);
    if (!el) return;
    if (!text) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = 'cq-history-msg' + (isErr ? ' cq-history-msg--err' : ' cq-history-msg--ok');
  }

  function resetCatalogForm(kind) {
    if (kind === 'additional') {
      var idEl = document.getElementById('cq-catalog-additional-id');
      var descEl = document.getElementById('cq-catalog-additional-desc');
      var priceEl = document.getElementById('cq-catalog-additional-price');
      var cancelEl = document.getElementById('cq-catalog-additional-cancel');
      if (idEl) idEl.value = '';
      if (descEl) descEl.value = '';
      if (priceEl) priceEl.value = '0';
      if (cancelEl) cancelEl.hidden = true;
    } else if (kind === 'printer') {
      var pid = document.getElementById('cq-catalog-printer-id');
      var pname = document.getElementById('cq-catalog-printer-name');
      var prate = document.getElementById('cq-catalog-printer-rate');
      var pcancel = document.getElementById('cq-catalog-printer-cancel');
      if (pid) pid.value = '';
      if (pname) pname.value = '';
      if (prate) prate.value = '300';
      if (pcancel) pcancel.hidden = true;
    } else if (kind === 'material') {
      var mid = document.getElementById('cq-catalog-material-id');
      var mname = document.getElementById('cq-catalog-material-name');
      var mprice = document.getElementById('cq-catalog-material-price');
      var mcancel = document.getElementById('cq-catalog-material-cancel');
      if (mid) mid.value = '';
      if (mname) mname.value = '';
      if (mprice) mprice.value = '20500';
      if (mcancel) mcancel.hidden = true;
    }
  }

  function applyCatalogResponse(data) {
    if (data && data.catalog) {
      catalog = data.catalog;
      saveCatalogLocal(catalog);
      syncCostSelections(state);
    }
  }

  function catalogSavedMsg(wasEdit, localFallback) {
    var base = wasEdit ? 'Registro actualizado.' : 'Registro creado.';
    if (localFallback) {
      return base + ' Guardado en este navegador (desplegá el servidor para sincronizar en producción).';
    }
    return base;
  }

  function getTabOrder(root) {
    return Array.prototype.slice
      .call(
        root.querySelectorAll(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
        )
      )
      .filter(function (el) {
        if (el.tabIndex < 0) return false;
        if (el.closest('[hidden]')) return false;
        // Catalog CRUD drafts are not in quote state — normal browser Tab only.
        if (el.closest('.cq-catalog-form, .cq-catalog-panel')) return false;
        return el.offsetParent !== null || el.getClientRects().length > 0;
      });
  }

  function focusFieldById(id) {
    if (!id) return;
    var el = document.getElementById(id);
    if (!el || el.disabled) return;
    el.focus({ preventScroll: true });
    if (typeof el.select === 'function' && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
      try {
        el.select();
      } catch (e) { /* ignore */ }
    }
  }

  function refresh(root, skipRead, restoreFocusId) {
    var focusId = restoreFocusId || '';
    if (!focusId) {
      var active = document.activeElement;
      if (active && root.contains(active) && active.id) focusId = active.id;
    }
    if (!skipRead) {
      state = readStateFromDom(root, state);
    }
    var result = computeAll(state);
    saveStateLocal(state);
    render(root, state, result);
    bind(root);
    focusFieldById(focusId);
  }

  function salePriceIndexFromId(id) {
    if (!id) return -1;
    var m = String(id).match(/^cq-salePrice-(\d+)$/);
    return m ? parseInt(m[1], 10) : -1;
  }

  function commitField(root, input, opts) {
    opts = opts || {};
    var saleIdx = input ? salePriceIndexFromId(input.id) : -1;
    if (saleIdx >= 0) {
      state = readStateFromDom(root, state);
      updateSalePriceTouchedFromDom(root, state, saleIdx);
    }
    var restoreId = opts.restoreFocusId || (input && input.id) || '';
    refresh(root, false, restoreId);
  }

  function onFieldTabKey(e, field, root) {
    if (e.key === 'Enter' && field.tagName !== 'TEXTAREA' && field.tagName !== 'SELECT') {
      e.preventDefault();
      field.blur();
      return;
    }
    if (e.key !== 'Tab') return;
    var fields = getTabOrder(root);
    var idx = fields.indexOf(field);
    if (idx === -1) return;
    var nextIdx = e.shiftKey ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= fields.length) return;
    var nextId = fields[nextIdx].id;
    if (!nextId) return;
    e.preventDefault();
    root._cqFocusNav = true;
    var saleIdx = salePriceIndexFromId(field.id);
    if (saleIdx >= 0) {
      state = readStateFromDom(root, state);
      updateSalePriceTouchedFromDom(root, state, saleIdx);
    }
    refresh(root, false, nextId);
    window.setTimeout(function () {
      root._cqFocusNav = false;
    }, 0);
  }

  function bindTabNavigation(root) {
    getTabOrder(root).forEach(function (field) {
      if (field._cqTabBound) return;
      field._cqTabBound = true;
      field.addEventListener('keydown', function (e) {
        onFieldTabKey(e, field, root);
      });
    });
  }

  function bindCommitInput(input, root) {
    if (!input || input._cqBound) return;
    input._cqBound = true;
    input.addEventListener('change', function () {
      if (root._cqFocusNav) return;
      commitField(root, input, { restoreFocusId: input.id });
    });
  }

  function bind(root) {
    root.querySelectorAll('input[data-cq-field]').forEach(function (input) {
      bindCommitInput(input, root);
    });
    root.querySelectorAll('select[data-cq-field]').forEach(function (sel) {
      bindCommitInput(sel, root);
    });
    root.querySelectorAll('textarea[data-cq-field]').forEach(function (ta) {
      bindCommitInput(ta, root);
    });

    root.querySelectorAll('[data-cq-panel]').forEach(function (btn) {
      if (btn._cqBound) return;
      btn._cqBound = true;
      btn.addEventListener('click', function () {
        var panel = btn.getAttribute('data-cq-panel') || 'quote';
        if (isRestrictedPartner() && panel !== 'quote' && panel !== 'additionals') return;
        if (panel === activePanel) return;
        if (panel === 'quote' && activePanel !== 'quote') {
          startFreshQuote(root);
          return;
        }
        if (activePanel === 'quote') {
          confirmLeaveQuoteWorkflow(root).then(function (ok) {
            if (!ok) return;
            activePanel = panel;
            refresh(root);
          });
          return;
        }
        activePanel = panel;
        refresh(root);
      });
    });

    root.querySelectorAll('[data-cq-additional-pick]').forEach(function (sel) {
      if (sel._cqBound) return;
      sel._cqBound = true;
      sel.addEventListener('change', function () {
        var key = sel.getAttribute('data-cq-additional-pick');
        var item = catalog.additionals.find(function (a) {
          return a.id === sel.value;
        });
        if (!item) return;
        var desc = $('#cq-additional-' + key + '-desc', root);
        var price = $('#cq-additional-' + key + '-price', root);
        if (desc) desc.value = item.description;
        if (price) price.value = item.price;
        commitField(root, desc || price);
      });
    });

    root.querySelectorAll('[data-cq-toggle-qty-input-mode]').forEach(function (btn) {
      if (btn._cqBound) return;
      btn._cqBound = true;
      btn.addEventListener('click', function () {
        var productIdx = parseInt(btn.getAttribute('data-cq-toggle-qty-input-mode'), 10);
        if (!Number.isFinite(productIdx)) return;
        state = readStateFromDom(root, state);
        ensureProducts(state);
        if (!state.products[productIdx]) return;
        var prod = state.products[productIdx];
        if (getProductQty(prod) <= 1) return;
        prod.qtyInputMode = prod.qtyInputMode === 'total' ? 'unit' : 'total';
        refresh(root, true);
      });
    });

    root.querySelectorAll('[data-cq-add-additional]').forEach(function (btn) {
      if (btn._cqBound) return;
      btn._cqBound = true;
      btn.addEventListener('click', function () {
        var productIdx = parseInt(btn.getAttribute('data-cq-add-additional'), 10);
        if (!Number.isFinite(productIdx)) return;
        state = readStateFromDom(root, state);
        ensureProducts(state);
        if (!state.products[productIdx]) return;
        if (!Array.isArray(state.products[productIdx].additionals)) {
          state.products[productIdx].additionals = [];
        }
        state.products[productIdx].additionals.push({ price: 0, description: '', showOnInvoice: true });
        refresh(root, true);
      });
    });

    root.querySelectorAll('[data-cq-remove-additional]').forEach(function (btn) {
      if (btn._cqBound) return;
      btn._cqBound = true;
      btn.addEventListener('click', function () {
        var parts = String(btn.getAttribute('data-cq-remove-additional') || '').split('-');
        var productIdx = parseInt(parts[0], 10);
        var addIdx = parseInt(parts[1], 10);
        if (!Number.isFinite(productIdx) || !Number.isFinite(addIdx)) return;
        state = readStateFromDom(root, state);
        ensureProducts(state);
        if (!state.products[productIdx] || !Array.isArray(state.products[productIdx].additionals)) return;
        state.products[productIdx].additionals.splice(addIdx, 1);
        refresh(root, true);
      });
    });

    var addProductBtn = $('#cq-add-product', root);
    if (addProductBtn && !addProductBtn._cqBound) {
      addProductBtn._cqBound = true;
      addProductBtn.addEventListener('click', function () {
        state = readStateFromDom(root, state);
        ensureProducts(state);
        state.products.push(defaultProduct({ name: 'Producto ' + (state.products.length + 1) }));
        refresh(root, true);
      });
    }

    root.querySelectorAll('[data-cq-remove-product]').forEach(function (btn) {
      if (btn._cqBound) return;
      btn._cqBound = true;
      btn.addEventListener('click', function () {
        var productIdx = parseInt(btn.getAttribute('data-cq-remove-product'), 10);
        if (!Number.isFinite(productIdx)) return;
        state = readStateFromDom(root, state);
        ensureProducts(state);
        if (state.products.length <= 1) return;
        if (!confirm('¿Eliminar este producto de la cotización?')) return;
        state.products.splice(productIdx, 1);
        refresh(root, true);
      });
    });

    root.querySelectorAll('[data-cq-toggle-cost-breakdown]').forEach(function (btn) {
      if (btn._cqBound) return;
      btn._cqBound = true;
      btn.addEventListener('click', function () {
        var productIdx = parseInt(btn.getAttribute('data-cq-toggle-cost-breakdown'), 10);
        if (!Number.isFinite(productIdx)) return;
        costBreakdownOpenByProduct[productIdx] = !costBreakdownOpenByProduct[productIdx];
        refresh(root, true);
      });
    });

    bindCatalogPanel(root);

    var wholesaleBtn = $('#cq-toggle-wholesale', root);
    if (wholesaleBtn && !wholesaleBtn._cqBound) {
      wholesaleBtn._cqBound = true;
      wholesaleBtn.addEventListener('click', function () {
        state.wholesaleMode = !state.wholesaleMode;
        saveStateLocal(state);
        refresh(root);
      });
    }

    var historySel = $('#cq-history-select', root);
    if (historySel && !historySel._cqBound) {
      historySel._cqBound = true;
      historySel.addEventListener('change', function () {
        var id = historySel.value;
        if (!id) return;
        loadQuoteFromHistory(root, id);
      });
    }

    var newQuoteBtn = $('#cq-new-quote', root);
    if (newQuoteBtn && !newQuoteBtn._cqBound) {
      newQuoteBtn._cqBound = true;
      newQuoteBtn.addEventListener('click', function () {
        if (hasQuoteWorkInProgress(root)) {
          if (!confirm('¿Empezar una cotización nueva? Los cambios no guardados se perderán.')) return;
        }
        resetQuoteProductForNew({ keepProductName: true });
        var sel = $('#cq-history-select', root);
        if (sel) sel.value = '';
        refresh(root, true);
        showHistoryMsg(root, 'Cotización nueva. Sin adicionales hasta que agregues uno.');
      });
    }

    var saveBtn = $('#cq-save-quote', root);
    if (saveBtn && !saveBtn._cqBound) {
      saveBtn._cqBound = true;
      saveBtn.addEventListener('click', function () {
        saveCurrentQuote(root, saveBtn);
      });
    }

    var saveBtnMobile = $('#cq-save-quote-mobile', root);
    if (saveBtnMobile && !saveBtnMobile._cqBound) {
      saveBtnMobile._cqBound = true;
      saveBtnMobile.addEventListener('click', function () {
        saveCurrentQuote(root, saveBtnMobile);
      });
    }

    var delBtn = $('#cq-delete-quote', root);
    if (delBtn && !delBtn._cqBound) {
      delBtn._cqBound = true;
      delBtn.addEventListener('click', function () {
        var sel = $('#cq-history-select', root);
        var id = sel ? sel.value : '';
        if (!id) {
          showHistoryMsg(root, 'Seleccioná una cotización para eliminar.', true);
          return;
        }
        if (!confirm('¿Eliminar esta cotización del historial?')) return;
        delBtn.disabled = true;
        api('/api/admin/cost-quotes/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function () {
            return loadHistoryList().then(function () {
              refresh(root);
              showHistoryMsg(root, 'Cotización eliminada.');
            });
          })
          .catch(function (e) {
            showHistoryMsg(root, e.message || 'No se pudo eliminar.', true);
          })
          .finally(function () {
            delBtn.disabled = false;
          });
      });
    }

    var ivaCheck = $('#cq-includeIva', root);
    if (ivaCheck && !ivaCheck._cqBound) {
      ivaCheck._cqBound = true;
      ivaCheck.addEventListener('change', function () {
        state = readStateFromDom(root, state);
        saveStateLocal(state);
      });
    }

    var pdfBtn = $('#cq-export-pdf', root);
    if (pdfBtn && !pdfBtn._cqBound) {
      pdfBtn._cqBound = true;
      pdfBtn.addEventListener('click', function () {
        state = readStateFromDom(root, state);
        var exp = state.export || {};
        var clientName = String(exp.clientName || '').trim();
        if (!clientName) {
          showPdfMsg(root, 'Escribí el nombre del cliente antes de generar el PDF.', true);
          return;
        }
        if (!global.AdminCostQuotePdf) {
          showPdfMsg(root, 'Módulo PDF no cargado. Recargá la página.', true);
          return;
        }
        var result = computeAll(state);
        pdfBtn.disabled = true;
        showPdfMsg(root, 'Generando PDF…', false);
        global.AdminCostQuotePdf.generate({
          clientName: clientName,
          orderTitle: exp.orderTitle,
          description: exp.description || 'Impresión 3D de alta calidad.',
          productTitle: getQuoteDisplayName(state),
          deliveryDays: exp.deliveryDays,
          extraNotes: exp.extraNotes,
          includeIva: !!exp.includeIva,
          wholesaleMode: !!state.wholesaleMode,
          discountNote: buildDiscountNote(state, result),
          state: state,
          result: result,
        })
          .then(function () {
            pdfReadyInSession = true;
            var filename = global.AdminCostQuotePdf.buildFilename(clientName);
            showPdfMsg(root, 'PDF descargado: ' + filename + '.');
            saveStateLocal(state);
            refresh(root, true);
          })
          .catch(function (e) {
            showPdfMsg(root, e.message || 'No se pudo generar el PDF.', true);
          })
          .finally(function () {
            pdfBtn.disabled = false;
          });
      });
    }

    var saveOrderBtn = $('#cq-save-order', root);
    if (saveOrderBtn && !saveOrderBtn._cqBound) {
      saveOrderBtn._cqBound = true;
      saveOrderBtn.addEventListener('click', function () {
        saveOrderFromExport(root, saveOrderBtn);
      });
    }

    var sendBtn = $('#cq-send-order', root);
    if (sendBtn && !sendBtn._cqBound) {
      sendBtn._cqBound = true;
      sendBtn.addEventListener('click', function () {
        if (!confirm('¿Enviar la orden por correo al cliente con los links de pago?')) return;
        sendOrderByEmail(root, sendBtn);
      });
    }

    var sendWhatsAppBtn = $('#cq-send-whatsapp', root);
    if (sendWhatsAppBtn && !sendWhatsAppBtn._cqBound) {
      sendWhatsAppBtn._cqBound = true;
      sendWhatsAppBtn.addEventListener('click', function () {
        if (
          !confirm(
            'Se abrirá WhatsApp con el mensaje listo para el cliente.\n\nTambién se descargará el PDF para que lo adjuntes manualmente.\n\n¿Continuar?'
          )
        ) {
          return;
        }
        sendOrderByWhatsApp(root, sendWhatsAppBtn);
      });
    }

    var statusSelect = $('#cq-workflow-status-select', root);
    if (statusSelect && !statusSelect._cqBound) {
      statusSelect._cqBound = true;
      statusSelect.addEventListener('change', function () {
        var next = statusSelect.value;
        if (!next || next === workflowMeta.status) return;
        if (next === 'aprobada') {
          if (!confirm('¿Aprobar esta cotización y crear el pedido?')) {
            statusSelect.value = workflowMeta.status;
            return;
          }
        } else if (!confirm('¿Cambiar el estado a «' + workflowLabel(next) + '»?')) {
          statusSelect.value = workflowMeta.status;
          return;
        }
        patchWorkflowStatus(root, next, statusSelect);
      });
    }

    var approveBtn = $('#cq-approve-quote', root);
    if (approveBtn && !approveBtn._cqBound) {
      approveBtn._cqBound = true;
      approveBtn.addEventListener('click', function () {
        if (!confirm('¿Aprobar el comprobante y crear el pedido pendiente?')) return;
        patchWorkflowStatus(root, 'aprobada', approveBtn);
      });
    }

    bindTabNavigation(root);
  }

  function bindCatalogPanel(root) {
    if (activePanel === 'additionals') bindAdditionalCatalog(root);
    if (!isRestrictedPartner()) {
      if (activePanel === 'printers') bindPrinterCatalog(root);
      if (activePanel === 'materials') bindMaterialCatalog(root);
    }

    root.querySelectorAll('[data-cq-catalog-edit]').forEach(function (btn) {
      if (btn._cqBound) return;
      btn._cqBound = true;
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-cq-catalog-edit');
        if (isRestrictedPartner() && kind !== 'additional') return;
        var id = btn.getAttribute('data-id');
        if (kind === 'additional') {
          var item = catalog.additionals.find(function (a) {
            return a.id === id;
          });
          if (!item) return;
          var idEl = $('#cq-catalog-additional-id', root);
          var descEl = $('#cq-catalog-additional-desc', root);
          var priceEl = $('#cq-catalog-additional-price', root);
          var cancelEl = $('#cq-catalog-additional-cancel', root);
          if (idEl) idEl.value = item.id;
          if (descEl) descEl.value = item.description;
          if (priceEl) priceEl.value = item.price;
          if (cancelEl) cancelEl.hidden = false;
        } else if (kind === 'printer') {
          var printer = catalog.printers.find(function (p) {
            return p.id === id;
          });
          if (!printer) return;
          var pid = $('#cq-catalog-printer-id', root);
          var pname = $('#cq-catalog-printer-name', root);
          var prate = $('#cq-catalog-printer-rate', root);
          var pcancel = $('#cq-catalog-printer-cancel', root);
          if (pid) pid.value = printer.id;
          if (pname) pname.value = printer.name;
          if (prate) prate.value = printer.hourRate;
          if (pcancel) pcancel.hidden = false;
        } else if (kind === 'material') {
          var material = catalog.materials.find(function (m) {
            return m.id === id;
          });
          if (!material) return;
          var mid = $('#cq-catalog-material-id', root);
          var mname = $('#cq-catalog-material-name', root);
          var mprice = $('#cq-catalog-material-price', root);
          var mcancel = $('#cq-catalog-material-cancel', root);
          if (mid) mid.value = material.id;
          if (mname) mname.value = material.name;
          if (mprice) mprice.value = material.kgPrice;
          if (mcancel) mcancel.hidden = false;
        }
      });
    });

    root.querySelectorAll('[data-cq-catalog-del]').forEach(function (btn) {
      if (btn._cqBound) return;
      btn._cqBound = true;
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-cq-catalog-del');
        if (isRestrictedPartner() && kind !== 'additional') return;
        var id = btn.getAttribute('data-id');
        var path =
          kind === 'additional'
            ? '/api/admin/cost-quote-catalog/additionals/'
            : kind === 'printer'
              ? '/api/admin/cost-quote-catalog/printers/'
              : '/api/admin/cost-quote-catalog/materials/';
        if (!confirm('¿Eliminar este registro?')) return;
        btn.disabled = true;
        deleteCatalogViaApi(path, id, function (delId) {
          if (kind === 'additional') return deleteAdditionalLocal(delId);
          if (kind === 'printer') return deletePrinterLocal(delId);
          return deleteMaterialLocal(delId);
        })
          .then(function (result) {
            resetCatalogForm(kind);
            refresh(root);
            showCatalogMsg(
              root,
              result.localFallback
                ? 'Eliminado en este navegador. Desplegá el servidor para sincronizar en producción.'
                : 'Registro eliminado.'
            );
          })
          .catch(function (e) {
            showCatalogMsg(root, e.message || 'No se pudo eliminar.', true);
          })
          .finally(function () {
            btn.disabled = false;
          });
      });
    });
  }

  function bindAdditionalCatalog(root) {
    var saveBtn = $('#cq-catalog-additional-save', root);
    var cancelBtn = $('#cq-catalog-additional-cancel', root);
    if (saveBtn && !saveBtn._cqBound) {
      saveBtn._cqBound = true;
      saveBtn.addEventListener('click', function () {
        var idEl = $('#cq-catalog-additional-id', root);
        var descEl = $('#cq-catalog-additional-desc', root);
        var priceEl = $('#cq-catalog-additional-price', root);
        saveBtn.disabled = true;
        var body = {
          id: idEl ? idEl.value : '',
          description: descEl ? descEl.value : '',
          price: priceEl ? priceEl.value : 0,
        };
        saveCatalogViaApi('/api/admin/cost-quote-catalog/additionals', body, upsertAdditionalLocal)
          .then(function (result) {
            resetCatalogForm('additional');
            refresh(root);
            showCatalogMsg(root, catalogSavedMsg(!!body.id, result.localFallback));
          })
          .catch(function (e) {
            showCatalogMsg(root, e.message || 'No se pudo guardar.', true);
          })
          .finally(function () {
            saveBtn.disabled = false;
          });
      });
    }
    if (cancelBtn && !cancelBtn._cqBound) {
      cancelBtn._cqBound = true;
      cancelBtn.addEventListener('click', function () {
        resetCatalogForm('additional');
        cancelBtn.hidden = true;
      });
    }
  }

  function bindPrinterCatalog(root) {
    var saveBtn = $('#cq-catalog-printer-save', root);
    var cancelBtn = $('#cq-catalog-printer-cancel', root);
    if (saveBtn && !saveBtn._cqBound) {
      saveBtn._cqBound = true;
      saveBtn.addEventListener('click', function () {
        var idEl = $('#cq-catalog-printer-id', root);
        var nameEl = $('#cq-catalog-printer-name', root);
        var rateEl = $('#cq-catalog-printer-rate', root);
        saveBtn.disabled = true;
        var body = {
          id: idEl ? idEl.value : '',
          name: nameEl ? nameEl.value : '',
          hourRate: rateEl ? rateEl.value : 0,
        };
        saveCatalogViaApi('/api/admin/cost-quote-catalog/printers', body, upsertPrinterLocal)
          .then(function (result) {
            resetCatalogForm('printer');
            refresh(root);
            showCatalogMsg(root, catalogSavedMsg(!!body.id, result.localFallback));
          })
          .catch(function (e) {
            showCatalogMsg(root, e.message || 'No se pudo guardar.', true);
          })
          .finally(function () {
            saveBtn.disabled = false;
          });
      });
    }
    if (cancelBtn && !cancelBtn._cqBound) {
      cancelBtn._cqBound = true;
      cancelBtn.addEventListener('click', function () {
        resetCatalogForm('printer');
        cancelBtn.hidden = true;
      });
    }
  }

  function bindMaterialCatalog(root) {
    var saveBtn = $('#cq-catalog-material-save', root);
    var cancelBtn = $('#cq-catalog-material-cancel', root);
    if (saveBtn && !saveBtn._cqBound) {
      saveBtn._cqBound = true;
      saveBtn.addEventListener('click', function () {
        var idEl = $('#cq-catalog-material-id', root);
        var nameEl = $('#cq-catalog-material-name', root);
        var priceEl = $('#cq-catalog-material-price', root);
        saveBtn.disabled = true;
        var body = {
          id: idEl ? idEl.value : '',
          name: nameEl ? nameEl.value : '',
          kgPrice: priceEl ? priceEl.value : 0,
        };
        saveCatalogViaApi('/api/admin/cost-quote-catalog/materials', body, upsertMaterialLocal)
          .then(function (result) {
            resetCatalogForm('material');
            refresh(root);
            showCatalogMsg(root, catalogSavedMsg(!!body.id, result.localFallback));
          })
          .catch(function (e) {
            showCatalogMsg(root, e.message || 'No se pudo guardar.', true);
          })
          .finally(function () {
            saveBtn.disabled = false;
          });
      });
    }
    if (cancelBtn && !cancelBtn._cqBound) {
      cancelBtn._cqBound = true;
      cancelBtn.addEventListener('click', function () {
        resetCatalogForm('material');
        cancelBtn.hidden = true;
      });
    }
  }

  function mount(opts) {
    opts = opts || {};
    partnerMode = !!opts.partnerMode;
    if (partnerMode && activePanel !== 'quote' && activePanel !== 'additionals') {
      activePanel = 'quote';
    }
    var root = document.getElementById('admin-cost-quote-app');
    if (!root) return;
    mounted = true;
    var persisted = loadState();
    state = migrateState(deepClone(DEFAULTS));
    state.costs = persisted.costs;
    state.discounts = persisted.discounts;
    state.discountRanges = persisted.discountRanges;
    state.scenarioQty = persisted.scenarioQty;
    state.wholesaleMode = persisted.wholesaleMode;
    resetQuoteProductForNew({ keepProductName: false, resetExport: true });
    activePanel = 'quote';
    Promise.all([loadHistoryList(), loadCatalog()]).then(function () {
      syncCostSelections(state);
      render(root, state, computeAll(state));
      bind(root);
    });
  }

  function beforeLeaveAdminTab() {
    var root = document.getElementById('admin-cost-quote-app');
    if (!root || !mounted) return Promise.resolve(true);
    return confirmLeaveQuoteWorkflow(root);
  }

  global.AdminCostQuote = {
    mount: mount,
    fmtCrc: fmtCrc,
    beforeLeaveAdminTab: beforeLeaveAdminTab,
  };
})(typeof window !== 'undefined' ? window : this);
