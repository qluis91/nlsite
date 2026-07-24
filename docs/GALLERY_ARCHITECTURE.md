# Gallery Architecture - Phases 1, 2, 3, and 4

## Scope

Phase 1 provides the reusable MySQL, administration, media-storage, public-grid, filtering, and shared lightbox foundation for the NinjaLabCR gallery. The public `/galeria` grid is both the initial gallery and the permanent accessibility/reduced-motion/no-WebGL fallback.

Phase 2 adds Circular Gallery as an optional progressive enhancement. Phase 3 adds a native CSS 3D Ring Carousel and an explicit local demo-data workflow. Phase 4 adds a native WebGL 2 Infinite Menu with icosahedron sphere geometry, instanced disc rendering, texture atlas, and arcball controls. No React, OGL, GSAP, Three.js, Tailwind, shadcn, or TypeScript code exists in this module.

## Data model

`gallery_categories` stores a unique normalized slug, optional description, deterministic `sort_order`, and an `is_active` public-visibility flag.

`gallery_items` stores:

- Optional category association.
- Title, unique normalized slug, description, and explicit alt text.
- `image` or `video` media type.
- Controlled public media, thumbnail, and optional poster paths.
- Sort order, featured state, publication state, and first publication time.

The category foreign key uses `ON DELETE SET NULL`, but the administration policy deliberately blocks category deletion while associated items exist.

Public ordering is:

1. Featured first.
2. Lowest sort order first.
3. Most recently published first.
4. Highest ID first.

## Routes

Public:

- `GET /galeria`
- Optional allowlisted `categoria`, `tipo`, `view`, and `page` query parameters.

Administration:

- `GET /admin/galeria`
- `GET /admin/galeria/nuevo`
- `POST /admin/galeria`
- `GET /admin/galeria/:id/editar`
- `POST /admin/galeria/:id`
- `POST /admin/galeria/:id/eliminar`
- `POST /admin/galeria/:id/publicar`
- `POST /admin/galeria/:id/destacar`
- `GET /admin/galeria/categorias`
- `POST /admin/galeria/categorias`
- `POST /admin/galeria/categorias/:id`
- `POST /admin/galeria/categorias/:id/eliminar`

Admin routes require an authenticated administrator. Multipart requests parse with Multer before centralized synchronized CSRF validation.

## Media storage

Only generated files are stored under:

- `/uploads/gallery/images/`
- `/uploads/gallery/thumbnails/`
- `/uploads/gallery/videos/`
- `/uploads/gallery/posters/`

MySQL stores controlled relative public paths, never absolute filesystem paths or client-provided paths. Generated contents are ignored by Git; placeholder files preserve the directory structure.

Every write and deletion resolves against an allowlisted gallery root. Absolute paths, traversal, nested filenames, backslashes, unrecognized prefixes, unexpected extensions, and cross-root resolution are rejected.

## Images and posters

Image inputs are limited to JPEG, PNG, and WebP at 10 MB. Sharp must successfully decode every input. Display images are auto-rotated, metadata-stripped, bounded inside 2400×2400 without enlargement, and encoded as WebP at quality 86.

Every image also produces a 512×512 cropped WebP thumbnail at quality 82. Video posters use the same safe decode and output pipeline and also produce the required square thumbnail.

Random UUID filenames are used. Original filenames, titles, and slugs never determine storage filenames.

## Local video boundary

Video inputs are local MP4 or WebM files up to 100 MB. Validation requires an allowlisted MIME, matching extension, and a basic container signature (`ftyp` for MP4 or the EBML header for WebM).

This is intentionally a bounded upload check, not full codec/container verification. Phase 1 does not transcode video, inspect codecs, run FFmpeg, or extract thumbnails. A separately uploaded and Sharp-validated poster is mandatory for video publication.

## Publication and deletion

An image can be published only when its display image and thumbnail exist. A video can be published only when its video, poster, and thumbnail exist. Title and alt text are mandatory.

Create failures remove only newly generated files. Updates process replacements first, commit the database update, and delete replaced old files only after commit. Failed updates remove new files and preserve the old record and media.

Item deletion locks and deletes the database row transactionally, commits, and then performs allowlisted file cleanup. Cleanup failures are logged without attempting to recreate the deleted database record.

## Public grid and filters

The grid is fully server-rendered and usable without JavaScript. It loads only 512×512 thumbnails, uses lazy loading, and is bounded to 24 records per page. Category and media-type links preserve each other and expose their active state with `aria-current`.

Only published items are returned. Items assigned to inactive categories remain admin-only. Unknown category filters safely fall back to all published items with a controlled notice.

