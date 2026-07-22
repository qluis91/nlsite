# Changelog

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
- **Logout route**: changed `GET /auth/logout` → `POST /auth/logout` (state-changing action)
- **Logout controller**: added `res.clearCookie('connect.sid')` with matching cookie options (httpOnly, sameSite, secure), propagated errors via `next(err)`
- **navbar.ejs**: replaced `<a href>` anchor with `<form action="/auth/logout" method="POST">` with submit button
- **navbar-admin.ejs**: same anchor → form replacement for admin navbar
- **CSS**: added `.logout-form` (margin:0, display:inline) to prevent layout disruption

### Validation
- POST `/auth/logout` → 302 redirect to `/auth/login`, session cookie cleared
- GET `/auth/logout` → 404 (POST only)
- Admin login → dashboard → logout → `/admin` redirects to `/auth/login`
- User login → logout → home shows "Iniciar Sesión" (logged-out state)
- 10 rapid logout POSTs do not trigger login rate limiter
- `git diff --check` clean
- `npm audit --omit=dev` → 0 vulnerabilities

## 2026-07-21 — Database Schema Consistency and Security Correction

### Regression Fixes
- **Restored `is_active` column**: Added to local MySQL database via `ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1`
- **Restored active-user validation**: `authController.login` and `adminLogin` now reject inactive users (`WHERE is_active = 1`) with generic messages
- **Restored toggle route**: `POST /admin/users/:id/toggle` in `adminRoutes.js` + `adminController.toggleUserStatus`
- **Restored dashboard stat**: "Usuarios Activos" counter in admin dashboard
- **Restored Estado column**: Active/inactive badge and toggle button in `admin/users.ejs`
- **Restored active checkbox**: `is_active` field in `admin/user-form.ejs` for create/edit

### Schema Corrections
- **`schema.sql` synced with actual DB**: uses `role_id INT DEFAULT 2` instead of `role ENUM('admin','user')`, includes `is_active`, no `avatar`
- **Removed hardcoded default admin INSERT** from `schema.sql`
- **DB migration applied**: `ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1` on local development database

### Security Corrections
- **Removed insecure test admin**: `admin@misitio.com` deleted from local database
- **Created `create-admin.js`**: interactive script using Node.js `readline` to safely create administrators — prompts for name/email/password, hashes with bcrypt, never prints credentials, no hardcoded values
- **No default passwords** remain in source code, documentation, `.env.example`, or SQL seeds

### Role Mapping Simplified
- **Created `config/roles.js`**: shared `mapRole()` / `mapRoleId()` exports, removing duplication between `authController.js` and `adminController.js`
- Both controllers now `require('../config/roles')`

### Validation
- Active user login: passes
- Inactive user login: rejected (generic message), 302 redirect to login
- Admin login: passes, redirects to `/admin`
- Admin dashboard: shows "Usuarios Activos" stat
- Admin user list: shows "Estado" column with active/inactive badges
- Admin toggle: deactivates and reactivates users correctly
- All public routes return 200, 404 returns 404, `/admin` rejects unauthenticated
- Helmet CSP headers present
- No passwords or credentials in rendered HTML
- `npm audit --omit=dev` → 0 vulnerabilities
- `create-admin.js` syntax-valid
- Graphify: 162 nodes, 178 edges

## 2026-07-21 — Authentication Interface and Manual Verification

### Added
- **Admin login page** (`GET/POST /admin/login`): dedicated form with visual distinction (badge + border), rate-limited, generic error messages
- **Admin login controller**: `showAdminLogin`, `adminLogin` in `authController.js` — reuses same users table, bcrypt hashes, session mechanism
- **`isAdminGuest` middleware**: redirects admin to `/admin`, normal user to `/auth/login` with message
- **Admin login rate limiter**: 5 attempts / 15 min window, separate from user login limiter
- **Admin login link** on normal login page: "¿Eres administrador? Accede al panel administrativo" → `/admin/login`
- **Registration form preservation**: name and email preserved on validation failure via `req.session.registerForm`
- **`docs/AUTH_TESTING.md`**: 35-step manual browser verification checklist covering registration, user login, admin login, route protection, error pages, and security

### Changed
- **`authController.js`**: `showRegister` now passes `form` data to view for field preservation; `register` saves safe values to session on error; duplicate-email message updated to "Ya existe una cuenta registrada con ese correo electrónico."
- **`login.ejs`**: added admin login link, `autocomplete="email"` and `autocomplete="current-password"` attributes, `novalidate`
- **`register.ejs`**: preserves name/email values, added `autocomplete` attributes, `novalidate`
- **`navbar.ejs`**: `Panel Admin` link excludes `/admin/login` from active state
- **`app.js`**: admin login routes registered before `adminRoutes` middleware to bypass global auth guard; imported `rateLimit` and `authController`
- **`authMiddleware.js`**: exported `isAdminGuest`
- **`style.css`**: added `.auth-footer.admin-link-footer`, `.auth-card-admin`, `.admin-login-badge` for admin login visual distinction

### Fixed
- Normal user login error message made consistent: "Correo electrónico o contraseña incorrectos." (was "Credenciales inválidas.")

