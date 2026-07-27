# Security Audit — Phase 16A

**Project:** nlSite
**Date:** 2026-07-24
**Audit mode:** Read-only code review — no production changes applied.
**Methodology:** Every finding is based on exact code paths in the current repository. Generic best-practice warnings without evidence are excluded.

---

## Executive Summary

The nlSite application demonstrates **mature security posture for its stage**. Core protections — CSRF, Helmet/CSP with nonces, session fixation regeneration, parameterized SQL, Sharp pixel-limit validation, bcrypt hashing, and token hashing — are correctly implemented. Most high-risk categories (SQL injection, stored XSS, mass assignment, IDOR in catalog admin) are **not present**.

The audit identified **0 Critical, 0 High, 6 Medium, 8 Low, and 2 Informational** findings after remediation. Phase 16C confirmed robust authorization, CSRF coverage, input validation, upload security, and output safety — only defense-in-depth hardening remains in Medium findings. Remaining items: `style-src 'unsafe-inline'`, over-permissive `authLimiter`, missing `checkoutLimiter`, weak password minimum, missing HSTS/Referrer-Policy headers, and token-in-URL GET parameters.

### Finding Counts by Severity

| Severity | Count | Phase target |
|----------|-------|-------------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 6 | 16D |
| Low | 8 | 16D |
| Informational | 2 | 16D, deployment validation |
| Remediated | 4 | Phase 16A, 16B, 16C |

---

## Security-Control Coverage Matrix

| Control | Status | Notes |
|---------|--------|-------|
| CSRF protection | PROTECTED | Global CSRF (csrf-sync) applied via `app.use()`. **All auth POST routes are covered** (re-audited: global middleware at app.js:411 runs before authRoutes at app.js:417). Multipart routes (avatar, admin catalog) handle CSRF manually after multer. Webhook path correctly exempted. |
| Helmet / CSP | STRONG | helmet() configured with nonce-based CSP. `style-src 'unsafe-inline'` present as a hardening opportunity (S-002, Medium — no confirmed CSS injection vector in current templates). `script-src` uses nonce. `frame-ancestors 'self'`, `form-action 'self'` set. |
| Session fixation | PROTECTED | `req.session.regenerate()` called after every successful login (regular + admin). Cart preserved across regeneration. |
| Session store | PROTECTED | MySQL store (`express-mysql-session`), not in-memory. |
| Session cookies | STRONG | `httpOnly: true`, `secure: true` in production, `sameSite: 'lax'`. Destroyed on logout with explicit `clearCookie`. |
| Password hashing | STRONG | `bcryptjs` with genSalt(10). |
| Token hashing | STRONG | SHA-256 hash of raw tokens stored; raw token only in email links. Reset tokens invalidated on use. |
| SQL injection | PROTECTED | All queries use `?` placeholders. No dynamic ORDER BY, no string concatenation. |
| XSS (stored) | PROTECTED | All dynamic EJS output uses `<%=` (escaped). JSON-LD serialization and inline JSON blocks escape `</script>` sequences (S-005, S-018 — remediated). No confirmed stored XSS vectors. |
| Open redirect | PROTECTED | `safeAuthReturnPath()` validates return URLs against explicit regex whitelist. Unsafe URL schemes (`javascript:`, `data:`) rejected. |
| File uploads | STRONG | Multer with MIME filter, memoryStorage. Content-based validation via Sharp (pixel/dimension limits, animation rejection). GLB magic-byte, version, and total-length validation. Path traversal prevention. Unique UUID filenames, `wx` flag (no overwrite). SVG disabled. `selectorUploadMulter` MIME filter added in Phase 16C. |
| Rate limiting (login) | STRONG | `loginLimiter` (5 req / 15 min) on regular login. `adminLoginLimiter` (5 req / 15 min) on admin login. `forgotLimiter` (3/15min). `resendLimiter` (3/15min). `guestLookupLimiter` (20/15min). |
| Rate limiting (registration / reset) | PROTECTED | `registerLimiter` (5/30min), `resetPasswordLimiter` (10/30min), `forgotLimiter` (5/30min), `resendLimiter` (3/30min) added in Phase 16B. `loginLimiter` (5/15min) and global `authLimiter` (100/15min) remain. |
| Secrets validation | STRONG | `config/envValidator.js` checks SESSION_SECRET, DB_PASSWORD, Tilopay keys, port, APP_URL format, upload directory isolation. Fails hard in production. |
| Error exposure | STRONG | Production 500 handler suppresses error details. CSRF error renders generic 403 page. Dev mode logs full errors; production silences. |
| Authorization | STRONG | `isAuthenticated` checks `req.session.user.id`. `isAdmin` checks `role_id === 1`. Role never read from `req.body`. Admin routes mounted behind both middleware. |
| Dependency freshness | GOOD | All packages are recent (helmet ^8.3.0, csrf-sync ^4.2.1, bcryptjs ^2.4.3, sharp ^0.35.3, multer ^2.2.0, express-rate-limit ^8.6.0). No known deprecated auth/upload packages. |

