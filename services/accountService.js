const path = require('path');
const pool = require('../config/db');
const imageProcessing = require('./imageProcessingService');

async function getUserProfile(userId) {
  const [rows] = await pool.query(
    `SELECT id, name, last_name, email, phone, avatar_path, password_changed_at, role_id
       FROM users
      WHERE id = ? AND is_active = 1
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getUserWithPassword(userId) {
  const [rows] = await pool.query(
    `SELECT id, name, email, password, role_id
       FROM users
      WHERE id = ? AND is_active = 1
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function updateProfile(userId, data) {
  await pool.query(
    'UPDATE users SET name = ?, last_name = ?, phone = ? WHERE id = ? AND is_active = 1',
    [data.name, data.lastName || null, data.phone || null, userId]
  );
  return getUserProfile(userId);
}

async function replaceAvatar(userId, newPublicPath) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT avatar_path FROM users WHERE id = ? AND is_active = 1 FOR UPDATE',
      [userId]
    );
    if (!rows[0]) throw new Error('La cuenta ya no está disponible.');
    const previousPath = rows[0].avatar_path || null;
    await conn.query('UPDATE users SET avatar_path = ? WHERE id = ?', [newPublicPath, userId]);
    await conn.commit();
    return previousPath;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function clearAvatar(userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT avatar_path FROM users WHERE id = ? AND is_active = 1 FOR UPDATE',
      [userId]
    );
    if (!rows[0]) throw new Error('La cuenta ya no está disponible.');
    const previousPath = rows[0].avatar_path || null;
    await conn.query('UPDATE users SET avatar_path = NULL WHERE id = ?', [userId]);
    await conn.commit();
    return previousPath;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function resolveOwnedAvatarPath(userId, publicPath) {
  const { dir, urlPrefix } = imageProcessing.avatarStoragePath(userId);
  const value = String(publicPath || '');
  if (!value.startsWith(urlPrefix)) return null;
  const fileName = value.slice(urlPrefix.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i.test(fileName)) {
    return null;
  }
  const resolved = path.resolve(dir, fileName);
  const root = `${path.resolve(dir)}${path.sep}`;
  return resolved.startsWith(root) ? resolved : null;
}

async function updatePassword(userId, passwordHash) {
  const [result] = await pool.query(
    'UPDATE users SET password = ?, password_changed_at = NOW() WHERE id = ? AND is_active = 1',
    [passwordHash, userId]
  );
  return result.affectedRows === 1;
}

function getInitials(user) {
  // Try name + last_name fields first.
  const first = String(user?.name || '').trim();
  const last = String(user?.last_name || '').trim();
  if (first && last) return (first.charAt(0) + last.charAt(0)).toUpperCase();
  // Single-name field: split on whitespace and take first+last word initials.
  if (first) {
    const words = first.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
    return first.charAt(0).toUpperCase();
  }
  return 'NL';
}

module.exports = {
  getUserProfile,
  getUserWithPassword,
  updateProfile,
  replaceAvatar,
  clearAvatar,
  resolveOwnedAvatarPath,
  updatePassword,
  getInitials,
};
