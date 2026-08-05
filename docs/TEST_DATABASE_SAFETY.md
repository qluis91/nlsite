# Test database safety

Automated tests must never connect to `nlsite_db` or silently inherit the normal
development `.env`.

## Environment precedence

1. Variables already present in `process.env` have highest precedence.
2. In a Node test worker (`NODE_TEST_CONTEXT`) or when `NODE_ENV=test`, only
   `.env.test` is considered and it supplies missing values without overriding
   process variables.
3. Outside test context, `.env` supplies missing development/production values.
4. `.env` is never loaded as a fallback for tests. A missing `.env.test` therefore
   leaves the test DB name unset and the guard fails closed.

`.env.test.example` contains no secret. Copy it to the ignored `.env.test` only
when preparing an isolated local test database, and provide credentials locally.

## Guard contract

Before a test pool is created, the centralized guard requires:

- a Node test context;
- `DB_NAME=nlsite_test` or another name ending in `_test`;
- a local host (`localhost`, `127.0.0.1`, or `::1`);
- `TEST_DB_ALLOW_CONNECTION=true`;
- additionally, `TEST_DB_ALLOW_MUTATIONS=true` for schema-changing or destructive
  integration setup.

Remote hosts are rejected unless both `CI=true` and
`TEST_DB_ALLOW_REMOTE=true` are explicitly supplied by an isolated CI job.
`nlsite_db`, missing names, non-test names, and ambiguous inherited configuration
are always rejected.

## Migration runner tests

`tests/migrate-deploy.test.js` is a unit test. It loads the unchanged historical
runner source through an in-memory CommonJS wrapper that injects a fake pool,
connection, migration tracker, readiness checks, and logger. It neither imports
`config/db` through Node's real loader nor launches `scripts/migrate-deploy.js`.
Migration loading, idempotency, and catalog reconciliation are simulated with
tracker fakes without executing SQL.

DB-backed integration tests must be invoked only after provisioning `nlsite_test`
and explicitly setting both opt-ins appropriate to the operation. Child processes
must use `buildIsolatedTestEnvironment` so development DB variables and
`DATABASE_URL` are not inherited.
