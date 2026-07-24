const pool = require('../config/db');

const MAX_ADDRESSES_PER_USER = 20;

class AddressServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AddressServiceError';
    this.code = code;
  }
}

function mapAddress(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    label: row.label,
    province: row.province,
    canton: row.canton,
    district: row.district,
    addressLine: row.address_line,
    addressReference: row.address_reference || '',
    contactPhone: row.contact_phone || '',
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listForUser(userId) {
  const [rows] = await pool.query(
    `SELECT id, user_id, label, province, canton, district, address_line,
            address_reference, contact_phone, is_default, created_at, updated_at
       FROM user_addresses
      WHERE user_id = ?
      ORDER BY is_default DESC, created_at ASC, id ASC`,
    [userId]
  );
  return rows.map(mapAddress);
}

async function getForUser(addressId, userId) {
  const [rows] = await pool.query(
    `SELECT id, user_id, label, province, canton, district, address_line,
            address_reference, contact_phone, is_default, created_at, updated_at
       FROM user_addresses
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [addressId, userId]
  );
  return mapAddress(rows[0]);
}

async function lockUser(conn, userId) {
  const [users] = await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
  if (!users[0]) throw new AddressServiceError('USER_NOT_FOUND', 'La cuenta ya no está disponible.');
}

async function createForUser(userId, data) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await lockUser(conn, userId);
    const [existing] = await conn.query(
      'SELECT id, is_default FROM user_addresses WHERE user_id = ? ORDER BY created_at ASC, id ASC FOR UPDATE',
      [userId]
    );
    if (existing.length >= MAX_ADDRESSES_PER_USER) {
      throw new AddressServiceError('ADDRESS_LIMIT', `Puedes guardar hasta ${MAX_ADDRESSES_PER_USER} direcciones.`);
    }
    const shouldDefault = existing.length === 0 || data.isDefault;
    if (shouldDefault && existing.length) {
      await conn.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    }
    const [result] = await conn.query(
      `INSERT INTO user_addresses
        (user_id, label, province, canton, district, address_line, address_reference, contact_phone, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, data.label, data.province, data.canton, data.district,
        data.addressLine, data.addressReference, data.contactPhone, shouldDefault ? 1 : 0,
      ]
    );
    await conn.commit();
    return getForUser(result.insertId, userId);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function updateForUser(addressId, userId, data) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await lockUser(conn, userId);
    const [rows] = await conn.query(
      'SELECT id, is_default FROM user_addresses WHERE id = ? AND user_id = ? FOR UPDATE',
      [addressId, userId]
    );
    if (!rows[0]) {
      await conn.rollback();
      return null;
    }
    if (data.isDefault && !rows[0].is_default) {
      await conn.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    }
    await conn.query(
      `UPDATE user_addresses
          SET label = ?, province = ?, canton = ?, district = ?, address_line = ?,
              address_reference = ?, contact_phone = ?,
              is_default = CASE WHEN ? = 1 THEN 1 ELSE is_default END
        WHERE id = ? AND user_id = ?`,
      [
        data.label, data.province, data.canton, data.district, data.addressLine,
        data.addressReference, data.contactPhone, data.isDefault ? 1 : 0, addressId, userId,
      ]
    );
    await conn.commit();
    return getForUser(addressId, userId);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function setDefaultForUser(addressId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await lockUser(conn, userId);
    const [rows] = await conn.query(
      'SELECT id FROM user_addresses WHERE id = ? AND user_id = ? FOR UPDATE',
      [addressId, userId]
    );
    if (!rows[0]) {
      await conn.rollback();
      return false;
    }
    await conn.query('UPDATE user_addresses SET is_default = (id = ?) WHERE user_id = ?', [addressId, userId]);
    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function deleteForUser(addressId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await lockUser(conn, userId);
    const [rows] = await conn.query(
      'SELECT id, is_default FROM user_addresses WHERE id = ? AND user_id = ? FOR UPDATE',
      [addressId, userId]
    );
    if (!rows[0]) {
      await conn.rollback();
      return false;
    }
    await conn.query('DELETE FROM user_addresses WHERE id = ? AND user_id = ?', [addressId, userId]);
    if (rows[0].is_default) {
      const [remaining] = await conn.query(
        'SELECT id FROM user_addresses WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE',
        [userId]
      );
      if (remaining[0]) {
        await conn.query('UPDATE user_addresses SET is_default = 1 WHERE id = ? AND user_id = ?', [
          remaining[0].id, userId,
        ]);
      }
    }
    await conn.commit();
    return true;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  MAX_ADDRESSES_PER_USER,
  AddressServiceError,
  listForUser,
  getForUser,
  createForUser,
  updateForUser,
  setDefaultForUser,
  deleteForUser,
};
