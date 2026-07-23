# Changelog

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
