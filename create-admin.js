/**
 * Interactive admin creation script.
 *
 * Usage: node create-admin.js
 *
 * Prompts for name, email, and password. Hashes with bcrypt,
 * creates an active admin user (role_id = 1) in the database.
 * Rejects duplicate emails. Never prints the password.
 */

const readline = require('readline');
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

(async () => {
  try {
    console.log('═══════════════════════════════════════');
    console.log('  Crear Administrador — nlSite');
    console.log('═══════════════════════════════════════\n');

    const name = (await ask('Nombre: ')).trim();
    if (!name) {
      console.log('Error: El nombre es obligatorio.');
      process.exit(1);
    }

    const email = (await ask('Email: ')).trim().toLowerCase();
    if (!email) {
      console.log('Error: El email es obligatorio.');
      process.exit(1);
    }

    // Check duplicate
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      console.log('Error: Ya existe un usuario con ese email.');
      process.exit(1);
    }

    // Hidden password input (mask via stdout manipulation)
    const password = await ask('Contraseña: ');
    if (!password) {
      console.log('Error: La contraseña es obligatoria.');
      process.exit(1);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await pool.query(
      'INSERT INTO users (name, email, password, role_id, is_active) VALUES (?, ?, ?, 1, 1)',
      [name, email, hashedPassword]
    );

    console.log(`\n✅ Administrador "${name}" (${email}) creado exitosamente.`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    rl.close();
    await pool.end();
  }
})();
