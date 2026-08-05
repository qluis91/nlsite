# Test database bootstrap analysis

Date: 2026-08-04 (America/Costa_Rica)

Scope: static repository analysis only. No SQL, database connection, migration,
seed, application server, or test command was executed while preparing this
document. The only file created by this audit is this report.

## Executive conclusion

NLSite cannot currently initialize an empty database through the 35 registered
migrations alone. The registry is incremental: its first migration creates
`user_addresses`, which has a foreign key to `users(id)`, but no registered
migration creates `users` before that point. The only repository SQL that creates
the foundational `users` table is `schema.sql`.

The best classification is **3. an undocumented hybrid**:

- `schema.sql` is an installable snapshot/baseline (`schema.sql:1-10` says to
  import it through phpMyAdmin and then creates/selects `nlsite_db`);
- the registry is a checksum-tracked incremental chain;
- production documentation presents the migration runner as sufficient during
  startup, but does not document a required initial baseline import;
- there is no package command that safely creates an empty database, applies a
  baseline, and then runs the registry;
- `schema.sql` contains many later migration results but omits other registered
  tables, so it is not an immutable baseline or a fully synchronized canonical
  schema.

The preferred permanent repair is a new additive, idempotent foundational
migration registered before `migrateUserAddresses`, plus one guarded preparation
command for an explicitly validated `*_test` database. Historical migration
files and their checksums must not be rewritten.

## A. Immediate failure

### Exact failing SQL dependency

`scripts/migrate-user-addresses.js:5-23` issues:

