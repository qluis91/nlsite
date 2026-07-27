/**
 * Phase 12D tests — Technical SEO + Structured Data.
 * Run: node --test tests/technical-seo.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const pool = require('../config/db');
const { buildProductLd, buildBreadcrumbLd, buildOrganizationLd, buildWebSiteLd, jsonLdScript, makeAbsolute } = require('../config/jsonLdHelper');

const BASE = { hostname: 'localhost', port: 3000 };

function fetch(path) {
  return new Promise((resolve, reject) => {
    http.get({ ...BASE, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

after(async () => {
  await pool.end();
});

// ──── Unit tests: jsonLdHelper ────
describe('Phase 12D — jsonLdHelper unit tests', () => {
  it('makeAbsolute prepends baseUrl to relative path', () => {
    assert.equal(makeAbsolute('/tienda', 'http://localhost:3000'), 'http://localhost:3000/tienda');
  });

  it('makeAbsolute passes through absolute URLs', () => {
    assert.equal(makeAbsolute('https://example.com/tienda', 'http://localhost:3000'), 'https://example.com/tienda');
  });

  it('makeAbsolute returns empty for falsy input', () => {
    assert.equal(makeAbsolute('', 'http://localhost:3000'), '');
  });

  it('buildOrganizationLd has correct structure', () => {
    const ld = buildOrganizationLd({
      siteName: 'Test Site',
      siteDescription: 'A test site',
      baseUrl: 'https://example.com',
      logo: null,
    });
    assert.equal(ld['@context'], 'https://schema.org');
    assert.equal(ld['@type'], 'Organization');
    assert.equal(ld.name, 'Test Site');
    assert.equal(ld.url, 'https://example.com');
    assert.equal(ld.logo, undefined);
  });

  it('buildOrganizationLd includes logo when provided', () => {
    const ld = buildOrganizationLd({
      siteName: 'Test', siteDescription: 'Desc',
      baseUrl: 'https://ex.com', logo: '/logo.png',
    });
    assert.ok(ld.logo.includes('/logo.png'));
  });

  it('buildWebSiteLd has correct structure', () => {
    const ld = buildWebSiteLd({ siteName: 'Test', baseUrl: 'https://ex.com' });
    assert.equal(ld['@type'], 'WebSite');
    assert.equal(ld.name, 'Test');
    assert.ok(ld.potentialAction);
    assert.ok(ld.potentialAction.target.urlTemplate.includes('search'));
  });

  it('buildProductLd returns null for missing product', () => {
    assert.equal(buildProductLd(null, 'http://localhost:3000'), null);
  });

  it('buildProductLd has correct structure for valid product', () => {
    const p = {
      id: 1, title: 'Test Product', slug: 'test-product',
      description: 'A great product', url: '/tienda/test-product',
      primaryImage: '/uploads/products/1/a.webp',
      displayPrice: 5000, hasPromotion: false,
      inStock: true,
    };
    const ld = buildProductLd(p, 'http://localhost:3000');
    assert.equal(ld['@type'], 'Product');
    assert.equal(ld.name, 'Test Product');
    assert.equal(ld.sku, 'test-product');
    assert.ok(ld.image.includes('a.webp'));
    assert.equal(ld.offers.price, '5000');
    assert.equal(ld.offers.priceCurrency, 'CRC');
    assert.ok(ld.offers.availability.includes('InStock'));
  });

  it('buildProductLd shows OutOfStock when not in stock', () => {
    const p = { id: 2, title: 'Sold Out', slug: 'sold', url: '/tienda/sold', displayPrice: 0, inStock: false };
    const ld = buildProductLd(p, 'http://localhost:3000');
    assert.ok(ld.offers.availability.includes('OutOfStock'));
  });

  it('buildBreadcrumbLd has correct structure', () => {
    const ld = buildBreadcrumbLd([
      { name: 'Tienda', item: 'https://ex.com/tienda' },
      { name: 'Cat', item: 'https://ex.com/tienda?category=cat' },
      { name: 'Prod', item: 'https://ex.com/tienda/prod' },
    ]);
    assert.equal(ld['@type'], 'BreadcrumbList');
    assert.equal(ld.itemListElement.length, 3);
    assert.equal(ld.itemListElement[0].position, 1);
    assert.equal(ld.itemListElement[2].name, 'Prod');
  });

  it('jsonLdScript produces valid script tag', () => {
    const script = jsonLdScript({ '@type': 'Organization', name: 'T' });
    assert.ok(script.startsWith('<script type="application/ld+json">'));
    assert.ok(script.includes('Organization'));
  });
});

// ──── JSON-LD script-breakout safety ────
describe('Phase 16A — JSON-LD script-breakout prevention', () => {
  /**
   * Helper: extract the content between the opening <script...> tag
   * and the closing </script> tag — i.e. the JSON body.
   */
  function jsonBody(script) {
    return script.slice(script.indexOf('>') + 1, script.lastIndexOf('</'));
  }

  it('escapes </script> sequence from user content', () => {
    const ld = { '@type': 'Product', name: 'Foo', description: '</script><script>alert(1)</script>' };
    const script = jsonLdScript(ld);
    const body = jsonBody(script);
    // Must NOT contain a literal </script> from user content
    assert.ok(!body.includes('</script>'));
    // Must contain the escaped form
    assert.ok(body.includes('\\u003c/script\\u003e'));
    // No double-escape of already-escaped forms
    assert.ok(!body.includes('\\\\u003c'));
  });

  it('escapes closing tag even without opening tag', () => {
    const ld = { '@type': 'Product', name: 'X</script>Y' };
    const script = jsonLdScript(ld);
    const body = jsonBody(script);
    assert.ok(!body.includes('</script>'));
    assert.ok(body.includes('\\u003c/script\\u003e'));
  });

  it('round-trips original values through JSON.parse', () => {
    const original = {
      '@type': 'Product',
      name: 'Casco Ninja <3',
      description: 'Desc with </script> & special chars',
    };
    const script = jsonLdScript(original);
    const jsonText = script.slice(script.indexOf('>') + 1, script.lastIndexOf('</'));
    const parsed = JSON.parse(jsonText);
    assert.equal(parsed.name, original.name);
    assert.equal(parsed.description, original.description);
  });

  it('preserves ampersands in parsed values', () => {
    const ld = { '@type': 'Organization', name: 'A & B Co.' };
    const script = jsonLdScript(ld);
    const jsonText = script.slice(script.indexOf('>') + 1, script.lastIndexOf('</'));
    const parsed = JSON.parse(jsonText);
    assert.equal(parsed.name, 'A & B Co.');
  });

  it('preserves quotes and backslashes', () => {
    const ld = { '@type': 'Product', name: 'Casco "Ninja"', sku: 'NL\\001' };
    const script = jsonLdScript(ld);
    const jsonText = script.slice(script.indexOf('>') + 1, script.lastIndexOf('</'));
    const parsed = JSON.parse(jsonText);
    assert.equal(parsed.name, 'Casco "Ninja"');
    assert.equal(parsed.sku, 'NL\\001');
  });

  it('escapes U+2028 line separator', () => {
    const ld = { '@type': 'Product', name: 'Line1\u2028Line2' };
    const script = jsonLdScript(ld);
    const body = jsonBody(script);
    assert.ok(!body.includes('\u2028'));
    assert.ok(body.includes('\\u2028'));
  });

  it('escapes U+2029 paragraph separator', () => {
    const ld = { '@type': 'Product', name: 'Para1\u2029Para2' };
    const script = jsonLdScript(ld);
    const body = jsonBody(script);
    assert.ok(!body.includes('\u2029'));
    assert.ok(body.includes('\\u2029'));
  });

  it('handles nested objects with mixed special chars', () => {
    const ld = {
      '@type': 'Product',
      name: 'Item',
      description: 'a < b & c > d',
      offers: { '@type': 'Offer', price: '100', priceCurrency: 'CRC' },
    };
    const script = jsonLdScript(ld);
    const body = jsonBody(script);
    // Body must not contain raw < or > from user data
    assert.ok(!body.includes('<'));
    assert.ok(!body.includes('>'));
    assert.ok(body.includes('\\u003c'));
    assert.ok(body.includes('\\u003e'));
    const parsed = JSON.parse(body);
    assert.equal(parsed.description, 'a < b & c > d');
    assert.equal(parsed.offers.price, '100');
  });

  it('Organization JSON-LD does not leak raw angle brackets', () => {
    const { buildOrganizationLd } = require('../config/jsonLdHelper');
    const ld = buildOrganizationLd({
      siteName: 'NinjaLab <3D>',
      siteDescription: 'Best </script> shop',
      baseUrl: 'http://localhost:3000',
    });
    const script = jsonLdScript(ld);
    const body = jsonBody(script);
    assert.ok(!body.includes('</script>'));
    assert.ok(!body.includes('<3D>'));
    const parsed = JSON.parse(body);
    assert.equal(parsed.name, 'NinjaLab <3D>');
    assert.equal(parsed.description, 'Best </script> shop');
  });

  it('WebSite JSON-LD is safe', () => {
    const { buildWebSiteLd } = require('../config/jsonLdHelper');
    const ld = buildWebSiteLd({ siteName: 'Test', baseUrl: 'http://localhost:3000' });
    const script = jsonLdScript(ld);
    const jsonText = script.slice(script.indexOf('>') + 1, script.lastIndexOf('</'));
    const parsed = JSON.parse(jsonText);
    assert.equal(parsed['@type'], 'WebSite');
    assert.equal(parsed.name, 'Test');
  });
});

