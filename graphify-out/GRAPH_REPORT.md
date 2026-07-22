# Graph Report - NLSite  (2026-07-21)

## Corpus Check
- 44 files · ~234,706 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 292 nodes · 342 edges · 18 communities
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `10cfd087`
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
- session.js
- 2026-07-21 — CSRF Protection
- 2026-07-21 — Email Verification and Password Recovery
- 2026-07-21 — Critical Panel 1 Runtime Correction — CSP, Three.js, External GLB, Logo, and Navigation
- 2026-07-21 — Panel 1 Helmet and Logo Correction

## God Nodes (most connected - your core abstractions)
1. `Manual Authentication Testing Checklist` - 15 edges
2. `Changelog` - 15 edges
3. `nlSite — Project Status` - 10 edges
4. `2026-07-21 — Critical Panel 1 Runtime Correction — CSP, Three.js, External GLB, Logo, and Navigation` - 9 edges
5. `2026-07-21 — Frontend Foundation — Animated Panel 1` - 9 edges
6. `mapRole()` - 7 edges
7. `hashToken()` - 7 edges
8. `initHomeAnimations()` - 7 edges
9. `main()` - 7 edges
10. `2026-07-21 — Panel 1 Helmet and Logo Correction` - 7 edges

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

## Communities (18 total, 0 thin omitted)

### Community 0 - "Express Core & Routing"
Cohesion: 0.05
Nodes (39): adminLoginLimiter, adminRoutes, app, authController, authRoutes, { createSessionMiddleware, sessionStore }, crypto, { csrfSync } (+31 more)

### Community 1 - "NPM Package Config"
Cohesion: 0.11
Nodes (18): nodemon, author, description, devDependencies, nodemon, keywords, license, main (+10 more)

### Community 2 - "Dependencies"
Cohesion: 0.07
Nodes (29): bcryptjs, csrf-sync, dotenv, ejs, express, express-mysql-session, express-rate-limit, express-session (+21 more)

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
Cohesion: 0.05
Nodes (36): 2026-07-21 — Authentication Interface and Manual Verification, 2026-07-21 — Critical Authentication and Authorization Correction, 2026-07-21 — CSRF Protection, 2026-07-21 — Database Schema Consistency and Security Correction, 2026-07-21 — Documentation Accuracy Correction, 2026-07-21 — Email Verification and Password Recovery, 2026-07-21 — Homepage Responsive Adaptation, 2026-07-21 — Initial Project Setup (+28 more)

### Community 10 - "Manual Authentication Testing Checklist"
Cohesion: 0.10
Nodes (19): Administrator Login, Completed (HTTP integration validation), CSRF Protection, Error Pages, Forgot Password, Homepage + Auth Integration (Panel 1), Homepage Responsive Adaptation, Layout (Desktop + Mobile) (+11 more)

### Community 11 - "2026-07-21 — Security and Error Handling"
Cohesion: 0.44
Nodes (8): assert(), extractCsrf(), getCsrfToken(), hasText(), http, main(), request(), skip()

### Community 12 - "2026-07-21 — AI Workflow Configuration"
Cohesion: 0.33
Nodes (7): escapeHtml(), missing, nodemailer, required, sendMail(), sendPasswordResetEmail(), sendVerificationEmail()

### Community 13 - "session.js"
Cohesion: 0.28
Nodes (10): initGSAP(), initHomeAnimations(), initLenis(), runEntrance(), runScrollAnimations(), initHelmet3D(), homePage, init() (+2 more)

### Community 14 - "2026-07-21 — CSRF Protection"
Cohesion: 0.22
Nodes (9): 2026-07-21 — Frontend Foundation — Animated Panel 1, Accessibility, Added, Changed, Limitations, Responsive Behavior, Security, Validation (+1 more)

### Community 15 - "2026-07-21 — Email Verification and Password Recovery"
Cohesion: 0.33
Nodes (6): 2026-07-21 — Persistent MySQL Sessions, Added, Changed, Fixed, Limitations, Validation

### Community 17 - "2026-07-21 — Critical Panel 1 Runtime Correction — CSP, Three.js, External GLB, Logo, and Navigation"
Cohesion: 0.22
Nodes (9): 2026-07-21 — Critical Panel 1 Runtime Correction — CSP, Three.js, External GLB, Logo, and Navigation, Fixed — 3D Stage, Fixed — CSP Nonce System, Fixed — External GLB Loading, Fixed — Logo Size, Fixed — Navigation Alignment, Limitations, Root Cause — Two Interdependent Failures (+1 more)

### Community 18 - "2026-07-21 — Panel 1 Helmet and Logo Correction"
Cohesion: 0.29
Nodes (7): 2026-07-21 — Panel 1 Helmet and Logo Correction, Fixed — 3D Helmet Loader, Fixed — 3D Stage CSS, Fixed — Logo Size, Limitations, Root Cause — 3D Helmet Not Loading, Validation

## Knowledge Gaps
- **166 isolated node(s):** `express`, `helmet`, `rateLimit`, `path`, `crypto` (+161 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `keywords` connect `NPM Package Config` to `Express Core & Routing`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Why does `express` connect `Express Core & Routing` to `NPM Package Config`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Dependencies` to `NPM Package Config`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **What connects `express`, `helmet`, `rateLimit` to the rest of the system?**
  _166 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Express Core & Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.051418439716312055 - nodes in this community are weakly interconnected._
- **Should `NPM Package Config` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._