```sql
CREATE TABLE IF NOT EXISTS user_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  label VARCHAR(60) NOT NULL,
  province VARCHAR(60) NOT NULL,
  canton VARCHAR(80) NOT NULL,
  district VARCHAR(80) NOT NULL,
  address_line VARCHAR(300) NOT NULL,
  address_reference VARCHAR(200) NULL,
  contact_phone VARCHAR(15) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_addresses_user (user_id),
  INDEX idx_user_addresses_user_default (user_id, is_default),
  CONSTRAINT fk_user_addresses_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

The failed constraint is `fk_user_addresses_user`. It references table `users`,
column `id`.

### Why `users` was absent

`nlsite_test` was created empty immediately before the runner was invoked. The
runner then:

1. acquired the advisory lock;
2. created/confirmed only `schema_migrations` through
   `ensureMigrationsTable()` (`scripts/migrationTracker.js:57-72`);
3. loaded a 35-entry registry;
4. started `migrateUserAddresses`, the first entry; and
5. failed before any earlier domain migration could have run.

No database read was performed for this report. The absence of `users` follows
deterministically from the newly created empty database and the runner order.
The registry has no earlier entry at all, and none of its 35 entries creates the
foundational `users` table. `migrateUserProfile`, entry 2, only adds columns to an
already existing `users` table (`scripts/migrate-user-profile.js:7-23`).

`schema.sql:26-39` is the repository file that creates `users`. It precedes the
baseline `user_addresses` definition at `schema.sql:42-60`.

### Compatibility check: absence, not a type mismatch

The definitions are compatible:

| Property | `users.id` | `user_addresses.user_id` | Result |
|---|---|---|---|
| Type | `INT` | `INT` | compatible |
| Signedness | signed (no `UNSIGNED`) | signed (no `UNSIGNED`) | compatible |
| Index | primary key | indexed FK column | compatible |
| Engine | InnoDB | InnoDB | compatible |
| Character set | utf8mb4 | utf8mb4 | compatible; irrelevant to integer FK |
| Collation | utf8mb4_unicode_ci | utf8mb4_unicode_ci | compatible; irrelevant to integer FK |

The referenced `users.id` is a primary key and therefore indexed. The immediate
failure is the missing referenced table, not signedness, type, engine, charset,
collation, or index incompatibility.

## B. Current bootstrap model

### Classification

**3. Undocumented hybrid: baseline `schema.sql` plus incremental migrations.**

Evidence:

- `schema.sql:3` says `Importar en phpMyAdmin (XAMPP)`.
- `schema.sql:6-10` creates `nlsite_db` and selects it.
- `schema.sql:26-39` creates `users`, which the first two registered migrations
  require but never create.
- `scripts/migrationTracker.js:11-54` starts with `migrateUserAddresses` and
  `migrateUserProfile`; there is no foundation migration.
- `scripts/migrate-all.js:1-19` delegates to the same registered deploy runner;
  it does not install a baseline.
- `package.json` offers `migrate` and `migrate:deploy`, but no database/bootstrap
  command.
- `docs/PRODUCTION.md:8-24` describes `npm start` as sufficient to run pending
  migrations in production, without documenting how an empty production
  database receives `users`.
- `docs/CMS_PHASE_11A.md:28-31` describes `site_settings` as pre-existing and
  says `schema.sql` is synchronized, reinforcing an assumed prior schema.
- No full from-zero integration test exists. The test named
  `catalog repair defines a complete empty-database bootstrap without
  schema.sql` in `tests/catalog-deployment-repair.test.js:69` proves only the
  four catalog tables, not the whole application.

The migration runner is suitable for upgrading an already founded database. It
is not currently a complete database installer.

## Dependency graph for the first migrations

```text
empty selected database
  |
  +-- tracker.ensureMigrationsTable()
  |     `-- creates schema_migrations only
  |
  +-- 01 migrateUserAddresses
  |     `-- CREATE user_addresses
  |           `-- FK user_addresses.user_id -> users.id [MISSING]
  |
  +-- 02 migrateUserProfile
  |     `-- ALTER users [requires users]
  |
  +-- 03 migrateCms
  |     +-- CREATE media_assets -> users.id
  |     +-- CREATE pages -> users.id
  |     +-- CREATE page_sections -> pages.id, users.id
  |     +-- CREATE/ALTER site_settings
  |     +-- CREATE content_revisions -> users.id
  |     `-- insert required home/page-section rows
  |
  +-- 04 migrateNavigationItems
  |     `-- CREATE navigation_items -> navigation_items.id, users.id
  |
  +-- 05 migratePanels
  |     +-- CREATE logo_loop_items -> page_sections.id, users.id
  |     +-- CREATE home_carousel_items -> page_sections.id, users.id
  |     +-- CREATE home_feature_items -> page_sections.id, users.id
  |     `-- insert missing panel rows
  |
  +-- 06 migratePublishing
  |     +-- CREATE publication_batches -> users.id
  |     `-- CREATE publication_batch_items -> publication_batches.id,
  |                                             content_revisions.id
  |
  +-- 07 migrateCmsDraftPublish
  |     `-- ALTER/UPDATE tables created by migrations 03-05
  |
  +-- 08 migrateCmsHomepageFields
  |     +-- CREATE home_social_items -> page_sections.id, users.id
  |     `-- ALTER/UPDATE/seed tables created by migrations 03-05
  |
  +-- 09 migrateCatalog
  |     +-- CREATE categories
  |     +-- CREATE products
  |     +-- CREATE product_categories -> products.id, categories.id
  |     `-- CREATE product_images -> products.id
  |
  +-- 10 migrateCatalogSchemaRepair
  |     `-- reconcile the four catalog tables and capabilities
  |
  `-- 11 migrateOrders
        +-- CREATE orders -> users.id
        +-- CREATE order_items -> orders.id, products.id
        `-- CREATE order_events -> orders.id, users.id
