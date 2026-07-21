require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

// ── Rutas ──
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');

// ── Middlewares ──
const { setLocals } = require('./middlewares/authMiddleware');

// ── Inicializar Express ──
const app = express();
const PORT = process.env.PORT || 3000;

// ── Configuración del Motor de Vistas (EJS) ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Middlewares Globales ──
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Configuración de Sesiones ──
app.use(session({
  secret: process.env.SESSION_SECRET || 'clave-secreta-temporal',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 24 horas
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  },
}));

// ── Inyectar variables globales en vistas ──
app.use(setLocals);

// ── Rutas ──
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);

// ── Página de Inicio ──
app.get('/', (req, res) => {
  res.render('pages/home', {
    title: 'Inicio',
    layout: 'layouts/main',
  });
});

// ── 404 - Página no encontrada ──
app.use((req, res) => {
  res.status(404).render('pages/home', {
    title: 'Página no encontrada',
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
