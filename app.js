require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// ── Environment validation (fail-fast) ──
const { validateEnv } = require('./config/envValidator');
const envIssues = validateEnv();
if (envIssues.length) {
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    console.error('❌ Error de configuración:');
    for (const issue of envIssues) console.error('  • ' + issue);
    process.exit(1);
  } else if (process.env.NODE_ENV !== 'test') {
    console.warn('⚠️  Advertencias de configuración:');
    for (const issue of envIssues) console.warn('  • ' + issue);
  }
}

// ── Ensure upload directories ──
const UPLOAD_PUBLIC = process.env.UPLOAD_PUBLIC_DIR || path.join(__dirname, 'public', 'uploads');
const UPLOAD_PROOFS = process.env.UPLOAD_PROOFS_DIR || path.join(__dirname, 'storage', 'payment-proofs');
[UPLOAD_PUBLIC, UPLOAD_PROOFS].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Ensure CMS media library directories (inside the public upload root) ──
const { MEDIA_ROOT, MEDIA_DIRECTORIES } = require('./config/cmsOptions');
[MEDIA_ROOT, ...MEDIA_DIRECTORIES.map(name => path.join(MEDIA_ROOT, name))].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Register CMS usage sources for later Phases (media references in nav items etc.) ──
require('./services/cmsPublishingService').registerNavUsageSource();

// ── Session store ──
const { createSessionMiddleware, sessionStore } = require('./config/session');

// ── CSRF Protection ──
const { csrfSynchronisedProtection, generateToken } = require('./config/csrf');

// ── Rutas ──
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminCatalogRoutes = require('./routes/adminCatalogRoutes');
const adminGalleryRoutes = require('./routes/adminGalleryRoutes');
const adminPageRoutes = require('./routes/adminPageRoutes');
const adminPageContentRoutes = require('./routes/adminPageContentRoutes');
const adminPanelsRoutes = require('./routes/adminPanelsRoutes');
const adminPublishingRoutes = require('./routes/adminPublishingRoutes');

// ── Register Phase 11C usage sources for Panel 2/3 media references ──
require('./services/cmsRepeatableService').registerPanelUsageSources();
const adminOrderRoutes = require('./routes/adminOrderRoutes');
const accountRoutes = require('./routes/accountRoutes');
const accountAvatarRoutes = require('./routes/accountAvatarRoutes');
const guestOrderRoutes = require('./routes/guestOrderRoutes');
const searchRoutes = require('./routes/searchRoutes');
const storeRoutes = require('./routes/storeRoutes');
const galleryRoutes = require('./routes/galleryRoutes');
const cartRoutes = require('./routes/cartRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const { router: tilopayRoutes, guestRouter: tilopayGuestRoutes } = require('./routes/tilopayRoutes');
const tilopayWebhookRoutes = require('./routes/tilopayWebhookRoutes');

// ── Controllers ──
const authController = require('./controllers/authController');

// ── Middlewares ──
const { setLocals, isAuthenticated, isAdmin, isAdminGuest } = require('./middlewares/authMiddleware');

// ── Inicializar Express ──
const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ── Trust proxy in production (Railway, etc.) ──
if (IS_PRODUCTION) app.set('trust proxy', 1);

// ── Per-request CSP nonce (MUST run before Helmet) ──
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// ── Seguridad: Helmet ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: [
        "'self'","'wasm-unsafe-eval'",
        (req, res) => "'nonce-" + res.locals.cspNonce + "'",
      ],
      imgSrc: ["'self'", 'data:'],
      connectSrc: [
        "'self'",
        'blob:',
        'https://storage.googleapis.com',
      ],
      workerSrc: ["'self'", 'blob:'],
      frameAncestors: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));

// ── Configuración del Motor de Vistas (EJS) ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Layout support ──
const layoutMiddleware = require('./config/viewEngine');
app.use(layoutMiddleware);

