# AI Workflow — nlSite

Tools configured for efficient AI-assisted development with DeepSeek in Cursor.

---

## Graphify — Knowledge Graph

**What:** Builds a queryable knowledge graph from project source code.  
**Install:** `uv tool install graphifyy`  
**Location:** `graphify-out/`

### Daily Use

```bash
# Query the graph (no LLM tokens, BFS traversal)
graphify query "how does authentication work in this project"

# Trace shortest path between two concepts
graphify path "authController" "adminRoutes"

# Explain a node
graphify explain "authMiddleware"
```

### When to Refresh

Run full rebuild after major structural changes (new files, refactors):
```bash
graphify .          # full rebuild
graphify . --update # incremental (only changed files)
```

### Graph Outputs

| File | Purpose |
|------|---------|
| `graph.html` | Interactive browser visualization |
| `graph.json` | Raw graph data (queryable) |
| `GRAPH_REPORT.md` | Audit report with god nodes, surprises, questions |
| `manifest.json` | File manifest for incremental updates |
| `cost.json` | Cumulative token tracking |

---

## Caveman — Token-Efficient Communication

**What:** Compresses agent output ~65% while preserving technical accuracy.  
**Status:** Already loaded as Cursor skill.

### Usage

Caveman activates automatically when token efficiency is requested, or explicitly via `/caveman`. Levels: `lite`, `full` (default), `ultra`.

Disable: "stop caveman" or "normal mode".

---

## CodeBurn — Token Usage Tracker

**What:** Tracks AI token usage by task, tool, model, and project.  
**Install:** `npm install -g codeburn` (already installed v0.9.16)  
**Location:** No files inside repository.

### Daily Use

```bash
codeburn status       # today + month summary
codeburn today        # today's dashboard
codeburn month        # this month's dashboard
codeburn report       # interactive dashboard
codeburn web          # open local web dashboard
codeburn overview     # plain-text copy-pasteable summary
codeburn sessions     # per-session report
codeburn models       # per-model token + cost table
codeburn export       # CSV/JSON export
```

### Review Token Spend

```bash
codeburn overview     # quick summary
codeburn models       # by model
codeburn sessions     # by session
```

### Disable / Remove

```bash
npm uninstall -g codeburn
```

No repository files created by CodeBurn.

---

## Ignored Files (`.gitignore`)

Generated/cache files excluded from Git:
- `graphify-out/cache/` (AST cache)
- CodeBurn stores no project files
- `.env` (secrets)
- `node_modules/`

Committed outputs:
- `graphify-out/graph.json`, `graph.html`, `GRAPH_REPORT.md`
- `graphify-out/manifest.json`, `cost.json`
- `graphify-out/.graphify_labels.json`

---

## Recommended Workflow

1. **Read** `docs/PROJECT_STATUS.md` — understand current state
2. **Check** `git status` — know what's changed
3. **Query** Graphify — `graphify query "your question"` to find relevant files
4. **Inspect** only needed source files
5. **Change** — smallest safe edit
6. **Validate** — `npm run dev`, check functionality
7. **Review** — `git diff`
8. **Update** — `PROJECT_STATUS.md` and `CHANGELOG.md`
9. **Commit** — only when explicitly requested, with descriptive message
