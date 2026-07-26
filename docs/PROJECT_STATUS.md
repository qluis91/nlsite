# nlSite — Project Status

**Last updated:** 2026-07-26
**Current phase:** CMS Phase 13 — Safe automatic DB migrations (Jul 2026)
**Next:** CSS variable homogenization or feature expansion
- [x] **Phase 13**: Automatic production migrations via prestart hook. MySQL advisory lock serialises concurrent instances. SHA-256 checksum verification detects stale migrations. 14-migration registry tracked in schema_migrations table. App does not start if migration fails. 899 tests, 0 failures.
- [x] **Phase 12D**: Technical SEO & structured data. JSON-LD Organization + WebSite on all public pages. JSON-LD Product + BreadcrumbList on product/category pages. Absolute canonicals. Sitemap with products, categories, gallery. robots.txt with sitemap URL. No unsafe-inline. 878 tests, 0 failures.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v24.18.0 |
| Framework | Express 4.x |
| Templates | EJS (layouts + components) |
| Database | MySQL via mysql2/promise (XAMPP) |
| Auth | express-session + bcryptjs |
| Security | helmet, express-rate-limit, csrf-sync |
| Session | express-session + express-mysql-session (MySQL) |
| Email | nodemailer (SMTP) |
| Config | dotenv (.env → config/site.js) |

## Working Features

- [x] **Phase 12C**: Dynamic product & category SEO. 6 SEO columns on products + categories. SEO fieldset in product/category admin forms. Product pages: metaTitle, ogImage (primary image fallback), canonical URL. Category pages: metaTitle, ogImage (hero image fallback), canonical URL. Fallback chain: explicit SEO → generated from catalog data → store-level CMS → global. 853 tests, 0 failures.
- [x] **Phase 12B**: Page-specific SEO with page tabs.
- [x] **Phase 12A**: Global settings & SEO with OG/Twitter/favicon tags.
- [x] **Phase 11E**: Full CMS stabilization with 798 passing tests.
- [x] **Phase 11D**: Centralized publishing dashboard, publication batches, atomic multi-section publication, revision history browser, version comparison, and safe restoration with audit trail.
- [x] Unificada la experiencia de subida directa para todos los selectores de imágenes CMS: pestañas "Seleccionar de la biblioteca" + "Subir desde mi dispositivo"
- [x] Shared image processing pipeline at WebP quality 80 for all public/content images — CMS media library, gallery, catalog, avatars
- [x] All sharp quality settings unified to 80: `IMAGE_VARIANTS` (large/medium/thumbnail), `imageProcessingService PROFILES` (product/avatar/gallery/category), `galleryOptions IMAGE_PROFILES` (display/thumbnail/poster)
- [x] Upload profiles (`config/cmsOptions.js` UPLOAD_PROFILES): `navbar-logo`, `navbar-light`, `navbar-dark`, `favicon`, `hero-background`, `hero-model`, `hero-fallback`, `logo-loop`, `carousel-main`, `carousel-preview`, `feature-icon`, `nav-item-icon`, `gallery`, `product`, `category`, `avatar`
- [x] AJAX upload endpoint `POST /admin/api/page/media/upload` with capability check, CSRF, Multer, profile validation, duplicate detection, transactional DB/cleanup
- [x] `mediaService.createFromSelectorUpload` — creates asset or returns existing duplicate
- [x] All media-selector includes in Navbar, Panel 1, Panel 2, Panel 3 updated with `uploadProfile` parameter
- [x] Payment proofs explicitly unchanged (private, separate flow, quality 86)
- [x] GLB uploads remain GLB-only, not passed through Sharp

- [x] Visual media selector integrated into Navbar and Panel 1 admin forms (logos, favicon, background, GLB, fallback) with type filtering and pre-population
- [x] Public Panel 3 consumes published CMS feature items via `servicesCarousel.mjs`, with hardcoded `SERVICES` fallback for zero items
- [x] Panel 2/3 draft preview complete with preview banner, draft repeatable items, no-cache/noindex headers
- [x] Admin layout supports `pageScripts` for non-module JS (media-selector.js loaded on all admin page editors)
- [x] Full test suite: 486 tests, 0 failures (Phase 11A+B+C tests all pass)
- [x] `saveItem` revision data corrected: previousData = old row, newData = merged result

