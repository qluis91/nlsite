# Carousel focal-position scope reduction

This branch is limited to the home-carousel focal-position feature and the
minimum automated-test isolation needed after the local development database
incident. It does not implement a foundational migration system or an empty
database bootstrap.

## Recovery backup

Before any scope-reduction restore, the complete worktree patch was saved
outside the repository:

- Path: `C:/CursorProyects/_local_backups/NLSite/focal-before-scope-reduction.patch`
- Size: 39,179 bytes
- SHA-256: `E2102829954B5134524F5356947690474E61F438557BE73AD638360E055384E1`

The backup is not tracked by this repository.

## KEEP — focal-position feature

Each retained file has one focused responsibility:

- `controllers/adminPanelsController.js`: accepts normalized X/Y values on
  carousel create and save and loads the editor helper.
- `controllers/adminPublishingController.js`: adds only carousel-specific,
  per-axis normalization for revision restoration; the existing generic
  restore loop remains intact.
- `validators/cmsPanelsValidator.js`: delegates server-side X/Y normalization
  to the shared bounded integer helper.
- `services/cmsRepeatableService.js`: normalizes draft reads/writes and includes
  X/Y in published carousel snapshots.
- `services/publicationService.js`: uses the repeatable snapshot helper so batch
  publication gets the same focal normalization.
- `services/cmsSchemaReadinessService.js`: requires the two new tinyint columns.
- `public/js/admin/carousel-image-position.js`: shared pure normalization,
  clamping, inverse-drag mapping, preview application, and Center reset.
- `public/js/admin/panel2-editor.js`: binds scoped, idempotent slider and pointer
  controls and synchronizes editor state.
- `public/js/admin/media-selector.js`: emits scoped media-change details needed
  to update the focal preview after select, upload, replace, or clear.
- `public/css/admin-page.css`: focal editor and admin preview presentation.
- `views/pages/admin/page/panel2.ejs`: accessible X/Y ranges, pointer frame,
  Center action, and normalized admin preview variables.
- `public/css/home.css` and `views/pages/home.ejs`: published focal values become
  bounded CSS custom properties used by public `object-position` on desktop and
  mobile.
- `schema.sql`: declares the two columns in the repository's canonical schema;
  it is documentation/schema parity only and is not used as a test bootstrap.
- `scripts/migrate-carousel-image-position.js`: new additive/idempotent
  migration 35, including independent columns and non-destructive JSON merge.
- `scripts/migrationTracker.js`: the single registry entry for migration 35.
- `tests/carousel-image-position.test.js`: pure focal normalization, migration
  fake, revision fallback, drag, scoping, synchronization, and initialization
  contracts.
- `tests/carousel-persistence.test.js`: focused DB-backed draft and published
  focal persistence assertions; it remains unexecuted.
- `tests/cms-phase1c-revision.test.js`,
  `tests/phase1g-category-store-hero.test.js`,
  `tests/phase1h-about-page.test.js`, `tests/phase2ea-scheduler.test.js`,
  `tests/phase2eb-meta.test.js`, `tests/phase2ec-tiktok.test.js`,
  `tests/phase2ec-tiktok-close.test.js`, and
  `tests/phase2ed-stabilization.test.js`: migration-count assertions updated
  from 34 to 35 without changing their subject behavior.
- `docs/CAROUSEL_FOCAL_POSITION.md`: focal contracts, incident note, rollback
  guidance, and pending manual checks.
- `docs/CAROUSEL_SCOPE_REDUCTION.md`: this file records the required
  keep/revert/defer classification and checkpoint evidence.

## KEEP — minimum test safety

- `.gitignore` and `.env.test.example`: keep local test credentials ignored and
  document an isolated, fail-closed test configuration without secrets.
- `config/environment.js`: test context selects only `.env.test`; normal
  development/production context selects `.env` with process variables taking
  precedence.
- `config/testBootstrap.js`: marks test context and redirects legacy
  `dotenv.config()` calls to `.env.test`, avoiding edits to checksum-sensitive
  migrations.
- `config/testDatabaseGuard.js`: rejects missing names, `nlsite_db`, non-`_test`
  names, unapproved remote hosts, and missing connection/mutation opt-ins.
- `config/databaseConfig.js`: resolves the DB target once and applies the guard
  before a test pool can be opened.
- `config/testProcessEnvironment.js`: strips inherited DB variables and adds the
  bootstrap to child Node processes.
- `config/db.js`: retains the normal `.env`, pool options, eager development/
  production probe, and messages outside test context; in tests it validates
  before lazy pool creation, so pure imports cannot connect.
- `config/session.js`: applies the same validation to
  `express-mysql-session`, which otherwise creates a separate unguarded DB
  connection outside `config/db.js`.
- `package.json`, `_direct_test.js`, and `_run_suite.js`: route only test entry
  points through the isolated bootstrap; start, development, and migration
  commands are unchanged.
- `scripts/migrate-deploy.js` is deliberately not modified. The runner test
  loads its exact historical source in memory with fake dependencies.
- `tests/migrate-deploy.test.js`: simulates runner and tracker behavior with a
  fake CommonJS dependency loader, fake migrations, and fake SQL contracts; it
  does not import the live pool or spawn the runner.
- `tests/test-database-safety.test.js`: verifies the centralized rejection,
  opt-in, environment precedence, and child-environment contracts.