// ── Middlewares Globales ──
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Vendor aliases for homepage modules (scoped, no bundler) ──
app.use(
  '/vendor/three/build',
  express.static(path.join(__dirname, 'node_modules/three/build'))
);
app.use(
  '/vendor/three/examples/jsm',
  express.static(path.join(__dirname, 'node_modules/three/examples/jsm'))
);
app.use(
  '/vendor/three',
  express.static(path.join(__dirname, 'node_modules/three'))
);
app.use(
  '/vendor/gsap',
  express.static(path.join(__dirname, 'node_modules/gsap'))
);
app.use(
  '/vendor/lenis',
  express.static(path.join(__dirname, 'node_modules/lenis/dist'))
);

// ── Configuración de Sesiones (MySQL store) ──
app.use(createSessionMiddleware());

// ── Inyectar variables globales en vistas ──
app.use(setLocals);

// ── CSRF: expose token to all views ──
app.use((req, res, next) => {
  res.locals.csrfToken = generateToken(req);
  next();
});

// ── Admin branding from global settings (Phase 12A) ──
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/admin') || req.path === '/admin/login') return next();
  try {
    const cms = require('./services/cmsPublishingService');
    const cmsContent = require('./services/cmsContentService');
    const settings = await cms.getPublishedSettings(['global.site_name', 'site.favicon']);
    if (settings['global.site_name']) {
      const siteConfig = require('./config/site');
      res.locals.site = { ...siteConfig, name: settings['global.site_name'] };
    }
    if (settings['site.favicon']) {
      const fav = await cmsContent.resolveMediaReference(settings['site.favicon'], null);
      if (fav && fav.url) res.locals.globalFavicon = fav.url;
    }
  } catch (_) {
    // Graceful fallback: use .env / config/site.js default
  }
  next();
});

// ── Public SEO defaults from global settings (Phase 12A) ──
app.use(async (req, res, next) => {
  // Skip admin, auth, API, and static paths
  if (req.path.startsWith('/admin') || req.path.startsWith('/auth') || req.path.startsWith('/api') ||
      req.path.startsWith('/health') || req.path.startsWith('/ready')) return next();
  try {
    const cms = require('./services/cmsPublishingService');
    const cmsContent = require('./services/cmsContentService');
    const settings = await cms.getPublishedSettings([
      'global.seo_title', 'global.seo_description', 'global.og_image',
      'global.canonical_url', 'global.indexing_mode', 'site.favicon',
    ]);

    if (settings['global.seo_title']) {
      res.locals.globalSeoTitle = settings['global.seo_title'];
    }
    if (settings['global.seo_description']) {
      res.locals.globalSeoDescription = settings['global.seo_description'];
    }
    if (settings['global.indexing_mode']) {
      res.locals.globalRobots = settings['global.indexing_mode'];
    }
    if (settings['global.canonical_url']) {
      res.locals.globalCanonical = settings['global.canonical_url'];
    }
    // Resolve OG image and favicon media references
    if (settings['global.og_image']) {
      const ogImg = await cmsContent.resolveMediaReference(settings['global.og_image'], null);
      if (ogImg && ogImg.url) res.locals.globalOgImage = ogImg.url;
    }
    if (settings['site.favicon']) {
      const fav = await cmsContent.resolveMediaReference(settings['site.favicon'], null);
      if (fav && fav.url) res.locals.globalFavicon = fav.url;
    }
  } catch (_) {
    // Graceful fallback
  }
  next();
});

// ── Rate Limiter para Login de Administrador ──
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.error_msg =
      'Demasiados intentos de inicio de sesión. Inténtalo nuevamente en unos minutos.';
    return res.redirect('/admin/login');
  },
});

// ── Global auth rate limiters ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.error_msg = 'Demasiados intentos. Inténtalo nuevamente en unos minutos.';
    return res.redirect('/auth/login');
  },
});

const guestLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).send('No pudimos verificar los datos del pedido. Inténtalo nuevamente más tarde.');
  },
});

// ── Rutas de Login de Administrador (ANTES del middleware de admin) ──
app.get('/admin/login', isAdminGuest, authController.showAdminLogin);
app.post('/admin/login', isAdminGuest, csrfSynchronisedProtection, adminLoginLimiter, authController.adminLogin);