### Validation
- `node app.js` starts without errors, MySQL connects
- `GET /` → 200, `GET /auth/login` → 200, `GET /auth/register` → 200, `GET /admin/login` → 200
- Admin login POST with valid credentials → redirects to `/admin`, dashboard renders
- Normal user credentials rejected at admin login → generic "Credenciales administrativas inválidas."
- Already-authenticated admin visiting `/admin/login` → redirects to `/admin`
- `/admin` and `/admin/users` reject unauthenticated requests → redirect to `/auth/login`
- Unknown route → 404
- No secrets or credentials exposed in rendered HTML

## 2026-07-21 — Security and Error Handling

### Added
- **helmet** (v8.x): CSP, HSTS, X-Content-Type-Options, X-Frame-Options, and other security headers
- **express-rate-limit**: login POST rate limiting (5 attempts / 15 min window)
- Session regeneration on successful login (session fixation protection)
- `SESSION_MAX_AGE_HOURS` environment variable (default 8h, validated)
- Session cookie `sameSite: 'lax'`
- Centralized 404 page (`views/pages/404.ejs`)
- Centralized 500 error handler with `next(error)` propagation
- Centralized 500 page (`views/pages/500.ejs`)
- Email normalization: `trim().toLowerCase()` on login and register

### Changed
- **`app.js`**: helmet middleware, session cookie sameSite/maxAge, 404 renders dedicated view, 500 error-handling middleware
- **`authRoutes.js`**: login POST rate limiter applied
- **`authController.js`**: session regeneration, email normalization, `next(error)` error propagation, `role_id` mapping
- **`adminController.js`**: all `catch` blocks use `next(error)`, removed `is_active`/`toggleUserStatus`, `role_id` mapping
- **`adminRoutes.js`**: removed `/toggle` route (no `is_active` column)
- **`views/pages/admin/dashboard.ejs`**: removed `activeUsers` stat
- **`views/pages/admin/users.ejs`**: removed `Estado` column and toggle button
- **`views/pages/admin/user-form.ejs`**: removed `is_active` checkbox
- **`.env.example`**: added `SESSION_MAX_AGE_HOURS=8`, changed `SESSION_SECRET` to placeholder
- **`package.json`**: added `helmet` and `express-rate-limit` dependencies

### Fixed
- DB schema mismatch: queries adapted to actual columns (`role_id` int, no `is_active`, no `avatar`)
- Controllers now use `next(error)` instead of silent redirects on unexpected errors
- Inactive-user check removed (column doesn't exist in actual DB)
- `req.session.save()` added after `regenerate` to persist authenticated session data

### Validation
- `node app.js`: starts OK, MySQL connects
- Login POST with valid credentials: 302 → `/` (success)
- Home page: 200 OK
- Login page: 200 OK
- Unknown URL: 404 with proper page
- Helmet CSP headers present in response
- `npm audit --omit=dev`: 0 vulnerabilities
- `graphify update .`: 128 nodes, 137 edges, 10 communities
- No `.env` in git tracking
- No dependencies added beyond helmet + express-rate-limit (6→8 deps)

## 2026-07-21 — AI Workflow Configuration

### Added
- Graphify knowledge graph (82 nodes, 89 edges, 8 communities) via `uv tool install graphifyy`
- Graphify outputs: `graph.html`, `graph.json`, `GRAPH_REPORT.md` in `graphify-out/`
- CodeBurn token usage tracker (global npm, v0.9.16)
- `.cursor/rules/nlsite.mdc` — project rules for AI agents
- `docs/PROJECT_STATUS.md`, `docs/CHANGELOG.md`, `docs/AI_WORKFLOW.md`
- `.gitignore` with standard Node.js + AI tool exclusions
- `.env.example` with safe placeholder values
- Git repository initialized (`git init`)

### Changed
- None (no application code modified)

### Fixed
- None

### Validation
- `npm run dev` — server starts on port 3000
- `graphify query "authentication"` — returns 7 nodes from knowledge graph
- `graphify update .` — incremental rebuild confirmed working (113 nodes, 117 edges)
- CodeBurn: `codeburn status` reports estimated usage
- Caveman: skill available in Cursor via `~/.claude/plugins/cache/caveman/`
- Git: clean status, `.env` correctly ignored

## 2026-07-21 — AI Workflow Audit

### Changed
- **`.gitignore`**: expanded to ignore `graph.html`, `graph.json`, `cost.json`, `manifest.json`, `.graphify_root`, `backup/`
- **`docs/AI_WORKFLOW.md`**: fixed invalid `graphify .` commands → `graphify update .`; clarified CodeBurn as estimates; clarified Caveman location/persistence; updated Graphify output commit policy
- **`docs/PROJECT_STATUS.md`**: clarified `graphify` is directly on PATH
- **`docs/CHANGELOG.md`**: added this audit entry

### Fixed
- `graphify .` / `graphify . --update` were invalid CLI commands → replaced with `graphify update .`
- Large regenerated Graphify artifacts (`graph.html` 62KB, `graph.json` 50KB) now ignored instead of committed
- Machine-specific files (`.graphify_root`, `cost.json`, `manifest.json`) untracked from Git
- CodeBurn values now documented as estimates, not actual billing
- Caveman now documented with skill location, persistence behavior, and compression boundaries
- All bash code blocks replaced with PowerShell in docs

### Validation
- `graphify` available directly on PATH: OK
- `graphify query "authentication"`: OK
- `graphify update .`: OK (113 nodes, 117 edges, 10 communities)
- `codeburn --version`: 0.9.16
- `node app.js`: starts OK, MySQL connects
