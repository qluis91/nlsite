---
type: "query"
date: "2026-07-28T23:41:54.721022+00:00"
question: "Trace and fix the Railway catalog repair rejection of native MySQL JSON for products.tags while preserving MariaDB compatibility and safe tag reads"
contributor: "graphify"
outcome: "useful"
source_nodes: ["catalog", "migrationTracker.js", "migrate-deploy.js", "adminCatalogService.js", "catalogService.js", "validateTags"]
---

# Q: Trace and fix the Railway catalog repair rejection of native MySQL JSON for products.tags while preserving MariaDB compatibility and safe tag reads

## Answer

Expanded from original query via graph vocab: [catalog, database, json, migration, mysql, normalize, products, readiness, repair, schema, tags, type]. The shared readiness checker treated products.tags like an ordinary TEXT_TYPES column, so DATA_TYPE=json failed despite being native MySQL JSON. Centralize semantic compatibility in catalogSchemaReadinessService: accept native json and safe text families; use it for drift detection, repair pre/post checks, and final readiness. Keep the checksum-tracked repair migration unchanged, never alter a compatible native JSON column, normalize driver-returned arrays or JSON strings through one safe helper, and log engine/version plus type compatibility before running the registry.

## Outcome

- Signal: useful

## Source Nodes

- catalog
- migrationTracker.js
- migrate-deploy.js
- adminCatalogService.js
- catalogService.js
- validateTags