# Production Deployment — NinjaLabCR / NLSite

## Stack
- Node.js, Express, EJS, MySQL/MariaDB
- Railway deployment

## Deployment Sequence

```bash
# 1. Install production dependencies
npm ci

# 2. Run idempotent migrations (safe to repeat)
npm run migrate

# 3. Start the server
npm start
```

On Railway, set the start command to `npm start` and run `npm run migrate` once before the first deploy (or via Railway's CLI/Run Command).

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
Run `npm run migrate` after initial database creation.
All migrations are idempotent (safe to run multiple times).

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

### Migration Rollback
Migrations in this project are additive (ALTER TABLE ADD COLUMN, CREATE TABLE IF NOT EXISTS).
Rollback requires manual SQL or restoring from backup. No automatic rollback is provided.
