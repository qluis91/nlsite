/**
 * Phase 11C — Repeatable CMS items CRUD & publish service.
 * Extends Phase 11B publishing service with logo loop, carousel, and feature items.
 */
const crypto = require('crypto');
const pool = require('../config/db');
const revisions = require('./contentRevisionService');
const usageService = require('./mediaUsageService');
const { invalidateNamespace } = require('./cmsPublishingService');

function serialize(value) { return value === null || value === undefined ? null : JSON.stringify(value); }

const PUBLISHED_FIELDS = Object.freeze({
  logo_loop_items: Object.freeze([
    'item_type', 'text_content', 'media_public_id', 'url', 'link_type', 'target',
    'alt_text', 'sort_order', 'is_visible',
  ]),
  home_carousel_items: Object.freeze([
    'eyebrow', 'title', 'description', 'button_label', 'button_url', 'button_target',
    'media_public_id', 'preview_media_public_id', 'theme_key', 'sort_order', 'is_visible',
  ]),
  home_feature_items: Object.freeze([
    'title', 'description', 'detail_text', 'icon_type', 'icon_key', 'media_public_id',
    'url', 'link_type', 'target', 'style_variant', 'sort_order', 'is_visible',
  ]),
});

function publishedSnapshot(table, row) {
  const fields = PUBLISHED_FIELDS[table];
  if (!fields) throw new Error('Colección CMS no permitida.');
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

async function getSectionId(connection, pageKey, sectionKey) {
  const [[row]] = await connection.query(
    "SELECT s.id FROM page_sections s INNER JOIN pages p ON p.id = s.page_id WHERE p.page_key = ? AND s.section_key = ?",
    [pageKey, sectionKey]
  );
  if (!row) throw new Error(`Section ${pageKey}/${sectionKey} not found`);
  return row.id;
}

// ── Generic repeatable-item helpers ──

async function listItems(table, sectionId, { includeArchived = false } = {}) {
  const conds = ['page_section_id = ?', 'deleted_at IS NULL'];
  if (!includeArchived) conds.push("status != 'archived'");
  const [rows] = await pool.query(
    `SELECT * FROM ${table} WHERE ${conds.join(' AND ')} ORDER BY sort_order ASC, id ASC`,
    [sectionId]
  );
  return rows;
}

async function getPublishedItems(table, sectionId) {
  const [rows] = await pool.query(
    `SELECT id, public_id, page_section_id, published_data
       FROM ${table}
      WHERE page_section_id = ? AND published_data IS NOT NULL`,
    [sectionId]
  );
  return rows
    .map((row) => {
      const data = typeof row.published_data === 'string'
        ? JSON.parse(row.published_data)
        : row.published_data;
      return { id: row.id, public_id: row.public_id, page_section_id: row.page_section_id, status: 'published', ...data };
    })
    .filter((row) => Number(row.is_visible) === 1)
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(a.id) - Number(b.id));
}

async function createItem(table, sectionId, data, { actorId = null } = {}) {
  const publicId = crypto.randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const columns = Object.keys(data).filter(k => data[k] !== undefined);
    const values = columns.map(k => data[k]);
    const placeholders = columns.map(() => '?').join(', ');

    const [result] = await connection.query(
      `INSERT INTO ${table} (public_id, page_section_id, ${columns.join(', ')}) VALUES (?, ?, ${placeholders})`,
      [publicId, sectionId, ...values]
    );
    await revisions.recordRevision({
      entityType: table === 'logo_loop_items' ? 'logo_loop_item' : table === 'home_carousel_items' ? 'carousel_item' : 'feature_item',
      entityId: result.insertId,
      action: 'upload',
      newData: data,
      changeSummary: 'Elemento creado.',
      changedBy: actorId,
    }, connection);
    await connection.commit();
    return { ...data, public_id: publicId, id: result.insertId };
  } catch (e) {
    await connection.rollback().catch(() => {});
    throw e;
  } finally { connection.release(); }
}

