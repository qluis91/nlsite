const { searchPublicContent } = require('../services/searchService');

const MAX_QUERY_LENGTH = 100;

function prepareQuery(value) {
  const scalarValue = Array.isArray(value) ? value[0] : value;
  const cleaned = String(scalarValue ?? '')
    .replace(/\0/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    query: cleaned.slice(0, MAX_QUERY_LENGTH),
    queryWasTruncated: cleaned.length > MAX_QUERY_LENGTH,
  };
}

function showSearchResults(req, res) {
  const { query, queryWasTruncated } = prepareQuery(req.query.q);
  let results = [];
  let totalResults = 0;
  let searchUnavailable = false;

  if (query) {
    try {
      const searchResponse = searchPublicContent(query);
      results = searchResponse.results;
      totalResults = searchResponse.total;
    } catch (error) {
      searchUnavailable = true;
      console.warn('[search] Public content source unavailable:', error.message);
    }
  }

  res.render('pages/search-results', {
    title: query ? `Buscar: ${query}` : 'Buscar',
    layout: 'layouts/main',
    pageClass: 'page-search',
    pageStyles: ['/css/home.css', '/css/search.css'],
    pageModule: '/js/search-page.js',
    usesHeroNavbar: true,
    searchQuery: query,
    queryWasTruncated,
    searchUnavailable,
    results,
    totalResults,
  });
}

module.exports = {
  MAX_QUERY_LENGTH,
  prepareQuery,
  showSearchResults,
};
