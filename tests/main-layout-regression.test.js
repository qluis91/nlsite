const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const mainLayoutPath = path.join(root, 'views', 'layouts', 'main.ejs');

function renderMain(locals = {}) {
  return ejs.renderFile(mainLayoutPath, locals);
}

describe('main layout optional-local regression', () => {
  it('renders without site', async () => {
    const html = await renderMain();
    assert.match(html, /<title>NinjaLab CR<\/title>/);
    assert.match(html, /<meta name="description" content="NinjaLab CR">/);
  });

  it('renders with an empty site object', async () => {
    const html = await renderMain({ site: {} });
    assert.match(html, /--color-primary: #2563eb/);
    assert.match(html, /NinjaLab CR/);
  });

  it('uses metaDescription when provided', async () => {
    const html = await renderMain({
      site: { description: 'Descripción del sitio' },
      metaDescription: 'Descripción de la página',
      hideFooter: true,
      usesHeroNavbar: true,
    });
    assert.match(html, /content="Descripción de la página"/);
    assert.doesNotMatch(html, /content="Descripción del sitio"/);
  });

  it('uses site.description when metaDescription is absent', async () => {
    const html = await renderMain({
      site: { name: 'Sitio real', description: 'Descripción real' },
      hideFooter: true,
      usesHeroNavbar: true,
    });
    assert.match(html, /content="Descripción real"/);
    assert.match(html, /<title>Sitio real<\/title>/);
  });

  it('uses the final metadata fallback when site and metaDescription are absent', async () => {
    const html = await renderMain({ hideFooter: true, usesHeroNavbar: true });
    assert.match(html, /content="NinjaLab CR"/);
  });

  it('does not require robots or canonical metadata', async () => {
    const html = await renderMain({ hideFooter: true, usesHeroNavbar: true });
    assert.doesNotMatch(html, /name="robots"/);
    assert.doesNotMatch(html, /rel="canonical"/);
  });

  it('renders optional robots, canonical, styles, and module script when supplied', async () => {
    const html = await renderMain({
      robots: 'noindex, nofollow',
      canonical: 'https://example.invalid/pagina',
      pageStyles: ['/css/example.css'],
      pageModule: '/js/example.mjs',
      hideFooter: true,
      usesHeroNavbar: true,
    });
    assert.match(html, /name="robots" content="noindex, nofollow"/);
    assert.match(html, /rel="canonical" href="https:\/\/example\.invalid\/pagina"/);
    assert.match(html, /href="\/css\/example\.css"/);
    assert.match(html, /src="\/js\/example\.mjs"/);
  });

  it('renders body and flash locals safely when omitted or provided', async () => {
    const emptyHtml = await renderMain({ hideFooter: true, usesHeroNavbar: true });
    assert.doesNotMatch(emptyHtml, /alert-success|alert-danger/);

    const html = await renderMain({
      body: '<main>Contenido</main>',
      success_msg: 'Guardado',
      error_msg: 'Error controlado',
      hideFooter: true,
      usesHeroNavbar: true,
    });
    assert.match(html, /<main>Contenido<\/main>/);
    assert.match(html, />Guardado</);
    assert.match(html, />Error controlado</);
  });
});

describe('shared layout compilation', () => {
  for (const layoutName of ['main', 'admin', 'account', 'store']) {
    it(`${layoutName}.ejs compiles`, () => {
      const filename = path.join(root, 'views', 'layouts', `${layoutName}.ejs`);
      const source = fs.readFileSync(filename, 'utf8');
      assert.doesNotThrow(() => ejs.compile(source, { filename }));
    });
  }
});

describe('global site local', () => {
  const { setLocals } = require('../middlewares/authMiddleware');

  function runSetLocals(existingSite) {
    const req = {
      path: '/prueba',
      session: {
        user: null,
        cart: null,
      },
    };
    const res = { locals: {} };
    if (existingSite) res.locals.site = existingSite;
    let nextCalled = false;
    setLocals(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    return res.locals.site;
  }

  it('injects the configured site when no earlier local exists', () => {
    const site = runSetLocals();
    assert.ok(site.name);
    assert.ok(site.description);
    assert.ok(site.colors);
  });

  it('does not overwrite an earlier site local', () => {
    const existingSite = {
      name: 'CMS site',
      description: 'CMS description',
      colors: { primary: '#000000' },
    };
    assert.equal(runSetLocals(existingSite), existingSite);
  });
});
