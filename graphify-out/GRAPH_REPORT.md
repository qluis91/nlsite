# Graph Report - NLSite  (2026-07-21)

## Corpus Check
- 39 files · ~12,217 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 206 nodes · 240 edges · 13 communities
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `11c8e33b`
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
1. `Manual Authentication Testing Checklist` - 10 edges
2. `nlSite — Project Status` - 10 edges
3. `Changelog` - 8 edges
4. `mapRole()` - 7 edges
5. `hashToken()` - 7 edges
6. `keywords` - 6 edges
7. `AI Workflow — nlSite` - 6 edges
8. `2026-07-21 — Email Verification and Password Recovery` - 6 edges
9. `register()` - 5 edges
10. `main()` - 5 edges

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
Cohesion: 0.06
Nodes (31): adminLoginLimiter, adminRoutes, app, authController, authRoutes, express, helmet, layoutMiddleware (+23 more)

### Community 1 - "NPM Package Config"
Cohesion: 0.11
Nodes (18): nodemon, author, description, devDependencies, nodemon, keywords, license, main (+10 more)

### Community 2 - "Dependencies"
Cohesion: 0.11
Nodes (19): bcryptjs, dotenv, ejs, express, express-rate-limit, express-session, helmet, mysql2 (+11 more)

### Community 3 - "Database & Auth Controller"
Cohesion: 0.16
Nodes (11): mapRole(), mapRoleId(), bcrypt, createUser(), listUsers(), { mapRole, mapRoleId }, pool, showEditUser() (+3 more)

### Community 4 - "Admin Controller"
Cohesion: 0.20
Nodes (7): db, mysql, pool, bcrypt, pool, readline, rl

### Community 5 - "Auth Routes"
Cohesion: 0.14
Nodes (15): bcrypt, crypto, expiresAt(), forgotPassword(), generateToken(), hashToken(), mailer, { mapRole } (+7 more)

### Community 6 - "Package Keywords"
Cohesion: 0.13
Nodes (14): AI Workflow — nlSite, Caveman — Token-Efficient Communication, CodeBurn — Token Usage Tracker, Daily Use, Daily Use, Disable / Remove, Graph Outputs, Graphify — Knowledge Graph (+6 more)

### Community 8 - "nlSite — Project Status"
Cohesion: 0.18
Nodes (10): AI Tools Configured, Completed Phases, Database, Email Configuration, Known Limitations, New Routes, Next Recommended Phase, nlSite — Project Status (+2 more)

### Community 9 - "2026-07-21 — AI Workflow Configuration"
Cohesion: 0.08
Nodes (24): 2026-07-21 — Authentication Interface and Manual Verification, 2026-07-21 — Critical Authentication and Authorization Correction, 2026-07-21 — Database Schema Consistency and Security Correction, 2026-07-21 — Email Verification and Password Recovery, 2026-07-21 — Initial Project Setup, 2026-07-21 — Logout Flow Correction, 2026-07-21 — Security and Error Handling, Added (+16 more)

### Community 10 - "Manual Authentication Testing Checklist"
Cohesion: 0.17
Nodes (11): Administrator Login, Error Pages, Forgot Password, Layout (Desktop + Mobile), Manual Authentication Testing Checklist, Public Navigation, Resend Verification, Route Protection (+3 more)

### Community 11 - "2026-07-21 — Security and Error Handling"
Cohesion: 0.48
Nodes (6): assert(), hasText(), http, main(), request(), skip()

### Community 12 - "2026-07-21 — AI Workflow Configuration"
Cohesion: 0.33
Nodes (7): escapeHtml(), missing, nodemailer, required, sendMail(), sendPasswordResetEmail(), sendVerificationEmail()

## Knowledge Gaps
- **112 isolated node(s):** `express`, `session`, `helmet`, `rateLimit`, `path` (+107 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `keywords` connect `NPM Package Config` to `Express Core & Routing`?**
  _High betweenness centrality (0.178) - this node is a cross-community bridge._
- **Why does `express` connect `Express Core & Routing` to `NPM Package Config`?**
  _High betweenness centrality (0.176) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Dependencies` to `NPM Package Config`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **What connects `express`, `session`, `helmet` to the rest of the system?**
  _112 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Express Core & Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.06401137980085349 - nodes in this community are weakly interconnected._
- **Should `NPM Package Config` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._