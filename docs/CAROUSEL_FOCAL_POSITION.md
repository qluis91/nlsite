# Home carousel focal position

The home carousel stores an integer horizontal and vertical focal position from
0 through 100. The feature changes only CSS `object-position`; it never crops,
rewrites, or creates variants of the managed image.

## Storage authority

- Draft/admin authority: `home_carousel_items.position_x` and `position_y`.
- Published/public authority: `published_data.position_x` and
  `published_data.position_y` using the existing snake_case snapshot keys.
- Missing or malformed axes normalize independently to 50. Numeric values are
  rounded with `Math.round` and clamped to 0 through 100.
- Publishing, batch publishing, revisions, and restoration use the same
  normalization.

## Editor behavior

The range controls are the accessible authority. Pointer dragging updates those
same controls but does not save automatically. Dragging is intentionally inverse:
dragging right decreases X, left increases X, down decreases Y, and up increases
Y. Sensitivity is relative to the rendered preview dimensions. This direction can
feel counterintuitive because the user moves the image underneath a fixed frame.

The admin preview and public carousel both use an `<img>` and `object-position`.
Desktop uses the public `cover` behavior; at narrow widths the preview follows the
public `contain` behavior. The main and preview image swap reuses the same image
element, so both receive the slide's focal CSS variables.

## Migration and rollback

Migration 35 independently adds either missing `TINYINT UNSIGNED NOT NULL DEFAULT
50` column and merges focal keys into existing published JSON without removing
unknown keys. Malformed legacy snapshots abort and report the affected row rather
than replacing its contents. MySQL DDL commits according to MySQL rules; the JSON
backfill is wrapped in the repository's explicit transaction and rolls back on an
error.

Before rollback, back up the affected table. Remove the live published keys and
columns only after code rollback:

```sql
UPDATE home_carousel_items
SET published_data = JSON_REMOVE(published_data, '$.position_x', '$.position_y')
WHERE published_data IS NOT NULL;

ALTER TABLE home_carousel_items
  DROP COLUMN position_y,
  DROP COLUMN position_x;
```

Historical `content_revisions` intentionally retain harmless focal keys. Removing
them would rewrite audit history; older application code ignores unknown keys.

## Manual validation checklist

- Desktop: change each axis, save, publish, and confirm the public main/preview
  swap keeps the same focal position.
- Mobile and touch: drag in all four directions, confirm inverse movement, test
  `pointercancel`, and verify the narrow `contain` layout.
- Keyboard and 200% zoom: operate both ranges, confirm displayed values and focus,
  and press **Centrar** to reset both axes to 50 with focus retained.
- Media lifecycle: select, upload, replace, and clear the main image; focal values
  must not reset unless **Centrar** is pressed and the preview image must remain
  scoped to its own editor.
- Publication: verify draft changes are absent publicly before publication and
  appear after publication.
- Revisions: restore a current revision and an old revision without focal keys;
  the latter must reconstruct 50/50, independently per missing axis.
- Responsive carousel: advance, autoplay, and click preview cards on desktop and
  mobile, confirming both image sources retain the focal position.

### Validation result — 2026-08-04

Manual validation in the user's local Chrome browser passed for the exercised
carousel workflow at `http://localhost:3000`. The user confirmed that both focal
sliders, direct image dragging, **Centrar**, media selection and replacement,
draft save/reload, publication, and public main/preview swapping all preserve the
expected framing. No `CustomEvent`, CSP, focal-editor, or carousel JavaScript
errors appeared.

The only console errors were unrelated pre-existing social-image fetch failures:

- `scontent.cdninstagram.com/v/new_thumb.jpg` returned HTTP 403.
- `scontent.fbcdn.net/v/backfill.jpg` failed with `ERR_NAME_NOT_RESOLVED`.

Those external Facebook/Instagram asset failures are outside this branch and
were not changed. The user did not separately report exact viewport dimensions,
mobile/touch coverage, 200% zoom, keyboard-only slider behavior, pointer-cancel
interruption, upload/clear media actions, or current/legacy revision restoration;
those checks remain limitations of the recorded manual validation.

## Test-isolation incident

On 2026-08-05 at 02:39:34 UTC, `tests/migrate-deploy.test.js` launched
`node scripts/migrate-deploy.js` twice while inheriting the normal `.env`. The
first child applied migration 35 to the local development database
`localhost:3306/nlsite_db`; the second child observed it as already complete.
The earlier statement that no migration had executed was incorrect because the
missing-column failure occurred before the same multi-file test command reached
the deploy-runner test that performed the migration.

Confirmed impact was limited to the intended local migration: both unsigned
`TINYINT` columns were added with `NOT NULL DEFAULT 50`, four existing draft rows
and four published snapshots are 50/50, non-focal snapshot hashes were unchanged,
and no malformed JSON was reported. Production and remote databases were not
accessed.

Corrective measures are documented in `docs/TEST_DATABASE_SAFETY.md`: tests no
longer load `.env`, the shared test DB guard rejects `nlsite_db`, test connections
and mutations require explicit opt-ins, child environments strip inherited DB
configuration, and migration deployment is tested through dependency-injected
fakes rather than a live runner process.