`view=grid`, `view=circular`, `view=ring`, and `view=infinite` are allowlisted. Missing or invalid values normalize to `grid`. Category, media-type, and pagination links preserve the current view; changing pages still loads only the current bounded 24-item server page.

## Shared renderer contract

The page includes one safely escaped `application/json` block containing the current bounded result:

```js
{
  id,
  slug,
  type,
  title,
  description,
  category,
  thumbnail,
  source,
  poster,
  alt,
  featured
}
```

It contains no filesystem paths, unpublished records, admin-only fields, or internal error metadata. Circular Gallery and Ring Gallery consume this contract while preserving the server-rendered grid as fallback.

## Circular Gallery renderer

Phase 2 adapts the ReactBits Circular Gallery behavior to browser-native JavaScript and WebGL. OGL is not installed: the project has no gallery bundler, and exposing `node_modules` or copying an untracked third-party browser build would conflict with the dependency boundary. The native implementation keeps the reference’s cover-crop uniforms (`uImageSizes`/`uPlaneSizes`), rounded-card shader, `uTime`/`uSpeed` movement deformation, easing, snap navigation, configurable bend calculation, and infinite horizontal cycles. Production initializes it with `bend: 0`.

The renderer consumes only `thumbnail` from the existing public JSON. It never assigns `source` or `poster` to WebGL, so video bytes remain unloaded until the shared modal opens. Missing, invalid, timed-out, or broken thumbnails settle to a generated same-origin “Imagen no disponible” texture instead of blocking initialization. Titles are rendered into local canvas textures and are also exposed in the semantic active-item overlay.

`CircularGalleryRenderer` exposes `pause()`, `resume()`, `resize()`, and an idempotent `destroy()`. Destruction cancels its RAF, clears timers, disconnects resize/intersection observers, removes pointer/wheel/keyboard/visibility/context listeners, deletes WebGL buffers/programs/textures, removes the canvas, and clears callbacks. RAF pauses while the document is hidden or the stage is outside the viewport. A resize observer caps DPR at 2 and recalculates responsive card dimensions.

Pointer events use capture and `touch-action: pan-y`; vertical page scrolling remains available. Wheel input is registered only on the circular container and is cancelled only when consumed there. Arrow keys, Home, Enter, and Space are handled only while the focusable circular region owns keyboard input.

The active overlay updates title/category/type through `textContent`, debounces its polite announcement, and opens the one Phase 1 modal by stable public item ID. Focus restoration targets its “Ver proyecto” button.

## Ring Gallery renderer

Phase 3 adds a browser-native CSS 3D ring. It uses `perspective`, `transform-style: preserve-3d`, and per-card rotation/translation transforms; it does not load a rendering framework or add a dependency. GSAP and Draggable were not added because the bounded pointer, inertia, and snapping state fits the existing native module lifecycle without a second animation runtime. Geometry derives the angular step and radius from the bounded item count and responsive card width. Two-item datasets are visually duplicated only inside the renderer, while every visual card continues to map to the original stable item ID.

The renderer reads thumbnail paths only. Pointer drag uses capture, movement thresholds, time-normalized velocity, inertial decay, and nearest-card snapping. Keyboard controls support ArrowLeft, ArrowRight, Home, End, Enter, and Space. Wheel input is optional and scoped to the ring stage; page scrolling is cancelled only when the ring consumes a step. The active card controls a semantic overlay whose action opens the existing shared modal by stable item ID.

`RingGalleryRenderer` exposes `pause()`, `resume()`, `resize()`, and an idempotent `destroy()`. It schedules RAF only during drag, inertia, or snapping; document visibility and intersection observation pause motion; resize observation recalculates geometry. Destruction cancels animation and timers, disconnects observers, releases pointer capture, removes listeners, and clears generated cards.

Unsupported CSS 3D, reduced motion, an empty dataset, or initialization failure leaves the server-rendered grid available with a controlled status. Card construction uses safe DOM APIs and `textContent`. The ring namespace is isolated under `.gallery-ring`.

## Infinite Menu renderer

Phase 4 adds a native WebGL 2 renderer with no framework dependency. It uses `gl-matrix@3.4.3` (copied to `public/vendor/gl-matrix/`) for vector, quaternion, and matrix operations. The renderer requires WebGL 2 context with `drawElementsInstanced`, `MAX_TEXTURE_SIZE ≥ 1024`, and `MAX_VERTEX_ATTRIBS ≥ 8` for the instanced `mat4` attributes.

### Geometry
- Base icosahedron (12 vertices, 20 faces) subdivided once to produce ~42 vertices.
- Each vertex is normalized to sphere radius and becomes a disc instance.
- Disc geometry: 56 radial segments, center UV at (0.5, 0.5), triangle-fan indices.
- Instance count derives from the icosahedron vertices, not the item count.

