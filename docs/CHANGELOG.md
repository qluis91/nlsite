# Changelog

## 2026-07-21 — AI Workflow Configuration

### Added
- Graphify knowledge graph (82 nodes, 89 edges, 8 communities) via `uv tool install graphifyy`
- Graphify outputs: `graph.html`, `graph.json`, `GRAPH_REPORT.md` in `graphify-out/`
- CodeBurn token usage tracker (global npm, v0.9.16)
- `.cursor/rules/nlsite.mdc` — project rules for AI agents
- `docs/PROJECT_STATUS.md`, `docs/CHANGELOG.md`, `docs/AI_WORKFLOW.md`
- `.gitignore` with standard Node.js + AI tool exclusions
- `.env.example` with safe placeholder values
- Git repository initialized (`git init`)

### Changed
- None (no application code modified)

### Fixed
- None

### Validation
- `npm run dev` — server starts on port 3000
- Graphify: `graphify query "how does auth work"` functional
- CodeBurn: `codeburn status` reports usage
- Caveman: skill loaded in Cursor
- Git: clean status, `.env` correctly ignored
