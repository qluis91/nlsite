/**
 * Panel 2 carousel behavior settings — admin UI, validation, public wiring.
 * Run: node --require ./config/testBootstrap.js --test tests/carousel-behavior.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const {
  resolveCarouselBehavior,
  validateCarouselBehaviorFields,
  validatePanel2Content,
  CAROUSEL_BEHAVIOR_DEFAULTS,
} = require('../validators/cmsPanelsValidator');
const { safeJsonScript } = require('../config/jsonLdHelper');

const root = path.join(__dirname, '..');
const panel2Path = path.join(root, 'views', 'pages', 'admin', 'page', 'panel2.ejs');
const homePath = path.join(root, 'views', 'pages', 'home.ejs');
const homeCss = fs.readFileSync(path.join(root, 'public', 'css', 'home.css'), 'utf8');
const projectCarousel = fs.readFileSync(path.join(root, 'public', 'js', 'home', 'projectCarousel.js'), 'utf8');
const homeJs = fs.readFileSync(path.join(root, 'public', 'js', 'home', 'home.js'), 'utf8');
const panel2Editor = fs.readFileSync(path.join(root, 'public', 'js', 'admin', 'panel2-editor.js'), 'utf8');
const panelsController = fs.readFileSync(path.join(root, 'controllers', 'adminPanelsController.js'), 'utf8');

describe('Carousel behavior — defaults & normalization', () => {
  it('resolves legacy missing fields to current public defaults', () => {
    assert.deepEqual(resolveCarouselBehavior({}), CAROUSEL_BEHAVIOR_DEFAULTS);
    assert.deepEqual(resolveCarouselBehavior({ heading: 'Keep' }), {
      ...CAROUSEL_BEHAVIOR_DEFAULTS,
    });
  });

  it('clamps and rounds valid values', () => {
    assert.deepEqual(
      resolveCarouselBehavior({
        carouselAutoplayEnabled: '0',
        carouselIntervalSeconds: '7.4',
        carouselZoomDurationSeconds: '40.2',
        carouselZoomIntensityPercent: '9.6',
      }),
      {
        carouselAutoplayEnabled: false,
        carouselIntervalSeconds: 7.5,
        carouselZoomDurationSeconds: 40,
        carouselZoomIntensityPercent: 10,
      }
    );
  });
});

describe('Carousel behavior — validation', () => {
  it('rejects out-of-range and non-finite values', () => {
    assert.ok(validateCarouselBehaviorFields({ carouselIntervalSeconds: 2 }).length);
    assert.ok(validateCarouselBehaviorFields({ carouselIntervalSeconds: 16 }).length);
    assert.ok(validateCarouselBehaviorFields({ carouselIntervalSeconds: 'bad' }).length);
    assert.ok(validateCarouselBehaviorFields({ carouselZoomDurationSeconds: 9 }).length);
    assert.ok(validateCarouselBehaviorFields({ carouselZoomDurationSeconds: 12.5 }).length);
    assert.ok(validateCarouselBehaviorFields({ carouselZoomIntensityPercent: 13 }).length);
    assert.ok(validateCarouselBehaviorFields({ carouselZoomIntensityPercent: -1 }).length);
  });

  it('accepts default-range values', () => {
    assert.deepEqual(
      validateCarouselBehaviorFields({
        carouselAutoplayEnabled: false,
        carouselIntervalSeconds: 5.5,
        carouselZoomDurationSeconds: 32,
        carouselZoomIntensityPercent: 7,
      }),
      []
    );
  });

  it('validatePanel2Content only checks behavior when requested', () => {
    const base = {
      heading: 'Showcase',
      carouselIntervalSeconds: 99,
    };
    assert.equal(validatePanel2Content(base).length, 0);
    assert.ok(validatePanel2Content(base, { validateCarouselBehavior: true }).length > 0);
  });
});

describe('Carousel behavior — admin UI', () => {
  async function renderPanel2(content = {}) {
    return ejs.renderFile(panel2Path, {
      content,
      style: {},
      bgMedia: null,
      logoItems: [],
      carouselItems: [],
      csrfToken: 'x',
      error: null,
      saved: null,
      safeJsonScript,
      resolveCarouselBehavior,
      activeTab: 'carousel',
    });
  }

  it('replaces reorder UI with behavior controls and defaults', async () => {
    const html = await renderPanel2({});
    const carouselPanel = html.slice(
      html.indexOf('data-panel="carousel"'),
      html.indexOf('data-panel="style"')
    );
    assert.doesNotMatch(carouselPanel, /Reordenar \(IDs separados por coma\)/);
    assert.doesNotMatch(carouselPanel, /carousel\/items\/reorder/);
    assert.match(carouselPanel, /Comportamiento del carrusel/);
    assert.match(carouselPanel, /name="carouselAutoplayEnabled"/);
    assert.match(carouselPanel, /name="carouselIntervalSeconds"/);
    assert.match(carouselPanel, /name="carouselZoomDurationSeconds"/);
    assert.match(carouselPanel, /name="carouselZoomIntensityPercent"/);
    assert.match(carouselPanel, /value="5\.5"/);
    assert.match(carouselPanel, /value="32"/);
    assert.match(carouselPanel, /value="7"/);
    assert.match(carouselPanel, /checked/);
    assert.match(carouselPanel, /Guardar configuración/);
    assert.match(carouselPanel, /Publicar carrusel/);
    assert.match(
      carouselPanel,
      /Publicar carrusel” aplica tanto los proyectos como esta configuración/
    );
    assert.match(carouselPanel, /name="active_tab" value="carousel"/);
  });

  it('panel2-editor binds live range outputs', () => {
    assert.match(panel2Editor, /data-range-sync/);
    assert.match(panel2Editor, /data-carousel-autoplay-toggle/);
  });

  it('draft save only mutates carousel behavior on carousel tab', () => {
    assert.match(panelsController, /activeTab === 'carousel'/);
    assert.match(panelsController, /carouselAutoplayEnabled/);
    assert.match(panelsController, /validateCarouselBehavior:\s*activeTab === 'carousel'/);
    assert.match(panelsController, /Object\.assign\(content,\s*validator\.resolveCarouselBehavior\(content\)\)/);
  });

  it('sliders re-render from resolveCarouselBehavior draft values', async () => {
    const html = await renderPanel2({
      heading: 'Panel 2',
      carouselAutoplayEnabled: true,
      carouselIntervalSeconds: 8.5,
      carouselZoomDurationSeconds: 18,
      carouselZoomIntensityPercent: 11,
    });
    const carouselPanel = html.slice(
      html.indexOf('data-panel="carousel"'),
      html.indexOf('data-panel="style"')
    );
    assert.match(carouselPanel, /name="carouselIntervalSeconds"[\s\S]*?value="8\.5"/);
    assert.match(carouselPanel, /name="carouselZoomDurationSeconds"[\s\S]*?value="18"/);
    assert.match(carouselPanel, /name="carouselZoomIntensityPercent"[\s\S]*?value="11"/);
  });
});

describe('Carousel behavior — public wiring', () => {
  it('home template exposes published behavior data attributes with defaults', () => {
    const home = fs.readFileSync(homePath, 'utf8');
    assert.match(home, /data-carousel-autoplay=/);
    assert.match(home, /data-carousel-interval=/);
    assert.match(home, /data-carousel-zoom-duration=/);
    assert.match(home, /data-carousel-zoom-intensity=/);
    assert.match(home, /typeof resolveCarouselBehavior === 'function'/);
    assert.doesNotMatch(home, /require\([^)]*cmsPanelsValidator/);
  });

  it('home renders published carousel behavior into data attributes', async () => {
    // Minimal stub of home.ejs Panel 2 locals — avoid full page render deps.
    const snippet = `
      <% const panel2Content = content || {};
         const carouselBehavior = (typeof resolveCarouselBehavior === 'function')
           ? resolveCarouselBehavior(panel2Content)
           : { carouselAutoplayEnabled: true, carouselIntervalSeconds: 5.5, carouselZoomDurationSeconds: 32, carouselZoomIntensityPercent: 7 };
      %>
      <div
        data-carousel-autoplay="<%= carouselBehavior.carouselAutoplayEnabled ? 'true' : 'false' %>"
        data-carousel-interval="<%= Math.round(carouselBehavior.carouselIntervalSeconds * 1000) %>"
        data-carousel-zoom-duration="<%= carouselBehavior.carouselZoomDurationSeconds %>"
        data-carousel-zoom-intensity="<%= carouselBehavior.carouselZoomIntensityPercent %>"
      ></div>`;
    const html = ejs.render(snippet, {
      content: {
        carouselAutoplayEnabled: true,
        carouselIntervalSeconds: 8.5,
        carouselZoomDurationSeconds: 15,
        carouselZoomIntensityPercent: 12,
      },
      resolveCarouselBehavior,
    });
    assert.match(html, /data-carousel-interval="8500"/);
    assert.match(html, /data-carousel-zoom-duration="15"/);
    assert.match(html, /data-carousel-zoom-intensity="12"/);
  });

  it('projectCarousel uses configurable autoplay options', () => {
    assert.match(projectCarousel, /autoplayEnabled:\s*true/);
    assert.match(projectCarousel, /autoplayInterval:\s*5500/);
    assert.match(projectCarousel, /settings\.autoplayEnabled === false/);
    assert.doesNotMatch(projectCarousel, /const AUTOPLAY_INTERVAL = 5500/);
  });

  it('home.js reads data attributes and applies Ken Burns CSS variables', () => {
    assert.match(homeJs, /readCarouselBehaviorOptions/);
    assert.match(homeJs, /--carousel-kenburns-duration/);
    assert.match(homeJs, /--carousel-kenburns-scale/);
    assert.match(homeJs, /initProjectCarousel\(carouselRoot,\s*readCarouselBehaviorOptions/);
  });

  it('CSS Ken Burns uses duration/scale variables with current defaults', () => {
    assert.match(homeCss, /scale\(var\(--carousel-kenburns-scale,\s*1\.07\)\)/);
    assert.match(
      homeCss,
      /animation:\s*project-carousel-kenburns\s+var\(--carousel-kenburns-duration,\s*32s\)/
    );
    assert.match(homeCss, /\.project-carousel__image-frame\s*\{[\s\S]*?--carousel-zoom/);
    assert.doesNotMatch(homeCss, /translate3d\(-1\.2%/);
    assert.doesNotMatch(homeCss, /is-image-motion-paused/);
  });

  it('Ken Burns never pauses on hover or click; autoplay still does', () => {
    assert.doesNotMatch(projectCarousel, /is-image-motion-paused/);
    assert.doesNotMatch(projectCarousel, /toggleImageMotionPause/);
    assert.match(projectCarousel, /pointerenter',\s*pauseAutoplay/);
    assert.match(projectCarousel, /pointerleave',\s*resumeAutoplay/);
    assert.match(projectCarousel, /restartActiveKenBurns/);
    assert.match(projectCarousel, /isMainImageInteractionTarget/);
    assert.doesNotMatch(
      homeCss,
      /\.project-carousel:hover[\s\S]{0,220}?animation-play-state:\s*paused/
    );
  });
});