- [x] Admin CMS: Panel 2 editor (LogoLoop items, project carousel, general content/styles) and Panel 3 editor (feature cards, general content/styles) — see `docs/CMS_PHASE_11C.md`
- [x] `logo_loop_items`, `home_carousel_items`, `home_feature_items` tables with UUID public_ids, soft-delete, sort_order, status workflow (draft/published/archived), idempotent seed of current hardcoded items
- [x] Reusable visual media selector: EJS partial + vanilla JS, server-side search/filter/pagination, type/category constraints, upgrades all Phase 11B media inputs
- [x] Public homepage: Panel 2 LogoLoop, carousel, and Panel 3 headings/text resolve published CMS content with hardcoded fallbacks
- [x] Admin CMS: Navbar editor (logo, colores, favicon, enlaces ordenables, draft/publicar) and Panel 1 editor (textos, botones, modelo 3D GLB, fallback, draft/publicar/preview) — see `docs/CMS_PHASE_11B.md`
- [x] `navigation_items` table with UUID public_ids, soft-delete, sort_order, status workflow (draft/published/archived), idempotent seed of current navbar links
- [x] Public homepage: navbar and Panel 1 resolve published CMS content with hardcoded fallbacks; CMS content never blanks the public site
- [x] Three.js model configuration from DOM data attributes (model URL, scale, position, rotation, auto-rotate, speed); single renderer/canvas/RAF lifecycle preserved
- [x] In-memory read cache for published site content, invalidated per-namespace on publish; drafts and preview bypass cache

- [x] Admin `Administrar página` overview with media aggregates and non-linked placeholders for navbar, Panel 1/2/3 and publishing (see `docs/CMS_PHASE_11A.md`)
- [x] CMS media library with upload, metadata editing, file replacement preserving media identity, archive (soft delete) and restore, behind admin auth, capability checks and CSRF
- [x] Content-based upload validation (MIME/extension/decoded bytes), 15 MB image and 30 MB GLB limits, 10000 px dimension cap, decompression-bomb and animated-image rejection, SVG disabled by design
- [x] Sharp WebP variants (2560 / 1280 / 400) without upscaling, metadata stripped, transparency preserved, SHA-256 checksum duplicate detection and bounded-concurrency batch uploads with partial-success reporting
- [x] GLB magic-byte, version, length and JSON-chunk validation with stored model metadata; models never processed by Sharp
- [x] Configurable media storage under `<UPLOAD_PUBLIC_DIR>/media` with traversal-resistant resolution, never-overwrite writes and failure compensation
- [x] `media://<public_id>` reference tokens with usage lookup across `page_sections` and `site_settings`, extensible per phase, blocking archive of referenced assets
- [x] Idempotent additive CMS migration for `media_assets`, `pages`, `page_sections`, extended `site_settings` and `content_revisions`, with transactional non-overwriting `home` seed
- [x] Revision/audit records for upload, metadata edit, replacement, archive and restore using allowlisted metadata snapshots
- [x] Public homepage and every existing upload flow unchanged; seeded sections remain disabled drafts so hardcoded fallbacks still render
- [x] Public `/galeria` with server-rendered category/type filters, 24-item pagination, responsive fallback grid and empty states
- [x] MySQL gallery categories/items with additive idempotent migration, synchronized schema, publication, featured state and deterministic ordering
- [x] Admin gallery/category CRUD behind administrator authentication and centralized CSRF
- [x] JPEG/PNG/WebP Sharp processing into bounded display WebP plus 512×512 renderer thumbnail
- [x] Local MP4/WebM uploads with matching extension, basic signature check and mandatory processed poster
- [x] Random filenames, allowlisted public roots, traversal-resistant resolution, compensation cleanup and post-commit old-file deletion
- [x] One shared image/video modal with safe JSON, no untrusted `innerHTML`, keyboard navigation, focus restoration and video pause on close
- [x] Optional `view=circular` native-WebGL renderer with `bend: 0`, thumbnail-only textures, infinite looping, inertia, drag/wheel/keyboard controls and active-item modal action
- [x] Complete Circular Gallery lifecycle: idempotent destroy, RAF/observer/listener/resource cleanup, resize/DPR cap, visibility/intersection pause and context-loss fallback
- [x] Optional `view=ring` native CSS 3D renderer with dynamic geometry, thumbnail-only cards, drag inertia, snapping, scoped wheel/keyboard controls, depth parallax and stable-ID modal reuse
- [x] Single enhanced-renderer ownership with idempotent Ring teardown, idle-only RAF, visibility/intersection pause and responsive resize
- [x] Optional `view=infinite` native WebGL 2 renderer with icosahedron sphere geometry, instanced disc rendering, texture atlas from thumbnails, arcball two-axis controls with inertia and snapping, keyboard/wheel input, and stable-ID modal reuse
- [x] Complete Infinite Menu lifecycle: idempotent destroy clearing all GL resources, listeners, observers, and timers; visibility/intersection pause; context-loss fallback; reduced-motion Grid fallback
- [x] Added `gl-matrix@3.4.3` vendor dependency for vector/quaternion/matrix operations; no React/OGL/GSAP/Three.js
- [x] Explicit idempotent local Sharp demo seed with prefix-owned cleanup/reset, rollback compensation, media integrity checks and production execution blocked by default
- [x] Reduced-motion, no-JavaScript, no-WebGL, low-capability, initialization-error and broken-thumbnail grid fallback behavior
- [x] No OGL dependency added; native WebGL follows the ReactBits source behavior without exposing `node_modules` or expanding CSP
- [ ] Real-browser gallery viewport validation pending
- [x] Owner-scoped saved-address CRUD with labels and Costa Rican address validation
- [x] Transactional single-default invariant, automatic first default and oldest-address promotion on deletion
- [x] Maximum 20 addresses per customer with session-derived ownership and safe cross-user 404 responses
- [x] Saved/default address selection for authenticated checkout and manual-only guest checkout
- [x] Server-authoritative saved-address resolution with manual-field manipulation ignored
- [x] Immutable order address snapshots after saved-address edit or deletion
- [x] Local pickup ignores address selection and persists no delivery address
- [x] Shared authenticated account shell with server-rendered active navigation
- [x] `/cuenta` dashboard with bounded owner-scoped order aggregates and latest order
- [x] Editable first/display name, optional surname and normalized phone; email remains read-only
- [x] Safe avatar upload/replacement/removal using Multer memory storage and Sharp 512×512 WebP output
- [x] Password change verifies the current hash, rotates the session, preserves only the cart and clears guest grants
- [x] Additive idempotent user-profile migration for `last_name`, `phone`, `avatar_path` and `password_changed_at`
- [x] Authenticated `/cuenta/pedidos` list with strict server-session ownership and pagination
- [x] Customer-safe order detail with snapshots, address, totals, payment guidance and public timeline
- [x] Guest lookup using strict reference plus normalized email for guest-owned orders only
- [x] Session-bound guest grants capped at 5 and expiring after 30 minutes
- [x] Generic lookup failures, CSRF enforcement and 7-attempt/15-minute rate limiting
- [x] Login regeneration clears guest grants while preserving only the existing cart policy
- [x] Controlled ephemeral authorization fixtures with no credential-dependent skips
- [x] Admin order list/detail with search, filters, sorting and pagination
- [x] Transactional shipping quotation and exact server-side final totals
- [x] Manual payment confirmation for enabled manual payment methods
- [x] Delivery-specific order lifecycle and guarded cancellation with one-time stock restoration
- [x] Immutable `order_events` audit history and internal notes
- [x] Database-enforced unique checkout idempotency with safe duplicate recovery

