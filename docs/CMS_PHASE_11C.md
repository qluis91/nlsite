# CMS Phase 11C — Panel 2, Panel 3 y Visual Media Selector

## Resumen

Phase 11C extiende el CMS con:
1. **Visual Media Selector** reutilizable (EJS partial + vanilla JS)
2. **Panel 2 (Showcase)** — administración de LogoLoop, carrusel de proyectos y contenido general
3. **Panel 3 (Servicios)** — administración de contenido general y tarjetas de características

## Visual Media Selector

### Ubicación

- **Partial EJS**: `views/components/media-selector.ejs`
- **JS**: `public/js/admin/media-selector.js`
- **API JSON**: `GET /admin/api/page/media` → `adminMediaController.mediaBrowse()`

### Uso en templates

```ejs
<%- include('media-selector', {
  fieldName: 'modelMedia',
  currentValue: 'media://uuid-or-null',
  allowedTypes: ['image/png', 'image/jpeg'],
  allowedCategories: ['logos'],
  label: 'Logotipo principal',
  kindLabel: 'Logo'
}) %>
```

### Comportamiento

- Muestra thumbnail, título, categoría, MIME, dimensiones
- Hidden input guarda `media://<public_id>`
- Botones: Seleccionar, Cambiar, Quitar
- Modal con search, category filter, type filter, paginación
- Backend valida media seleccionado (tipos permitidos, activo)

## Nuevas tablas

### `logo_loop_items`
Item types: `text`, `image`, `logo`
Campos: public_id, page_section_id, item_type, text_content, media_public_id, url, link_type, target, alt_text, sort_order, is_visible, status

### `home_carousel_items`
Campos: public_id, page_section_id, eyebrow, title, description, button_label, button_url, button_target, media_public_id, preview_media_public_id, theme_key, sort_order, is_visible, status

Temas permitidos: `graphite`, `lime`, `silver`, `ink`

### `home_feature_items`
Campos: public_id, page_section_id, title, description, detail_text, icon_type, icon_key, media_public_id, url, link_type, target, style_variant, sort_order, is_visible, status

Íconos integrados: `diseno-3d`, `escaneo-3d`, `diseno-grafico`, `desarrollo-web`, `prendas`, `impresion-3d`

## Rutas admin

### Panel 2
| Ruta | Método | Descripción |
|------|--------|-------------|
| `/admin/page/home/panel-2` | GET | Editor Panel 2 |
| `/admin/page/home/panel-2/draft` | POST | Guardar borrador |
| `/admin/page/home/panel-2/publish` | POST | Publicar Panel 2 |
| `/admin/page/home/panel-2/logo-loop/items` | POST | Crear LogoLoop item |
| `/admin/page/home/panel-2/logo-loop/items/save` | POST | Guardar LogoLoop item |
| `/admin/page/home/panel-2/logo-loop/items/reorder` | POST | Reordenar |
| `/admin/page/home/panel-2/logo-loop/items/archive` | POST | Archivar |
| `/admin/page/home/panel-2/logo-loop/items/publish` | POST | Publicar colección |
| `/admin/page/home/panel-2/carousel/items` | POST | Crear proyecto |
| `/admin/page/home/panel-2/carousel/items/save` | POST | Guardar proyecto |
| `/admin/page/home/panel-2/carousel/items/reorder` | POST | Reordenar |
| `/admin/page/home/panel-2/carousel/items/archive` | POST | Archivar |
| `/admin/page/home/panel-2/carousel/items/publish` | POST | Publicar colección |

### Panel 3
| Ruta | Método | Descripción |
|------|--------|-------------|
| `/admin/page/home/panel-3` | GET | Editor Panel 3 |
| `/admin/page/home/panel-3/draft` | POST | Guardar borrador |
| `/admin/page/home/panel-3/publish` | POST | Publicar Panel 3 |
| `/admin/page/home/panel-3/items` | POST | Crear tarjeta |
| `/admin/page/home/panel-3/items/save` | POST | Guardar tarjeta |
| `/admin/page/home/panel-3/items/reorder` | POST | Reordenar |
| `/admin/page/home/panel-3/items/archive` | POST | Archivar |
| `/admin/page/home/panel-3/items/publish` | POST | Publicar colección |

## JSON shapes

### Panel 2 content_json
```json
{
  "eyebrow": "PROYECTOS NINJALAB",
  "heading": "Convertimos ideas en piezas que destacan.",
  "supportText": "Diseño, prototipado...",
  "carouselLabel": "Muestra temporal de proyectos",
  "logoLoopAriaLabel": "Capacidades de diseño y producción"
}
```

### Panel 2 style_json
```json
{
  "backgroundColor": "#RRGGBB",
  "textColor": "#RRGGBB",
  "accentColor": "#RRGGBB",
  "backgroundMedia": "media://uuid-or-null"
}
```

### Panel 3 content_json
```json
{
  "eyebrow": "LO QUE HACEMOS",
  "heading": "Servicios de otro nivel",
  "description": "Soluciones integrales..."
}
```

