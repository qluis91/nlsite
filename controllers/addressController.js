const accountService = require('../services/accountService');
const addressService = require('../services/addressService');
const { accountViewOptions } = require('./accountController');
const { validateAddress, parsePositiveId } = require('../validators/addressValidator');
const { CR_PROVINCES } = require('../config/checkoutOptions');

function emptyForm() {
  return {
    label: '',
    province: '',
    canton: '',
    district: '',
    addressLine: '',
    addressReference: '',
    contactPhone: '',
    isDefault: false,
  };
}

function addressToForm(address) {
  return {
    label: address.label,
    province: address.province,
    canton: address.canton,
    district: address.district,
    addressLine: address.addressLine,
    addressReference: address.addressReference,
    contactPhone: address.contactPhone,
    isDefault: address.isDefault,
  };
}

async function renderForm(req, res, {
  title, heading, action, address = null, form = emptyForm(), fieldErrors = {}, status = 200,
}) {
  const accountUser = await accountService.getUserProfile(req.session.user.id);
  if (!accountUser) return res.redirect('/auth/login');
  return res.status(status).render('pages/account/address-form', accountViewOptions(accountUser, 'addresses', {
    title,
    heading,
    action,
    address,
    form,
    fieldErrors,
    provinces: CR_PROVINCES,
  }));
}

function notFound(res) {
  return res.status(404).render('pages/404', { title: 'Dirección no encontrada', layout: 'layouts/main' });
}

exports.list = async (req, res, next) => {
  try {
    const [accountUser, addresses] = await Promise.all([
      accountService.getUserProfile(req.session.user.id),
      addressService.listForUser(req.session.user.id),
    ]);
    if (!accountUser) return res.redirect('/auth/login');
    return res.render('pages/account/addresses', accountViewOptions(accountUser, 'addresses', {
      title: 'Direcciones',
      addresses,
      maxAddresses: addressService.MAX_ADDRESSES_PER_USER,
    }));
  } catch (error) {
    return next(error);
  }
};

exports.showCreate = async (req, res, next) => {
  try {
    return await renderForm(req, res, {
      title: 'Nueva dirección',
      heading: 'Nueva dirección',
      action: '/cuenta/direcciones/nueva',
    });
  } catch (error) {
    return next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const validation = validateAddress(req.body);
    if (!validation.valid) {
      return await renderForm(req, res, {
        title: 'Nueva dirección',
        heading: 'Nueva dirección',
        action: '/cuenta/direcciones/nueva',
        form: validation.displayValues,
        fieldErrors: validation.errors,
        status: 422,
      });
    }
    await addressService.createForUser(req.session.user.id, validation.values);
    req.session.success_msg = 'Dirección guardada correctamente.';
    return res.redirect('/cuenta/direcciones');
  } catch (error) {
    if (error.code === 'ADDRESS_LIMIT') {
      return renderForm(req, res, {
        title: 'Nueva dirección',
        heading: 'Nueva dirección',
        action: '/cuenta/direcciones/nueva',
        form: validateAddress(req.body).displayValues,
        fieldErrors: { form: error.message },
        status: 422,
      });
    }
    return next(error);
  }
};

exports.showEdit = async (req, res, next) => {
  try {
    const addressId = parsePositiveId(req.params.id);
    if (!addressId) return notFound(res);
    const address = await addressService.getForUser(addressId, req.session.user.id);
    if (!address) return notFound(res);
    return await renderForm(req, res, {
      title: 'Editar dirección',
      heading: 'Editar dirección',
      action: `/cuenta/direcciones/${address.id}/editar`,
      address,
      form: addressToForm(address),
    });
  } catch (error) {
    return next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    const addressId = parsePositiveId(req.params.id);
    if (!addressId) return notFound(res);
    const existing = await addressService.getForUser(addressId, req.session.user.id);
    if (!existing) return notFound(res);
    const validation = validateAddress(req.body);
    if (!validation.valid) {
      return await renderForm(req, res, {
        title: 'Editar dirección',
        heading: 'Editar dirección',
        action: `/cuenta/direcciones/${addressId}/editar`,
        address: existing,
        form: validation.displayValues,
        fieldErrors: validation.errors,
        status: 422,
      });
    }
    const updated = await addressService.updateForUser(
      addressId, req.session.user.id, validation.values
    );
    if (!updated) return notFound(res);
    req.session.success_msg = 'Dirección actualizada correctamente.';
    return res.redirect('/cuenta/direcciones');
  } catch (error) {
    return next(error);
  }
};

exports.setDefault = async (req, res, next) => {
  try {
    const addressId = parsePositiveId(req.params.id);
    if (!addressId) return notFound(res);
    const updated = await addressService.setDefaultForUser(addressId, req.session.user.id);
    if (!updated) return notFound(res);
    req.session.success_msg = 'Dirección predeterminada actualizada.';
    return res.redirect('/cuenta/direcciones');
  } catch (error) {
    return next(error);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const addressId = parsePositiveId(req.params.id);
    if (!addressId) return notFound(res);
    const removed = await addressService.deleteForUser(addressId, req.session.user.id);
    if (!removed) return notFound(res);
    req.session.success_msg = 'Dirección eliminada correctamente.';
    return res.redirect('/cuenta/direcciones');
  } catch (error) {
    return next(error);
  }
};
