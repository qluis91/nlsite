# AI Workflow — nlSite

Tools configured for efficient AI-assisted development with DeepSeek in Cursor.

---

## Graphify — Knowledge Graph

**What:** Builds a queryable knowledge graph from project source code.  
**Install:** `uv tool install graphifyy`  
**First use after clone:** `graphify update .` (generates graph.json needed for queries)  
**Location:** `graphify-out/`

### Daily Use

```powershell
# Query the graph (no LLM tokens, BFS traversal)
graphify query "how does authentication work in this project"

# Trace shortest path between two concepts
graphify path "authController" "adminRoutes"

# Explain a node
graphify explain "authMiddleware"
```

### When to Refresh

After structural changes (new files, refactors):
```powershell
graphify update .    # incremental rebuild (AST only, no LLM needed)
```

For full rebuild including docs/papers/images, use the Graphify skill in Cursor:
`/graphify .`

`graphify update .` is the verified PowerShell command covering code-only changes.

### Graph Outputs

| File | Purpose | Git |
|------|---------|-----|
| `graph.json` | Raw graph data (queryable) | Ignored — regenerated |
| `graph.html` | Interactive browser visualization | Ignored — regenerated |
| `GRAPH_REPORT.md` | Audit report with god nodes, surprises, questions | Committed |
| `.graphify_labels.json` | Community labels | Committed |
| `manifest.json` | File manifest for incremental updates | Ignored |
| `cost.json` | Cumulative token tracking | Ignored |

---

## Caveman — Token-Efficient Communication

**What:** Compresses agent output ~65% while preserving technical accuracy.  
**Status:** Skill available in Cursor via `~/.claude/plugins/cache/caveman/`.  
**Persistence:** Active for the session once triggered. Does not persist between sessions automatically.

### Usage

Activate explicitly: `/caveman`  
Levels: `/caveman lite`, `/caveman full` (default), `/caveman ultra`  
Auto-triggers when token efficiency is requested.

Disable: `stop caveman` or `normal mode`.

### What Caveman Never Compresses

Code, commands, file paths, SQL, errors, test results, and security warnings are always preserved verbatim. Only conversational text is compressed.

---

## CodeBurn — Token Usage Tracker

**What:** Estimates AI token usage and cost from locally available session data.  
**Values shown are estimates, not actual Cursor or DeepSeek billing.**  
**Install:** `npm install -g codeburn` (already installed v0.9.16)  
**Location:** No files stored inside repository.

### Daily Use

```powershell
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

### Review Token Estimates

```powershell
codeburn overview     # quick summary
codeburn models       # by model
codeburn sessions     # by session
```

### Disable / Remove

```powershell
npm uninstall -g codeburn
```

No repository files created by CodeBurn.

---

## Ignored Files (`.gitignore`)

Files excluded from Git:
- `.env` (secrets)
- `node_modules/`
- `graphify-out/cache/`, `graphify-out/backup/` (build caches)
- `graphify-out/graph.json`, `graphify-out/graph.html` (rebuilt on update)
- `graphify-out/manifest.json`, `graphify-out/cost.json` (machine-specific)
- `graphify-out/.graphify_python`, `graphify-out/.graphify_root` (local paths)

Committed Graphify outputs:
- `graphify-out/GRAPH_REPORT.md` (3 KB, useful for agents)
- `graphify-out/.graphify_labels.json` (0.2 KB, community labels)

First use after clone: `graphify update .` to regenerate `graph.json`.

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
