# Manual Authentication Testing Checklist

Use this checklist to manually verify every authentication flow from the browser.

**Prerequisites:**
- Server running: `npm run dev`
- MySQL connected
- SMTP credentials configured in `.env` (for email tests)
- Test users exist (create via registration form or admin panel)

---

## Public Navigation

| # | Action | URL | Expected |
|---|--------|-----|----------|
| 1 | Open home page | `/` | 200, `<!DOCTYPE html>`, site name, navbar with "Iniciar Sesión" + "Registrarse", footer visible |
| 2 | Page source has `<html>` and `<head>` | Any page | Full HTML document with CSS link, not a raw fragment |
| 3 | Click "Iniciar Sesión" | `/auth/login` | Login form with email, password, "Ingresar", link to register, "¿Olvidaste tu contraseña?" |
| 4 | Click "Registrarse" | `/auth/register` | Registration form with name, email, password, confirm |
| 5 | Admin link visible on login | `/auth/login` | "¿Eres administrador? Accede al panel administrativo" links to `/admin/login` |
| 6 | Admin login page loads | `/admin/login` | "Acceso Administrativo" badge, form, links back to user login and home |

---

## User Registration (with Email Verification)

| # | Action | Expected |
|---|--------|----------|
| 7 | Submit empty form | "Todos los campos son obligatorios." |
| 8 | Password mismatch | "Las contraseñas no coinciden." Form preserves name and email, clears passwords |
| 9 | Password < 6 chars | "La contraseña debe tener al menos 6 caracteres." |
| 10 | Invalid email format | "El formato del correo electrónico no es válido." |
| 11 | Valid registration | → `/auth/verify-pending`. "Te hemos enviado un correo de verificación." **No user row created yet.** |
| 12 | Check DB: no `users` row | `SELECT * FROM users WHERE email = 'test@...'` → 0 rows |
| 13 | Check DB: pending registration | `SELECT * FROM pending_registrations WHERE email = 'test@...'` → 1 row with `token_hash` |
| 14 | Open verification email | Clear button/link, expiration time, plain-text fallback |
| 15 | Click verification link | → `/auth/login` with "Correo verificado. Tu cuenta fue creada correctamente." |
| 16 | Check DB: user created | `users` row exists with `role_id=2`, `is_active=1` |
| 17 | Check DB: pending removed | `pending_registrations` row deleted |
| 18 | Login with new user | Works with registered credentials |
| 19 | Re-open same verification link | "El enlace de verificación es inválido o ha expirado." |
| 20 | Duplicate email registration | "Ya existe una cuenta registrada con ese correo electrónico." |

### Resend Verification

| # | Action | Expected |
|---|--------|----------|
| 21 | Click "Reenviar enlace" on verify-pending | Form with email field |
| 22 | Submit known pending email | "Si existe un registro pendiente para ese correo, enviaremos un nuevo enlace..." |
| 23 | Old verification link | Stops working (token replaced) |
| 24 | New verification link | Works |
| 25 | Submit unknown email | Same generic message, no error, no info leak |
| 26 | Rapid resend (4th attempt) | Rate limited |

---

## User Login

| # | Action | Expected |
|---|--------|----------|
| 27 | Submit empty form | "Todos los campos son obligatorios." |
| 28 | Invalid password | "Correo electrónico o contraseña incorrectos." |
| 29 | Non-existent email | "Correo electrónico o contraseña incorrectos." |
| 30 | Valid user login | "¡Bienvenido, [name]!" Redirected to `/` |
| 31 | After login, navbar shows | User name + "Cerrar Sesión" |
| 32 | Inactive user attempts login | "Correo electrónico o contraseña incorrectos." (generic, no status leak) |
| 33 | User visits `/admin` | "Acceso denegado. Se requieren permisos de administrador." Redirected to `/` |
| 34 | Click "Cerrar Sesión" (POST form) | 302 redirect to `/auth/login`, session cookie cleared |
| 35 | After logout, navbar shows | "Iniciar Sesión" + "Registrarse" (logged-out state) |
| 36 | After logout, refresh home | Still logged out, no session restored |
| 37 | After logout, visit `/admin` | 302 redirect to `/auth/login` |

