/**
 * Phase 11B — navigation_items migration ("Administrar página — Navbar").
 *
 * Creates the repeatable navigation-links table and seeds the current hardcoded
 * homepage navbar items only when no records exist for the 'home' location.
 * Idempotent, additive, never overwrites existing CMS values.
 *
 * Run: node scripts/migrate-nav-items.js
 */
require('dotenv').config();
const pool = require('../config/db');

const NAVIGATION_ITEMS_SQL = `CREATE TABLE IF NOT EXISTS navigation_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL COMMENT 'Stable UUID for admin URLs and media refs',
  location VARCHAR(40) NOT NULL COMMENT 'home | global — where the item renders',
  parent_id INT NULL COMMENT 'Self-reference for future submenus',
  label VARCHAR(100) NOT NULL,
  url VARCHAR(500) NOT NULL,
  link_type VARCHAR(20) NOT NULL DEFAULT 'internal' COMMENT 'internal | external',
  target VARCHAR(20) NOT NULL DEFAULT '_self',
  media_public_id CHAR(36) NULL COMMENT 'media://<id> reference for optional icon',
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT 'draft | published | archived',
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_navigation_items_public_id (public_id),
  KEY idx_navigation_items_location_status (location, status, deleted_at, sort_order),
  KEY idx_navigation_items_parent (parent_id),
  CONSTRAINT fk_navigation_items_parent FOREIGN KEY (parent_id) REFERENCES navigation_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_navigation_items_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_navigation_items_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const HOME_NAV_SEED = Object.freeze([
  { label: 'Tienda', url: '/tienda', link_type: 'internal', target: '_self', sort_order: 1 },
  { label: 'Servicios', url: '#servicios-ninjalab', link_type: 'internal', target: '_self', sort_order: 2 },
  { label: 'Galería', url: '/galeria', link_type: 'internal', target: '_self', sort_order: 3 },
  { label: 'Nosotros', url: '#nosotros', link_type: 'internal', target: '_self', sort_order: 4 },
]);

async function migrateNavigationItems() {
  const connection = await pool.getConnection();
  try {
    await connection.query(NAVIGATION_ITEMS_SQL);
    if (process.env.NODE_ENV !== 'test') console.log('  ✅ navigation_items');

    const [[count]] = await connection.query(
      "SELECT COUNT(*) total FROM navigation_items WHERE location = 'home' AND status != 'archived'"
    );
    if (Number(count.total) > 0) {
      if (process.env.NODE_ENV !== 'test') console.log('  ⏭  navigation_items seed skipped — items already exist');
      return;
    }

    await connection.beginTransaction();
    try {
      const { randomUUID } = require('crypto');
      for (const item of HOME_NAV_SEED) {
        await connection.query(
          `INSERT INTO navigation_items
             (public_id, location, label, url, link_type, target, sort_order, is_visible, status)
           VALUES (?, 'home', ?, ?, ?, ?, ?, 1, 'published')`,
          [randomUUID(), item.label, item.url, item.link_type, item.target, item.sort_order]
        );
      }
      await connection.commit();
      if (process.env.NODE_ENV !== 'test') console.log('  ✅ navigation_items seed');
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  console.log('Applying navigation-items migration…');
  migrateNavigationItems()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('Navigation-items migration failed:', error.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { NAVIGATION_ITEMS_SQL, HOME_NAV_SEED, migrateNavigationItems };
