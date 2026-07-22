# nlSite — Project Status

**Last updated:** 2026-07-21  
**Current phase:** Critical Panel 1 Runtime Correction — CSP, Three.js, External GLB, Logo, and Navigation

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v24.18.0 |
| Framework | Express 4.x |
| Templates | EJS (layouts + components) |
| Database | MySQL via mysql2/promise (XAMPP) |
| Auth | express-session + bcryptjs |
| Security | helmet, express-rate-limit, csrf-sync |
| Session | express-session + express-mysql-session (MySQL) |
| Email | nodemailer (SMTP) |
| Config | dotenv (.env → config/site.js) |

## Working Features

- [x] Public pages: Home, Login, Register, Admin Login, Forgot Password
- [x] Email verification flow: pending registration → email → verify → user created
- [x] Password recovery: forgot form → email → reset → login
- [x] Token security: crypto.randomBytes + SHA-256 hash storage
- [x] Verification pending page with masked email and resend option
- [x] Authentication: user login, admin login on `/admin/login`, register, logout
- [x] Inactive-user rejection: `is_active=0` users cannot log in (generic message)
- [x] Admin login with visual distinction (badge, border-color)
- [x] Admin login rate limiting: 5 attempts / 15 min window
- [x] Resend-verification rate limiting: 3 attempts / 15 min
- [x] Forgot-password rate limiting: 3 attempts / 15 min
- [x] Generic responses for forgot-password and resend-verification
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
- [x] Modular EJS: 2 layouts, 4 components, 13 pages
- [x] Parameterized SQL queries throughout
- [x] Helmet security headers (CSP, HSTS, etc.)
- [x] Per-request CSP nonce for inline import map and style blocks (no global unsafe-inline in script-src)
- [x] External GLB loading from Google Cloud Storage (connect-src scoped to single origin)
- [x] Login rate limiting: 5 attempts / 15 min window (both user and admin)
- [x] Session cookie: HttpOnly, SameSite=Lax, configurable maxAge
- [x] Centralized 404 and 500 error pages
- [x] Errors propagated via `next(error)` to 500 handler
- [x] EJS layout middleware (`config/viewEngine.js`) — zero extra dependencies
- [x] POST logout visible in both navbars after login
- [x] `test-auth.js` integration tests: 40 assertions passing (non-credential)
- [x] CSRF protection on all state-changing routes (csrf-sync, synchronizer-token)
- [x] 403 error page for invalid/missing CSRF tokens
- [x] Persistent MySQL session store (survives restarts, auto-cleanup every 15min)
- [x] Server configured to wait for session store readiness before starting (no silent MemoryStore fallback)
- [x] Session shape: `{id, name, email, role_id, role}` consistent across all logins
- [x] Admin authorization uses numeric `role_id === 1` (not string comparison)
- [x] Login SQL: `WHERE email = ? AND is_active = 1 LIMIT 1`
- [x] Homepage Panel 1 (Hero): full-viewport animated panel with 3D helmet
- [x] Interactive 3D helmet via Three.js (`casco.glb`, 26.76 MB)
- [x] GSAP + ScrollTrigger entrance animations and scroll-linked transitions
- [x] Lenis smooth scrolling (homepage only, respects reduced motion)
- [x] Panel architecture (`data-panel="1"`, `data-panel="2"` transition placeholder)
- [x] Responsive design tested at multiple breakpoints (desktop, tablet, mobile)
- [x] Reduced-motion accessibility (CSS media query + JS detection)
- [x] No bundler — vendor aliases + import map for Three.js/GSAP/Lenis
- [x] Homepage-specific CSS/JS scoped under `.home-page` / `body.page-home`
- [x] CSP updated for WebGL (`blob:`, `connect-src`, `worker-src`)

## New Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/verify-pending` | Shows verification pending page |
| GET | `/auth/verify-email?token=` | Verifies email, creates user account |
| GET/POST | `/auth/resend-verification` | Resend verification email form + action |
| GET/POST | `/auth/forgot-password` | Forgot password form + action |
| GET/POST | `/auth/reset-password?token=` | Reset password form + action |

## Database

- Connection: pool via `config/db.js`
- Schema tables: `users`, `pending_registrations`, `password_reset_tokens`, `sessions`, `site_settings`
- `pending_registrations`: Stores unverified registration data with SHA-256 token hash, expires_at
- `password_reset_tokens`: Single-use reset tokens with FK to `users(id)`, used_at tracking
- `role_id`: 1 = admin, 2 = user — mapped via `config/roles.js`
- `is_active`: TINYINT(1), default 1 — controls login access
- No hardcoded credentials in source code. Use `node create-admin.js` to add administrators.

## Email Configuration

- Transporter: `config/mailer.js` reads from `.env`
- Required variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `APP_URL`
- Optional: `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`, `EMAIL_VERIFICATION_EXPIRES_MINUTES`, `PASSWORD_RESET_EXPIRES_MINUTES`
- Verify: `mailer.verifyConnection()` in dev
- Status: Registration verification and password-reset emails were manually confirmed delivered and functional.

## AI Tools Configured

| Tool | Purpose | Status |
|------|---------|--------|
| Graphify | Knowledge graph + query | Installed |
| Caveman | Token-efficient communication | Skill loaded |
| CodeBurn | Token usage tracking (estimates) | Global install, CLI active |

## Known Limitations

- 15 `.ejs` templates not parsed by Graphify AST (no tree-sitter-ejs)
- `schema.sql` now matches actual DB schema (`role_id` INT, `is_active` present, no `role` ENUM, no `avatar`)
- No protection against deactivating the last administrator
- Verification and password-reset tokens are stored as SHA-256 hashes in MySQL, not in sessions. The CSRF synchronizer token is stored as part of the persistent session data.
- Token cleanup is inline (per-request), no cron/scheduler for expired tokens
- No AJAX/fetch CSRF header support (forms only)
- Manual browser CSRF validation pending
- Manual browser restart validation pending
- Session expiration has not been tested with a shortened lifetime
- MySQL session-store failure mode has not been manually tested
- Multiple Node.js process sharing has not been tested
- Rate-limit counters remain in memory (reset on restart)
- Helmet CSP allows `'unsafe-inline'` for EJS inline styles
- Admin login doesn't share rate limit counter with user login (separate buckets)
- Email templates inline in `config/mailer.js` (no template folder)
- Deployment hardening remains pending
- `casco.glb` is 26.76 MB (uncompressed 3D asset) — optimization deferred
- Panel 2 is a transition placeholder only; Panel 3+ not yet designed
- Manual browser visual validation of Panel 1 required (not yet performed)
- Lenis initialized only on homepage; anchor link behavior not tested
- GLB loading confirmed working via HTTP; manual browser WebGL rendering validation pending

## Next Recommended Phase

Persistent rate limiting (**postponed** until after current frontend work), Panel 2 design, manual browser visual validation, or deployment configuration.

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
| Email/PW | Email Verification and Password Recovery | 2026-07-21 |
| CSRF | CSRF Protection (csrf-sync, 13 forms, 45 tests) | 2026-07-21 |
| Sessions | Persistent MySQL Sessions (express-mysql-session) | 2026-07-21 |
| Frontend P1 | Frontend Foundation — Animated Panel 1 (Three.js + GSAP + Lenis) | 2026-07-21 |
| P1 Visual Fix | Panel 1 Helmet and Logo Correction (3D import fix + logo sizing) | 2026-07-21 |
| CSP Fix | Critical Panel 1 Runtime Correction (CSP nonce + external GLB + nav) | 2026-07-21 |