---

## Forgot Password

| # | Action | Expected |
|---|--------|----------|
| 38 | Click "¿Olvidaste tu contraseña?" on login | `/auth/forgot-password` form with email + submit |
| 39 | Submit empty form | Generic: "Si existe una cuenta activa con ese correo..." |
| 40 | Submit unknown email | Same generic message. No "email not found" error. |
| 41 | Submit active user email | Same generic message. Reset email sent in background. |
| 42 | Check DB: reset token exists | `password_reset_tokens` row for that user |
| 43 | Open reset email | Reset link, expiration, button, plain-text fallback |
| 44 | Click reset link | `/auth/reset-password?token=...` form with new password fields |
| 45 | Submit mismatched passwords | "Las contraseñas no coinciden." |
| 46 | Submit password < 6 chars | "La contraseña debe tener al menos 6 caracteres." |
| 47 | Submit valid new password | → `/auth/login` with "Contraseña actualizada correctamente." |
| 48 | Login with old password | Fails (password changed) |
| 49 | Login with new password | Works |
| 50 | Re-open used reset link | "El enlace de restablecimiento es inválido o ha expirado." |
| 51 | Check DB: token marked used | `used_at` is NOT NULL |
| 52 | Rapid forgot-password (4th attempt) | Rate limited |

---

## Administrator Login

| # | Action | Expected |
|---|--------|----------|
| 53 | Open `/admin/login` | Form with "Administración" badge, "Acceso Administrativo" title |
| 54 | Empty fields submit | "Credenciales administrativas inválidas." |
| 55 | Normal user credentials | "Credenciales administrativas inválidas." (generic message) |
| 56 | Inactive admin credentials | "Credenciales administrativas inválidas." (generic, no status leak) |
| 57 | Invalid admin password | "Credenciales administrativas inválidas." |
| 58 | Valid admin login | "¡Bienvenido, [name]!" Redirected to `/admin` (dashboard) |
| 59 | After login, navbar shows | "Panel Admin" + user name + "Cerrar Sesión" |
| 60 | Dashboard shows active-users stat | "Usuarios Activos" counter visible |
| 61 | Already-logged-in admin visits `/admin/login` | Redirected to `/admin` |
| 62 | Admin visits `/admin/users` | User list with Estado column, toggle and delete buttons |
| 63 | Admin deactivates a normal user | Status changes to "Inactivo" badge |
| 64 | Admin reactivates user | Status changes to "Activo" badge |
| 65 | Admin user form has is_active checkbox | Checkbox visible on create and edit forms |
| 66 | Admin logout | `Cerrar Sesión` → redirected to `/auth/login` |

---

## Route Protection

| # | Action | Expected |
|---|--------|----------|
| 67 | Unauthenticated → `/admin` | 302 → `/auth/login` |
| 68 | Unauthenticated → `/admin/users` | 302 → `/auth/login` |
| 69 | Normal user (logged in) → `/admin` | "Acceso denegado" → redirect to `/` |
| 70 | Normal user → `/admin/users` | "Acceso denegado" → redirect to `/` |
| 71 | Admin → `/admin/*` | All admin pages accessible |

---

## Error Pages

| # | Action | Expected |
|---|--------|----------|
| 72 | Unknown URL `/whatever` | 404 page with "La página que buscas no existe" + link to home |

---

## Layout (Desktop + Mobile)

