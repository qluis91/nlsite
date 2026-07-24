function buildGalleryUrl(filters, overrides = {}) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.category) params.set('categoria', next.category);
  if (next.type) params.set('tipo', next.type);
  if (['grid', 'circular', 'ring', 'infinite'].includes(next.view)) params.set('view', next.view);
  if (next.page && next.page !== 1) params.set('page', String(next.page));
  const query = params.toString();
  return query ? `/galeria?${query}` : '/galeria';
}

module.exports = { buildGalleryUrl };
