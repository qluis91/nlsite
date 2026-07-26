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
    `SELECT * FROM ${table} WHERE page_section_id = ? AND status = 'published' AND is_visible = 1 AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC`,
    [sectionId]
  );
  return rows;
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

    const entries = Object.entries(data);
    if (!entries.length) {
      await connection.commit();
      return rows[0];
    }
    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    await connection.query(
      `UPDATE ${table} SET ${setClauses}, updated_by = ? WHERE public_id = ?`,
      [...values, actorId, publicId]
    );
    await revisions.recordRevision({
      entityType: table === 'logo_loop_items' ? 'logo_loop_item' : table === 'home_carousel_items' ? 'carousel_item' : 'feature_item',
      entityId: rows[0].id,
      action: 'metadata_edit',
      previousData: JSON.stringify(rows[0]),
      newData: JSON.stringify({ ...rows[0], ...data }),
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
      `UPDATE ${table} SET status = 'archived', deleted_at = CURRENT_TIMESTAMP, updated_by = ? WHERE public_id = ?`,
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
        `UPDATE ${table} SET sort_order = ?, updated_by = ? WHERE public_id = ? AND page_section_id = ?`,
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
    // Publish items: move draft to published, keep published as-is
    await connection.query(
      `UPDATE ${table} SET status = 'published', updated_by = ? WHERE page_section_id = ? AND status = 'draft' AND deleted_at IS NULL`,
      [actorId, sectionId]
    );
    await connection.commit();
    invalidateNamespace(cacheNs);
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
      "SELECT text_content, id FROM logo_loop_items WHERE media_public_id = ? LIMIT 50", [publicId]
    );
    return rows.map(r => ({ source: 'logo_loop_items', label: 'LogoLoop', location: `LogoLoop: ${r.text_content || 'item'}` }));
  });

  usageService.registerUsageSource('home_carousel_items', async (reference) => {
    const publicId = reference.replace('media://', '');
    const [rows] = await pool.query(
      "SELECT title, id FROM home_carousel_items WHERE media_public_id = ? OR preview_media_public_id = ? LIMIT 50",
      [publicId, publicId]
    );
    return rows.map(r => ({ source: 'home_carousel_items', label: 'Carrusel', location: `Proyecto: ${r.title}` }));
  });

  usageService.registerUsageSource('home_feature_items', async (reference) => {
    const publicId = reference.replace('media://', '');
    const [rows] = await pool.query(
      "SELECT title, id FROM home_feature_items WHERE media_public_id = ? LIMIT 50", [publicId]
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
  registerPanelUsageSources,
};
