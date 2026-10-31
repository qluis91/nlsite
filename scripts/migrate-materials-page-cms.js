/**
 * Migration — CMS-managed "Materiales" page (/materiales).
 * Additive and idempotent: seeds page_section materials-content and navbar item.
 * Does NOT overwrite existing edited draft/published content on re-run.
 */
require('dotenv').config();
const defaultPool = require('../config/db');

const DEFAULT_MATERIALS_CONTENT = Object.freeze({
  isVisible: true,
  hero: {
    eyebrow: '',
    title: 'Nuestros Materiales',
    description:
      'Cada proyecto es único, y elegir el material correcto es clave para el éxito. Aquí te presentamos nuestras opciones.',
  },
  items: Object.freeze([
    Object.freeze({
      id: 'pla',
      title: 'PLA (Ácido Poliláctico)',
      icon: 'atom',
      description:
        'El material más popular y fácil de usar. Es biodegradable, no tóxico y perfecto para prototipos rápidos, figuras decorativas y artículos que no requieren alta resistencia mecánica o térmica.',
      pros: Object.freeze(['Fácil de imprimir', 'Biodegradable', 'Variedad de colores']),
      cons: Object.freeze(['Baja resistencia al calor', 'Frágil']),
      visible: true,
      order: 10,
    }),
    Object.freeze({
      id: 'abs',
      title: 'ABS (Acrilonitrilo Butadieno Estireno)',
      icon: 'temperature',
      description:
        'Conocido por su durabilidad, robustez y resistencia a altas temperaturas. Ideal para piezas funcionales, carcasas de electrónicos y partes de automóviles.',
      pros: Object.freeze(['Alta resistencia', 'Duradero', 'Resistente al calor']),
      cons: Object.freeze(['Requiere cama caliente', 'Emite olores']),
      visible: true,
      order: 20,
    }),
    Object.freeze({
      id: 'petg',
      title: 'PETG (Glicol de Tereftalato de Polietileno)',
      icon: 'shield',
      description:
        'Combina la facilidad de impresión del PLA con la resistencia del ABS. Es fuerte, duradero y resistente a los químicos.',
      pros: Object.freeze(['Fuerte y flexible', 'Resistente a químicos', 'Baja contracción']),
      cons: Object.freeze(['Propenso al stringing', 'Más abrasivo']),
      visible: true,
      order: 30,
    }),
    Object.freeze({
      id: 'resina',
      title: 'Resina',
      icon: 'droplet',
      description:
        'Ofrece un nivel de detalle y un acabado superficial inigualables. Perfecta para miniaturas, joyería y aplicaciones donde la precisión y la estética son cruciales.',
      pros: Object.freeze(['Detalle excepcional', 'Acabado liso', 'Variedades especializadas']),
      cons: Object.freeze(['Post-procesado requerido', 'Más costosa y tóxica']),
      visible: true,
      order: 40,
    }),
  ]),
  seo: Object.freeze({
    title: 'Materiales | NinjaLabCR',
    description:
      'Conoce los materiales disponibles para impresión 3D en NinjaLabCR y sus principales ventajas y desventajas.',
    canonical: '/materiales',
    ogMedia: '',
  }),
  accessibility: Object.freeze({ ariaLabel: 'Materiales de impresión 3D' }),
});

async function migrateMaterialsPageCms(db = defaultPool) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO pages (page_key, name, slug, status)
       SELECT 'materiales', 'Materiales', 'materiales', 'active'
        WHERE NOT EXISTS (SELECT 1 FROM pages WHERE page_key = 'materiales')`
    );
    const [[page]] = await connection.query(
      'SELECT id FROM pages WHERE page_key = ? LIMIT 1',
      ['materiales']
    );
    if (!page) throw new Error('No fue posible preparar la página "materiales".');

    const contentJson = JSON.stringify(DEFAULT_MATERIALS_CONTENT);
    const styleJson = '{}';
    await connection.query(
      `INSERT INTO page_sections (
         page_id, section_key, name, content_json, style_json,
         published_content_json, published_style_json,
         sort_order, is_enabled, status, version
       )
       SELECT ?, 'materials-content', 'Página Materiales', ?, ?, ?, ?, 100, 1, 'published', 1
        WHERE NOT EXISTS (
          SELECT 1 FROM page_sections
           WHERE page_id = ? AND section_key = 'materials-content'
        )`,
      [page.id, contentJson, styleJson, contentJson, styleJson, page.id]
    );
    await connection.query(
      `UPDATE page_sections
          SET published_content_json = content_json,
              published_style_json = style_json,
              status = 'published',
              is_enabled = 1
        WHERE page_id = ? AND section_key = 'materials-content'
          AND (published_content_json IS NULL OR published_content_json = 'null')`,
      [page.id]
    );

    const [navItems] = await connection.query(
      `SELECT id, label, url, target, parent_id, media_public_id, sort_order, is_visible
         FROM navigation_items
        WHERE location = 'home' AND deleted_at IS NULL
          AND (url = '/materiales' OR LOWER(label) = 'materiales')
        ORDER BY id ASC`
    );
    if (navItems.length) {
      const item = navItems[0];
      const published = JSON.stringify({
        label: item.label || 'Materiales',
        url: '/materiales',
        link_type: 'internal',
        target: item.target === '_blank' ? '_blank' : '_self',
        parent_id: item.parent_id || null,
        media_public_id: item.media_public_id || null,
        sort_order: Number(item.sort_order) || 35,
        is_visible: true,
      });
      await connection.query(
        `UPDATE navigation_items
            SET url = '/materiales', link_type = 'internal', is_visible = 1,
                status = 'published', published_data = ?, published_at = NOW()
          WHERE id = ?`,
        [published, item.id]
      );
    } else {
      const [[orderRow]] = await connection.query(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM navigation_items WHERE location = 'home'"
      );
      const sortOrder = Number(orderRow.next_order) || 35;
      const published = JSON.stringify({
        label: 'Materiales',
        url: '/materiales',
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
         ) VALUES (UUID(), 'home', 'Materiales', '/materiales', 'internal', '_self', ?, 1, 'published', ?, NOW())`,
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
  migrateMaterialsPageCms()
    .then(async () => {
      console.log('✅ Migración CMS de Materiales completada.');
      await defaultPool.end();
    })
    .catch(async (error) => {
      console.error('Falló la migración CMS de Materiales:', error.message);
      await defaultPool.end();
      process.exitCode = 1;
    });
}

module.exports = { migrateMaterialsPageCms, DEFAULT_MATERIALS_CONTENT };
