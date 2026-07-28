/**
 * Phase 1A production save repair.
 *
 * Migration 17 correctly added Phase 1B fields, but an already-empty draft
 * remained empty because only metadata defaults were merged into content_json.
 * This migration fills only missing draft keys from the published snapshot.
 * Existing draft values always win and published snapshots are never changed.
 */
require('dotenv').config();
const pool = require('../config/db');
const {
  assertCmsSchemaReady,
  invalidateCmsSchemaReadiness,
} = require('../services/cmsSchemaReadinessService');

const HOME_SECTION_KEYS = Object.freeze(['hero', 'showcase', 'services']);

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeMissing(base, current) {
  const result = { ...(isPlainObject(base) ? base : {}) };
  for (const [key, value] of Object.entries(isPlainObject(current) ? current : {})) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? mergeMissing(result[key], value)
      : value;
  }
  return result;
}

async function repairSectionDrafts(connection) {
  const [rows] = await connection.query(
    `SELECT s.id, s.content_json, s.style_json,
            s.published_content_json, s.published_style_json
       FROM page_sections s
       INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = 'home' AND s.section_key IN (?, ?, ?)
      FOR UPDATE`,
    HOME_SECTION_KEYS
  );

  let repaired = 0;
  for (const row of rows) {
    const currentContent = parseJson(row.content_json);
    const currentStyle = parseJson(row.style_json);
    const content = mergeMissing(parseJson(row.published_content_json), currentContent);
    const style = mergeMissing(parseJson(row.published_style_json), currentStyle);
    const contentJson = JSON.stringify(content);
    const styleJson = Object.keys(style).length ? JSON.stringify(style) : null;
    const currentContentJson = JSON.stringify(currentContent);
    const currentStyleJson = Object.keys(currentStyle).length ? JSON.stringify(currentStyle) : null;

    if (contentJson !== currentContentJson || styleJson !== currentStyleJson) {
      await connection.query(
        'UPDATE page_sections SET content_json = ?, style_json = ? WHERE id = ?',
        [contentJson, styleJson, row.id]
      );
      repaired += 1;
    }
  }
  return repaired;
}

async function migrateCmsPhase1aSaveRepair() {
  invalidateCmsSchemaReadiness();
  await assertCmsSchemaReady(pool, { force: true });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const repaired = await repairSectionDrafts(connection);
    await connection.commit();
    invalidateCmsSchemaReadiness();
    return { repaired };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  migrateCmsPhase1aSaveRepair()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('CMS Phase 1A save repair migration failed:', error.message);
      await pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  HOME_SECTION_KEYS,
  parseJson,
  mergeMissing,
  repairSectionDrafts,
  migrateCmsPhase1aSaveRepair,
};
