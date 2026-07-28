require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const compression = require('compression');
const {
  UPLOAD_PUBLIC_ROOT,
} = require('./config/uploadPaths');

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
const UPLOAD_PUBLIC = UPLOAD_PUBLIC_ROOT;
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
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ── Trust proxy in production (Railway, etc.) ──
if (IS_PRODUCTION) app.set('trust proxy', 1);

// ── Per-request CSP nonce (MUST run before Helmet) ──
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// ── Seguridad: Helmet + Headers ──
// Phase 16D: Referrer-Policy, HSTS (prod), Permissions-Policy, hide X-Powered-By
// Note: style-src 'unsafe-inline' is an unresolved hardening opportunity — requires
// externalising or noncing all CMS inline styles. Not exploitable without a confirmed
// CSS injection vector.

const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // hardening opportunity — see note above
      scriptSrc: [
        "'self'","'wasm-unsafe-eval'",
        (req, res) => "'nonce-" + res.locals.cspNonce + "'",
        'https://www.googletagmanager.com',
        'https://www.google-analytics.com',
      ],
      imgSrc: ["'self'", 'data:', 'https://www.google-analytics.com', 'https://www.googletagmanager.com', 'https://img.youtube.com'],
      
      connectSrc: [
        "'self'",
        'blob:',
        'https://storage.googleapis.com',
        'https://www.google-analytics.com',
        'https://*.google-analytics.com',
        'https://*.analytics.google.com',
        'https://*.googletagmanager.com',
      ],
      workerSrc: ["'self'", 'blob:'],
      fontSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'"],
      frameAncestors: ["'self'"],
      frameSrc: ["'self'", 'https://www.youtube.com'],
      formAction: ["'self'"],
    },
  },
  ...(IS_PRODUCTION ? { hsts: { maxAge: 63072000, includeSubDomains: true, preload: false } } : {}),
  xPoweredBy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
};

app.use(helmet(helmetConfig));

// Phase 16D: Permissions-Policy and strict Referrer-Policy — applied separately (Helmet v8 compatibility)
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()'
  );
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── Configuración del Motor de Vistas (EJS) ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Layout support ──
const layoutMiddleware = require('./config/viewEngine');
app.use(layoutMiddleware);

// ── Middlewares Globales ──
const oneYearSec = 365 * 24 * 60 * 60;
const shortCacheSec = 3600; // 1 hour for non-hashed CSS/JS

// Versioned vendor assets — safe to cache aggressively
const vendorCacheOpts = {
  maxAge: process.env.NODE_ENV === 'production' ? oneYearSec : 0,
  immutable: process.env.NODE_ENV === 'production',
};

// Non-hashed CSS/JS — short cache with revalidation
const textCacheOpts = {
  maxAge: process.env.NODE_ENV === 'production' ? shortCacheSec : 0,
  immutable: false,
};

// Immutable media and uploaded files
const mediaCacheOpts = {
  maxAge: process.env.NODE_ENV === 'production' ? oneYearSec : 0,
  immutable: process.env.NODE_ENV === 'production',
};

// ── Compression: gzip/Brotli for text responses (before static to compress CSS/JS) ──
app.use(compression({
  filter: (req, res) => {
    // Skip binary static paths — no benefit from double-compressing
    if (req.path.startsWith('/images/') || req.path.startsWith('/Video/') ||
        req.path.startsWith('/uploads/') || req.path.startsWith('/fonts/')) {
      return false;
    }
    const ct = res.getHeader('Content-Type');
    if (!ct) return compression.filter(req, res);
    const type = String(ct).split(';')[0].trim();
    // Skip already-compressed binary formats
    if (/application\/(octet-stream|zip|gzip|x-gzip|model|gltf|vnd)/.test(type)) return false;
    if (/image\//.test(type)) return false;
    if (/video\//.test(type)) return false;
    if (/audio\//.test(type)) return false;
    return compression.filter(req, res);
  },
}));

app.use('/css', express.static(path.join(__dirname, 'public', 'css'), textCacheOpts));
app.use('/js', express.static(path.join(__dirname, 'public', 'js'), textCacheOpts));
app.use('/images', express.static(path.join(__dirname, 'public', 'images'), mediaCacheOpts));
app.use('/Video', express.static(path.join(__dirname, 'public', 'Video'), mediaCacheOpts));
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), mediaCacheOpts));

