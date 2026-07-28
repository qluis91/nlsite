---
type: "architecture"
date: "2026-07-28T21:53:46.661109+00:00"
question: "Trace and diagnose the production HTTP 500 on the Admin Products page, including route, SQL, schema, pagination, filters, media, and migrations."
contributor: "graphify"
outcome: "useful"
source_nodes: ["adminCatalogController.js", "adminCatalogService.js", "migrationTracker.js", "migrate-deploy.js", "db.js"]
---

# Q: Trace and diagnose the production HTTP 500 on the Admin Products page, including route, SQL, schema, pagination, filters, media, and migrations.

## Answer

Useful orientation identified adminCatalogController.js, adminCatalogService.js, migrationTracker.js, migrate-deploy.js, and database readiness. Direct verification found MariaDB ONLY_FULL_GROUP_BY failures in Products and Categories list GROUP BY queries, plus a combined-filter placeholder mismatch. The repair removed invalid grouping, synchronized filter parameters, added catalog readiness and safe diagnostics, and preserved the existing catalog migrations.

## Outcome

- Signal: useful

## Source Nodes

- adminCatalogController.js
- adminCatalogService.js
- migrationTracker.js
- migrate-deploy.js
- db.js