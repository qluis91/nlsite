require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// ── Rutas ──
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

// ── Controllers ──
const authController = require('./controllers/authController');

// ── Middlewares ──
const { setLocals, isAuthenticated, isAdmin, isAdminGuest } = require('./middlewares/authMiddleware');

// ── Inicializar Express ──
const app = express();
const PORT = process.env.PORT || 3000;

// ── Seguridad: Helmet ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
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

// ── Configuración de Sesiones ──
const maxAgeHours = parseInt(process.env.SESSION_MAX_AGE_HOURS, 10);
const sessionMaxAge = (maxAgeHours > 0 ? maxAgeHours : 8) * 60 * 60 * 1000;

app.use(session({
  secret: process.env.SESSION_SECRET || 'clave-secreta-temporal',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: sessionMaxAge,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
}));

// ── Inyectar variables globales en vistas ──
app.use(setLocals);

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
// Admin routes: authentication + admin role enforced at both mount and router level
app.use('/admin', isAuthenticated, isAdmin, adminRoutes);

// ── Página de Inicio ──
app.get('/', (req, res) => {
  res.render('pages/home', {
    title: 'Inicio',
    layout: 'layouts/main',
  });
});

// ── 404 - Página no encontrada ──
app.use((req, res) => {
  res.status(404).render('pages/404', {
    title: 'Página no encontrada',
    layout: 'layouts/main',
  });
});

// ── 500 - Error del servidor ──
app.use((err, req, res, _next) => {
  console.error('Error del servidor:', err);
  res.status(500).render('pages/500', {
    title: 'Error del servidor',
    layout: 'layouts/main',
  });
});

// ── Iniciar Servidor ──
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log(`  🚀 Servidor corriendo en:`);
  console.log(`  ➜ http://localhost:${PORT}`);
  console.log(`  🌐 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log('═══════════════════════════════════════');
});