// Canonical persistent uploads mount. It must precede the generic public root
// so a checked-in public/uploads directory cannot shadow Railway's volume.
{
  const uploadsAbs = UPLOAD_PUBLIC_ROOT;
  const existed = fs.existsSync(uploadsAbs);
  if (!existed) {
    console.warn(`⚠️  Uploads: ${uploadsAbs} no existe — creando directorio.`);
    fs.mkdirSync(uploadsAbs, { recursive: true });
  }
  let writable = false;
  try {
    fs.accessSync(uploadsAbs, fs.constants.W_OK);
    writable = true;
  } catch (_) { /* not writable */ }
  console.log(`📁 Uploads: ${uploadsAbs} (${existed ? 'existe' : 'creado'}, ${writable ? 'escribible' : 'NO escribible'})`);
  app.use('/uploads', express.static(uploadsAbs, {
    dotfiles: 'deny',
    index: false,
    maxAge: IS_PRODUCTION ? '7d' : 0,
    immutable: IS_PRODUCTION,
  }));
}

app.use(express.static(path.join(__dirname, 'public'), textCacheOpts));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Vendor aliases for homepage modules (scoped, no bundler) ──
app.use(
  '/vendor/three/build',
  express.static(path.join(__dirname, 'node_modules/three/build'), vendorCacheOpts)
);
app.use(
  '/vendor/three/examples/jsm',
  express.static(path.join(__dirname, 'node_modules/three/examples/jsm'), vendorCacheOpts)
);
app.use(
  '/vendor/three',
  express.static(path.join(__dirname, 'node_modules/three'), vendorCacheOpts)
);
app.use(
  '/vendor/gsap',
  express.static(path.join(__dirname, 'node_modules/gsap'), vendorCacheOpts)
);
app.use(
  '/vendor/lenis',
  express.static(path.join(__dirname, 'node_modules/lenis/dist'), vendorCacheOpts)
);

// ── Configuración de Sesiones (MySQL store) ──
app.use(createSessionMiddleware());

// ── Inyectar variables globales en vistas ──
app.use(setLocals);