### Panel 3 style_json
```json
{
  "backgroundColor": "#RRGGBB",
  "textColor": "#RRGGBB",
  "accentColor": "#RRGGBB"
}
```

## Límites de validación

| Campo | Máximo |
|-------|--------|
| Panel 2 eyebrow | 120 |
| Panel 2 heading | 220 |
| Panel 2 support text | 1200 |
| LogoLoop text | 160 |
| LogoLoop alt text | 250 |
| Carousel eyebrow | 120 |
| Carousel title | 180 |
| Carousel description | 1200 |
| Carousel button label | 80 |
| Panel 3 eyebrow | 120 |
| Panel 3 heading | 220 |
| Panel 3 description | 1200 |
| Feature title | 160 |
| Feature description | 1000 |
| Feature detail | 1500 |

## Cache namespaces

| Namespace | Contenido |
|-----------|-----------|
| `section_home_showcase` | Panel 2 singular content |
| `logoLoop_home` | LogoLoop items |
| `carousel_home` | Carousel items |
| `section_home_services` | Panel 3 singular content |
| `features_home` | Feature items |

## Publicación

- **Colección snapshot**: LogoLoop, carrusel y features publican como colección completa
- Las ediciones de ítems guardan como draft
- Publicar mueve todos los drafts a published
- Cache invalidada solo en publish exitoso
- Fallback a hardcoded cuando no hay contenido CMS publicado

## Media usage

- `logo_loop_items`: "LogoLoop: <text_content>"
- `home_carousel_items`: "Proyecto: <title>"
- `home_feature_items`: "Tarjeta: <title>"

## Capacidades

- `home.showcase.view/edit/publish`
- `home.logoLoop.edit/publish`
- `home.carousel.edit/publish`
- `home.services.view/edit/publish`

## Archivos creados/modificados

| Archivo | Acción |
|---------|--------|
| `scripts/migrate-panels.js` | Nuevo |
| `services/cmsRepeatableService.js` | Nuevo |
| `services/cmsPublishingService.js` | Sin cambios (usa API existente) |
| `validators/cmsPanelsValidator.js` | Nuevo |
| `controllers/adminPanelsController.js` | Nuevo |
| `controllers/adminPageController.js` | Modificado (Panel 2/3 activados) |
| `controllers/adminMediaController.js` | Modificado (mediaBrowse API) |
| `controllers/adminPageContentController.js` | Modificado (preview extendido) |
| `routes/adminPanelsRoutes.js` | Nuevo |
| `routes/adminPageRoutes.js` | Modificado (ruta API) |
| `views/components/media-selector.ejs` | Nuevo |
| `views/pages/admin/page/panel2.ejs` | Nuevo |
| `views/pages/admin/page/panel3.ejs` | Nuevo |
| `views/pages/home.ejs` | Modificado (CMS Panel 2/3) |
| `public/js/admin/media-selector.js` | Nuevo |
| `public/css/admin-page.css` | Modificado (estilos) |
| `config/capabilities.js` | Modificado (Phase 11C caps) |
| `config/cmsOptions.js` | Modificado (revision types) |
| `app.js` | Modificado (rutas, sources) |
| `scripts/migrate-all.js` | Modificado |
| `tests/cms-phase11c.test.js` | Nuevo |

## Limitaciones conocidas

- Panel 3 cards se renderizan por JS (`servicesCarousel.mjs`), no por CMS template
- El visual media selector requiere el script JS `/js/admin/media-selector.js` cargado
- La API de browse media usa `LIKE` simple (no full-text search)
- Single-instance cache
- No hay rollback UI

## Phase 11D integration points

- Panel 2 editor: agregar media-selector al campo `backgroundMedia`
- Preview mejorado para mostrar contenido draft en contexto real
- Revision history browser

## Phase 11C-S — Stabilization (Jul 2026)

### Test-count discrepancy

- **Cause**: 2 test failures artificially lowered the pass count from 444 to 354.
  - `saveItem updates fields` — destructuring bug (`const [rows] = ...` → destructured first element, then `rows[0]` was undefined)
  - `panel-two text and carousel` — EJS source check expected 4 `data-panel2-animate="card"` matches, but CMS branch added a 5th
- **Final full-suite count**: 486 tests (477 non-server + 9 server-dependent), 0 failures

### `saveItem` fix

- Destructuring bug fixed: changed `const [rows] = await listItems(...)` to `const items = await listItems(...)`
- Revision data corrected: `previousData` now records old row, `newData` records merged result
- Test enhanced to verify revision action on specific entity ID

### Visual media-selector integration (Phase 11B)

- Navbar admin (`navbar.ejs`): logos (primary/light/dark) and favicon use `<%- include('media-selector', ...) %>`
- Panel 1 admin (`panel1.ejs`): background image, GLB model, fallback image use media-selector
- Controllers (`adminPageContentController.js`): added `resolveMediaData()` helper for pre-population
- Admin layout (`admin.ejs`): added `pageScripts` slot for non-module scripts
- All selectors pre-load selected assets, filter by type (images only / models only), support clear/change

### Panel 3 CMS runtime integration