### Texture atlas
- Atlas grid size: `ceil(sqrt(itemCount))`.
- Per-cell resolution defaults to 256px and reduces if `atlasSize > MAX_TEXTURE_SIZE`.
- Only `item.thumbnail` paths enter the atlas; no source or poster URLs.
- Same-origin validation (`/^\/uploads\//`) rejected.
- Aspect-cover drawing in Canvas 2D; broken images render branded placeholders.
- 15-second timeout caps all image loading.

### Arcball controls
- Two-axis pointer projection onto a virtual sphere.
- Pointer capture, release on pointerup/pointercancel/lostpointercapture.
- Angular velocity inertia with 0.94 damping factor.
- Nearest-front-item snapping after pointer release.
- Delta-time normalization clamped to 50ms max.

### Active item
- Closest sphere vertex to front direction resolves the active instance.
- Instance index modulo original item count resolves the stable original item ID.
- HTML overlay uses `textContent` for category, type, and title.
- Debounced (240ms) `aria-live="polite"` announcements.

### Lifecycle
- `InfiniteMenuRenderer` exposes `pause()`, `resume()`, `resize()`, and idempotent `destroy()`.
- Destroy clears RAF, pointer/keyboard/wheel listeners on canvas and container, visibility listener, ResizeObserver, IntersectionObserver, all GL resources (shaders, program, VAO, buffers, texture), and item references.
- `contextlost` triggers mode-manager fallback to Grid; no auto-reinitialize.
- Visibility/intersection pause; RAF resumes only when needed.

### Fallback
- Reduced motion, no WebGL 2, insufficient texture/attribute caps, empty dataset, or initialization failure restores Grid with a controlled status.
- No OGL, GSAP, Three.js, React, Tailwind, or shadcn dependency.

## Local demo data

Demo content is created only by the explicit command `node scripts/seed-gallery-demo.js`. The script generates 15 deterministic compositions locally with Sharp, processes them through the gallery media pipeline, and publishes them under the reserved `demo-gallery-` slug prefix. It performs no network requests and does not run during application startup.

The command is idempotent. `--clean` removes only database rows/categories bearing the reserved prefix and only their allowlisted referenced gallery files. `--reset` performs that cleanup and then recreates the set. Production execution is blocked unless `ALLOW_PRODUCTION_DEMO_SEED=true` is set deliberately. This override is an emergency escape hatch, not a deployment instruction.

The demo set contains images only. It does not claim to exercise local-video playback; real uploaded videos remain covered by the Phase 1 media boundary and focused tests.

## Progressive fallback policy

The server always emits the grid first. JavaScript hides it only after textures settle and the first valid WebGL render completes. Empty datasets never initialize the renderer. Reduced motion intentionally stays on the grid without error language. No WebGL, conservative low-capability detection, initialization exceptions, and context loss restore the grid with a controlled status.

No CSP expansion was required: the renderer and dynamic ES module are same-origin, use no CDN, worker, `eval`, remote image, or new network permission.

## Shared lightbox

One custom accessible modal serves all image and video items. It uses safe DOM APIs and `textContent`, never untrusted `innerHTML`.

The lightbox supports:

- Previous/next within the current server-filtered page.
- Escape and arrow-key controls.
- Focus trapping and restoration to the originating card.
- Scroll locking only while open.
- Image loading and controlled media-error states.
- `<video controls preload="metadata" playsinline>` without autoplay.
- Video pause, source removal, and audio shutdown on close.

Direct `item=<slug>` opening and swipe gestures are deferred because they are not required for the stable Phase 1 foundation.

## Accessibility and motion

Cards use real buttons, explicit alt text, visible focus, list semantics, and accessible action labels. The modal exposes dialog semantics and reachable close/navigation controls. Bright green is paired with dark text for contrast.

Reduced-motion CSS removes card scaling and loader animation. JavaScript does not initialize Circular Gallery or Ring Gallery under `prefers-reduced-motion: reduce`; the server-rendered grid is the intentional permanent fallback.

## Validation status and limitations

Automated migration, category, image, video-boundary, CRUD, publication, filtering, XSS, path-safety, CSRF, lightbox, mode URL, shader-source, capability-fallback, thumbnail-only, input-scope, renderer-lifecycle, ring geometry/input/lifecycle, and demo-seed safety checks cover Phases 1 through 3.

Real-browser gallery validation is pending when an interactive Chrome or Edge backend is unavailable. HTTP rendering is not treated as browser validation.
