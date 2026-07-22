# Changelog

## 2026-07-21 — Critical Panel 1 Runtime Correction — CSP, Three.js, External GLB, Logo, and Navigation

### Root Cause — Two Interdependent Failures
1. **CSP blocked the inline import map**: The `<script type="importmap">` tag is an inline script. The CSP had `script-src 'self'` which blocks all inline scripts. This silently prevented the import map from loading, which meant `import * as THREE from 'three'` failed with `"Failed to resolve module specifier 'three'"` — the browser didn't know where to find the `three` package.
2. **Helmet3D model loading**: Even if the import map worked, the GLB file was loaded from a local path instead of the specified external Google Storage URL.

### Fixed — CSP Nonce System
- **Per-request nonce middleware**: Added `crypto.randomBytes(16).toString('base64')` middleware BEFORE Helmet, storing the nonce in `res.locals.cspNonce`.
- **Helmet CSP**: `script-src` now uses `['self', (req, res) => "'nonce-" + res.locals.cspNonce + "'"]` (Helmet 8.3.0 per-request directive function). No global `'unsafe-inline'` in script-src.
- **Import map**: `<script type="importmap" nonce="<%= cspNonce %>">` — now authorized by CSP.
- **Inline CSS variables**: `<style nonce="<%= cspNonce %>">` — also authorized.
- **CSP header verified**: `script-src 'self' 'nonce-<random>'` present in HTTP response, `connect-src 'self' blob: https://storage.googleapis.com`.

### Fixed — External GLB Loading
- **GLB URL**: Changed from `/3d/casco.glb` to `https://storage.googleapis.com/ninjalab3d/casco.glb` (28061104 bytes, verified via `curl.exe -I`).
- **`connect-src`**: Added `https://storage.googleapis.com` to allow `fetch()` for GLTFLoader.
- **Progress display**: Added `.hero-loader-text` element showing "Cargando modelo 3D… 45%".
- **Dynamic camera fitting**: After centering and scaling the model, camera distance is calculated from the fitted bounding box: `cameraDistance = fittedDim / (2 * tan(fovRadians / 2)) * 1.3`. Camera positioned at `(0, 0.1, cameraDistance)` looking at `(0, 0, 0)`.
- **Deferred resize**: `requestAnimationFrame(() => onResize())` ensures DOM layout is settled before initial renderer sizing.
- **Fallback**: On GLTF load failure, loader is hidden, fallback icon shown, `has-fallback` class added to stage, error logged to console.

### Fixed — Logo Size
- **Container**: `.hero-logo { width: clamp(360px, 28vw, 480px) }` — allows up to 480px at wide viewports.
- **Image**: `width: 100%; height: auto; transform: scale(1.15)` — compensates for transparent padding in `LogoCompleto.png`.
- **Tablet** (≤768px): `width: clamp(240px, 35vw, 360px); transform: scale(1.12)`.
- **Mobile** (≤430px): `width: clamp(180px, 50vw, 260px); transform: scale(1.08)`.

### Fixed — Navigation Alignment
- **`.hero-nav`**: Added `justify-self: end` to push navigation to the far right of the grid column.
- **Header grid**: `grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem)` — ensures large gap between logo and nav.
- **Header max-width**: `max-width: min(100%, var(--home-content-width) + 2 * padding); margin-inline: auto` — contained within content width.

### Fixed — 3D Stage
- **min-height**: `clamp(500px, 56vw, 780px)` — larger stage for better helmet presence.

### Validation
- **CSP header**: `script-src 'self' 'nonce-<random>'` — per-request nonce confirmed.
- **HTTP**: 14/14 endpoints return 200.
- **CSP nonce**: Present on import map and inline style in rendered HTML.
- **External GLB**: `curl.exe -I` returns 200, `Content-Length: 28061104`, `Content-Type: application/octet-stream`.
- **`npm audit --omit=dev`**: 0 vulnerabilities.
- **`git diff --check`**: clean (non-graphify files).
- **Login page**: Nonce present (by layout), no home.js/css leakage.

### Limitations
- Manual browser visual validation pending (helmet rendering, logo comparison, idle rotation, drag interaction).
- `casco.glb` (26.76 MB) optimization remains future work.

## 2026-07-21 — Panel 1 Helmet and Logo Correction

