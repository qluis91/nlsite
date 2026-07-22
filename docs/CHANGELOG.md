# Changelog

## 2026-07-21 — Email Verification and Password Recovery

### Added
- **Nodemailer** (`config/mailer.js`): Single-responsibility SMTP transporter. Loads config from env vars, exports `sendVerificationEmail`, `sendPasswordResetEmail`, `sendMail`, `verifyConnection`. Never logs credentials.
- **`pending_registrations` table**: Stores unverified registration data with SHA-256 hashed tokens, expiration, unique email constraint. Row deleted after verification.
- **`password_reset_tokens` table**: Stores single-use reset tokens with SHA-256 hashes, expiration, `used_at` tracking, foreign key to `users`.
- **Email verification flow**:
  - `POST /auth/register` → validates, stores pending registration, sends verification email, redirects to verify-pending.
  - `GET /auth/verify-email?token=` → hashes token, creates `users` row, deletes pending registration, redirects to login.
  - `GET /auth/verify-pending` → masked email, expiration, resend link.
  - `GET /auth/resend-verification` → email form.
  - `POST /auth/resend-verification` → regenerates token, sends new email. Generic response always.
- **Password recovery flow**:
  - `GET /auth/forgot-password` → email form.
  - `POST /auth/forgot-password` → generates token, sends email for active users. Always generic response.
  - `GET /auth/reset-password?token=` → validates token, shows new-password form with hidden token.
  - `POST /auth/reset-password` → updates password, marks tokens used. Automatic login disabled.
- **Rate limiters**: `resendLimiter` (3/15min), `forgotLimiter` (3/15min), separate from login limiter.
- **New views**: `verify-pending.ejs`, `resend-verification.ejs`, `forgot-password.ejs`, `reset-password.ejs`.
- **Login page**: Added "¿Olvidaste tu contraseña?" link.
- **SMTP verification**: `transporter.verify()` available during development.

### Changed
- **`register` controller**: No longer creates `users` row directly. Stores pending registration, sends email, redirects to verify-pending.
- **`test-auth.js`**: Extended with verification token rejection, reset token rejection, forgot-password generic response, verify-pending/resend routes.
- **`.env.example`**: Added `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`, `APP_URL`, `EMAIL_VERIFICATION_EXPIRES_MINUTES`, `PASSWORD_RESET_EXPIRES_MINUTES`.
- **`schema.sql`**: Added `pending_registrations` and `password_reset_tokens` table definitions.

### Security
- Raw tokens generated via `crypto.randomBytes(32).toString('hex')`, stored as SHA-256 hash.
- Tokens are single-use, expire, and previous active tokens are invalidated on new request.
- No user IDs, roles, passwords, or hashes in URLs.
- Forgot-password always returns same generic message regardless of email status.
- Resend-verification also returns generic message.
- Expired tokens cleaned before every check (`DELETE WHERE expires_at < NOW()`).
- Registration/verification/forgot-password use MySQL transactions.

### Validation
- `test-auth.js`: 20/20 non-credential assertions pass, 4 credential-dependent (expected), 2 skipped.
- Server starts without errors. SMTP warning shown when env vars missing (not a crash).
- `npm audit --omit=dev` → 0 vulnerabilities.

### Limitations
- No email delivery confirmed without SMTP credentials in `.env`.
- Token cleanup is inline (per-request), no cron/scheduler.
- Email templates inline in `config/mailer.js`.

## 2026-07-21 — Critical Authentication and Authorization Correction

### Root Causes
- **Layouts never rendered**: Express EJS has no built-in layout support. The `layout: 'layouts/main'` option passed to every `res.render()` call was silently ignored. Every page rendered raw HTML fragments without `<!DOCTYPE html>`, `<head>`, CSS link, navbar, or footer.
- **Session shape inconsistent**: Normal login stored `{id, name, email, role}` without `role_id`. Admin login stored `{id, name, email, role: 'admin'}` also without `role_id`. Middleware used string `role === 'admin'` comparison instead of numeric `role_id`.
- **Login query missing LIMIT/active check in SQL**: `is_active` checked in JS after DB fetch, not in `WHERE` clause.