// ── Admin catalog: mounted BEFORE global CSRF so multipart routes handle CSRF after multer ──
app.use('/admin', isAuthenticated, isAdmin, adminCatalogRoutes);
app.use('/admin', isAuthenticated, isAdmin, adminGalleryRoutes);
app.use('/admin', isAuthenticated, isAdmin, adminPageRoutes);
app.use('/admin', isAuthenticated, isAdmin, adminPageContentRoutes);
app.use('/admin', isAuthenticated, isAdmin, adminPanelsRoutes);
app.use('/admin', isAuthenticated, isAdmin, adminPublishingRoutes);
app.use('/cuenta', isAuthenticated, accountAvatarRoutes);
const paymentProofAccountRoutes = require('./routes/paymentProofAccountRoutes');
const paymentProofGuestRoutes = require('./routes/paymentProofGuestRoutes');
app.use('/cuenta', isAuthenticated, paymentProofAccountRoutes);
app.use('/consultar-pedido', paymentProofGuestRoutes);

app.use('/cuenta', isAuthenticated, tilopayRoutes);
app.use('/consultar-pedido', tilopayGuestRoutes);

app.use(csrfSynchronisedProtection);

app.use('/webhooks', tilopayWebhookRoutes);
app.use('/pagos', tilopayRoutes);

// ── Rutas ──
app.use('/auth', authLimiter, authRoutes);
app.use('/buscar', searchRoutes);
app.use('/tienda', storeRoutes);
app.use('/galeria', galleryRoutes);
app.use('/carrito', cartRoutes);
app.use('/checkout', checkoutRoutes);
app.use('/consultar-pedido', guestLookupLimiter, guestOrderRoutes);
app.use('/cuenta', isAuthenticated, accountRoutes);
app.use('/admin', isAuthenticated, isAdmin, adminOrderRoutes);
app.use('/admin', isAuthenticated, isAdmin, adminRoutes);

// ── SEO: robots.txt ──
const BASE_URL = process.env.APP_URL || 'http://localhost:' + PORT;
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain');
  res.send(
    `User-agent: *\n` +
    `Allow: /\n` +
    `Disallow: /admin\n` +
    `Disallow: /cuenta\n` +
    `Disallow: /carrito\n` +
    `Disallow: /checkout\n` +
    `Disallow: /auth\n` +
    `Disallow: /consultar-pedido\n` +
    `Sitemap: ${BASE_URL}/sitemap.xml\n`
  );
});

// ── SEO: sitemap.xml ──
app.get('/sitemap.xml', async (_req, res) => {
  try {
    const pool = require('./config/db');
    const urls = [{ loc: '/', priority: '1.0' }, { loc: '/tienda', priority: '0.9' }, { loc: '/galeria', priority: '0.8' }];
    const [products] = await pool.query(
      "SELECT slug, updated_at FROM products WHERE is_active = 1 AND is_published = 1 ORDER BY updated_at DESC LIMIT 500"
    );
    for (const p of products) {
      urls.push({ loc: '/tienda/' + p.slug, priority: '0.7', lastmod: p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 10) : null });
    }
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const u of urls) {
      xml += '  <url>\n';
      xml += `    <loc>${BASE_URL}${u.loc}</loc>\n`;
      if (u.lastmod) xml += `    <lastmod>${u.lastmod}</lastmod>\n`;
      xml += `    <priority>${u.priority}</priority>\n`;
      xml += '  </url>\n';
    }
    xml += '</urlset>';
    res.type('application/xml');
    res.send(xml);
  } catch (_err) {
    res.status(500).send('');
  }
});

