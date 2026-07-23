# nlSite — Project Status

**Last updated:** 2026-07-22  
**Current phase:** Checkout & Manual Order Creation

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
- [x] Modular EJS: 2 layouts, 4 components, 13 pages
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
- [x] `test-auth.js` integration tests: 40 assertions passing (non-credential)
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
| GET/POST | Admin catalog routes | `/admin/catalogo/categorias*`, `/admin/catalogo/productos*` |

## Database

- Connection: pool via `config/db.js`
- Schema tables: `users`, `pending_registrations`, `password_reset_tokens`, `sessions`, `site_settings`, `categories`, `products`, `product_categories`, `product_images`, `orders`, `order_items`
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

## Known Limitations

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
- Helmet CSP allows `'unsafe-inline'` for EJS inline styles
- Admin login doesn't share rate limit counter with user login (separate buckets)
- Email templates inline in `config/mailer.js` (no template folder)
- Deployment hardening remains pending
- `casco.glb` is 26.76 MB (uncompressed 3D asset) — optimization deferred
- Panel 2 is a transition placeholder only; Panel 3+ not yet designed
- Manual browser visual validation of the responsive Panel 1 matrix required (in-app browser unavailable during the responsive adaptation)
- Lenis initialized only on homepage; anchor link behavior not tested
- GLB loading confirmed working via HTTP; manual browser WebGL rendering validation pending
- Admin layout root cause fixed (flex-direction column inheritance); browser visual validation pending
- Product deletion safely handles FK constraints (archive fallback); images preserved for archived products
- Real-browser visual validation of store, product detail, cart at all viewports pending
- Cart badge counts session quantities only (no DB hydration per request to avoid N+1); stale badges self-correct on next cart visit
- Checkout and order creation implemented via HTTP; real-browser visual validation pending
- Checkout confirmation is session-bound for guests (1h expiry); no persistent guest order lookup
- No admin order management views yet (admin order list/detail pending)
- No email notifications on order creation
- Cart does not survive logout (session destroyed per security policy)

## Next Recommended Phase

Admin order management (list, details, shipping quotation) or Panel 2 design.

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