| # | Action | Expected |
|---|--------|----------|
| 73 | `/auth/verify-pending` | Navbar, footer, form card, responsive, no horizontal overflow |
| 74 | `/auth/resend-verification` | Navbar, footer, form, labels visible, autocomplete on email |
| 75 | `/auth/forgot-password` | Navbar, footer, form, labels visible, autocomplete on email |
| 76 | `/auth/reset-password` | Navbar, footer, form, `autocomplete="new-password"`, password not pre-filled |
| 77 | All pages: `style.css` loads | 200 status, styles applied |
| 78 | All pages: no console errors | DevTools console clean |
| 79 | Mobile viewport (≤768px) | Forms aligned, no horizontal scroll, inputs full-width |

---

## Security Checks

| # | Action | Expected |
|---|--------|----------|
| 80 | View page source on login | No admin credentials, no passwords visible |
| 81 | Admin login page source | No hints about admin email or password |
| 82 | Rapid user login attempts (6th POST) | Rate limited: "Demasiados intentos..." |
| 83 | Rapid admin login attempts (6th POST) | Rate limited: "Demasiados intentos..." |
| 84 | View page source anywhere | No default credentials or passwords exposed |
| 85 | GET `/auth/logout` | Returns 404 or redirects, logout requires POST |
| 86 | Logout does not trigger rate limiter | 10 rapid logouts still allow normal browsing |
| 87 | Browser dev tools: logout POST | Method is POST, response is 302, Set-Cookie clears `connect.sid` |
| 88 | Verification URL: no user ID in token param | Only hex string, no numeric ID, no email in URL |
| 89 | Reset URL: no user ID in token param | Only hex string, no numeric ID, no email in URL |
| 90 | Forgot-password: submit inactive user email | Generic message, no token created in DB |
| 91 | SMTP credentials not in page source | Search for SMTP password in HTML → zero results |

---

## CSRF Protection

| # | Action | Expected |
|---|--------|----------|
| 92 | View page source on login | Hidden `<input name="_csrf">` present in form |
| 93 | View page source on register | Hidden `<input name="_csrf">` present in form |
| 94 | View page source on admin login | Hidden `<input name="_csrf">` present in form |
| 95 | View page source on forgot-password | Hidden `<input name="_csrf">` present in form |
| 96 | View page source on resend-verification | Hidden `<input name="_csrf">` present in form |
| 97 | View page source on reset-password | Hidden `<input name="_csrf">` present in form |
| 98 | Navbar logout form (public) | Hidden `<input name="_csrf">` present |
| 99 | Navbar logout form (admin) | Hidden `<input name="_csrf">` present |
| 100 | Admin user-form (create/edit) | Hidden `<input name="_csrf">` present |
| 101 | Admin user list toggle form | Hidden `<input name="_csrf">` present |
| 102 | Admin user list delete form | Hidden `<input name="_csrf">` present |
| 103 | Browser dev tools: remove _csrf from login form, submit | HTTP 403, Spanish error message, no login |
| 104 | Browser dev tools: remove _csrf from register form, submit | HTTP 403, Spanish error message, no account created |
| 105 | Browser dev tools: remove _csrf from logout form, submit | HTTP 403, session still active |
| 106 | Browser dev tools: remove _csrf from admin toggle, submit | HTTP 403, user status unchanged |
| 107 | Login normally (valid CSRF) | Works as before |
| 108 | Register normally (valid CSRF) | Works, pending registration created |
| 109 | Logout normally (valid CSRF) | Works, session destroyed |
| 110 | Admin toggle normally (valid CSRF) | Works, status toggled |
| 111 | CSRF token in URL | Should NOT appear in any URL query string |
| 112 | Open two tabs, submit form in each | Both submissions work (tokens synchronized per session) |
| 113 | Open login, then open another login in new tab | Both tabs get same CSRF token (session-bound) |
| 114 | 403 page loads with layout | Navbar, footer, CSS all present, message in Spanish |
| 115 | 403 page on mobile | Responsive, no horizontal overflow |

---

## Session Persistence (MySQL)

### Completed (HTTP integration validation)

