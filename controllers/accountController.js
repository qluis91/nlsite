const bcrypt = require('bcryptjs');
const accountService = require('../services/accountService');
const customerOrders = require('../services/customerOrderService');
const imageProcessing = require('../services/imageProcessingService');
const { validateProfile, validatePasswordChange } = require('../validators/accountValidator');
const { captureCartForRegeneration, restoreCartAfterRegeneration } = require('../services/cartService');
const { mapRole } = require('../config/roles');

function accountViewOptions(accountUser, accountSection, extra = {}) {
  return {
    layout: 'layouts/account',
    robots: 'noindex, nofollow',
    pageClass: 'account-page',
    accountUser,
    accountInitials: accountService.getInitials(accountUser),
    accountSection,
    ...extra,
  };
}

function redirectWithError(req, path, message) {
  req.session.error_msg = message;
  return path;
}

exports.dashboard = async (req, res, next) => {
  try {
    const [accountUser, summary] = await Promise.all([
      accountService.getUserProfile(req.session.user.id),
      customerOrders.getAccountDashboardSummary(req.session.user.id),
    ]);
    if (!accountUser) return res.redirect('/auth/login');
    return res.render('pages/account/dashboard', accountViewOptions(accountUser, 'dashboard', {
      title: 'Mi cuenta',
      summary,
    }));
  } catch (error) {
    return next(error);
  }
};

exports.showProfile = async (req, res, next) => {
  try {
    const accountUser = await accountService.getUserProfile(req.session.user.id);
    if (!accountUser) return res.redirect('/auth/login');
    const submitted = req.session.accountProfileForm || null;
    delete req.session.accountProfileForm;
    const form = submitted?.values || {
      name: accountUser.name || '',
      lastName: accountUser.last_name || '',
      phone: accountUser.phone || '',
    };
    return res.render('pages/account/profile', accountViewOptions(accountUser, 'profile', {
      title: 'Mi perfil',
      form,
      fieldErrors: submitted?.errors || {},
    }));
  } catch (error) {
    return next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const result = validateProfile(req.body);
    if (!result.valid) {
      req.session.accountProfileForm = {
        values: result.displayValues,
        errors: result.errors,
      };
      req.session.error_msg = 'Revisa los campos indicados.';
      return res.redirect('/cuenta/perfil');
    }
    const updated = await accountService.updateProfile(req.session.user.id, result.values);
    if (!updated) {
      return res.redirect(redirectWithError(req, '/auth/login', 'La cuenta ya no está disponible.'));
    }
    req.session.user.name = updated.name;
    req.session.user.email = updated.email;
    req.session.success_msg = 'Perfil actualizado correctamente.';
    return res.redirect('/cuenta/perfil');
  } catch (error) {
    return next(error);
  }
};

exports.updateAvatar = async (req, res, next) => {
  if (!req.file) {
    req.session.error_msg = 'Selecciona una imagen para el avatar.';
    return res.redirect('/cuenta/perfil');
  }

  let processed = null;
  try {
    const { dir, urlPrefix } = imageProcessing.avatarStoragePath(req.session.user.id);
    processed = await imageProcessing.processImage(req.file, dir, imageProcessing.PROFILES.avatar);
    const publicPath = `${urlPrefix}${processed.fileName}`;
    const oldPublicPath = await accountService.replaceAvatar(req.session.user.id, publicPath);

    const oldAbsolutePath = accountService.resolveOwnedAvatarPath(req.session.user.id, oldPublicPath);
    if (oldAbsolutePath) await imageProcessing.deleteProcessedImage(oldAbsolutePath);

    req.session.success_msg = 'Avatar actualizado correctamente.';
    return res.redirect('/cuenta/perfil');
  } catch (error) {
    if (processed?.filePath) await imageProcessing.deleteProcessedImage(processed.filePath);
    req.session.error_msg = error.message.includes('imagen')
      ? error.message
      : 'No se pudo actualizar el avatar.';
    return res.redirect('/cuenta/perfil');
  }
};

exports.removeAvatar = async (req, res, next) => {
  try {
    const oldPublicPath = await accountService.clearAvatar(req.session.user.id);
    const oldAbsolutePath = accountService.resolveOwnedAvatarPath(req.session.user.id, oldPublicPath);
    if (oldAbsolutePath) await imageProcessing.deleteProcessedImage(oldAbsolutePath);
    req.session.success_msg = 'Avatar eliminado correctamente.';
    return res.redirect('/cuenta/perfil');
  } catch (error) {
    return next(error);
  }
};

exports.showSecurity = async (req, res, next) => {
  try {
    const accountUser = await accountService.getUserProfile(req.session.user.id);
    if (!accountUser) return res.redirect('/auth/login');
    const fieldErrors = req.session.accountPasswordErrors || {};
    delete req.session.accountPasswordErrors;
    return res.render('pages/account/security', accountViewOptions(accountUser, 'security', {
      title: 'Seguridad',
      fieldErrors,
    }));
  } catch (error) {
    return next(error);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const validation = validatePasswordChange(req.body);
    if (!validation.valid) {
      req.session.accountPasswordErrors = validation.errors;
      req.session.error_msg = 'Revisa los campos indicados.';
      return res.redirect('/cuenta/seguridad');
    }

    const user = await accountService.getUserWithPassword(req.session.user.id);
    if (!user || !(await bcrypt.compare(validation.values.currentPassword, user.password))) {
      req.session.accountPasswordErrors = {
        currentPassword: 'La contraseña actual no es correcta.',
      };
      req.session.error_msg = 'No se pudo actualizar la contraseña.';
      return res.redirect('/cuenta/seguridad');
    }
    if (await bcrypt.compare(validation.values.newPassword, user.password)) {
      req.session.accountPasswordErrors = {
        newPassword: 'La nueva contraseña debe ser diferente.',
      };
      req.session.error_msg = 'No se pudo actualizar la contraseña.';
      return res.redirect('/cuenta/seguridad');
    }

    const passwordHash = await bcrypt.hash(validation.values.newPassword, 10);
    const updated = await accountService.updatePassword(user.id, passwordHash);
    if (!updated) throw new Error('No se pudo actualizar la contraseña.');

    const savedCart = captureCartForRegeneration(req);
    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    const roleId = Number(user.role_id);
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role_id: roleId,
      role: mapRole(roleId),
    };
    restoreCartAfterRegeneration(req, savedCart);
    req.session.success_msg = 'Contraseña actualizada correctamente.';
    await new Promise((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
    return res.redirect('/cuenta/seguridad');
  } catch (error) {
    return next(error);
  }
};

exports.accountViewOptions = accountViewOptions;
