/**
 * Migration 25 — Homepage Social Feed section settings (Phase 2B).
 * Additive and idempotent. Reuses page_sections; no new table or column.
 */
require('dotenv').config();
const defaultPool = require('../config/db');

const DEFAULT_CONTENT = Object.freeze({
  enabled: true,
  title: 'NinjaLab en redes',
  subtitle: 'Ideas, procesos y proyectos compartidos desde nuestros canales oficiales.',
  maximumPosts: 6,
  featuredOnly: false,
  platforms: ['instagram', 'facebook', 'tiktok', 'youtube', 'other'],
  displayOrder: 'manual',
});

async function migrateSocialFeedHomeSection(pool = defaultPool) {
  const [[home]] = await pool.query(
    "SELECT id FROM pages WHERE page_key = 'home' LIMIT 1"
  );
  if (!home) {
    throw new Error('Homepage CMS row is required before migration 25.');
  }

  const [[existing]] = await pool.query(
    "SELECT id FROM page_sections WHERE page_id = ? AND section_key = 'social-feed' LIMIT 1",
    [home.id]
  );
  if (existing) return;

  const [[orderRow]] = await pool.query(
    'SELECT COALESCE(MAX(sort_order) + 1, 40) AS next_order FROM page_sections WHERE page_id = ?',
    [home.id]
  );
  const content = JSON.stringify(DEFAULT_CONTENT);
  await pool.query(
    `INSERT INTO page_sections
       (page_id, section_key, name, content_json, style_json, sort_order,
        is_enabled, status, version, published_content_json, published_style_json, published_at)
     VALUES (?, 'social-feed', 'NinjaLab en redes', ?, '{}', ?,
             1, 'published', 1, ?, '{}', NOW())`,
    [home.id, content, Number(orderRow.next_order) || 40, content]
  );
}

if (require.main === module) {
  migrateSocialFeedHomeSection()
    .then(() => defaultPool.end())
    .catch(async (error) => {
      console.error('Social Feed homepage section migration failed:', error.message);
      await defaultPool.end();
      process.exitCode = 1;
    });
}

module.exports = { DEFAULT_CONTENT, migrateSocialFeedHomeSection };