| # | Action | Expected |
|---|--------|----------|
| 116 | Login via HTTP with valid credentials and CSRF token | `sessions` table row created in MySQL |
| 117 | Stop Node.js process | Server stops |
| 118 | Start Node.js process | "Sesiones: MySQL (persistentes)" in console |
| 119 | HTTP GET `/` with same session cookie | 200, authenticated navbar visible |
| 120 | HTTP POST logout with valid CSRF | 302 to `/auth/login`, session destroyed |
| 121 | HTTP GET `/admin` with old cookie after logout | 302 redirect to `/auth/login` |
| 122 | CSRF token works after restart | Valid form submission succeeds |

### Pending (manual browser validation)

| # | Action | Expected |
|---|--------|----------|
| 123 | Login through browser | Authenticated navigation visible |
| 124 | Stop Node.js, restart, refresh browser tab | User still authenticated, navbar shows name + logout |
| 125 | Login as admin via `/admin/login` in browser | Admin dashboard loads |
| 126 | Stop + restart, refresh `/admin` in browser | Admin still logged in |
| 127 | Logout after restart in browser | Session row removed, cookie cleared, `/admin` blocked |
| 128 | Submit form with CSRF after restart in browser | Works |

### Pending (failure-mode validation)

| # | Action | Expected |
|---|--------|----------|
| 129 | Stop MySQL or use invalid DB port, start nlSite | Startup fails safely with clear error |
| 130 | Restore valid config, restart | Normal startup resumes |

---

## Homepage + Auth Integration (Panel 1)

| # | Action | Expected |
|---|--------|----------|
| 131 | Open `/` as anonymous | Homepage loads, "Cuenta" nav link visible, no default navbar/footer |
| 132 | Open `/` as authenticated user | Homepage loads, user name visible, "Salir" button with CSRF, no admin link |
| 133 | Open `/` as admin | Homepage loads, "Admin" link visible, logout form with CSRF |
| 134 | Click "Cuenta" (anonymous) | Redirects to `/auth/login` |
| 135 | Click "Salir" (authenticated) | POST logout with CSRF, session destroyed, redirect to login |
| 136 | Open `/auth/login` while homepage exists | Login page has default navbar + footer, no homepage CSS/JS leakage |
| 137 | Open `/admin/login` while homepage exists | Admin login has navbar, no three.js/gsap/lenis loaded |
| 138 | Open 404 page | Navbar + footer present, styled error page |

---

## Panel 1 Visual Correction Checks

| # | Action | Expected |
|---|--------|----------|
| 139 | Verify helmet3d.js imports | Uses `import * as THREE from 'three'` (bare specifier via import map) |
| 140 | Verify GLTFLoader loads | `/vendor/three/examples/jsm/loaders/GLTFLoader.js` returns 200 |
| 141 | Verify three.module.js | `/vendor/three/build/three.module.js` returns 200 |
| 142 | Check logo CSS size | `.hero-logo { width: clamp(360px, 28vw, 480px) }` with `transform: scale(1.15)` |
| 143 | Check 3D stage CSS | `z-index: 2`, `min-height: clamp(500px, 56vw, 780px)`, `touch-action: pan-y` |
| 144 | Check navigation alignment | `.hero-nav { justify-self: end }` pushes nav to far right |
| 145 | Check CSP header | `script-src 'self' 'nonce-<random>'` — no global unsafe-inline in script-src |
| 146 | Check import map nonce | `<script type="importmap" nonce="...">` present in rendered HTML |
| 147 | Check external GLB URL | `https://storage.googleapis.com/ninjalab3d/casco.glb` in helmet3d.js |
| 148 | Check connect-src | `connect-src 'self' blob: https://storage.googleapis.com` in CSP |
| 149 | Browser: 3D helmet renders | Helmet visible, idle rotation active, drag rotation works |
| 150 | Browser: logo matches reference | Logo size visually matches `PaginaWeb.png` |
| 151 | Browser: no console errors | No CSP violation, no "Failed to resolve module specifier", no CORS errors |
| 152 | Browser: nav right-aligned | Navigation items aligned to far right, large gap from logo |
