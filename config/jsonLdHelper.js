/**
 * Phase 12D — JSON-LD safe serialization helper.
 * Escapes </script, U+2028, U+2029 to keep JSON-LD CSP-compatible.
 */
function escapeJsonLd(str) {
  return String(str)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function jsonLdScript(ld) {
  const json = JSON.stringify(ld);
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * Build Organization/LocalBusiness JSON-LD.
 */
function buildOrganizationLd({ siteName, siteDescription, baseUrl, logo }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteName,
    description: siteDescription,
    url: baseUrl,
    ...(logo ? { logo: logo.startsWith('http') ? logo : `${baseUrl}${logo}` } : {}),
  };
}

/**
 * Build WebSite JSON-LD with SearchAction.
 */
function buildWebSiteLd({ siteName, baseUrl }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteName,
    url: baseUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${baseUrl}/buscar?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * Build Product JSON-LD from catalog product object.
 */
function buildProductLd(product, baseUrl) {
  if (!product || !product.id) return null;

  const productUrl = product.url
    ? (product.url.startsWith('http') ? product.url : `${baseUrl}${product.url}`)
    : baseUrl;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    url: productUrl,
  };

  if (product.description) {
    ld.description = product.description.slice(0, 500);
  }

  if (product.primaryImage) {
    ld.image = product.primaryImage.startsWith('http')
      ? product.primaryImage
      : `${baseUrl}${product.primaryImage}`;
  }

  if (product.slug) {
    ld.sku = product.slug;
  }

  const offer = { '@type': 'Offer' };
  if (product.displayPrice > 0) {
    offer.price = String(product.displayPrice);
    offer.priceCurrency = 'CRC';
  }
  offer.availability = product.inStock
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';
  offer.url = productUrl;
  ld.offers = offer;

  return ld;
}

/**
 * Build BreadcrumbList JSON-LD.
 */
function buildBreadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.item,
    })),
  };
}

/**
 * Make a URL absolute using the base URL.
 */
function makeAbsolute(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const b = baseUrl.replace(/\/+$/, '');
  return b + (url.startsWith('/') ? url : '/' + url);
}

module.exports = {
  escapeJsonLd,
  jsonLdScript,
  buildOrganizationLd,
  buildWebSiteLd,
  buildProductLd,
  buildBreadcrumbLd,
  makeAbsolute,
};