```

The graph shows that creating `users` is the minimum prerequisite for migration
1, but a proper foundational migration should also account for application
tables not created anywhere in the registry: `pending_registrations`,
`password_reset_tokens`, and `sessions` (the last may otherwise be created
implicitly by the session library).

## Registry inspection: all 35 entries

| # | Registry name | Primary operation/dependency |
|---:|---|---|
| 1 | `migrateUserAddresses` | create `user_addresses`; requires `users` |
| 2 | `migrateUserProfile` | alter `users`; requires `users` |
| 3 | `migrateCms` | create CMS foundation; requires `users` |
| 4 | `migrateNavigationItems` | create navigation; requires `users` |
| 5 | `migratePanels` | create panel tables; requires CMS pages and `users` |
| 6 | `migratePublishing` | create publication tables; requires users/revisions |
| 7 | `migrateCmsDraftPublish` | add published/draft columns to CMS tables |
| 8 | `migrateCmsHomepageFields` | add homepage fields and social items |
| 9 | `migrateCatalog` | create four catalog tables |
| 10 | `migrateCatalogSchemaRepair` | repair/reconcile catalog capabilities |
| 11 | `migrateOrders` | create order tables; requires users/catalog |
| 12 | `migrateTilopay` | create Tilopay transactions; requires orders |
| 13 | `migrateCategoryHero` | alter categories |
| 14 | `migrateGallery` | create gallery tables |
| 15 | `migratePaymentProofs` | create proofs; requires orders/users |
| 16 | `migrateTracking` | alter orders |
| 17 | `migrateCatalogSeo` | alter categories/products |
| 18 | `migrateGalleryYoutube` | alter gallery items |
| 19 | `migrateCmsPhase1aSaveRepair` | repair existing page-section JSON |
| 20 | `migrateRevisionSourceId` | alter content revisions |
| 21 | `migrateStoreHeroCms` | insert/update CMS page/section rows |
| 22 | `migrateCategoryStoreHero` | alter categories |
| 23 | `migrateAboutPageCms` | insert/update CMS/navigation rows |
| 24 | `migrateSocialFeed` | create social posts |
| 25 | `migrateSocialFeedHomeSection` | insert social-feed section |
| 26 | `migrateTestimonials` | create testimonials |
| 27 | `migrateSocialIntegrations` | create/seed integrations |
| 28 | `migrateSocialSyncRuns` | create sync runs |
| 29 | `migrateSocialPostsImportFields` | alter social posts |
| 30 | `migrateSocialTokenSecrets` | create token secrets |
| 31 | `migrateSocialOAuthStates` | create OAuth states |
| 32 | `migrateSeedMetaIntegrations` | seed Meta integrations/alter OAuth states |
| 33 | `migrateSeedTikTok` | seed TikTok integration |
| 34 | `migrateSocialPostsProviderThumbnail` | alter social posts |
| 35 | `migrateCarouselImagePosition` | add focal columns/backfill snapshots |

All 35 registered source files were inspected statically. None before entry 1
creates `users`.

## C. `schema.sql` assessment

### Database selection and safety

`schema.sql` is unsafe to execute unchanged for a test database:

```sql
CREATE DATABASE IF NOT EXISTS nlsite_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nlsite_db;
```

Those statements are at `schema.sql:6-10`. This is why the file was not used for
`nlsite_test`.

### Foundational coverage

It contains the tables needed by migration 1:

- `users` at lines 26-39;
- `user_addresses` at lines 42-60;
- compatible signed `INT` identifiers;
- InnoDB and matching utf8mb4 metadata.

It also contains foundational tables never created by the registry:
`pending_registrations`, `password_reset_tokens`, and `sessions`.

### Later migration results already represented

This is a current-schema snapshot, not a pristine version-zero baseline. Examples
already incorporated into its table definitions include:

- catalog SEO columns from migration 17 (`schema.sql:122`, `151`);
- gallery YouTube/custom cover fields from migration 18 (`schema.sql:217-218`);
- tracking fields from migration 16 (`schema.sql:246-248`);
- `content_revisions.source_revision_id` from migration 20
  (`schema.sql:471`, `479`);
- draft/published snapshot fields from migrations 7-8;
- focal columns from migration 35 (`schema.sql:527-528`).

### Known drift

Despite documentation calling it synchronized, `schema.sql` omits registered
objects including:

- `navigation_items` (migration 4);
- `social_posts` (migration 24);
- `testimonials` (migration 26);
- `social_integrations`, `social_sync_runs`, `social_token_secrets`, and
  `social_oauth_states` (migrations 27-31);
- social-post import and provider-thumbnail alterations (migrations 29 and 34).

It therefore cannot be treated as a single canonical representation of the
registry's final state.

### Baseline followed by all migrations

Importing a safely sanitized baseline and then running all migrations would not
obviously cause immediate duplicate table/column conflicts because the inspected
migrations predominantly use `CREATE TABLE IF NOT EXISTS`, information-schema
column/index checks, and guarded/idempotent inserts. The empty
`schema_migrations` table in the baseline would cause all registry entries to be
considered pending, so every migration would still execute or no-op.

That behavior is fragile rather than formally guaranteed: the baseline already
embeds a moving subset of migration results, and there is no test that imports
the full baseline and then proves all registered migrations from zero. This path
should not become permanent without a manifest or a true foundational migration.

### Data and destructive-content audit

Static statement inspection found:

- no executable `INSERT`, `REPLACE`, `UPDATE`, or `DELETE` statements;
- no `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, or destructive reset;
- no users, administrator rows, seed rows, or production-like records;
- no passwords, tokens, API keys, or other secrets;
- only a comment directing operators to `node create-admin.js`.

