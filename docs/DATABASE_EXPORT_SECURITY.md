# Exportación segura de la base de datos

Los respaldos y exportaciones de este proyecto deben tratarse como datos privados. No deben versionarse ni compartirse desde el repositorio.

- Guarda archivos de exportación únicamente en directorios locales ignorados, como `database-dumps/` o `backups/`.
- Excluye datos de la tabla de sesiones. Si una herramienta exige incluirla, exporta solamente su estructura, nunca sus filas.
- No incluyas archivos `.env`, credenciales, secretos, hashes de tokens ni datos personales innecesarios.
- Prefiere una exportación de estructura para revisión técnica. Cuando se necesiten datos, usa un conjunto anonimizado y mínimo.
- Después de compartir accidentalmente una exportación con sesiones, invalida todas las sesiones y rota cualquier secreto o credencial potencialmente expuesto.
- Revisa el contenido y el estado de Git antes de mover o adjuntar una exportación.

La aplicación no necesita exportaciones SQL para ejecutar las migraciones: usa los scripts idempotentes incluidos en `scripts/` contra el entorno autorizado.

Las tablas `gallery_categories` y `gallery_items` contienen únicamente metadatos y rutas públicas controladas. Los archivos de galería no forman parte de una exportación SQL: deben respaldarse por separado desde `public/uploads/gallery/`, manteniendo sus rutas relativas y sin copiar otros directorios de carga o almacenamiento privado. Nunca reemplaces rutas relativas por rutas absolutas del servidor dentro de una exportación.
