/**
 * Cotización 3D quote store — MySQL adapter for cost_quotes.
 * Behavior matches ninjalab3dcr costQuoteStore against NLSite tables.
 */
const pool = require('../config/db');
const crypto = require('crypto');
const calculator = require('./costQuoteCalculator');

const QUOTE_STATUSES = [
  'pendiente',
  'enviada',
  'pendiente_aprobacion',
  'aprobada',
  'sin_respuesta',
  'cancelada',
];

function normalizeStatus(status) {
  const raw = String(status || 'pendiente')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (raw === 'pendiente_de_aprobacion' || raw === 'pendiente-aprobacion') return 'pendiente_aprobacion';
  return QUOTE_STATUSES.includes(raw) ? raw : 'pendiente';
}

function newPublicToken() {
  return crypto.randomBytes(16).toString('hex');
}

function toEpoch(v) {
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e11) return n;
  if (Number.isFinite(n) && n > 0) return n * (n < 1e11 ? 1000 : 1);
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getProductsFromSnapshot(snapshot) {
  const state = snapshot && typeof snapshot === 'object' ? snapshot : {};
  if (Array.isArray(state.products) && state.products.length) return state.products;
  if (state.product && typeof state.product === 'object') return [state.product];
  return [];
}

function getQuoteDisplayName(snapshot, fallbackName) {
  const products = getProductsFromSnapshot(snapshot);
  const names = products.map((p) => String(p && p.name ? p.name : '').trim()).filter(Boolean);
  if (!names.length) return String(fallbackName || '').trim();
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1} más`;
}

function normalizeSnapshot(input) {
  if (!input || typeof input !== 'object') return null;
  const costs = input.costs && typeof input.costs === 'object' ? input.costs : {};
  const discounts = input.discounts && typeof input.discounts === 'object' ? input.discounts : {};
  const discountRanges =
    input.discountRanges && typeof input.discountRanges === 'object' ? input.discountRanges : {};
  const scenarioQty = input.scenarioQty && typeof input.scenarioQty === 'object' ? input.scenarioQty : {};
  const exportData = input.export && typeof input.export === 'object' ? input.export : {};
  const products = getProductsFromSnapshot(input);
  const product = input.product && typeof input.product === 'object' ? input.product : {};
  const alexPercent = Number(input.alexPercent);
  const globalDiscount =
    input.globalDiscount && typeof input.globalDiscount === 'object'
      ? input.globalDiscount
      : { enabled: false, percent: 0 };
  return {
    costs,
    discounts,
    discountRanges,
    products: products.length ? products : [product],
    product,
    alexPercent: Number.isFinite(alexPercent) ? alexPercent : undefined,
    globalDiscount,
    scenarioQty,
    export: exportData,
  };
}

function buildPayload(snapshot, productName) {
  const data = normalizeSnapshot(snapshot);
  if (!data) return null;
  const src = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const products = (data.products || []).map((p) => ({ ...p }));
  const name = String(productName || getQuoteDisplayName({ products }, '')).trim();
  if (products[0]) products[0].name = String(products[0].name || name).trim() || name;
  const legacyProduct = products[0]
    ? { ...products[0], name: products[0].name || name }
    : { name };
  return {
    costs: data.costs,
    discounts: data.discounts,
    discountRanges: data.discountRanges,
    products,
    product: legacyProduct,
    alexPercent: data.alexPercent,
    globalDiscount: data.globalDiscount,
    scenarioQty: data.scenarioQty,
    wholesaleMode: !!src.wholesaleMode,
    export: data.export,
  };
}

function normalizeWorkflowData(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    sentAt: numOrNull(src.sentAt),
    approvedAt: numOrNull(src.approvedAt),
    proofUploadedAt: numOrNull(src.proofUploadedAt),
    proofFilename: String(src.proofFilename || '').trim(),
    proofNote: String(src.proofNote || '').trim(),
    pdfGeneratedAt: numOrNull(src.pdfGeneratedAt),
    lastEmailError: String(src.lastEmailError || '').trim(),
  };
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToRecord(row) {
  const payload = parseJson(row.payload, {});
  const workflowData = normalizeWorkflowData(parseJson(row.workflow_data, {}));
  const name = String(
    row.product_name || getQuoteDisplayName(payload, payload?.product?.name) || 'Sin nombre'
  ).trim();
  return {
    id: String(row.id),
    productName: name,
    createdAt: toEpoch(row.created_at),
    updatedAt: toEpoch(row.updated_at),
    payload,
    workflowStatus: normalizeStatus(row.workflow_status),
    publicToken: String(row.public_token || '').trim(),
    clientEmail: String(row.client_email || '').trim(),
    clientName: String(row.client_name || '').trim(),
    totalCrc: Number(row.total_crc) || 0,
    linkedOrderId: String(row.linked_order_id || '').trim(),
    pdfFilename: String(row.pdf_filename || '').trim(),
    workflowData,
  };
}

function recordToSummary(record) {
  return {
    id: record.id,
    productName: record.productName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    workflowStatus: record.workflowStatus,
    clientEmail: record.clientEmail,
    clientName: record.clientName,
    totalCrc: record.totalCrc,
    linkedOrderId: record.linkedOrderId,
  };
}

const SELECT_COLS = `id, product_name, created_at, updated_at, payload, workflow_status,
  public_token, client_email, client_name, total_crc, linked_order_id, pdf_filename, workflow_data`;

async function listCostQuotes() {
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLS} FROM cost_quotes ORDER BY updated_at DESC LIMIT 200`
  );
  return rows.map((row) => recordToSummary(rowToRecord(row)));
}

