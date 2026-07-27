/**
 * Phase 16D — Media diagnostics endpoint tests.
 * Run: node --test tests/media-diagnostic.test.js
 */
const { after, describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

after(async () => {
  const dbPath = require.resolve('../config/db');
  if (require.cache[dbPath]) {
    const db = require('../config/db');
    await db.query('SELECT 1');
    await db.end();
  }
});

// ──── Route registration ────

describe('Media diagnostic — route', () => {
  it('app.js has /admin/media-diagnostic route', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(code.includes('/admin/media-diagnostic'), 'Should have media-diagnostic route');
  });

  it('route requires isAuthenticated + isAdmin', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const routeIdx = code.indexOf("'/admin/media-diagnostic'");
    // isAuthenticated and isAdmin are AFTER the route path in the middleware chain
    const section = code.substring(routeIdx, routeIdx + 100);
    assert.ok(section.includes('isAuthenticated'), 'Should require authentication');
    assert.ok(section.includes('isAdmin'), 'Should require admin role');
  });

  it('route is disabled by default (MEDIA_DIAGNOSTIC_ENABLED)', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const section = code.substring(
      code.indexOf('media-diagnostic') - 30,
      code.indexOf('media-diagnostic') + 300
    );
    assert.ok(section.includes('MEDIA_DIAGNOSTIC_ENABLED'), 'Should check MEDIA_DIAGNOSTIC_ENABLED');
    assert.ok(section.includes("!== 'true'"), 'Should return 404 when not enabled');
  });

  it('route is GET only', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const routeIdx = code.indexOf("'/admin/media-diagnostic'");
    const section = code.substring(Math.max(0, routeIdx - 15), routeIdx);
    assert.ok(section.includes('app.get'), 'Should be GET route');
    assert.ok(!section.includes('app.post'), 'Should NOT be POST route');
  });
});

// ──── Controller existence ────

describe('Media diagnostic — controller', () => {
  it('mediaDiagnosticController exists', () => {
    const exists = fs.existsSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'));
    assert.ok(exists, 'Controller file should exist');
  });

  it('exports mediaDiagnostic function', () => {
    const controller = require('../controllers/mediaDiagnosticController');
    assert.strictEqual(typeof controller.mediaDiagnostic, 'function', 'Should export mediaDiagnostic');
  });
});

// ──── Safety: no credentials exposed ────

describe('Media diagnostic — no credentials', () => {
  it('controller never reads DB_PASSWORD', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(!code.includes('DB_PASSWORD'), 'Should not reference DB_PASSWORD');
    assert.ok(!code.includes('DB_USER'), 'Should not reference DB_USER');
    assert.ok(!code.includes('DB_HOST'), 'Should not reference DB_HOST');
  });

  it('controller never reads SESSION_SECRET', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(!code.includes('SESSION_SECRET'), 'Should not reference SESSION_SECRET');
  });

  it('controller never reads SMTP or Resend credentials', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(!code.includes('SMTP_'), 'Should not reference SMTP vars');
    assert.ok(!code.includes('RESEND_'), 'Should not reference RESEND vars');
  });

  it('controller never reads TILOPAY credentials', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(!code.includes('TILOPAY_'), 'Should not reference TILOPAY vars');
  });

  it('view never references env directly', () => {
    const code = fs.readFileSync(
      path.join(__dirname, '..', 'views', 'pages', 'admin', 'diagnostics', 'media.ejs'),
      'utf8'
    );
    assert.ok(!code.includes('process.env'), 'View should not reference process.env');
  });

  it('controller does not expose absolute file paths of media', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    // Find the res.render call and verify storage_path is not exposed in diagnostics data
    const renderIdx = code.indexOf('res.render');
    const renderBlock = code.substring(renderIdx, code.indexOf('});', renderIdx) + 2);
    assert.ok(!renderBlock.includes('storage_path'), 'Should not include storage_path in render data');
    assert.ok(!renderBlock.includes('absPath') || renderBlock.includes("'absPath'") === false, 'Should not expose absolute paths');
  });

  it('controller does not read request headers or cookies', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(!code.includes('req.headers'), 'Should not access headers');
    assert.ok(!code.includes('req.cookies'), 'Should not access cookies');
  });
});

// ──── Data exposed ────

describe('Media diagnostic — data exposed', () => {
  it('controller reads APP_VERSION', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes('APP_VERSION'), 'Should read APP_VERSION');
  });

  it('controller reads UPLOAD_PUBLIC_DIR', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes('UPLOAD_PUBLIC_DIR'), 'Should read UPLOAD_PUBLIC_DIR');
  });

  it('controller checks directory existence', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes("fs.existsSync") || code.includes('fs.accessSync'), 'Should check directory existence');
  });

  it('controller checks directory writability', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes('W_OK'), 'Should check writability');
  });

  it('controller checks permanent-delete route registration', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes('adminPageRoutes') || code.includes('permanent-delete'), 'Should check route registration');
  });

  it('controller checks admin MEDIA_DELETE capability', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes('MEDIA_DELETE') || code.includes('hasCapability'), 'Should check capability');
  });

  it('controller queries active and archived media counts', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes("status = 'active'"), 'Should query active count');
    assert.ok(code.includes("status = 'archived'"), 'Should query archived count');
  });

  it('controller supports file check via public_id query param', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes('public_id'), 'Should accept public_id query param');
    assert.ok(code.includes('storedPathExists'), 'Should use storedPathExists for file check');
    assert.ok(code.includes('UUID_PATTERN'), 'Should validate UUID format');
  });

  it('controller sanitizes upload directory for user paths', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes('sanitizeDir'), 'Should have sanitizeDir function');
  });

  it('controller checks upload mount matches configured directory', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes('uploadsMountedMatches'), 'Should verify mount matches directory');
  });
});