// ──── Integration tests: live HTTP ────
describe('Phase 12D — Live HTTP SEO endpoints', () => {
  it('robots.txt returns 200 with sitemap URL', async () => {
    const res = await fetch('/robots.txt');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Sitemap:'));
    assert.ok(res.body.includes('sitemap.xml'));
  });

  it('robots.txt disallows admin and cuenta', async () => {
    const res = await fetch('/robots.txt');
    assert.ok(res.body.includes('Disallow: /admin'));
    assert.ok(res.body.includes('Disallow: /cuenta'));
  });

  it('sitemap.xml returns valid XML with products', async () => {
    const res = await fetch('/sitemap.xml');
    assert.equal(res.status, 200);
    assert.ok(res.body.startsWith('<?xml'));
    assert.ok(res.body.includes('<urlset'));
    assert.ok(res.body.includes('<loc>'));
    // Should include at least the homepage
    assert.ok(res.body.includes('/</loc>') || res.body.includes('localhost'));
  });

  it('sitemap.xml uses absolute URLs', async () => {
    const res = await fetch('/sitemap.xml');
    // All loc values should be absolute (contain http:// or https://)
    const locs = res.body.match(/<loc>(.*?)<\/loc>/g) || [];
    for (const loc of locs) {
      const url = loc.replace(/<\/?loc>/g, '');
      assert.ok(url.startsWith('http://') || url.startsWith('https://'), `URL should be absolute: ${url}`);
    }
  });
});

