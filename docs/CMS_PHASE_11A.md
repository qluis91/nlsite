# CMS Phase 11A — "Administrar página" foundation

Phase 11A adds the internal CMS foundation: a secure, reusable media library
plus the core content tables that later phases (navbar, Panel 1/2/3, publishing)
will build on. The public website is unchanged and still renders its hardcoded
content.

## Scope

**In scope**

- Media library: upload, view, edit metadata, replace, archive, restore.
- Image validation, optimization and thumbnail/variant generation.
- GLB (3D model) validation and metadata extraction.
- Core CMS tables: `media_assets`, `pages`, `page_sections`, `site_settings`
  (extended), `content_revisions`.
- Media usage/reference checks and revision/audit history.
- Admin navigation entry, overview page and media-library UI.
- Reusable read services for later phases with fallbacks.

**Explicitly out of scope (later phases)**

- Navbar editor, Panel 1/2/3 editors, logo-loop items, project-carousel items,
  SEO editor, visual page builder, publishing/rollback UI.
- Physical (hard) deletion of media.
- SVG upload.

## Database

Migration: `scripts/migrate-cms.js`, also wired into `npm run migrate`
(`scripts/migrate-all.js`). `schema.sql` is kept synchronized.

| Table | Purpose |
|-------|---------|
| `media_assets` | Media metadata: identity, storage path, variants, dimensions, checksum, category, status, soft deletion, audit columns. |
| `pages` | Administrable pages. Seeded with `home`. |
| `page_sections` | Per-page sections with validated JSON content/style. Seeded with `hero`, `showcase`, `services`. |
| `site_settings` | Pre-existing table, extended additively with `value_type`, `setting_group`, `is_public`, `updated_by`, `created_at`. |
| `content_revisions` | Audit trail of CMS writes with safe metadata snapshots. |

Properties:

- Idempotent: `CREATE TABLE IF NOT EXISTS` plus column existence checks.
- Non-destructive: no `DROP TABLE`, no column removal, no type narrowing.
- utf8mb4 / `utf8mb4_unicode_ci`, InnoDB, timestamps matching the existing schema.
- Foreign keys to `users` use `ON DELETE SET NULL`; `page_sections → pages` uses
  `ON DELETE CASCADE`.
- Unique keys: `media_assets.public_id`, `media_assets.storage_path`,
  `pages.page_key`, `pages.slug`, `(page_id, section_key)`,
  `(entity_type, entity_id, revision_number)`.
- Indexes support the library filters: category+status+deleted_at,
  status+created_at, checksum, creator and title.
- Seeding runs inside a transaction and only inserts missing rows, so existing
  content is never overwritten.

**Rollback notes.** The migration is additive only, so no automatic rollback is
provided. To undo it manually: take a database backup, then drop
`content_revisions`, `page_sections`, `pages`, `media_assets` and the five added
`site_settings` columns. The public site keeps working because Phase 11A never
removes the hardcoded fallbacks.

**Running it**

```bash
npm run migrate            # all migrations, includes the CMS
node scripts/migrate-cms.js  # CMS only
```

Never run migrations against production from a workstation; deploy and let the
production release step run them.

## Media storage

Root: `<UPLOAD_PUBLIC_DIR>/media` (development default:
`public/uploads/media`). No deployment path is hardcoded in application code.

```
<UPLOAD_PUBLIC_DIR>/media/
├── site/
├── gallery/
├── logos/
├── carousel/
├── icons/
├── models/
├── other/
└── thumbnails/
```

- Directories are created at startup and before every upload.
- Filenames are server-generated: `category-timestamp-randomhash.ext`. The
  browser-supplied name is kept only as `original_name` metadata.
- Files are written with the `wx` flag, so an existing file is never overwritten.
- Every path is resolved with `path.resolve()` and rejected unless it stays
  inside the media root and matches a strict relative-path pattern.
- Public URLs are always `/uploads/media/<dir>/<file>`; the filesystem root is
  never exposed.

## Allowed and rejected formats

| Category | Accepted | Limit |
|----------|----------|-------|
| site, gallery, logo, carousel, icon, other | JPEG, PNG, WebP (AVIF only when the installed Sharp runtime can decode it) | 15 MB, max 10000 × 10000 px |
| model | GLB (glTF binary v2) | 30 MB |

Rejected: SVG (see below), HTML, JS, CSS, EXE, PHP, ZIP, XML, animated images
and any unknown binary. Declared MIME, file extension and decoded bytes must all
agree; a renamed executable is rejected because Sharp cannot decode it.

**SVG is disabled in Phase 11A.** No vetted sanitizer dependency is installed and
custom sanitization would be unsafe. Enabling it later requires adding a proven
sanitizer, stripping scripts/event attributes/external references/JavaScript
URLs, and serving with restrictive headers.

## Image optimization

