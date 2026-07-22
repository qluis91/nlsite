# Graph Report - NLSite  (2026-07-21)

## Corpus Check
- 34 files · ~9,261 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 184 nodes · 201 edges · 13 communities
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0ebd3d8e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Express Core & Routing
- NPM Package Config
- Dependencies
- Database & Auth Controller
- Admin Controller
- Auth Routes
- Package Keywords
- nlSite — Project Status
- 2026-07-21 — AI Workflow Configuration
- Manual Authentication Testing Checklist
- 2026-07-21 — Security and Error Handling
- 2026-07-21 — AI Workflow Configuration

## God Nodes (most connected - your core abstractions)
1. `nlSite — Project Status` - 9 edges
2. `Manual Authentication Testing Checklist` - 8 edges
3. `Changelog` - 8 edges
4. `mapRole()` - 7 edges
5. `keywords` - 6 edges
6. `AI Workflow — nlSite` - 6 edges
7. `2026-07-21 — Database Schema Consistency and Security Correction` - 6 edges
8. `main()` - 5 edges
9. `2026-07-21 — Authentication Interface and Manual Verification` - 5 edges
10. `2026-07-21 — Security and Error Handling` - 5 edges

## Surprising Connections (you probably didn't know these)
- `listUsers()` --calls--> `mapRole()`  [EXTRACTED]
  controllers/adminController.js → config/roles.js
- `showEditUser()` --calls--> `mapRole()`  [EXTRACTED]
  controllers/adminController.js → config/roles.js
- `adminLogin()` --calls--> `mapRole()`  [EXTRACTED]
  controllers/authController.js → config/roles.js
- `login()` --calls--> `mapRole()`  [EXTRACTED]
  controllers/authController.js → config/roles.js
- `createUser()` --calls--> `mapRoleId()`  [EXTRACTED]
  controllers/adminController.js → config/roles.js

## Import Cycles
- None detected.

## Communities (13 total, 0 thin omitted)

### Community 0 - "Express Core & Routing"
Cohesion: 0.08
Nodes (25): adminLoginLimiter, adminRoutes, app, authController, authRoutes, express, helmet, layoutMiddleware (+17 more)

### Community 1 - "NPM Package Config"
Cohesion: 0.14
Nodes (13): nodemon, author, description, devDependencies, nodemon, license, main, name (+5 more)

### Community 2 - "Dependencies"
Cohesion: 0.12
Nodes (17): bcryptjs, dotenv, ejs, express, express-rate-limit, express-session, helmet, mysql2 (+9 more)

### Community 3 - "Database & Auth Controller"
Cohesion: 0.10
Nodes (14): mapRole(), mapRoleId(), bcrypt, createUser(), listUsers(), { mapRole, mapRoleId }, pool, showEditUser() (+6 more)

### Community 4 - "Admin Controller"
Cohesion: 0.20
Nodes (7): db, mysql, pool, bcrypt, pool, readline, rl

### Community 5 - "Auth Routes"
Cohesion: 0.20
Nodes (9): keywords, authentication, boilerplate, ejs, express, mysql, adminController, express (+1 more)

### Community 6 - "Package Keywords"
Cohesion: 0.13
Nodes (14): AI Workflow — nlSite, Caveman — Token-Efficient Communication, CodeBurn — Token Usage Tracker, Daily Use, Daily Use, Disable / Remove, Graph Outputs, Graphify — Knowledge Graph (+6 more)

### Community 8 - "nlSite — Project Status"
Cohesion: 0.20
Nodes (9): AI Tools Configured, Completed Phases, Database, Directory Structure, Known Limitations, Next Recommended Phase, nlSite — Project Status, Stack (+1 more)

### Community 9 - "2026-07-21 — AI Workflow Configuration"
Cohesion: 0.07
Nodes (28): 2026-07-21 — AI Workflow Audit, 2026-07-21 — Authentication Interface and Manual Verification, 2026-07-21 — Critical Authentication and Authorization Correction, 2026-07-21 — Database Schema Consistency and Security Correction, 2026-07-21 — Logout Flow Correction, 2026-07-21 — Security and Error Handling, Added, Added (+20 more)

### Community 10 - "Manual Authentication Testing Checklist"
Cohesion: 0.22
Nodes (8): Administrator Login, Error Pages, Manual Authentication Testing Checklist, Public Navigation, Route Protection, Security Checks, User Login, User Registration

### Community 11 - "2026-07-21 — Security and Error Handling"
Cohesion: 0.48
Nodes (6): assert(), hasText(), http, main(), request(), skip()

### Community 12 - "2026-07-21 — AI Workflow Configuration"
Cohesion: 0.40
Nodes (5): 2026-07-21 — AI Workflow Configuration, Added, Changed, Fixed, Validation

## Knowledge Gaps
- **109 isolated node(s):** `express`, `session`, `helmet`, `rateLimit`, `path` (+104 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `keywords` connect `Auth Routes` to `NPM Package Config`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Why does `express` connect `Auth Routes` to `Express Core & Routing`?**
  _High betweenness centrality (0.155) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Dependencies` to `NPM Package Config`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **What connects `express`, `session`, `helmet` to the rest of the system?**
  _109 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Express Core & Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.07741935483870968 - nodes in this community are weakly interconnected._
- **Should `NPM Package Config` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._