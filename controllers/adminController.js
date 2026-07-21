const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// ── Panel de Control (Dashboard) ──
exports.dashboard = async (req, res) => {
  try {
    const [userCount] = await pool.query('SELECT COUNT(*) AS total FROM users');
    const [adminCount] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE role = ?', ['admin']);
    const [activeCount] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE is_active = 1');

    res.render('pages/admin/dashboard', {
      title: 'Panel de Control',
      layout: 'layouts/admin',
      stats: {
        totalUsers: userCount[0].total,
        totalAdmins: adminCount[0].total,
        activeUsers: activeCount[0].total,
      },
    });
  } catch (error) {
    console.error('Error en dashboard:', error);
    req.session.error_msg = 'Error al cargar el panel.';
    res.redirect('/');
  }
};

// ── Listar Usuarios ──
exports.listUsers = async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY created_at DESC'
    );

    res.render('pages/admin/users', {
      title: 'Gestión de Usuarios',
      layout: 'layouts/admin',
      users,
    });
  } catch (error) {
    console.error('Error al listar usuarios:', error);
    req.session.error_msg = 'Error al cargar usuarios.';
    res.redirect('/admin');
  }
};

// ── Mostrar formulario para crear usuario ──
exports.showCreateUser = (req, res) => {
  res.render('pages/admin/user-form', {
    title: 'Crear Usuario',
    layout: 'layouts/admin',
    user: null,
    action: '/admin/users/create',
  });
};

// ── Crear Usuario ──
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      req.session.error_msg = 'Nombre, email y contraseña son obligatorios.';
      return res.redirect('/admin/users/create');
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      req.session.error_msg = 'El email ya está registrado.';
      return res.redirect('/admin/users/create');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, role || 'user']
    );

    req.session.success_msg = 'Usuario creado exitosamente.';
    res.redirect('/admin/users');
  } catch (error) {
    console.error('Error al crear usuario:', error);
    req.session.error_msg = 'Error al crear usuario.';
    res.redirect('/admin/users');
  }
};

// ── Mostrar formulario para editar usuario ──
exports.showEditUser = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, is_active FROM users WHERE id = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      req.session.error_msg = 'Usuario no encontrado.';
      return res.redirect('/admin/users');
    }

    res.render('pages/admin/user-form', {
      title: 'Editar Usuario',
      layout: 'layouts/admin',
      user: rows[0],
      action: `/admin/users/${rows[0].id}/edit`,
    });
  } catch (error) {
    console.error('Error al cargar usuario:', error);
    req.session.error_msg = 'Error al cargar usuario.';
    res.redirect('/admin/users');
  }
};

// ── Actualizar Usuario ──
exports.updateUser = async (req, res) => {
  try {
    const { name, email, password, role, is_active } = req.body;
    const userId = req.params.id;

    if (!name || !email) {
      req.session.error_msg = 'Nombre y email son obligatorios.';
      return res.redirect(`/admin/users/${userId}/edit`);
    }

    // Verificar email único (excluyendo al usuario actual)
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [email, userId]
    );
    if (existing.length > 0) {
      req.session.error_msg = 'El email ya está en uso por otro usuario.';
      return res.redirect(`/admin/users/${userId}/edit`);
    }

    let query;
    let params;

    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      query = 'UPDATE users SET name = ?, email = ?, password = ?, role = ?, is_active = ? WHERE id = ?';
      params = [name, email, hashedPassword, role, is_active ? 1 : 0, userId];
    } else {
      query = 'UPDATE users SET name = ?, email = ?, role = ?, is_active = ? WHERE id = ?';
      params = [name, email, role, is_active ? 1 : 0, userId];
    }

    await pool.query(query, params);

    req.session.success_msg = 'Usuario actualizado exitosamente.';
    res.redirect('/admin/users');
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    req.session.error_msg = 'Error al actualizar usuario.';
    res.redirect('/admin/users');
  }
};

// ── Eliminar Usuario ──
exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // No permitir que un admin se elimine a sí mismo
    if (parseInt(userId) === req.session.user.id) {
      req.session.error_msg = 'No puedes eliminar tu propio usuario.';
      return res.redirect('/admin/users');
    }

    await pool.query('DELETE FROM users WHERE id = ?', [userId]);

    req.session.success_msg = 'Usuario eliminado exitosamente.';
    res.redirect('/admin/users');
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    req.session.error_msg = 'Error al eliminar usuario.';
    res.redirect('/admin/users');
  }
};

// ── Activar / Desactivar Usuario ──
exports.toggleUserStatus = async (req, res) => {
  try {
    const userId = req.params.id;

    if (parseInt(userId) === req.session.user.id) {
      req.session.error_msg = 'No puedes cambiar el estado de tu propio usuario.';
      return res.redirect('/admin/users');
    }

    const [rows] = await pool.query('SELECT is_active FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      req.session.error_msg = 'Usuario no encontrado.';
      return res.redirect('/admin/users');
    }

    const newStatus = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, userId]);

    req.session.success_msg = `Usuario ${newStatus ? 'activado' : 'desactivado'} exitosamente.`;
    res.redirect('/admin/users');
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    req.session.error_msg = 'Error al cambiar estado del usuario.';
    res.redirect('/admin/users');
  }
};