---

## Findings

### Critical

*None identified.* S-001 (CSRF) was re-examined and found to be fully protected by the global CSRF middleware. S-002 (`style-src 'unsafe-inline'`) was reassessed and reclassified as Medium — see below for rationale.

### High

#### S-003 — No dedicated rate limiter on registration POST
- **Severity:** High
- **Status:** ✅ **Remediated — Phase 16B**
- **Affected route:** `POST /auth/register`
- **Files:** `routes/authRoutes.js:58`, `controllers/authController.js:121`
- **Original Evidence:** The route used only the global `authLimiter` (100 requests / 15 minutes on all `/auth/*` routes). Registration involves bcrypt hashing, transactional DB writes, and email sending — an attacker can exhaust server resources by submitting 100 registrations in 15 minutes per IP.
- **Exploitation:** Automated bot accounts, email spam (verification emails sent on every registration), DB bloat via `pending_registrations` table.
- **Impact:** Server resource exhaustion (CPU for bcrypt, DB for inserts, email API quota exhaustion).
- **Fix applied:** Added a dedicated `registerLimiter` at **5 requests / 30 minutes per IP** on `POST /auth/register`. The response follows the application's existing redirect-with-flash-message pattern. CSRF protection remains covered by the global CSRF middleware (mounted at app.js:411, before authRoutes at app.js:417).
- **Phase:** 16B (completed)

#### S-004 — No dedicated rate limiter on reset-password POST
- **Severity:** High
- **Status:** ✅ **Remediated — Phase 16B**
- **Affected route:** `POST /auth/reset-password`
- **Files:** `routes/authRoutes.js:68`, `controllers/authController.js:521`
- **Original Evidence:** The route used only the global `authLimiter` (100/15min). Password reset involves bcrypt hashing + transactional DB write. While `forgotPassword` has a `forgotLimiter`, the actual password **reset** POST had no dedicated limiter.
- **Exploitation:** Brute-force password selection via reset token replay (within the 30-minute token window).
- **Impact:** Account takeover if reset token is leaked.
- **Fix applied:** Added a dedicated `resetPasswordLimiter` at **10 requests / 30 minutes per IP** on `POST /auth/reset-password`. The existing `forgotLimiter` was simultaneously updated from 3/15min to **5 requests / 30 minutes**. The `resendLimiter` was updated from 3/15min to **3 requests / 30 minutes** for consistency.
- **Phase:** 16B (completed)

#### S-005 — JSON-LD `jsonLdScript()` does not call `escapeJsonLd()`
- **Severity:** High
- **Status:** ✅ **Remediated — Phase 16A**
- **Affected feature:** All pages with JSON-LD injection (home, products, categories)
- **Files:** `config/jsonLdHelper.js:14-17`
- **Original Evidence:**
```javascript
function jsonLdScript(ld) {
  const json = JSON.stringify(ld);
  return `<script type="application/ld+json">${json}</script>`;
}
```
The `escapeJsonLd()` function existed (lines 5-12) but was never called. If any field contained `</script>`, it would break out of the JSON-LD block.
- **Fix applied:** `jsonLdScript()` now serializes the full object with `JSON.stringify(ld)`, then applies `escapeJsonLd()` to the complete serialized JSON string before embedding it in the `<script>` tag. Characters `<`, `>`, `&`, U+2028, and U+2029 are all escaped. The `</script>` sequence cannot appear literally in the generated script body.
- **Verification:** 10 focused tests added to `tests/technical-seo.test.js` (Phase 16A — JSON-LD script-breakout prevention suite) confirming:
  - `</script>` sequence is escaped to `\u003c/script\u003e`
  - Parsed JSON round-trips original values exactly
  - Ampersands, quotes, backslashes, `<`, `>` all preserved through serialize→escape→parse cycle
  - U+2028 and U+2029 line/paragraph separators are escaped
  - Nested objects (offers) with mixed special chars are safe
  - Organization, WebSite, Product, and Breadcrumb JSON-LD all produce safe output
- **Phase:** 16A (already completed)

#### S-006 — SVG uploads disabled but `renderVariant` would pass SVG through Sharp unsafely
- **Severity:** High
- **Status:** Confirmed (requires SVG_UPLOAD_ENABLED=true to exploit)
- **Affected feature:** CMS media library image rendering
- **Files:** `services/mediaStorageService.js:131-133,158,184`
- **Evidence:** SVG uploads are disabled at `mediaStorageService.js:131` (`SVG_UPLOAD_ENABLED` is false). However, if someone enables `SVG_UPLOAD_ENABLED`, the code flow is:
  1. SVG passes MIME check at line 131-133 (SVG is allowed when flag is true)
  2. Falls through to `RASTER_MIME_TYPES` check at line 148 — **SVG is NOT in RASTER_MIME_TYPES** (`config/cmsOptions.js` has `RASTER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])`), so this line would **reject** SVG: `throw new Error('Formato no permitido. Use JPG, PNG o WebP.')`

  **Correction:** SVG cannot reach `renderVariant` even when `SVG_UPLOAD_ENABLED` is true. The `RASTER_MIME_TYPES` check at line 148 blocks it. Downgraded to **Low**.
