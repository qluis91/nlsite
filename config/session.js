/**
 * Session configuration — persistent MySQL store via express-mysql-session.
 *
 * Reuses existing DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME credentials.
 * Never logs credentials or session data.
 */
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { resolveValidatedDatabaseConfig } = require('./databaseConfig');

function parseSessionMaxAge() {
  const hours = parseInt(process.env.SESSION_MAX_AGE_HOURS, 10);
  return (hours > 0 ? hours : 8) * 60 * 60 * 1000;
}

const sessionMaxAge = parseSessionMaxAge();

const storeOptions = {
  ...resolveValidatedDatabaseConfig({
    requireMutationOptIn: process.env.NODE_ENV === 'test'
      || typeof process.env.NODE_TEST_CONTEXT === 'string',
  }),
  createDatabaseTable: true,
  expiration: sessionMaxAge,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000, // 15 minutes
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data',
    },
  },
};

const sessionStore = new MySQLStore(storeOptions);

function createSessionMiddleware() {
  return session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'clave-secreta-temporal',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: sessionMaxAge,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  });
}

module.exports = { createSessionMiddleware, sessionStore, sessionMaxAge };
