const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// ── Mostrar formulario de Login ──
exports.showLogin = (req, res) => {
  res.render('pages/login', {
    title: 'Iniciar Sesión',
    layout: 'layouts/main',
  });
};

// ── Procesar Login ──
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      req.session.error_msg = 'Todos los campos son obligatorios.';
      return res.redirect('/auth/login');
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);

    if (rows.length === 0) {
      req.session.error_msg = 'Credenciales inválidas.';
      return res.redirect('/auth/login');
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      req.session.error_msg = 'Credenciales inválidas.';
      return res.redirect('/auth/login');
    }

    // Guardar en sesión (sin la contraseña)
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    };

    req.session.success_msg = `¡Bienvenido, ${user.name}!`;
    return res.redirect('/');
  } catch (error) {
    console.error('Error en login:', error);
    req.session.error_msg = 'Error del servidor. Intenta de nuevo.';
    return res.redirect('/auth/login');
  }
};

// ── Mostrar formulario de Registro ──
exports.showRegister = (req, res) => {
  res.render('pages/register', {
    title: 'Registrarse',
    layout: 'layouts/main',
  });
};

// ── Procesar Registro ──
exports.register = async (req, res) => {
  try {
    const { name, email, password, password2 } = req.body;

    // Validaciones
    if (!name || !email || !password || !password2) {
      req.session.error_msg = 'Todos los campos son obligatorios.';
      return res.redirect('/auth/register');
    }

    if (password !== password2) {
      req.session.error_msg = 'Las contraseñas no coinciden.';
      return res.redirect('/auth/register');
    }

    if (password.length < 6) {
      req.session.error_msg = 'La contraseña debe tener al menos 6 caracteres.';
      return res.redirect('/auth/register');
    }

    // Verificar si el email ya existe
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      req.session.error_msg = 'El email ya está registrado.';
      return res.redirect('/auth/register');
    }

    // Hash de contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, 'user']
    );

    req.session.success_msg = 'Registro exitoso. Ahora puedes iniciar sesión.';
    return res.redirect('/auth/login');
  } catch (error) {
    console.error('Error en registro:', error);
    req.session.error_msg = 'Error del servidor. Intenta de nuevo.';
    return res.redirect('/auth/register');
  }
};

// ── Cerrar Sesión ──
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Error al cerrar sesión:', err);
    res.redirect('/auth/login');
  });
};
