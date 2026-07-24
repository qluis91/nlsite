require('dotenv').config();

const pool = require('../config/db');

const PROFILE_COLUMNS = Object.freeze({
  last_name: 'VARCHAR(100) NULL AFTER name',
  phone: 'VARCHAR(30) NULL AFTER email',
  avatar_path: 'VARCHAR(500) NULL AFTER phone',
  password_changed_at: 'DATETIME NULL AFTER password',
});

async function migrateUserProfile() {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));

  for (const [column, definition] of Object.entries(PROFILE_COLUMNS)) {
    if (existing.has(column)) continue;
    await pool.query(`ALTER TABLE users ADD COLUMN \`${column}\` ${definition}`);
    console.log(`Added users.${column}`);
  }

  console.log('User profile migration complete.');
}

if (require.main === module) {
  migrateUserProfile()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('User profile migration failed:', error.message);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { PROFILE_COLUMNS, migrateUserProfile };