// ── CSRF: expose token to all views ──
app.use((req, res, next) => {
  res.locals.csrfToken = generateToken(req);
  // Phase 16C: safe JSON serialization for <script type="application/json"> blocks
  res.locals.safeJsonScript = require('./config/jsonLdHelper').safeJsonScript;
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

// ── Base URL for absolute canonicals / JSON-LD / sitemap (Phase 12D) ──
const BASE_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// ── Public SEO defaults from global + page-specific settings (Phase 12A + 12B + 12D) ──
app.use(async (req, res, next) => {
  // Skip admin, auth, API, and static paths
  if (req.path.startsWith('/admin') || req.path.startsWith('/auth') || req.path.startsWith('/api') ||
      req.path.startsWith('/health') || req.path.startsWith('/ready')) return next();

  // Inject base URL for absolute canonical URLs and JSON-LD
  res.locals.baseUrl = BASE_URL;
  try {
    const cms = require('./services/cmsPublishingService');
    const cmsContent = require('./services/cmsContentService');

    // Determine page key from request path
    let pageKey = null;
    if (req.path === '/' || req.path === '') {
      pageKey = 'home';
    } else if (req.path.startsWith('/tienda')) {
      pageKey = 'store';
    } else if (req.path.startsWith('/galeria')) {
      pageKey = 'gallery';
    }

    // Build list of all keys to load: global + page-specific
    const globalKeys = [
      'global.seo_title', 'global.seo_description', 'global.og_image',
      'global.canonical_url', 'global.indexing_mode', 'site.favicon',
      'global.ga_measurement_id', 'global.ga_consent_enabled', 'global.ga_enabled',
      'global.google_verification',
    ];
    const pageKeys = pageKey ? [
      `seo.${pageKey}.title`, `seo.${pageKey}.description`, `seo.${pageKey}.og_image`,
      `seo.${pageKey}.canonical`, `seo.${pageKey}.robots`,
    ] : [];
    const allKeys = [...globalKeys, ...pageKeys];

    const settings = await cms.getPublishedSettings(allKeys);

    // Global defaults
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

    // Phase 14: Analytics & Consent
    if (settings['global.ga_enabled'] === '1') {
      const gaId = settings['global.ga_measurement_id'];
      if (gaId && /^G-[A-Z0-9]{6,}$/.test(String(gaId))) {
        res.locals.gaMeasurementId = String(gaId);
      }
    }
    if (settings['global.ga_consent_enabled'] === '1') {
      res.locals.gaConsentEnabled = true;
    }
    if (settings['global.google_verification']) {
      res.locals.googleVerification = String(settings['global.google_verification']).slice(0, 128);
    }

    // Page-specific SEO (Phase 12B)
    if (pageKey) {
      if (settings[`seo.${pageKey}.title`]) {
        res.locals.pageSeoTitle = settings[`seo.${pageKey}.title`];
      }
      if (settings[`seo.${pageKey}.description`]) {
        res.locals.pageSeoDescription = settings[`seo.${pageKey}.description`];
      }
      if (settings[`seo.${pageKey}.canonical`]) {
        res.locals.pageSeoCanonical = settings[`seo.${pageKey}.canonical`];
      }
      if (settings[`seo.${pageKey}.robots`]) {
        res.locals.pageSeoRobots = settings[`seo.${pageKey}.robots`];
      }
      if (settings[`seo.${pageKey}.og_image`]) {
        const pageOg = await cmsContent.resolveMediaReference(settings[`seo.${pageKey}.og_image`], null);
        if (pageOg && pageOg.url) res.locals.pageSeoOgImage = pageOg.url;
      }
    }
    // Phase 12D: inject common JSON-LD (Organization + WebSite)
    const { buildOrganizationLd, buildWebSiteLd, jsonLdScript } = require('./config/jsonLdHelper');
    const hasSettings = settings && typeof settings === 'object';
    const siteName = hasSettings && settings['global.seo_title']
      ? settings['global.seo_title']
      : (res.locals.globalSeoTitle || require('./config/site').name);
    const siteDescription = hasSettings && settings['global.seo_description']
      ? settings['global.seo_description']
      : (res.locals.globalSeoDescription || require('./config/site').description);
    const orgLd = buildOrganizationLd({
      siteName,
      siteDescription,
      baseUrl: BASE_URL,
      logo: res.locals.globalFavicon || null,
    });
    const webLd = buildWebSiteLd({ siteName, baseUrl: BASE_URL });
    res.locals.jsonLdOrg = jsonLdScript(orgLd);
    res.locals.jsonLdWeb = jsonLdScript(webLd);
  } catch (_) {
    // Graceful fallback
  }
  next();
});

// ── Global auth rate limiters ──
// Phase 16E: adminLoginLimiter removed — unified under /auth/login loginLimiter.
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

// ── Test-only: reset all auth rate limiters ──
app.get('/__test_reset_auth_limiters', async (req, res) => {
  if (process.env.NODE_ENV !== 'test') return res.status(404).end();
  const keys = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  for (const key of keys) {
    try { await authLimiter.resetKey(key); } catch (_) {}
  }
  try {
    const authRoutes = require('./routes/authRoutes');
    for (const key of keys) {
      try { await authRoutes.registerLimiter.resetKey(key); } catch (_) {}
      try { await authRoutes.loginLimiter.resetKey(key); } catch (_) {}
    }
  } catch (_) {}
  res.json({ ok: true });
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

// ── Phase 16E: /admin/login redirects to unified /auth/login with returnTo=/admin ──
app.get('/admin/login', isAdminGuest, (req, res) => {
  return res.redirect('/auth/login?returnTo=/admin');
});
app.post('/admin/login', isAdminGuest, (req, res) => {
  return res.redirect('/auth/login?returnTo=/admin');
});

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

// ── SEO: robots.txt (Phase 12D — uses BASE_URL from above) ──
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

// ── SEO: sitemap.xml (Phase 12D — includes products, categories, gallery) ──
app.get('/sitemap.xml', async (_req, res) => {
  try {
    const pool = require('./config/db');
    const urls = [
      { loc: '/', priority: '1.0' },
      { loc: '/tienda', priority: '0.9' },
      { loc: '/galeria', priority: '0.8' },
    ];

    // Published products
    const [products] = await pool.query(
      "SELECT slug, updated_at FROM products WHERE is_active = 1 AND is_published = 1 ORDER BY updated_at DESC LIMIT 500"
    );
    for (const p of products) {
      urls.push({ loc: '/tienda/' + p.slug, priority: '0.7', lastmod: p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 10) : null });
    }

    // Active categories
    const [cats] = await pool.query(
      "SELECT slug, updated_at FROM categories ORDER BY name ASC LIMIT 100"
    );
    for (const c of cats) {
      urls.push({ loc: '/tienda?category=' + c.slug, priority: '0.6', lastmod: c.updated_at ? new Date(c.updated_at).toISOString().slice(0, 10) : null });
    }

    // Gallery items (if gallery_items table exists)
    try {
      const [gallery] = await pool.query(
        "SELECT slug, updated_at FROM gallery_items WHERE status = 'published' ORDER BY updated_at DESC LIMIT 500"
      );
      for (const g of gallery) {
        urls.push({ loc: '/galeria/' + g.slug, priority: '0.65', lastmod: g.updated_at ? new Date(g.updated_at).toISOString().slice(0, 10) : null });
      }
    } catch (_) { /* gallery_items may not exist yet */ }

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
        `SELECT s.section_key, s.published_style_json AS style_json
           FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
          WHERE p.page_key = ? AND s.section_key IN ('hero', 'showcase', 'services')
            AND s.is_enabled = 1 AND s.published_content_json IS NOT NULL`,
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
    let socialItems = [];

    {
      const section = await resolveSection('hero');
      if (section?.has_published_version && Number(section.is_enabled) === 1) {
        socialItems = await repeatableSvc.getPublishedItems('home_social_items', section.id);
      }
    }

    {
      const section = await resolveSection('showcase');
      if (section?.has_published_version && Number(section.is_enabled) === 1) {
        [logoLoopItems, carouselItems] = await Promise.all([
          repeatableSvc.getPublishedItems('logo_loop_items', section.id),
          repeatableSvc.getPublishedItems('home_carousel_items', section.id),
        ]);
      }
    }

    {
      const section = await resolveSection('services');
      if (section?.has_published_version && Number(section.is_enabled) === 1) {
        featureItems = await repeatableSvc.getPublishedItems('home_feature_items', section.id);
      }
    }

    // Resolve media references
    const resolveMedia = async (ref) => {
      if (!ref) return null;
      return cmsContent.resolveMediaReference(ref, null);
    };

    async function resolveSection(sectionKey) {
      const db = require('./config/db');
      const [[row]] = await db.query(
        `SELECT s.id, s.status, s.is_enabled,
                (s.published_content_json IS NOT NULL) AS has_published_version
           FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
          WHERE p.page_key = 'home' AND s.section_key = ?`,
        [sectionKey]
      );
      return row || null;
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
    for (const item of socialItems) {
      if (item.media_public_id) {
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
      socialItems,
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

    // Phase 15B: Hero GLB preload hint
    if (modelMedia && modelMedia.url) {
      res.locals.heroGlbUrl = modelMedia.url;
    }

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

// ── Health / Readiness (no auth, no session) ──
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const { probeDatabase } = require('./config/databaseReadiness');
app.get('/ready', async (_req, res) => {
  const ready = await probeDatabase();
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'not_ready' });
});

// ── Phase 16D: Proxy/IP diagnostic (admin-only, disabled by default) ──
// Enable temporarily: PROXY_DIAGNOSTIC_ENABLED=true
// Then visit /admin/proxy-diagnostic as an authenticated admin.
// Disable afterward by removing or setting to false.
app.get('/admin/proxy-diagnostic', isAuthenticated, isAdmin, (_req, res) => {
  if (process.env.PROXY_DIAGNOSTIC_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  const trustProxy = app.get('trust proxy');
  res.status(200).json({
    trust_proxy: typeof trustProxy === 'number' ? trustProxy : String(trustProxy),
    ip: _req.ip,
    protocol: _req.protocol,
    secure: _req.secure,
    proxy_count: Array.isArray(_req.ips) ? _req.ips.length : 0,
  });
});

// Enable temporarily: MEDIA_DIAGNOSTIC_ENABLED=true
// Then visit /admin/media-diagnostic as an authenticated admin.
// Disable afterward by removing or setting to false.
app.get('/admin/media-diagnostic', isAuthenticated, isAdmin, (req, res, next) => {
  if (process.env.MEDIA_DIAGNOSTIC_ENABLED !== 'true') {
    return res.status(404).render('pages/404', {
      title: 'Página no encontrada',
      layout: 'layouts/main',
    });
  }
  try {
    const diagnosticController = require('./controllers/mediaDiagnosticController');
    return diagnosticController.mediaDiagnostic(req, res, next);
  } catch (err) {
    return next(err);
  }
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
      pageAlerts: [{
        id: 'server-error',
        type: 'error',
        title: 'Error del servidor',
        description: 'No fue posible completar la solicitud. Inténtalo nuevamente.',
      }],
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
  console.log('[startup] Application startup beginning.');

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
    console.log(`[startup] Server listening on 0.0.0.0:${PORT}.`);
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
