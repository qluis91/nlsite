const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { mapRole } = require('../config/roles');
const mailer = require('../config/mailer');
const { captureCartForRegeneration, restoreCartAfterRegeneration } = require('../services/cartService');
const { safeAuthReturnPath } = require('../middlewares/authMiddleware');

// ── Helpers ──
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function expiresAt(minutesEnv) {
  const mins = parseInt(minutesEnv, 10) || 30;
  const d = new Date(Date.now() + mins * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ── Mostrar formulario de Login ──
exports.showLogin = (req, res) => {
  const form = req.session.loginForm || {};
  delete req.session.loginForm;

  res.render('pages/login', {
    title: 'Iniciar Sesión',
    layout: 'layouts/main',
    pageClass: 'page-auth',
    pageStyles: ['/css/auth.css'],
    robots: 'noindex, nofollow',
    hideFooter: true,
    returnTo: safeAuthReturnPath(req.query.returnTo),
    form,
  });
};

// ── Procesar Login ──
exports.login = async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const returnTo = safeAuthReturnPath(req.body.returnTo);
    const loginPath = returnTo === '/' ? '/auth/login' : `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

    // Never persist the password; only keep the normalized email after an error.
    req.session.loginForm = { email };

    if (!email || !password) {
      req.session.error_msg = 'Todos los campos son obligatorios.';
      return res.redirect(loginPath);
    }

    const [rows] = await pool.query(
      'SELECT id, name, email, password, role_id, avatar_path FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email]
    );

    if (rows.length !== 1) {
      req.session.error_msg = 'Correo electrónico o contraseña incorrectos.';
      return res.redirect(loginPath);
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      req.session.error_msg = 'Correo electrónico o contraseña incorrectos.';
      return res.redirect(loginPath);
    }

    // Preserve guest cart before session regeneration
    const savedCart = captureCartForRegeneration(req);

    req.session.regenerate((err) => {
      if (err) return next(err);

      const roleId = Number(user.role_id);
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role_id: roleId,
        role: mapRole(roleId),
        avatar_path: user.avatar_path || null,
      };

      // Restore guest cart into new session
      restoreCartAfterRegeneration(req, savedCart);

      const isAdmin = roleId === 1;
      req.session.success_msg = `¡Bienvenido, ${user.name}!`;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        // Admin → /admin (or validated returnTo if not bare "/")
        if (isAdmin) return res.redirect(returnTo === '/' ? '/admin' : returnTo);
        // Normal user: never redirect to /admin, fall back to /cuenta
        if (returnTo === '/admin') return res.redirect('/cuenta');
        return res.redirect(returnTo === '/' ? '/cuenta' : returnTo);
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
    pageClass: 'page-auth',
    pageStyles: ['/css/auth.css'],
    robots: 'noindex, nofollow',
    hideFooter: true,
    form,
  });
};

// ── Procesar Registro (pendiente de verificación) ──
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

    // Basic email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      req.session.error_msg = 'El formato del correo electrónico no es válido.';
      return res.redirect('/auth/register');
    }

    // Check existing verified user — do NOT reveal existence
    const [existingUser] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
      // Generic response to prevent account enumeration
      req.session.success_msg =
        'Si el correo es válido, recibirás un enlace de verificación.';
      return res.redirect('/auth/verify-pending');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expires = expiresAt(process.env.EMAIL_VERIFICATION_EXPIRES_MINUTES);
    const expiresMinutes = parseInt(process.env.EMAIL_VERIFICATION_EXPIRES_MINUTES, 10) || 30;

    // Clean up expired pending registrations
    await pool.query('DELETE FROM pending_registrations WHERE expires_at < NOW()');
    // Replace any prior pending registration for this email
    await pool.query('DELETE FROM pending_registrations WHERE email = ?', [email]);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        'INSERT INTO pending_registrations (name, email, password_hash, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
        [name, email, hashedPassword, tokenHash, expires]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    // Try to send verification email
    try {
      await mailer.sendVerificationEmail(email, name, rawToken, expiresMinutes);
    } catch (mailErr) {
      console.error('Error enviando correo de verificación:', mailErr.message);
      // Remove pending registration if email fails
      await pool.query('DELETE FROM pending_registrations WHERE email = ?', [email]);
      req.session.error_msg = 'No se pudo enviar el correo de verificación. Inténtalo de nuevo.';
      return res.redirect('/auth/register');
    }

    delete req.session.registerForm;
    req.session.pendingEmail = email;
    req.session.pendingEmailMask = maskEmail(email);
    req.session.success_msg = 'Te hemos enviado un correo de verificación. Revisa tu bandeja de entrada.';
    return res.redirect('/auth/verify-pending');
  } catch (error) {
    return next(error);
  }
};

// ── Mostrar página de verificación pendiente ──
exports.showVerifyPending = (req, res) => {
  const masked = req.session.pendingEmailMask || '';
  const expiresMinutes = parseInt(process.env.EMAIL_VERIFICATION_EXPIRES_MINUTES, 10) || 30;
  res.render('pages/verify-pending', {
    title: 'Verifica tu cuenta',
    layout: 'layouts/main',
    expiresMinutes,
    maskedEmail: masked,
  });
};

// ── Verificar email con token ──
exports.verifyEmail = async (req, res, next) => {
  try {
    const rawToken = req.query.token || '';
    if (!rawToken) {
      req.session.error_msg = 'Enlace de verificación inválido.';
      return res.redirect('/auth/login');
    }

    const tokenHash = hashToken(rawToken);

    // Clean expired registrations
    await pool.query('DELETE FROM pending_registrations WHERE expires_at < NOW()');

    const [rows] = await pool.query(
      'SELECT * FROM pending_registrations WHERE token_hash = ? AND expires_at > NOW() LIMIT 1',
      [tokenHash]
    );

    if (rows.length !== 1) {
      req.session.error_msg = 'El enlace de verificación es inválido o ha expirado.';
      return res.redirect('/auth/login');
    }

    const pending = rows[0];

    // Ensure email isn't already verified
    const [existingUser] = await pool.query('SELECT id FROM users WHERE email = ?', [pending.email]);
    if (existingUser.length > 0) {
      await pool.query('DELETE FROM pending_registrations WHERE id = ?', [pending.id]);
      req.session.error_msg = 'Esta cuenta ya fue verificada.';
      return res.redirect('/auth/login');
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        'INSERT INTO users (name, email, password, role_id, is_active) VALUES (?, ?, ?, 2, 1)',
        [pending.name, pending.email, pending.password_hash]
      );

      await conn.query('DELETE FROM pending_registrations WHERE id = ?', [pending.id]);

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    req.session.success_msg = 'Correo verificado. Tu cuenta fue creada correctamente.';
    return res.redirect('/auth/login');
  } catch (error) {
    return next(error);
  }
};

// ── Reenviar verificación ──
exports.showResendForm = (req, res) => {
  res.render('pages/resend-verification', {
    title: 'Reenviar verificación',
    layout: 'layouts/main',
  });
};

exports.resendVerification = async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const expiresMinutes = parseInt(process.env.EMAIL_VERIFICATION_EXPIRES_MINUTES, 10) || 30;

    if (!email) {
      req.session.success_msg =
        'Si existe un registro pendiente para ese correo, enviaremos un nuevo enlace de verificación.';
      return res.redirect('/auth/verify-pending');
    }

    // Clean expired
    await pool.query('DELETE FROM pending_registrations WHERE expires_at < NOW()');

    const [rows] = await pool.query(
      'SELECT name, email FROM pending_registrations WHERE email = ? AND expires_at > NOW() LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      // Generic response — don't reveal if email exists
      req.session.success_msg =
        'Si existe un registro pendiente para ese correo, enviaremos un nuevo enlace de verificación.';
      return res.redirect('/auth/verify-pending');
    }

    const pending = rows[0];
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expires = expiresAt(process.env.EMAIL_VERIFICATION_EXPIRES_MINUTES);

    await pool.query(
      'UPDATE pending_registrations SET token_hash = ?, expires_at = ? WHERE email = ?',
      [tokenHash, expires, email]
    );

    try {
      await mailer.sendVerificationEmail(email, pending.name, rawToken, expiresMinutes);
    } catch (mailErr) {
      console.error('Error reenviando verificación:', mailErr.message);
      req.session.success_msg = 'No se pudo enviar el correo. Inténtalo de nuevo.';
      return res.redirect('/auth/verify-pending');
    }

    req.session.success_msg =
      'Si existe un registro pendiente para ese correo, enviaremos un nuevo enlace de verificación.';
    return res.redirect('/auth/verify-pending');
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

// ── Mostrar formulario de olvidó contraseña ──
exports.showForgotPassword = (req, res) => {
  res.render('pages/forgot-password', {
    title: 'Recuperar contraseña',
    layout: 'layouts/main',
  });
};

// ── Procesar olvidó contraseña ──
exports.forgotPassword = async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const expiresMinutes = parseInt(process.env.PASSWORD_RESET_EXPIRES_MINUTES, 10) || 30;

    if (!email) {
      req.session.success_msg =
        'Si existe una cuenta activa con ese correo, recibirás un enlace para restablecer la contraseña.';
      return res.redirect('/auth/forgot-password');
    }

    const [rows] = await pool.query(
      'SELECT id, name, email FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email]
    );

    if (rows.length === 1) {
      const user = rows[0];
      const rawToken = generateToken();
      const tokenHash = hashToken(rawToken);
      const expires = expiresAt(process.env.PASSWORD_RESET_EXPIRES_MINUTES);

      // Invalidate previous unused tokens for this user
      await pool.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
        [user.id]
      );

      await pool.query(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        [user.id, tokenHash, expires]
      );

      try {
        await mailer.sendPasswordResetEmail(user.email, user.name, rawToken, expiresMinutes);
      } catch (mailErr) {
        console.error('Error enviando correo de recuperación:', mailErr.message);
        await pool.query('DELETE FROM password_reset_tokens WHERE token_hash = ?', [tokenHash]);
      }
    }

    // Always same generic response
    req.session.success_msg =
      'Si existe una cuenta activa con ese correo, recibirás un enlace para restablecer la contraseña.';
    return res.redirect('/auth/forgot-password');
  } catch (error) {
    return next(error);
  }
};

// ── Mostrar formulario de reset de contraseña ──
exports.showResetPassword = async (req, res, next) => {
  try {
    const rawToken = req.query.token || '';

    if (!rawToken) {
      req.session.error_msg = 'Enlace de restablecimiento inválido.';
      return res.redirect('/auth/login');
    }

    const tokenHash = hashToken(rawToken);

    // Clean expired/used tokens
    await pool.query('DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL');

    const [rows] = await pool.query(
      'SELECT id, user_id, expires_at FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
      [tokenHash]
    );

    if (rows.length !== 1) {
      req.session.error_msg = 'El enlace de restablecimiento es inválido o ha expirado.';
      return res.redirect('/auth/login');
    }

    res.render('pages/reset-password', {
      title: 'Nueva contraseña',
      layout: 'layouts/main',
      token: rawToken,
    });
  } catch (error) {
    return next(error);
  }
};

// ── Procesar reset de contraseña ──
exports.resetPassword = async (req, res, next) => {
  try {
    const rawToken = (req.body.token || '').trim();
    const password = req.body.password || '';
    const password2 = req.body.password2 || '';

    if (!rawToken) {
      req.session.error_msg = 'Enlace de restablecimiento inválido.';
      return res.redirect('/auth/login');
    }

    if (!password || !password2 || password !== password2) {
      req.session.error_msg = 'Las contraseñas no coinciden.';
      return res.redirect(`/auth/reset-password?token=${encodeURIComponent(rawToken)}`);
    }

    if (password.length < 6) {
      req.session.error_msg = 'La contraseña debe tener al menos 6 caracteres.';
      return res.redirect(`/auth/reset-password?token=${encodeURIComponent(rawToken)}`);
    }

    const tokenHash = hashToken(rawToken);

    const [rows] = await pool.query(
      'SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
      [tokenHash]
    );

    if (rows.length !== 1) {
      req.session.error_msg = 'El enlace de restablecimiento es inválido o ha expirado.';
      return res.redirect('/auth/login');
    }

    const resetEntry = rows[0];
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, resetEntry.user_id]);

      // Mark token used, invalidate any others
      await conn.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
        [resetEntry.user_id]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    req.session.success_msg = 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.';
    return res.redirect('/auth/login');
  } catch (error) {
    return next(error);
  }
};

// ── Helpers ──
function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}***@${domain}`;
}