- [x] Public pages: Home, Login, Register, Admin Login, Forgot Password
- [x] Email verification flow: pending registration → email → verify → user created
- [x] Password recovery: forgot form → email → reset → login
- [x] Token security: crypto.randomBytes + SHA-256 hash storage
- [x] Verification pending page with masked email and resend option
- [x] Authentication: user login, admin login on `/admin/login`, register, logout
- [x] Inactive-user rejection: `is_active=0` users cannot log in (generic message)
- [x] Admin login with visual distinction (badge, border-color)
- [x] Admin login rate limiting: 5 attempts / 15 min window
- [x] Resend-verification rate limiting: 3 attempts / 15 min
- [x] Forgot-password rate limiting: 3 attempts / 15 min
- [x] Generic responses for forgot-password and resend-verification
- [x] Role-based redirects: admin login → `/admin`, user login → `/`
- [x] Session regeneration on login (fixation protection)
- [x] Email normalization (trim + lowercase) on all forms
- [x] Registration form preserves name and email on validation failure
- [x] Role-based access: admin/user with middleware guards
- [x] Admin panel: dashboard, user CRUD (create, edit, toggle active/inactive, delete)
- [x] Dashboard stats: total users, active users, administrators
- [x] Role mapping shared via `config/roles.js` (no duplication)
- [x] `create-admin.js` interactive script for safe admin creation
- [x] Brand-white-label: colors/text from `.env` injected as CSS variables
- [x] Responsive CSS (768px breakpoint)
- [x] Modular EJS layouts and reusable components for public, admin and customer-account surfaces
- [x] Parameterized SQL queries throughout
- [x] Helmet security headers (CSP, HSTS, etc.)
- [x] Per-request CSP nonce for inline import map and style blocks (no global unsafe-inline in script-src)
- [x] External GLB loading from Google Cloud Storage (connect-src scoped to single origin)
- [x] Login rate limiting: 5 attempts / 15 min window (both user and admin)
- [x] Session cookie: HttpOnly, SameSite=Lax, configurable maxAge
- [x] Centralized 404 and 500 error pages
- [x] Errors propagated via `next(error)` to 500 handler
- [x] EJS layout middleware (`config/viewEngine.js`) — zero extra dependencies
- [x] POST logout visible in both navbars after login
- [x] `test-auth.js` integration coverage for anonymous authentication and CSRF flows
- [x] CSRF protection on all state-changing routes (csrf-sync, synchronizer-token)
- [x] 403 error page for invalid/missing CSRF tokens
- [x] Persistent MySQL session store (survives restarts, auto-cleanup every 15min)
- [x] Server configured to wait for session store readiness before starting (no silent MemoryStore fallback)
- [x] Session shape: `{id, name, email, role_id, role}` consistent across all logins
- [x] Admin authorization uses numeric `role_id === 1` (not string comparison)
- [x] Login SQL: `WHERE email = ? AND is_active = 1 LIMIT 1`
- [x] Homepage Panel 1 (Hero): full-viewport animated panel with 3D helmet
- [x] Interactive 3D helmet via Three.js (`casco.glb`, 26.76 MB)
- [x] GSAP + ScrollTrigger entrance animations and scroll-linked transitions
- [x] Lenis smooth scrolling (homepage only, respects reduced motion)
- [x] Panel architecture (`data-panel="1"`, `data-panel="2"` transition placeholder)
- [x] Responsive design tested at multiple breakpoints (desktop, tablet, mobile)
- [x] Reduced-motion accessibility (CSS media query + JS detection)
- [x] No bundler — vendor aliases + import map for Three.js/GSAP/Lenis
- [x] Homepage-specific CSS/JS scoped under `.home-page` / `body.page-home`
- [x] Localized 3D model loading state: morphing SVG spinner (SpinnerMorph via native SMIL) inside `.hero-3d` only; page renders immediately without full-screen intro
- [x] 3D model state machine: `loading → ready → error` with `data-model-state` attribute and canvas fade-in transitions
- [x] Model error state with safe "Reintentar" button that disposes of failed renderer resources before retrying
- [x] SpinnerMorph: exact original 3-state SVG path sequence via `<animate attributeName="d">` + `<animateTransform>` rotation; configurable via EJS partial and guarded by equality/hash regression coverage
- [x] Full-page intro disabled via `ENABLE_PAGE_INTRO = false` server-side flag; legacy page-loader code preserved for future reactivation
- [x] CSP updated for WebGL (`blob:`, `connect-src`, `worker-src`)
- [x] Admin catalog: category CRUD (create, edit, delete with product-count guard)
- [x] Admin catalog: product CRUD with multi-category checkbox selection
- [x] Product fields: name, regular/promotional/web price, weight (grams), stock, description, tags
- [x] Product images: max 5 total (1 primary + 4 secondary), auto-promote primary on delete
- [x] Centralized image processing via Sharp: auto-rotate, resize, WebP @ 80% quality
- [x] Image upload middleware (multer): MIME validation, 10MB limit, memory storage
- [x] Admin product form: image previews, existing gallery, primary badge, remove checkboxes
- [x] Public catalog reads from MySQL with JSON fallback (`getPublicCatalogAsync`)
- [x] Transactional product create/update with compensating file cleanup
- [x] Sidebar and dashboard updated with catalog links
- [x] Homepage responsive structure preserves the desktop header/two-column composition through tablet widths
- [x] Mobile homepage uses a two-row header, single-column content flow, bounded 3D canvas, full-width CTAs, and in-flow social links
- [x] Homepage scroll animations use breakpoint-specific GSAP movement and refresh after the 3D model loads
- [x] Homepage Panel 2 uses a gray showcase surface, camera-correct Antigravity soft repulsion field, scroll-scrubbed word reveals, and transform-safe carousel entrance layers
- [x] Admin layout repaired: flex-direction row prevents sidebar from pushing content below the fold
- [x] Product deletion hardened: FK check, falls back to archive (`is_active=0, is_published=0`) if referenced
- [x] schema.sql fully synchronized with migrate-catalog.js (categories, products, product_categories, product_images)
- [x] Admin responsive improvements: table-wrap overflow, inline-form styles, btn-xs utility
- [x] CSS duplicate badge definitions removed
- [x] Public store at `/tienda`: hero, category sidebar, search, availability filters, sorting, pagination
- [x] Product cards with image, name, category, price (promotional display), availability
- [x] Product detail page at `/tienda/:slug`: interactive gallery, breadcrumbs, quantity selector, cart (disabled/upcoming), WhatsApp, related products
- [x] Product gallery: up to 5 images, primary-first ordering, deduplication, thumbnail buttons with `aria-pressed`
- [x] `formatWeight()` — grams displayed as `g` or `kg`
- [x] `getRelatedProducts()` — same-category + recent fallback, excludes current product
- [x] `safeReturnPath()` — validates returnTo parameter, rejects external/admin URLs
- [x] WhatsApp CTA using `WHATSAPP_NUMBER` env var with safe encoded message
- [x] `product-detail.js` — ES module for gallery interaction + quantity ± control
- [x] WhatsApp number centralized in `config/publicContact.js` with approved `50670240270`
- [x] Shopping cart at `/carrito`: add, update quantity, remove, clear, subtotal summary
- [x] Session-based cart storage (`req.session.cart`)
- [x] Cart preservation through login session regeneration (guest cart survives login)
- [x] Navbar cart badge with quantity count (`hero-nav-badge`)
- [x] Server-authoritative price/stock revalidation on every cart render and mutation
- [x] Product-detail cart button enabled: real POST form when in stock, "Agotado" when not
- [x] Hidden/archived/deleted products auto-removed from cart with user-facing notice
- [x] Out-of-stock items preserved visibly in cart with "agotado" status
- [x] CSRF protection on all cart mutations (POST only)
- [x] Checkout placeholder (disabled, "próximamente") — replaced with enabled link
- [x] Manual checkout at `/checkout`: customer details, delivery method (pickup, Uber Flash, private courier, Correos CR), payment method (SINPE, bank transfer, Tilo Pay disabled)
- [x] Delivery methods: local_pickup (₡0, no address), uber_flash/private_courier/correos_cr (pending quote, address required)
- [x] Costa Rican address fields: province select (7 provinces), canton, district, exact address, references
- [x] Payment methods: SINPE Móvil (+506 7024 0270), bank transfer; Tilo Pay displayed as "Próximamente" (disabled)
- [x] Conditional shipping: ₡0 for pickup, "Por calcular" for delivery; final_total null when shipping pending
- [x] Order creation: transactional stock deduction (`SELECT ... FOR UPDATE`), product price/stock revalidation, idempotency via checkoutToken
- [x] Order snapshots: immutable product name, slug, quantity, unit price, line total, primary image in `order_items`
- [x] Guest checkout: `user_id=null`, customer snapshot stored, confirmation access via session-bound recent order reference
- [x] Confirmation page: delivery-specific messaging (do not pay for pending shipping, "Pago pendiente" for known totals)
- [x] Cart clearing only after successful transaction commit
- [x] `config/checkoutOptions.js`: canonical delivery methods, payment methods, CR provinces
- [x] `validators/checkoutValidator.js`: customer name, email, phone, delivery, payment, address validation
- [x] `services/orderService.js`: `generateOrderReference()`, `generateCheckoutToken()`, `createOrder()` (transactional)
- [x] `controllers/checkoutController.js`: GET checkout, POST checkout, GET confirmation
- [x] `routes/checkoutRoutes.js`: mounted at `/checkout`
- [x] `views/pages/checkout.ejs`: full form with conditional address section, sticky summary, JS enhancement
- [x] `views/pages/checkout-confirmation.ejs`: order received hero, payment instructions, shipping status, item list
- [x] `public/css/checkout.css`: scoped `.checkout-*` / `.confirm-*` styles, responsive desktop→mobile
- [x] `public/js/checkout/checkout.js`: address show/hide, shipping/total toggle
- [x] `schema.sql` updated with `orders` and `order_items` tables
- [x] `scripts/migrate-orders.js`: idempotent migration for orders system
- [x] `services/cartService.js`, `controllers/cartController.js`, `routes/cartRoutes.js`
- [x] `views/pages/carrito.ejs`, `public/css/cart.css`, `public/js/cart/cart.js`
- [x] `getPublicProductsByIds()` batch lookup for efficient cart hydration
- [x] Bounded cart: max 50 distinct products, 99 units per item
- [x] Price resolution: promotional → web → regular, with struck-through regular on promotion
- [x] Context-aware navbar search: `/buscar?q=` (general) vs `/tienda?search=` (store)
- [x] All public categories shown in store sidebar (independent query, not filtered by results)
- [x] Mobile filter drawer with EJS-enhanced JS (toggle, backdrop, Escape, focus management)
- [x] Sort auto-submit on change (JS enhanced, server-side allowlisted)
- [x] Active filter chips with individual remove links
- [x] Store CSS scoped under `.store-page` / `.page-store`
- [x] `name-desc` sort added to allowed list
- [x] Server-side pagination, URL-safe parameter building, query validation
- [x] XSS, SQL injection, boundary-value rejection on all store parameters
- [x] Product publication fix: `is_published` defaults to 1 (visible), "Mostrar en tienda" checkbox always present in form
- [x] Admin product list "Estado" column: Publicado (green), Oculto (amber), Archivado (gray)
- [x] Schema and migration: `is_published DEFAULT 1` (was 0)

