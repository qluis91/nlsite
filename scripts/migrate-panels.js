/**
 * Phase 11C — Panel 2 & Panel 3 CMS tables migration.
 *
 * Creates logo_loop_items, home_carousel_items, home_feature_items.
 * Seeds current hardcoded items only when tables are empty.
 * Idempotent, additive, never overwrites existing CMS values.
 *
 * Run: node scripts/migrate-panels.js
 */
require('dotenv').config();
const pool = require('../config/db');
const crypto = require('crypto');

const TABLES_SQL = [
`CREATE TABLE IF NOT EXISTS logo_loop_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  page_section_id INT NOT NULL COMMENT 'FK → page_sections (home/showcase)',
  item_type VARCHAR(20) NOT NULL DEFAULT 'text' COMMENT 'text | image | logo',
  text_content VARCHAR(160) NULL,
  media_public_id CHAR(36) NULL,
  url VARCHAR(500) NULL,
  link_type VARCHAR(20) NOT NULL DEFAULT 'internal',
  target VARCHAR(20) NOT NULL DEFAULT '_self',
  alt_text VARCHAR(250) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_logo_loop_items_public_id (public_id),
  KEY idx_logo_loop_items_section_status (page_section_id, status, deleted_at, sort_order),
  CONSTRAINT fk_logo_loop_items_section FOREIGN KEY (page_section_id) REFERENCES page_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_logo_loop_items_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_logo_loop_items_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

`CREATE TABLE IF NOT EXISTS home_carousel_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  page_section_id INT NOT NULL COMMENT 'FK → page_sections (home/showcase)',
  eyebrow VARCHAR(120) NULL,
  title VARCHAR(180) NOT NULL,
  description VARCHAR(1200) NULL,
  button_label VARCHAR(80) NULL,
  button_url VARCHAR(500) NULL,
  button_target VARCHAR(20) NOT NULL DEFAULT '_self',
  media_public_id CHAR(36) NULL COMMENT 'Main/background image',
  preview_media_public_id CHAR(36) NULL,
  theme_key VARCHAR(40) NULL COMMENT 'graphite | lime | silver | ink',
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_home_carousel_items_public_id (public_id),
  KEY idx_home_carousel_items_section_status (page_section_id, status, deleted_at, sort_order),
  CONSTRAINT fk_home_carousel_items_section FOREIGN KEY (page_section_id) REFERENCES page_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_home_carousel_items_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_home_carousel_items_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

`CREATE TABLE IF NOT EXISTS home_feature_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  page_section_id INT NOT NULL COMMENT 'FK → page_sections (home/services)',
  title VARCHAR(160) NOT NULL,
  description VARCHAR(1000) NULL,
  detail_text VARCHAR(1500) NULL,
  icon_type VARCHAR(20) NOT NULL DEFAULT 'builtin' COMMENT 'builtin | media',
  icon_key VARCHAR(40) NULL COMMENT 'diseno-3d | escaneo-3d | diseno-grafico | desarrollo-web | prendas | impresion-3d',
  media_public_id CHAR(36) NULL,
  url VARCHAR(500) NULL,
  link_type VARCHAR(20) NOT NULL DEFAULT 'internal',
  target VARCHAR(20) NOT NULL DEFAULT '_self',
  style_variant VARCHAR(40) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_home_feature_items_public_id (public_id),
  KEY idx_home_feature_items_section_status (page_section_id, status, deleted_at, sort_order),
  CONSTRAINT fk_home_feature_items_section FOREIGN KEY (page_section_id) REFERENCES page_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_home_feature_items_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_home_feature_items_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

const LOGO_LOOP_SEED = Object.freeze([
  { text_content: 'IMPRESIÓN 3D', item_type: 'text' },
  { text_content: 'DISEÑO', item_type: 'text' },
  { text_content: 'MODELADO', item_type: 'text' },
  { text_content: 'PROTOTIPADO', item_type: 'text' },
  { text_content: 'PERSONALIZACIÓN', item_type: 'text' },
  { text_content: 'ACABADOS', item_type: 'text' },
]);

const CAROUSEL_SEED = Object.freeze([
  {
    eyebrow: 'MUESTRA TEMPORAL · MODELADO', title: 'Diseño desde cero', theme_key: 'graphite',
    description: 'Una vista temporal para representar el proceso que lleva una idea digital hasta una pieza lista para producir.',
    button_label: 'Conocer el enfoque', button_url: '#showcase-title',
  },
  {
    eyebrow: 'MUESTRA TEMPORAL · IMPRESIÓN 3D', title: 'Piezas personalizadas', theme_key: 'lime',
    description: 'Un espacio preparado para mostrar proyectos reales de impresión, personalización y producción de NinjaLab.',
    button_label: 'Ver la propuesta', button_url: '#showcase-title',
  },
  {
    eyebrow: 'MUESTRA TEMPORAL · ACABADOS', title: 'Acabados profesionales', theme_key: 'silver',
    description: 'Tarjeta temporal para futuras fotografías de pintura, detalle y acabado final realizadas por NinjaLab.',
    button_label: 'Explorar posibilidades', button_url: '#showcase-title',
  },
  {
    eyebrow: 'MUESTRA TEMPORAL · PROTOTIPADO', title: 'Prototipos funcionales', theme_key: 'ink',
    description: 'Espacio temporal para documentar pruebas, iteraciones y soluciones funcionales antes de la producción final.',
    button_label: 'Conocer el proceso', button_url: '#showcase-title',
  },
]);

const FEATURE_SEED = Object.freeze([
  { title: 'Diseño 3D', description: 'Modelado y diseño 3D profesional para prototipos y productos personalizados.', icon_key: 'diseno-3d', url: '/tienda' },
  { title: 'Escaneo 3D', description: 'Digitalización precisa de objetos físicos para replicación o modificación.', icon_key: 'escaneo-3d', url: '/tienda' },
  { title: 'Diseño Gráfico', description: 'Identidad visual, branding y piezas gráficas con claridad y estilo.', icon_key: 'diseno-grafico', url: '/tienda' },
  { title: 'Desarrollo Web', description: 'Sitios web y aplicaciones funcionales adaptadas a cada necesidad.', icon_key: 'desarrollo-web', url: '/tienda' },
  { title: 'Prendas y Sublimación', description: 'Personalización de camisetas, tazas y más con sublimación de alta calidad.', icon_key: 'prendas', url: '/tienda' },
  { title: 'Impresión 3D Gran Formato', description: 'Piezas de gran tamaño con precisión milimétrica y acabados profesionales.', icon_key: 'impresion-3d', url: '/tienda' },
]);

async function getSectionId(connection) {
  const [[row]] = await connection.query(
    "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = ?",
    ['showcase']
  );
  return row ? row.id : null;
}

async function getServicesSectionId(connection) {
  const [[row]] = await connection.query(
    "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = 'home' AND s.section_key = ?",
    ['services']
  );
  return row ? row.id : null;
}

async function seedIfEmpty(connection, table, sectionId, seed, mapper) {
  const [[count]] = await connection.query(
    `SELECT COUNT(*) total FROM ${table} WHERE page_section_id = ? AND deleted_at IS NULL`,
    [sectionId]
  );
  if (Number(count.total) > 0) {
    if (process.env.NODE_ENV !== 'test') console.log(`  ⏭  ${table} seed skipped — items already exist`);
    return;
  }

  for (let i = 0; i < seed.length; i++) {
    const { randomUUID } = require('crypto');
    const fields = mapper(seed[i], i);
    await connection.query(
      `INSERT INTO ${table} (public_id, page_section_id, ${fields.columns})
       VALUES (?, ?, ${fields.placeholders})`,
      [randomUUID(), sectionId, ...fields.values]
    );
  }
  if (process.env.NODE_ENV !== 'test') console.log(`  ✅ ${table} seed`);
}

async function migratePanels() {
  const connection = await pool.getConnection();
  try {
    for (const sql of TABLES_SQL) {
      await connection.query(sql);
    }
    if (process.env.NODE_ENV !== 'test') console.log('  ✅ logo_loop_items, home_carousel_items, home_feature_items');

    const showcaseId = await getSectionId(connection);
    if (showcaseId) {
      await seedIfEmpty(connection, 'logo_loop_items', showcaseId, LOGO_LOOP_SEED,
        (item, i) => ({
          columns: 'item_type, text_content, sort_order, is_visible, status',
          placeholders: '?, ?, ?, ?, ?',
          values: [item.item_type, item.text_content, i, 1, 'published'],
        }));

      await seedIfEmpty(connection, 'home_carousel_items', showcaseId, CAROUSEL_SEED,
        (item, i) => ({
          columns: 'eyebrow, title, description, button_label, button_url, theme_key, sort_order, is_visible, status',
          placeholders: '?, ?, ?, ?, ?, ?, ?, ?, ?',
          values: [item.eyebrow, item.title, item.description, item.button_label, item.button_url, item.theme_key, i, 1, 'published'],
        }));
    }

    const servicesId = await getServicesSectionId(connection);
    if (servicesId) {
      await seedIfEmpty(connection, 'home_feature_items', servicesId, FEATURE_SEED,
        (item, i) => ({
          columns: 'title, description, icon_type, icon_key, url, sort_order, is_visible, status',
          placeholders: '?, ?, ?, ?, ?, ?, ?, ?',
          values: [item.title, item.description, 'builtin', item.icon_key, item.url, i, 1, 'published'],
        }));
    }
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  console.log('Applying panels migration…');
  migratePanels()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('Panels migration failed:', error.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { TABLES_SQL, LOGO_LOOP_SEED, CAROUSEL_SEED, FEATURE_SEED, migratePanels };
