/**
 * Shared role mapping for numeric role_id (INT) schema.
 *
 * Uses role_id INT: 1 = admin, 2 = user.
 * No separate roles table exists.
 */

const mapRole = (roleId) => (roleId === 1 ? 'admin' : 'user');
const mapRoleId = (role) => (role === 'admin' ? 1 : 2);

module.exports = { mapRole, mapRoleId };