The file creates schema only, but its hard-coded database selection remains a
critical safety problem.

## D. Bootstrap option comparison

| Option | Safety | Reproducibility | Production impact | Migration-history effect | Drift risk | Permanent solution? |
|---|---|---|---|---|---|---|
| 1. Sanitized copy of `schema.sql` | Medium if database selection is structurally removed and the selected `_test` target is revalidated; unsafe if implemented with naive text replacement | Medium | None if test-only | All 35 entries still need records; baseline itself has no history | High because snapshot and migrations already drift | Acceptable temporary recovery, not preferred permanent design |
| 2. Guarded baseline importer that skips represented migrations | Medium-low until an explicit baseline-to-migration manifest exists | Medium | None if strictly test-only | Risky: marking migrations represented without executing them fabricates history unless the mapping is exact | High; every schema edit must update parser/manifest | Not recommended in its proposed “skip represented” form |
| 3. New proper initial/foundation migration | High when additive, idempotent, first in registry, and covered with fake/empty-schema tests | High; one registry becomes authoritative | Existing databases execute a reviewed no-op/additive foundation once | Adds one new record; does not rewrite old files/checksums | Lowest | **Recommended permanent solution** |
| 4. `mysqldump --no-data` from development | Low for this incident because it accesses `nlsite_db`; structure may include local drift | Low | None directly | Does not establish portable migration history | Very high; captures accidental local state | Reject as permanent solution and reject under current no-access rule |

### Recommended permanent design

1. Add a new `migrateFoundation` source file without editing any historical
   migration source.
2. Register it before `migrateUserAddresses`.
3. Make it additive/idempotent and limited to truly foundational tables absent
   from the registry (`users`, registration/reset/session foundations as needed).
4. Add a guarded `db:test:prepare` command that:
   - requires test process context;
   - validates the exact local `*_test` target and explicit mutation opt-in;
   - creates only the approved database while connected with no selected DB;
   - invokes the registered runner, never individual migrations;
   - never reads `nlsite_db` or `schema.sql`.
5. Add fake-pool unit coverage for dependency order and a dedicated empty-test-DB
   integration test only after separate approval.
6. Document the one command for new developers and CI.

This makes the registry the authoritative from-zero path and reduces
`schema.sql` to an export/reference artifact rather than an installation
prerequisite.

## E. Inferred partial state of `nlsite_test`

No database connection was opened for this report. From code order and MariaDB
DDL behavior, the most likely state is:

- `schema_migrations` exists because `ensureMigrationsTable()` runs before the
  registry loop and DDL commits independently;
- one `status='failed'` record for `migrateUserAddresses` likely exists because
  `recordMigrationFailure()` runs in the catch block before the error is
  rethrown;
- the advisory lock is not a table and was released in `finally`;
- `user_addresses` should not exist because its single `CREATE TABLE` statement
  failed atomically while forming the FK;
- no later migration ran;
- no migration seed row should have been inserted;
- no application table should exist unless created as an unexpected side effect
  outside the logged runner path.

Read-only verification queries needed later, but **not executed**, are:

