const { randomUUID } = require('node:crypto');

const MAX_LOG_MESSAGE_LENGTH = 300;

function sanitizeLogText(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_LOG_MESSAGE_LENGTH);
}

function createCatalogRequestContext(req, filters = {}) {
  const requestId = randomUUID();
  const routePath = req.route?.path || req.path || '/catalogo/productos';
  const context = {
    requestId,
    route: `${req.baseUrl || '/admin'}${routePath}`.replace(/\/{2,}/g, '/'),
    method: req.method,
    adminId: Number(req.session?.user?.id) || null,
    filters: {
      search: String(filters.search || '').slice(0, 100),
      categoryId: filters.categoryId || null,
      page: Number(filters.page) || 1,
      limit: Number(filters.limit) || 20,
    },
    stage: 'request',
  };
  if (typeof req.res?.setHeader === 'function') {
    req.res.setHeader('X-Request-ID', requestId);
  }
  return context;
}

function logCatalogFailure(context, error, responseStatus) {
  const entry = {
    event: 'admin_catalog_request_failed',
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    adminId: context.adminId,
    filters: context.filters,
    stage: error?.catalogStage || context.stage,
    databaseErrorCode: sanitizeLogText(error?.code || 'UNKNOWN'),
    databaseErrorNumber: Number(error?.errno) || null,
    message: sanitizeLogText(error?.sqlMessage || error?.message || 'Catalog request failed'),
    responseStatus,
  };
  console.error(JSON.stringify(entry));
  return entry;
}

module.exports = {
  createCatalogRequestContext,
  logCatalogFailure,
  sanitizeLogText,
};