- **Recommendation:** Document that SVG upload re-enablement requires adding `image/svg+xml` to `RASTER_MIME_TYPES` AND implementing SVG sanitization (e.g., DOMPurify + is-svg validation).
- **Phase:** 16D

### Medium

#### S-002 — `style-src 'unsafe-inline'` in CSP
- **Severity:** Medium *(reclassified from Critical)*
- **Status:** Confirmed — hardening opportunity
- **Affected feature:** All pages (CSP header)
- **Files:** `app.js:97`
- **Evidence:**
```javascript
styleSrc: ["'self'", "'unsafe-inline'"],
```
- **Reclassification rationale:** The audit's severity definition for Critical requires "practical authentication bypass, remote code execution, unrestricted sensitive data access, or severe secret exposure." CSS injection via `unsafe-inline` requires a separate CSS injection vector to exploit. All EJS templates use `<%=` (escaped output). There is no unescaped `<style>` block or untrusted CSS input in the current codebase. Without a CSS injection bug, `unsafe-inline` is a policy weakness but **not an exploitable vulnerability**. It is therefore correctly classified as **Medium**: a meaningful defense-in-depth gap that should be hardened.
- **Why the directive exists:** The homepage uses several inline `<style>` blocks (in `main.ejs`, `home.ejs`) for animation-related CSS variables and critical-above-fold styles. Externalizing all of these and applying nonces is the proper fix, but requires a coordinated audit across all templates.
- **Impact if exploited:** An attacker who separately finds a CSS injection vector (e.g., future CMS field rendered via `<%-`) could inject CSS-based data exfiltration via `@import`, `background: url()`, or `@font-face`. The nonce-based `script-src` would block injected JavaScript.
- **Recommendation:** Replace `unsafe-inline` with nonce-based style loading. Apply nonce to all `<style>` tags and externalize inline styles. Audit every inline style in EJS templates.
- **Phase:** 16D
- **Suggested tests:** Verify CSP header lacks `unsafe-inline` for style-src. Verify all inline `<style>` tags carry the correct nonce.

#### S-007 — `authLimiter` (100/15min) is too permissive for auth endpoints
- **Severity:** Medium
- **Status:** Confirmed
- **Affected routes:** All `/auth/*` routes
- **Files:** `app.js:370-379,417`
- **Evidence:** The global `authLimiter` at 100 requests / 15 minutes covers login POST, register POST (which already should have its own), forgot-password, reset-password, resend-verification, verify-email. While `loginLimiter` (5/15min) overrides this for login, the other routes remain at 100/15min. A scraper could probe `/auth/verify-email?token=...` 100 times rapidly.
- **Impact:** Token brute-forcing on verification tokens (64 hex chars = infeasible, but probing still possible). Resource waste.
- **Recommendation:** Reduce `authLimiter` to 30/15min and ensure per-route limiters (S-003, S-004) cover high-risk endpoints.
- **Phase:** 16B

#### S-008 — `checkoutLimiter` does not exist
- **Severity:** Medium
- **Status:** Confirmed
- **Affected route:** `POST /checkout`
- **Files:** `routes/checkoutRoutes.js:6`
- **Evidence:** The checkout POST route has no rate limiter. An attacker could submit hundreds of checkout requests, exhausting the cart session, creating orders, and sending confirmation emails.
- **Impact:** Order spam, email exhaustion, potential payment gateway abuse (if Tilopay API keys are configured and rate-limited by Tilopay).
- **Recommendation:** Add a `checkoutLimiter` (e.g., 10 requests / 15 minutes per IP).
- **Phase:** 16C

#### S-009 — Register `password.length < 6` is permissive
- **Severity:** Medium
- **Status:** Confirmed
- **Affected route:** `POST /auth/register`
- **Files:** `controllers/authController.js:140`
- **Evidence:** Minimum password length is 6 characters. No complexity requirements (uppercase, digit, special character). No common-password check. Password change in account settings requires 8 characters (`accountValidator.js:53`), creating an inconsistency.
- **Impact:** Weak passwords for new accounts (e.g., "123456", "abcdef"). Account takeover via credential stuffing.
- **Recommendation:** Raise minimum to 8 characters for registration, matching the account password change policy. Consider adding basic complexity checks (at least one letter + one digit).
- **Phase:** 16B