## New Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/verify-pending` | Shows verification pending page |
| GET | `/auth/verify-email?token=` | Verifies email, creates user account |
| GET/POST | `/auth/resend-verification` | Resend verification email form + action |
| GET/POST | `/auth/forgot-password` | Forgot password form + action |
| GET/POST | `/auth/reset-password?token=` | Reset password form + action |
| GET | `/tienda` | Public store with filtering, sorting, pagination |
| GET | `/tienda/:slug` | Public product detail page |
| GET/POST | `/carrito` | Shopping cart: view, add, update, remove, clear |
| GET/POST | `/checkout` | Checkout: form + order creation |
| GET | `/checkout/confirmacion/:reference` | Order confirmation page |
| POST | `/cuenta/pedidos/:ref/comprobante` | Authenticated payment-proof upload |
| GET | `/cuenta/pedidos/:ref/comprobante/:id` | Authenticated proof preview |
| POST | `/consultar-pedido/:ref/comprobante` | Guest payment-proof upload |
| GET | `/consultar-pedido/:ref/comprobante/:id` | Guest proof preview |
| POST | `/admin/orders/:ref/comprobante/:id/aprobar` | Admin approve payment proof |
| POST | `/admin/orders/:ref/comprobante/:id/rechazar` | Admin reject payment proof |
| GET | `/admin/orders/:ref/comprobante/:id` | Admin proof preview |
| GET | `/cuenta` | Authenticated customer account summary |
| GET/POST | `/cuenta/perfil` | View and update allowlisted profile fields |
| POST | `/cuenta/avatar` | Upload and replace a safe account avatar |
| POST | `/cuenta/avatar/eliminar` | Remove the current account avatar |
| GET | `/cuenta/seguridad` | View account security |
| POST | `/cuenta/seguridad/contrasena` | Change password and rotate the session |
| GET | `/cuenta/pedidos*` | Owner-scoped order list and detail |
| GET/POST | Admin catalog routes | `/admin/catalogo/categorias*`, `/admin/catalogo/productos*` |
| POST | `/cuenta/pedidos/:ref/pagar/tilopay` | Authenticated Tilopay payment initiation |
| POST | `/cuenta/pedidos/:ref/tilopay/verificar` | Customer payment verification (Verificar estado del pago) |
| POST | `/consultar-pedido/:ref/pagar/tilopay` | Guest Tilopay payment initiation |
| POST | `/consultar-pedido/:ref/tilopay/verificar` | Guest payment verification |
| GET | `/pagos/tilopay/retorno` | Tilopay return/success page |
| GET | `/pagos/tilopay/cancelado` | Tilopay cancellation page |
| POST | `/webhooks/tilopay` | Tilopay webhook/callback (no session, provider auth) |
| POST | `/admin/orders/:ref/tilopay/reconcile` | Admin Tilopay transaction reconciliation |

