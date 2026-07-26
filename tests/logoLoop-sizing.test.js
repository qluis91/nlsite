/**
 * LogoLoop image sizing regression tests.
 * Run: node --test tests/logoLoop-sizing.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

function baseViewData(overrides = {}) {
  return {
    pageClass: 'page-home',
    pageStyles: ['/css/home.css'],
    site: {
      name: 'Test', description: 'Test desc',
      colors: { primary: '#000', primaryHover: '#222', secondary: '#333', accent: '#0f0', bg: '#fff', sidebarBg: '#111', sidebarText: '#eee', sidebarHover: '#444', success: '#0c0', danger: '#c00', warning: '#cc0' },
      logo: { url: '' }, favicon: null,
    },
    cspNonce: 'test-nonce',
    isPreview: false,
    cartItemCount: 0, user: null,
    panel2Content: { logoLoopAriaLabel: 'Test' },
    cmsShowcaseStyle: {}, cmsShowcaseContent: null, showcaseContent: { heading: 'S' }, showcaseStyle: {},
    panel3Content: {}, servicesContent: { heading: 'S' }, servicesStyle: {}, cmsServicesContent: null, cmsServicesStyle: null,
    showBanner: true,
    settings: {}, isLoggedIn: false,
    navItems: null, cmsNavItems: null,
    cmsSiteLogo: null, cmsSiteLogoLight: null, cmsSiteLogoDark: null, cmsSiteFavicon: null,
    cmsModelMedia: null, cmsModelFallback: null, cmsHeroBgMedia: null,
    heroContent: {}, heroStyle: {}, cmsHeroContent: null, cmsHeroStyle: null,
    panel1Content: null, panel1Style: null, cmsPanel1Content: null, cmsPanel1Style: null,
    showCmsPreviewBanner: false,
    ...overrides,
  };
}

function getHomeCss() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'home.css'), 'utf-8');
}

function getLogoJs() {
  return fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'home', 'logoLoop.js'), 'utf-8');
}

const viewPath = path.join(__dirname, '..', 'views', 'pages', 'home.ejs');

describe('LogoLoop markup — media wrapper', () => {
  it('home.ejs renders image items with .logo-loop__media wrapper', async () => {
    const html = await ejs.renderFile(viewPath, baseViewData({
      cmsData: { logoLoopItems: [{
        public_id: 'img1', item_type: 'image', text_content: 'Test',
        media_public_id: 'x', url: null, target: '_self', alt_text: 'Alt',
        media_resolved: { url: '/a.webp', thumbnailUrl: '/t.webp' },
      }]},
    }));
    assert.ok(html.includes('logo-loop__media'), 'must have .logo-loop__media wrapper');
    assert.ok(html.includes('logo-loop__image'), 'must have .logo-loop__image class');
    assert.ok(html.includes('loading="lazy"'), 'must preserve lazy loading');
    assert.ok(html.includes('decoding="async"'), 'must preserve async decoding');
  });

  it('home.ejs text items use .logo-loop__wordmark', async () => {
    const html = await ejs.renderFile(viewPath, baseViewData({
      cmsData: { logoLoopItems: [{
        public_id: 'txt1', item_type: 'text', text_content: 'TEXTOXXX', url: null,
      }]},
    }));
    assert.ok(html.includes('logo-loop__wordmark'), 'text items must use wordmark');
    assert.ok(html.includes('TEXTOXXX'), 'text content must appear');
  });

  it('linked image items have secure rel attributes', async () => {
    const html = await ejs.renderFile(viewPath, baseViewData({
      cmsData: { logoLoopItems: [{
        public_id: 'linked', item_type: 'logo', text_content: 'Lnk',
        media_public_id: 'y', url: '/page', target: '_blank', alt_text: 'Alt',
        media_resolved: { url: '/b.webp', thumbnailUrl: '/tb.webp' },
      }]},
    }));
    assert.ok(html.includes('rel="noopener noreferrer"'), 'blank links must be secure');
    assert.ok(html.includes('aria-label="Alt"'), 'linked must have aria-label');
  });

  it('image item without src falls back to wordmark', async () => {
    const html = await ejs.renderFile(viewPath, baseViewData({
      cmsData: { logoLoopItems: [{
        public_id: 'no-src', item_type: 'image', text_content: 'BackupText',
        media_resolved: null, url: null,
      }]},
    }));
    assert.ok(html.includes('logo-loop__wordmark'), 'fallback must use wordmark');
    assert.ok(html.includes('BackupText'), 'must show text_content');
  });
});

describe('LogoLoop CSS — containment rules', () => {
  it('home.css defines .logo-loop__media with max-height and max-width', () => {
    const css = getHomeCss();
    assert.ok(css.includes('.logo-loop__media'), 'must have selector');
    const block = css.match(/\.logo-loop__media\s*\{([^}]*)\}/s);
    assert.ok(block, 'must have rule block');
    const body = block[1];
    assert.ok(body.includes('max-height'), 'needs max-height');
    assert.ok(body.includes('max-width'), 'needs max-width');
    assert.ok(body.includes('overflow: hidden'), 'needs overflow hidden');
  });

  it('home.css defines .logo-loop__image with object-fit: contain', () => {
    const css = getHomeCss();
    const block = css.match(/\.logo-loop__image\s*\{([^}]*)\}/s);
    assert.ok(block, 'must have image rule');
    const body = block[1];
    assert.ok(body.includes('object-fit'), 'must use object-fit');
    assert.ok(body.includes('contain'), 'must be contain');
    assert.ok(!body.includes('cover'), 'must NOT use cover');
  });

  it('logo-loop__image uses width: auto', () => {
    const css = getHomeCss();
    const block = css.match(/\.logo-loop__image\s*\{([^}]*)\}/s);
    assert.ok(block[1].includes('width: auto'), 'must use width: auto');
  });

  it('768px breakpoint adjusts logo-loop__media', () => {
    const css = getHomeCss();
    const blocks = css.match(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\n\}/g) || [];
    assert.ok(blocks.some(b => b.includes('.logo-loop__media')), 'must have mobile media rule');
  });

  it('scale-on-hover applies to .logo-loop__media', () => {
    const css = getHomeCss();
    assert.ok(
      css.includes('.logo-loop--scale-on-hover .logo-loop__item:hover .logo-loop__media'),
      'hover scale on media'
    );
  });
});

describe('LogoLoop animation JS — cloning preserved', () => {
  it('uses cloneNode(true) for deep cloning', () => {
    const js = getLogoJs();
    assert.ok(js.includes('cloneNode(true)'), 'must deep clone');
  });

  it('removes [data-logo-loop-sequence] on clones', () => {
    const js = getLogoJs();
    assert.ok(js.includes("removeAttribute('data-logo-loop-sequence')"), 'must remove attr');
  });

  it('listens for image load events', () => {
    const js = getLogoJs();
    assert.ok(js.includes('.complete'), 'must check complete');
    assert.ok(js.includes("'load'"), 'must listen for load');
  });

  it('measure() uses getBoundingClientRect', () => {
    const js = getLogoJs();
    assert.ok(js.includes('sequence.getBoundingClientRect()'), 'must measure sequence');
  });
});

describe('Hardcoded fallback preservation', () => {
  it('hardcoded fallback items remain with no CMS data', async () => {
    const html = await ejs.renderFile(viewPath, baseViewData({ cmsData: null }));
    assert.ok(html.includes('IMPRESI'), 'must have IMPRESION 3D');
    assert.ok(html.includes('DISE'), 'must have DISENO');
  });

  it('fallback items use .logo-loop__wordmark', async () => {
    const html = await ejs.renderFile(viewPath, baseViewData({ cmsData: null }));
    const count = (html.match(/logo-loop__wordmark/g) || []).length;
    assert.ok(count >= 6, `need >=6 wordmarks, got ${count}`);
  });
});

describe('Carousel not affected', () => {
  it('.project-carousel__image rule still exists', () => {
    assert.ok(getHomeCss().match(/\.project-carousel__image\s*\{/), 'carousel rule must exist');
  });
});