### Fixed
- **Layout middleware** (`config/viewEngine.js`): Lightweight `res.render()` interceptor that detects the `layout` option, renders the view first, then wraps output in the layout template as `body`. Zero extra dependencies.
- **Session shape unified**: Both login paths now store `{id, name, email, role_id: Number, role: String}`. All middleware uses `Number(req.session.user.role_id) === 1` for admin checks.
- **Login queries hardened**: `WHERE email = ? AND is_active = 1 LIMIT 1`. Checks `rows.length !== 1` (not `=== 0`) to catch edge cases. Admin login additionally requires `AND role_id = 1` in SQL.
- **Admin route protection doubled**: Middleware applied at both `app.use('/admin', isAuthenticated, isAdmin, adminRoutes)` mount level and within `adminRoutes.js`.
- **Navbar visibility**: Layouts now properly include navbar components. CSS `.logout-form` uses `display: inline-flex` with styled buttons.
- **`isAuthenticated`**: Now requires `req.session.user.id` (not just truthy `req.session.user`).
- **`test-auth.js`**: Integration test script with 24 assertions covering anonymous, unknown user, normal user, and admin flows.

### Validation
- `test-auth.js`: 24/24 passed
- Layout renders: `<!DOCTYPE html>`, `<nav>`, footer all present
- Normal user navbar: no admin link; logout form visible (`/auth/logout`)
- Admin dashboard: logout form in navbar; dashboard content renders
- Unknown user login: rejected with generic message, no session created
- `npm audit --omit=dev` → 0 vulnerabilities
- Graphify: 176 nodes, 195 edges

## 2026-07-21 — Logout Flow Correction

### Fixed
- Logout route: `GET /auth/logout` → `POST /auth/logout`
- `authController.logout`: Added `res.clearCookie('connect.sid')` to clear session cookie after destroy
- `navbar.ejs` and `navbar-admin.ejs`: Changed `<a>` links to inline `<form>` POST elements
- Styles: `.logout-form` uses `display: inline-flex` so the form sits alongside other navbar links

### Validation
- `test-auth.js` updated with logout assertions: cookie cleared, redirect correct, subsequent admin access denied
- Post-logout home page renders without "Cerrar Sesión" link
- Admin logout: redirects to `/auth/login`, admin pages redirect to login after

## 2026-07-21 — Database Schema Consistency and Security Correction

### Fixed
- `users.is_active`: Added column to live DB where it was missing. `authController.login` now queries `is_active = 1`.
- `adminController.toggleUserStatus`: Restored. Admin can toggle user active/inactive.
- `adminController.deleteUser`: Added confirmation note: "DANGER: This deletes the user permanently."
- Dashboard stat: "Usuarios Activos" restored.
- Users list "Estado" column: Restored with toggle button.
- User form "Usuario activo" checkbox: Restored.
- Default admin credential: Removed from `schema.sql`. Replaced with comment: `-- node create-admin.js`
- `create-admin.js`: Interactive CLI script for secure admin creation.

### Security
- No hardcoded credentials in any tracked file.
- `buildQuery` internal function preserved exactly (minor cleanup reverted).

## 2026-07-21 — Authentication Interface and Manual Verification

### Added
- `views/pages/admin-login.ejs`: Dedicated admin login form with visual badge, border distinction
- `test-auth.js`: 24 assertions across anonymous, unknown user, normal user, admin
- Admin login CSS: `.admin-badge`, `.admin-login-card` with colored border
- Manual testing documentation: `docs/AUTH_TESTING.md`

### Fixed
- Admin login route registered before admin middleware
- Session regeneration persistence (`req.session.save()`)
- Role-based redirects: admin → `/admin/`, user → `/`
- Registration form: preserves name/email, clears passwords
- `autocomplete` attributes on all form fields

## 2026-07-21 — Security and Error Handling

### Added
- `helmet` HTTP headers (CSP, HSTS, etc.)
- `express-rate-limit` for login (5 attempts / 15 min)
- Session regeneration on login (fixation protection)
- Centralized 404 (`views/pages/404.ejs`) and 500 (`views/pages/500.ejs`) error pages
- Email normalization (trim + lowercase)
- Password masking in logs (not logged at all)
- `SESSION_MAX_AGE_HOURS` configurable via `.env`

### Changed
- Session cookie: `httpOnly`, `sameSite: 'lax'`, `secure` in production
- Session `maxAge` from `SESSION_MAX_AGE_HOURS`
- Enhanced `SECRET` placeholder in `.env.example`

## 2026-07-21 — Initial Project Setup

- Express + EJS + MySQL boilerplate
- Modular architecture: config/ controllers/ middlewares/ routes/ views/
- User authentication (login, register, session)
- Admin panel (dashboard, user management)
- Brand white-label via `.env` CSS variables
