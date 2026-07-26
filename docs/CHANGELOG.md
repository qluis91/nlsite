# Changelog

## 2026-07-25 — Phase 11D: Centralized publishing, revision history, comparison, and restore

### Added
- Centralized publishing dashboard (`GET /admin/page/publishing`) with 7 module status cards
- Module registry (`services/moduleRegistry.js`) declaring keys, labels, sources, validators, dependencies, and cache namespaces for all 7 CMS modules
- Atomic batch publication via `publicationService.publishModules()` with transactional rollback
- Selected-module publication (`POST /admin/page/publishing/publish-selected`)
- Full-homepage publication (`POST /admin/page/publishing/publish-home`)
- `publication_batches` and `publication_batch_items` tables tracking every publish event
- History browser (`GET /admin/page/history`) with module/action filters and pagination
- Revision detail view (`GET /admin/page/history/revision/:id`) with field-level change detection
- Revision comparison (`GET /admin/page/history/compare?from=X&to=Y`) with safe JSON rendering
- Safe restore: restore-as-draft and restore-and-publish via `POST /admin/page/history/revision/:id/restore`
- 6 new capabilities: `cms.publishing.view`, `cms.publishing.publish`, `cms.history.view`, `cms.history.compare`, `cms.history.restoreDraft`, `cms.history.restorePublish`
- All new routes behind `isAuthenticated`, `isAdmin`, capability middleware, and CSRF
- EJS views: `publishing/index`, `history/index`, `history/detail`, `history/compare`, `history/restore`
- CSS: Phase 11D publishing dashboard styles, module cards, badges, tables, forms

### Changed
- `controllers/adminPageController.js`: publishing module activated (`status: 'active'`, `href: '/admin/page/publishing'`)
- `config/capabilities.js`: 6 new capabilities added
- `app.js`: fixed line break between `adminPanelsRoutes` and `accountAvatarRoutes`; added `adminPublishingRoutes`
- `scripts/migrate-all.js`: added `migratePublishing` call

### Schema
- New tables: `publication_batches` (public_id, scope, status, summary, created_by, published_by, timestamps, failure_reason) and `publication_batch_items` (batch_id, module_key, entity_type, source/published revision FKs, snapshots, status)
- Migration: `scripts/migrate-publishing.js` — idempotent, additive
- `schema.sql` synchronized

### Tests
- `tests/cms-phase11d.test.js`: 75 tests covering migration, registry, capabilities, publication service, controller/routes, EJS compilation, history, comparison, restore, preview, cache invalidation, concurrency, authorization, and regression

## 2026-07-25 — Direct upload and WebP quality 80 standardization (Phase 11C-S continuation)

### Added
- Unified direct-upload experience in media selector: "Seleccionar de la biblioteca" + "Subir desde mi dispositivo" tabs
- Drag-and-drop zone, file picker, upload progress, Spanish errors, auto-select after successful upload
- AJAX upload endpoint `POST /admin/api/page/media/upload` with capability check, CSRF, Multer (memoryStorage, 30MB max)
- `mediaService.createFromSelectorUpload()` — transactional asset creation with duplicate detection (returns existing)
- Upload profiles configuration in `config/cmsOptions.js`: 15 profiles (navbar-logo, hero-background, logo-loop, carousel-main, feature-icon, gallery, product, category, avatar, etc.)
- Server-side profile validation: MIME enforcement, size limits, kind (image/model) restrictions per profile
- Tests for shared pipeline quality, upload profiles, selector upload flow, route existence, JS/EJS structure

### Changed
- All sharp quality settings unified to WebP quality 80: `IMAGE_VARIANTS` (large/medium/thumbnail), `imageProcessingService.PROFILES` (product/avatar/gallery/category), `galleryOptions.IMAGE_PROFILES` (display/thumbnail/poster)
- `media-selector.ejs`: added tabs, upload panel with drag-drop zone, file picker, progress, error display
- `media-selector.js`: added upload tab switching, `handleFile()`, `performUpload()`, `updatePreview()`, `resetUpload()`
- All media-selector EJS includes updated with `uploadProfile` parameter: navbar.ejs (4×), panel1.ejs (3×), panel2.ejs (3×), panel3.ejs (1×)
- `views/components/media-selector.ejs`: new template with tabs for library/upload panels

### Security
- Server-side profile validation never trusts client-supplied profile/MIME alone
- CSRF required on upload endpoint, capability-enforced (`media.upload`)
- Path containment via `mediaStorageService`, no filesystem paths in JSON responses
- File validation: decoded content (Sharp metadata), not extension/MIME alone

### Not modified
- Payment proofs: unchanged (private flow, quality 86, `UPLOAD_PROOFS_DIR`)
- GLB uploads: remain GLB-only, no Sharp processing
- SVG: remains disabled (no sanitizer)

## 2026-07-25 — CMS Phase 11C-S: Stabilization and integration

### Fixed
- `saveItem updates fields` test: fixed destructuring bug (`const [rows] = ...` → `const items = ...`)
- `home-panel-transition` test: updated expected card count from 4 to 5 (CMS branch adds one template line)
- `saveItem` revision data: `previousData` now correctly records old row, `newData` records merged result
- Test suite: all 486 tests pass (Phase 11A + 11B + 11C), 0 failures

### Added
- Visual media selector integration into Navbar admin (logo_primary, logo_light, logo_dark, favicon)
- Visual media selector integration into Panel 1 admin (background_media, model_media, model_fallback)
- `resolveMediaData()` helper in `adminPageContentController.js` for media ref pre-population
- `pageScripts` support in admin layout for non-module script loading
- Public Panel 3 CMS feature items integration via `servicesCarousel.mjs` with JSON data block
- `resolveServiceItems()` function with safe fallback for unknown icons and zero items
- Panel 2/3 draft preview with preview banner, no-cache/noindex, draft repeatable items
- `_previewCms` variable in `home.ejs` merging published CMS + preview draft data

### Changed
- `views/layouts/admin.ejs`: added `pageScripts` slot
- `views/pages/admin/page/navbar.ejs`: replaced text inputs with media-selector component
- `views/pages/admin/page/panel1.ejs`: replaced text inputs with media-selector component
- `views/pages/home.ejs`: added preview mode, `_previewCms` variable, services CMS JSON block
- `public/js/home/servicesCarousel.mjs`: added `resolveServiceItems()` reading from JSON block
- `controllers/adminPageContentController.js`: added `resolveMediaData`, updated `showNavbar`/`showPanel1`
- `services/cmsRepeatableService.js`: fixed `saveItem` revision data
- `tests/cms-phase11c.test.js`: fixed saveItem test, enhanced revision assertion
- `tests/home-panel-transition.test.js`: updated card count assertion
- `docs/CMS_PHASE_11C.md`, `docs/PROJECT_STATUS.md`: added stabilization documentation

## 2026-07-25 — CMS Phase 11C: Panel 2, Panel 3 y Visual Media Selector

### Added
- Reusable visual media selector: `views/components/media-selector.ejs` (EJS partial) + `public/js/admin/media-selector.js` (vanilla JS, lazy thumbnails, search/filter/pagination), API endpoint `GET /admin/api/page/media`
- Panel 2 (Showcase) editor at `/admin/page/home/panel-2` with tabs: General content, LogoLoop, Carousel, Appearance
- Panel 3 (Services) editor at `/admin/page/home/panel-3` with tabs: General content, Cards, Appearance
- `logo_loop_items` table with types `text|image|logo`, UUID public_ids, soft-delete, sort_order, draft/published/archived workflow, idempotent seed of 6 current text items
- `home_carousel_items` table with theme keys `graphite|lime|silver|ink`, UUID public_ids, image refs, idempotent seed of 4 current projects
- `home_feature_items` table with builtin icon keys or media-based icons, UUID public_ids, style variants, idempotent seed of 6 current services
- `services/cmsRepeatableService.js`: generic CRUD for repeatable items (create/save/archive/reorder/publishCollection), media usage registration
- `validators/cmsPanelsValidator.js`: text limits, URL validation, color format, item type enums, ALLOWLIST-based validation
- `controllers/adminPanelsController.js`: Panel 2/3 draft saves, collection publishes, LogoLoop item CRUD, Carousel item CRUD, Feature item CRUD
- `routes/adminPanelsRoutes.js` mounted under `/admin` behind auth + capabilities + CSRF
- Admin views: `views/pages/admin/page/panel2.ejs`, `views/pages/admin/page/panel3.ejs`
- Public integration: `home.ejs` renders Panel 2 LogoLoop items, carousel items, headings/text from CMS with hardcoded fallbacks; Panel 3 headings from CMS
- New capabilities: `home.showcase.view/edit/publish`, `home.logoLoop.edit/publish`, `home.carousel.edit/publish`, `home.services.view/edit/publish`
- Cache namespaces: `section_home_showcase`, `logoLoop_home`, `carousel_home`, `section_home_services`, `features_home`
- Extended preview route to include Panel 2/3 draft content
- Idempotent migration `scripts/migrate-panels.js` (wired into `npm run migrate`)
- `tests/cms-phase11c.test.js`: 37 tests covering migration, validators, CRUD, capabilities, media usage, publishing

### Changed
- `config/capabilities.js`: added 10 Phase 11C capabilities
- `config/cmsOptions.js`: added `logo_loop_item`, `carousel_item`, `feature_item` to REVISION_ENTITY_TYPES
- `controllers/adminPageController.js`: activated Panel 2 and Panel 3 modules in overview with item counts
- `controllers/adminPageContentController.js`: extended preview to include Panel 2/3 data
- `controllers/adminMediaController.js`: added `mediaBrowse` JSON API endpoint
- `routes/adminPageRoutes.js`: added `/api/page/media` JSON browse endpoint
- `app.js`: wired panel routes, registered panel usage sources, extended home route for Panel 2/3 CMS data
- `schema.sql`: added `logo_loop_items`, `home_carousel_items`, `home_feature_items` tables
- `public/css/admin-page.css`: added media selector modal, tabs, table, card preview styles

## 2026-07-24 — CMS Phase 11B: Navbar y Panel 1 (Hero) administration

