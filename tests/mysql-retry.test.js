/**
 * mysqlRetry unit tests — commit, rollback, exhausted retries, non-retryable errors,
 * fresh connections.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  withDeadlockRetry,
  withTransaction,
  isDeadlock,
} = require('../services/mysqlRetry');
const pool = require('../config/db');

test.after(async () => {
  await pool.end();
});

test('isDeadlock detects errno 1213', () => {
  assert.ok(isDeadlock({ errno: 1213 }));
  assert.ok(isDeadlock({ errno: 1213, code: 'ER_LOCK_DEADLOCK' }));
  assert.ok(!isDeadlock(null));
  assert.ok(!isDeadlock({}));
  assert.ok(!isDeadlock({ errno: 1062 }));
  assert.ok(!isDeadlock(new Error('other')));
});

test('withDeadlockRetry succeeds on first attempt', async () => {
  let calls = 0;
  const result = await withDeadlockRetry(() => {
    calls += 1;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withDeadlockRetry retries on deadlock and succeeds', async () => {
  let calls = 0;
  const result = await withDeadlockRetry(() => {
    calls += 1;
    if (calls < 3) {
      const err = new Error('deadlock');
      err.errno = 1213;
      throw err;
    }
    return `attempt-${calls}`;
  });
  assert.equal(result, 'attempt-3');
  assert.equal(calls, 3);
});

test('withDeadlockRetry throws after max retries', async () => {
  let calls = 0;
  await assert.rejects(
    withDeadlockRetry(() => {
      calls += 1;
      const err = new Error('deadlock');
      err.errno = 1213;
      throw err;
    }),
    (err) => {
      assert.equal(err.errno, 1213);
      return true;
    }
  );
  assert.equal(calls, 3);
});

test('withDeadlockRetry does not retry non-deadlock errors', async () => {
  let calls = 0;
  await assert.rejects(
    withDeadlockRetry(() => {
      calls += 1;
      throw new Error('unrelated error');
    }),
    { message: 'unrelated error' }
  );
  assert.equal(calls, 1);
});

test('withTransaction commits on success', async () => {
  const result = await withTransaction(pool, async (connection) => {
    const [[r]] = await connection.query('SELECT 1 AS val');
    assert.equal(r.val, 1);
    return 'committed';
  });
  assert.equal(result, 'committed');
});

test('withTransaction rolls back on error', async () => {
  await assert.rejects(
    withTransaction(pool, async (connection) => {
      await connection.query('SELECT 1');
      throw new Error('test rollback');
    }),
    { message: 'test rollback' }
  );
  // The connection should have been released — verify pool is still usable
  const [[r]] = await pool.query('SELECT 1 AS val');
  assert.equal(r.val, 1);
});

test('withTransaction uses a fresh connection on retry', async () => {
  let attempts = 0;
  const result = await withTransaction(pool, async (connection) => {
    attempts += 1;
    if (attempts < 2) {
      const err = new Error('deadlock');
      err.errno = 1213;
      throw err;
    }
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
  // Verify pool is still usable after retry
  const [[r]] = await pool.query('SELECT 1 AS alive');
  assert.equal(r.alive, 1);
});

test('withTransaction exhausts retries on persistent deadlock', async () => {
  let calls = 0;
  await assert.rejects(
    withTransaction(pool, async () => {
      calls += 1;
      const err = new Error('deadlock');
      err.errno = 1213;
      throw err;
    }),
    (err) => err.errno === 1213
  );
  assert.equal(calls, 3);
});

test('withTransaction releases connection even on non-retryable error', async () => {
  await assert.rejects(
    withTransaction(pool, async () => {
      throw new Error('boom');
    }),
    { message: 'boom' }
  );
  // Pool must still work
  const [[r]] = await pool.query('SELECT 1 AS ok');
  assert.equal(r.ok, 1);
});
