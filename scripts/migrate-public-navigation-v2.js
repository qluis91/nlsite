/**
 * Forward migration — canonical public navbar hierarchy (Services + Cotizar dropdowns).
 * Idempotent. Does NOT edit historical migrate-nav-items.js.
 */
'use strict';

const crypto = require('node:crypto');

const LOCATION = 'home';

const TOP_LEVEL = Object.freeze([
  { key: 'tienda', label: 'Tienda', url: '/tienda', sort_order: 1 },
  { key: 'servicios', label: 'Servicios', url: '/soluciones-digitales', sort_order: 2, matchUrls: ['#servicios-ninjalab', '#servicios', '/soluciones-digitales'] },
  { key: 'galeria', label: 'Galería', url: '/galeria', sort_order: 3 },
  { key: 'cotizar', label: 'Cotizar', url: '/cotizar/pieza-3d', sort_order: 4 },
  { key: 'nosotros', label: 'Nosotros', url: '/nosotros', sort_order: 5, matchUrls: ['#nosotros', '/nosotros'] },
]);

const CHILDREN = Object.freeze({
  servicios: [
    { label: 'Soluciones Digitales', url: '/soluciones-digitales', sort_order: 1 },
    { label: 'Fabricación 3D', url: '/fabricacion-3d', sort_order: 2 },
    { label: 'Otros', url: '/cotizar/otros', sort_order: 3 },
  ],
  cotizar: [
    { label: 'Sitio web', url: '/cotizar/sitio-web', sort_order: 1 },
    { label: 'Pieza 3D', url: '/cotizar/pieza-3d', sort_order: 2 },
    { label: 'Otros', url: '/cotizar/otros', sort_order: 3 },
  ],
});

function snapshotFor(row) {
  return JSON.stringify({
    label: row.label,
    url: row.url,
    link_type: row.link_type || 'internal',
    target: row.target || '_self',
    media_public_id: row.media_public_id || null,
    sort_order: row.sort_order,
    is_visible: row.is_visible == null ? 1 : Number(row.is_visible),
    parent_id: row.parent_id == null ? null : Number(row.parent_id),
  });
}

async function findTopLevel(conn, def) {
  const urls = [def.url, ...(def.matchUrls || [])];
  for (const url of urls) {
    const [rows] = await conn.query(
      `SELECT * FROM navigation_items
        WHERE location = ? AND deleted_at IS NULL AND parent_id IS NULL
          AND label = ? AND url = ?
        ORDER BY id ASC LIMIT 1`,
      [LOCATION, def.label, url]
    );
    if (rows[0]) return rows[0];
  }
  const [byLabel] = await conn.query(
    `SELECT * FROM navigation_items
      WHERE location = ? AND deleted_at IS NULL AND parent_id IS NULL AND label = ?
      ORDER BY id ASC LIMIT 1`,
    [LOCATION, def.label]
  );
  return byLabel[0] || null;
}

async function ensureTopLevel(conn, def) {
  let row = await findTopLevel(conn, def);
  if (!row) {
    const publicId = crypto.randomUUID();
    const [result] = await conn.query(
      `INSERT INTO navigation_items
         (public_id, location, parent_id, label, url, link_type, target, sort_order, is_visible, status, published_data, published_at)
       VALUES (?, ?, NULL, ?, ?, 'internal', '_self', ?, 1, 'published', ?, NOW())`,
      [publicId, LOCATION, def.label, def.url, def.sort_order, snapshotFor({
        label: def.label, url: def.url, sort_order: def.sort_order, is_visible: 1, parent_id: null,
      })]
    );
    const [[created]] = await conn.query('SELECT * FROM navigation_items WHERE id = ?', [result.insertId]);
    return created;
  }

  await conn.query(
    `UPDATE navigation_items
        SET label = ?, url = ?, sort_order = ?, parent_id = NULL, is_visible = 1,
            status = 'published', deleted_at = NULL, published_data = ?, published_at = COALESCE(published_at, NOW())
      WHERE id = ?`,
    [
      def.label,
      def.url,
      def.sort_order,
      snapshotFor({
        label: def.label,
        url: def.url,
        sort_order: def.sort_order,
        is_visible: 1,
        parent_id: null,
        link_type: row.link_type,
        target: row.target,
        media_public_id: row.media_public_id,
      }),
      row.id,
    ]
  );
  const [[updated]] = await conn.query('SELECT * FROM navigation_items WHERE id = ?', [row.id]);
  return updated;
}

async function ensureChild(conn, parentId, def) {
  const [existing] = await conn.query(
    `SELECT * FROM navigation_items
      WHERE location = ? AND deleted_at IS NULL AND parent_id = ? AND label = ? AND url = ?
      ORDER BY id ASC LIMIT 1`,
    [LOCATION, parentId, def.label, def.url]
  );
  if (existing[0]) {
    await conn.query(
      `UPDATE navigation_items
          SET sort_order = ?, is_visible = 1, status = 'published', deleted_at = NULL,
              published_data = ?, published_at = COALESCE(published_at, NOW())
        WHERE id = ?`,
      [
        def.sort_order,
        snapshotFor({
          ...existing[0],
          label: def.label,
          url: def.url,
          sort_order: def.sort_order,
          is_visible: 1,
          parent_id: parentId,
        }),
        existing[0].id,
      ]
    );
    return existing[0].id;
  }

  const publicId = crypto.randomUUID();
  const [result] = await conn.query(
    `INSERT INTO navigation_items
       (public_id, location, parent_id, label, url, link_type, target, sort_order, is_visible, status, published_data, published_at)
     VALUES (?, ?, ?, ?, ?, 'internal', '_self', ?, 1, 'published', ?, NOW())`,
    [
      publicId,
      LOCATION,
      parentId,
      def.label,
      def.url,
      def.sort_order,
      snapshotFor({
        label: def.label, url: def.url, sort_order: def.sort_order, is_visible: 1, parent_id: parentId,
      }),
    ]
  );
  return result.insertId;
}

async function migratePublicNavigationV2(pool) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const parents = {};
    for (const def of TOP_LEVEL) {
      parents[def.key] = await ensureTopLevel(conn, def);
    }
    for (const [parentKey, kids] of Object.entries(CHILDREN)) {
      const parent = parents[parentKey];
      if (!parent) continue;
      for (const child of kids) {
        await ensureChild(conn, parent.id, child);
      }
    }
    await conn.commit();
    console.log('✅ Public navigation v2 migration complete.');
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { migratePublicNavigationV2, TOP_LEVEL, CHILDREN };
