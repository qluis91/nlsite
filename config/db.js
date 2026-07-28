// config/db.js
const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nlsite_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Exportamos la versión con soporte para async/await
const db = pool.promise();

// Prueba rápida de conexión
// Test workers must not open a socket merely because a pure unit imported a service.
const isTestProcess = process.env.NODE_ENV === 'test'
  || typeof process.env.NODE_TEST_CONTEXT === 'string';
if (!isTestProcess) pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Error al conectar a la base de datos en XAMPP:', err.message);
  } else {
    console.log('✅ Conexión exitosa a MySQL (nlsite_db)');
    connection.release();
  }
});

module.exports = db;
