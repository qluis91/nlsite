/**
 * MySQL deadlock retry helper.
 *
 * When the full test suite kills a child-process test server via taskkill,
 * the MySQL server may briefly retain stale connections that hold implicit
 * row locks.  Any migration or service query that touches the same rows
 * within that window can fail with ER_LOCK_DEADLOCK (1213).
 *
 * This helper retries deadlock-prone operations a few times with short
 * exponential backoff so the suite exits naturally with code 0.
 */

const DEADLOCK_ERRNO = 1213; // ER_LOCK_DEADLOCK
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

function isDeadlock(error) {
  return Boolean(error) && error.errno === DEADLOCK_ERRNO;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` up to `maxRetries` times, retrying only on deadlock errors.
 * Other errors propagate immediately.
 */
async function withDeadlockRetry(fn) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isDeadlock(error)) throw error;
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await delay(BASE_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
}

/**
 * Execute a transactional operation with deadlock retry.
 * `fn(connection)` is called inside a fresh connection+transaction+commit cycle.
 * On deadlock (1213), the entire cycle is retried up to MAX_RETRIES times.
 */
async function withTransaction(pool, fn) {
  return withDeadlockRetry(async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  });
}

module.exports = { withDeadlockRetry, withTransaction, isDeadlock };