async function getCostQuoteRecord(id) {
  const quoteId = String(id || '').trim();
  if (!quoteId) return null;
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLS} FROM cost_quotes WHERE id = ? LIMIT 1`,
    [quoteId]
  );
  if (!rows.length) return null;
  return rowToRecord(rows[0]);
}

async function getCostQuote(id) {
  const record = await getCostQuoteRecord(id);
  return record ? record.payload : null;
}

async function getCostQuoteByToken(token) {
  const publicToken = String(token || '').trim();
  if (!publicToken) return null;
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLS} FROM cost_quotes WHERE public_token = ? LIMIT 1`,
    [publicToken]
  );
  if (!rows.length) return null;
  return rowToRecord(rows[0]);
}

async function persistRecord(record) {
  const created = new Date(record.createdAt || Date.now());
  const updated = new Date(record.updatedAt || Date.now());
  await pool.query(
    `INSERT INTO cost_quotes (
       id, product_name, payload, workflow_status, public_token, client_email, client_name,
       total_crc, linked_order_id, pdf_filename, workflow_data, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       product_name = VALUES(product_name),
       payload = VALUES(payload),
       workflow_status = VALUES(workflow_status),
       public_token = VALUES(public_token),
       client_email = VALUES(client_email),
       client_name = VALUES(client_name),
       total_crc = VALUES(total_crc),
       linked_order_id = VALUES(linked_order_id),
       pdf_filename = VALUES(pdf_filename),
       workflow_data = VALUES(workflow_data),
       updated_at = VALUES(updated_at)`,
    [
      record.id,
      record.productName,
      JSON.stringify(record.payload),
      normalizeStatus(record.workflowStatus),
      record.publicToken || newPublicToken(),
      record.clientEmail || '',
      record.clientName || '',
      Number(record.totalCrc) || 0,
      record.linkedOrderId || null,
      record.pdfFilename || null,
      JSON.stringify(record.workflowData || {}),
      created,
      updated,
    ]
  );
}