#### S-010 — `helmet()` missing HSTS, Referrer-Policy, Permissions-Policy
- **Severity:** Medium
- **Status:** Confirmed
- **Affected feature:** All HTTP responses
- **Files:** `app.js:93-119`
- **Evidence:** The `helmet()` call only configures `contentSecurityPolicy`. Helmet's other default protections (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, etc.) are applied via helmet defaults. However, explicit HSTS `max-age` is not set — defaults to 15552000 (180 days) via helmet. This is adequate but should be documented. `Referrer-Policy` is `no-referrer` by default. `Permissions-Policy` is not explicitly set. `X-Content-Type-Options: nosniff` is automatically set by helmet. `X-DNS-Prefetch-Control: off` is auto-set.
- **Impact:** Missing `Permissions-Policy` could allow iframes of third-party content to access camera/microphone/geolocation if the app later adds such features.
- **Recommendation:** Explicitly configure `strictTransportSecurity`, `referrerPolicy`, and `permissionsPolicy` in the helmet config for documented intent. Add `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **Phase:** 16D

#### S-011 — Session secret has insecure fallback value
- **Severity:** Medium
- **Status:** Confirmed (env-dependent)
- **Affected feature:** Session encryption
- **Files:** `config/session.js:42`
- **Evidence:**
```javascript
secret: process.env.SESSION_SECRET || 'clave-secreta-temporal',
```
In development, this fallback is acceptable. In production, `envValidator.js` fails hard if `SESSION_SECRET` is missing or equals the placeholder `replace_with_a_long_random_secret`, but it does NOT fail if `SESSION_SECRET` is simply not set and the fallback value `'clave-secreta-temporal'` is used. The envValidator checks `!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'replace_with_a_long_random_secret'`. If `SESSION_SECRET` is not set at all, this condition triggers and in production it **does** fail hard. So the fallback is only reached in dev/test.
- **Verdict:** LOW risk — the envValidator correctly catches missing SESSION_SECRET in production.
- **Phase:** 16D — document that this fallback is dev-only.

#### S-012 — `verifyEmail` sends raw token in URL (GET parameter)
- **Severity:** Medium
- **Status:** Confirmed (accepted risk for email verification)
- **Affected route:** `GET /auth/verify-email`
- **Files:** `controllers/authController.js:221-278`
- **Evidence:** The verification token is sent in the URL query string (`?token=RAW_TOKEN`). This means:
  1. Tokens appear in server logs, proxy logs, browser history.
  2. If the user clicks the link on an untrusted network, the token could be intercepted via `Referer` header leakage.
- **Impact:** Token leakage via logs/history/proxy. Mitigated by:
  - Token is hashed before storage (SHA-256)
  - Token expires (configurable, default 30 min)
  - Token is one-time use (registration deleted after verification)
  - Generic error message on invalid/expired token (prevents enumeration)
- **Current protection is adequate** for email verification. Reset tokens follow the same pattern (S-013).
- **Recommendation:** Consider switching to POST-based verification with the token in a hidden form field. Mitigate Referer leakage with `Referrer-Policy: no-referrer` or `strict-origin-when-cross-origin`.
- **Phase:** 16B (optional enhancement)

#### S-013 — Password reset token sent as raw GET parameter
- **Severity:** Medium
- **Status:** Confirmed (see S-012 mitigation)
- **Affected route:** `GET /auth/reset-password`
- **Files:** `controllers/authController.js:485-517`
- **Evidence:** Same pattern as S-012. Token in query string. The `showResetPassword` controller validates the token hash, then renders the reset form with the raw token in the page (`token: rawToken`). The subsequent `resetPassword` POST receives the raw token in `req.body.token`.
- **Mitigation:** Token is hashed in DB, expires, one-time use (marked `used_at`), previous unused tokens invalidated before new one created.
- **Recommendation:** See S-012.
- **Phase:** 16B (optional enhancement)

### Low

#### S-014 — `trust proxy` set to `1` in production — safe but minimal
- **Severity:** Low
- **Status:** Confirmed
- **Files:** `app.js:84`
- **Evidence:** `app.set('trust proxy', 1)` means Express trusts the **first** proxy's `X-Forwarded-For` header. On Railway, this is typically adequate since there's one reverse proxy in front. If Railway adds more proxies, this could become inaccurate.
- **Recommendation:** Set to `app.set('trust proxy', 'loopback')` or `true` with appropriate IP allowlisting if multiple proxies exist.
- **Phase:** 16D

#### S-015 — `express.static` serves `node_modules` via vendor aliases
- **Severity:** Low
- **Status:** Confirmed
- **Files:** `app.js:182-201`
- **Evidence:** Six `express.static` mounts serve content from `node_modules/`. In `node_modules/three/` and `node_modules/gsap/`, every file (including `package.json`, `LICENSE`, source maps, examples) could be publicly accessible.
- **Impact:** Information disclosure (package versions, internal file paths via source maps). Not exploitable but reveals technology stack details.
- **Recommendation:** Serve only specific files/directories: `node_modules/three/build/three.module.js`, `node_modules/gsap/dist/`. The `/vendor/three/examples/jsm` mount is justified (WebGL addons needed by helmet). Remove `/vendor/three` (line 190-193) which serves the entire three package root.
- **Phase:** 16D

#### S-016 — `console.error` in production logs full error objects
- **Severity:** Low
- **Status:** Confirmed
- **Files:** `app.js:698-700`
- **Evidence:**
```javascript
const log = process.env.NODE_ENV !== 'production'
  ? console.error.bind(console, 'Error del servidor:', err)
  : () => { /* silence in production */ };
