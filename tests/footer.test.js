/**
 * NinjaLabCR Footer Tests
 */
const { describe, test } = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = (p) => join(__dirname, '..', p);
const read = (p) => readFileSync(root(p), 'utf-8');

const footerMarkup = read('views/components/footer.ejs');
const footerCss = read('public/css/footer.css');
const footerModule = read('public/js/footerMagicRings.mjs');
const mainLayout = read('views/layouts/main.ejs');
const accountLayout = read('views/layouts/account.ejs');

describe('Footer Component', () => {
  test('footer partial renders logo image with alt text', () => {
    assert.match(footerMarkup, /<img[^>]*src="\/images\/LogoCompleto.png"/);
    assert.match(footerMarkup, /<img[^>]*alt="[^"]+"/);
  });

  test('footer partial has accessible social icon links', () => {
    assert.match(footerMarkup, /aria-label="Instagram/);
    assert.match(footerMarkup, /aria-label="Facebook/);
    assert.match(footerMarkup, /aria-label="TikTok/);
    assert.match(footerMarkup, /aria-label="WhatsApp/);
  });

  test('footer partial uses verified existing routes', () => {
    const links = footerMarkup.match(/href="([^"]+)"/g)?.map((l) => l.slice(6, -1)) || [];
    const validHrefs = links.filter((h) => h !== '#');
    const broken = validHrefs.filter(
      (h) => !['/tienda', '/galeria', '/carrito', '/consultar-pedido', '/cuenta',
        '/#nosotros', '/#como-trabajamos',
        '/privacidad', '/terminos', '/eliminacion-de-datos',
        'https://www.instagram.com/ninjalab3dcr', 'https://www.facebook.com/ninjalabcr',
        'https://www.tiktok.com/@ninjalabcr', 'https://wa.me/50688888888'
      ].includes(h) && !h.startsWith('http')
    );
    assert.strictEqual(broken.length, 0, `Unexpected links: ${broken.join(', ')}`);
  });

  test('no placeholder href="#" links in footer', () => {
    assert.doesNotMatch(footerMarkup, /href="#"/);
  });

  test('footer has dynamic copyright year', () => {
    assert.match(footerMarkup, /new Date\(\)\.getFullYear\(\)/);
  });

  test('social links use safe rel attributes', () => {
    const socialCount = (footerMarkup.match(/rel="noopener noreferrer"/g) || []).length;
    assert.ok(socialCount >= 4, `Expected at least 4 safe rel links, got ${socialCount}`);
  });

  test('external links open in new tab', () => {
    assert.match(footerMarkup, /target="_blank"/);
  });

  test('decorative canvas is aria-hidden', () => {
    assert.match(footerMarkup, /aria-hidden="true"/);
  });

  test('footer CSS uses ninja green palette', () => {
    assert.match(footerCss, /#7cf03d/);
    assert.match(footerCss, /--nl-green/);
    assert.match(footerCss, /rgba\(124,\s*240,\s*61/);
  });

  test('footer CSS has reduced-motion query', () => {
    assert.match(footerCss, /prefers-reduced-motion/);
  });

  test('footer CSS has responsive breakpoints', () => {
    assert.match(footerCss, /max-width:\s*1040px/);
    assert.match(footerCss, /max-width:\s*760px/);
    assert.match(footerCss, /max-width:\s*400px/);
  });

  test('nav wrapper uses display: contents at desktop, grid at mobile', () => {
    assert.match(footerCss, /\.nl-footer__nav\s*\{[^}]*display:\s*contents/);
    // At tablet/mobile, nav becomes its own grid
    assert.match(footerCss, /\.nl-footer__nav\s*\{[^}]*display:\s*grid/);
  });

  test('nav grid uses auto-fill for responsive column distribution', () => {
    assert.match(footerCss, /repeat\(auto-fill,\s*minmax\(18/);
    assert.match(footerCss, /repeat\(auto-fill,\s*minmax\(15/);
  });

  test('footer CSS has CSS fallback glow (::before)', () => {
    assert.match(footerCss, /::before/);
    assert.match(footerCss, /radial-gradient/);
  });

  test('footer CSS prevents overflow', () => {
    assert.match(footerCss, /overflow:\s*hidden/);
  });

  test('footer panel uses wide max-width for desktop distribution', () => {
    assert.match(footerCss, /max-width|96rem/);
  });

  test('footer grid uses minmax for responsive column distribution', () => {
    assert.match(footerCss, /minmax\(26/);
    assert.match(footerCss, /minmax\(14/);
  });

  test('legal row uses compact flex layout, not centered block', () => {
    assert.match(footerCss, /\.nl-footer__legal\s*\{[^}]*display:\s*flex/);
    assert.match(footerCss, /\.nl-footer__legal\s*\{[^}]*justify-content:\s*space-between/);
    // Should NOT have text-align: center on legal
    assert.doesNotMatch(footerCss, /\.nl-footer__legal\s*\{[^}]*text-align:\s*center/);
  });

  test('no fixed or oversized min-height on footer or panel', () => {
    assert.doesNotMatch(footerCss, /\.nl-footer\s*\{[^}]*min-height:/);
    assert.doesNotMatch(footerCss, /\.nl-footer__panel\s*\{[^}]*min-height:/);
  });

  test('footer CSS uses shared custom properties for spacing', () => {
    assert.match(footerCss, /--nl-footer-pad-x/);
    assert.match(footerCss, /--nl-footer-pad-y/);
  });

  test('canvas is absolutely positioned off layout flow', () => {
    assert.match(footerCss, /\.nl-footer__rings\s*\{[^}]*position:\s*absolute/);
  });
});

describe('Footer Magic Rings', () => {
  test('module exports FooterMagicRings class', () => {
    assert.match(footerModule, /export class FooterMagicRings/);
  });

  test('module exports initFooterMagicRings function', () => {
    assert.match(footerModule, /export function initFooterMagicRings/);
  });

  test('module has destroy method', () => {
    assert.match(footerModule, /destroy\(\)/);
  });

  test('module uses WebGL 2', () => {
    assert.match(footerModule, /webgl2/);
    assert.match(footerModule, /#version 300 es/);
  });

  test('module caps DPR at 2', () => {
    assert.match(footerModule, /MAX_DPR = 2/);
  });

  test('module uses ResizeObserver', () => {
    assert.match(footerModule, /ResizeObserver/);
  });

  test('module uses IntersectionObserver', () => {
    assert.match(footerModule, /IntersectionObserver/);
  });

  test('module pauses on visibilitychange', () => {
    assert.match(footerModule, /visibilitychange/);
  });

  test('module cleans up RAF on destroy', () => {
    assert.match(footerModule, /cancelAnimationFrame/);
  });

  test('module respects reduced motion', () => {
    assert.match(footerModule, /prefers-reduced-motion/);
  });

  test('module has idempotent init guard', () => {
    assert.match(footerModule, /WeakSet/);
    assert.match(footerModule, /initialized\.has/);
  });

  test('module fails gracefully', () => {
    assert.match(footerModule, /canvas\.style\.display = 'none'/);
  });

  test('module pointer events use passive listener', () => {
    assert.match(footerModule, /passive:\s*true/);
  });

  test('module shader uses ninja green RGB', () => {
    assert.match(footerModule, /0\.49,\s*0\.94,\s*0\.24/);
  });

  test('module uses attribute-less fullscreen quad', () => {
    assert.match(footerModule, /gl_VertexID/);
    assert.match(footerModule, /gl\.drawArrays\(gl\.TRIANGLE_STRIP,\s*0,\s*4\)/);
  });

  test('module does not import gallery renderers', () => {
    assert.doesNotMatch(footerModule, /gallery/);
  });
});

describe('Footer Layout Integration', () => {
  test('main layout always includes footer', () => {
    assert.match(mainLayout, /include\('\.\.\/components\/footer',\s*\{/);
  });

  test('main layout includes footer.css', () => {
    assert.match(mainLayout, /href="\/css\/footer\.css"/);
  });

  test('main layout includes footer script', () => {
    assert.match(mainLayout, /src="\/js\/footerMagicRings\.mjs"/);
  });

  test('account layout includes footer.css', () => {
    assert.match(accountLayout, /href="\/css\/footer\.css"/);
  });

  test('account layout includes footer component', () => {
    assert.match(accountLayout, /include\('\.\.\/components\/footer'\)/);
  });
});
