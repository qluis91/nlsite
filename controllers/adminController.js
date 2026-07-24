const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { mapRole, mapRoleId } = require('../config/roles');

// ── Panel de Control (Dashboard) ──
exports.dashboard = async (req, res, next) => {
  try {
    const [userCount] = await pool.query('SELECT COUNT(*) AS total FROM users');
    const [adminCount] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE role_id = 1');
    const [activeCount] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE is_active = 1');

    const orderQueries = [
      ['pendingPayment', "SELECT COUNT(*) AS total FROM orders WHERE order_status IN ('pending_payment','pending_shipping_quote')"],
      ['pendingReview', "SELECT COUNT(*) AS total FROM payment_proofs WHERE status = 'pending_review'"],
      ['inProduction', "SELECT COUNT(*) AS total FROM orders WHERE order_status IN ('preparing','ready_for_pickup','ready_for_dispatch')"],
      ['readyForPickup', "SELECT COUNT(*) AS total FROM orders WHERE order_status = 'ready_for_pickup'"],
      ['readyForDispatch', "SELECT COUNT(*) AS total FROM orders WHERE order_status = 'ready_for_dispatch'"],
      ['totalOrders', 'SELECT COUNT(*) AS total FROM orders'],
    ];
    const orderStats = {};
    for (const [key, sql] of orderQueries) {
      const [[row]] = await pool.query(sql);
      orderStats[key] = Number(row.total);
    }
    const [lowStock] = await pool.query(
      "SELECT COUNT(*) AS total FROM products WHERE is_active = 1 AND is_published = 1 AND stock_quantity > 0 AND stock_quantity <= 5"
    );
    orderStats.lowStock = Number(lowStock[0].total);

    const [recentOrders] = await pool.query(
      `SELECT o.order_reference, o.customer_name, o.order_status, o.payment_status, o.final_total, o.created_at
         FROM orders o ORDER BY o.created_at DESC LIMIT 8`
    );
    const { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } = require('../config/orderOptions');
    const recent = recentOrders.map(o => ({
      ...o,
      orderStatusLabel: ORDER_STATUS_LABELS[o.order_status] || o.order_status,
      paymentStatusLabel: PAYMENT_STATUS_LABELS[o.payment_status] || o.payment_status,
    }));

    res.render('pages/admin/dashboard', {
      title: 'Panel de Control',
      layout: 'layouts/admin',
      stats: {
        totalUsers: userCount[0].total,
        totalAdmins: adminCount[0].total,
        activeUsers: activeCount[0].total,
        ...orderStats,
      },
      recentOrders: Array.isArray(recent) ? recent : [],
    });
  } catch (error) {
    return next(error);
  }
};

// ── Listar Usuarios ──
exports.listUsers = async (req, res, next) => {
  try {
    const [users] = await pool.query(
      'SELECT id, name, email, role_id, is_active, created_at FROM users ORDER BY created_at DESC'
    );

    // Mapear role_id a string para las vistas
    const mappedUsers = users.map((u) => ({
      ...u,
      role: mapRole(u.role_id),
    }));

    res.render('pages/admin/users', {
      title: 'Gestión de Usuarios',
      layout: 'layouts/admin',
      users: mappedUsers,
    });
  } catch (error) {
    return next(error);
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
exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    const isActive = req.body.is_active ? 1 : 0;

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
      'INSERT INTO users (name, email, password, role_id, is_active) VALUES (?, ?, ?, ?, ?)',
      [name, email, hashedPassword, mapRoleId(role || 'user'), isActive]
    );

    req.session.success_msg = 'Usuario creado exitosamente.';
    res.redirect('/admin/users');
  } catch (error) {
    return next(error);
  }
};

// ── Mostrar formulario para editar usuario ──
exports.showEditUser = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role_id, is_active FROM users WHERE id = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      req.session.error_msg = 'Usuario no encontrado.';
      return res.redirect('/admin/users');
    }

    const user = rows[0];
    user.role = mapRole(user.role_id);

    res.render('pages/admin/user-form', {
      title: 'Editar Usuario',
      layout: 'layouts/admin',
      user,
      action: `/admin/users/${user.id}/edit`,
    });
  } catch (error) {
    return next(error);
  }
};

// ── Actualizar Usuario ──
exports.updateUser = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    const isActive = req.body.is_active ? 1 : 0;
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

    const roleId = mapRoleId(role);

    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      await pool.query(
        'UPDATE users SET name = ?, email = ?, password = ?, role_id = ?, is_active = ? WHERE id = ?',
        [name, email, hashedPassword, roleId, isActive, userId]
      );
    } else {
      await pool.query(
        'UPDATE users SET name = ?, email = ?, role_id = ?, is_active = ? WHERE id = ?',
        [name, email, roleId, isActive, userId]
      );
    }

    req.session.success_msg = 'Usuario actualizado exitosamente.';
    res.redirect('/admin/users');
  } catch (error) {
    return next(error);
  }
};

// ── Activar / Desactivar Usuario ──
exports.toggleUserStatus = async (req, res, next) => {
  try {
    const userId = req.params.id;

    // No permitir desactivarse a sí mismo
    if (parseInt(userId) === req.session.user.id) {
      req.session.error_msg = 'No puedes desactivar tu propio usuario.';
      return res.redirect('/admin/users');
    }

    const [rows] = await pool.query('SELECT is_active FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      req.session.error_msg = 'Usuario no encontrado.';
      return res.redirect('/admin/users');
    }

    const newStatus = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, userId]);

    const action = newStatus ? 'activado' : 'desactivado';
    req.session.success_msg = `Usuario ${action} exitosamente.`;
    res.redirect('/admin/users');
  } catch (error) {
    return next(error);
  }
};

// ── Eliminar Usuario ──
exports.deleteUser = async (req, res, next) => {
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
    return next(error);
  }
};