log();
```
Production silences server errors but other `console.error` calls throughout the codebase are not similarly gated. The `uncaughtException` handler (line 777) logs `err.message` in production (which is fine) but in dev logs full `err`. The `authController` `console.error` calls for mail errors are unconditional.
- **Impact:** Email error messages may appear in Railway logs. Contains mail server error messages, not credentials. Low risk.
- **Recommendation:** Verify Railway log retention and access. Consider structured logging with levels for production.
- **Phase:** 16D

#### S-017 — `MAX_IMAGE_PIXELS` = 100M — decompression-safe but generous
- **Severity:** Low
- **Status:** Confirmed
- **Files:** `config/cmsOptions.js:136`
- **Evidence:** `100 * 1000 * 1000` = 100 megapixels. Sharp's `limitInputPixels` uses this value. A malicious 10K×10K PNG (compressed to ~2MB) could decompress to 100MP, which Sharp would process using significant memory. The `MAX_IMAGE_DIMENSION` = 10000 prevents larger still.
- **Mitigation:** The `MAX_IMAGE_SIZE` = 15MB file size limit prevents truly gigantic compressed inputs. A 15MB PNG at maximum compression could still be large when decompressed, but Sharp's `limitInputPixels` prevents extreme cases.
- **Recommendation:** Reduce to 50M pixels (adequate for all CMS image categories: carousel max is 2560×2560 = 6.5M). 100M is overkill.
- **Phase:** 16C

#### S-018 — `jsonLdScript` outputs raw unsanitized JSON string in `<script>` tag
- **Severity:** Low (see actual issue at S-005 — the real risk is High)
- **Files:** `config/jsonLdHelper.js:14-17`
- **Note:** Duplicate with S-005 — this is the same finding, documented here for completeness. See S-005 for details.

#### S-019 — Admin login does not invalidate existing admin sessions for the same user
- **Severity:** Low
- **Status:** Confirmed (accepted UX behavior)
- **Files:** `controllers/authController.js:368-424`
- **Evidence:** When an admin logs in, the controller creates a new session (via `regenerate`) but does not destroy the previous session. This means an admin can be logged in from multiple browsers/devices simultaneously. Not a vulnerability per se — some applications prefer this UX.
- **Recommendation:** If single-session-per-admin is desired, query and destroy existing sessions for the same user_id before regeneration. This requires MySQL session store introspection.
- **Phase:** 16B (optional)

### Informational

#### S-020 — Tilopay webhook uses `express.json()` — raw body not preserved for signature verification
- **Severity:** Informational
- **Status:** Requires production verification
- **Files:** `routes/tilopayWebhookRoutes.js:24`
- **Evidence:** The webhook route uses `express.json({ limit: '64kb' })`, which parses the body. If Tilopay requires raw body for HMAC verification, this will fail. The route documentation acknowledges this:
```
⚠️ NOTIFICATION MODEL (2026-07-23):
Tilopay webhook signature mechanism is not publicly documented.
Until confirmed from the Tilopay merchant portal:
  1. Accept JSON notifications at POST /webhooks/tilopay
  2. Extract provider/internal reference from the body
  3. Perform authenticated server-to-server status lookup
  4. Use the lookup result — not the notification body — as authoritative
