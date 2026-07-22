# nlSite — Project Status

**Last updated:** 2026-07-21  
**Current phase:** Critical Authentication and Authorization Correction

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v24.18.0 |
| Framework | Express 4.x |
| Templates | EJS (layouts + components) |
| Database | MySQL via mysql2/promise (XAMPP) |
| Auth | express-session + bcryptjs |
| Security | helmet, express-rate-limit |
| Config | dotenv (.env → config/site.js) |

## Working Features

- [x] Public pages: Home, Login, Register, Admin Login
- [x] Authentication: user login, admin login on `/admin/login`, register, logout
- [x] Inactive-user rejection: `is_active=0` users cannot log in (generic message)
- [x] Admin login with visual distinction (badge, border-color)
- [x] Admin login rate limiting: 5 attempts / 15 min window
- [x] Role-based redirects: admin login → `/admin`, user login → `/`
- [x] Session regeneration on login (fixation protection)
- [x] Email normalization (trim + lowercase) on all forms
- [x] Registration form preserves name and email on validation failure
- [x] Role-based access: admin/user with middleware guards
- [x] Admin panel: dashboard, user CRUD (create, edit, toggle active/inactive, delete)
- [x] Dashboard stats: total users, active users, administrators
- [x] Role mapping shared via `config/roles.js` (no duplication)
- [x] `create-admin.js` interactive script for safe admin creation
- [x] Brand-white-label: colors/text from `.env` injected as CSS variables
- [x] Responsive CSS (768px breakpoint)
- [x] Modular EJS: 2 layouts, 4 components, 9 pages
- [x] Parameterized SQL queries throughout
- [x] Helmet security headers (CSP, HSTS, etc.)
- [x] Login rate limiting: 5 attempts / 15 min window (both user and admin)
- [x] Session cookie: HttpOnly, SameSite=Lax, configurable maxAge
- [x] Centralized 404 and 500 error pages
- [x] Errors propagated via `next(error)` to 500 handler
- [x] EJS layout middleware (`config/viewEngine.js`) — zero extra dependencies
- [x] POST logout visible in both navbars after login
- [x] `test-auth.js` integration tests: 24 assertions (anonymous, unknown, user, admin)
- [x] Session shape: `{id, name, email, role_id, role}` consistent across all logins
- [x] Admin authorization uses numeric `role_id === 1` (not string comparison)
- [x] Login SQL: `WHERE email = ? AND is_active = 1 LIMIT 1`

## Directory Structure

```
nlSite/
├── .cursor/rules/nlsite.mdc
├── config/          db.js, site.js, roles.js, viewEngine.js
├── controllers/     authController.js, adminController.js
├── middlewares/     authMiddleware.js
├── routes/          authRoutes.js, adminRoutes.js
├── views/           components/, layouts/, pages/ (9 views: home, login, register, admin-login, 404, 500, admin/*)
├── public/          css/, js/, images/
├── docs/            PROJECT_STATUS.md, CHANGELOG.md, AI_WORKFLOW.md, AUTH_TESTING.md
├── graphify-out/    Knowledge graph outputs
├── app.js
├── schema.sql
├── create-admin.js
├── test-auth.js
├── .env.example
└── .gitignore
```

## Database

- Connection: pool via `config/db.js`
- Schema: `users` table (id, name, email, password, role_id, is_active, created_at, updated_at)
- `role_id`: 1 = admin, 2 = user — mapped via `config/roles.js`
- `is_active`: TINYINT(1), default 1 — controls login access
- No hardcoded credentials in source code. Use `node create-admin.js` to add administrators.

## AI Tools Configured

| Tool | Purpose | Status |
|------|---------|--------|
| Graphify | Knowledge graph + query | Installed, 162 nodes / 178 edges |
| Caveman | Token-efficient communication | Skill loaded |
| CodeBurn | Token usage tracking (estimates) | Global install, CLI active |

## Known Limitations

- 15 `.ejs` templates not parsed by Graphify AST (no tree-sitter-ejs)
- `schema.sql` now matches actual DB schema (`role_id` INT, `is_active` present, no `role` ENUM, no `avatar`)
- No protection against deactivating the last administrator
- No CSRF protection
- No email verification on registration
- No password reset flow
- Sessions stored in memory (lost on server restart)
- No persistent rate-limit store (reset on restart)
- Helmet CSP allows `'unsafe-inline'` for EJS inline styles
- Admin login doesn't share rate limit counter with user login (separate buckets)

## Next Recommended Phase

CSRF protection, persistent session storage, password recovery flow, or deployment configuration.

## Completed Phases

| Phase | Description | Date |
|-------|-------------|------|
| Initial | Boilerplate creation (22 files) | 2026-07-21 |
| AI Config | Graphify + Caveman + CodeBurn + rules + docs | 2026-07-21 |
| Security | Helmet, rate limiting, session hardening, 404/500, auth fixes | 2026-07-21 |
| Auth UI | Authentication Interface and Manual Verification | 2026-07-21 |
| DB Fix | Database Schema Consistency and Security Correction | 2026-07-21 |
| Logout | Logout Flow Correction | 2026-07-21 |
| Auth Fix | Critical Authentication and Authorization Correction | 2026-07-21 |
