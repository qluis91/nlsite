# nlSite — Project Status

**Last updated:** 2026-07-21  
**Current phase:** AI workflow configuration

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v24.18.0 |
| Framework | Express 4.x |
| Templates | EJS (layouts + components) |
| Database | MySQL via mysql2/promise (XAMPP) |
| Auth | express-session + bcryptjs |
| Config | dotenv (.env → config/site.js) |

## Working Features

- [x] Public pages: Home, Login, Register
- [x] Authentication: login, register, logout with sessions
- [x] Role-based access: admin/user with middleware guards
- [x] Admin panel: dashboard, user CRUD, activate/deactivate, delete
- [x] Brand-white-label: colors/text from `.env` injected as CSS variables
- [x] Responsive CSS (768px breakpoint)
- [x] Modular EJS: 2 layouts, 4 components, 6 pages
- [x] Parameterized SQL queries throughout

## Directory Structure

```
nlSite/
├── .cursor/rules/nlsite.mdc
├── config/          db.js, site.js
├── controllers/     authController.js, adminController.js
├── middlewares/     authMiddleware.js
├── routes/          authRoutes.js, adminRoutes.js
├── views/           components/, layouts/, pages/
├── public/          css/, js/, images/
├── docs/            PROJECT_STATUS.md, CHANGELOG.md, AI_WORKFLOW.md
├── graphify-out/    Knowledge graph outputs
├── app.js
├── schema.sql
├── .env.example
└── .gitignore
```

## Database

- Connection: pool via `config/db.js`
- Schema: `schema.sql` (users, sessions, site_settings tables)
- Default admin: admin@misitio.com / admin123

## AI Tools Configured

| Tool | Purpose | Status |
|------|---------|--------|
| Graphify | Knowledge graph + query | Installed (uv), graph generated |
| Caveman | Token-efficient communication | Skill loaded |
| CodeBurn | Token usage tracking | Global install, CLI active |

## Known Limitations

- 12 `.ejs` templates not parsed by Graphify AST (no tree-sitter-ejs)
- 5 dangling graph edges from unsupported file references
- Python only available via `uv` (no system Python)
- No API endpoints — server-side rendered only
- No email verification on registration
- No password reset flow

## Next Recommended Phase

Application feature development (as needed by specific client requirements).

## Completed Phases

| Phase | Description | Date |
|-------|-------------|------|
| Initial | Boilerplate creation (22 files) | 2026-07-21 |
| AI Config | Graphify + Caveman + CodeBurn + rules + docs | 2026-07-21 |