async function saveCostQuote(snapshot, productName, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const payload = buildPayload(snapshot, productName);
  if (!payload) return { ok: false, error: 'Datos de cotización inválidos.' };
  const name = String(productName || payload.product?.name || '').trim();
  if (!name) return { ok: false, error: 'Indicá el nombre del producto antes de guardar.' };

  const now = Date.now();
  const existingId = String(opts.id || '').trim();
  const clientEmail = String(opts.clientEmail || payload.export?.clientEmail || '').trim();
  const clientName = String(opts.clientName || payload.export?.clientName || '').trim();
  const totalCrc = calculator.computeQuoteTotal({
    ...snapshot,
    product: payload.product,
    products: payload.products,
    export: payload.export,
    wholesaleMode: payload.wholesaleMode,
  });

  if (existingId) {
    const current = await getCostQuoteRecord(existingId);
    if (!current) return { ok: false, error: 'Cotización no encontrada.' };
    if (current.workflowStatus === 'aprobada') {
      return { ok: false, error: 'Esta cotización ya está aprobada y no se puede editar.' };
    }
    const next = {
      ...current,
      productName: name,
      updatedAt: now,
      payload,
      clientEmail: clientEmail || current.clientEmail,
      clientName: clientName || current.clientName,
      totalCrc,
      workflowData: {
        ...current.workflowData,
        pdfGeneratedAt: opts.pdfGeneratedAt || current.workflowData.pdfGeneratedAt,
      },
    };
    await persistRecord(next);
    return { ok: true, ...recordToSummary(next), id: next.id };
  }

  const id = crypto.randomBytes(8).toString('hex');
  const record = {
    id,
    productName: name,
    createdAt: now,
    updatedAt: now,
    payload,
    workflowStatus: 'pendiente',
    publicToken: newPublicToken(),
    clientEmail,
    clientName,
    totalCrc,
    linkedOrderId: '',
    pdfFilename: '',
    workflowData: { pdfGeneratedAt: opts.pdfGeneratedAt || null },
  };
  await persistRecord(record);
  return { ok: true, ...recordToSummary(record), id };
}

async function setWorkflowStatus(id, status, patch) {
  const record = await getCostQuoteRecord(id);
  if (!record) return null;
  const nextStatus = normalizeStatus(status);
  const dataPatch = patch && typeof patch === 'object' ? patch : {};
  const next = {
    ...record,
    updatedAt: Date.now(),
    workflowStatus: nextStatus,
    workflowData: normalizeWorkflowData({ ...record.workflowData, ...dataPatch }),
  };
  if (dataPatch.clientEmail) next.clientEmail = String(dataPatch.clientEmail).trim();
  if (dataPatch.clientName) next.clientName = String(dataPatch.clientName).trim();
  if (dataPatch.totalCrc != null) next.totalCrc = Number(dataPatch.totalCrc) || 0;
  if (dataPatch.pdfFilename) next.pdfFilename = String(dataPatch.pdfFilename).trim();
  await persistRecord(next);
  return next;
}

async function linkOrder(id, orderId) {
  const record = await getCostQuoteRecord(id);
  if (!record) return null;
  const next = { ...record, linkedOrderId: String(orderId || '').trim(), updatedAt: Date.now() };
  await persistRecord(next);
  return next;
}

async function deleteCostQuote(id) {
  const quoteId = String(id || '').trim();
  if (!quoteId) return { ok: false, error: 'Cotización inválida.' };
  const [result] = await pool.query('DELETE FROM cost_quotes WHERE id = ?', [quoteId]);
  if (!result.affectedRows) return { ok: false, error: 'Cotización no encontrada.' };
  return { ok: true };
}

module.exports = {
  QUOTE_STATUSES,
  normalizeStatus,
  listCostQuotes,
  getCostQuote,
  getCostQuoteRecord,
  getCostQuoteByToken,
  saveCostQuote,
  setWorkflowStatus,
  linkOrder,
  deleteCostQuote,
  buildPayload,
  normalizeSnapshot,
  getProductsFromSnapshot,
  getQuoteDisplayName,
  recordToSummary,
};
