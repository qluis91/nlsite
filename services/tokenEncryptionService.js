/**
 * Token Encryption Service — Phase 2E-B.
 * AES-256-GCM authenticated encryption for OAuth access tokens.
 *
 * Fail-closed: throws if encryption key is missing or invalid.
 * Never stores plaintext tokens.
 */
const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getEncryptionKey() {
  const raw = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw Object.assign(new Error('SOCIAL_TOKEN_ENCRYPTION_KEY no configurada.'), { code: 'NO_ENCRYPTION_KEY' });
  }
  const buf = Buffer.from(raw, 'utf-8');
  if (buf.length < KEY_LENGTH) {
    // Pad or hash to reach 32 bytes
    const hash = crypto.createHash('sha256').update(raw).digest();
    // Truncate to 32 bytes
    return hash.slice(0, KEY_LENGTH);
  }
  return buf.slice(0, KEY_LENGTH);
}

/**
 * Encrypt a plaintext token.
 * Returns { encrypted: Buffer, iv: Buffer, authTag: Buffer } for DB storage.
 */
function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted,
    iv,
    authTag,
  };
}

/**
 * Decrypt a token. Throws on tampering or wrong key.
 */
function decrypt(encryptedBuf, ivBuf, authTagBuf) {
  if (!Buffer.isBuffer(encryptedBuf)) throw new Error('Encrypted data must be a Buffer.');
  if (!Buffer.isBuffer(ivBuf)) throw new Error('IV must be a Buffer.');
  if (!Buffer.isBuffer(authTagBuf)) throw new Error('Auth tag must be a Buffer.');

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf);
  decipher.setAuthTag(authTagBuf);
  const decrypted = Buffer.concat([
    decipher.update(encryptedBuf),
    decipher.final(),
  ]);
  return decrypted.toString('utf-8');
}

/**
 * Utility: store token in DB.
 * Inserts or updates the encrypted token row.
 */
async function storeToken(pool, provider, accountId, plainTextToken, metadata = {}) {
  const { encrypted, iv, authTag } = encrypt(plainTextToken);
  const [[existing]] = await pool.query(
    'SELECT id FROM social_token_secrets WHERE provider = ? AND account_id = ?',
    [provider, accountId]
  );
  if (existing) {
    await pool.query(
      `UPDATE social_token_secrets SET
         encrypted_data = ?, iv = ?, auth_tag = ?, metadata_json = ?, updated_at = NOW()
       WHERE id = ?`,
      [encrypted, iv, authTag, JSON.stringify(metadata), existing.id]
    );
  } else {
    await pool.query(
      `INSERT INTO social_token_secrets (provider, account_id, encrypted_data, iv, auth_tag, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [provider, accountId, encrypted, iv, authTag, JSON.stringify(metadata)]
    );
  }
}

/**
 * Utility: retrieve and decrypt a token.
 * Returns null if no token stored.
 */
async function retrieveToken(pool, provider, accountId) {
  const [[row]] = await pool.query(
    'SELECT encrypted_data, iv, auth_tag FROM social_token_secrets WHERE provider = ? AND account_id = ?',
    [provider, accountId]
  );
  if (!row) return null;
  try {
    return {
      token: decrypt(row.encrypted_data, row.iv, row.auth_tag),
      metadata: row.metadata_json ? (typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json) : {},
    };
  } catch {
    return null; // tampered or wrong key
  }
}

/**
 * Delete a stored token.
 */
async function deleteToken(pool, provider, accountId) {
  await pool.query(
    'DELETE FROM social_token_secrets WHERE provider = ? AND account_id = ?',
    [provider, accountId]
  );
}

module.exports = {
  encrypt,
  decrypt,
  storeToken,
  retrieveToken,
  deleteToken,
  ALGORITHM,
  getEncryptionKey,
};
