/**
 * Cotización 3D admin controller — API adapter for proven ninjalab3dcr frontend.
 */
const csrf = require('../config/csrf');
const calculator = require('../services/costQuoteCalculator');
const catalogStore = require('../services/costQuoteCatalogStore');
const quoteStore = require('../services/costQuoteStore');

function getProductsFromSnapshot(snapshot) {
  return quoteStore.getProductsFromSnapshot(snapshot);
}

exports.showCotizacion = async (req, res, next) => {
  try {
    res.render('pages/admin/cost-quote', {
      title: 'Cotización 3D',
      layout: 'layouts/admin',
      pageStyles: ['/css/admin-cost-quote.css', '/css/cost-quote-pdf-template.css'],
      pageScripts: [
        'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        '/js/admin/tilopay-fees.js',
        '/js/admin/admin-cost-quote-pdf.js',
        '/js/admin/admin-cost-quote.js',
        '/js/admin/admin-cost-quote-boot.js',
      ],
      currentPath: '/admin/cotizacion-3d',
      csrfToken: csrf.generateToken(req),
    });
  } catch (err) {
    next(err);
  }
};

// ── Catalog API ──

exports.getCatalog = async (req, res, next) => {
  try {
    res.json(await catalogStore.getCatalog());
  } catch (err) {
    next(err);
  }
};

exports.upsertAdditional = async (req, res, next) => {
  try {
    const r = await catalogStore.upsertAdditional(req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    next(err);
  }
};

exports.deleteAdditional = async (req, res, next) => {
  try {
    const r = await catalogStore.deleteAdditional(req.params.id);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    next(err);
  }
};

exports.upsertPrinter = async (req, res, next) => {
  try {
    const r = await catalogStore.upsertPrinter(req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    next(err);
  }
};

exports.deletePrinter = async (req, res, next) => {
  try {
    const r = await catalogStore.deletePrinter(req.params.id);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    next(err);
  }
};

exports.upsertMaterial = async (req, res, next) => {
  try {
    const r = await catalogStore.upsertMaterial(req.body || {});
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    next(err);
  }
};

exports.deleteMaterial = async (req, res, next) => {
  try {
    const r = await catalogStore.deleteMaterial(req.params.id);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    next(err);
  }
};

// ── Quotes API ──

exports.listQuotes = async (req, res, next) => {
  try {
    res.json(await quoteStore.listCostQuotes());
  } catch (err) {
    next(err);
  }
};

exports.loadQuote = async (req, res, next) => {
  try {
    const record = await quoteStore.getCostQuoteRecord(String(req.params.id || ''));
    if (!record) return res.status(404).json({ error: 'Cotización no encontrada.' });
    res.json({
      ok: true,
      payload: record.payload,
      workflow: {
        status: record.workflowStatus,
        clientEmail: record.clientEmail,
        clientName: record.clientName,
        totalCrc: record.totalCrc,
        linkedOrderId: record.linkedOrderId,
        publicToken: record.publicToken,
        workflowData: record.workflowData,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.saveQuote = async (req, res, next) => {
  try {
    const body = req.body || {};
    const r = await quoteStore.saveCostQuote(body.snapshot || body, body.productName, {
      id: body.id,
      clientEmail: body.clientEmail,
      clientName: body.clientName,
      pdfGeneratedAt: body.pdfGeneratedAt,
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    next(err);
  }
};

exports.deleteQuote = async (req, res, next) => {
  try {
    const r = await quoteStore.deleteCostQuote(req.params.id);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    next(err);
  }
};

exports.patchWorkflowStatus = async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    const status = quoteStore.normalizeStatus(req.body && req.body.status);
    const record = await quoteStore.getCostQuoteRecord(id);
    if (!record) return res.status(404).json({ error: 'Cotización no encontrada.' });

    const patch = { ...(req.body || {}) };
    if (status === 'enviada') patch.sentAt = Date.now();
    if (status === 'aprobada') patch.approvedAt = Date.now();

    const updated = await quoteStore.setWorkflowStatus(id, status, patch);
    res.json({ ok: true, quote: updated });
  } catch (err) {
    next(err);
  }
};

exports.sendOrder = async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    let record = await quoteStore.getCostQuoteRecord(id);
    if (!record) return res.status(404).json({ error: 'Cotización no encontrada.' });

    const clientEmail = String((req.body && req.body.clientEmail) || record.clientEmail || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      return res.status(400).json({ error: 'Indicá un correo válido del cliente.' });
    }
    const clientName = String((req.body && req.body.clientName) || record.clientName || '').trim();

    let snapshot = null;
    if (req.body && req.body.snapshot) {
      try {
        snapshot = typeof req.body.snapshot === 'string'
          ? JSON.parse(req.body.snapshot)
          : req.body.snapshot;
      } catch {
        return res.status(400).json({ error: 'Datos de cotización inválidos.' });
      }
    }
    if (snapshot) {
      const productName = String(
        snapshot.product?.name || quoteStore.getQuoteDisplayName(snapshot, record.productName) || ''
      ).trim();
      const saveResult = await quoteStore.saveCostQuote(snapshot, productName, {
        id,
        clientEmail,
        clientName,
      });
      if (!saveResult.ok) return res.status(400).json({ error: saveResult.error });
      record = await quoteStore.getCostQuoteRecord(id);
    }

    const pdfTotal = Number(req.body && req.body.totalCrc);
    const totalForEmail =
      Number.isFinite(pdfTotal) && pdfTotal > 0
        ? Math.round(pdfTotal)
        : calculator.computeQuoteTotal(record.payload || {});

    const updated = await quoteStore.setWorkflowStatus(id, 'enviada', {
      sentAt: Date.now(),
      clientEmail,
      clientName,
      totalCrc: totalForEmail,
    });

    console.log(`[cotizacion-3d] Order email requested to ${clientEmail} — total ${totalForEmail}`);
    res.json({ ok: true, quote: updated, urls: { publicUrl: `/cotizacion-3d/pago/${updated.publicToken}` } });
  } catch (err) {
    next(err);
  }
};

exports.whatsappAssist = async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    let record = await quoteStore.getCostQuoteRecord(id);
    if (!record) return res.status(404).json({ error: 'Cotización no encontrada.' });

    const clientPhone = String(
      (req.body && req.body.clientPhone) || record.payload?.export?.clientPhone || ''
    ).trim();
    if (!clientPhone) {
      return res.status(400).json({ error: 'Indicá un teléfono válido del cliente (ej. +506 8888-8888).' });
    }
    const clientName = String((req.body && req.body.clientName) || record.clientName || '').trim();

    let snapshot = null;
    if (req.body && req.body.snapshot) {
      try {
        snapshot = typeof req.body.snapshot === 'string'
          ? JSON.parse(req.body.snapshot)
          : req.body.snapshot;
      } catch {
        return res.status(400).json({ error: 'Datos de cotización inválidos.' });
      }
    }
    if (snapshot) {
      const productName = String(
        snapshot.product?.name || quoteStore.getQuoteDisplayName(snapshot, record.productName) || ''
      ).trim();
      const saveResult = await quoteStore.saveCostQuote(snapshot, productName, {
        id,
        clientEmail: String(record.clientEmail || snapshot.export?.clientEmail || '').trim(),
        clientName,
      });
      if (!saveResult.ok) return res.status(400).json({ error: saveResult.error });
      record = await quoteStore.getCostQuoteRecord(id);
    }

    const pdfTotal = Number(req.body && req.body.totalCrc);
    const total =
      Number.isFinite(pdfTotal) && pdfTotal > 0
        ? Math.round(pdfTotal)
        : calculator.computeQuoteTotal(record.payload || {});
    const publicUrl = `${req.protocol}://${req.get('host')}/cotizacion-3d/pago/${record.publicToken}`;
    const message =
      `Hola${clientName ? ' ' + clientName : ''}, te comparto tu cotización 3D de NinjaLab.\n` +
      `Total: ₡${total.toLocaleString('es-CR')}\n` +
      `Ver detalle: ${publicUrl}`;

    res.json({
      ok: true,
      assist: {
        phone: clientPhone,
        message,
        waUrl: `https://wa.me/${clientPhone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`,
      },
      quote: record,
    });
  } catch (err) {
    next(err);
  }
};

// ── Public pages ──

exports.publicQuote = async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).send('Token inválido.');

    const quote = await quoteStore.getCostQuoteByToken(token);
    if (!quote) return res.status(404).send('Cotización no encontrada.');

    const payload = quote.payload || {};
    const total = quote.totalCrc || calculator.computeQuoteTotal(payload);

    res.render('pages/cotizacion-publica', {
      title: 'Cotización 3D',
      layout: 'layouts/main',
      quoteId: String(quote.id),
      token,
      clientName: quote.clientName || payload.export?.clientName || 'Cliente',
      productName: quote.productName || 'Cotización 3D',
      total,
      status: quote.workflowStatus,
      products: getProductsFromSnapshot(payload).map((p) => ({
        name: p.name || 'Producto',
        quantity: p.quantity || 1,
      })),
      csrfToken: csrf.generateToken(req),
    });
  } catch (err) {
    next(err);
  }
};

