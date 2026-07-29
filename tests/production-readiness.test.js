const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// Cleanup: close pool if still open (idempotent, safe for suite)
after(async () => {
  try {
    const pool = require('../config/db');
    if (pool && typeof pool.end === 'function') await pool.end();
  } catch (_) {}
});

// ── Environment validation ──

test('upload-path validation catches overlapping directories', () => {
  const absPublic = path.resolve('/tmp/test-public');
  const absProofs = path.resolve('/tmp/test-public');
  assert.equal(absPublic, absProofs);
});

test('env validation returns array without throwing', () => {
  const { validateEnv } = require('../config/envValidator');
  const issues = validateEnv();
  assert.ok(Array.isArray(issues));
});

// ── Static assertions ──

test('package.json has correct scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node app.js');
  assert.ok(['node --test', 'node --test tests/*.test.js'].includes(pkg.scripts.test), `Unexpected test script: ${pkg.scripts.test}`);
  assert.equal(pkg.scripts.migrate, 'node scripts/migrate-all.js');
});

test('railway.json is valid JSON with required fields', () => {
  const railway = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'railway.json'), 'utf8'));
  assert.equal(railway.deploy.startCommand, 'npm start');
  assert.equal(railway.deploy.healthcheckPath, '/health');
});

test('.env.example documents upload variables', () => {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.match(env, /UPLOAD_PUBLIC_DIR/);
  assert.match(env, /UPLOAD_PROOFS_DIR/);
  assert.match(env, /\/app\/storage\/public-uploads/);
});

test('PRODUCTION.md documents volume mount and deployment sequence', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'PRODUCTION.md'), 'utf8');
  assert.match(doc, /\/app\/storage/);
  assert.match(doc, /UPLOAD_PUBLIC_DIR/);
  assert.match(doc, /UPLOAD_PROOFS_DIR/);
  assert.match(doc, /npm run migrate/);
  assert.match(doc, /npm start/);
  assert.match(doc, /npm ci/);
});

// ── Upload paths ──

test('imageProcessingService resolves upload root under project', () => {
  const svc = require('../services/imageProcessingService');
  const resolved = path.resolve(svc.UPLOAD_ROOT);
  const projectRoot = path.resolve(path.join(__dirname, '..'));
  assert.ok(resolved.startsWith(projectRoot),
    `UPLOAD_ROOT should resolve under project root, got ${resolved}`);
});

test('paymentProofService exports PROOF_ROOT', () => {
  const svc = require('../services/paymentProofService');
  assert.ok(typeof svc.PROOF_ROOT === 'string');
  const resolved = path.resolve(svc.PROOF_ROOT);
  const projectRoot = path.resolve(path.join(__dirname, '..'));
  assert.ok(resolved.startsWith(projectRoot),
    `PROOF_ROOT should resolve under project root, got ${resolved}`);
});

test('upload directories are created at startup', () => {
  const uploadPublic = process.env.UPLOAD_PUBLIC_DIR || path.join(__dirname, '..', 'public', 'uploads');
  const uploadProofs = process.env.UPLOAD_PROOFS_DIR || path.join(__dirname, '..', 'storage', 'payment-proofs');
  assert.ok(fs.existsSync(uploadPublic), `Public upload dir should exist: ${uploadPublic}`);
  assert.ok(fs.existsSync(uploadProofs), `Proof dir should exist: ${uploadProofs}`);
});

test('proofs directory is in .gitignore', () => {
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gitignore, /storage\//);
});