### Root Cause — 3D Helmet Not Loading
- **`helmet3d.js` line 5**: Used absolute path `/vendor/three/three.module.js` which does not exist in Three.js v0.185.1. The `three.module.js` file lives only at `node_modules/three/build/three.module.js`. The import map defines `"three": "/vendor/three/build/three.module.js"` but the code bypassed it with a hardcoded wrong path.

### Fixed — 3D Helmet Loader
- **Import path**: Changed from `/vendor/three/three.module.js` to bare specifier `'three'` (resolved via import map to `/vendor/three/build/three.module.js`).
- **GLTFLoader import**: Changed to `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'` (no dynamic import needed).
- **Model group**: Wrapped model in `new THREE.Group()` before scene.add — rotation applied to group, not raw GLB nodes.
- **Camera**: Adjusted to `PerspectiveCamera(35, ...)` with `camera.position.set(0, 0.15, 5)`.
- **Lighting**: Boosted key light intensity (2.2), added `HemisphereLight` for environment fill, increased ambient to 0.7. This ensures the dark helmet is visible against dark background.
- **Model guards**: Added `modelLoaded` flag — pointer handlers and render loop check `if (!modelLoaded) return` before accessing model.
- **Tone mapping**: Added `ACESFilmicToneMapping` with exposure 1.1 (only when supported by installed version).
- **Renderer**: `setClearColor(0x000000, 0)` for transparency.

### Fixed — Logo Size
- **CSS**: `.hero-logo-img` changed from `height: 2.2rem` (~35px) to `width: clamp(200px, 18vw, 320px); height: auto;`.
- **Header layout**: Changed from `display: flex; justify-content: space-between` to `display: grid; grid-template-columns: minmax(200px, auto) 1fr` for stable logo+nav alignment.
- **Responsive**: Tablet ~150–220px, mobile ~130–180px via clamp().

### Fixed — 3D Stage CSS
- **z-index**: `.hero-3d` bumped from 1 to 2 to sit above background pseudo-elements.
- **touch-action**: Added `touch-action: pan-y` on `.hero-canvas` for mobile vertical scroll support.
- **Height**: `.hero-canvas` removed `min-height` (inherits from `.hero-3d` parent) and removed explicit height-to-zero risk from percentage-based sizing.
- **Stage sizing**: `.hero-3d` now uses `min-height: clamp(380px, 50vw, 700px)` for robust sizing across viewports.

### Validation
- HTTP: 15/15 endpoints return 200 (including GLTFLoader.js, three.module.js).
- `npm audit --omit=dev` → 0 vulnerabilities.
- `git diff --check` → clean (non-graphify files).
- Login page: navbar ✅, footer ✅, no home.css/home.js leakage ✅.
- Homepage: no default navbar ✅, no footer ✅, importmap ✅.

### Limitations
- Manual browser WebGL rendering validation pending.
- `casco.glb` (26.76 MB) optimization remains future work.

## 2026-07-21 — Frontend Foundation — Animated Panel 1

### Added
- **Three.js**: Interactive 3D helmet model (`casco.glb`, 26.76 MB) with idle rotation, pointer drag, and parallax hover.
- **GSAP + ScrollTrigger**: Entrance animation timeline (8 sequential reveals: grid, logo, nav, eyebrow, heading, glow, helmet, CTAs, social) and scroll-linked transitions.
- **Lenis**: Smooth scrolling with eased interpolation, homepage-only initialization, GSAP ScrollTrigger synchronization.
- **`public/css/home.css`**: Homepage-only styles scoped under `.home-page` / `body.page-home` — tokens, panel layout, hero typography, gradient background, grid overlay, 3D stage, CTAs, social links, responsive rules, reduced motion overrides.
- **`public/js/home/home.js`**: Homepage entry point — feature detection (WebGL, reduced motion), module coordination, fallback handling.
- **`public/js/home/animations.js`**: GSAP timelines, ScrollTrigger scroll behaviors, Lenis setup, scroller-proxy for ScrollTrigger.
- **`public/js/home/helmet3d.js`**: Three.js scene setup — GLTFLoader, soft key/fill/rim lighting, idle rotation, damping, pointer interaction, resize handling, visibility pause, cleanup.
- **Panel architecture**: Homepage structured as `<section data-panel="1">` + minimal `<section data-panel="2">` transition placeholder.
- **Homepage-specific layout**: No default navbar/footer — hero-header with logo + nav + auth context.
- **Import map**: `three` → `/vendor/three/build/three.module.js`, `three/addons/` → `/vendor/three/examples/jsm/`.
- **Vendor aliases**: Scoped Express static mounts for Three.js, GSAP, Lenis browser builds (no `node_modules` exposure).