## Database

- Connection: pool via `config/db.js`
- Schema tables: `users`, `pending_registrations`, `password_reset_tokens`, `sessions`, `site_settings`, `categories`, `products`, `product_categories`, `product_images`, `orders`, `order_items`, `order_events`, `payment_proofs`, `tilopay_transactions`
- `pending_registrations`: Stores unverified registration data with SHA-256 token hash, expires_at
- `password_reset_tokens`: Single-use reset tokens with FK to `users(id)`, used_at tracking
- `role_id`: 1 = admin, 2 = user — mapped via `config/roles.js`
- `is_active`: TINYINT(1), default 1 — controls login access
- Product deletion: attempts physical delete first; if FK-constrained, archives (`is_active=0, is_published=0`)
- No hardcoded credentials in source code. Use `node create-admin.js` to add administrators.

## Email Configuration

- Transporter: `config/mailer.js` reads from `.env`
- Required variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `APP_URL`
- Optional: `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`, `EMAIL_VERIFICATION_EXPIRES_MINUTES`, `PASSWORD_RESET_EXPIRES_MINUTES`
- Verify: `mailer.verifyConnection()` in dev
- Status: Registration verification and password-reset emails were manually confirmed delivered and functional.

## AI Tools Configured

| Tool | Purpose | Status |
|------|---------|--------|
| Graphify | Knowledge graph + query | Installed |
| Caveman | Token-efficient communication | Skill loaded |
| CodeBurn | Token usage tracking (estimates) | Global install, CLI active |