// ──── Integration tests: homepage SEO ────
describe('Phase 12D — Homepage JSON-LD and canonical', () => {
  it('homepage has Organization JSON-LD', async () => {
    const res = await fetch('/');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('"@type":"Organization"'));
  });

  it('homepage has WebSite JSON-LD', async () => {
    const res = await fetch('/');
    assert.ok(res.body.includes('"@type":"WebSite"'));
  });

  it('homepage canonical is absolute', async () => {
    const res = await fetch('/');
    const m = res.body.match(/<link rel="canonical" href="([^"]+)"/);
    if (m) {
      assert.ok(m[1].startsWith('http://') || m[1].startsWith('https://'),
        `Canonical should be absolute, got: ${m[1]}`);
    }
  });

  it('homepage has no Product JSON-LD', async () => {
    const res = await fetch('/');
    assert.ok(!res.body.includes('"@type":"Product"'));
  });
});

// ──── Integration tests: store JSON-LD ────
describe('Phase 12D — Store page JSON-LD and canonical', () => {
  it('store listing has Organization JSON-LD', async () => {
    const res = await fetch('/tienda');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('"@type":"Organization"'));
  });

  it('store listing canonical is absolute', async () => {
    const res = await fetch('/tienda');
    const m = res.body.match(/<link rel="canonical" href="([^"]+)"/);
    if (m) {
      assert.ok(m[1].startsWith('http://') || m[1].startsWith('https://'),
        `Store canonical should be absolute, got: ${m[1]}`);
    }
  });

  it('store filtered view uses noindex', async () => {
    const res = await fetch('/tienda?search=test');
    if (res.status === 200) {
      assert.ok(res.body.includes('noindex'));
    }
  });

  it('product detail 404 page does not crash', async () => {
    const res = await fetch('/tienda/no-existe');
    assert.equal(res.status, 404);
  });
});

// ──── Tests: JSON-LD script is CSP-compatible ────
describe('Phase 12D — CSP and serialization', () => {
  it('JSON-LD uses application/ld+json type', () => {
    const script = jsonLdScript({ '@type': 'WebSite' });
    assert.ok(script.includes('type="application/ld+json"'));
  });

  it('JSON-LD does not contain unsafe-inline requirement', () => {
    const script = jsonLdScript({ '@type': 'WebSite' });
    // JSON-LD script tag does NOT use nonce or unsafe-inline — it's allowed by 'self' in script-src
    assert.ok(!script.includes('unsafe-inline'));
  });
});