// ── Página de Inicio ──
app.get('/', async (req, res) => {
  try {
    const cms = require('./services/cmsPublishingService');
    const cmsContent = require('./services/cmsContentService');

    const [navItems, heroContent, showcaseContent, servicesContent, settings] = await Promise.all([
      cms.getPublishedNavItems('home'),
      cmsContent.getPublishedSectionContent('home', 'hero', null),
      cmsContent.getPublishedSectionContent('home', 'showcase', null),
      cmsContent.getPublishedSectionContent('home', 'services', null),
      cms.getPublishedSettings([
        'site.logo_primary', 'site.logo_light', 'site.logo_dark',
        'site.favicon', 'navbar.bg_color', 'navbar.text_color',
        'navbar.accent_color', 'navbar.border_color', 'navbar.opacity', 'navbar.logo_width',
      ]),
    ]);

    // Published hero style
    let heroStyle = null;
    let showcaseStyle = null;
    let servicesStyle = null;
    if (heroContent || showcaseContent || servicesContent) {
      const db = require('./config/db');
      const [rows] = await db.query(
        `SELECT s.section_key, s.style_json FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
          WHERE p.page_key = ? AND s.section_key IN ('hero', 'showcase', 'services')
            AND s.is_enabled = 1 AND s.status = 'published'`,
        ['home']
      );
      for (const row of rows) {
        const style = (typeof row.style_json === 'string' ? JSON.parse(row.style_json) : row.style_json) || {};
        if (row.section_key === 'hero') heroStyle = style;
        else if (row.section_key === 'showcase') showcaseStyle = style;
        else if (row.section_key === 'services') servicesStyle = style;
      }
    }

    // Resolve Panel 2 repeatable items
    const repeatableSvc = require('./services/cmsRepeatableService');
    let logoLoopItems = [];
    let carouselItems = [];
    let featureItems = [];

    if (showcaseContent) {
      const sectionId = await resolveSectionId('showcase');
      if (sectionId) {
        [logoLoopItems, carouselItems] = await Promise.all([
          repeatableSvc.getPublishedItems('logo_loop_items', sectionId),
          repeatableSvc.getPublishedItems('home_carousel_items', sectionId),
        ]);
      }
    }

    if (servicesContent) {
      const sectionId = await resolveSectionId('services');
      if (sectionId) {
        featureItems = await repeatableSvc.getPublishedItems('home_feature_items', sectionId);
      }
    }

    // Resolve media references
    const resolveMedia = async (ref) => {
      if (!ref) return null;
      return cmsContent.resolveMediaReference(ref, null);
    };

    async function resolveSectionId(sectionKey) {
      const db = require('./config/db');
      const [[row]] = await db.query(
        "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = ?",
        [sectionKey]
      );
      return row ? row.id : null;
    }

    // Resolve carousel item media
    for (const item of carouselItems) {
      if (item.media_public_id) {
        item.media_resolved = await resolveMedia('media://' + item.media_public_id);
      }
      if (item.preview_media_public_id) {
        item.preview_media_resolved = await resolveMedia('media://' + item.preview_media_public_id);
      }
    }
    // Resolve logo loop item media
    for (const item of logoLoopItems) {
      if (item.item_type !== 'text' && item.media_public_id) {
        item.media_resolved = await resolveMedia('media://' + item.media_public_id);
      }
    }
    for (const item of featureItems) {
      if (item.icon_type === 'media' && item.media_public_id) {
        item.media_resolved = await resolveMedia('media://' + item.media_public_id);
      }
    }

    const [logoPrimary, logoLight, logoDark, favicon, modelMedia, modelFallback, bgMedia] = await Promise.all([
      resolveMedia(settings['site.logo_primary']),
      resolveMedia(settings['site.logo_light']),
      resolveMedia(settings['site.logo_dark']),
      resolveMedia(settings['site.favicon']),
      resolveMedia(heroContent?.modelMedia),
      resolveMedia(heroContent?.modelFallbackMedia),
      resolveMedia(heroContent?.backgroundMedia),
    ]);

    const cmsData = {
      navItems: navItems.length ? navItems : null,
      heroContent,
      heroStyle,
      showcaseContent,
      showcaseStyle,
      servicesContent,
      servicesStyle,
      logoLoopItems: logoLoopItems.length ? logoLoopItems : null,
      carouselItems: carouselItems.length ? carouselItems : null,
      featureItems: featureItems.length ? featureItems : null,
      settings,
      logos: {
        primary: logoPrimary,
        light: logoLight,
        dark: logoDark,
        favicon,
      },
      modelMedia,
      modelFallback,
      backgroundMedia: bgMedia,
    };

    res.render('pages/home', {
      title: 'Inicio',
      layout: 'layouts/main',
      pageClass: 'page-home',
      pageStyles: ['/css/home.css'],
      cmsData,
    });
  } catch (_err) {
    // CMS resolution failure → fall back to the hardcoded page
    res.render('pages/home', {
      title: 'Inicio',
      layout: 'layouts/main',
      pageClass: 'page-home',
      pageStyles: ['/css/home.css'],
      cmsData: null,
    });
  }
});