- Panel 2 and Panel 3 admin editors fully working: create, save, reorder, publish, preview, revision tracking.
- Panel 2 carousel: main image and preview/secondary image persist independently, preview cards show swapped images, autoplay every 5.5s (pauses on hover/tab-hidden, respects reduced-motion), clickable preview cards promote to active slide.
- Panel 2 LogoLoop: images constrained to `clamp(90px, 16vw, 140px)` with `object-fit: contain`, preserving aspect ratio within fixed track height.
- Auth pages (login, register, admin login, forgot-password) share unified dark theme via `pageClass: 'page-auth'` and `auth.css` — zero white-card or navbar-visible auth pages.
- All admin views comply with CSP via per-request `nonce`; zero `onclick=` attributes on admin pages; all inline scripts use `nonce="<%= cspNonce %>"`.
- All `media-selector` includes correctly resolve media references without crashing on missing/archived assets.
- `resolveMediaData` in `adminPageContentController` aliases real schema columns (`original_name`→`original_filename`, `thumbnail_path`→`thumbnail_url`, `CONCAT(width,height)`→`dimensions`).

## Known Limitations

- Real-browser visual validation of the account dashboard viewport matrix is pending because no browser backend was available in the Codex session.
- 15 `.ejs` templates not parsed by Graphify AST (no tree-sitter-ejs)
- `schema.sql` now matches actual DB schema with all 4 catalog tables present (`categories`, `products`, `product_categories`, `product_images`)
- No protection against deactivating the last administrator
- Verification and password-reset tokens are stored as SHA-256 hashes in MySQL, not in sessions. The CSRF synchronizer token is stored as part of the persistent session data.
- Token cleanup is inline (per-request), no cron/scheduler for expired tokens
- No AJAX/fetch CSRF header support (forms only)
- Manual browser CSRF validation pending
- Manual browser restart validation pending
- Session expiration has not been tested with a shortened lifetime
- MySQL session-store failure mode has not been manually tested
- Multiple Node.js process sharing has not been tested
- Rate-limit counters remain in memory (reset on restart)
- Helmet CSP uses per-request nonce (`crypto.randomBytes`) — zero `'unsafe-inline'` in `script-src`. Inline styles remain permitted via `'unsafe-inline'` on `style-src` only.
- Admin login doesn't share rate limit counter with user login (separate buckets)
- Email templates inline in `config/mailer.js` (no template folder)
- Deployment hardening remains pending
- `casco.glb` is 26.76 MB (uncompressed 3D asset) — optimization deferred
- Panel 2 and Panel 3 are fully implemented with admin CRUD, preview, publish, and revision history.
- Manual browser visual validation of the responsive Panel 1 matrix required (in-app browser unavailable during the responsive adaptation)
- Lenis initialized only on homepage; anchor link behavior not tested
- GLB loading confirmed working via HTTP; manual browser WebGL rendering validation pending
- Admin layout root cause fixed (flex-direction column inheritance); browser visual validation pending
- Product deletion safely handles FK constraints (archive fallback); images preserved for archived products
- Real-browser visual validation of store, product detail, cart at all viewports pending
- Cart badge counts session quantities only (no DB hydration per request to avoid N+1); stale badges self-correct on next cart visit
- Checkout and order creation implemented via HTTP; real-browser visual validation pending
- Checkout confirmation remains session-bound for immediate guest access (1h); later lookup grants access for 30 minutes after reference-and-email verification.
- Administrative order list/detail, shipping quotation, payment confirmation and lifecycle controls implemented; real-browser visual validation remains pending.
- No email notifications on order creation
- Cart does not survive logout (session destroyed per security policy)