### Added
- Navbar editor at `/admin/page/navbar` with logo/favicon selectors (`media://` references), color pickers (#RRGGBB), opacity/logo-width controls, and sortable nav-link list.
- Panel 1 (Hero) editor at `/admin/page/home/panel-1` with text inputs (eyebrow/heading/description, character counters), button CTAs (URL/target/visibility), media selectors for model/fallback/background, model config (scale/position/rotation/auto-rotate/speed, bounded numeric controls).
- `navigation_items` table with UUID public_ids, FKs, indexes on (location, status, sort_order), idempotent seed of current hardcoded navbar links.
- Idempotent migration `scripts/migrate-nav-items.js` (wired into `npm run migrate`).
- `services/cmsPublishingService.js`: draft/publish lifecycle for page sections, site settings and navigation items, with transactional revisions, in-memory read cache per namespace, and cache invalidation on publish.
- `validators/cmsPageValidator.js`: URL (safe protocols, reject `javascript:`/`data:`/protocol-relative), color (#RRGGBB/#RRGGBBAA), target (_self/_blank), bounded numerics, text length limits, media ref UUID format.
- `controllers/adminPageContentController.js`: navbar settings save, nav-item CRUD/reorder/archive, section draft save/publish, authenticated preview.
- `routes/adminPageContentRoutes.js` mounted under `/admin` behind isAuthenticated + isAdmin + capability checks.
- Admin views: `views/pages/admin/page/navbar.ejs`, `views/pages/admin/page/panel1.ejs`.
- Public integration: `home.ejs` and `home-navbar.ejs` resolve published CMS content with hardcoded fallbacks; `helmet3d.js` reads model config from DOM `data-*` attributes.
- 6 new capabilities: `navbar.view/edit/publish`, `home.hero.view/edit/publish`.
- 36 focused tests covering migration/schema, capabilities, validators, nav CRUD, hero draft/publish, cache, revisions, usage sources.
- Overview module cards for Navbar and Panel 1 activated with real links.
- `docs/CMS_PHASE_11B.md` documentation.

### Changed
- `home.ejs`: Panel 1 texts/buttons now come from CMS with fallback to hardcoded values; model config serialized as `data-model-config`.
- `home-navbar.ejs`: Logo and nav links resolve from CMS; hardcoded navbar preserved as fallback.
- `helmet3d.js`: model URL and config read from DOM; single renderer/canvas/RAF lifecycle preserved.
- `app.js`: home route resolves CMS content; nav usage source registered at startup.
- `config/capabilities.js`: added navbar and hero capabilities.

### Added
- Admin navigation entry `Administrar página` with an overview page at `/admin/page` showing media aggregates and cards for the modules of later phases (navbar, Panel 1/2/3, publishing) that are labelled and deliberately not linked.
- Media library at `/admin/page/media` with server-side search, category/type/status filters, pagination, lazy thumbnail grid, detail view with usage and revision history, metadata editing, file replacement, archive and restore.
- Idempotent, additive migration `scripts/migrate-cms.js` (wired into `npm run migrate`) creating `media_assets`, `pages`, `page_sections` and `content_revisions`, extending the existing `site_settings` table with `value_type`, `setting_group`, `is_public`, `updated_by` and `created_at`, and transactionally seeding the `home` page plus `hero`/`showcase`/`services` sections as disabled drafts.
- `services/mediaStorageService.js`: containment-checked path resolution, `category-timestamp-randomhash` filenames, never-overwrite writes, content-based validation, Sharp variants (2560/1280/400 WebP, no upscaling, metadata stripped, animated images rejected) and GLB header/JSON-chunk validation with model metadata.
- `services/mediaService.js`: transactional create/update/replace/archive/restore with SHA-256 duplicate detection, bounded-concurrency batch uploads with partial-success reporting, and file compensation on every failure path.
- `services/mediaUsageService.js` with the `media://<public_id>` reference token, built-in `page_sections`/`site_settings` scanning and a `registerUsageSource` hook for later phases.
- `services/contentRevisionService.js` writing allowlisted metadata snapshots for upload, metadata edit, replacement, archive and restore.
- `services/cmsContentService.js` fallback-first readers for pages, sections, settings and media references, ready for Phase 11B.
- `config/capabilities.js` plus `middlewares/capabilityMiddleware.js` mapping `page.manage` and the `media.*` capabilities to the existing database admin role.
- 35 focused tests covering schema/index/foreign-key/seed idempotency, soft deletion, upload validation, GLB validation, traversal resistance, duplicate detection, partial batch failures, CRUD, replacement identity, usage-based archive blocking, filters/pagination, aggregates, authorization, CSRF and public-serving headers.
- `docs/CMS_PHASE_11A.md` documenting scope, tables, storage layout, limits, migration and rollback notes, security and known limitations.

### Architecture
- Media files live under `<UPLOAD_PUBLIC_DIR>/media/{site,gallery,logos,carousel,icons,models,other,thumbnails}` and are served read-only at `/uploads/media/`; MySQL stores metadata only and no Railway path is hardcoded.
- Multipart routes run multer before `csrfSynchronisedProtection`, matching the established catalog/gallery/payment-proof order.
- No dependency was added; Sharp, multer, EJS and the existing admin layout are reused.

### Unchanged
- Product, category, avatar, gallery and payment-proof uploads keep their own services and directories.
- Seeded sections stay disabled drafts, so the public homepage still renders its hardcoded content.
- SVG upload stays disabled (no vetted sanitizer dependency) and physical deletion is not implemented; archive is the only destructive action.

## 2026-07-23 - Gallery Phase 4: Infinite Menu

### Added
- Allowlisted `view=infinite` URL mode alongside Grid, Circular, and Ring, with filter and pagination preservation.
- Native JavaScript WebGL 2 Infinite Menu renderer adapted from the InfiniteMenu reference concept, with zero framework dependency.
- Icosahedron sphere geometry (one subdivision) with 42 disc instances distributed over the sphere surface.
- Disc geometry (56 radial segments) with instanced rendering via `drawElementsInstanced` and `vertexAttribDivisor`.
- Texture atlas generation from gallery thumbnails only (no source/poster used), with bounded cell sizing respecting `MAX_TEXTURE_SIZE`, aspect-cover drawing, broken-thumbnail placeholders, and 15-second timeout safety.
- Arcball pointer controls with two-axis dragging, pointer capture, projection to virtual sphere, angular velocity inertia with damping, and nearest-front-item snapping.
- Keyboard controls (ArrowLeft/Right/Up/Down, Home, End, Enter, Space) and scoped wheel input.
- Complete renderer lifecycle: pause, resume, resize (ResizeObserver), visibility pausing, intersection pausing, context-loss fallback, and idempotent destroy clearing all GL resources, listeners, observers, and timers.
- Active-item HTML overlay with textContent, debounced aria-live announcements, and shared modal integration by stable original item ID.
- Capability checks for WebGL 2, MAX_TEXTURE_SIZE ≥ 1024, MAX_VERTEX_ATTRIBS ≥ 8, and reduced-motion preference.
- Four-mode selector: Cuadrícula, Galería circular, Carrusel 3D, Menú infinito.
- Added `gl-matrix@3.4.3` as the only new dependency for vector/quaternion/matrix operations.
- Focused Phase 4 URL, static integration, CSS namespacing, WebGL-2 capability, instanced-rendering, geometry, atlas-strategy, DOM-safety, input-scope, lifecycle, arcball-control, keyboard, and accessibility tests (17/17 pass).

### Architecture
- Reused the bounded Phase 1 public JSON and the single shared image/video modal.
- Kept Grid server-rendered and usable without JavaScript; exactly one enhanced renderer can own the page at a time.
- Added gl-matrix as a local vendor module copied to `public/vendor/gl-matrix/`.
- No React, OGL, GSAP, Three.js, Tailwind, shadcn, or TypeScript added.

### Deferred
- Real-browser Infinite Menu validation pending when interactive Chrome/Edge backend is available.

## 2026-07-23 - Gallery Phase 3: Ring Gallery and local demo data

### Added
- Allowlisted `view=ring` URL mode alongside Grid and Circular, with filter and pagination preservation.
- Native CSS 3D Ring renderer with responsive geometry, thumbnail-only cards, pointer capture, drag inertia, nearest-card snapping, keyboard controls, scoped wheel input, depth/parallax treatment, active metadata, and shared-modal actions by stable item ID.
- Idle-only RAF scheduling, visibility/intersection pausing, resize handling, and idempotent listener/observer/timer/card teardown under the existing single-renderer mode manager.
- Controlled grid fallbacks for reduced motion, missing CSS 3D support, empty data, broken thumbnails, and initialization errors.
- Explicit idempotent `node scripts/seed-gallery-demo.js` workflow that generates 15 local WebP compositions through Sharp, plus prefix-scoped `--clean` and `--reset` operations and a default production block.
- Focused Ring geometry, lifecycle, input, DOM-safety, mode-manager, seed rollback, idempotency, media-integrity, cleanup-isolation, and production-guard tests.

### Architecture
- Reused the bounded Phase 1 public JSON and the single shared image/video modal.
- Kept Grid server-rendered and usable without JavaScript; exactly one enhanced renderer can own the page at a time.
- Added no dependency, schema change, admin surface, CDN, remote media, startup hook, React, GSAP, OGL, or Three.js code.

### Deferred
- Infinite Menu remains future work.
- Real-browser Ring Gallery validation remains pending when no interactive Chrome or Edge backend is available.

## 2026-07-23 — Gallery Phase 2: Circular Gallery

### Added
- Grid/Circular visualization selector with allowlisted `view=grid` and `view=circular` URLs; category, media type, and pagination preserve the active view.
- Native JavaScript/WebGL Circular Gallery adapted from the ReactBits component, configured with `bend: 0`, cover-cropped thumbnail textures, canvas labels, rounded cards, movement deformation, inertia, snapping, and infinite cycles.
- Container-scoped pointer/touch drag, wheel, ArrowLeft/ArrowRight, Home, Enter, and Space controls plus a semantic active-item overlay and polite debounced announcements.
- Loading, broken-thumbnail placeholder, no-WebGL, initialization-error, conservative-device, context-loss, empty-data, and reduced-motion fallback paths.
- Complete renderer pause/resume/resize/idempotent-destroy lifecycle with visibility and intersection pausing, ResizeObserver, resource disposal, page-hide cleanup, and DPR capped at 2.
- Focused Phase 2 URL, static integration, source-security, input-scope, shader, thumbnail-only, modal-reuse, and lifecycle tests.

### Architecture
- Reused the Phase 1 bounded published JSON contract and shared image/video modal by stable item ID.
- Circular mode uses `thumbnail` only; video `source` and `poster` are not assigned to WebGL and video playback remains modal-only.
- Chose the allowed native-WebGL adaptation because OGL was absent, the gallery has no bundler, and `node_modules` must not be exposed. No dependency, vendor alias, CSP permission, React, GSAP, or gl-matrix was added.
- Grid remains server-rendered and is hidden only after a successful first circular render.

### Deferred
- Infinite Menu and 3D Ring Carousel remain Phase 3 work.
- Real-browser Circular Gallery validation remains pending when no interactive Chrome or Edge backend is available.

## 2026-07-23 — Gallery Phase 1

### Added
- Public `/galeria` page with database category/media filters, bounded pagination, responsive fallback grid, empty/broken-media states, and NinjaLab visual styling.
- MySQL-backed `gallery_categories` and `gallery_items` tables with an additive idempotent migration and synchronized `schema.sql`.
- Administrator category and gallery-item CRUD, publication/featured toggles, sort order, search/filtering, and protected deletion.
- Memory-based Multer upload flow for JPEG/PNG/WebP images and local MP4/WebM videos.
- Sharp display-image, poster, and 512×512 thumbnail processing with random filenames and controlled storage roots.
- One shared accessible image/video modal with Escape/arrows, focus trapping/restoration, scroll locking, and video pause on close.
- Safe future-renderer JSON contract plus focused migration, media-security, CRUD, public-route, CSRF, XSS, and lightbox tests.
- `docs/GALLERY_ARCHITECTURE.md` with storage, publication, deletion, accessibility, performance, and future-phase boundaries.

### Security
- Admin multipart ordering is authentication → Multer → centralized CSRF → controller.
- Gallery writes and deletions resolve only inside allowlisted gallery roots; traversal, absolute paths, client paths, and incompatible roots are rejected.
- Create/update failures compensate only newly generated files; old media is deleted only after a successful database commit.
- Video validation is intentionally limited to MIME, extension, size, and basic MP4/WebM signature checks; no transcoding or automatic poster extraction is claimed.

### Deferred
- Infinite Menu, Circular Gallery, 3D Ring Carousel, WebGL/OGL, direct-item URLs, swipe gestures, transcoding, and automatic video thumbnail extraction.
- Real-browser gallery validation remains pending when no interactive browser backend is available.

## 2026-07-23 — Localized 3D Model Loading Animation

### Changed
- **Full-page intro animation disabled by default** — set `ENABLE_PAGE_INTRO = true` in `views/pages/home.ejs` to restore the legacy loading video; markup and `pageLoader.js` preserved intact for future reactivation
- **SpinnerMorph adapted from React to native SVG/SMIL** (`views/partials/spinner-morph.ejs`) — no React, Tailwind, shadcn, or framework dependency; preserves the exact 3-state path sequence from the published component, with `<animateTransform>` rotation + `<animate attributeName="d">` path morphing
- **Loader localized to 3D viewer area** — only `.hero-3d` shows the spinner; page content (navbar, hero text, CTAs, social links) renders immediately
- **3D model state machine** — `data-model-state` on `.hero-3d` with `loading` → `ready` → `error`; transitions between spinner visibility and canvas opacity
- **Error state with retry** — displays "No fue posible cargar el modelo 3D." with a "Reintentar" button that disposes of failed renderer resources before restarting
- **Reduced-motion support** — SVG SMIL animations paused via `svg.pauseAnimations()` when `prefers-reduced-motion: reduce`; CSS transitions shortened

### Added
- `views/partials/spinner-morph.ejs` — reusable native SVG component accepting `size`, `fill`, `bg`, `rotateDur`, `morphDur`, `className`
- Exact SpinnerMorph source fixture and deterministic rendered-value equality/hash regression test
- `data-model-state`, `aria-busy`, `role="status"`, `aria-live="polite"` accessibility attributes on loader
- Model-ready canvas fade-in transition (450ms opacity)

### Preserved
- Legacy `pageLoader.js`, page-loader markup (conditionally rendered via `ENABLE_PAGE_INTRO`), `hero-loader-spinner` CSS, and `body.page-home.is-page-loading` rule all remain in codebase
- No dependencies added; no React, Tailwind, shadcn, or TypeScript introduced
- No production code outside homepage affected

## 2026-07-23 — Tilopay Test Hardening and Authoritative Payment Verification

### Added
- **Centralized `verifyTilopayPayment`** operation — single authoritative payment-verification path used by browser return, customer verify, guest verify, admin reconciliation, and webhook/notification processing
- **Customer verification route**: `POST /cuenta/pedidos/:ref/tilopay/verificar` (CSRF, ownership, PRG)
- **Guest verification route**: `POST /consultar-pedido/:ref/tilopay/verificar` (CSRF, guest grant, PRG)
- **`normalizeTilopayAmount`** helper — canonicalizes provider amounts from any representation
- **"Verificar estado del pago" button** in customer order detail view for pending/unknown transactions
- **48 hardened tests** with exact per-scenario assertions (replaced all broad 200|302|404 lumps)

### Changed
- `services/tilopayService.js`: `verifyTilopayPayment` → loaded local transaction → provider lookup → amount/currency validation → `confirmPayment` → returns provider-neutral result contract with `messageCode`, `customerMessage`, `orderPaid`, `retryAllowed`
- `controllers/tilopayController.js`: `returnFromTilopay` now uses `verifyTilopayPayment` (not ad-hoc reconciliation); added `verifyPayment` and `verifyPaymentGuest` actions; `adminReconcile` uses `verifyTilopayPayment`
- `routes/tilopayRoutes.js`: added customer/guest verification routes
- `views/pages/customer-order-detail.ejs`: verification button for pending/creating/unknown Tilopay transactions

### Fixed (Tests)
- Removed all permissive assertions: `[200, 302, 404].includes()`, `res.s === X || res.s === Y`, `res.s === X || res.s === Y || res.s === Z`
- Every HTTP scenario has exact expected status + redirect `Location` validation + body content assertion
- Return/cancel routes tested for query-parameter spoofing safety (`?success=true`, `?status=approved`, `?payment_status=paid`)
- Unauthenticated POST to authenticated routes → exact 302 redirect to `/login` (session middleware fires before CSRF)
- Unauthenticated GET `/admin` → exact 302 redirect to `/auth/login`
- Security test verifies NO permissive multi-status assertions exist within test file itself
- All 48 tests pass, clean exit

## 2026-07-23 — Tilopay Provider Completion: Documentation Audit, Placeholder Removal, and Deployment Hardening

### Fixed
- Removed all invented/placeholder provider behavior:
  - Deleted `verifyWebhookSignature()` with placeholder HMAC-SHA256
  - Deleted `WEBHOOK_SIGNATURE_HEADER` with invented `X-Tilopay-Signature`
  - Deleted `authenticate()` function with placeholder token endpoint
  - Deleted `TILOPAY_RETURN_BASE_URL` (replaced by derived URLs from `PUBLIC_BASE_URL`)
  - Removed `mock_tkn_` and `mock_tx_` generation from production client paths
- Replaced `processWebhook()` with `processNotification()`: notification is treated as a hint, server-to-server API lookup is authoritative
- Webhook route changed from `express.raw()` to `express.json()` (no HMAC signature verification needed)
- Return route now triggers server-side reconciliation on browser return

### Changed
- `config/tilopay.js`: added `TILOPAY_PUBLIC_BASE_URL` for multi-client deployments; return/cancel/webhook URLs derived automatically; `TILOPAY_MOCK=true` blocked in production; `JQUERY_SCRIPT_URL` centralized
- `services/tilopayClient.js`: rewritten — no placeholders, no invented HMAC, `isWebhookSignatureSupported()` returns `false` until confirmed; mock functions separated for test-only use
- `services/tilopayService.js`: renamed `processWebhook` → `processNotification`; implements server-side lookup when signature unavailable
- `controllers/tilopayController.js`: uses derived URLs; return route triggers reconciliation
- `routes/tilopayWebhookRoutes.js`: simplified to bounded JSON parser
- `views/pages/tilopay-pay.ejs`: jQuery URL from config, not hardcoded
- `.env.example`: removed `TILOPAY_RETURN_BASE_URL`, `TILOPAY_WEBHOOK_SECRET`; added `TILOPAY_PUBLIC_BASE_URL`, `TILOPAY_MOCK`

### Added
- `scripts/validate-tilopay-config.js`: configuration validator with safe output (never prints credentials)
- `docs/TILOPAY_CLIENT_SETUP.md`: per-client installation guide (8 steps)
- `TILOPAY_MOCK=false` gating: blocked when `NODE_ENV=production`

### Documentation
- `docs/TILOPAY_INTEGRATION.md`: complete rewrite with confirmed/unconfirmed matrix, blocking report, best-known endpoint estimates, derived URL architecture
- `docs/CHANGELOG.md`: this entry
- `docs/PROJECT_STATUS.md`: updated status, known gaps

### Verification
- `node --check` passes on all files
- `node scripts/validate-tilopay-config.js` works correctly
- Migration idempotent (2 runs)
- `npm audit --omit=dev`: 0 vulnerabilities
- All unit/config tests pass (23/30); HTTP integration tests designed for live server

### Known Gaps (Unchanged)
- Tilopay Postman API collection inaccessible (JS rendering required)
- SDK V2 guides behind merchant portal login
- Server-side API endpoint URLs are best-known estimates (pending portal confirmation)
- Webhook signature mechanism not publicly documented
- No real sandbox transaction completed
- No webhook end-to-end test completed
- SDK V2 evaluation pending

## 2026-07-23 — Tilopay Payment Integration (Provider-Neutral Architecture)

### Added
- `config/tilopay.js` — environment-variable validation, base URL selection, credential handling.
- `config/tilopayStatusMap.js` — centralized status normalization, terminal/approval/retry helpers.
- `services/tilopayClient.js` — provider HTTP adapter with mock fallback for testing.
- `services/tilopayService.js` — business logic: initiation (3-stage), confirmation, webhook processing, reconciliation.
- `controllers/tilopayController.js` — route handlers for payment initiation (customer + guest), return/cancel pages, webhook, admin reconciliation.
- `routes/tilopayRoutes.js` — user-facing routes mounted before global CSRF.
- `routes/tilopayWebhookRoutes.js` — webhook route with raw body handling, no session, no CSRF.
- `scripts/migrate-tilopay.js` — idempotent migration creating `tilopay_transactions` table.
- `views/pages/tilopay-pay.ejs` — payment form integrated with Tilopay SDK v1.
- `views/pages/tilopay-result.ejs` — payment result page for return/cancel flows.
- `tests/tilopay.test.js` — 30 automated tests covering config, service logic, client mock, security, HTTP integration, and regression.
- `docs/TILOPAY_INTEGRATION.md` — full architecture documentation, PCI boundary, credential security, known gaps.

### Changed
- `config/checkoutOptions.js`: `tilopay` payment method now dynamically enabled based on `TILOPAY_ENABLED` environment variable.
- `config/orderOptions.js`: added `tilopay` payment method label and 10 new event types (`tilopay_payment_created`, `tilopay_payment_approved`, `tilopay_payment_declined`, `tilopay_payment_cancelled`, `tilopay_payment_expired`, `tilopay_payment_reconciled`, `tilopay_payment_pending`, `tilopay_payment_creation_failed`, `tilopay_callback_received`, `tilopay_amount_mismatch`).
- `app.js`: mounted tilopay account routes, guest routes, public return/cancel routes, and webhook route.
- `controllers/accountOrderController.js`: fetches tilopay transaction summary for customer order detail.
- `controllers/guestOrderController.js`: fetches tilopay transaction summary for guest order detail.
- `controllers/adminOrderController.js`: fetches tilopay transaction summary for admin order detail.
- `routes/adminOrderRoutes.js`: added `POST /admin/orders/:reference/tilopay/reconcile` for admin reconciliation.
- `services/customerOrderService.js`: added `tilopay` payment instructions.
- `views/pages/customer-order-detail.ejs`: added Tilopay transaction display and "Pagar con Tilopay" button (hidden when shipping pending).
- `views/pages/admin/order-detail.ejs`: added Tilopay transaction section with status, amounts, and reconciliation button.
- `.env.example`: added Tilopay configuration variables.
- `schema.sql`: added `tilopay_transactions` table definition.

### Security
- Credentials loaded only from environment variables; never hardcoded, logged, or rendered in HTML.
- Published WooCommerce test credentials explicitly excluded from all project files.
- Credential rotation required before production (documented in `TILOPAY_INTEGRATION.md`).
- Tilopay SDK handles card data on client-side; no raw card data reaches the NLSite Express server.
- Webhook route uses provider authentication, not session/CSRF.
- Amount always sourced from locked database order; browser-supplied values ignored.
- Payment initiation requires CSRF, user authorization, and transactional order lock.
- Only authoritative approved Tilopay status marks order paid.
- Concurrent initiation serialized via `FOR UPDATE` order lock.

### Verification
- Migration idempotent (ran twice successfully).
- `node --check app.js` passes.
- `npm audit --omit=dev`: 0 vulnerabilities.
- All 30 unit/config tests pass.
- Existing payment-proof concurrency tests continue to pass (9/9).
- SINPE and bank_transfer checkout remains functional.
- Store, cart, login, register, guest lookup pages all load correctly.

### Known Gaps (Pending Live Integration)
- Tilopay Postman API collection inaccessible (requires JavaScript rendering) — server-side endpoint URLs unconfirmed.
- Webhook signature algorithm and payload structure unconfirmed (PLACEHOLDER HMAC-SHA256).
- No real sandbox transaction completed (pending credential rotation).
- No webhook end-to-end validation (pending public-facing callback URL).
- No real-browser visual validation of payment page.
- API authentication token caching not yet implemented (pending token lifetime from docs).

See `docs/TILOPAY_INTEGRATION.md` for full details.

## 2026-07-22 — Saved Customer Addresses and Checkout Integration

### Added
- Owner-scoped address book under `/cuenta/direcciones` with create, edit, set-default and delete flows.
- Additive idempotent `user_addresses` migration, 20-address limit, transactional one-default invariant and oldest-address promotion when the default is deleted.
- Authenticated checkout selection using `saved:<id>` or `manual`; guests remain manual-only.
- Controlled coverage for migration replay, validation, ownership, CSRF, default promotion, checkout manipulation and snapshot immutability.

### Security and data integrity
- Address IDs are parsed as positive integers and every lookup is constrained by the authenticated session user.
- Saved address fields are loaded server-side and replace any browser-submitted manual address before checkout validation.
- Orders continue storing delivery snapshots in the existing `orders` columns; later edits or deletions never mutate historical orders.
- The checkout phone remains authoritative for `customer_phone`; a saved address phone is display-only convenience.

### Validation
- The migration ran repeatedly without changing existing users or orders.
- Full `node --test`, JavaScript/EJS syntax checks, `npm audit --omit=dev` and `git diff --check` pass.
- Saving a new manual checkout address remains an optional deferred enhancement.

## 2026-07-22 — Authenticated Customer Account Dashboard

### Added
- Shared dark NinjaLab account shell with accessible server-rendered navigation for Resumen, Mis pedidos, Mi perfil, Seguridad and POST-only logout.
- Owner-scoped `/cuenta` dashboard using bounded aggregate and latest-order queries.
- Profile editing for display name, optional surname and normalized phone. Email remains visible and read-only until a verified email-change flow exists.
- Avatar upload at `/cuenta/avatar` using a 2 MB JPG/PNG/WebP allowlist, Sharp auto-rotation, metadata-stripping re-encode, square 512×512 crop and randomized WebP storage.
- Safe avatar replacement, orphan cleanup after failed DB writes, path-constrained idempotent removal and initials fallback.
- Password change with current-password verification, 8–128 character bounds, bcrypt cost 10 and `password_changed_at`.
- `scripts/migrate-user-profile.js`, an additive idempotent migration for `last_name`, `phone`, `avatar_path` and `password_changed_at`.
- Controlled integration coverage for account routes, profile allowlists, CSRF, avatar formats, Windows file-lock retry, session rotation and regressions.

### Changed
- `/cuenta/pedidos` and its owner-scoped detail now render inside the shared account shell.
- The authenticated public navigation exposes both the account dashboard and existing order link without changing the navbar layout.
- Authentication return paths now allowlist the static account sections as well as owner order URLs.
- The centralized image pipeline now supports configurable crop position and enlargement while preserving existing product-image defaults.

### Security
- Account mutations derive identity only from `req.session.user.id`; browser-submitted IDs, roles, status, avatar paths, passwords and email changes are ignored.
- Multipart avatar requests are mounted before global CSRF and explicitly validate CSRF after Multer parses the body.
- Password session regeneration restores only the sanitized cart and deliberately drops guest-order grants and recent-order access.
- Order ownership, customer-safe serialization, public timeline allowlists and cross-user 404 behavior remain unchanged.

### Validation
- Profile migration ran successfully twice against the active local database without changing existing user or administrator counts.
- `node --test` passes the account, customer-order, admin-order and existing authentication suites.
- Real-browser visual validation remains pending because no browser backend was available in the Codex session.

## 2026-07-22 — Customer Order Portal and Secure Guest Lookup

### Added
- Authenticated order list and detail routes under `/cuenta/pedidos`, querying only the current session user's orders and returning 404 for cross-user references.
- A customer-safe order serializer with explicit field selection, immutable product snapshots, safe address output, centralized status labels and server-derived payment instructions.
- A public timeline mapper that allowlists customer milestones and never selects notes, actors or raw event metadata.
- Public `/consultar-pedido` verification using strict order reference plus normalized email for guest-owned orders only.
- Session grants with a 30-minute TTL, five-entry cap, deduplication and sanitization on read.
- Existing rate-limit infrastructure applied at seven lookup attempts per 15 minutes; lookup POST remains behind global CSRF protection.
- Responsive, scoped account-order and lookup views with semantic timelines, accessible forms and noindex metadata.
- Controlled ephemeral users and orders for owner, cross-user, regular-admin-denial, administrator and guest authorization tests.

### Changed
- Checkout confirmation now reuses the same customer-safe service and detail presentation as account and verified guest access.
- Login accepts only allowlisted account-order return paths; session regeneration intentionally restores the cart but not guest-order grants.
- Account navigation includes “Mis pedidos”. The pre-existing direct `/tienda` navbar edit was repaired into valid HTML without changing its target.

### Validation
- Customer and administrative Node test suites execute without skips.
- Fixture-owned orders, events, users and sessions are removed after every run.
- No schema, migration, dependency, Tilo Pay or payment-provider changes were introduced in this phase.

## 2026-07-22 — Checkout & Manual Order Creation

### Added — Checkout Flow
- **Checkout page** at `/checkout` with customer info, delivery method, payment method, conditional address fields.
- **Order creation** via POST `/checkout` with transactional stock deduction (`SELECT ... FOR UPDATE`), server-authoritative price revalidation, and product snapshots.
- **Confirmation page** at `/checkout/confirmacion/:reference` with order details, payment instructions, shipping status.
- **Cart-to-checkout** entry: enabled link on `/carrito` when at least one purchasable item exists.

### Added — Delivery Methods
- `local_pickup` — Retiro en local, shipping ₡0, no address required, `shipping_status=not_required`.
- `uber_flash` — Uber Flash, shipping pending quotation, address required, `shipping_status=pending_quote`, `shipping_amount=null`.
- `private_courier` — Mensajero privado, same as Uber Flash.
- `correos_cr` — Correos de Costa Rica, same as Uber Flash.

### Added — Payment Methods
- `sinpe` — SINPE Móvil to `+506 7024 0270`, manual payment, status always `pending` on creation.
- `bank_transfer` — Transferencia bancaria, manual payment, status always `pending`.
- `tilopay` — Displayed as "Próximamente", disabled radio, rejected server-side.

### Added — Infrastructure
- `config/checkoutOptions.js` — canonical delivery methods, payment methods, 7 CR provinces.
- `validators/checkoutValidator.js` — customer name, email, phone, delivery, payment, address validation.
- `services/orderService.js` — `generateOrderReference()`, `generateCheckoutToken()`, `validateCartForCheckout()`, `createOrder()` (transactional).
- `controllers/checkoutController.js` — `showCheckout()`, `submitCheckout()`, `showConfirmation()`.
- `routes/checkoutRoutes.js` — mounted at `/checkout` in `app.js`.
- `views/pages/checkout.ejs` — full checkout form with conditional address, sticky summary.
- `views/pages/checkout-confirmation.ejs` — order received hero, payment/shipping messaging.
- `public/css/checkout.css` — scoped checkout styles, responsive.
- `public/js/checkout/checkout.js` — address section toggle, shipping/total display.
- `scripts/migrate-orders.js` — idempotent migration creating `orders` + `order_items` tables.
- `schema.sql` — updated with `orders` and `order_items` definitions.

### Added — Order Architecture
- `orders` table: `order_reference` (NL-XXXXXX), `customer_name`, `customer_email`, `customer_phone`, `delivery_method`, `shipping_status`, `shipping_amount` (nullable), `payment_method`, `payment_status`, `province`, `canton`, `district`, `address_line`, `address_reference`, `product_subtotal`, `final_total` (nullable), `idempotency_key` (SHA-256).
- `order_items` table: immutable snapshots of `product_id`, `product_name`, `product_slug`, `quantity`, `unit_price`, `line_total`, `primary_image`.
- Idempotency: checkoutToken → SHA-256 hash stored in `idempotency_key`, duplicate POST returns existing order.
- Stock deduction: `SELECT ... FOR UPDATE` inside transaction, conditional `UPDATE WHERE stock_quantity >= ?`.

### Changed
- `views/pages/carrito.ejs` — checkout button replaced with enabled link.
- `public/css/cart.css` — added `.cart-summary__checkout--enabled` style for active checkout link.

### Security
- All browser-submitted amounts ignored (prices, subtotal, shipping, total resolved server-side).
- Tilo Pay cannot be submitted — rejected server-side with validation error.
- Invalid delivery/payment methods rejected.
- CSRF required on all POST routes.
- Checkout token bound to session, consumed on use.
- Guest order confirmation access controlled via session-bound recent order references (1h expiry).
- No order enumeration via sequential IDs.

## 2026-07-22 — Shopping Cart

### Added — Cart System
- **Cart page** at `/carrito` with item list, quantity update, remove, clear, subtotal summary.
- **Add to cart** from product detail — real POST form replaces disabled placeholder.
- **Session-based cart** — guest cart stored in `req.session.cart`, persists across navigation.
- **Cart preservation through login** — guest cart captured before session regeneration and restored into new session.
- **Navbar cart badge** — quantity count in green pill on cart icon, visible on all public pages.
- **WhatsApp number fixed** — centralized in `config/publicContact.js` with approved number `50670240270`.

### Added — Service Layer
- `services/cartService.js`: `getSessionCart()`, `sanitizeCart()`, `addItem()`, `updateItem()`, `removeItem()`, `clearCart()`, `hydrateCart()`, `getCartItemCount()`, `captureCartForRegeneration()`, `restoreCartAfterRegeneration()`.
- `services/catalogService.js`: added `getPublicProductsByIds()` for batch cart product lookup.

### Added — Controller & Routes
- `controllers/cartController.js`: `addItem`, `updateItem`, `removeItem`, `clearCart`, `showCart`.
- `routes/cartRoutes.js`: mounted at `/carrito` in `app.js`.

### Added — Views & Assets
- `views/pages/carrito.ejs` — full cart page with items, summary, empty state, checkout placeholder.
- `public/css/cart.css` — scoped `.cart-*` styles, responsive, desktop sidebar layout, mobile single-column.
- `public/js/cart/cart.js` — progressive enhancement: ± buttons on quantity inputs, cart form sync.

### Changed
- `views/pages/tienda-producto.ejs` — disabled cart placeholder replaced with real POST form (in-stock) or "Agotado" disabled button.
- `views/components/home-navbar.ejs` — added cart icon with badge before account section.
- `middlewares/authMiddleware.js` — `setLocals` now computes `cartItemCount` from session.
- `controllers/authController.js` — login and adminLogin preserve guest cart through session regeneration.
- `controllers/storeController.js` — `buildWhatsAppUrl` moved to `config/publicContact.js`.
- `config/publicContact.js` — new centralized WhatsApp config with `DEFAULT_WHATSAPP_NUMBER = '50670240270'`.

### Architecture
- **Server-authoritative prices** — all prices resolved from DB on every render/mutation; browser submits only `productId` and `quantity`.
- **Stock validation** — quantities validated against current stock on add and update.
- **Product visibility** — hidden/archived/deleted products removed from session cart on hydration with user-facing notice.
- **Out-of-stock** — items remain visible in cart but marked unavailable.
- **CSRF** — all POST routes (`/agregar`, `/actualizar`, `/eliminar`, `/vaciar`) protected by global `csrfSynchronisedProtection`.

### Tests
25/26 HTTP assertions pass: cart page, add/update/remove/clear, navbar badge, CSRF rejection, store regressions, asset loading. (1 accent mismatch in test string, functionally correct.)

### Remaining
- **Real-browser visual validation pending.**
- Cart counts session quantities only (no DB hydration for badge to avoid N+1 queries).
- Checkout, payments, stock reservation not implemented.



### Added — Product Detail View

Complete public product detail page at `/tienda/:slug` with:

- **Interactive image gallery** — Main image + thumbnail buttons (up to 5 images, primary-first ordering, deduplication). Click/keyboard changes main image with `aria-pressed` state.
- **Breadcrumbs** — Semantic breadcrumb navigation: Inicio → Tienda → Category → Product.
- **Back link** — Safe `returnTo` parameter that only allows `/tienda` paths; external/protocol-relative/admin URLs fall back to `/tienda`.
- **Quantity selector** — ± buttons + number input, min=1, max=stock or 99, disabled when out-of-stock.
- **Cart preparation** — Disabled "Agregar al carrito" button with "Compra en línea próximamente" notice (no cart implementation yet).
- **WhatsApp action** — "Consultar por WhatsApp" button using `WHATSAPP_NUMBER` env var with safe encoded message.
- **Related products** — Same-category published products (excludes current), fallback to recent published, 4 max.
- **Product card reuse** — Related products use the existing `store-product-card` markup.

### Changed — Service Layer

- `getProductBySlug()` enhanced with separate product/category/image queries (no LEFT JOIN fallback on primary), image deduplication, 5-image limit, deterministic ordering.
- New `getRelatedProducts(productId, categoryIds, limit)` — same-category OR recent published fallback.
- New `formatWeight(grams)` — displays as `g` or `kg`.
- New `resolveDisplayPrice()` exported for related products serialization.

### Changed — Controller

- `showProduct()` loads related products, safe returnTo path, WhatsApp URL, weight label.
- `safeReturnPath(raw)` — validates and sanitizes `returnTo` query parameter; rejects external URLs, protocol-relative paths, and admin routes.
- `buildWhatsAppUrl(product)` — constructs WhatsApp URL with encoded product message from env config.

### Added — Frontend

- `public/js/store/product-detail.js` — ES module for gallery thumbnail interaction and quantity ± control with cleanup.

### Changed — Styles

- Replaced legacy `store-product-detail__*` CSS classes with new `.pd-*` scoped namespace (gallery, summary, quantity, actions, breadcrumbs, related, responsive + reduced-motion).

### Tests

- 22/22 HTTP assertions pass: published product 200, gallery elements, thumbnails, quantity, cart disabled, WhatsApp, description, related, category links, unknown slug 404, store unchanged, JS asset loads, no SQL/data exposure, returnTo safe (admin, external, protocol-relative rejected, valid store path preserved).



### Added — Database Tables
Four new MySQL tables via `scripts/migrate-catalog.js`: `categories`, `products`, `product_categories` (many-to-many join), `product_images`. Migration uses `CREATE TABLE IF NOT EXISTS` — safe to run multiple times.

### Added — Dependencies
- `multer` for multipart form parsing (product image uploads).
- `sharp` for centralized image processing (WebP conversion, auto-rotation, resize).

### Added — Image Processing (`services/imageProcessingService.js`)
Centralized Sharp pipeline: EXIF auto-rotate, resize (fit: inside, withoutEnlargement), WebP @ 80% quality, unique UUID filenames. Profiles: product (1800×1800), avatar (400×400), gallery (2400×1600), category (1200×800). All existing and future image upload modules can reuse this service.

### Added — Upload Middleware (`middleware/upload.js`)
Multer config with memory storage, MIME validation (JPEG/PNG/WebP/AVIF), 10MB limit. Exports `productImageUpload` (fields: primaryImage, secondaryImages) and `singleImageUpload`.

### Added — Admin Catalog Service (`services/adminCatalogService.js`)
CRUD for categories and products with transactional category associations. Product image management: add, remove, set primary, reorder, auto-promote primary, count validation.

### Added — Catalog Validator (`validators/catalogValidator.js`)
Reusable validation: category name, product name, prices, stock, weight, description, tags, category IDs, image count (max 5). Slug generation via `slugify()`.

### Added — Admin Catalog Controller (`controllers/adminCatalogController.js`)
15 controller functions: full CRUD for categories and products, plus image delete/set-primary/reorder actions. Transactional create/update with compensating file cleanup on failure.

### Added — Admin Catalog Routes (`routes/adminCatalogRoutes.js`)
Routes: `/admin/catalogo/categorias`, `/admin/catalogo/productos`, plus image management sub-routes. Multipart routes use inline CSRF after multer. Mounted before global CSRF middleware for multipart compatibility.

### Added — Admin Views
- `views/pages/admin/categories.ejs` — Category list with product count, delete with confirmation.
- `views/pages/admin/category-form.ejs` — Create/edit category form.
- `views/pages/admin/products.ejs` — Product list with search, category filter, pagination, thumbnails.
- `views/pages/admin/product-form.ejs` — Full product form: general info, categories (checkbox group), prices, inventory, description/tags, existing images with primary badge, new images with preview.

### Added — Client-Side JS (`public/js/admin/product-images.js`)
Image preview using `URL.createObjectURL` with cleanup on unload. Shows primary/secondary labels.

### Added — Admin CSS (`public/css/style.css` appended)
Styles for `.form-section`, `.form-row`, `.image-grid`, `.image-card`, `.badge`, `.pagination`, `.checkbox-group`, and responsive table overrides.

### Changed — Sidebar (`views/components/sidebar.ejs`)
Added "Categorías" and "Productos" links.

### Changed — Dashboard (`views/pages/admin/dashboard.ejs`)
Added quick-action buttons for Categorías and Productos.

### Changed — Store Controller (`controllers/storeController.js`)
Now async; uses `getPublicCatalogAsync()` which queries MySQL with JSON fallback.

### Changed — Catalog Service (`services/catalogService.js`)
Added `getPublicCatalogAsync()` — async MySQL-backed catalog query with full product/category/image support. Falls back to JSON if MySQL unavailable.

### Changed — CSRF Config (`config/csrf.js`)
Extracted `csrfSync` setup to shared module for reuse in route-level CSRF (multipart compatibility).

### Changed — App.js
- Imports CSRF from `config/csrf.js`
- Mounts `adminCatalogRoutes` before global CSRF middleware
- Added `adminCatalogRoutes` require

### Validation
- DB migration: 4 tables created successfully
- HTTP: 15/16 automated checks pass (homepage "Categor" text check expected to fail for anonymous visitors)
- All modules load without errors
- All 15 controller exports present
- `npm audit --omit=dev`: 0 vulnerabilities
- `git diff --check`: clean (LF→CRLF warnings only)

### Limitations
- Manual browser visual validation pending for admin catalog forms, image uploads, and all 9 viewport sizes
- No drag-and-drop image reordering (uses position fields, reorder form)
- Existing product images not migrated (separate future task)
- Redis/memory rate-limit counters not persisted
- JSON catalog (`data/catalog.json`) remains as fallback

## 2026-07-21 — Homepage Responsive Adaptation

### Changed
- **Desktop structure preserved**: Logo/header and hero content now share the same bounded container; the navigation remains at the upper-right and the text/3D composition stays two-column through tablet widths.
- **Responsive header**: Removed the fixed negative navigation offset, added fluid logo/navigation sizing, controlled wrapping, and a deliberate two-row mobile header that preserves every link and account action.
- **Responsive copy and CTAs**: Added fluid vertical spacing, bounded heading sizing, 48px minimum button targets, and nearly full-width mobile CTAs without changing copy or visual styles.
- **3D stage**: Constrained the canvas to `100%` of its stage, added viewport-aware stage heights, and retained the existing Three.js scale, camera fit, model source, idle rotation, and click-drag interaction.
- **Social links**: Kept lower-right container-aligned placement on desktop and returned the links to normal document flow on mobile.
- **Animations**: Added `gsap.matchMedia()` movement values for desktop/mobile and a single ScrollTrigger refresh after the external helmet model loads.
- **Mobile order**: Preserved logical DOM order while presenting copy, 3D object, CTAs, and social links sequentially.

### Validation
- Static responsive rules reviewed against 1920×1080, 1600×900, 1440×900, 1366×768, 1280×720, 1024×768, 912×1368, 768×1024, 600×960, 480×900, 430×932, 390×844, 375×812, 360×800, and 320×568 targets.
- `test-auth.js`: 37 passed, 0 failed, 3 credential-dependent flows skipped.
- Homepage, CSS/JS modules, Three.js, GLTFLoader, login, register, and admin login returned HTTP 200; unknown route returned 404.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: clean.
- Real browser visual validation: pending because no in-app browser backend was available.

### Remaining Frontend Issues
- Run the full responsive device-toolbar matrix, continuous resize pass, console/network inspection, and 3D pointer/touch interaction checks in a connected real browser before declaring the responsive homepage complete.
- Panel 2 remains a transition placeholder and was not modified.

## 2026-07-21 — Critical Panel 1 Runtime Correction — CSP, Three.js, External GLB, Logo, and Navigation

### Root Cause — Two Interdependent Failures
1. **CSP blocked the inline import map**: The `<script type="importmap">` tag is an inline script. The CSP had `script-src 'self'` which blocks all inline scripts. This silently prevented the import map from loading, which meant `import * as THREE from 'three'` failed with `"Failed to resolve module specifier 'three'"` — the browser didn't know where to find the `three` package.
2. **Helmet3D model loading**: Even if the import map worked, the GLB file was loaded from a local path instead of the specified external Google Storage URL.

### Fixed — CSP Nonce System
- **Per-request nonce middleware**: Added `crypto.randomBytes(16).toString('base64')` middleware BEFORE Helmet, storing the nonce in `res.locals.cspNonce`.
- **Helmet CSP**: `script-src` now uses `['self', (req, res) => "'nonce-" + res.locals.cspNonce + "'"]` (Helmet 8.3.0 per-request directive function). No global `'unsafe-inline'` in script-src.
- **Import map**: `<script type="importmap" nonce="<%= cspNonce %>">` — now authorized by CSP.
- **Inline CSS variables**: `<style nonce="<%= cspNonce %>">` — also authorized.
- **CSP header verified**: `script-src 'self' 'nonce-<random>'` present in HTTP response, `connect-src 'self' blob: https://storage.googleapis.com`.

### Fixed — External GLB Loading
- **GLB URL**: Changed from `/3d/casco.glb` to `https://storage.googleapis.com/ninjalab3d/casco.glb` (28061104 bytes, verified via `curl.exe -I`).
- **`connect-src`**: Added `https://storage.googleapis.com` to allow `fetch()` for GLTFLoader.
- **Progress display**: Added `.hero-loader-text` element showing "Cargando modelo 3D… 45%".
- **Dynamic camera fitting**: After centering and scaling the model, camera distance is calculated from the fitted bounding box: `cameraDistance = fittedDim / (2 * tan(fovRadians / 2)) * 1.3`. Camera positioned at `(0, 0.1, cameraDistance)` looking at `(0, 0, 0)`.
- **Deferred resize**: `requestAnimationFrame(() => onResize())` ensures DOM layout is settled before initial renderer sizing.
- **Fallback**: On GLTF load failure, loader is hidden, fallback icon shown, `has-fallback` class added to stage, error logged to console.

### Fixed — Logo Size
- **Container**: `.hero-logo { width: clamp(360px, 28vw, 480px) }` — allows up to 480px at wide viewports.
- **Image**: `width: 100%; height: auto; transform: scale(1.15)` — compensates for transparent padding in `LogoCompleto.png`.
- **Tablet** (≤768px): `width: clamp(240px, 35vw, 360px); transform: scale(1.12)`.
- **Mobile** (≤430px): `width: clamp(180px, 50vw, 260px); transform: scale(1.08)`.

### Fixed — Navigation Alignment
- **`.hero-nav`**: Added `justify-self: end` to push navigation to the far right of the grid column.
- **Header grid**: `grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: clamp(2rem, 5vw, 6rem)` — ensures large gap between logo and nav.
- **Header max-width**: `max-width: min(100%, var(--home-content-width) + 2 * padding); margin-inline: auto` — contained within content width.

### Fixed — 3D Stage
- **min-height**: `clamp(500px, 56vw, 780px)` — larger stage for better helmet presence.

### Validation
- **CSP header**: `script-src 'self' 'nonce-<random>'` — per-request nonce confirmed.
- **HTTP**: 14/14 endpoints return 200.
- **CSP nonce**: Present on import map and inline style in rendered HTML.
- **External GLB**: `curl.exe -I` returns 200, `Content-Length: 28061104`, `Content-Type: application/octet-stream`.
- **`npm audit --omit=dev`**: 0 vulnerabilities.
- **`git diff --check`**: clean (non-graphify files).
- **Login page**: Nonce present (by layout), no home.js/css leakage.

### Limitations
- Manual browser visual validation pending (helmet rendering, logo comparison, idle rotation, drag interaction).
- `casco.glb` (26.76 MB) optimization remains future work.

## 2026-07-21 — Panel 1 Helmet and Logo Correction

### Root Cause — 3D Helmet Not Loading
- **`helmet3d.js` line 5**: Used absolute path `/vendor/three/three.module.js` which does not exist in Three.js v0.185.1. The `three.module.js` file lives only at `node_modules/three/build/three.module.js`. The import map defines `"three": "/vendor/three/build/three.module.js"` but the code bypassed it with a hardcoded wrong path.

### Fixed — 3D Helmet Loader
- **Import path**: Changed from `/vendor/three/three.module.js` to bare specifier `'three'` (resolved via import map to `/vendor/three/build/three.module.js`).
- **GLTFLoader import**: Changed to `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'` (no dynamic import needed).
- **Model group**: Wrapped model in `new THREE.Group()` before scene.add — rotation applied to group, not raw GLB nodes.
- **Camera**: Adjusted to `PerspectiveCamera(35, ...)` with `camera.position.set(0, 0.15, 5)`.
- **Lighting**: Boosted key light intensity (2.2), added `HemisphereLight` for environment fill, increased ambient to 0.7. This ensures the dark helmet is visible against dark background.
- **Model guards**: Added `modelLoaded` flag — pointer handlers and render loop check `if (!modelLoaded) return` before accessing model.
- **Tone mapping**: Added `ACESFilmicToneMapping` with exposure 1.1 (only when supported by installed version).
- **Renderer**: `setClearColor(0x000000, 0)` for transparency.

### Fixed — Logo Size
- **CSS**: `.hero-logo-img` changed from `height: 2.2rem` (~35px) to `width: clamp(200px, 18vw, 320px); height: auto;`.
- **Header layout**: Changed from `display: flex; justify-content: space-between` to `display: grid; grid-template-columns: minmax(200px, auto) 1fr` for stable logo+nav alignment.
- **Responsive**: Tablet ~150–220px, mobile ~130–180px via clamp().

### Fixed — 3D Stage CSS
- **z-index**: `.hero-3d` bumped from 1 to 2 to sit above background pseudo-elements.
- **touch-action**: Added `touch-action: pan-y` on `.hero-canvas` for mobile vertical scroll support.
- **Height**: `.hero-canvas` removed `min-height` (inherits from `.hero-3d` parent) and removed explicit height-to-zero risk from percentage-based sizing.
- **Stage sizing**: `.hero-3d` now uses `min-height: clamp(380px, 50vw, 700px)` for robust sizing across viewports.

### Validation
- HTTP: 15/15 endpoints return 200 (including GLTFLoader.js, three.module.js).
- `npm audit --omit=dev` → 0 vulnerabilities.
- `git diff --check` → clean (non-graphify files).
- Login page: navbar ✅, footer ✅, no home.css/home.js leakage ✅.
- Homepage: no default navbar ✅, no footer ✅, importmap ✅.

### Limitations
- Manual browser WebGL rendering validation pending.
- `casco.glb` (26.76 MB) optimization remains future work.

## 2026-07-21 — Frontend Foundation — Animated Panel 1

### Added
- **Three.js**: Interactive 3D helmet model (`casco.glb`, 26.76 MB) with idle rotation, pointer drag, and parallax hover.
- **GSAP + ScrollTrigger**: Entrance animation timeline (8 sequential reveals: grid, logo, nav, eyebrow, heading, glow, helmet, CTAs, social) and scroll-linked transitions.
- **Lenis**: Smooth scrolling with eased interpolation, homepage-only initialization, GSAP ScrollTrigger synchronization.
- **`public/css/home.css`**: Homepage-only styles scoped under `.home-page` / `body.page-home` — tokens, panel layout, hero typography, gradient background, grid overlay, 3D stage, CTAs, social links, responsive rules, reduced motion overrides.
- **`public/js/home/home.js`**: Homepage entry point — feature detection (WebGL, reduced motion), module coordination, fallback handling.
- **`public/js/home/animations.js`**: GSAP timelines, ScrollTrigger scroll behaviors, Lenis setup, scroller-proxy for ScrollTrigger.
- **`public/js/home/helmet3d.js`**: Three.js scene setup — GLTFLoader, soft key/fill/rim lighting, idle rotation, damping, pointer interaction, resize handling, visibility pause, cleanup.
- **Panel architecture**: Homepage structured as `<section data-panel="1">` + minimal `<section data-panel="2">` transition placeholder.
- **Homepage-specific layout**: No default navbar/footer — hero-header with logo + nav + auth context.
- **Import map**: `three` → `/vendor/three/build/three.module.js`, `three/addons/` → `/vendor/three/examples/jsm/`.
- **Vendor aliases**: Scoped Express static mounts for Three.js, GSAP, Lenis browser builds (no `node_modules` exposure).

### Visual Reference
- Panel 1 closely reproduces `public/reference/PaginaWeb.png`:
  - Logo upper-left, navigation right: Tienda, Galería, Nosotros, Cuenta
  - Eyebrow: "IMPRESIÓN 3D EN COSTA RICA"
  - Main title: "Fabricamos tus / ideas / con precisión / milimétrica" with neon-green glow
  - 3D helmet on right side, two CTAs: primary green + outline
  - Social links: Instagram, Facebook, TikTok, WhatsApp (SVG icons)
  - Background: layered gradient (light gray → dark → black) + grid overlay + green radial glow
- Motion language inspired by `trymeridian.com`: scroll-driven panels, smooth transitions, parallax, reveal effects.

### Changed
- **`app.js`**: CSP extended (`connect-src blob:`, `worker-src blob:`) for WebGL. Vendor static aliases added. Home route updated with `pageClass`, `pageStyles`.
- **`views/layouts/main.ejs`**: Conditional navbar/footer (excluded on homepage). Conditional `<script>` (module for homepage, classic for others). Import map injected for homepage. `pageStyles` array support.
- **`views/pages/home.ejs`**: Completely rewritten — panel architecture, hero header, background layers, text + 3D + CTAs + social layout.

### Responsive Behavior
- Desktop: Two-column (text left, 3D right), full viewport panel.
- Tablet (< 1024px): Stacked columns, reduced spacing, centered content.
- Mobile (< 430px): Fixed nav, single column, 3D above text (reading order preserved), full-width CTAs, compact social links.
- No horizontal overflow at any tested breakpoint.

### Accessibility
- `prefers-reduced-motion: reduce`: disables animation timelines, disables Lenis, reduces idle rotation, static 3D model remains interactive.
- All interactive elements have visible `:focus-visible` outlines.
- Semantic heading structure, `aria-label` on links, `role="img"` on 3D stage.

### Security
- No CSP regressions — all scripts/styles loaded locally, no CDNs, no `unsafe-eval`.
- Logout form retains `_csrf` token (conditionally rendered when authenticated).
- Admin/auth pages excluded from homepage assets (no three.js/gsap/lenis on login/admin).
- No secrets, credentials, or tokens in homepage JavaScript.

### Validation
- HTTP: 14/14 endpoints return 200 (home, logo, GLB, CSS, JS, vendor files, auth pages).
- 404 redirect: 302 when unauthenticated accessing `/admin`.
- Login page: navbar ✅, footer ✅, main.js ✅, no home.css/home.js leakage.
- Homepage: no default navbar ✅, no footer ✅, no main.js ✅, importmap ✅, home.js module ✅.
- `npm audit --omit=dev` → 0 vulnerabilities.
- Git diff: no real secrets exposed (only `SESSION_SECRET` env var reference).
- CSP: `connect-src` and `worker-src` support WebGL.

### Limitations
- `casco.glb` (26.76 MB) is uncompressed — optimization deferred to later phase.
- Manual browser visual validation pending (side-by-side comparison with reference image).
- Panel 2 is transition placeholder only; future panels not designed.
- Lenis anchor-link behavior not tested.
- Real social media URLs remain placeholder `#` links.

## 2026-07-21 — Documentation Accuracy Correction

### Corrected
- **CSRF token storage wording**: Clarified that verification/password-reset tokens are not stored in sessions, but the CSRF synchronizer token is stored as part of the persistent MySQL session data.
- **Session-store failure mode**: Reworded from "exits with an error" (untested) to "configured to wait for readiness and fail startup rather than silently fall back to MemoryStore."
- **SMTP status**: Removed obsolete "email not yet tested" limitation. Registration verification and password-reset emails were manually confirmed delivered and functional.
- **Validation status**: Clearly distinguished HTTP restart persistence validation (completed) from manual browser restart validation (pending).
- **Remaining limitations**: Removed obsolete SMTP and MemoryStore items. Added pending manual validation and deployment hardening items.
- **AUTH_TESTING.md**: Session persistence section now separates completed HTTP validation from pending manual browser and failure-mode tests.

## 2026-07-21 — Persistent MySQL Sessions

### Added
- **`express-mysql-session`** (v3.x): MySQL-backed session store replacing in-memory `MemoryStore`.
- **`config/session.js`**: Reusable session configuration. Reads DB credentials from existing `.env`, creates `MySQLStore` with `createDatabaseTable: true`, auto-cleanup every 15 min (`clearExpired`, `checkExpirationInterval`, `expiration`).
- **Store readiness**: `sessionStore.onReady()` promise blocks server startup until MySQL session table is accessible.
- **Session persistence**: Sessions survive application restarts.

### Changed
- **`app.js`**: Session configuration moved to `config/session.js`. Server now waits for `onReady()` before listening. Removed unused `session` import.
- **`schema.sql`**: Sessions table updated to `data MEDIUMTEXT` (matches auto-created schema).

### Fixed
- No more `MemoryStore` fallback. The application waits for session store readiness before starting. The unavailable-store failure mode has not yet been manually tested, but the code is configured to fail startup rather than silently fall back to MemoryStore.

### Validation
- `test-auth.js`: 40/40 non-credential assertions pass.
- HTTP restart persistence: Logged in → stopped server → restarted → same cookie still authenticated (200, navbar visible).
- Logout: `POST /auth/logout` → session destroyed, cookie removed, `/admin` blocked.
- `npm audit --omit=dev` → 0 vulnerabilities.
- Git diff: no real credentials exposed.
- Graphify: updated.

### Limitations
- Manual browser restart validation pending.
- Session expiration not tested with shortened lifetime.
- MySQL session-store failure mode not manually tested.
- Multi-process sharing not tested.
- HTTP restart persistence validation completed; manual browser restart validation pending.

## 2026-07-21 — CSRF Protection

### Added
- **`csrf-sync`** (v4.x): Synchronizer-token pattern CSRF protection.
- **CSRF configuration** in `app.js`: token stored in `req.session.csrfToken`, read from `req.body._csrf`.
- **CSRF token middleware**: `res.locals.csrfToken = generateToken(req)` after session, before routes.
- **CSRF protection middleware**: `csrfSynchronisedProtection` applied globally. Ignores GET/HEAD/OPTIONS.
- **CSRF error handler**: Detects `EBADCSRFTOKEN` code, renders `views/pages/403.ejs` with Spanish message, status 403.
- **`views/pages/403.ejs`**: Styled error page with public layout, "Solicitud no válida" message.
- **CSRF hidden inputs** in all 13 POST forms: login, register, admin login, forgot-password, reset-password, resend-verification, logout (public + admin navbar), user-form (create/edit), toggle, delete.

### Changed
- **`app.js`**: Added csrf-sync import, token generation middleware, csrfSynchronisedProtection, CSRF error handler before 500 handler.
- **`test-auth.js`**: Extended with 45 assertions including token availability, missing/invalid token 403, cross-session, valid logout with CSRF, no side effects.
- All EJS POST forms: Added `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.

### Security
- Every POST/PUT/PATCH/DELETE request requires valid session-bound CSRF token.
- Missing or invalid tokens return 403 before any controller logic executes.
- Tokens never appear in URLs and are never logged.
- The CSRF synchronizer token is stored as part of the session data (which is now in MySQL). Verification and password-reset tokens are stored as SHA-256 hashes in their own MySQL tables, not in the session.
- Token survives session regeneration (new token generated on next GET).
- Cross-session token reuse detected and rejected.
- Email verification GET links intentionally excluded from CSRF (rely on crypto tokens).

### Validation
- `test-auth.js`: 40/40 non-credential assertions pass, 3 credential-dependent, 2 skipped.
- `npm audit --omit=dev` → 0 vulnerabilities.
- `git diff --check` → clean.
- Git diff: no secrets, passwords, CSRF tokens, or credentials exposed.
- Graphify: updated.

### Limitations
- Manual browser testing pending (most CSRF tests are HTTP-level).
- No AJAX/fetch CSRF header support (only forms use `_csrf`).

## 2026-07-21 — Email Verification and Password Recovery

### Added
- **Nodemailer** (`config/mailer.js`): Single-responsibility SMTP transporter. Loads config from env vars, exports `sendVerificationEmail`, `sendPasswordResetEmail`, `sendMail`, `verifyConnection`. Never logs credentials.
- **`pending_registrations` table**: Stores unverified registration data with SHA-256 hashed tokens, expiration, unique email constraint. Row deleted after verification.
- **`password_reset_tokens` table**: Stores single-use reset tokens with SHA-256 hashes, expiration, `used_at` tracking, foreign key to `users`.
- **Email verification flow**:
  - `POST /auth/register` → validates, stores pending registration, sends verification email, redirects to verify-pending.
  - `GET /auth/verify-email?token=` → hashes token, creates `users` row, deletes pending registration, redirects to login.
  - `GET /auth/verify-pending` → masked email, expiration, resend link.
  - `GET /auth/resend-verification` → email form.
  - `POST /auth/resend-verification` → regenerates token, sends new email. Generic response always.
- **Password recovery flow**:
  - `GET /auth/forgot-password` → email form.
  - `POST /auth/forgot-password` → generates token, sends email for active users. Always generic response.
  - `GET /auth/reset-password?token=` → validates token, shows new-password form with hidden token.
  - `POST /auth/reset-password` → updates password, marks tokens used. Automatic login disabled.
- **Rate limiters**: `resendLimiter` (3/15min), `forgotLimiter` (3/15min), separate from login limiter.
- **New views**: `verify-pending.ejs`, `resend-verification.ejs`, `forgot-password.ejs`, `reset-password.ejs`.
- **Login page**: Added "¿Olvidaste tu contraseña?" link.
- **SMTP verification**: `transporter.verify()` available during development.

### Changed
- **`register` controller**: No longer creates `users` row directly. Stores pending registration, sends email, redirects to verify-pending.
- **`test-auth.js`**: Extended with verification token rejection, reset token rejection, forgot-password generic response, verify-pending/resend routes.
- **`.env.example`**: Added `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`, `APP_URL`, `EMAIL_VERIFICATION_EXPIRES_MINUTES`, `PASSWORD_RESET_EXPIRES_MINUTES`.
- **`schema.sql`**: Added `pending_registrations` and `password_reset_tokens` table definitions.

### Security
- Raw tokens generated via `crypto.randomBytes(32).toString('hex')`, stored as SHA-256 hash.
- Tokens are single-use, expire, and previous active tokens are invalidated on new request.
- No user IDs, roles, passwords, or hashes in URLs.
- Forgot-password always returns same generic message regardless of email status.
- Resend-verification also returns generic message.
- Expired tokens cleaned before every check (`DELETE WHERE expires_at < NOW()`).
- Registration/verification/forgot-password use MySQL transactions.

### Validation
- `test-auth.js`: 20/20 non-credential assertions pass, 4 credential-dependent (expected), 2 skipped.
- Server starts without errors. SMTP warning shown when env vars missing (not a crash).
- `npm audit --omit=dev` → 0 vulnerabilities.

### Limitations
- Registration verification and password-reset emails were manually confirmed delivered and functional.
- Token cleanup is inline (per-request), no cron/scheduler.
- Email templates inline in `config/mailer.js`.

## 2026-07-21 — Critical Authentication and Authorization Correction

### Root Causes
- **Layouts never rendered**: Express EJS has no built-in layout support. The `layout: 'layouts/main'` option passed to every `res.render()` call was silently ignored. Every page rendered raw HTML fragments without `<!DOCTYPE html>`, `<head>`, CSS link, navbar, or footer.
- **Session shape inconsistent**: Normal login stored `{id, name, email, role}` without `role_id`. Admin login stored `{id, name, email, role: 'admin'}` also without `role_id`. Middleware used string `role === 'admin'` comparison instead of numeric `role_id`.
- **Login query missing LIMIT/active check in SQL**: `is_active` checked in JS after DB fetch, not in `WHERE` clause.

### Fixed
- **Layout middleware** (`config/viewEngine.js`): Lightweight `res.render()` interceptor that detects the `layout` option, renders the view first, then wraps output in the layout template as `body`. Zero extra dependencies.
- **Session shape unified**: Both login paths now store `{id, name, email, role_id: Number, role: String}`. All middleware uses `Number(req.session.user.role_id) === 1` for admin checks.
- **Login queries hardened**: `WHERE email = ? AND is_active = 1 LIMIT 1`. Checks `rows.length !== 1` (not `=== 0`) to catch edge cases. Admin login additionally requires `AND role_id = 1` in SQL.
- **Admin route protection doubled**: Middleware applied at both `app.use('/admin', isAuthenticated, isAdmin, adminRoutes)` mount level and within `adminRoutes.js`.
- **Navbar visibility**: Layouts now properly include navbar components. CSS `.logout-form` uses `display: inline-flex` with styled buttons.
- **`isAuthenticated`**: Now requires `req.session.user.id` (not just truthy `req.session.user`).
- **`test-auth.js`**: Integration test script with 24 assertions covering anonymous, unknown user, normal user, and admin flows.

### Validation
- `test-auth.js`: 24/24 passed
- Layout renders: `<!DOCTYPE html>`, `<nav>`, footer all present
- Normal user navbar: no admin link; logout form visible (`/auth/logout`)
- Admin dashboard: logout form in navbar; dashboard content renders
- Unknown user login: rejected with generic message, no session created
- `npm audit --omit=dev` → 0 vulnerabilities
- Graphify: 176 nodes, 195 edges

## 2026-07-21 — Logout Flow Correction

### Fixed
- Logout route: `GET /auth/logout` → `POST /auth/logout`
- `authController.logout`: Added `res.clearCookie('connect.sid')` to clear session cookie after destroy
- `navbar.ejs` and `navbar-admin.ejs`: Changed `<a>` links to inline `<form>` POST elements
- Styles: `.logout-form` uses `display: inline-flex` so the form sits alongside other navbar links

### Validation
- `test-auth.js` updated with logout assertions: cookie cleared, redirect correct, subsequent admin access denied
- Post-logout home page renders without "Cerrar Sesión" link
- Admin logout: redirects to `/auth/login`, admin pages redirect to login after

## 2026-07-21 — Database Schema Consistency and Security Correction

### Fixed
- `users.is_active`: Added column to live DB where it was missing. `authController.login` now queries `is_active = 1`.
- `adminController.toggleUserStatus`: Restored. Admin can toggle user active/inactive.
- `adminController.deleteUser`: Added confirmation note: "DANGER: This deletes the user permanently."
- Dashboard stat: "Usuarios Activos" restored.
- Users list "Estado" column: Restored with toggle button.
- User form "Usuario activo" checkbox: Restored.
- Default admin credential: Removed from `schema.sql`. Replaced with comment: `-- node create-admin.js`
- `create-admin.js`: Interactive CLI script for secure admin creation.

### Security
- No hardcoded credentials in any tracked file.
- `buildQuery` internal function preserved exactly (minor cleanup reverted).

## 2026-07-21 — Authentication Interface and Manual Verification

### Added
- `views/pages/admin-login.ejs`: Dedicated admin login form with visual badge, border distinction
- `test-auth.js`: 24 assertions across anonymous, unknown user, normal user, admin
- Admin login CSS: `.admin-badge`, `.admin-login-card` with colored border
- Manual testing documentation: `docs/AUTH_TESTING.md`

### Fixed
- Admin login route registered before admin middleware
- Session regeneration persistence (`req.session.save()`)
- Role-based redirects: admin → `/admin/`, user → `/`
- Registration form: preserves name/email, clears passwords
- `autocomplete` attributes on all form fields

## 2026-07-21 — Security and Error Handling

### Added
- `helmet` HTTP headers (CSP, HSTS, etc.)
- `express-rate-limit` for login (5 attempts / 15 min)
- Session regeneration on login (fixation protection)
- Centralized 404 (`views/pages/404.ejs`) and 500 (`views/pages/500.ejs`) error pages
- Email normalization (trim + lowercase)
- Password masking in logs (not logged at all)
- `SESSION_MAX_AGE_HOURS` configurable via `.env`

### Changed
- Session cookie: `httpOnly`, `sameSite: 'lax'`, `secure` in production
- Session `maxAge` from `SESSION_MAX_AGE_HOURS`
- Enhanced `SECRET` placeholder in `.env.example`

## 2026-07-21 — Initial Project Setup

- Express + EJS + MySQL boilerplate
- Modular architecture: config/ controllers/ middlewares/ routes/ views/
- User authentication (login, register, session)
- Admin panel (dashboard, user management)
- Brand white-label via `.env` CSS variables

---

## 2026-07-22 — Admin Catalog Validation, Hardening & Layout Repair

### Fixed — Admin layout root cause
`.admin-layout` CSS class did not explicitly set `flex-direction: row`, inheriting `column` from the global `body` rule. Combined with sidebar `height: 100vh`, the sidebar consumed the full viewport height, pushing `.admin-main` content far below the fold. Fixed by adding `flex-direction: row; align-items: stretch;` to `.admin-layout` and removing `flex: 1` from `.admin-content` so content flows naturally from the top.

### Fixed — CSS duplicate badge definitions
Removed duplicate `.badge`, `.badge-primary`, `.badge-danger`, `.badge-warning` definitions at lines 905–918 that overwrote the originals at lines 656–665.

### Fixed — Table wrapping
Added `.admin-table-wrap` utility class with `overflow-x: auto` for responsive admin tables (categories, products, users).

### Added — Product deletion hardening
`deleteProduct()` in `services/adminCatalogService.js` now attempts physical deletion first. If a foreign-key constraint prevents it (`ER_ROW_IS_REFERENCED_2`, errno 1217), the product is soft-archived (`is_active = 0, is_published = 0`) instead. Archived products are hidden from the public catalog. Image files are preserved for archived products; deleted for fully removed ones. Controller message distinguishes both cases in Spanish.

### Added — schema.sql catalog tables
`categories`, `products`, `product_categories`, and `product_images` definitions added to `schema.sql`, matching `scripts/migrate-catalog.js` exactly. All four tables use `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`.

### Added — Admin responsive improvements
Added `.admin-content` padding reduction on mobile, `.admin-table-wrap` horizontal scroll, `.btn-xs` utility, and `.inline-form` styles.

---

## 2026-07-22 — Public Store (MySQL-backed catalog)

### Added — Store page architecture
Full public store at `/tienda` with server-rendered catalog, hero section, category sidebar, availability filters, search, sorting, active-filter chips, pagination, and responsive mobile filter drawer. MySQL-first with JSON fallback. All pages built with existing EJS layout system — no frontend framework.

### Added — Product detail route
Basic `/tienda/:slug` product detail page showing full product data, price with promotion display, images, categories, tags, and availability. Non-existent slugs return 404 with a friendly error.

### Added — Public price resolution
Centralized `resolveDisplayPrice()` in `catalogService.js`: promotional price → web price → regular price. Cards show struck-through regular price when a promotion is active. Detail page shows full price breakdown.

### Added — All-categories sidebar
`getPublicCategories()` in `catalogService.js` queries all MySQL categories (or JSON fallback) independently, so the filter sidebar always shows complete category list regardless of current search/filter results.

### Added — Context-aware navbar search
Navbar search dynamically switches between `/buscar?q=` (general) and `/tienda?search=` (store) via `navbarSearchContext` variable. Placeholder, label, name, and action all change contextually.

### Changed — Store controller upgraded
`showStore` now loads categories and catalog in parallel via `Promise.all`. `buildStoreUrl` uses `DEFAULT_LIMIT` constant. Invalid/malicious query parameters are sanitized safely (XSS, SQL injection, boundary values all return 200).

### Added — Store CSS (`public/css/store.css`)
Scoped under `.store-page`/`.page-store`. Includes hero, workspace grid, sticky filters, filter groups, active chips, toolbar, responsive product grid (4→3→2→1 columns), product cards, pagination, mobile filter drawer, product detail layout, and reduced-motion support.

### Added — Store JS (`public/js/store/store.js`)
Mobile filter drawer: toggle, close, backdrop, Escape key, viewport resize, focus management, body scroll lock. Sort auto-submit on change. Navbar initialization from shared module. Cleanup on pagehide.

---

## 2026-07-22 — Product Publication Visibility Fix

### Fixed — Root cause: products always saved as hidden (is_published=0)
All 3 admin-created products had `is_published=0` and never appeared in `/tienda`. Three contributing defects:
1. **Schema**: `is_published TINYINT(1) DEFAULT 0` — new products defaulted to hidden.
2. **Form**: The `isPublished` checkbox existed only inside `<% if (product) { %>`, so it was absent on the create form entirely. Unchecked HTML checkboxes send nothing, making `req.body.isPublished` always `undefined` → `false`.
3. **Controller**: `isPublished: req.body.isPublished ? true : false` resolved to `false` for all new products.

### Fixed — All layers corrected
- **Schema** (`schema.sql`, `scripts/migrate-catalog.js`): `is_published` default changed from `0` to `1`.
- **Database**: `ALTER TABLE` applied to change column default; existing 3 products updated to `is_published=1`.
- **Form** (`views/pages/admin/product-form.ejs`): "Mostrar en tienda" checkbox now always rendered, checked by default (`<%= !product || product.is_published ? 'checked' : '' %>`). Added supporting hint text.
- **Controller** (`controllers/adminCatalogController.js`): `isPublished` uses explicit string comparison `req.body.isPublished === '1'`; `isActive` uses same pattern for update flow.
- **Service** (`services/adminCatalogService.js`): Already had correct SQL, no changes needed.

### Added — Admin product list status column
New "Estado" column in `/admin/catalogo/productos` with three badge types:
- **Publicado** (green): `is_active=1 AND is_published=1`
- **Oculto** (amber): `is_active=1 AND is_published=0`
- **Archivado** (gray): `is_active=0`

### Verified — End-to-end publication flow
- 3 products visible in `/tienda` (was 0).
- Search, category filter, and product detail all return published products.
- Hidden product excluded from store, search, category filter, and slug detail (404).
- Republishing restores visibility.
- XSS, invalid params, and SQL injection resistant (15/15 tests pass).

## 2026-07-21 — Initial Project Setup
## 2026-07-22 — Administrative Order Management

### Added
- Admin order list and detail views with allowlisted search, filters, sorting, pagination and opaque-reference routes.
- Transactional shipping quotation/requotation, exact CRC total calculation, manual payment confirmation and delivery-specific lifecycle transitions.
- Guarded unpaid-order cancellation with locked, one-time stock restoration.
- Append-only `order_events` history, migration baseline events and internal notes.
- Database-enforced unique idempotency plus owner-scoped duplicate recovery.
- Active-database and policy tests using the built-in Node.js test runner.
- Secure database-export guidance and scoped ignored backup directories.

### Security
- Every administrative mutation remains behind administrator authorization and global CSRF protection.
- Mutations use transactions and row locks; user-controlled filter/sort/status values are bounded or allowlisted.
- Customer confirmation remains session/owner authorized and does not expose internal notes or audit events.

---

## 2026-07-22 — Payment-Proof Upload and Administrative Review

### Added — Payment proofs (`payment_proofs` table)
New table for payment-proof uploads with columns: `id` (BIGINT PK), `order_id` (FK→orders), `submitted_by_user_id` (FK→users, nullable), `submission_source` (`account`|`guest`|`recent`), `status` (`pending_review`|`approved`|`rejected`), `original_filename`, `stored_filename`, `storage_path`, `mime_type`, `file_size_bytes`, `image_width/height`, `submitted_at`, `reviewed_at`, `reviewed_by_user_id`, `rejection_reason`. Indexed on `(order_id, created_at)`, `status`, `submitter`, `reviewer`. Cascade delete on order deletion. Set-null on user deletion.

### Added — Migration (`scripts/migrate-payment-proofs.js`)
Idempotent additive migration. Creates `payment_proofs` table with InnoDB, utf8mb4. Safe to run multiple times.

### Added — Private storage (`storage/payment-proofs/`)
Payment-proof files stored outside `public/`. Never served via static middleware. `.gitignore` updated.

### Added — Payment-proof service (`services/paymentProofService.js`)
- `canUploadProof()`: Eligibility check — requires `payment_method` in (sinpe, bank_transfer), `payment_status=pending`, `final_total` not null, `shipping_status` in (not_required, quoted), `order_status=pending_payment`.
- `submitProof()`: Full upload workflow — authorization, eligibility, active-proof check, Sharp image processing (WebP 2400px, quality 86, auto-rotate, strip metadata), PDF validation (%PDF- signature), private disk storage, DB insert with event.
- `approveProof()`: Transactional approval — locks order+proof rows, validates status, sets proof approved + order paid + order_status payment_confirmed, inserts dual audit events.
- `rejectProof()`: Transactional rejection — requires rejection reason (max 500 chars), sets proof rejected, leaves payment pending, inserts audit event.
- `getProofSummary()`: Returns current proof status for order detail views.
- `getProofForServing()` + `validateProofPath()`: Authorized file serving with path traversal protection.
- `hasPendingProof()`: Blocks manual payment confirmation when a proof awaits review.

### Added — Multer config for proof uploads
New `proofFileUpload` middleware in `middleware/upload.js`: single file, 5 MB max, memory storage, allows JPEG/PNG/WebP/PDF.

### Added — Payment-proof controller (`controllers/paymentProofController.js`)
- `accountUpload` / `guestUpload`: CSRF validation, authorization, eligibility, file upload, post/redirect/get.
- `accountPreview` / `guestPreview` / `adminPreview`: Authorized file serving with safe headers (Content-Type, nosniff, no-store, Content-Disposition).
- `adminApprove` / `adminReject`: Admin review actions with validation.

### Added — Payment-proof routes
- `routes/paymentProofAccountRoutes.js`: POST upload + GET preview for authenticated customers. Mounted before global CSRF.
- `routes/paymentProofGuestRoutes.js`: POST upload + GET preview for guests. Mounted before global CSRF.
- `routes/adminOrderRoutes.js`: Added GET preview + POST approve + POST reject.

### Changed — Admin order service (`services/adminOrderService.js`)
- `getOrderByReference()` now includes `proofSummary` in response.
- `confirmPayment()` now blocks if a proof is `pending_review`.
- Manual confirmation uses `payment_confirmed_manually` event type.

### Changed — Order events (`config/orderOptions.js`)
New event types: `payment_proof_submitted`, `payment_proof_approved`, `payment_proof_rejected`, `payment_confirmed_manually`.

### Changed — Customer order views
- `views/pages/customer-order-detail.ejs`: Added proof section with status display, upload form, and rejection/replacement UI.
- `views/pages/admin/order-detail.ejs`: Added proof review section with preview, approve, and reject actions.

### Changed — Controllers
- `controllers/accountOrderController.js`: Fetches `proofSummary` for order detail.
- `controllers/guestOrderController.js`: Fetches `proofSummary` for order detail.

### Changed — CSS
- `public/css/account-orders.css`: Added proof block, proof status, proof upload form, and proof action styles.

### Tests
- Existing 13 automated tests pass (admin orders, customer orders, regressions).
- Manually validated: guest upload → pending_review → admin preview → admin reject → guest sees rejection → guest replacement → admin approve → payment confirmed.

### Security
- Payment proofs never served via public static URL.
- Files stored under `storage/payment-proofs/<reference>/<uuid>.<ext>`, not accessible via `/storage/`.
- Path traversal protection on file serve.
- CSRF protected (manual token comparison).
- Customer/guest authorization enforced.
- Only eligible orders can upload proofs.
- Active-proof invariant: at most one `pending_review` or `approved` proof per order.
- Pending proof blocks manual payment confirmation bypass.
- Images re-encoded through Sharp (metadata stripped, auto-rotate, WebP).
- PDFs validated by %PDF- header signature.
- File size capped at 5 MB.
- MIME types restricted to JPEG/PNG/WebP/PDF.
- Rejection reason capped at 500 characters.

---

## Payment-Proof CSRF Integration and Concurrent Upload Hardening (2026-07-22)

### Objective
Remove manual CSRF validation from multipart upload controllers, integrate centralized `csrf-sync` middleware, and add transactional row-locking to prevent concurrent duplicate active proofs.

### Root cause: multipart CSRF hang
The previous implementation mounted proof routes before the global CSRF middleware and performed a manual token comparison (`req.body._csrf === req.session.csrfToken`) inside controllers. The `csrf-synchronisedProtection` middleware was initially excluded because it appeared to hang when placed inline after `multer`. The root cause was **not** an architectural incompatibility with `csrf-sync` — it was due to an expired MySQL session-store lock from a previous run. The actual middleware chain `multer → csrfSynchronisedProtection → controller` works correctly and is consistent with the project's admin catalog routes pattern.

### Root cause: concurrent upload race condition
The previous `submitProof` performed a non-locking read of the `orders` row and a non-locking check for active proofs. Two concurrent requests could both determine no active proof existed and both proceed to insert. Even though the proof-row insert was wrapped in a transaction, the eligibility check happened outside the lock boundary.

### Changed — Routes (`routes/paymentProofAccountRoutes.js`, `routes/paymentProofGuestRoutes.js`)
- Added `csrfSynchronisedProtection` import from centralized `config/csrf.js`.
- Middleware order: `proofFileUpload` (multer parses multipart into `req.body`) → `csrfSynchronisedProtection` (centralized CSRF validation) → controller.
- Removed manual CSRF token comparison entirely.

### Changed — Controller (`controllers/paymentProofController.js`)
- Removed the `requireCsrf()` helper function and all calls to it from `accountUpload` and `guestUpload`.
- Controller no longer performs any CSRF token comparison; it assumes the middleware already validated the token.
- All other behavior (input validation, authorization, service calls, redirects) preserved.

### Changed — Service (`services/paymentProofService.js`)
- Refactored `uploadProof()` into `processProofFile()`: validates and re-encodes the file buffer via Sharp/PDF check but does **not** write to disk.
- Refactored `submitProof()` into two stages:
  - **Stage A** (outside TX): lightweight pre-authorization (read order without lock), file processing (Sharp/PDF validation).
  - **Stage B** (inside TX): `BEGIN TRAN` → `SELECT ... FOR UPDATE` on orders row → re-check eligibility + authorization under lock → `SELECT ... FOR UPDATE` on active `payment_proofs` rows → write file to disk → insert proof row → insert audit event → `COMMIT`.
  - Filesystem compensation: if DB insert/event/commit fails after file write, the new file is deleted. Historical proof files are never touched.
- Added `hasActiveProofUnderLock()`: queries payment_proofs with `FOR UPDATE` inside the transaction.
- Added `sanitizeFilename()` utility for consistent filename cleanup.
- `approveProof()` and `rejectProof()` already used `FOR UPDATE` on both orders and proofs — unchanged.
- `hasPendingProof()` and `getProofSummary()` unchanged for backward compatibility.

### Concurrency guarantees
- Order-row lock (`SELECT ... FOR UPDATE` on `orders`) serializes all proof submissions, approvals, and rejections for the same order.
- Active-proof invariant: at most one `pending_review` or `approved` proof per order, enforced under transaction lock.
- Manual payment confirmation (`adminOrderService.confirmPayment`) already checks pending proofs inside `withLockedOrder` (which locks the orders row) — no changes needed.
- Rejected proofs allow replacement; old rejected rows/files remain untouched.
- No database partial unique index used; row locking is the sole serialization mechanism.

### Tests
- 9 new automated tests in `tests/payment-proof-concurrency.test.js`:
  - CSRF architecture: controller has no manual comparison, routes use centralized middleware.
  - Invalid CSRF returns 403 and creates no proof.
  - Missing CSRF returns 403.
  - Two simultaneous uploads produce exactly one active proof (concurrency).
  - Upload rejected when order is already paid.
  - Rejected proof replacement: concurrent uploads serialize.
  - Login/register pages have CSRF tokens (regression).
  - Store and guest lookup pages work (regression).
- All tests pass without flakiness.

### Files modified
- `controllers/paymentProofController.js` — removed manual CSRF
- `services/paymentProofService.js` — transactional submission with order-row locking
- `routes/paymentProofAccountRoutes.js` — centralized CSRF middleware
- `routes/paymentProofGuestRoutes.js` — centralized CSRF middleware
- `tests/payment-proof-concurrency.test.js` — new tests
- `docs/CHANGELOG.md` — this entry
- `docs/PROJECT_STATUS.md` — updated

### No changes to
- `schema.sql`, migration scripts, payment_proofs table
- Customer-facing layout, admin visual design
- Product catalog, checkout behavior
- `package.json`, `package-lock.json`
- Tilo Pay, WhatsApp number (`50670240270`)
- No dependencies added

## 2026-07-24 — Panel 2 BlurText forward-scroll fix

- Heading/kicker now split into character spans inside word wrappers; support stays word-level.
- Fall-from-above motion: negative Y → soft settle overshoot → sharp final state via scrubbed `fromTo`/`to`.
- Text timeline labels moved later (`kickerIn` 0.48+) so downward scroll reveals text on-screen.
- Parent text nodes stay opacity 1 after split; CSS no longer masks split children.
- Validation: run `npm test` after change.

## 2026-07-24 — Homepage Panel 2 soft repulsion

- Replaced Antigravity cursor-ring attraction with soft quadratic repulsion (`particle − cursor`).
- Suspended home/drift remains the base target; repulsion is an additive temporary offset with clamped displacement/Z.
- Removed idle auto-pointer orbit grouping; pointer leave clears `pointerActive` immediately.
- Extracted pure force helpers to `antigravityForces.mjs` for behavioral tests.
- Validation: run `npm test` after change; production audit remains at known EJS-chain advisories.

## 2026-07-24 — Homepage Panel 2 interaction correction

- Changed the showcase surface to an accessible gray gradient with dark text.
- Converted panel-relative pointer coordinates through the Three.js camera onto the particle plane.
- Reduced tetrahedron geometry and instance scale while preserving one shared `InstancedMesh`.
- Added panel-scoped pointer input, coarse-pointer fallback, cursor-ring attraction, and idle auto-motion.
- Added scroll-scrubbed word reveals for the kicker, heading, and supporting copy.
- Moved carousel card entrance transforms onto inner wrappers so carousel slide positioning remains owned by the carousel.
- Ended the transition at `top top` so Panel 2 settles naturally without snap or pinning.
- Preserved the logo loop and the existing cursor/helmet pause-resume lifecycle.
- Validation: 371 tests passed; production audit remains at 5 known high-severity advisories in the EJS dependency chain.