### Visual Reference
- Panel 1 closely reproduces `public/reference/PaginaWeb.png`:
  - Logo upper-left, navigation right: Tienda, Galería, Nosotros, Cuenta
  - Eyebrow: "IMPRESIÓN 3D EN COSTA RICA"
  - Main title: "Fabricamos tus / ideas / con precisión / milimétrica" with neon-green glow
  - 3D helmet on right side, two CTAs: primary green + outline
  - Social links: Instagram, Facebook, TikTok, WhatsApp (SVG icons)
  - Background: layered gradient (light gray → dark → black) + grid overlay + green radial glow
- Motion language inspired by `trymeridian.com`: scroll-driven panels, smooth transitions, parallax, reveal effects.

### Changed
- **`app.js`**: CSP extended (`connect-src blob:`, `worker-src blob:`) for WebGL. Vendor static aliases added. Home route updated with `pageClass`, `pageStyles`.
- **`views/layouts/main.ejs`**: Conditional navbar/footer (excluded on homepage). Conditional `<script>` (module for homepage, classic for others). Import map injected for homepage. `pageStyles` array support.
- **`views/pages/home.ejs`**: Completely rewritten — panel architecture, hero header, background layers, text + 3D + CTAs + social layout.

### Responsive Behavior
- Desktop: Two-column (text left, 3D right), full viewport panel.
- Tablet (< 1024px): Stacked columns, reduced spacing, centered content.
- Mobile (< 430px): Fixed nav, single column, 3D above text (reading order preserved), full-width CTAs, compact social links.
- No horizontal overflow at any tested breakpoint.

### Accessibility
- `prefers-reduced-motion: reduce`: disables animation timelines, disables Lenis, reduces idle rotation, static 3D model remains interactive.
- All interactive elements have visible `:focus-visible` outlines.
- Semantic heading structure, `aria-label` on links, `role="img"` on 3D stage.

### Security
- No CSP regressions — all scripts/styles loaded locally, no CDNs, no `unsafe-eval`.
- Logout form retains `_csrf` token (conditionally rendered when authenticated).
- Admin/auth pages excluded from homepage assets (no three.js/gsap/lenis on login/admin).
- No secrets, credentials, or tokens in homepage JavaScript.

### Validation
- HTTP: 14/14 endpoints return 200 (home, logo, GLB, CSS, JS, vendor files, auth pages).
- 404 redirect: 302 when unauthenticated accessing `/admin`.
- Login page: navbar ✅, footer ✅, main.js ✅, no home.css/home.js leakage.
- Homepage: no default navbar ✅, no footer ✅, no main.js ✅, importmap ✅, home.js module ✅.
- `npm audit --omit=dev` → 0 vulnerabilities.
- Git diff: no real secrets exposed (only `SESSION_SECRET` env var reference).
- CSP: `connect-src` and `worker-src` support WebGL.

### Limitations
- `casco.glb` (26.76 MB) is uncompressed — optimization deferred to later phase.
- Manual browser visual validation pending (side-by-side comparison with reference image).
- Panel 2 is transition placeholder only; future panels not designed.
- Lenis anchor-link behavior not tested.
- Real social media URLs remain placeholder `#` links.

## 2026-07-21 — Documentation Accuracy Correction

### Corrected
- **CSRF token storage wording**: Clarified that verification/password-reset tokens are not stored in sessions, but the CSRF synchronizer token is stored as part of the persistent MySQL session data.
- **Session-store failure mode**: Reworded from "exits with an error" (untested) to "configured to wait for readiness and fail startup rather than silently fall back to MemoryStore."
- **SMTP status**: Removed obsolete "email not yet tested" limitation. Registration verification and password-reset emails were manually confirmed delivered and functional.
- **Validation status**: Clearly distinguished HTTP restart persistence validation (completed) from manual browser restart validation (pending).
- **Remaining limitations**: Removed obsolete SMTP and MemoryStore items. Added pending manual validation and deployment hardening items.
- **AUTH_TESTING.md**: Session persistence section now separates completed HTTP validation from pending manual browser and failure-mode tests.

