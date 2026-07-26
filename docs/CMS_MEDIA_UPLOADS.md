# CMS Media Uploads — Phase 11C-S

**Last updated:** 2026-07-25

## Overview

All CMS image selectors support two modes:

1. **Seleccionar de la biblioteca** — browse and select existing media assets
2. **Subir desde mi dispositivo** — upload a new image directly from the device

Every newly uploaded public/content image is:
- Validated securely (decoded content, not extension alone)
- Processed with Sharp (rotate, resize, metadata stripped)
- Converted to WebP at quality 80
- Saved with 3 variant sizes (large 2560px, medium 1280px, thumbnail 400px)
- Registered in `media_assets` with revisions

## Direct upload flow

```
1. Admin opens any CMS editor with a media selector
2. Clicks "Seleccionar desde biblioteca" → modal opens
3. Switches to "Subir desde mi dispositivo" tab
4. Drags file onto drop zone or clicks to pick
5. Clicks "Subir imagen"
6. POST /admin/api/page/media/upload (multipart, CSRF, profile)
7. Server returns {success, asset: {public_id, reference, thumbnail_url, ...}}
8. Asset auto-selected, hidden input updated to media://UUID, preview shown
```

## Supported formats

| Format | Accepted | Notes |
|---|---|---|
| JPEG | Yes | Converted to WebP |
| PNG | Yes | Transparency preserved, converted to WebP |
| WebP | Yes | Re-processed |
| AVIF | Conditional | Only if Sharp installed runtime supports it |
| SVG | No | Disabled — no trusted sanitizer |
| GLB | Model only | Selected via library, not through image upload |

## WebP quality 80 standard

All public/content raster images use the shared standard:

- Output format: WebP
- Quality: 80
- Metadata: stripped
- Orientation: normalized (rotate())
- Transparency: preserved
- Without enlargement: true
- Maximum dimensions: 2560 × 2560 (fit: inside)

### Variants generated

| Variant | Max dimensions | Quality |
|---|---|---|
| large (primary) | 2560 × 2560 | 80 |
| medium | 1280 × 1280 | 80 |
| thumbnail | 400 × 400 | 80 |

## Upload profiles

Each media selector has a server-side profile defining allowed types, category, and size limits.

| Profile | Allowed MIME | Category | Max size | Kind |
|---|---|---|---|---|
| `navbar-logo` | JPEG, PNG, WebP | logo | 15 MB | image |
| `navbar-light` | JPEG, PNG, WebP | logo | 15 MB | image |
| `navbar-dark` | JPEG, PNG, WebP | logo | 15 MB | image |
| `favicon` | JPEG, PNG, WebP | logo | 15 MB | image |
| `hero-background` | JPEG, PNG, WebP | site | 15 MB | image |
| `hero-model` | GLB, octet-stream | model | 30 MB | model |
| `hero-fallback` | JPEG, PNG, WebP | site | 15 MB | image |
| `logo-loop` | JPEG, PNG, WebP | logo | 15 MB | image |
| `carousel-main` | JPEG, PNG, WebP | carousel | 15 MB | image |
| `carousel-preview` | JPEG, PNG, WebP | carousel | 15 MB | image |
| `feature-icon` | JPEG, PNG, WebP | icon | 15 MB | image |
| `nav-item-icon` | JPEG, PNG, WebP | icon | 15 MB | image |
| `gallery` | JPEG, PNG, WebP | gallery | 15 MB | image |
| `product` | JPEG, PNG, WebP | gallery | 10 MB | image |
| `category` | JPEG, PNG, WebP | gallery | 10 MB | image |
| `avatar` | JPEG, PNG, WebP | other | 2 MB | image |

## Storage

### Local (development)

```
public/uploads/media/
├── site/       # hero backgrounds
├── gallery/    # gallery images
├── logos/      # navbar logos, favicons
├── carousel/   # project carousel images
├── icons/      # feature card icons
├── models/     # GLB files
├── other/      # miscellaneous
└── thumbnails/ # all thumbnails (400px)
```

Files named: `{category}-{timestamp}-{randomhex}.webp`

### Production (Railway)

Uses `UPLOAD_PUBLIC_DIR` from environment. Files stored on the Railway persistent volume. Public URLs are independent of physical paths.

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/api/page/media` | Browse/query media library (JSON) |
| POST | `/admin/api/page/media/upload` | Direct upload from selector (multipart, JSON response) |

Both require: admin auth, capability check, CSRF token.

Upload endpoint response:

```json
{
  "success": true,
  "asset": {
    "public_id": "uuid",
    "reference": "media://uuid",
    "title": "file-name",
    "original_filename": "file.jpg",
    "public_url": "/uploads/media/site/site-...webp",
    "thumbnail_url": "/uploads/media/thumbnails/site-...-thumb.webp",
    "mime_type": "image/webp",
    "width": 1200,
    "height": 800,
    "file_size": 123456,
    "category": "site"
  }
}
```

No filesystem paths are exposed.

## Database

New uploads create complete `media_assets` records:
- `public_id` (UUID)
- `original_name` (sanitized)
- `filename` (generated)
- `storage_path`, `public_url`, `thumbnail_path`
- `variants_json` (JSON object with medium/thumbnail)
- `checksum` (SHA-256)
- `mime_type`, `extension`, `file_size`, `width`, `height`
- `category`, `status` (active)
- `created_by`, `updated_by`

## Cleanup / transactional safety

1. Validate upload (MIME, size, profile)
2. Process into temp (Sharp → WebP quality 80, 3 variants)
3. Compute checksum (SHA-256)
4. Detect duplicate → return existing asset
5. Write final files (never overwrite)
6. INSERT media_assets + content_revisions (transaction)
7. If DB fails → remove written files
8. If Sharp fails → remove temp files

## Security

- `isAuthenticated` + `isAdmin` middleware
- Capability check (`media.upload`)
- CSRF validation
- Multer limits (30MB max, memoryStorage)
- Content validation (Sharp decode, not extension)
- Profile validation (server-side allowlist, never trust client)
- Path containment (`path.resolve`, startsWith check)
- No directory listing, `X-Content-Type-Options: nosniff`
- No filesystem paths in responses
- Filenames never from browser-provided names

## Excluded from scope

- **Payment proofs**: unchanged — private storage (`UPLOAD_PROOFS_DIR`), quality 86, separate flow
- **GLB files**: not passed through Sharp, model-only selectors
- **SVG**: remains disabled (no trusted sanitizer)
- **Historical files**: not auto-converted, only new uploads/replacements use WebP quality 80
