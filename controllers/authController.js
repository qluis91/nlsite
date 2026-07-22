const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { mapRole } = require('../config/roles');

// ── Mostrar formulario de Login ──
exports.showLogin = (req, res) => {
  res.render('pages/login', {
    title: 'Iniciar Sesión',
    layout: 'layouts/main',
  });
};

// ── Procesar Login ──
exports.login = async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      req.session.error_msg = 'Todos los campos son obligatorios.';
      return res.redirect('/auth/login');
    }

    const [rows] = await pool.query(
      'SELECT id, name, email, password, role_id FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email]
    );

    if (rows.length !== 1) {
      req.session.error_msg = 'Correo electrónico o contraseña incorrectos.';
      return res.redirect('/auth/login');
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      req.session.error_msg = 'Correo electrónico o contraseña incorrectos.';
      return res.redirect('/auth/login');
    }

    req.session.regenerate((err) => {
      if (err) return next(err);

      const roleId = Number(user.role_id);
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: roleId,
        role: mapRole(roleId),
      };

      req.session.success_msg = `¡Bienvenido, ${user.name}!`;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        return res.redirect('/');
      });
    });
  } catch (error) {
    return next(error);
  }
};

// ── Mostrar formulario de Registro ──
exports.showRegister = (req, res) => {
  const form = req.session.registerForm || {};
  delete req.session.registerForm;
  res.render('pages/register', {
    title: 'Registrarse',
    layout: 'layouts/main',
    form,
  });
};

// ── Procesar Registro ──
exports.register = async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const password2 = req.body.password2 || '';

    req.session.registerForm = { name, email };

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

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );
    if (existing.length > 0) {
      req.session.error_msg = 'Ya existe una cuenta registrada con ese correo electrónico.';
      return res.redirect('/auth/register');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await pool.query(
      'INSERT INTO users (name, email, password, role_id, is_active) VALUES (?, ?, ?, 2, 1)',
      [name, email, hashedPassword]
    );

    delete req.session.registerForm;
    req.session.success_msg = 'Cuenta creada correctamente. Ya puedes iniciar sesión.';
    return res.redirect('/auth/login');
  } catch (error) {
    return next(error);
  }
};

// ── Cerrar Sesión ──
exports.logout = (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);

    res.clearCookie('connect.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return res.redirect('/auth/login');
  });
};

// ── Mostrar formulario de Login de Administrador ──
exports.showAdminLogin = (req, res) => {
  res.render('pages/admin-login', {
    title: 'Acceso Administrativo',
    layout: 'layouts/main',
  });
};

// ── Procesar Login de Administrador ──
exports.adminLogin = async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      req.session.error_msg = 'Credenciales administrativas inválidas.';
      return res.redirect('/admin/login');
    }

    const [rows] = await pool.query(
      'SELECT id, name, email, password, role_id FROM users WHERE email = ? AND is_active = 1 AND role_id = 1 LIMIT 1',
      [email]
    );

    if (rows.length !== 1) {
      req.session.error_msg = 'Credenciales administrativas inválidas.';
      return res.redirect('/admin/login');
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      req.session.error_msg = 'Credenciales administrativas inválidas.';
      return res.redirect('/admin/login');
    }

    req.session.regenerate((err) => {
      if (err) return next(err);

      const roleId = Number(user.role_id);
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: roleId,
        role: mapRole(roleId),
      };

      req.session.success_msg = `¡Bienvenido, ${user.name}!`;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        return res.redirect('/admin');
      });
    });
  } catch (error) {
    return next(error);
  }
};
