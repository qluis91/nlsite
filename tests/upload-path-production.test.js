/**
 * Phase 16D — Upload path resolution, static serving, and Railway volume tests.
 * Run: node --test tests/upload-path-production.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE = { hostname: 'localhost', port: 3000 };

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: BASE.hostname, port: BASE.port, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

// ──── UPLOAD_PUBLIC and UPLOAD_PROOFS resolution ────

describe('Upload — path resolution', () => {
  it('UPLOAD_PUBLIC resolves from UPLOAD_PUBLIC_DIR env var', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(appCode.includes('process.env.UPLOAD_PUBLIC_DIR'), 'UPLOAD_PUBLIC should read env var');
  });

  it('UPLOAD_PROOFS resolves from UPLOAD_PROOFS_DIR env var', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(appCode.includes('process.env.UPLOAD_PROOFS_DIR'), 'UPLOAD_PROOFS should read env var');
  });

  it('cmsOptions UPLOAD_PUBLIC_ROOT reads UPLOAD_PUBLIC_DIR', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'cmsOptions.js'), 'utf8');
    assert.ok(code.includes('process.env.UPLOAD_PUBLIC_DIR'), 'cmsOptions should read UPLOAD_PUBLIC_DIR');
  });

  it('cmsOptions MEDIA_ROOT is under UPLOAD_PUBLIC_ROOT/media', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'cmsOptions.js'), 'utf8');
    const mediaRootLine = code.match(/MEDIA_ROOT\s*=\s*[^;]+/);
    assert.ok(mediaRootLine, 'MEDIA_ROOT should be defined');
    assert.ok(mediaRootLine[0].includes("path.join(UPLOAD_PUBLIC_ROOT, 'media')"), 'MEDIA_ROOT should be under UPLOAD_PUBLIC_ROOT/media');
  });

  it('MEDIA_PUBLIC_PREFIX is relative /uploads/media/', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'cmsOptions.js'), 'utf8');
    assert.ok(code.includes("MEDIA_PUBLIC_PREFIX = '/uploads/media/'"), 'Public prefix should be relative');
  });

  it('mediaStorageService publicUrlFor is relative', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'mediaStorageService.js'), 'utf8');
    assert.ok(code.includes('MEDIA_PUBLIC_PREFIX'), 'Should use MEDIA_PUBLIC_PREFIX');
    assert.ok(!code.includes('process.env.APP_URL'), 'Should NOT embed APP_URL in media URLs');
  });
});

// ──── Single /uploads mount ────

describe('Upload — single static mount', () => {
  it('app.js mounts /uploads exactly once', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const uploadsMounts = (appCode.match(/app\.use\('\/uploads'/g) || []).length;
    assert.strictEqual(uploadsMounts, 1, 'Should mount /uploads exactly once');
  });

  it('/uploads mount uses UPLOAD_PUBLIC variable', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    // Find the /uploads mount block
    const mountIdx = appCode.indexOf("app.use('/uploads'");
    const mountBlock = appCode.substring(mountIdx, mountIdx + 400);
    assert.ok(mountBlock.includes('UPLOAD_PUBLIC') || mountBlock.includes('uploadsAbs'), '/uploads should serve from resolved uploads dir');
  });

  it('/uploads mount not hardcoded to public/uploads', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const mountIdx = appCode.indexOf("app.use('/uploads'");
    const mountBlock = appCode.substring(mountIdx, mountIdx + 300);
    assert.ok(!mountBlock.includes("public', 'uploads')"), '/uploads should NOT be hardcoded to public/uploads in mount');
  });
});

// ──── Startup logging ────

describe('Upload — startup logging', () => {
  it('startup logs resolved upload directory', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(appCode.includes("📁 Uploads:"), 'Should log upload directory');
    assert.ok(appCode.includes('uploadsAbs'), 'Should use resolved absolute path');
  });

  it('startup checks directory existence', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    // The mount section from UPLOAD_PUBLIC through to Health
    const uploadStart = appCode.indexOf('Single /uploads mount');
    const uploadEnd = appCode.indexOf('// ── Health');
    const section = appCode.substring(uploadStart, uploadEnd);
    assert.ok(section.includes('fs.existsSync(uploadsAbs)'), 'Should check existence');
  });

  it('startup checks writability', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const mountSection = appCode.substring(appCode.indexOf("📁 Uploads:") - 400, appCode.indexOf("// ── Health"));
    assert.ok(mountSection.includes('fs.constants.W_OK'), 'Should check writability');
    assert.ok(mountSection.includes('escribible'), 'Should report writability');
  });

  it('startup never logs credentials in upload section', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const mountSection = appCode.substring(appCode.indexOf("📁 Uploads:") - 400, appCode.indexOf("// ── Health"));
    assert.ok(!mountSection.includes('SESSION_SECRET'));
    assert.ok(!mountSection.includes('DB_PASSWORD'));
    assert.ok(!mountSection.includes('process.env.SMTP'));
    assert.ok(!mountSection.includes('RESEND_API_KEY'));
  });

  it('creates upload directory if missing', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const mountSection = appCode.substring(appCode.indexOf("📁 Uploads:") - 400, appCode.indexOf("// ── Health"));
    assert.ok(mountSection.includes("fs.mkdirSync(uploadsAbs"), 'Should create directory if missing');
  });
});

// ──── Subdirectory creation ────

describe('Upload — subdirectory creation', () => {
  it('app.js creates upload dirs at startup (public + proofs)', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(appCode.includes('UPLOAD_PUBLIC, UPLOAD_PROOFS]'), 'Should create both upload dirs');
    assert.ok(appCode.includes('fs.mkdirSync(dir'), 'Should mkdirSync');
  });

  it('app.js creates CMS media subdirectories', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.ok(appCode.includes('MEDIA_DIRECTORIES.map'), 'Should create media subdirs');
  });
});

// ──── Local defaults ────

describe('Upload — local defaults', () => {
  it('UPLOAD_PUBLIC defaults to public/uploads', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    // Find the exact line that defines UPLOAD_PUBLIC
    const match = appCode.match(/const UPLOAD_PUBLIC = ([^;]+);/);
    assert.ok(match, 'UPLOAD_PUBLIC definition should exist');
    const defLine = match[1];
    assert.ok(defLine.includes('process.env.UPLOAD_PUBLIC_DIR'), 'Should read env var');
    assert.ok(defLine.includes('public'), 'Default should involve public directory');
    assert.ok(defLine.includes('uploads'), 'Default should involve uploads directory');
  });

  it('UPLOAD_PROOFS defaults to storage/payment-proofs', () => {
    const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const match = appCode.match(/UPLOAD_PROOFS\s*=\s*process\.env\.UPLOAD_PROOFS_DIR\s*\|\|\s*([^;\n]+)/);
    assert.ok(match, 'UPLOAD_PROOFS should have default');
    assert.ok(match[1].includes('storage'), 'Default should be storage directory');
  });
});

// ──── Live HTTP: /uploads mounted ────

describe('Upload — live HTTP serving', () => {
  it('homepage loads successfully (uploads mount does not block)', async () => {
    const r = await httpGet('/');
    assert.strictEqual(r.status, 200);
  });

  it('/uploads returns 404 for nonexistent file (not 500)', async () => {
    const r = await httpGet('/uploads/nonexistent-file-xyz.webp');
    assert.ok(r.status === 404 || r.status === 403, `/uploads nonexistent should return 404/403, got ${r.status}`);
  });

  it('/uploads/media returns 404/403/301 for directory listing', async () => {
    const r = await httpGet('/uploads/media');
    // With index:false, directory should NOT list contents
    // Express may redirect /uploads/media → /uploads/media/ (301) or deny (403/404)
    assert.ok(r.status === 404 || r.status === 403 || r.status === 301,
      `/uploads/media should not expose directory contents, got ${r.status}`);
  });
});
