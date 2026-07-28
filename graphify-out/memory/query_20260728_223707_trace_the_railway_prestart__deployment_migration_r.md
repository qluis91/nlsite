---
type: "architecture"
date: "2026-07-28T22:37:07.229018+00:00"
question: "Trace the Railway prestart, deployment migration registry, catalog schema readiness, and startup failure for missing catalog capabilities"
contributor: "graphify"
outcome: "useful"
source_nodes: ["scripts/prestart.js", "scripts/migrate-deploy.js", "scripts/migrationTracker.js", "scripts/migrate-catalog.js", "services/catalogSchemaReadinessService.js", "config/databaseReadiness.js", "app.js"]
---

# Q: Trace the Railway prestart, deployment migration registry, catalog schema readiness, and startup failure for missing catalog capabilities

## Answer

The failure is emitted inside scripts/migrate-deploy.js after runPendingMigrations and before app.js. Historical schema_migrations records are skipped by name/checksum even when physical catalog tables are absent; the historical base migration is CREATE TABLE IF NOT EXISTS and cannot reconcile partial tables. Add a capability-aware catalog repair immediately after migrateCatalog, then perform final readiness after the registry and close the prestart migration pool so npm starts app.js with a fresh pool.

## Outcome

- Signal: useful

## Source Nodes

- scripts/prestart.js
- scripts/migrate-deploy.js
- scripts/migrationTracker.js
- scripts/migrate-catalog.js
- services/catalogSchemaReadinessService.js
- config/databaseReadiness.js
- app.js