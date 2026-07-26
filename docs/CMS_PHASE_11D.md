# CMS Phase 11D — Publicación centralizada, historial y restauración

## Resumen

Fase 11D implementa publicación centralizada con lotes atómicos, historial de revisiones navegable, comparación entre revisiones y restauración segura para todos los módulos CMS.

## Módulos del registry

| Key | Label | Fuente | Dependencias |
|-----|-------|--------|-------------|
| `navbar` | Navbar y branding | navigation_items + site_settings | Ninguna |
| `home.hero` | Panel 1 — Hero | page_sections (home/hero) | Ninguna |
| `home.showcase` | Panel 2 — Contenido general | page_sections (home/showcase) | Ninguna |
| `home.logoLoop` | Panel 2 — LogoLoop | logo_loop_items | home.showcase |
| `home.carousel` | Panel 2 — Carrusel | home_carousel_items | home.showcase |
| `home.services` | Panel 3 — General | page_sections (home/services) | Ninguna |
| `home.features` | Panel 3 — Tarjetas | home_feature_items | home.services |

## Publicación atómica

- `POST /admin/page/publishing/publish-selected` — publica módulos seleccionados en una transacción
- `POST /admin/page/publishing/publish-home` — publica todos los módulos atómicamente
- Cada publicación crea un `publication_batch` con `publication_batch_items`
- Fallo en cualquier módulo → rollback completo del lote
- Caché invalidada solo después del commit exitoso
- Cada publish registra revisiones con action=`replace`

## Historial de revisiones

- `GET /admin/page/history` — lista paginada con filtros por módulo y acción
- `GET /admin/page/history/revision/:id` — detalle con cambios campo por campo
- `GET /admin/page/history/compare?from=X&to=Y` — comparación entre dos revisiones
- Cambios mostrados como diferencias legibles (campo: anterior → nuevo)
- JSON escapa `<` y `>` para prevenir inyección HTML

## Restauración

- `GET /admin/page/history/revision/:id/restore` — vista de confirmación
- `POST /admin/page/history/revision/:id/restore` — ejecuta restauración
- `publish=0` → restaurar como borrador (no afecta contenido público)
- `publish=1` → restaurar y publicar (crea lote de publicación)
- La revisión histórica original nunca se modifica
- La restauración crea una nueva revisión con action=`restore`

## Permisos (Capabilities)

| Capability | Acceso |
|------------|--------|
| `cms.publishing.view` | Ver dashboard de publicación |
| `cms.publishing.publish` | Ejecutar publicación |
| `cms.history.view` | Ver historial de revisiones |
| `cms.history.compare` | Comparar revisiones |
| `cms.history.restoreDraft` | Restaurar como borrador |
| `cms.history.restorePublish` | Restaurar y publicar |

Todos mapean a `role_id = 1` (admin).

## Invalidadción de caché

Módulo → namespaces:
- navbar: `siteSettings`, `nav_home`
- hero/showcase/services: `sc_home`
- logoLoop: `logoLoop_home`
- carousel: `carousel_home`
- features: `features_home`

Invalidación por prefijo. Solo después de commit en publicación exitosa.
Limitación: caché en memoria, instancia única (sin Redis).

## Concurrencia

- `SELECT ... FOR UPDATE` en page_sections durante publicación
- Transacción completa con rollback en fallo
- Dos publicaciones simultáneas serializadas por locks de fila

## Migración

```bash
node scripts/migrate-publishing.js
```

Crea `publication_batches` y `publication_batch_items`. Idempotente.

## Pruebas

75 pruebas en `tests/cms-phase11d.test.js`:
- 6 migración/esquema
- 3 registry
- 2 capabilities
- 7 servicio de publicación
- 4 controlador/rutas
- 6 compilación EJS
- 5 historial
- 5 comparación
- 10 restauración
- 2 preview
- 4 caché
- 2 concurrencia
- 3 autorización
- 10 regresión
- 1 CSS

## Limitaciones conocidas

- Caché en memoria de instancia única
- Comparación no resuelve referencias `media://` a nombres legibles de assets
- Sin preview por módulo individual (solo borrador completo)
- Restauración de colecciones restaura estado completo, no items individuales
- Sin bloqueo de publicación a nivel de módulo (solo row-level locking)