// ──── View template ────

describe('Media diagnostic — view', () => {
  it('template renders all diagnostic sections', () => {
    const code = fs.readFileSync(
      path.join(__dirname, '..', 'views', 'pages', 'admin', 'diagnostics', 'media.ejs'),
      'utf8'
    );
    assert.ok(code.includes('APP_VERSION'), 'Should display version');
    assert.ok(code.includes('upload_dir_exists'), 'Should display dir existence');
    assert.ok(code.includes('upload_dir_writable'), 'Should display writability');
    assert.ok(code.includes('uploads_mount_matches'), 'Should display mount match');
    assert.ok(code.includes('permanent_delete_route'), 'Should display route status');
    assert.ok(code.includes('admin_has_media_delete'), 'Should display capability');
    assert.ok(code.includes('active_media_count'), 'Should display active count');
    assert.ok(code.includes('archived_media_count'), 'Should display archived count');
  });

  it('template has file check form', () => {
    const code = fs.readFileSync(
      path.join(__dirname, '..', 'views', 'pages', 'admin', 'diagnostics', 'media.ejs'),
      'utf8'
    );
    assert.ok(code.includes('name="public_id"'), 'Should have public_id input');
    assert.ok(code.includes('method="GET"'), 'Should use GET for form');
    assert.ok(code.includes('action="/admin/media-diagnostic"'), 'Should post back to diagnostic');
  });

  it('template handles missing file_check gracefully', () => {
    const code = fs.readFileSync(
      path.join(__dirname, '..', 'views', 'pages', 'admin', 'diagnostics', 'media.ejs'),
      'utf8'
    );
    assert.ok(code.includes('Ingresa un'), 'Should show placeholder when no file check');
  });

  it('template uses admin layout', () => {
    const code = fs.readFileSync(
      path.join(__dirname, '..', 'views', 'pages', 'admin', 'diagnostics', 'media.ejs'),
      'utf8'
    );
    assert.ok(code.includes('{%') || code.includes('<%') || code.includes('layout'), 'Should use layout');
  });

  it('template shows warning banner about temporary nature', () => {
    const code = fs.readFileSync(
      path.join(__dirname, '..', 'views', 'pages', 'admin', 'diagnostics', 'media.ejs'),
      'utf8'
    );
    assert.ok(code.includes('MEDIA_DIAGNOSTIC_ENABLED'), 'Should mention the flag');
    assert.ok(code.includes('desactivar') || code.includes('Desactivar') || code.includes('desactívala') || code.includes('Desactívala'), 'Should warn to disable');
  });
});

// ──── APP_VERSION env var ────

describe('Media diagnostic — APP_VERSION', () => {
  it('.env.example documents APP_VERSION', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    assert.ok(code.includes('APP_VERSION'), 'Should document APP_VERSION');
  });
});

// ──── MEDIA_DIAGNOSTIC_ENABLED env var ────

describe('Media diagnostic — MEDIA_DIAGNOSTIC_ENABLED', () => {
  it('.env.example documents MEDIA_DIAGNOSTIC_ENABLED', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    assert.ok(code.includes('MEDIA_DIAGNOSTIC_ENABLED'), 'Should document MEDIA_DIAGNOSTIC_ENABLED');
  });

  it('controller respects MEDIA_DIAGNOSTIC_ENABLED !== true', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(code.includes("MEDIA_DIAGNOSTIC_ENABLED !== 'true'"), 'Should check for exact true');
  });
});

// ──── No modification of media ────

describe('Media diagnostic — read-only', () => {
  it('controller does NOT contain INSERT/UPDATE/DELETE for media_assets', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(!code.includes('INSERT INTO media_assets'), 'Should not insert media');
    assert.ok(!code.includes('UPDATE media_assets'), 'Should not update media');
    assert.ok(!code.includes('DELETE FROM media_assets'), 'Should not delete media');
  });

  it('controller does NOT call unlink or remove files', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    assert.ok(!code.includes('unlink'), 'Should not delete files');
    assert.ok(!code.includes('removeStoredPaths'), 'Should not call removeStoredPaths');
  });

  it('controller uses SELECT queries only', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'mediaDiagnosticController.js'), 'utf8');
    // Check for SQL-level write operations (not variable names or column names)
    const insertSql = code.includes('INSERT INTO') || code.includes('INSERT ');
    const updateSql = /\bUPDATE\s+\w+/.test(code);
    const deleteFrom = code.includes('DELETE FROM');
    assert.strictEqual(insertSql, false, 'Should have no INSERT queries');
    assert.strictEqual(updateSql, false, 'Should have no UPDATE queries');
    assert.strictEqual(deleteFrom, false, 'Should have no DELETE FROM queries');
    assert.ok(code.includes('SELECT'), 'Should have SELECT for data queries');
  });
});
