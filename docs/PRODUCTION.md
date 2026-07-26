# Production Deployment — NinjaLabCR / NLSite

## Stack
- Node.js, Express, EJS, MySQL/MariaDB
- Railway deployment

## Deployment Sequence

```bash
# 1. Install production dependencies
npm ci

# 2. Start the server (migrations run automatically in production)
npm start
```

The `npm start` command now automatically runs `npm run migrate:deploy` before starting the HTTP server in production (`NODE_ENV=production`). In development, migrations are skipped and must be run manually via `npm run migrate`.

**How it works:**
- `package.json` prestart hook (`node scripts/prestart.js`) runs before `node app.js`.
- In production: calls `migrate-deploy.js` which acquires a MySQL advisory lock, runs pending migrations, records them in `schema_migrations`, and releases the lock.
- If any migration fails, the process exits non-zero, preventing the app from starting.
- In development: prestart exits immediately (no-op).

### Railway Start Command

On Railway, the start command remains:
```
npm start
```

No Railway-specific configuration changes are needed. The `prestart` script handles everything.

### Manual Migration (development)

```bash
# Run all idempotent migrations (local dev)
npm run migrate

# Run production-safe deploy migrations
npm run migrate:deploy
```

## Migration Safety

### Advisory Lock
- MySQL advisory lock (`GET_LOCK('migrate_deploy', 30)`) serialises concurrent instances.
- If another instance is already migrating, the second one exits with code 2 (LOCKED).
- The lock is always released in a `finally` block.

### Checksum Verification
- Each migration's SHA-256 checksum is recorded in `schema_migrations` on first execution.
- If a previously-executed migration's source file changes, the deployment fails with a clear error and the old/new checksums.
- This prevents silently applying modified migrations to production.

### Migration Tracking
- The `schema_migrations` table records: name, checksum, executed_at, duration_ms, status (ok/failed), error message.
- Each migration runs only once. Already-executed migrations are skipped.
- Failed migrations are recorded with error details.

### Failure Behavior
- If any migration fails, the entire deployment aborts.
- The application WILL NOT start until the migration is fixed and deployment is retried.
- No partial state: previously-succeeded migrations are NOT rolled back. Fix the failing migration and re-deploy.

### Rollback / Recovery
- Migrations are additive (ALTER TABLE ADD COLUMN, CREATE TABLE IF NOT EXISTS). No automatic rollback.
- Recovery options:
  1. Fix the failing migration and re-deploy.
  2. Restore from MySQL backup (`PRODUCTION.md` backup section).
  3. Manually remove the failed migration's record from `schema_migrations` if it was a false alarm.
- To skip a checksum change intentionally, delete the matching row from `schema_migrations` so the migration re-runs. All migrations are idempotent.

### Concurrency
- Two Railway instances starting simultaneously cannot both run migrations.
- The advisory lock serialises them: one wins, the other waits (up to 30s) or skips gracefully.
- Survives process crashes: MySQL releases the lock when the session ends.

## Railway Configuration

### Start Command
```
npm start
```

### Health Check
```
/health
```
Timeout: 30s. Restart policy: ON_FAILURE (max 3 retries).

### Readiness Path
```
/ready
```
Returns 200 when DB is reachable, 503 otherwise. Not used as Railway's health check by default.

### Persistent Volume

**Railway volume mount:** `/app/storage`

Required environment variables for uploads on Railway:

```
UPLOAD_PUBLIC_DIR=/app/storage/public-uploads
UPLOAD_PROOFS_DIR=/app/storage/payment-proofs
```

Both directories are created automatically at startup. The volume must be mounted before the first deploy.

**What lives on the volume:**
- Product images (public, served at `/uploads/`)
- Gallery images and thumbnails (public)
- Category hero images (public)
- Avatar images (public)
- CMS media library files (public, served at `/uploads/media/…`) — `media_assets` table holds metadata only; binary files on volume must be backed up together with DB to keep rows and files synchronized
- Payment proof files (private, NOT statically served)

**What does NOT live on the volume:**
- Session data (stored in MySQL)
- Database (MySQL plugin or external)

### Required Environment Variables

**Critical (production):**
- `NODE_ENV=production`
- `PORT` — Railway assigns automatically
- `SESSION_SECRET` — Long random string (≥32 chars)
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `APP_URL` — Public site URL (e.g. `https://cliente.up.railway.app`)

**Recommended for production:**
- `UPLOAD_PUBLIC_DIR=/app/storage/public-uploads`
- `UPLOAD_PROOFS_DIR=/app/storage/payment-proofs`

**Optional:**
- `TILOPAY_*` — Only when payment integration is active
- `SMTP_*` — Email delivery
- `WHATSAPP_NUMBER` — Contact number
- `SESSION_MAX_AGE_HOURS` — Default 8

### Database
Use Railway MySQL plugin or external MySQL/MariaDB.
Migrations run automatically on every deploy in production. No manual step required.
The `schema_migrations` table tracks which migrations have been applied.
All migrations are idempotent (safe to run multiple times). Each migration creates tables with `IF NOT EXISTS`, seeds data only when tables are empty, and never overwrites existing CMS content.

### CMS Publication & Cache
- Published content is cached in-memory per namespace (`home:showcase`, `home:hero`, `home:services`, `home:navbar`).
- Publishing any section invalidates the corresponding cache namespace and the aggregate home page cache.
- Publication batches (`publication_batches`, `publication_batch_items`) track atomic multi-section publishes with actor attribution.
- Content revisions (`content_revisions`) store snapshots before every publish; the history browser and version comparison work against these snapshots.
- Safe restoration reads a revision snapshot, marks all current items as archived, and inserts restored versions.

### Cache Invalidation on Deploy
A restart clears the in-memory cache naturally. Railway's rolling restart will show stale published content briefly (under 1 second). No external cache flush is needed.

### Graceful Shutdown
The app handles SIGTERM correctly: stops accepting requests, closes HTTP server, closes DB pool, closes session store. 10-second timeout.

### Startup Failure
Production startup aborts (exits non-zero) when:
- Environment validation fails (missing secrets).
- The primary database is unreachable (5-second retry loop).
- The session store cannot connect.

## Backup & Recovery

### MySQL Backup
```bash
mysqldump -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME > backup_$(date +%Y%m%d).sql
```

### MySQL Restore
```bash
mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME < backup_YYYYMMDD.sql
```

### Upload Volume Backup
The entire mounted volume (`/app/storage`) must be backed up independently of the database.
On Railway, download the volume snapshot or use Railway's backup features.

### Frequency
- Database: Daily automated backup recommended.
- Uploads: Weekly or per-deploy snapshot.
- Retention: Keep at least 7 days of daily backups.

### Test Restore
1. Restore MySQL dump to a separate test database.
2. Restore volume contents to a test environment.
3. Configure test env vars pointing to restored paths.
4. Verify admin dashboard, product images, and order detail pages load correctly.

### Not Recoverable Without Upload Backups
- Payment proof files (images/PDFs uploaded by customers).
- Product images.
- Category hero images.
- Gallery media.
- CMS media library files under `<UPLOAD_PUBLIC_DIR>/media` (the database only stores metadata, never the binaries; back up the volume and the database together so `media_assets` rows and files stay synchronized).

### Migration Rollback
Migrations in this project are additive (ALTER TABLE ADD COLUMN, CREATE TABLE IF NOT EXISTS).
Rollback requires manual SQL or restoring from backup. No automatic rollback is provided.
