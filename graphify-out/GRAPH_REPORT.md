# Graph Report - .  (2026-07-21)

## Corpus Check
- Corpus is ~3,487 words - fits in a single context window. You may not need a graph.

## Summary
- 82 nodes · 89 edges · 8 communities (7 shown, 1 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Express Core & Routing
- NPM Package Config
- Dependencies
- Database & Auth Controller
- Admin Controller
- Auth Routes
- Package Keywords

## God Nodes (most connected - your core abstractions)
1. `keywords` - 6 edges
2. `express` - 4 edges
3. `scripts` - 3 edges
4. `setLocals()` - 2 edges
5. `isAuthenticated()` - 2 edges
6. `isGuest()` - 2 edges
7. `isAdmin()` - 2 edges
8. `bcryptjs` - 2 edges
9. `dotenv` - 2 edges
10. `ejs` - 2 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (8 total, 1 thin omitted)

### Community 0 - "Express Core & Routing"
Cohesion: 0.13
Nodes (15): adminRoutes, app, authRoutes, express, path, session, { setLocals }, isAdmin() (+7 more)

### Community 1 - "NPM Package Config"
Cohesion: 0.14
Nodes (13): nodemon, author, description, devDependencies, nodemon, license, main, name (+5 more)

### Community 2 - "Dependencies"
Cohesion: 0.15
Nodes (13): bcryptjs, dotenv, ejs, express, express-session, mysql2, dependencies, bcryptjs (+5 more)

### Community 3 - "Database & Auth Controller"
Cohesion: 0.17
Nodes (5): db, mysql, pool, bcrypt, pool

### Community 5 - "Auth Routes"
Cohesion: 0.33
Nodes (5): isGuest(), authController, express, { isGuest }, router

### Community 6 - "Package Keywords"
Cohesion: 0.33
Nodes (6): keywords, authentication, boilerplate, ejs, express, mysql

## Knowledge Gaps
- **43 isolated node(s):** `express`, `session`, `path`, `authRoutes`, `adminRoutes` (+38 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `keywords` connect `Package Keywords` to `NPM Package Config`?**
  _High betweenness centrality (0.504) - this node is a cross-community bridge._
- **Why does `express` connect `Package Keywords` to `Express Core & Routing`, `Auth Routes`?**
  _High betweenness centrality (0.484) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Dependencies` to `NPM Package Config`?**
  _High betweenness centrality (0.270) - this node is a cross-community bridge._
- **What connects `express`, `session`, `path` to the rest of the system?**
  _43 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Express Core & Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.1286549707602339 - nodes in this community are weakly interconnected._
- **Should `NPM Package Config` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._