## Next Recommended Phase

1. **Tilopay sandbox access**: Register at https://web.tilopay.com/developers, obtain sandbox credentials, fill in actual API endpoint URLs from the Tilopay merchant portal or Postman collection, complete a real sandbox transaction.
2. **Real-browser validation** of all payment flows (Tilopay form, return, cancel) across all viewports.
3. **Webhook end-to-end** when callback URL is publicly reachable.

## Current Limitations

- Tilopay integration: all provider-neutral code is complete, but real API endpoints, webhook signatures, and sandbox credentials require merchant portal access. No invented behavior remains.
- Administrative order list/detail, shipping quotation, payment confirmation and lifecycle controls implemented; real-browser visual validation remains pending.
- No email notifications on order creation
- Cart does not survive logout (session destroyed per security policy)
- Payment-proof review has not been validated in a real browser; HTTP integration tests confirm all routes respond correctly.
- Multipart CSRF middleware order documented: `multer` → `csrfSynchronisedProtection` → controller. Order-row locking serializes concurrent proof submissions with file cleanup compensation.
- No database partial unique index used for active-proof invariant; row locking is the sole mechanism.
- SDK V2 evaluation pending (guides behind merchant portal login).

## Completed Phases

| Phase | Description | Date |
|-------|-------------|------|
| Initial | Boilerplate creation (22 files) | 2026-07-21 |
| AI Config | Graphify + Caveman + CodeBurn + rules + docs | 2026-07-21 |
| Security | Helmet, rate limiting, session hardening, 404/500, auth fixes | 2026-07-21 |
| Auth UI | Authentication Interface and Manual Verification | 2026-07-21 |
| DB Fix | Database Schema Consistency and Security Correction | 2026-07-21 |
| Logout | Logout Flow Correction | 2026-07-21 |
| Auth Fix | Critical Authentication and Authorization Correction | 2026-07-21 |
| Email/PW | Email Verification and Password Recovery | 2026-07-21 |
| CSRF | CSRF Protection (csrf-sync, 13 forms, 45 tests) | 2026-07-21 |
| Sessions | Persistent MySQL Sessions (express-mysql-session) | 2026-07-21 |
| Frontend P1 | Frontend Foundation — Animated Panel 1 (Three.js + GSAP + Lenis) | 2026-07-21 |
| P1 Visual Fix | Panel 1 Helmet and Logo Correction (3D import fix + logo sizing) | 2026-07-21 |
| CSP Fix | Critical Panel 1 Runtime Correction (CSP nonce + external GLB + nav) | 2026-07-21 |
| P1 Responsive | Homepage Responsive Adaptation (layout, 3D stage, social links, animation breakpoints) | 2026-07-21 |
| Admin Catalog | Admin Catalog Module (Categories, Products, Images, Sharp) | 2026-07-22 |
| Catalog Hardening | Admin Layout Repair + Deletion Hardening + Schema Sync | 2026-07-22 |
| Public Store | Store page, product detail, categories, filtering, sorting, pagination | 2026-07-22 |
| Publication Fix | is_published defaults to 1; admin status badges; store now shows products | 2026-07-22 |
| Product Detail | Gallery, breadcrumbs, quantity, cart prep, WhatsApp, related products | 2026-07-22 |
| Cart | Shopping cart with session storage, server-authoritative prices, navbar badge | 2026-07-22 |
| Checkout | Manual checkout, order creation, stock deduction, idempotency, confirmation | 2026-07-22 |
| Payment Proofs | Upload, private storage, admin review, approve/reject, audit events | 2026-07-22 |
| Payment-Proof CSRF | Centralized CSRF middleware for multipart routes, transactional order-row locking for concurrent uploads, file cleanup, concurrency tests | 2026-07-22 |
| Tilopay v1 | Provider-neutral architecture with documentation audit. Config validator, multi-client deployment model (PUBLIC_BASE_URL), derived callback URLs. Invented HMAC/webhook logic removed. Server-to-server lookup for notification verification. MOCK_MODE gated from production. Client setup guide. | 2026-07-23 |
| Tilopay v2 | **BLOCKED**: Real API endpoints, webhook signatures, sandbox credentials, live transactions pending. SDK V2 guides behind merchant portal login, Postman requires JS. See docs/TILOPAY_INTEGRATION.md for exact gaps. | 2026-07-23 |
| 3D Loader | Localized 3D loading animation: full-page intro disabled, SpinnerMorph (native SVG/SMIL) inside hero-3d only, model state machine (loading/ready/error), retry button, reduced-motion support, zero new dependencies | 2026-07-23 |
| Homepage Panel 2 | Gray project showcase, camera-space Antigravity soft repulsion, scroll-driven Blur Text, carousel wrapper/card entrance, and preserved Panel 1 lifecycle | 2026-07-24 |
| CMS Phase 11A | CMS foundation: media library, upload validation, Sharp variants, GLB validation, revisions | 2026-07-24 |
| CMS Phase 11B | Navbar editor, Panel 1 editor, draft/publish/preview, cache | 2026-07-24 |
| CMS Phase 11C | Panel 2/3 editors, LogoLoop, carousel, feature cards, reusable media selector | 2026-07-24 |
| CMS Phase 11C-S | Direct upload, unified WebP quality 80, upload profiles, AJAX endpoint | 2026-07-25 |
| CMS Phase 11D | Centralized publishing, atomic batches, history, comparison, safe restore, 75 tests | 2026-07-25 |
