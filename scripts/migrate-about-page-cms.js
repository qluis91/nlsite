/**
 * Migration 23 — CMS-managed "Nosotros" page.
 * Additive and idempotent: it seeds one page_section with independent draft
 * and published snapshots and ensures the existing CMS navbar points to it.
 */
require('dotenv').config();
const defaultPool = require('../config/db');

const DEFAULT_ABOUT_CONTENT = Object.freeze({
  isVisible: true,
  hero: {
    eyebrow: 'NinjaLab',
    title: 'Nosotros',
    description: 'Este contenido es editable desde el panel administrativo.',
    media: '',
    alt: '',
  },
  sections: [
    { key: 'history', heading: 'Historia', text: 'Agrega aquí la historia de NinjaLab.', media: '', alt: '', visible: true, order: 10 },
    { key: 'mission', heading: 'Misión y enfoque', text: 'Describe aquí la misión y el enfoque de trabajo.', media: '', alt: '', visible: true, order: 20 },
    { key: 'capabilities', heading: 'Servicios y capacidades', text: 'Presenta aquí los servicios y capacidades disponibles.', media: '', alt: '', visible: true, order: 30 },
    { key: 'values', heading: 'Valores', text: 'Explica aquí los valores que orientan el trabajo.', media: '', alt: '', visible: true, order: 40 },
    { key: 'process', heading: 'Proceso de trabajo', text: 'Describe aquí las etapas del proceso de trabajo.', media: '', alt: '', visible: true, order: 50 },
  ],
  cta: {
    heading: 'Hablemos de tu proyecto',
    text: 'Edita este llamado a la acción desde el panel administrativo.',
    label: 'Contactar',
    url: '/#contacto',
    target: '_self',
    visible: true,
  },
  seo: {
    title: 'Nosotros | NinjaLab CR',
    description: 'Conoce la página editable de información sobre NinjaLab CR.',
    canonical: '/nosotros',
    ogMedia: '',
  },
  accessibility: { ariaLabel: 'Página Nosotros' },
});

async function migrateAboutPageCms(db = defaultPool) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO pages (page_key, name, slug, status)
       SELECT 'nosotros', 'Nosotros', 'nosotros', 'active'
        WHERE NOT EXISTS (SELECT 1 FROM pages WHERE page_key = 'nosotros')`
    );
    const [[page]] = await connection.query(
      'SELECT id FROM pages WHERE page_key = ? LIMIT 1',
      ['nosotros']
    );
    if (!page) throw new Error('No fue posible preparar la página "nosotros".');

    const contentJson = JSON.stringify(DEFAULT_ABOUT_CONTENT);
    const styleJson = '{}';
    await connection.query(
      `INSERT INTO page_sections (
         page_id, section_key, name, content_json, style_json,
         published_content_json, published_style_json,
         sort_order, is_enabled, status, version
       )
       SELECT ?, 'about-content', 'Página Nosotros', ?, ?, ?, ?, 100, 1, 'published', 1
        WHERE NOT EXISTS (
          SELECT 1 FROM page_sections
           WHERE page_id = ? AND section_key = 'about-content'
        )`,
      [page.id, contentJson, styleJson, contentJson, styleJson, page.id]
    );
    await connection.query(
      `UPDATE page_sections
          SET published_content_json = content_json,
              published_style_json = style_json,
              status = 'published',
              is_enabled = 1
        WHERE page_id = ? AND section_key = 'about-content'
          AND (published_content_json IS NULL OR published_content_json = 'null')`,
      [page.id]
    );

    const [aboutItems] = await connection.query(
      `SELECT id, label, url, target, parent_id, media_public_id, sort_order, is_visible
         FROM navigation_items
        WHERE location = 'home' AND deleted_at IS NULL
          AND (url = '/nosotros' OR LOWER(label) = 'nosotros')
        ORDER BY id ASC`
    );
    if (aboutItems.length) {
      const item = aboutItems[0];
      const published = JSON.stringify({
        label: item.label || 'Nosotros',
        url: '/nosotros',
        link_type: 'internal',
        target: item.target === '_blank' ? '_blank' : '_self',
        parent_id: item.parent_id || null,
        media_public_id: item.media_public_id || null,
        sort_order: Number(item.sort_order) || 4,
        is_visible: true,
      });
      await connection.query(
        `UPDATE navigation_items
            SET url = '/nosotros', link_type = 'internal', is_visible = 1,
                status = 'published', published_data = ?, published_at = NOW()
          WHERE id = ?`,
        [published, item.id]
      );
    } else {
      const [[orderRow]] = await connection.query(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM navigation_items WHERE location = 'home'"
      );
      const sortOrder = Number(orderRow.next_order) || 1;
      const published = JSON.stringify({
        label: 'Nosotros',
        url: '/nosotros',
        link_type: 'internal',
        target: '_self',
        parent_id: null,
        media_public_id: null,
        sort_order: sortOrder,
        is_visible: true,
      });
      await connection.query(
        `INSERT INTO navigation_items (
           public_id, location, label, url, link_type, target, sort_order,
           is_visible, status, published_data, published_at
         ) VALUES (UUID(), 'home', 'Nosotros', '/nosotros', 'internal', '_self', ?, 1, 'published', ?, NOW())`,
        [sortOrder, published]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  migrateAboutPageCms()
    .then(async () => {
      console.log('✅ Migración CMS de Nosotros completada.');
      await defaultPool.end();
    })
    .catch(async (error) => {
      console.error('Falló la migración CMS de Nosotros:', error.message);
      await defaultPool.end();
      process.exitCode = 1;
    });
}

module.exports = { DEFAULT_ABOUT_CONTENT, migrate: migrateAboutPageCms, migrateAboutPageCms };