## 2026-07-21 — Persistent MySQL Sessions

### Added
- **`express-mysql-session`** (v3.x): MySQL-backed session store replacing in-memory `MemoryStore`.
- **`config/session.js`**: Reusable session configuration. Reads DB credentials from existing `.env`, creates `MySQLStore` with `createDatabaseTable: true`, auto-cleanup every 15 min (`clearExpired`, `checkExpirationInterval`, `expiration`).
- **Store readiness**: `sessionStore.onReady()` promise blocks server startup until MySQL session table is accessible.
- **Session persistence**: Sessions survive application restarts.

### Changed
- **`app.js`**: Session configuration moved to `config/session.js`. Server now waits for `onReady()` before listening. Removed unused `session` import.
- **`schema.sql`**: Sessions table updated to `data MEDIUMTEXT` (matches auto-created schema).

### Fixed
- No more `MemoryStore` fallback. The application waits for session store readiness before starting. The unavailable-store failure mode has not yet been manually tested, but the code is configured to fail startup rather than silently fall back to MemoryStore.

### Validation
- `test-auth.js`: 40/40 non-credential assertions pass.
- HTTP restart persistence: Logged in → stopped server → restarted → same cookie still authenticated (200, navbar visible).
- Logout: `POST /auth/logout` → session destroyed, cookie removed, `/admin` blocked.
- `npm audit --omit=dev` → 0 vulnerabilities.
- Git diff: no real credentials exposed.
- Graphify: updated.

### Limitations
- Manual browser restart validation pending.
- Session expiration not tested with shortened lifetime.
- MySQL session-store failure mode not manually tested.
- Multi-process sharing not tested.
- HTTP restart persistence validation completed; manual browser restart validation pending.

## 2026-07-21 — CSRF Protection

### Added
- **`csrf-sync`** (v4.x): Synchronizer-token pattern CSRF protection.
- **CSRF configuration** in `app.js`: token stored in `req.session.csrfToken`, read from `req.body._csrf`.
- **CSRF token middleware**: `res.locals.csrfToken = generateToken(req)` after session, before routes.
- **CSRF protection middleware**: `csrfSynchronisedProtection` applied globally. Ignores GET/HEAD/OPTIONS.
- **CSRF error handler**: Detects `EBADCSRFTOKEN` code, renders `views/pages/403.ejs` with Spanish message, status 403.
- **`views/pages/403.ejs`**: Styled error page with public layout, "Solicitud no válida" message.
- **CSRF hidden inputs** in all 13 POST forms: login, register, admin login, forgot-password, reset-password, resend-verification, logout (public + admin navbar), user-form (create/edit), toggle, delete.

### Changed
- **`app.js`**: Added csrf-sync import, token generation middleware, csrfSynchronisedProtection, CSRF error handler before 500 handler.
- **`test-auth.js`**: Extended with 45 assertions including token availability, missing/invalid token 403, cross-session, valid logout with CSRF, no side effects.
- All EJS POST forms: Added `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.

### Security
- Every POST/PUT/PATCH/DELETE request requires valid session-bound CSRF token.
- Missing or invalid tokens return 403 before any controller logic executes.
- Tokens never appear in URLs and are never logged.
- The CSRF synchronizer token is stored as part of the session data (which is now in MySQL). Verification and password-reset tokens are stored as SHA-256 hashes in their own MySQL tables, not in the session.
- Token survives session regeneration (new token generated on next GET).
- Cross-session token reuse detected and rejected.
- Email verification GET links intentionally excluded from CSRF (rely on crypto tokens).

### Validation
- `test-auth.js`: 40/40 non-credential assertions pass, 3 credential-dependent, 2 skipped.
- `npm audit --omit=dev` → 0 vulnerabilities.
- `git diff --check` → clean.
- Git diff: no secrets, passwords, CSRF tokens, or credentials exposed.
- Graphify: updated.

### Limitations
- Manual browser testing pending (most CSRF tests are HTTP-level).
- No AJAX/fetch CSRF header support (only forms use `_csrf`).

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
- Registration verification and password-reset emails were manually confirmed delivered and functional.
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