async function saveItem(table, publicId, data, { actorId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT * FROM ${table} WHERE public_id = ? FOR UPDATE`, [publicId]);
    if (!rows[0]) throw new Error('Elemento no encontrado.');

    const entries = Object.entries({ ...data, status: 'draft' });
    if (!entries.length) {
      await connection.commit();
      return rows[0];
    }
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    await connection.query(
      `UPDATE ${table} SET ${setClauses}, deleted_at = NULL, updated_by = ? WHERE public_id = ?`,
      [...values, actorId, publicId]
    );
    await revisions.recordRevision({
      entityType: table === 'logo_loop_items' ? 'logo_loop_item' : table === 'home_carousel_items' ? 'carousel_item' : 'feature_item',
      entityId: rows[0].id,
      action: 'metadata_edit',
      previousData: JSON.stringify(rows[0]),
      newData: JSON.stringify({ ...rows[0], ...data, status: 'draft' }),
      changeSummary: 'Elemento actualizado.',
      changedBy: actorId,
    }, connection);
    await connection.commit();
  } catch (e) {
    await connection.rollback().catch(() => {});
    throw e;
  } finally { connection.release(); }
}

async function archiveItem(table, publicId, { actorId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT * FROM ${table} WHERE public_id = ? FOR UPDATE`, [publicId]);
    if (!rows[0]) throw new Error('Elemento no encontrado.');
    await connection.query(
      `UPDATE ${table} SET status = 'archived', deleted_at = NOW(), updated_by = ? WHERE public_id = ?`,
      [actorId, publicId]
    );
    await revisions.recordRevision({
      entityType: table === 'logo_loop_items' ? 'logo_loop_item' : table === 'home_carousel_items' ? 'carousel_item' : 'feature_item',
      entityId: rows[0].id,
      action: 'archive',
      previousData: { public_id: rows[0].public_id },
      changeSummary: 'Elemento archivado.',
      changedBy: actorId,
    }, connection);
    await connection.commit();
  } catch (e) {
    await connection.rollback().catch(() => {});
    throw e;
  } finally { connection.release(); }
}

async function reorderItems(table, sectionId, orderedIds, { actorId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (let i = 0; i < orderedIds.length; i++) {
      await connection.query(
        `UPDATE ${table}
            SET sort_order = ?, status = CASE WHEN status = 'archived' THEN status ELSE 'draft' END,
                updated_by = ?
          WHERE public_id = ? AND page_section_id = ?`,
        [i, actorId, orderedIds[i], sectionId]
      );
    }
    await connection.commit();
  } catch (e) {
    await connection.rollback().catch(() => {});
    throw e;
  } finally { connection.release(); }
}

async function publishCollection(table, sectionId, cacheNs, { actorId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [items] = await connection.query(
      `SELECT * FROM ${table}
        WHERE page_section_id = ? AND (status IN ('draft', 'archived') OR published_data IS NULL)
        FOR UPDATE`,
      [sectionId]
    );
    for (const item of items) {
      if (item.status === 'archived') {
        await connection.query(
          `UPDATE ${table}
              SET published_data = NULL, published_at = NOW(), deleted_at = NOW(), updated_by = ?
            WHERE id = ?`,
          [actorId, item.id]
        );
        continue;
      }
      await connection.query(
        `UPDATE ${table}
            SET published_data = ?, published_at = NOW(), status = 'published',
                deleted_at = NULL, updated_by = ?
          WHERE id = ?`,
        [JSON.stringify(publishedSnapshot(table, item)), actorId, item.id]
      );
    }
    await connection.query(
      'UPDATE page_sections SET is_enabled = 1 WHERE id = ?',
      [sectionId]
    );
    await connection.commit();
    invalidateNamespace(cacheNs);
    return items.length;
  } catch (e) {
    await connection.rollback().catch(() => {});
    throw e;
  } finally { connection.release(); }
}

// ── Media usage sources for Phase 11C ──

function registerPanelUsageSources() {
  usageService.registerUsageSource('logo_loop_items', async (reference) => {
    const publicId = reference.replace('media://', '');
    const [rows] = await pool.query(
      `SELECT text_content, id FROM logo_loop_items
        WHERE media_public_id = ? AND deleted_at IS NULL AND status != 'archived'
        LIMIT 50`,
      [publicId]
    );
    return rows.map(r => ({ source: 'logo_loop_items', label: 'LogoLoop', location: `LogoLoop: ${r.text_content || 'item'}` }));
  });

  usageService.registerUsageSource('home_carousel_items', async (reference) => {
    const publicId = reference.replace('media://', '');
    const [rows] = await pool.query(
      `SELECT title, id FROM home_carousel_items
        WHERE (media_public_id = ? OR preview_media_public_id = ?)
          AND deleted_at IS NULL AND status != 'archived'
        LIMIT 50`,
      [publicId, publicId]
    );
    return rows.map(r => ({ source: 'home_carousel_items', label: 'Carrusel', location: `Proyecto: ${r.title}` }));
  });

  usageService.registerUsageSource('home_feature_items', async (reference) => {
    const publicId = reference.replace('media://', '');
    const [rows] = await pool.query(
      `SELECT title, id FROM home_feature_items
        WHERE media_public_id = ? AND deleted_at IS NULL AND status != 'archived'
        LIMIT 50`,
      [publicId]
    );
    return rows.map(r => ({ source: 'home_feature_items', label: 'Panel 3', location: `Tarjeta: ${r.title}` }));
  });
}

module.exports = {
  listItems,
  getPublishedItems,
  createItem,
  saveItem,
  archiveItem,
  reorderItems,
  publishCollection,
  PUBLISHED_FIELDS,
  registerPanelUsageSources,
};