```sql
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'nlsite_test'
ORDER BY TABLE_NAME;

SELECT id, name, status, checksum, duration_ms, error, executed_at
FROM nlsite_test.schema_migrations
ORDER BY id;

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'nlsite_test'
  AND TABLE_NAME IN ('schema_migrations', 'users', 'user_addresses');

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'nlsite_test'
  AND TABLE_NAME IN ('users', 'user_addresses')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

### One-time recovery plan (not executed)

After the foundation migration and its pure tests are approved:

1. run the read-only queries above against the explicitly guarded
   `localhost:3306/nlsite_test` target;
2. do not drop or recreate the database;
3. retain the failed tracker record as incident evidence;
4. run the registered runner once; the tracker ignores failed rows when building
   its successful-migration map, so migration 1 can retry after the new
   foundation succeeds;
5. stop on any warning/error;
6. verify the successful registry set and readiness checks read-only;
7. request separate approval before any DB-backed test.

## F. Current Git scope

There are 55 tracked files with real normalized content diffs, 12 untracked
project files, and 14 historical migration paths reported as modified by
`git status` despite having no normalized Git diff. The groups below classify
every path currently shown by `git status --short` before this report was added.

### 1. Carousel focal-position implementation

- `controllers/adminPanelsController.js`
- `controllers/adminPublishingController.js`
- `public/css/admin-page.css`
- `public/css/home.css`
- `public/js/admin/media-selector.js`
- `public/js/admin/panel2-editor.js`
- `public/js/admin/carousel-image-position.js` (new)
- `services/cmsRepeatableService.js`
- `services/publicationService.js`
- `validators/cmsPanelsValidator.js`
- `views/pages/admin/page/panel2.ejs`
- `views/pages/home.ejs`
- `tests/carousel-image-position.test.js` (new)
- `tests/carousel-persistence.test.js`
- `docs/CAROUSEL_FOCAL_POSITION.md` (new)

These implement normalization, storage, publishing, revision restore, editor
controls, media preview synchronization, public `object-position`, and focal
tests. Several of these files also contain excessive duplication changes; those
hunks are called out in group 6.

### 2. Necessary migration registration and schema readiness

- `schema.sql`
- `scripts/migrate-carousel-image-position.js` (new)
- `scripts/migrationTracker.js`
- `services/cmsSchemaReadinessService.js`

These add migration 35, register it, keep the schema snapshot aligned for the
two focal columns, and require the focal capabilities in CMS readiness.

### 3. Necessary test database isolation

- `.gitignore`
- `.env.test.example` (new)
- `_direct_test.js`
- `_run_suite.js`
- `app.js`
- `config/databaseConfig.js` (new)
- `config/db.js`
- `config/environment.js` (new)
- `config/session.js`
- `config/site.js`
- `config/testBootstrap.js` (new)
- `config/testDatabaseGuard.js` (new)
- `config/testProcessEnvironment.js` (new)
- `package.json`
- `scripts/migrate-deploy.js`
- `scripts/seed-gallery-demo.js`
- `scripts/validate-tilopay-config.js`
- `docs/TEST_DATABASE_SAFETY.md` (new)
- `tests/account.test.js`
- `tests/address-checkout.test.js`
- `tests/catalog-deployment-repair.test.js`
- `tests/cms-admin.test.js`
- `tests/cms-media-production-flow.test.js`
- `tests/cms-panel1-save-regression.test.js`
- `tests/cms-phase11b.test.js`
- `tests/customer-orders.test.js`
- `tests/gallery-demo-seed.test.js`
- `tests/gallery.test.js`
- `tests/login-ui.test.js`
- `tests/migrate-deploy.test.js`
- `tests/phase1f-integration.test.js`
- `tests/phase2a-social-feed.test.js` (also migration-count assertion)
- `tests/phase2b-social-feed-public.test.js`
- `tests/phase2c-social-embeds.test.js`
- `tests/phase2d-testimonials.test.js`
- `tests/phase2ea-social-sync.test.js` (also migration-count assertion)
- `tests/test-database-safety.test.js` (new)
- `tests/testServer.js`
- `tests/upload-path-production.test.js`

The core required safety boundary is the centralized resolver/guard, mandatory
test bootstrap, lazy guarded DB pool, independently guarded session store, and
sanitized child environments. Some loader substitutions are defense in depth
rather than strictly necessary; see group 6.

### 4. Existing tests changed only because the registry count changed

- `tests/cms-phase1c-revision.test.js`
- `tests/phase1g-category-store-hero.test.js`
- `tests/phase1h-about-page.test.js`
- `tests/phase2ea-scheduler.test.js`
- `tests/phase2eb-meta.test.js`
- `tests/phase2ec-tiktok.test.js`
- `tests/phase2ec-tiktok-close.test.js`
- `tests/phase2ed-stabilization.test.js`

Each changes the expected registry length from 34 to 35. The assertions remain
meaningful but are brittle; a future registry-name/set assertion would reduce
unrelated churn.

### 5. Historical migration paths shown as modified

The following 14 paths are `M` in `git status`, but `git diff` reports no content
change and their Git-normalized worktree blob equals the index:

- `scripts/migrate-catalog-seo.js`
- `scripts/migrate-catalog.js`
- `scripts/migrate-category-hero.js`
- `scripts/migrate-cms-phase1a-save-repair.js`
- `scripts/migrate-cms.js`
- `scripts/migrate-gallery.js`
- `scripts/migrate-nav-items.js`
- `scripts/migrate-panels.js`
- `scripts/migrate-publishing.js`
- `scripts/migrate-social-feed.js`
- `scripts/migrate-store-hero-cms.js`
- `scripts/migrate-testimonials.js`
- `scripts/migrate-user-addresses.js`
- `scripts/migrate-user-profile.js`

For every file in this list:

- reason shown modified: CRLF/worktree stat normalization, not an executable SQL
  or dependency-injection edit;
- required: no; these paths should remain historically immutable;
- revertability: no semantic revert is needed because normalized content already
  equals the index; line-ending normalization must be handled deliberately due
  to raw checksum implications;
- development/production impact: SQL is unchanged, but raw-byte checksums can
  differ by checkout;
- coverage: checksum determinism is covered by
  `tests/migrate-deploy.test.js`, but EOL invariance is not.

### 6. Unrelated or avoidable modifications

| File/hunk | Why changed | Required for focal/test safety? | Can be reverted while preserving safety? | Runtime impact | Coverage |
|---|---|---|---|---|---|
| `routes/adminPanelsRoutes.js` duplicate route | Adds carousel duplication | No; duplication is outside focal positioning | Yes | New admin POST endpoint | Persistence test only; no focused route/CSRF behavior test shown |
| `controllers/adminPanelsController.js` `duplicateCarouselItem` | Handles duplicate route | No | Yes, while retaining focal create/save normalization | Adds admin mutation behavior | Persistence-level duplicate coverage only |
| `services/cmsRepeatableService.js` `duplicateCarouselItem` | Copies item/media/focal values | No | Yes, while retaining focal normalization/publishing | New transaction, reorder, insert, revision behavior | `carousel-persistence.test.js` |
| `views/pages/admin/page/panel2.ejs` duplicate form/button | Exposes duplication UI | No | Yes, while retaining focal editor | Adds UI and CSRF-bearing action | No browser validation |
| `tests/carousel-persistence.test.js` duplicate scenario | Covers unrelated duplicate feature | No | Yes | Test-only | It is the coverage |
| `docs/CAROUSEL_FOCAL_POSITION.md` duplication promises | Documents extra behavior | No | Yes | None | N/A |
| `controllers/adminPublishingController.js` global per-type restore allowlist | Broadens revision-restore hardening beyond focal keys | Not necessary for focal support; only `position_x/y` handling is needed | Likely, after a focused security review | Changes which fields restore for every repeatable entity type | Focal test checks normalization; no complete restore-field parity test identified |
| `app.js`, `config/site.js`, `scripts/seed-gallery-demo.js`, `scripts/validate-tilopay-config.js` loader substitutions | Route environment loading through `config/environment` | Defense in depth, not the irreducible guard | Potentially, because the test bootstrap intercepts legacy `dotenv.config()`; verify statically/tests before reverting | Development/production env-loading path changes but intended precedence remains equivalent | Safety tests cover loader selection, not every executable |
| `_direct_test.js` | Uses bootstrap instead of `.env` | Useful safety for manual helper, but not part of package scripts | Yes if helper is removed or explicitly deprecated; unsafe to restore old `.env` load | Test helper only | No dedicated test |

No other true content diff was identified as unrelated to either focal positioning
or the incident-driven safety boundary.

### 7. Files that can affect development or production runtime

| File | Reason/requirement | Revertability and runtime impact | Coverage |
|---|---|---|---|
| `app.js` | Selects environment through shared loader | Potentially avoidable; intended non-test behavior remains `.env`, but startup loading changed | Indirect server tests only |
| `config/db.js` | Lazy pool plus mandatory test guard | Required unless replaced by an equivalent pre-connection guard; changes pool initialization/close behavior in all environments | Safety tests and DB-backed suites, latter not rerun yet |
| `config/session.js` | Guards the session store's independent DB connection | Required because it bypasses `config/db`; dev/prod options should resolve equivalently | Child-server suites pending |
| `config/site.js` | Shared environment loader | Avoidable defense in depth; changes load path, not intended values | No focused production precedence test |
| `config/databaseConfig.js` | Central resolver and test guard integration | Required; non-test defaults remain `localhost/root/nlsite_db` | Safety unit tests |
| `config/environment.js` | Separates `.env.test` from `.env` | Required centrally; non-test uses `.env` | Safety unit tests |
| `controllers/adminPanelsController.js` | Persists focal axes; also unrelated duplicate handler | Focal hunks required; duplicate hunks removable | Pure focal plus persistence tests |
| `controllers/adminPublishingController.js` | Normalizes old/current carousel revisions | Focal normalization required; broad allowlist needs narrowing review | Pure focal revision test; broader restore parity not covered |
| `package.json` | Makes bootstrap mandatory for `test`/`check` | Required for supported test entrypoints; production scripts unchanged | Static runner test |
| `public/css/admin-page.css` | Focal editor and preview positioning | Required UI behavior | Static/unit checks; no browser validation |
| `public/css/home.css` | Applies public focal CSS variables | Required public behavior | Static/persistence coverage; no browser validation |
| `public/js/admin/media-selector.js` | Emits scoped media-change events | Required for focal preview lifecycle | Static focal scoping test and selector tests |
| `public/js/admin/panel2-editor.js` | Focal controls, drag, reset, dynamic editor binding | Required | Pure focal tests; browser validation pending |
| `public/js/admin/carousel-image-position.js` | Shared normalization and drag math | Required | Pure focal unit tests |
| `routes/adminPanelsRoutes.js` | Adds duplicate endpoint only | Unrelated and removable | No focused route test |
| `schema.sql` | Adds focal columns to schema snapshot | Required only if snapshot remains maintained; does not make it safe for test bootstrap | Static schema assertions |
| `scripts/migrate-deploy.js` | Dependency injection/lazy production dependencies | Required to keep runner tests off the DB; default production path remains registered runner | Isolated fake-runner tests |
| `scripts/migrationTracker.js` | Registers migration 35 and injects catalog readiness for tests | Registry entry required; injection is testability support with unchanged default path | Migration-runner tests |
| `scripts/migrate-carousel-image-position.js` | Adds/backfills focal fields | Required | Fake-pool migration tests plus prior local migration evidence |
| `scripts/seed-gallery-demo.js` | Shared environment loader | Avoidable defense in depth; seed policy otherwise unchanged | Seed safety test |
| `scripts/validate-tilopay-config.js` | Shared environment loader | Avoidable defense in depth; validation logic unchanged | Production/static tests |
| `services/cmsRepeatableService.js` | Draft/published focal authority; also duplication | Focal portions required, duplication removable | Pure/persistence tests |
| `services/cmsSchemaReadinessService.js` | Requires both focal columns | Required to prevent runtime on incomplete schema | Fake readiness tests |
| `services/publicationService.js` | Uses normalized snapshot helper | Required for consistent published authority | Publishing/persistence tests pending DB rerun |
| `validators/cmsPanelsValidator.js` | Normalizes submitted axes | Required | Pure normalization tests |
| `views/pages/admin/page/panel2.ejs` | Focal editor; also duplicate UI | Focal portion required, duplicate form removable | Static tests; browser pending |
| `views/pages/home.ejs` | Supplies public focal CSS variables | Required | Static/persistence tests; browser pending |

## G. Historical migration checksum risk

### Resolving the apparent contradiction

The earlier statement that historical executable migration content was unchanged
is **semantically correct**, but an unqualified statement that their checksums
are unchanged is **not safe** in the current checkout.

Static byte comparison found:

- all 34 historical registered migration sources match `HEAD` after normalizing
  CRLF to LF;
- therefore no historical SQL, control flow, dependency injection, or guard
  plumbing was actually added to those files;
- 29 of the 34 current worktree files have CRLF bytes while the `HEAD` blobs use
  LF;
- `computeChecksum()` hashes the raw string read by `fs.readFileSync`, so those
  29 raw SHA-256 values differ solely because of line endings.

The 29 raw-byte-different historical sources are:

- `migrate-user-addresses`, `migrate-user-profile`, `migrate-cms`,
  `migrate-nav-items`, `migrate-panels`, `migrate-publishing`,
  `migrate-cms-draft-publish`, `migrate-catalog`, `migrate-orders`,
  `migrate-tilopay`, `migrate-category-hero`, `migrate-gallery`,
  `migrate-payment-proofs`, `migrate-tracking`, `migrate-catalog-seo`,
  `migrate-gallery-youtube`, `migrate-cms-phase1a-save-repair`,
  `migrate-revision-source-id`, `migrate-store-hero-cms`,
  `migrate-social-feed`, `migrate-testimonials`,
  `migrate-social-integrations`, `migrate-social-sync-runs`,
  `migrate-social-posts-import-fields`, `migrate-social-token-secrets`,
  `migrate-social-oauth-states`, `migrate-seed-meta-integrations`,
  `migrate-seed-tiktok`, and `migrate-social-posts-provider-thumbnail`.

Five historical sources retain byte-identical LF content:
`migrate-cms-homepage-fields`, `migrate-catalog-schema-repair`,
`migrate-category-store-hero`, `migrate-about-page-cms`, and
`migrate-social-feed-home-section`.

### Per-file policy conclusion for the 14 status-visible paths

For each of the 14 files in group 5:

- executable SQL changed: **No**;
- dependency injection/guard plumbing changed: **No**;
- Git-normalized registered source changed: **No**;
- raw current-checkout checksum changed relative to the LF `HEAD` blob: **Yes**;
- production reconciliation triggered: **No**. A checksum mismatch causes an
  immediate error before migration/reconciliation. `reconcileOnDrift` applies
  only to catalog capability drift after the checksum matches;
- migration-policy violation: there is no semantic historical rewrite to merge,
  but allowing platform line endings to alter recorded checksums is an unresolved
  tooling/policy hazard and must be fixed before another migration execution.

A normal Git commit would not include these 14 as content changes because their
normalized blobs are unchanged. However, the local raw-byte checksum behavior
still matters whenever the runner compares against records created from LF
files. Do not “fix” this by casually changing `computeChecksum()`: existing
records may contain either raw-LF or raw-CRLF hashes. A compatibility design and
explicit tests are required.

`scripts/migrate-deploy.js` and `scripts/migrationTracker.js` have real diffs,
but neither is itself a registered migration source. Migration 35 is new and has
no historical checksum to preserve.

## Historical-test findings

- The old `tests/migrate-deploy.test.js` imported the real pool and launched the
  live runner twice. The corrected test now injects fakes and cannot execute SQL.
- The corrected runner test models tracker-table SQL, successful/failed records,
  catalog reconciliation, runner idempotency, and registry count, but does not
  prove a full empty-database bootstrap.
- `tests/catalog-deployment-repair.test.js` proves from-zero creation only for
  the catalog subsystem.
- Schema-oriented tests assert selected `schema.sql` columns/tables but do not
  import the baseline and run all migrations.
- No test currently asserts that migration 1's referenced foundation exists or
  that every registry dependency is satisfied from an empty database.

## Next proposed commands — not executed

The following are proposals only. They require a new approval after the code
design is accepted.

```text
# Pure/static validation after implementing a foundation migration:
node --require ./config/testBootstrap.js --test tests/test-database-safety.test.js
node --require ./config/testBootstrap.js --test tests/migrate-deploy.test.js
node --require ./config/testBootstrap.js --test tests/database-bootstrap.test.js

