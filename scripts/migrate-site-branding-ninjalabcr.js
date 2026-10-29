/**
 * Forward data migration — normalize placeholder site branding to NinjaLabCR.
 *
 * Only replaces exact known placeholders in global.site_name draft/published
 * values. Custom brand names are left untouched. Idempotent.
 */
const defaultPool = require('../config/db');

const PLACEHOLDERS = Object.freeze(['Mi Sitio', 'Mi Sitio Web', 'NinjaLab CR']);
const CANONICAL = 'NinjaLabCR';
const SETTING_KEY = 'global.site_name';

async function migrateSiteBrandingNinjaLabCR(pool = defaultPool) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    try {
      const [rows] = await connection.query(
        `SELECT id, setting_value, published_value
           FROM site_settings
          WHERE setting_key = ?
          FOR UPDATE`,
        [SETTING_KEY]
      );

      for (const row of rows) {
        const nextDraft = PLACEHOLDERS.includes(row.setting_value)
          ? CANONICAL
          : row.setting_value;
        const nextPublished = PLACEHOLDERS.includes(row.published_value)
          ? CANONICAL
          : row.published_value;

        if (nextDraft === row.setting_value && nextPublished === row.published_value) {
          continue;
        }

        await connection.query(
          `UPDATE site_settings
              SET setting_value = ?, published_value = ?
            WHERE id = ?`,
          [nextDraft, nextPublished, row.id]
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  migrateSiteBrandingNinjaLabCR()
    .then(() => defaultPool.end())
    .then(() => console.log('Site branding NinjaLabCR migration complete.'))
    .catch(async (error) => {
      console.error(`[${error.code || 'MIGRATION_ERROR'}] ${error.message}`);
      await defaultPool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  PLACEHOLDERS,
  CANONICAL,
  migrateSiteBrandingNinjaLabCR,
};
