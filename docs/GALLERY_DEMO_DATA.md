# Gallery demo data

The Phase 3 demo set is an explicit local-development aid. It is never loaded by application startup.

## Commands

Create or repair the idempotent set:

```powershell
node scripts/seed-gallery-demo.js
```

Remove only records and media owned by the demo prefix:

```powershell
node scripts/seed-gallery-demo.js --clean
```

Clean and recreate the set:

```powershell
node scripts/seed-gallery-demo.js --reset
```

After seeding, open `/galeria?view=ring`. Running the seed command again reuses valid records and files rather than duplicating them.

## Safety boundary

- The reserved ownership prefix is `demo-gallery-`.
- Images are generated locally and processed by Sharp; the workflow makes no network request.
- Cleanup derives file targets from owned database rows and validates them against the gallery media roots.
- Unrelated gallery records, categories, and files are not cleanup targets.
- A failed database transaction removes newly generated files and leaves no committed partial set.
- `NODE_ENV=production` is blocked by default. `ALLOW_PRODUCTION_DEMO_SEED=true` is a deliberate override and should not be configured in normal deployments.

The current demo set contains images only. It validates layout, Ring interaction, filtering, modal reuse, and generated-media behavior; it is not a video-playback fixture.
