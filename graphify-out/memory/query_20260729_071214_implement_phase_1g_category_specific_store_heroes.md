---
type: "query"
date: "2026-07-29T07:12:14.205598+00:00"
question: "Implement Phase 1G category-specific Store heroes using the Phase 1F Store Hero CMS architecture and existing category admin"
contributor: "graphify"
outcome: "useful"
source_nodes: ["controllers_admincatalogcontroller", "services_admincatalogservice", "services_catalogservice"]
---

# Q: Implement Phase 1G category-specific Store heroes using the Phase 1F Store Hero CMS architecture and existing category admin

## Answer

Expanded from original query via vocab: [admin, catalog, category, hero, history, media, migration, publish, resolve, revision, store, validation]. Traversal identified the existing category editor/controller/service, resolveStoreHero public path, Media Library reference contract, migration tracker, and content revision service. Implemented additive migration 22, transactional category persistence and revisions, safe media and URL validation, explicit enablement, and category-to-general fallback. Focused tests passed 278/278 and the full serial suite passed 1590/1590.

## Outcome

- Signal: useful

## Source Nodes

- controllers_admincatalogcontroller
- services_admincatalogservice
- services_catalogservice