# Phase 11B — CMS: Navbar y Panel 1 (Hero)

## Resumen

Se implementaron los paneles de administración para la barra de navegación (navbar), branding global y Panel 1 (Hero) de la página de inicio, dentro del módulo "Administrar página".

## Rutas nuevas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/admin/page/navbar` | Editor de navbar y branding |
| POST | `/admin/page/navbar/save` | Guardar borrador de configuración del navbar |
| POST | `/admin/page/navbar/publish` | Publicar enlaces de navegación |
| POST | `/admin/page/navbar/items` | Crear nuevo enlace de navegación |
| POST | `/admin/page/navbar/items/save` | Editar enlace de navegación |
| POST | `/admin/page/navbar/items/archive` | Archivar enlace de navegación |
| POST | `/admin/page/navbar/items/reorder` | Reordenar enlaces de navegación |
| GET | `/admin/page/home/panel-1` | Editor del Panel 1 (Hero) |
| POST | `/admin/page/home/panel-1/save` | Guardar borrador del Panel 1 |
| POST | `/admin/page/home/panel-1/publish` | Publicar Panel 1 |
| GET | `/admin/page/home/panel-1/preview` | Vista previa (admin) |

## Tabla nueva: navigation_items

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INT AUTO_INCREMENT PRIMARY KEY | Identificador interno |
| `public_id` | CHAR(36) NOT NULL | UUID estable para URLs y referencias |
| `location` | VARCHAR(40) NOT NULL | `home` o `global` |
| `parent_id` | INT NULL | Auto-referencia para futuros submenús |
| `label` | VARCHAR(100) NOT NULL | Etiqueta del enlace |
| `url` | VARCHAR(500) NOT NULL | URL interna/externa |
| `link_type` | VARCHAR(20) NOT NULL | `internal` o `external` |
| `target` | VARCHAR(20) NOT NULL | `_self` o `_blank` |
| `media_public_id` | CHAR(36) NULL | Referencia `media://` para ícono opcional |
| `sort_order` | INT NOT NULL | Orden de visualización |
| `is_visible` | TINYINT(1) NOT NULL | Visibilidad |
| `status` | VARCHAR(20) NOT NULL | `draft`, `published` o `archived` |
| `created_by` | INT NULL | FK → users(id) |
| `updated_by` | INT NULL | FK → users(id) |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |
| `deleted_at` | DATETIME NULL | Soft delete |

## Claves de site_settings (navbar)

| Clave | Tipo |
|-------|------|
| `site.logo_primary` | media |
| `site.logo_light` | media |
| `site.logo_dark` | media |
| `site.favicon` | media |
| `navbar.bg_color` | string (#RRGGBB) |
| `navbar.text_color` | string (#RRGGBB) |
| `navbar.accent_color` | string (#RRGGBB) |
| `navbar.border_color` | string (#RRGGBB) |
| `navbar.opacity` | number (0-1) |
| `navbar.logo_width` | number (40-500 px) |

## Esquema JSON del Panel 1 (content_json)

```json
{
  "eyebrow": "string (max 120)",
  "heading": "string (max 180, required)",
  "description": "string (max 1000)",
  "primaryButton": { "label": "string (max 80)", "url": "string", "target": "_self|_blank", "visible": true|false },
  "secondaryButton": { "label": "string (max 80)", "url": "string", "target": "_self|_blank", "visible": true|false },
  "backgroundMedia": "media://uuid|null",
  "modelMedia": "media://uuid|null",
  "modelFallbackMedia": "media://uuid|null",
  "modelEnabled": true|false
}
```

## Esquema JSON del Panel 1 (style_json)

```json
{
  "model": {
    "scale": "number (0.1-5)",
    "position": { "x": "number (-10-10)", "y": "number (-10-10)", "z": "number (-10-10)" },
    "rotation": { "x": "number (-6.283-6.283)", "y": "number (-6.283-6.283)", "z": "number (-6.283-6.283)" },
    "autoRotate": "boolean",
    "autoRotateSpeed": "number (0-5)"
  }
}
```

## Límites de validación

- eyebrow: 120 caracteres
- heading: 180 caracteres
- description: 1000 caracteres
- botón label: 80 caracteres
- nav item label: 100 caracteres
- escala modelo: 0.1–5
- posición X/Y/Z: -10–10
- rotación X/Y/Z: -6.283–6.283 (2π)
- velocidad auto-rotación: 0–5
- opacidad navbar: 0–1
- ancho logo: 40–500 px

## Flujo draft/publicar

1. Guardar → estado `draft` (no visible en sitio público)
2. Vista previa → admin autenticado ve borrador (banner, noindex, no-cache)
3. Publicar → estado `published` (visible en sitio), crea revisión, invalida caché
4. Si no hay contenido publicado → fallback a hardcoded actual

## Integración Three.js

- Configuración del modelo se lee desde `data-*` attributes en `[data-home-page]`
- `data-model-url` — URL del GLB desde CMS (reemplaza hardcoded)
- `data-model-config` — JSON serializado con scale/position/rotation/autoRotate
- Modelo deshabilitado vía CMS: `data-model-disabled="1"` muestra fallback
- Un solo renderer/canvas/RAF, mismo ciclo de pausa/resume entre paneles
- Fallback del modelo: imagen CMS o ícono por defecto

## Caché

- Caché en memoria (simple Map), invalidación por namespace
- Namespaces: `siteSettings`, `nav_home`, `sc_home`
- La publicación invalida el namespace relevante
- Borradores nunca contaminan la caché pública
- Vista previa omite caché

## Uso de medios (media usage)

- `navigation_items` registrado como fuente de uso (`media_public_id`)
- `site_settings` ya trackea logos/favicon
- `page_sections` ya trackea `content_json`/`style_json`
- Archivar un medio referenciado sigue bloqueado

## Capacidades

Nuevas capacidades (mapeadas a admin role_id=1):

- `navbar.view`, `navbar.edit`, `navbar.publish`
- `home.hero.view`, `home.hero.edit`, `home.hero.publish`

## Limitaciones

- Sin drag-and-drop (usa controles up/down y sort_order)
- Sin submenús (parent_id existe pero sin UI)
- Sin rollback UI completa (revisiones se escriben pero no hay interfaz gráfica)
- Caché en memoria — multi-instancia/reinicio pierde caché (aceptable)
- Sin selector visual de medios (se usa ID manual o copia desde biblioteca)

## Migración

```bash
node scripts/migrate-nav-items.js
```

Idempotente. Crea tabla `navigation_items` y siembra enlaces actuales solo si `location = 'home'` está vacío.