Raster uploads are decoded with a pixel limit, orientation-normalized
(`.rotate()`), stripped of metadata (Sharp's default), and re-encoded as WebP so
transparency is preserved. Three variants are produced, none of which upscale a
smaller source:

| Variant | Max size | Quality |
|---------|----------|---------|
| large (primary `public_url`) | 2560 × 2560 | 82 |
| medium | 1280 × 1280 | 80 |
| thumbnail | 400 × 400 | 78 |

Width, height, byte size and a SHA-256 checksum of the uploaded bytes are stored.
Animated images are rejected explicitly rather than silently flattened. Batch
uploads run with bounded concurrency (2) so Sharp is never called in unbounded
parallel.

## GLB validation

`glTF` magic bytes, version 2, a declared length matching the real file size, and
a parsable JSON chunk are all required. Generator, glTF version, mesh count and
node count are stored in `model_metadata`. GLB files never go through Sharp, get
no image variants, and are never auto-published as the homepage model.

## Admin interface

| Route | Purpose |
|-------|---------|
| `GET /admin/page` | Overview with aggregate stats and module cards |
| `GET /admin/page/media` | Library grid with search, filters and pagination |
| `GET /admin/page/media/upload` | Upload form |
| `POST /admin/page/media` | Multi-file upload |
| `GET /admin/page/media/:publicId` | Detail, usage and revision history |
| `GET /admin/page/media/:publicId/edit` | Metadata and replacement forms |
| `POST /admin/page/media/:publicId` | Update metadata |
| `POST /admin/page/media/:publicId/replace` | Replace the underlying file |
| `POST /admin/page/media/:publicId/archive` | Soft delete |
| `POST /admin/page/media/:publicId/restore` | Restore an archived asset |

URLs use the asset's UUID `public_id`, never the numeric primary key. Filtering
and pagination are server-side; grids render thumbnails with `loading="lazy"`.

The overview shows the media library as the only active module; navbar, Panel 1,
Panel 2, Panel 3 and publishing are labelled "Próxima fase" and are not linked.

## Editable vs immutable fields

Editable: `title` (150), `alt_text` (250), `description` (2000), `category`,
`status` (`active`/`archived` only).

Rejected if submitted: `storage_path`, `filename`, `checksum`, `mime_type`,
`file_size`, `created_by`, `public_url`, `public_id`.

Alt text may be empty only when the asset is a 3D model or the image is marked
decorative.

## Replace, archive and restore

- **Replace** validates and writes the new file first, updates the row inside a
  transaction, records a revision containing the previous metadata, and deletes
  the old physical files only after the commit. The asset keeps its `id` and
  `public_id`, so existing references stay valid. Replacing an image with a model
  (or the reverse) is rejected.
- **Archive** is the default destructive action: a soft delete that sets
  `status = 'archived'` and `deleted_at`, hides the asset from normal listings,
  and keeps the files on disk.
- **Restore** returns an archived asset to `active`, and refuses if the physical
  file is gone.
- **Physical deletion is not implemented in Phase 11A.** The project has no
  established super-admin destructive-action pattern to reuse, so the capability
  `media.delete` exists but is unassigned.

## Media usage and deletion protection

`services/mediaUsageService.js` answers "where is this used?" and "can this be
archived safely?". CMS content references media through the stable token
`media://<public_id>`, so a replaced file never breaks a reference.

Built-in sources: `page_sections` (content and style JSON) and `site_settings`.
Later phases register their own sources with
`registerUsageSource(key, finder)` — navigation items, logo-loop items, carousel
items, feature items and gallery items — instead of editing the service.

Archiving (and any future deletion) is blocked while an asset is referenced, and
the detail page lists every location.

## Security

- Routes sit behind the existing `isAuthenticated` + `isAdmin` middleware and an
  explicit capability guard (`page.manage`, `media.view`, `media.upload`,
  `media.edit`, `media.archive`, `media.delete`). Capabilities map to the
  database `role_id = 1` admin role; `ADMIN_EMAILS` is never consulted.
- Every write validates CSRF with the project's `csrfSynchronisedProtection`;
  multipart routes run multer first, matching the existing catalog/gallery order.
- All SQL uses parameterized queries; multi-step writes use transactions with
  `FOR UPDATE` locking.
- Uploads are validated by content, bounded in size, count and dimensions, and
  protected against decompression bombs.
- Failures clean up every file already written, so no orphans remain.
- Responses expose Spanish messages only — no stack traces, filesystem paths or
  secrets. Revisions store an allowlisted metadata snapshot, never file contents.

## Public serving

Media is served read-only from the existing static mount at `/uploads/`
(`dotfiles: 'deny'`, `index: false`), so there is no directory listing and no way
to reach the filesystem root. Helmet adds `X-Content-Type-Options: nosniff`
globally. Filenames are content-addressed by a random hash, which makes them safe
for long-lived caching; the current mount uses `maxAge: 7d`, shared with the
other upload types.

## Compatibility with existing media

Nothing existing was migrated or touched:

- Product, category, avatar, gallery and payment-proof uploads use their original
  services and directories.
- Public pages keep their hardcoded asset paths.
- Seeded `page_sections` are disabled drafts, so
  `cmsContentService.getPublishedSectionContent()` always returns the caller's
  fallback until a later phase publishes real content.
- No import script is provided; adopting existing assets is deliberate,
  file-by-file, in later phases.

## Phase 11B integration points

- `cmsContentService.getPublishedSectionContent(pageKey, sectionKey, fallback)`
  to read a panel's content while keeping the hardcoded value as fallback.
- `cmsContentService.getSetting(key, fallback)` / `getPublicSettings(group)` for
  navbar and global settings.
- `cmsContentService.resolveMediaReference('media://<public_id>', fallback)` to
  turn a stored reference into a URL and its variants.
- `mediaUsageService.registerUsageSource(key, finder)` so new content types
  participate in deletion protection.
- `contentRevisionService.recordRevision(...)` for the publishing history UI.

Later phases must add CMS values without removing the hardcoded fallbacks: write
content, publish the section, verify the rendered output, and only then consider
retiring the fallback.

## Known limitations

- SVG upload disabled; no sanitizer dependency installed.
- Physical deletion not implemented; archive only.
- No client-side upload progress bar — the form shows a processing state and the
  request completes with a full page redirect.
- Reference scanning uses `LIKE` over JSON columns, which is adequate for the
  current data volume but should move to generated columns or a join table if the
  content tables grow large.
- No cross-phase cache layer yet; the overview aggregates are computed per
  request with a single query.
- Real-browser verification of the admin UI has not been performed.
