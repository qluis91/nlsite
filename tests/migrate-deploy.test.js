/**
 * Phase 13 tests — Safe automatic database migrations.
 * Run: node --test tests/migrate-deploy.test.js
 */
const { describe, before, after, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const tracker = require('../scripts/migrationTracker');

after(async () => {
  await pool.end();
});

describe('Phase 13 — migrationTracker', () => {
  it('MIGRATION_REGISTRY has 26 entries (Phase 2D added Testimonials)', () => {
    assert.equal(tracker.MIGRATION_REGISTRY.length, 26);
    assert.equal(
      tracker.MIGRATION_REGISTRY.filter((entry) => entry.name === 'migrateCatalogSchemaRepair').length,
      1
    );
  });

  it('each registry entry has name, file, exportName', () => {
    for (const e of tracker.MIGRATION_REGISTRY) {
      assert.ok(e.name, `Missing name`);
      assert.ok(e.file, `Missing file for ${e.name}`);
      assert.ok(typeof e.exportName === 'string', `Missing exportName for ${e.name}`);
    }
  });

  it('LOCK_NAME is migrate_deploy', () => {
    assert.equal(tracker.LOCK_NAME, 'migrate_deploy');
  });

  it('LOCK_TIMEOUT_SEC is positive', () => {
    assert.ok(tracker.LOCK_TIMEOUT_SEC > 0);
  });
});

describe('Phase 13 — Checksum', () => {
  it('computeChecksum returns 64-char hex', () => {
    const cs = tracker.computeChecksum(path.resolve(__dirname, '../scripts/migrate-catalog-seo.js'));
    assert.equal(cs.length, 64);
    assert.ok(/^[a-f0-9]{64}$/.test(cs));
  });

  it('computeChecksum is deterministic', () => {
    const a = tracker.computeChecksum(path.resolve(__dirname, '../scripts/migrate-catalog-seo.js'));
    const b = tracker.computeChecksum(path.resolve(__dirname, '../scripts/migrate-catalog-seo.js'));
    assert.equal(a, b);
  });

  it('computeChecksum differs for different files', () => {
    const a = tracker.computeChecksum(path.resolve(__dirname, '../scripts/migrate-catalog-seo.js'));
    const b = tracker.computeChecksum(path.resolve(__dirname, '../scripts/migrate-cms.js'));
    assert.notEqual(a, b);
  });
});

describe('Phase 13 — schema_migrations table', () => {
  it('schema_migrations table exists', async () => {
    const [rows] = await pool.query(
      "SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'"
    );
    assert.equal(Number(rows[0].c), 1);
  });

  it('schema_migrations has required columns', async () => {
    const [cols] = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'"
    );
    const names = cols.map(c => c.column_name);
    for (const required of ['name', 'checksum', 'executed_at', 'duration_ms', 'status']) {
      assert.ok(names.includes(required), `Missing column: ${required}`);
    }
  });

  it('ensureMigrationsTable is idempotent', async () => {
    await tracker.ensureMigrationsTable(pool);
    await tracker.ensureMigrationsTable(pool);
    assert.ok(true);
  });
});

describe('Phase 13 — Migration records', () => {
  it('deploy recorded at least 14 migrations', async () => {
    const [rows] = await pool.query(
      "SELECT COUNT(*) c FROM schema_migrations WHERE status = 'ok'"
    );
    assert.ok(Number(rows[0].c) >= 14, `Expected >=14, got ${rows[0].c}`);
  });

  it('all recorded migrations have checksum', async () => {
    const [rows] = await pool.query(
      "SELECT COUNT(*) c FROM schema_migrations WHERE status = 'ok' AND (checksum IS NULL OR checksum = '')"
    );
    assert.equal(Number(rows[0].c), 0);
  });

  it('all recorded migrations have positive duration', async () => {
    const [rows] = await pool.query(
      "SELECT COUNT(*) c FROM schema_migrations WHERE status = 'ok' AND duration_ms <= 0"
    );
    assert.equal(Number(rows[0].c), 0);
  });
});

describe('Phase 13 — Deploy idempotency', () => {
  it('migrate-deploy skips all on second run', async () => {
    const { execSync } = require('child_process');
    const options = { cwd: path.resolve(__dirname, '..'), encoding: 'utf-8' };
    execSync('node scripts/migrate-deploy.js', options);
    const secondRun = execSync('node scripts/migrate-deploy.js', options);
    assert.ok(secondRun.includes('0 ran'), `Expected skip, got: ${secondRun.slice(0, 200)}`);
  });
});

describe('Phase 13 — Advisory lock', () => {
  it('acquireLock returns true when no lock held', async () => {
    const conn = await pool.getConnection();
    try {
      const ok = await tracker.acquireLock(conn, 2);
      assert.ok(ok);
    } finally {
      await tracker.releaseLock(conn);
      conn.release();
    }
  });

  it('second acquireLock fails while lock held', async () => {
    const conn1 = await pool.getConnection();
    const conn2 = await pool.getConnection();
    try {
      const ok1 = await tracker.acquireLock(conn1, 5);
      assert.ok(ok1);
      const ok2 = await tracker.acquireLock(conn2, 1);
      assert.equal(ok2, false, 'Second acquire should fail');
    } finally {
      await tracker.releaseLock(conn1).catch(() => {});
      await tracker.releaseLock(conn2).catch(() => {});
      conn1.release();
      conn2.release();
    }
  });
});

describe('Phase 13 — package.json scripts', () => {
  it('has prestart script', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.scripts.prestart, 'node scripts/prestart.js');
  });

  it('has migrate:deploy script', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.scripts['migrate:deploy'], 'node scripts/migrate-deploy.js');
  });

  it('start is unchanged', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.scripts.start, 'node app.js');
  });

  it('dev migrate is unchanged', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.scripts.migrate, 'node scripts/migrate-all.js');
  });
});

describe('Phase 13 — schema.sql', () => {
  it('includes schema_migrations table', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf-8');
    assert.ok(sql.includes('schema_migrations'));
  });
});
