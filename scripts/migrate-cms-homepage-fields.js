/**
 * Phase 1B — additive homepage CMS fields and hero social links.
 * Idempotent and safe to run repeatedly.
 */
require('dotenv').config();
const crypto = require('crypto');
const pool = require('../config/db');

const SOCIAL_SEED = Object.freeze([
  { platform: 'instagram', label: 'Instagram', profile_url: 'https://www.instagram.com/ninjalab3dcr', aria_label: 'Instagram — NinjaLabCR' },
  { platform: 'facebook', label: 'Facebook', profile_url: 'https://www.facebook.com/ninjalab3dcr', aria_label: 'Facebook — NinjaLabCR' },
  { platform: 'tiktok', label: 'TikTok', profile_url: 'https://www.tiktok.com/@ninjalabcr', aria_label: 'TikTok — NinjaLabCR' },
  { platform: 'whatsapp', label: 'WhatsApp', profile_url: 'https://wa.me/50670240270', aria_label: 'WhatsApp — NinjaLabCR' },
]);

const CREATE_SOCIAL_TABLE = `
CREATE TABLE IF NOT EXISTS home_social_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  page_section_id INT NOT NULL,
  platform VARCHAR(30) NOT NULL,
  label VARCHAR(80) NOT NULL,
  profile_url VARCHAR(500) NOT NULL,
  aria_label VARCHAR(160) NULL,
  media_public_id CHAR(36) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  published_data JSON NULL,
  published_at DATETIME NULL,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_home_social_items_public_id (public_id),
  KEY idx_home_social_items_section_status (page_section_id, status, deleted_at, sort_order),
  CONSTRAINT fk_home_social_items_section FOREIGN KEY (page_section_id) REFERENCES page_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_home_social_items_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_home_social_items_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const COLUMN_MIGRATIONS = Object.freeze([
  ['home_carousel_items', 'media_alt', "VARCHAR(250) NULL AFTER media_public_id"],
  ['home_carousel_items', 'preview_media_alt', "VARCHAR(250) NULL AFTER preview_media_public_id"],
  ['home_feature_items', 'button_label', "VARCHAR(80) NULL AFTER detail_text"],
  ['home_feature_items', 'media_alt', "VARCHAR(250) NULL AFTER media_public_id"],
  ['home_feature_items', 'link_aria_label', "VARCHAR(180) NULL AFTER url"],
]);

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

function mergeDefaults(value, defaults) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
  }
  return { ...defaults, ...(parsed || {}) };
}

async function backfillSection(connection, sectionKey, defaults) {
  const [[row]] = await connection.query(
    `SELECT s.id, s.content_json, s.published_content_json
       FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = 'home' AND s.section_key = ? LIMIT 1`,
    [sectionKey]
  );
  if (!row) return null;
  const draft = mergeDefaults(row.content_json, defaults);
  const published = mergeDefaults(row.published_content_json, defaults);
  await connection.query(
    `UPDATE page_sections
        SET content_json = ?, published_content_json = COALESCE(?, published_content_json)
      WHERE id = ?`,
    [JSON.stringify(draft), row.published_content_json == null ? null : JSON.stringify(published), row.id]
  );
  return row.id;
}

async function migrateCmsHomepageFields() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(CREATE_SOCIAL_TABLE);
    for (const [table, column, definition] of COLUMN_MIGRATIONS) {
      if (!(await columnExists(connection, table, column))) {
        await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }

    const heroId = await backfillSection(connection, 'hero', {
      isVisible: true,
      heroAriaLabel: 'Casco 3D interactivo',
      loadingAriaLabel: 'Cargando modelo 3D',
      modelErrorText: 'No fue posible cargar el modelo 3D.',
      retryLabel: 'Reintentar',
      modelPosterAlt: 'Casco 3D NinjaLab',
      modelFallbackAlt: 'Modelo 3D no disponible',
      socialAriaLabel: 'Redes sociales de NinjaLab',
    });
    await backfillSection(connection, 'showcase', {
      isVisible: true,
      carouselControlsAriaLabel: 'Controles del carrusel',
      carouselPreviousLabel: 'Proyecto anterior',
      carouselNextLabel: 'Proyecto siguiente',
    });
    await backfillSection(connection, 'services', {
      isVisible: true,
      carouselAriaLabel: 'Servicios de NinjaLab',
      carouselControlsAriaLabel: 'Controles del carrusel',
      carouselPreviousLabel: 'Servicio anterior',
      carouselNextLabel: 'Servicio siguiente',
      defaultButtonLabel: 'VER DETALLE',
    });

    if (heroId) {
      const [[count]] = await connection.query(
        'SELECT COUNT(*) total FROM home_social_items WHERE page_section_id = ?',
        [heroId]
      );
      if (Number(count.total) === 0) {
        for (let index = 0; index < SOCIAL_SEED.length; index++) {
          const item = SOCIAL_SEED[index];
          const snapshot = { ...item, media_public_id: null, sort_order: index, is_visible: 1 };
          await connection.query(
            `INSERT INTO home_social_items
              (public_id, page_section_id, platform, label, profile_url, aria_label,
               sort_order, is_visible, status, published_data, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'published', ?, NOW())`,
            [crypto.randomUUID(), heroId, item.platform, item.label, item.profile_url,
              item.aria_label, index, JSON.stringify(snapshot)]
          );
        }
      }
    }

    await connection.query(
      "UPDATE home_feature_items SET button_label = 'VER DETALLE' WHERE button_label IS NULL"
    );
    await connection.query(
      'UPDATE home_carousel_items SET media_alt = title WHERE media_alt IS NULL'
    );
    await connection.query(
      'UPDATE home_feature_items SET media_alt = title WHERE media_alt IS NULL AND media_public_id IS NOT NULL'
    );
    await connection.query(
      `UPDATE home_feature_items
          SET published_data = JSON_SET(published_data, '$.button_label', 'VER DETALLE')
        WHERE published_data IS NOT NULL
          AND JSON_EXTRACT(published_data, '$.button_label') IS NULL`
    );
    await connection.query(
      `UPDATE home_carousel_items
          SET published_data = JSON_SET(
            published_data,
            '$.media_alt', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(published_data, '$.media_alt')), title),
            '$.preview_media_alt', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(published_data, '$.preview_media_alt')), title)
          )
        WHERE published_data IS NOT NULL`
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  migrateCmsHomepageFields()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('Homepage CMS fields migration failed:', error.message);
      await pool.end().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  SOCIAL_SEED,
  CREATE_SOCIAL_TABLE,
  COLUMN_MIGRATIONS,
  migrateCmsHomepageFields,
};