exports.publicConfirm = async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    const quote = await quoteStore.getCostQuoteByToken(token);
    if (!quote) return res.status(404).send('Cotización no encontrada.');

    if (quote.workflowStatus === 'aprobada') {
      return res.render('pages/cotizacion-publica', {
        title: 'Cotización confirmada',
        layout: 'layouts/main',
        confirmed: true,
        quoteId: quote.id,
        token,
        clientName: quote.clientName || 'Cliente',
        productName: quote.productName,
        total: quote.totalCrc,
        status: 'aprobada',
        products: [],
        csrfToken: csrf.generateToken(req),
      });
    }

    await quoteStore.setWorkflowStatus(quote.id, 'pendiente_aprobacion', {
      proofNote: String(req.body?.note || '').trim(),
      proofUploadedAt: Date.now(),
    });

    res.render('pages/cotizacion-publica', {
      title: 'Cotización enviada',
      layout: 'layouts/main',
      confirmed: true,
      quoteId: quote.id,
      token,
      clientName: quote.clientName || 'Cliente',
      productName: quote.productName,
      total: quote.totalCrc,
      status: 'pendiente_aprobacion',
      products: [],
      csrfToken: csrf.generateToken(req),
    });
  } catch (err) {
    next(err);
  }
};

// Legacy aliases used by older NLSite tests / links
exports.createQuote = exports.saveQuote;
exports.updateQuote = exports.saveQuote;
exports.setWorkflowStatus = exports.patchWorkflowStatus;
