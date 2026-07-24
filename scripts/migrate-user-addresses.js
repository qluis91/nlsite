require('dotenv').config();

const pool = require('../config/db');

const CREATE_USER_ADDRESSES_SQL = `CREATE TABLE IF NOT EXISTS user_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  label VARCHAR(60) NOT NULL,
  province VARCHAR(60) NOT NULL,
  canton VARCHAR(80) NOT NULL,
  district VARCHAR(80) NOT NULL,
  address_line VARCHAR(300) NOT NULL,
  address_reference VARCHAR(200) NULL,
  contact_phone VARCHAR(15) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_addresses_user (user_id),
  INDEX idx_user_addresses_user_default (user_id, is_default),
  CONSTRAINT fk_user_addresses_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function migrateUserAddresses() {
  await pool.query(CREATE_USER_ADDRESSES_SQL);
  console.log('User addresses migration complete.');
}

if (require.main === module) {
  migrateUserAddresses()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('User addresses migration failed:', error.message);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { CREATE_USER_ADDRESSES_SQL, migrateUserAddresses };
