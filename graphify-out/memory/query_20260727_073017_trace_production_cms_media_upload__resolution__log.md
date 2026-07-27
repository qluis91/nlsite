---
type: "query"
date: "2026-07-27T07:30:17.500435+00:00"
question: "Trace production CMS media upload, resolution, LogoLoop and carousel homepage rendering, static serving, deletion, and reconciliation"
contributor: "graphify"
outcome: "useful"
source_nodes: ["resolveStoragePath()", "publicationService.js", "cmsPublishingService.js", "cmsRepeatableService.js", "app.js"]
---

# Q: Trace production CMS media upload, resolution, LogoLoop and carousel homepage rendering, static serving, deletion, and reconciliation

## Answer

Expanded vocabulary: media, upload, storage, path, public, resolve, logo, carousel, homepage, publish, delete, thumbnail. Confirmed one canonical upload-root contract was needed; public repeatable items were skipped when showcase content was null or the published section remained disabled; static uploads needed priority over the generic public root; shared resolution and reference-aware deletion now use the same storage service. Production-style HTTP/DB/filesystem/restart/deletion integration passed, and the full serial suite passed 1209/1209.

## Outcome

- Signal: useful

## Source Nodes

- resolveStoragePath()
- publicationService.js
- cmsPublishingService.js
- cmsRepeatableService.js
- app.js