# Later read-only inspection of the existing partial test DB:
# (execute a guarded inspection script against localhost:3306/nlsite_test only)

# Later one-time registered recovery, only after read-only inspection:
node --require ./config/testBootstrap.js scripts/migrate-deploy.js
```

No command above was executed during this analysis.

## Concise answers

1. **Why did `migrateUserAddresses` fail?** It created a foreign key from
   `user_addresses.user_id` to `users.id`, but `users` did not exist in the new
   empty database. The compatible column/engine definitions rule out a type or
   collation mismatch.
2. **Can migrations alone initialize an empty DB?** No. The 35-entry registry
   lacks a foundational `users` migration.
3. **Is `schema.sql` currently required as a baseline?** Some equivalent
   baseline is required today, and `schema.sql` is the only repository artifact
   that provides it. The file itself is unsafe unchanged because it selects
   `nlsite_db`, and it is not a clean permanent baseline.
4. **Were historical migration checksums altered?** No historical SQL content
   changed, but 29 worktree files have CRLF bytes that change the tracker's raw
   SHA-256 relative to LF `HEAD`. This is a real checksum hazard.
5. **Which changes are excessive?** Carousel duplication, the broad revision
   restore allowlist, and several defense-in-depth loader substitutions exceed
   the irreducible focal/test-safety scope.
6. **Single safest next step:** without touching either database, design and
   review a new additive foundational migration plus guarded one-command test DB
   preparation, while resolving the raw-EOL checksum compatibility policy before
   any migration is run again.