- `tests/testServer.js`, `tests/account.test.js`,
  `tests/address-checkout.test.js`, `tests/cms-admin.test.js`,
  `tests/cms-media-production-flow.test.js`, `tests/customer-orders.test.js`,
  `tests/gallery.test.js`, `tests/login-ui.test.js`,
  `tests/phase2ea-social-sync.test.js`, and
  `tests/upload-path-production.test.js`: sanitize the environments of their
  child Node servers or processes.
- `tests/catalog-deployment-repair.test.js`,
  `tests/cms-media-production-flow.test.js`,
  `tests/cms-panel1-save-regression.test.js`,
  `tests/phase1f-integration.test.js`, `tests/phase2a-social-feed.test.js`,
  `tests/phase2b-social-feed-public.test.js`,
  `tests/phase2c-social-embeds.test.js`, and
  `tests/phase2d-testimonials.test.js`: replace permissive local/dev checks with
  the centralized `_test` database and mutation guard.
- `tests/cms-phase11b.test.js`: removes its direct normal-`.env` load.
- `tests/gallery-demo-seed.test.js`: isolates its child environment while
  preserving the production refusal scenario.
- `docs/TEST_DATABASE_SAFETY.md`: documents the retained guard architecture and
  environment precedence.

## REVERT — unrelated or excessive changes

The following were restored to `HEAD` content:

- broad environment-loader substitutions in `app.js`, `config/site.js`,
  `scripts/seed-gallery-demo.js`, and `scripts/validate-tilopay-config.js`;
- the carousel duplication route in `routes/adminPanelsRoutes.js`;
- every pre-existing `scripts/migrate-*.js`, including
  `scripts/migrate-deploy.js`;
- duplication endpoint/controller/service/UI/test/documentation additions in
  `controllers/adminPanelsController.js`, `services/cmsRepeatableService.js`,
  `views/pages/admin/page/panel2.ejs`, `tests/carousel-persistence.test.js`, and
  `docs/CAROUSEL_FOCAL_POSITION.md`;
- the generic revision allowlist/refactor; restoration again uses the original
  generic scalar loop plus a narrow carousel normalization step.

There is no carousel duplication endpoint, button, controller export, service
operation, or new duplication acceptance test left in the substantive diff.
The accepted bootstrap-analysis document still mentions the removed symbols as
historical audit evidence; those references are documentation only.

## DEFER — separate branch/design task

- foundational or from-zero database bootstrap;
- synthesizing baseline tables for an empty `nlsite_test` database;
- changing historical migration dependency injection;
- repairing the existing partial `nlsite_test` baseline in this branch.

No deferred application implementation is retained. The accepted read-only
analysis is preserved as `docs/TEST_DATABASE_BOOTSTRAP_ANALYSIS.md`.

## Historical migration checksum verification

All 36 files matching `scripts/migrate-*.js` that exist in `HEAD` were compared
as raw bytes against their `HEAD` blobs. Every worktree SHA-256 equals the
corresponding `HEAD` SHA-256; mismatch count is zero. This includes
`scripts/migrate-all.js`, all 34 registered historical migration modules, and
`scripts/migrate-deploy.js`. `scripts/migrationTracker.js` is not a registered
migration source and is not checksum-tracked; its only feature change is the new
migration 35 registry entry.

## Remaining runtime changes

The exact application-runtime files with substantive changes are:

- `config/db.js`
- `config/session.js`
- `controllers/adminPanelsController.js`
- `controllers/adminPublishingController.js`
- `public/css/admin-page.css`
- `public/css/home.css`
- `public/js/admin/carousel-image-position.js`
- `public/js/admin/media-selector.js`
- `public/js/admin/panel2-editor.js`
- `services/cmsRepeatableService.js`
- `services/cmsSchemaReadinessService.js`
- `services/publicationService.js`
- `validators/cmsPanelsValidator.js`
- `views/pages/admin/page/panel2.ejs`
- `views/pages/home.ejs`

Only `config/db.js` and `config/session.js` are test-safety runtime changes. They
are indispensable because the primary pool and session store are separate DB
connection paths. Outside test context, the resolver uses the same `.env`,
defaults, pool/store options, eager probe, and normal commands as `HEAD`; the
guard is not invoked.

## Safe and blocked validation

No command in this scope-reduction pass ran a test, SQL statement, migration,
server, or browser.

Safe pure/fake tests once approved:

- `node --require ./config/testBootstrap.js --test tests/test-database-safety.test.js`
- `node --require ./config/testBootstrap.js --test tests/migrate-deploy.test.js`
- `node --require ./config/testBootstrap.js --test tests/carousel-image-position.test.js`

Class C DB-backed tests remain unexecuted because the existing dedicated test DB
does not have a supported from-zero baseline in this branch. This includes the
focal persistence test and the guarded integration tests named above. Class D
child-server tests also remain unexecuted. Neither class may run against
`nlsite_db`.

Manual validation in the user's local Chrome browser passed for the exercised
admin sliders, inverse pointer dragging, Center reset, media selection and
replacement, draft save/reload, publication, and public main/preview swapping.
No focal-editor, carousel, `CustomEvent`, or CSP errors were observed. Two
unrelated external Facebook/Instagram image requests failed (HTTP 403 and
`ERR_NAME_NOT_RESOLVED`) and remain outside this branch.

Exact viewport/mobile/touch coverage, 200% zoom, keyboard-only operation,
pointer-cancel interruption, upload/clear media actions, and current/legacy
revision restoration were not separately confirmed and remain manual-validation
limitations.
