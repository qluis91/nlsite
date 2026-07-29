/**
 * Migration 21 — Store Hero CMS
 * Additive, idempotent. Creates tienda page + st-hero section if missing.
 * Backfills draft/published content from hardcoded defaults.
 * Run: node scripts/migrate-store-hero-cms.js
 */
require('dotenv').config();
const pool = require('../config/db');

const DEFAULT_HERO = {
  eyebrow: 'Tienda NinjaLabCR',
  title: 'Ideas creadas en 3D',
  description: 'Descubre productos impresos, diseñados y personalizados por NinjaLabCR en Costa Rica.',
  imageUrl: '/images/LogoCompleto.png',
  imageAlt: 'NinjaLabCR — Impresión y diseño 3D',
  imagePosition: 'center',
  primaryLabel: '',
  primaryUrl: '',
  buttonTarget: '_self',
  isVisible: true,
};

async function migrateStoreHeroCms() {
  const conn = await pool.getConnection();
  try {
    // 1. Ensure the tienda page row exists
    await conn.query(
      `INSERT INTO pages (page_key, name, slug, status)
       SELECT 'tienda', 'Tienda', 'tienda', 'active'
        WHERE NOT EXISTS (SELECT 1 FROM pages WHERE page_key = 'tienda')`
    );
    const [[page]] = await conn.query('SELECT id FROM pages WHERE page_key = ? LIMIT 1', ['tienda']);
    if (!page) throw new Error('No fue posible preparar la página "tienda".');

    // 2. Ensure the st-hero section exists
    const contentJson = JSON.stringify({
      eyebrow: DEFAULT_HERO.eyebrow,
      title: DEFAULT_HERO.title,
      description: DEFAULT_HERO.description,
      backgroundMedia: '',
      imageAlt: DEFAULT_HERO.imageAlt,
      imagePosition: DEFAULT_HERO.imagePosition,
      primaryLabel: DEFAULT_HERO.primaryLabel,
      primaryUrl: DEFAULT_HERO.primaryUrl,
      buttonTarget: DEFAULT_HERO.buttonTarget,
      ariaLabel: '',
      isVisible: DEFAULT_HERO.isVisible,
    });
    const styleJson = JSON.stringify({});

    await conn.query(
      `INSERT INTO page_sections (page_id, section_key, name, content_json, style_json,
          published_content_json, published_style_json, sort_order, is_enabled, status, version)
       SELECT ?, 'st-hero', 'Hero de Tienda', ?, ?, ?, ?, 90, 1, 'published', 1
        WHERE NOT EXISTS (
          SELECT 1 FROM page_sections WHERE page_id = ? AND section_key = 'st-hero'
        )`,
      [page.id, contentJson, styleJson, contentJson, styleJson, page.id]
    );

    // 3. If the section already exists but has no published content, backfill
    await conn.query(
      `UPDATE page_sections
          SET published_content_json = content_json,
              published_style_json = style_json,
              status = 'published', is_enabled = 1
        WHERE page_id = ? AND section_key = 'st-hero'
          AND (published_content_json IS NULL OR published_content_json = 'null')`,
      [page.id]
    );

    console.log('✅ Store hero CMS migration complete.');
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  migrateStoreHeroCms()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Store hero CMS migration failed:', error.message);
      await pool.end();
      process.exitCode = 1;
    });
}

module.exports = { migrate: migrateStoreHeroCms, migrateStoreHeroCms };
