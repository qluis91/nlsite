require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const { csrfSync } = require('csrf-sync');

// ── Session store ──
const { createSessionMiddleware, sessionStore } = require('./config/session');

// ── CSRF Protection ──
const {
  csrfSynchronisedProtection,
  generateToken,
} = csrfSync({
  getTokenFromRequest: (req) => req.body?._csrf,
});

// ── Rutas ──
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const searchRoutes = require('./routes/searchRoutes');

// ── Controllers ──
const authController = require('./controllers/authController');

// ── Middlewares ──
const { setLocals, isAuthenticated, isAdmin, isAdminGuest } = require('./middlewares/authMiddleware');

// ── Inicializar Express ──
const app = express();
const PORT = process.env.PORT || 3000;

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
// alias '/vendor/three/' → node_modules/three/ so 'three' import resolves
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

// ── CSRF: validate state-changing requests ──
app.use(csrfSynchronisedProtection);

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

// ── Rutas de Login de Administrador (ANTES del middleware de admin) ──
app.get('/admin/login', isAdminGuest, authController.showAdminLogin);
app.post('/admin/login', isAdminGuest, adminLoginLimiter, authController.adminLogin);

// ── Rutas ──
app.use('/auth', authRoutes);
app.use('/buscar', searchRoutes);
// Admin routes: authentication + admin role enforced at both mount and router level
app.use('/admin', isAuthenticated, isAdmin, adminRoutes);

// ── Página de Inicio ──
app.get('/', (req, res) => {
  res.render('pages/home', {
    title: 'Inicio',
    layout: 'layouts/main',
    pageClass: 'page-home',
    pageStyles: ['/css/home.css'],
  });
});

// ── 404 - Página no encontrada ──
app.use((req, res) => {
  res.status(404).render('pages/404', {
    title: 'Página no encontrada',
    layout: 'layouts/main',
  });
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
  console.error('Error del servidor:', err);
  res.status(500).render('pages/500', {
    title: 'Error del servidor',
    layout: 'layouts/main',
  });
});

// ── Iniciar servidor (esperar store readiness) ──
sessionStore.onReady()
  .then(() => {
    app.listen(PORT, () => {
      console.log('═══════════════════════════════════════');
      console.log('  🚀 Servidor corriendo en:');
      console.log('  ➜ http://localhost:' + PORT);
      console.log('  🌐 Entorno: ' + (process.env.NODE_ENV || 'development'));
      console.log('  💾 Sesiones: MySQL (persistentes)');
      console.log('═══════════════════════════════════════');
    });
  })
  .catch((err) => {
    console.error('❌ Error al iniciar el almacenamiento de sesiones en MySQL:', err.message);
    process.exit(1);
  });
