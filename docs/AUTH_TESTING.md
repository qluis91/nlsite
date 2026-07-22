# Manual Authentication Testing Checklist

Use this checklist to manually verify every authentication flow from the browser.

**Prerequisites:**
- Server running: `npm run dev`
- MySQL connected
- Test users exist (create via registration form or admin panel)

---

## Public Navigation

| # | Action | URL | Expected |
|---|--------|-----|----------|
| 1 | Open home page | `/` | 200, `<!DOCTYPE html>`, site name, navbar with "Iniciar Sesión" + "Registrarse", footer visible |
| 2 | Page source has `<html>` and `<head>` | Any page | Full HTML document with CSS link, not a raw fragment |
| 2 | Click "Iniciar Sesión" | `/auth/login` | Login form with email, password, "Ingresar", link to register |
| 3 | Click "Registrarse" | `/auth/register` | Registration form with name, email, password, confirm |
| 4 | Admin link visible on login | `/auth/login` | "¿Eres administrador? Accede al panel administrativo" links to `/admin/login` |
| 5 | Admin login page loads | `/admin/login` | "Acceso Administrativo" badge, form, links back to user login and home |

---

## User Registration

| # | Action | Expected |
|---|--------|----------|
| 6 | Submit empty form | "Todos los campos son obligatorios." |
| 7 | Password mismatch | "Las contraseñas no coinciden." Form preserves name and email, clears passwords |
| 8 | Password < 6 chars | "La contraseña debe tener al menos 6 caracteres." |
| 9 | Valid registration | "Cuenta creada correctamente. Ya puedes iniciar sesión." Redirected to `/auth/login` |
| 10 | Duplicate email | "Ya existe una cuenta registrada con ese correo electrónico." |

---

## User Login

| # | Action | Expected |
|---|--------|----------|
| 11 | Submit empty form | "Todos los campos son obligatorios." |
| 12 | Invalid password | "Correo electrónico o contraseña incorrectos." |
| 13 | Non-existent email | "Correo electrónico o contraseña incorrectos." |
| 14 | Valid user login | "¡Bienvenido, [name]!" Redirected to `/` |
| 15 | After login, navbar shows | User name + "Cerrar Sesión" |
| 16 | Inactive user attempts login | "Correo electrónico o contraseña incorrectos." (generic, no status leak) |
| 17 | User visits `/admin` | "Acceso denegado. Se requieren permisos de administrador." Redirected to `/` |
| 18 | Click "Cerrar Sesión" (POST form) | 302 redirect to `/auth/login`, session cookie cleared |
| 19 | After logout, navbar shows | "Iniciar Sesión" + "Registrarse" (logged-out state) |
| 20 | After logout, refresh home | Still logged out, no session restored |
| 21 | After logout, visit `/admin` | 302 redirect to `/auth/login` |

---

## Administrator Login

| # | Action | Expected |
|---|--------|----------|
| 19 | Open `/admin/login` | Form with "Administración" badge, "Acceso Administrativo" title |
| 20 | Empty fields submit | "Credenciales administrativas inválidas." |
| 21 | Normal user credentials | "Credenciales administrativas inválidas." (generic message) |
| 22 | Inactive admin credentials | "Credenciales administrativas inválidas." (generic, no status leak) |
| 23 | Invalid admin password | "Credenciales administrativas inválidas." |
| 24 | Valid admin login | "¡Bienvenido, [name]!" Redirected to `/admin` (dashboard) |
| 25 | After login, navbar shows | "Panel Admin" + user name + "Cerrar Sesión" |
| 26 | Dashboard shows active-users stat | "Usuarios Activos" counter visible |
| 27 | Already-logged-in admin visits `/admin/login` | Redirected to `/admin` |
| 28 | Admin visits `/admin/users` | User list with Estado column, toggle and delete buttons |
| 29 | Admin deactivates a normal user | Status changes to "Inactivo" badge |
| 30 | Admin reactivates user | Status changes to "Activo" badge |
| 31 | Admin user form has is_active checkbox | Checkbox visible on create and edit forms |
| 32 | Admin logout | `Cerrar Sesión` → redirected to `/auth/login` |

---

## Route Protection

| # | Action | Expected |
|---|--------|----------|
| 33 | Unauthenticated → `/admin` | 302 → `/auth/login` |
| 34 | Unauthenticated → `/admin/users` | 302 → `/auth/login` |
| 35 | Normal user (logged in) → `/admin` | "Acceso denegado" → redirect to `/` |
| 36 | Normal user → `/admin/users` | "Acceso denegado" → redirect to `/` |
| 37 | Admin → `/admin/*` | All admin pages accessible |

---

## Error Pages

| # | Action | Expected |
|---|--------|----------|
| 38 | Unknown URL `/whatever` | 404 page with "La página que buscas no existe" + link to home |

---

## Security Checks

| # | Action | Expected |
|---|--------|----------|
| 39 | View page source on login | No admin credentials, no passwords visible |
| 40 | Admin login page source | No hints about admin email or password |
| 41 | Rapid user login attempts (6th POST) | Rate limited: "Demasiados intentos..." |
| 42 | Rapid admin login attempts (6th POST) | Rate limited: "Demasiados intentos..." |
| 43 | View page source anywhere | No default credentials or passwords exposed |
| 44 | GET `/auth/logout` | Returns 404, logout requires POST |
| 45 | Logout does not trigger rate limiter | 10 rapid logouts still allow normal browsing |
| 46 | Browser dev tools: logout POST | Method is POST, response is 302, Set-Cookie clears `connect.sid` |
