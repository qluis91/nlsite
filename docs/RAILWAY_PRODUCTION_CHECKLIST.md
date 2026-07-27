# Railway Production Checklist — nlSite

**Last updated:** 2026-07-27 (Phase 16D)

## Environment Variables (Railway Dashboard)

| Variable | Required | Notes |
|----------|----------|-------|
| `NODE_ENV` | YES | Set to `production` |
| `PORT` | YES | Railway sets this automatically |
| `SESSION_SECRET` | YES | Long random string (min 32 chars). Never use default. |
| `APP_URL` | YES | Public HTTPS URL (e.g., `https://www.misitio.com`) |
| `DB_HOST` | YES | Railway private network hostname |
| `DB_PORT` | YES | Usually `3306` |
| `DB_USER` | YES | Database user |
| `DB_PASSWORD` | YES | Database password |
| `DB_NAME` | YES | Database name |
| `UPLOAD_PUBLIC_DIR` | RECOMMENDED | Path on Railway volume (e.g., `/data/uploads/public`) |
| `UPLOAD_PROOFS_DIR` | RECOMMENDED | Path on Railway volume (e.g., `/data/uploads/proofs`) |
| `MAIL_ENABLED` | Optional | Set `true` to enable email |
| `SMTP_HOST` | If mail enabled | SMTP server |
| `SMTP_USER` | If mail enabled | SMTP username |
| `SMTP_PASSWORD` | If mail enabled | SMTP password |
| `TILOPAY_ENABLED` | Optional | Set `true` to enable Tilopay |
| `TILOPAY_API_KEY` | If Tilopay enabled | API key |
| `TILOPAY_API_USER` | If Tilopay enabled | API user |
| `TILOPAY_API_PASSWORD` | If Tilopay enabled | API password |
| `TILOPAY_PUBLIC_BASE_URL` | If Tilopay enabled | Public base URL |
| `GA_MEASUREMENT_ID` | Optional | Format: `G-XXXXXXXXXX` |

Do NOT set these in production (debug/development only):
- `PROXY_DIAGNOSTIC_ENABLED` — only enable temporarily for IP verification

## Startup / Migration Behavior

1. **Prestart:** `npm run prestart` → runs `node scripts/prestart.js`
2. In production, prestart calls `scripts/migrate-deploy.js` which:
   - Acquires MySQL advisory lock (`GET_LOCK`)
   - Creates `schema_migrations` table if missing
   - Runs pending migrations, checksums each
   - Releases lock in `finally`
3. If migrations fail, app does NOT start (exit code 1)
4. If another instance holds the lock, deploy fails safely (exit code 2)
5. Server listens only after session store + DB readiness confirmed (5s timeout)

## Health / Readiness

- **`GET /health`** — liveness probe, returns `{"status":"ok"}`. No auth required.
- **`GET /ready`** — readiness probe, probes DB, returns 200 or 503. No auth required.

Railway health check config:
- Health check path: `/health`
- No authentication

## Proxy / IP Verification

1. Temporarily set `PROXY_DIAGNOSTIC_ENABLED=true` in Railway
2. Visit `/admin/proxy-diagnostic` as an authenticated admin
3. Verify:
   - `trust_proxy` = 1
   - `ip` is the real client IP (not 127.0.0.1)
   - `secure` = true
   - `protocol` = "https"
   - `proxy_count` = expected count (usually 1)
4. If `proxy_count` > 1, adjust `trust proxy` in app.js
5. **Immediately disable:** remove `PROXY_DIAGNOSTIC_ENABLED` or set to `false`

## Secure Cookie Verification

1. Open browser DevTools → Application → Cookies
2. For `connect.sid` cookie:
   - [ ] `HttpOnly` = ✓
   - [ ] `Secure` = ✓
   - [ ] `SameSite` = Lax
   - [ ] `Path` = /
3. Verify cookie is NOT sent over HTTP

## Database Isolation / TLS

- [ ] MySQL is only accessible from within Railway private network
- [ ] No public IP or port exposed for MySQL
- [ ] If using TLS: `DB_SSL=true` variable set, certificates configured
- [ ] Database user has only required privileges (no GRANT ALL unless needed)

## Persistent Upload Storage

- [ ] Railway volume attached to service
- [ ] `UPLOAD_PUBLIC_DIR` points to volume path
- [ ] `UPLOAD_PROOFS_DIR` points to volume path
- [ ] Volume has adequate capacity for expected uploads
- [ ] Upload directories exist and are writable
- [ ] Uploads survive restarts (test with a temporary file upload)

## Log Access

- [ ] Railway logs restricted to team members only
- [ ] No secrets/tokens in startup logs
- [ ] Session data, passwords, tokens never logged
- [ ] Error logs in production do not include stack traces

## Rollback Procedure

1. If deployment fails:
   - Check Railway logs for migration errors
   - If migration failed before application start, previous version is still running
   - Roll back code to previous commit and redeploy
2. If a migration ran but caused issues:
   - The migration is recorded in `schema_migrations`
   - Roll back application code
   - Manually revert the migration's database changes
   - Delete the migration's row from `schema_migrations`
3. If advisory lock is stuck:
   - Connect to MySQL and run: `SELECT RELEASE_LOCK('nl_migration_lock')`
   - Redeploy

## Verification After Deploy

Run these checks after each production deployment:

```bash
# 1. Health check
curl -s https://YOUR_APP.railway.app/health | jq .
# Expected: {"status":"ok"}

# 2. Readiness check
curl -s https://YOUR_APP.railway.app/ready | jq .
# Expected: {"status":"ok"}

# 3. Security headers
curl -sI https://YOUR_APP.railway.app/ | grep -i 'content-security-policy\|referrer-policy\|strict-transport-security\|x-content-type-options\|permissions-policy'
# Expected: All headers present

# 4. Homepage loads
curl -s https://YOUR_APP.railway.app/ | grep -o '<title>.*</title>'
# Expected: Site title in response
```

## Unresolved Phase 16D Items (Live Verification)

| Item | Status |
|------|--------|
| `style-src 'unsafe-inline'` hardening | Deferred — no CSS injection vector found |
| `checkoutLimiter` | Requires checking checkout route activity |
| `trust proxy` hop count | Verify with proxy diagnostic when enabled |
| SVG re-enablement | Document requirements for future |
| Vendor file serving restrictions | Deferred — low risk |
