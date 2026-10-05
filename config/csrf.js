// config/csrf.js — Shared CSRF setup for global and route-level use
const { csrfSync } = require('csrf-sync');

const {
  csrfSynchronisedProtection,
  generateToken,
} = csrfSync({
  getTokenFromRequest: (req) =>
    req.body?._csrf ||
    req.headers['x-csrf-token'] ||
    req.headers['csrf-token'],
});

module.exports = { csrfSynchronisedProtection, generateToken };
