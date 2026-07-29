/**
 * Phase 1C — Restore revision source tracing columns.
 *
 * Idempotent: checks column existence before ALTER.
 * Adds:
 *   - source_revision_id: links restore revisions back to their origin
 *   - actor_name: stores display name at time of action (survives user deletion)
 *   - actor_email: stores email at time of action
 */
async function migrate(db) {
  const [cols] = await db.query(`
    SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'content_revisions'
  `);
  const existing = new Set(cols.map(c => c.COLUMN_NAME));

  if (!existing.has('source_revision_id')) {
    await db.query(`
      ALTER TABLE content_revisions
        ADD COLUMN source_revision_id BIGINT NULL AFTER change_summary,
        ADD KEY idx_content_revisions_source (source_revision_id)
    `);
    console.log('[migrate-revision-source-id] Added source_revision_id.');
  } else {
    console.log('[migrate-revision-source-id] source_revision_id already exists.');
  }

  if (!existing.has('actor_name')) {
    await db.query(`
      ALTER TABLE content_revisions
        ADD COLUMN actor_name VARCHAR(120) NULL AFTER changed_by
    `);
    console.log('[migrate-revision-source-id] Added actor_name.');
  } else {
    console.log('[migrate-revision-source-id] actor_name already exists.');
  }

  if (!existing.has('actor_email')) {
    await db.query(`
      ALTER TABLE content_revisions
        ADD COLUMN actor_email VARCHAR(180) NULL AFTER actor_name
    `);
    console.log('[migrate-revision-source-id] Added actor_email.');
  } else {
    console.log('[migrate-revision-source-id] actor_email already exists.');
  }
}

module.exports = { migrate };