```
- **Recommendation:** Once Tilopay documents their webhook signature scheme, verify the current implementation or switch to `express.raw()` with manual JSON parsing.
- **Phase:** 16D (deployment validation)

#### S-021 — CMS admin branding middleware silently fails on DB errors
- **Severity:** Informational
- **Files:** `app.js:230-233`
```javascript
} catch (_) {
  // Graceful fallback: use .env / config/site.js default
}
```
- **Note:** This is deliberate — admin branding falls back to hardcoded defaults if the DB is unavailable. Good design, no action needed.

---

## Verified Protections

The following controls were verified as correctly implemented:

1. **Session fixation protection:** `req.session.regenerate()` on every login (regular + admin) — `controllers/authController.js:78,399`
2. **Session cookie flags:** `httpOnly: true`, `secure: true` (production), `sameSite: 'lax'` — `config/session.js:46-49`
3. **Session destruction on logout:** `req.session.destroy()` + `res.clearCookie('connect.sid')` — `controllers/authController.js:341-353`
4. **Password hashing:** `bcrypt.genSalt(10)` + `bcrypt.hash()` — `controllers/authController.js:158-159`
5. **Token hashing:** SHA-256 via `crypto.createHash('sha256')` — `controllers/authController.js:15`
6. **Token one-time use:** Reset tokens marked `used_at = NOW()` — `controllers/authController.js:565-568`
7. **Previous token invalidation:** `UPDATE ... SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL` before issuing new token — `controllers/authController.js:458-461`
8. **Generic error messages:** Login returns same message for invalid email and wrong password — `controllers/authController.js:63,71`. Forgot password always returns same message — `controllers/authController.js:477-479`
9. **Open redirect prevention:** `safeAuthReturnPath()` with strict regex whitelist — `middlewares/authMiddleware.js:25-30`
10. **Parameterized SQL:** All database queries use `?` placeholders — verified across all controllers
11. **No mass assignment:** No `req.body.role_id`, no direct user object assignment from request
12. **Upload content validation:** Sharp `inspectRaster()` validates image content, dimensions, pixel limits — `services/mediaStorageService.js:162-182`
13. **Upload path traversal prevention:** UUID filenames, `path.resolve()` on storage root — `services/mediaStorageService.js`
14. **No file overwrites:** `fs.promises.writeFile(buffer, { flag: 'wx' })` — `mediaStorageService.js:207`
15. **SVG disabled:** `SVG_UPLOAD_ENABLED` flag blocks SVG uploads — `mediaStorageService.js:131`
16. **GLB magic validation:** Model MIME and extension validated before storage — `mediaStorageService.js:135-144`
17. **CSRF webhook exemption:** Tilopay webhook correctly uses `express.json()` without CSRF — `routes/tilopayWebhookRoutes.js:24-25`
18. **CSP nonce:** Per-request random nonce via `crypto.randomBytes(16)` — `app.js:87-90`
19. **CSP `script-src`:** Uses nonce, not `unsafe-inline` — `app.js:98-103`
20. **CSS and JS cache non-immutable:** `textCacheOpts` has `immutable: false`, 1-hour maxAge — `app.js:140-143`
21. **Role enforcement:** `isAdmin` checks `role_id === 1` on session, never from request body — `middlewares/authMiddleware.js:46-49`
22. **Secrets validation:** `envValidator.js` checks SESSION_SECRET, DB_PASSWORD, Tilopay keys, port, URL, upload dirs — `config/envValidator.js`
23. **Production error suppression:** 500 handler suppresses error details in production — `app.js:696-708`
24. **Graceful shutdown:** `SIGTERM`/`SIGINT` handlers close server, DB pool, session store — `app.js:751-782`

---

## Railway Checks Required

The following items cannot be verified from code alone and require checking in the live Railway environment:

1. **Railway TLS termination:** Confirm Railway terminates TLS and passes HTTPS to the app on a private port. Verify `secure: true` on the session cookie is actually enforced (check browser DevTools).
2. **Railway proxy layers:** Confirm the number of proxies between Railway's public endpoint and the app container. Adjust `trust proxy` from `1` if more than one proxy exists.
3. **Railway environment variables:** Verify all secrets are set via Railway dashboard, not committed to `.env`:
   - `SESSION_SECRET` (must be long, random, non-default)
   - `DB_PASSWORD`
   - `TILOPAY_API_KEY`, `TILOPAY_API_USER`, `TILOPAY_API_PASSWORD` (if enabled)
   - `MAIL_HOST`, `MAIL_USER`, `MAIL_PASSWORD`
   - `EMAIL_VERIFICATION_EXPIRES_MINUTES`, `PASSWORD_RESET_EXPIRES_MINUTES`
   - `APP_URL` (must be the public HTTPS URL)
4. **Railway log access:** Confirm who can view Railway logs (tokens appear in URL query params). Restrict log access.
5. **Database external access:** Confirm MySQL is only accessible from within Railway private network, not exposed publicly.
6. **Railway persistent volume:** Confirm `UPLOAD_PUBLIC_DIR` and `UPLOAD_PROOFS_DIR` point to a Railway volume with adequate capacity.

---

## Prioritized Remediation Plan

### Phase 16B: Authentication and Sessions

| Priority | Finding | Action |
|----------|---------|--------|
| High | S-003 | ✅ **DONE** — Added `registerLimiter` (5 req / 30 min) on `POST /register` |
| High | S-004 | ✅ **DONE** — Added `resetPasswordLimiter` (10 req / 30 min) on `POST /reset-password`; updated `forgotLimiter` to 5/30min, `resendLimiter` to 3/30min |
| Medium | S-007 | Reduce `authLimiter` to 30/15min, add separate limiters per route |
| Medium | S-009 | Raise register password minimum to 8 characters |
| Low | N/A | (Optional) Single-session-per-admin enforcement |
| Medium | S-012, S-013 | (Optional) POST-based token verification; add `Referrer-Policy` header |

### Phase 16C: Forms, Uploads, Validation, Authorization

| Priority | Finding | Action |
|----------|---------|--------|
| Low | S-018 | ✅ **DONE** — Safe JSON serialization for inline `<script type="application/json">` blocks via `safeJsonScript()` helper. Applied to public homepage `services-cms-data`. |
| Low | S-019 | ✅ **DONE** — Added MIME type filter (`selectorFileFilter`) to `selectorUploadMulter` in adminPageRoutes. |
| — | Authorization | ✅ **VERIFIED** — All CMS admin routes protected by `isAuthenticated + isAdmin + requireCapability()`. Account routes verify ownership via `req.session.user.id`. No IDOR found. |
| — | CSRF | ✅ **VERIFIED** — All state-changing POST routes covered by global CSRF (after line 411) or explicit per-route CSRF. Admin order routes protected. Webhook exemption narrowly scoped. |
| — | Validation | ✅ **VERIFIED** — All sort fields use allowlists. All IDs parsed via `parsePositiveId()`. Pagination limits bounded. Enum values whitelisted. SQL queries parameterized. |
| — | Uploads | ✅ **VERIFIED** — GLB validates magic bytes, version, total length, JSON chunk. Images pass through Sharp. MIME types, file sizes, directory containment all enforced. Path traversal prevented. |

#### Phase 16C: Summary of Verified Controls

| Control | Status | Details |
|---------|--------|---------|
| Authorization | PROTECTED | Admin: `isAuthenticated + isAdmin + requireCapability()`. Customer: `WHERE id = ? AND user_id = ?` ownership checks. Guest: reference+email validation. |
| CSRF coverage | PROTECTED | Every state-changing POST route covered. Multipart routes handle CSRF after multer. AJAX endpoints include CSRF token. Logout CSRF-protected. |
| Input validation | STRONG | All sort/order fields use allowlists. IDs parsed as safe positive integers. Pagination bounded. Enums whitelisted. Prototype pollution keys rejected by validators. SQL queries parameterized. |
| Output safety | PROTECTED | All `<%-` uses are trusted includes, pre-escaped JSON-LD, or `safeJsonScript()` output. Redirect URLs validated via regex allowlist. Unsafe URL schemes rejected. |
| Upload security | STRONG | MIME+extension+magic-byte validation. Sharp pixel/dimension limits. GLB header validation. Server-generated filenames. Path traversal prevented. `wx` flag (no overwrite). |
| State transitions | PROTECTED | Publishing uses capability-based authorization. Orders use transactional state changes. CMS revisions cannot alter protected system fields. |

### Phase 16D: Production Headers, Secrets, Logging, Dependencies, Deployment

| Priority | Finding | Action |
|----------|---------|--------|
| Medium | S-002 | Replace `'unsafe-inline'` in `style-src` with nonce-based style loading |
| Medium | S-008 | Add `checkoutLimiter` (10/15min) on `POST /checkout` |
| Low | S-017 | Reduce `MAX_IMAGE_PIXELS` to 50M |
| Medium | S-010 | Explicitly configure HSTS, Referrer-Policy, Permissions-Policy in helmet |
| Medium | S-007 | Reduce `authLimiter` to 30/15min |
| Medium | S-009 | Raise register password minimum to 8 characters |
| Low | S-014 | Adjust `trust proxy` based on Railway proxy count |
| Low | S-015 | Serve only specific vendor files, not entire `node_modules` packages |
| Low | S-016 | Gate all `console.error` paths with environment checks |
| Low | S-006 | Document SVG re-enablement requirements |
| Informational | S-020 | Verify Tilopay webhook signature mechanism in production |
| — | Railway | Verify real client IP and proxy hop count in production (trust proxy = 1)

---

## Tests Executed

Focused security-related tests run: `cms-csp.test.js`, `navbar-favicon-regression.test.js`, `analytics-consent.test.js`, `cms-media.test.js`

```
tests:  97
suites: 16
pass:   97
fail:   0
```

All existing security tests pass, confirming:
- CSP is correctly configured (nonce, script-src, connect-src, img-src for analytics)
- Admin views have no inline scripts or event handlers
- Editor scripts are external and syntactically valid
- Media uploads pass content validation, dimension limits, MIME checks
- Media path traversal is prevented
- CSRF protection is in place for admin routes

---

## Recommended First Remediation Task

**Fix S-005: JSON-LD escape function.** This is the most exploitable confirmed vulnerability. A stored XSS via JSON-LD injection into product descriptions could affect all store visitors. The fix is a one-line change in `config/jsonLdHelper.js`:

```javascript
function jsonLdScript(ld) {
  const json = JSON.stringify(ld, (key, value) => {
    if (typeof value === 'string') return escapeJsonLd(value);
    return value;
  });
  return `<script type="application/ld+json">${json}</script>`;
}
```

This should be the first item addressed in Phase 16C.

---

## Phase 16D Remediation Report

**Date:** 2026-07-27

### Remediated Findings

| Finding | Status | Description |
|---------|--------|-------------|
| S-010 (Medium) | ✅ REMEDIATED | HSTS, Referrer-Policy, Permissions-Policy configured. HSTS (2-year, includeSubDomains) enabled in production. Referrer-Policy: `strict-origin-when-cross-origin`. Permissions-Policy restricts camera, microphone, geolocation, payment, USB, VR, sensors. |
| S-016 (Low) | ✅ REMEDIATED | All `console.error` paths in app.js are gated with environment checks — production suppresses raw error objects to `console.error`. |

### New Hardening Controls

| Control | Status | Details |
|---------|--------|---------|
| Security headers | STRONG | `X-Powered-By` removed. `Cross-Origin-Resource-Policy: same-origin` set. `font-src` and `media-src` added to CSP. |
| Environment validation | STRONG | DB_PASSWORD required for all remote hosts. APP_URL must be HTTPS in production. Mail credentials validated when MAIL_ENABLED=true. GA_MEASUREMENT_ID format validated. Railway volume warnings. |
| Logging and error redaction | PROTECTED | `config/safeLogging.js` provides `redactSensitive()` — strips passwords, tokens, secrets, cookies, auth headers, CSRF tokens from logged objects. `safeServerError()` for JSON error responses without stack traces/paths. |
| Health / Readiness | STRONG | `/health` returns minimal liveness (no auth). `/ready` probes database. Both safe — no internal paths, credentials, table names. |
| Proxy diagnostic | PROTECTED | `GET /admin/proxy-diagnostic` — admin-only, disabled by default (`PROXY_DIAGNOSTIC_ENABLED=true` to enable). Returns only `trust_proxy`, `ip`, `protocol`, `secure`, `proxy_count` — no headers, cookies, or session data. |
| Graceful shutdown | CONFIRMED | SIGTERM/SIGINT stop accepting requests, close server/database/session store with bounded 10s timeout. Uncaught exceptions/unhandled rejections terminate safely. No credentials in shutdown logs. |
| Dependencies | AUDITED | `npm audit` reports 5 High: all from ejs transitive deps (jake/filelist/minimatch/brace-expansion). Fix requires ejs 6.x (major bump). **Deferred to a separate dependency update phase.** These are build-toolchain vulnerabilities, not runtime. |

### Remaining (Phase 16D Findings Not Yet Addressed)

| Finding | Status | Reason |
|---------|--------|--------|
| S-002 (Medium) | ⚠️ DEFERRED | `style-src 'unsafe-inline'` — requires externalising or noncing all CMS inline styles. No confirmed CSS injection vector in current templates. Documented as hardening opportunity. |
| S-008 (Medium) | ⚠️ DEFERRED | `checkoutLimiter` — requires checking whether checkout route exists and is in active use before adding. |
| S-007 (Medium) | ⚠️ DEFERRED | `authLimiter` 100/15min still too permissive. Reduce to 30/15min in a focused rate-limit pass. |
| S-009 (Medium) | ⚠️ DEFERRED | Register password minimum — raises UX question; requires monitoring current registrations first. |
| S-017 (Low) | ⚠️ DEFERRED | `MAX_IMAGE_PIXELS` to 50M — requires verifying no current images exceed this. |
| S-014 (Low) | ⚠️ DEFERRED | `trust proxy` adjustment — keep at 1 until Railway production evidence proves otherwise. |
| S-015 (Low) | ⚠️ DEFERRED | Vendor file serving — restrict to specific files rather than entire `node_modules` packages. |
| S-006 (Low) | ⚠️ DEFERRED | SVG re-enablement requirements — document for future feature request. |

### Updated Finding Counts

| Severity | Before Phase 16D | After Phase 16D |
|----------|-----------------|-----------------|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 6 | 4 (S-007, S-008, S-009 deferred; S-002 deferred) |
| Low | 8 | 5 (S-017, S-014, S-015, S-006 deferred) |
| Informational | 2 | 1 (S-020 remains for production verification) |
| **Remediated (cumulative)** | 4 | **6** (S-010, S-016 added) |

### Files Modified in Phase 16D

| File | Change |
|------|--------|
| `app.js` | Enhanced Helmet config with HSTS, CORP. `app.disable('x-powered-by')`. Custom Permissions-Policy and Referrer-Policy middleware. `/admin/proxy-diagnostic` route (admin-only, disabled by default). `font-src`/`media-src` CSP directives. |
| `config/envValidator.js` | DB_PASSWORD now required for all remote hosts. APP_URL must be HTTPS in production. Mail credentials validated (MAIL_ENABLED gate). GA_MEASUREMENT_ID format validation. Railway volume warning. |
| `config/safeLogging.js` | **New file.** `redactSensitive()` strips passwords, tokens, secrets, cookies, auth headers, CSRF tokens. `safeServerError()` for minimal JSON error responses. |
| `tests/security-phase16d.test.js` | **New file.** 30 tests covering security headers, CSP nonce, X-Powered-By removal, Permissions-Policy, CORP, health/readiness, proxy diagnostic (disabled), error responses, environment validation, safe logging, graceful shutdown, trust proxy, dependency audit. |

### Dependency Audit

```
npm audit — 5 high (all from ejs/jake transitive dev dependencies)
Fix available: ejs@6.0.1 (major version bump — deferred)
No runtime vulnerabilities affecting application usage.
```