- `servicesCarousel.mjs` now reads CMS feature items from `<script type="application/json" id="services-cms-data">`
- Resolution order: published CMS items → hardcoded `SERVICES` fallback
- Icons: builtin keys map to `ICON_SVG` allowlist; media icons render as `<img>`; unknown keys fall back safely
- Zero items → hardcoded fallback; 1/2/3+ items all handled by existing `circularCarousel.mjs`
- `home.ejs` renders JSON block from `_previewCms.featureItems`

### Draft preview completion

- Preview route already fetches draft items for LogoLoop, carousel, feature items
- `home.ejs` now uses `_previewCms` variable that merges published CMS + preview draft data when `isPreview = true`
- Preview banner shown (fixed position, orange background, "Vista previa" warning)
- Cache-Control: `no-store, no-cache, must-revalidate, private`; X-Robots-Tag: `noindex, nofollow`
- Panel 2/3 content, repeatable items all use draft data in preview mode

### Fallback and edge behavior

- Hardcoded fallbacks preserved for all panels
- LogoLoop: 1-2 item edge case safe (clones minimal list, not broken)
- Carousel: 1-2 item edge case safe
- Panel 3: zero/one/two-item collections handled by circularCarousel.mjs
- Unknown icon keys → safe fallback SVG

### Cache and media usage

- Cache: `page_sections` use `sc_*` namespace; `site_settings` use `siteSettings` namespace
- Repeatable items NOT cached — fetched fresh from DB on each request
- Media usage: all references protected — `page_sections` (LIKE scan), `site_settings` (LIKE scan), `navigation_items`, `logo_loop_items`, `home_carousel_items`, `home_feature_items`
- Archiving referenced media blocked by `assertNotReferenced()`

---

## Phase 11C-S — Direct Upload & WebP Quality 80 (2026-07-25)

### Overview

Every CMS image selector now supports two modes:
1. **Seleccionar de la biblioteca** — browse existing media assets
2. **Subir desde mi dispositivo** — upload directly from the device

All public/content images are processed through a shared pipeline at WebP quality 80.

### Direct upload flow

```
User clicks "Subir desde mi dispositivo" tab
  → drag-and-drop or file picker
  → client-side validation (ext, size)
  → POST /admin/api/page/media/upload (multipart, CSRF, profile)
  → server validates MIME/size against profile
  → mediaService.createFromSelectorUpload()
    → storage.storeUpload() (Sharp: rotate, resize, WebP quality 80, 3 variants)
    → duplicate? return existing
    → INSERT media_assets + record revision
  → JSON response {success, asset: {public_id, reference, thumbnail_url, ...}}
  → JS auto-selects asset, writes media://UUID to hidden input, updates preview
```

### Upload profiles

15 profiles defined in `config/cmsOptions.js`:
`navbar-logo`, `navbar-light`, `navbar-dark`, `favicon`, `hero-background`, `hero-model`, `hero-fallback`, `logo-loop`, `carousel-main`, `carousel-preview`, `feature-icon`, `nav-item-icon`, `gallery`, `product`, `category`, `avatar`

Each profile specifies: allowed MIME types, category, max file size, kind (image/model).

### Shared WebP quality 80

| Service | Before | After |
|---|---|---|
| IMAGE_VARIANTS.large | 82 | 80 |
| IMAGE_VARIANTS.medium | 80 | 80 |
| IMAGE_VARIANTS.thumbnail | 78 | 80 |
| PROFILES.avatar | 82 | 80 |
| IMAGE_PROFILES.display | 86 | 80 |
| IMAGE_PROFILES.thumbnail | 82 | 80 |
| IMAGE_PROFILES.poster | 86 | 80 |
| Payment proofs | 86 | 86 (unchanged) |

### Route

- `POST /admin/api/page/media/upload` — authenticated admin, capability `media.upload`, CSRF, Multer (30MB max, memoryStorage)

### Files modified

- `config/cmsOptions.js` — quality 80, `UPLOAD_PROFILES`, `UPLOAD_PROFILE_KEYS`, `UPLOAD_PROFILE_VALUES`, `REVISION_ACTIONS.SELECTOR_UPLOAD`
- `config/galleryOptions.js` — `IMAGE_PROFILES` quality 80
- `services/imageProcessingService.js` — `PROFILES.avatar` quality 80
- `services/mediaService.js` — `createFromSelectorUpload()`
- `controllers/adminMediaController.js` — `selectorUpload()`
- `routes/adminPageRoutes.js` — upload route, Multer config
- `views/components/media-selector.ejs` — tabs, upload panel
- `public/js/admin/media-selector.js` — upload flow, tab switching
- `public/css/admin-page.css` — upload zone, progress, error styles
- `views/pages/admin/page/navbar.ejs` — 4× `uploadProfile`
- `views/pages/admin/page/panel1.ejs` — 3× `uploadProfile`
- `views/pages/admin/page/panel2.ejs` — 3× `uploadProfile`
- `views/pages/admin/page/panel3.ejs` — 1× `uploadProfile`

### Not modified

- Payment proofs: private, quality 86, `UPLOAD_PROOFS_DIR`
- GLB: no Sharp, model-only upload
- SVG: remains disabled