// ── Controlled public-upload static mount ──
const UPLOAD_PUBLIC_ABS = path.resolve(UPLOAD_PUBLIC);
const PUBLIC_ABS = path.resolve(path.join(__dirname, 'public'));
if (UPLOAD_PUBLIC_ABS !== PUBLIC_ABS && !UPLOAD_PUBLIC_ABS.startsWith(PUBLIC_ABS + path.sep)) {
  app.use('/uploads', express.static(UPLOAD_PUBLIC_ABS, {
    dotfiles: 'deny',
    index: false,
    maxAge: '7d',
  }));
}

// ── Health / Readiness (no auth, no session) ──
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const { probeDatabase } = require('./config/databaseReadiness');
app.get('/ready', async (_req, res) => {
  const ready = await probeDatabase();
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'not_ready' });
});

// ── 404 - Página no encontrada ──
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).render('pages/404', {
      title: 'Página no encontrada',
      layout: 'layouts/main',
    });
  }
  return res.status(404).json({ error: 'Not found' });
});

// ── 403 - CSRF token inválido ──
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    req.session.error_msg = 'La solicitud no es válida o ha expirado. Recarga la página e inténtalo nuevamente.';
    return res.status(403).render('pages/403', {
      title: 'Solicitud no válida',
      layout: 'layouts/main',
    });
  }
  return next(err);
});

// ── 500 - Error del servidor ──
app.use((err, req, res, _next) => {
  const log = process.env.NODE_ENV !== 'production'
    ? console.error.bind(console, 'Error del servidor:', err)
    : () => { /* silence in production */ };
  log();
  if (req.accepts('html')) {
    return res.status(500).render('pages/500', {
      title: 'Error del servidor',
      layout: 'layouts/main',
    });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

// ── Startup: 1) session store, 2) primary DB, 3) listen ──
let server;
let _started = false;

async function startServer() {
  if (_started) return;
  _started = true;

  try {
    await sessionStore.onReady();
  } catch (err) {
    console.error('❌ Error al iniciar el almacenamiento de sesiones en MySQL:', err.message);
    process.exit(1);
  }

  const { assertDatabaseReady } = require('./config/databaseReadiness');
  try {
    await assertDatabaseReady();
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  }

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log('═══════════════════════════════════════');
    console.log('  🚀 Servidor corriendo en:');
    console.log('  ➜ http://localhost:' + PORT);
    console.log('  🌐 Entorno: ' + (process.env.NODE_ENV || 'development'));
    console.log('  💾 Sesiones: MySQL (persistentes)');
    console.log('═══════════════════════════════════════');
  });
}

if (require.main === module) {
  startServer();
}

// ── Graceful shutdown ──
const SHUTDOWN_TIMEOUT_MS = 10000;
let _shutdownHandlersRegistered = false;

function gracefulShutdown(signal) {
  console.log(`\n⏳ Señal ${signal} recibida. Cerrando servidor...`);
  if (server) {
    server.close(() => {
      console.log('✅ Servidor HTTP cerrado.');
    });
  }
  const db = require('./config/db');
  Promise.resolve().then(() => {
    if (typeof db.end === 'function') return db.end().catch(() => {});
  }).then(() => {
    try { sessionStore.close(() => {}); } catch (_) {}
  }).finally(() => {
    console.log('✅ Recursos cerrados.');
    process.exit(0);
  });
  setTimeout(() => { console.error('⛔ Cierre forzado por timeout.'); process.exit(1); }, SHUTDOWN_TIMEOUT_MS);
}

if (!_shutdownHandlersRegistered) {
  _shutdownHandlersRegistered = true;
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    console.error('❌ Excepción no capturada:', process.env.NODE_ENV !== 'production' ? err : err.message);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('❌ Promesa rechazada sin manejar:', process.env.NODE_ENV !== 'production' ? reason : reason?.message);
    process.exit(1);
  });
}

module.exports = { startServer };
