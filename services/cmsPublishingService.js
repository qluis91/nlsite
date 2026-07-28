/**
 * CMS content mutation + published‑content cache — Phase 11B.
 *
 * Owns the draft/publish lifecycle for page sections, site settings and
 * navigation items. The simple in‑memory cache is invalidated per‑key on every
 * publish and keeps drafts from contaminating public reads.
 */
const crypto = require('crypto');
const { isDeepStrictEqual } = require('node:util');
const pool = require('../config/db');
const revisions = require('./contentRevisionService');
const usageService = require('./mediaUsageService');
const { assertCmsSchemaReady } = require('./cmsSchemaReadinessService');
const { CONTENT_STATUS_VALUES } = require('../config/cmsOptions');

// ── Simple read cache (single‑instance, drafts excluded) ──
const cache = new Map();

function cacheKey(namespace, discriminator) {
  return `${namespace}:${discriminator}`;
}

function cacheGet(namespace, discriminator) {
  const key = cacheKey(namespace, discriminator);
  return cache.has(key) ? cache.get(key) : null;
}

function cacheSet(namespace, discriminator, value) {
  cache.set(cacheKey(namespace, discriminator), value);
}

function invalidateNamespace(namespace) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${namespace}:`)) cache.delete(key);
  }
}

function flushCache() { cache.clear(); }

// ── Entity type key for revision/usage ──
const ENTITY_SITE_SETTING = 'site_setting';
const ENTITY_PAGE_SECTION = 'page_section';
const ENTITY_NAV_ITEM = 'navigation_item';

// ── Site settings helpers ──

async function upsertSetting(settingKey, value, valueType, {
  settingGroup = 'general',
  isPublic = false,
  actorId = null,
} = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query(
      "SELECT id, setting_value FROM site_settings WHERE setting_key = ? FOR UPDATE",
      [settingKey]
    );
    const previous = existing[0] || null;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    if (previous) {
      await connection.query(
        `UPDATE site_settings
            SET setting_value = ?, value_type = ?, setting_group = ?, is_public = ?,
                published_value = ?, has_unpublished_changes = 0,
                published_at = NOW(), updated_by = ?
          WHERE id = ?`,
        [serialized, valueType, settingGroup, isPublic ? 1 : 0, serialized, actorId, previous.id]
      );
    } else {
      await connection.query(
        `INSERT INTO site_settings
           (setting_key, setting_value, value_type, setting_group, is_public,
            published_value, has_unpublished_changes, published_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 0, NOW(), ?)`,
        [settingKey, serialized, valueType, settingGroup, isPublic ? 1 : 0, serialized, actorId]
      );
    }

    const [[current]] = await connection.query(
      'SELECT * FROM site_settings WHERE setting_key = ?', [settingKey]
    );
    await revisions.recordRevision({
      entityType: ENTITY_SITE_SETTING,
      entityId: current.id,
      action: previous ? 'metadata_edit' : 'upload',
      previousData: previous ? { setting_value: previous.setting_value } : null,
      newData: { setting_value: current.setting_value },
      changeSummary: previous ? 'Configuración actualizada.' : 'Configuración creada.',
      changedBy: actorId,
    }, connection);

    await connection.commit();
    invalidateNamespace('siteSettings');
    return current;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function saveSettingsDraft(entries, { actorId = null } = {}) {
  if (!Array.isArray(entries) || !entries.length) return 0;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [settingKey, value, valueType, settingGroup = 'general', isPublic = true] of entries) {
      const [existing] = await connection.query(
        'SELECT id, setting_value FROM site_settings WHERE setting_key = ? FOR UPDATE',
        [settingKey]
      );
      const previous = existing[0] || null;
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      let entityId;
      if (previous) {
        entityId = previous.id;
        await connection.query(
          `UPDATE site_settings
              SET setting_value = ?, value_type = ?, setting_group = ?, is_public = ?,
                  has_unpublished_changes = 1, updated_by = ?
            WHERE id = ?`,
          [serialized, valueType, settingGroup, isPublic ? 1 : 0, actorId, entityId]
        );
      } else {
        const [result] = await connection.query(
          `INSERT INTO site_settings
             (setting_key, setting_value, value_type, setting_group, is_public,
              has_unpublished_changes, updated_by)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [settingKey, serialized, valueType, settingGroup, isPublic ? 1 : 0, actorId]
        );
        entityId = result.insertId;
      }
      await revisions.recordRevision({
        entityType: ENTITY_SITE_SETTING,
        entityId,
        action: previous ? 'metadata_edit' : 'upload',
        previousData: previous ? { setting_value: previous.setting_value } : null,
        newData: { setting_value: serialized },
        changeSummary: previous ? 'Configuración actualizada.' : 'Configuración creada.',
        changedBy: actorId,
      }, connection);
    }
    await connection.commit();
    return entries.length;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function getPublishedSettings(keys) {
  const cacheNS = 'siteSettings';
  const result = {};
  const missing = [];

  for (const key of keys) {
    const cached = cacheGet(cacheNS, key);
    if (cached !== null) { result[key] = cached; } else { missing.push(key); }
  }

  if (missing.length) {
    const placeholders = missing.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT setting_key, published_value AS setting_value, value_type
         FROM site_settings
        WHERE setting_key IN (${placeholders}) AND published_value IS NOT NULL`,
      missing
    );
    for (const row of rows) {
      let parsed = row.setting_value;
      if (row.value_type === 'number') parsed = Number(row.setting_value);
      else if (row.value_type === 'boolean') parsed = row.setting_value === '1' || row.setting_value === 'true';
      result[row.setting_key] = parsed;
      cacheSet(cacheNS, row.setting_key, parsed);
    }
    for (const key of missing) {
      if (!(key in result)) { result[key] = null; cacheSet(cacheNS, key, null); }
    }
  }
  return result;
}

function parseSettingValue(value, valueType) {
  if (valueType === 'number') return Number(value);
  if (valueType === 'boolean' || valueType === 'flag') {
    return value === '1' || value === 'true' || value === 1 || value === true;
  }
  if (valueType === 'json' && typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

async function getDraftSettings(keys) {
  if (!Array.isArray(keys) || !keys.length) return {};
  const placeholders = keys.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value, value_type, has_unpublished_changes
       FROM site_settings
      WHERE setting_key IN (${placeholders})`,
    keys
  );
  const result = Object.fromEntries(keys.map((key) => [key, null]));
  for (const row of rows) {
    result[row.setting_key] = parseSettingValue(row.setting_value, row.value_type);
  }
  return result;
}

async function publishSettings(keys, { actorId = null } = {}) {
  if (!Array.isArray(keys) || !keys.length) return 0;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const placeholders = keys.map(() => '?').join(',');
    const [rows] = await connection.query(
      `SELECT id, setting_key, setting_value, published_value
         FROM site_settings
        WHERE setting_key IN (${placeholders}) AND has_unpublished_changes = 1
        FOR UPDATE`,
      keys
    );
    if (rows.length) {
      await connection.query(
        `UPDATE site_settings
            SET published_value = setting_value, has_unpublished_changes = 0,
                published_at = NOW(), updated_by = ?
          WHERE setting_key IN (${placeholders})`,
        [actorId, ...keys]
      );
      for (const row of rows) {
        await revisions.recordRevision({
          entityType: ENTITY_SITE_SETTING,
          entityId: row.id,
          action: 'replace',
          previousData: { published_value: row.published_value },
          newData: { published_value: row.setting_value },
          changeSummary: 'Configuración publicada.',
          changedBy: actorId,
        }, connection);
      }
    }
    await connection.commit();
    invalidateNamespace('siteSettings');
    return rows.length;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

// ── Section content helpers (hero/panel‑1) ──

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mergeDraftObjects(stored, submitted, seen = new WeakSet()) {
  if (submitted && typeof submitted === 'object') {
    if (seen.has(submitted)) throw new TypeError('Circular draft content is not supported.');
    seen.add(submitted);
  }
  const result = { ...parseJsonObject(stored) };
  for (const [key, value] of Object.entries(parseJsonObject(submitted))) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeDraftObjects(result[key], value, seen)
      : value;
  }
  if (submitted && typeof submitted === 'object') seen.delete(submitted);
  return result;
}

function emitDiagnostic(callback, event, details = {}) {
  if (typeof callback !== 'function') return;
  try {
    callback(event, details);
  } catch {
    // Diagnostics must never alter the save transaction.
  }
}

async function saveSectionDraft(pageKey, sectionKey, content, style, {
  actorId = null,
  onDiagnostic = null,
} = {}) {
  try {
    const schemaResult = await assertCmsSchemaReady(pool);
    emitDiagnostic(onDiagnostic, 'schema_capability', { ready: schemaResult.ready });
  } catch (error) {
    emitDiagnostic(onDiagnostic, 'schema_capability', {
      ready: false,
      code: error.code || 'CMS_SCHEMA_NOT_READY',
    });
    throw error;
  }
  const connection = await pool.getConnection();
  try {
    emitDiagnostic(onDiagnostic, 'transaction_start');
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT s.id, s.content_json, s.style_json, s.status, s.is_enabled, s.version
         FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
        WHERE p.page_key = ? AND s.section_key = ? FOR UPDATE`,
      [pageKey, sectionKey]
    );
    const section = rows[0];
    if (!section) throw new Error('La sección no existe en la base de datos.');

    const previousContentObject = parseJsonObject(section.content_json);
    const previousStyleObject = parseJsonObject(section.style_json);
    const mergedContent = mergeDraftObjects(previousContentObject, content);
    const mergedStyle = mergeDraftObjects(previousStyleObject, style);
    const previousContent = JSON.stringify(previousContentObject);
    const previousStyle = JSON.stringify(previousStyleObject);
    const newContent = JSON.stringify(mergedContent);
    const newStyle = JSON.stringify(mergedStyle);

    const [updateResult] = await connection.query(
      `UPDATE page_sections
          SET content_json = ?, style_json = ?, status = 'draft', is_enabled = 1,
              version = version + 1, updated_by = ?
        WHERE id = ?`,
      [newContent, newStyle, actorId, section.id]
    );
    if (Number(updateResult.affectedRows) !== 1) {
      const error = new Error('El borrador no fue actualizado.');
      error.code = 'CMS_DRAFT_NOT_PERSISTED';
      throw error;
    }

    await revisions.recordRevision({
      entityType: ENTITY_PAGE_SECTION,
      entityId: section.id,
      action: 'metadata_edit',
      previousData: { content_json: previousContent, style_json: previousStyle },
      newData: { content_json: newContent, style_json: newStyle },
      changeSummary: 'Borrador de sección guardado.',
      changedBy: actorId,
    }, connection);

    const [[persisted]] = await connection.query(
      'SELECT content_json, style_json, status, version FROM page_sections WHERE id = ?',
      [section.id]
    );
    if (
      !persisted
      || !isDeepStrictEqual(parseJsonObject(persisted.content_json), mergedContent)
      || !isDeepStrictEqual(parseJsonObject(persisted.style_json), mergedStyle)
    ) {
      const error = new Error('No fue posible confirmar la persistencia del borrador.');
      error.code = 'CMS_DRAFT_NOT_PERSISTED';
      throw error;
    }

    await connection.commit();
    emitDiagnostic(onDiagnostic, 'transaction_commit', { sectionId: section.id });
    return {
      sectionId: section.id,
      content: parseJsonObject(persisted.content_json),
      style: parseJsonObject(persisted.style_json),
      status: persisted.status,
      version: persisted.version,
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    emitDiagnostic(onDiagnostic, 'transaction_rollback', {
      code: error.code || 'CMS_SAVE_ERROR',
      message: String(error.message || 'Save failed').slice(0, 180),
    });
    throw error;
  } finally {
    connection.release();
  }
}

async function publishSection(pageKey, sectionKey, { actorId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT s.id, s.content_json, s.style_json, s.published_content_json,
              s.published_style_json, s.status, s.is_enabled, s.version
         FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
        WHERE p.page_key = ? AND s.section_key = ? FOR UPDATE`,
      [pageKey, sectionKey]
    );
    const section = rows[0];
    if (!section) throw new Error('La sección no existe en la base de datos.');
    if (section.status === 'published' && Number(section.is_enabled) === 1) {
      await connection.commit();
      return section;
    }

    const previousContent = JSON.stringify(section.content_json);
    const previousStyle = JSON.stringify(section.style_json);

    await connection.query(
      `UPDATE page_sections
          SET published_content_json = content_json,
              published_style_json = style_json,
              published_at = NOW(), status = 'published', is_enabled = 1, updated_by = ?
        WHERE id = ?`,
      [actorId, section.id]
    );

    await revisions.recordRevision({
      entityType: ENTITY_PAGE_SECTION,
      entityId: section.id,
      action: 'replace',
      previousData: { content_json: previousContent, style_json: previousStyle, status: section.status },
      newData: { content_json: section.content_json, style_json: section.style_json, status: 'published' },
      changeSummary: 'Sección publicada. Los cambios ahora son visibles en el sitio.',
      changedBy: actorId,
    }, connection);

    await connection.commit();
    invalidateNamespace(`sc_${pageKey}`);
    return section;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function getSectionDraft(pageKey, sectionKey) {
  const [rows] = await pool.query(
    `SELECT s.id, s.section_key, s.name, s.content_json, s.style_json, s.status,
            s.is_enabled, s.version
       FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = ? AND s.section_key = ? LIMIT 1`,
    [pageKey, sectionKey]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    content: (typeof row.content_json === 'string' ? JSON.parse(row.content_json || '{}') : row.content_json) || {},
    style: (typeof row.style_json === 'string' ? JSON.parse(row.style_json || '{}') : row.style_json) || {},
  };
}

async function getPublishedHeroContent(pageKey, sectionKey, fallback = null) {
  const cacheNS = `sc_${pageKey}`;
  const cacheDiscrim = `${sectionKey}_published`;
  const cached = cacheGet(cacheNS, cacheDiscrim);
  if (cached !== null) return cached === 'FALLBACK' ? fallback : cached;

  const [rows] = await pool.query(
      `SELECT s.published_content_json AS content_json
         FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
       WHERE p.page_key = ? AND s.section_key = ? AND s.is_enabled = 1
         AND s.published_content_json IS NOT NULL
      LIMIT 1`,
    [pageKey, sectionKey]
  );
  const json = rows[0]?.content_json;
  let parsed = null;
  if (json) {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  }
  cacheSet(cacheNS, cacheDiscrim, parsed || 'FALLBACK');
  return parsed || fallback;
}

// ── Navigation items ──

async function listNavItems(location = 'home', { includeArchived = false } = {}) {
  const conditions = ['n.location = ?'];
  if (!includeArchived) conditions.push("n.status != 'archived'");
  const [rows] = await pool.query(
    `SELECT n.id, n.public_id, n.location, n.parent_id, n.label, n.url, n.link_type,
            n.target, n.media_public_id, n.sort_order, n.is_visible, n.status,
            n.created_at, n.updated_at
       FROM navigation_items n
      WHERE ${conditions.join(' AND ')}
      ORDER BY n.sort_order ASC, n.id ASC`,
    [location]
  );
  return rows;
}

async function getPublishedNavItems(location = 'home') {
  const cacheNS = `nav_${location}`;
  const cached = cacheGet(cacheNS, 'published');
  if (cached !== null) return cached;

  const [rows] = await pool.query(
    `SELECT id, public_id, published_data
       FROM navigation_items
      WHERE location = ? AND published_data IS NOT NULL`,
    [location]
  );
  const published = rows
    .map((row) => {
      const data = typeof row.published_data === 'string'
        ? JSON.parse(row.published_data)
        : row.published_data;
      return { id: row.id, public_id: row.public_id, ...data };
    })
    .filter((row) => Number(row.is_visible) === 1)
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(a.id) - Number(b.id));
  cacheSet(cacheNS, 'published', published);
  return published;
}

async function saveNavItem(publicId, data, { actorId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT * FROM navigation_items WHERE public_id = ? FOR UPDATE', [publicId]
    );
    const item = rows[0];
    if (!item) throw new Error('El enlace de navegación no existe.');

    const previous = { label: item.label, url: item.url, target: item.target, link_type: item.link_type, sort_order: item.sort_order, is_visible: item.is_visible };
    await connection.query(
      `UPDATE navigation_items
          SET label = ?, url = ?, link_type = ?, target = ?, media_public_id = ?,
              sort_order = ?, is_visible = ?, status = 'draft', updated_by = ?
        WHERE public_id = ?`,
      [data.label, data.url, data.linkType, data.target, data.mediaPublicId || null,
       data.sortOrder, data.isVisible ? 1 : 0, actorId, publicId]
    );

    await revisions.recordRevision({
      entityType: ENTITY_NAV_ITEM,
      entityId: item.id,
      action: 'metadata_edit',
      previousData: previous,
      newData: { label: data.label, url: data.url, target: data.target },
      changeSummary: 'Enlace de navegación actualizado.',
      changedBy: actorId,
    }, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function createNavItem(data, { actorId = null } = {}) {
  const publicId = crypto.randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO navigation_items
         (public_id, location, label, url, link_type, target, media_public_id, sort_order, is_visible, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [publicId, data.location, data.label, data.url, data.linkType, data.target,
       data.mediaPublicId || null, data.sortOrder, data.isVisible ? 1 : 0, actorId]
    );

    await revisions.recordRevision({
      entityType: ENTITY_NAV_ITEM,
      entityId: result.insertId,
      action: 'upload',
      previousData: null,
      newData: { label: data.label, url: data.url },
      changeSummary: 'Enlace de navegación creado.',
      changedBy: actorId,
    }, connection);
    await connection.commit();
    return { ...data, public_id: publicId, id: result.insertId };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function archiveNavItem(publicId, { actorId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT * FROM navigation_items WHERE public_id = ? FOR UPDATE', [publicId]
    );
    const item = rows[0];
    if (!item) throw new Error('El enlace de navegación no existe.');

    await connection.query(
      "UPDATE navigation_items SET status = 'archived', deleted_at = NOW(), updated_by = ? WHERE public_id = ?",
      [actorId, publicId]
    );
    await revisions.recordRevision({
      entityType: ENTITY_NAV_ITEM,
      entityId: item.id,
      action: 'archive',
      previousData: { label: item.label },
      newData: { status: 'archived' },
      changeSummary: 'Enlace de navegación archivado.',
      changedBy: actorId,
    }, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function publishNavItems({ location = 'home', actorId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [items] = await connection.query(
      `SELECT * FROM navigation_items
        WHERE location = ? AND (status IN ('draft', 'archived') OR published_data IS NULL)
        FOR UPDATE`,
      [location]
    );
    for (const item of items) {
      if (item.status === 'archived') {
        await connection.query(
          `UPDATE navigation_items
              SET published_data = NULL, published_at = NOW(), deleted_at = NOW(), updated_by = ?
            WHERE id = ?`,
          [actorId, item.id]
        );
        continue;
      }
      const snapshot = {
        label: item.label,
        url: item.url,
        link_type: item.link_type,
        target: item.target,
        media_public_id: item.media_public_id,
        sort_order: item.sort_order,
        is_visible: item.is_visible,
      };
      await connection.query(
        `UPDATE navigation_items
            SET published_data = ?, published_at = NOW(), status = 'published',
                deleted_at = NULL, updated_by = ?
          WHERE id = ?`,
        [JSON.stringify(snapshot), actorId, item.id]
      );
    }

    for (const item of items) {
      await revisions.recordRevision({
        entityType: ENTITY_NAV_ITEM,
        entityId: item.id,
        action: 'replace',
        previousData: { status: item.status, published_data: item.published_data },
        newData: { status: item.status === 'archived' ? 'archived' : 'published' },
        changeSummary: 'Enlace de navegación publicado.',
        changedBy: actorId,
      }, connection);
    }
    await connection.commit();
    invalidateNamespace(`nav_${location}`);
    return items.length;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function reorderNavItems(orderedIds, { location = 'home', actorId = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (let index = 0; index < orderedIds.length; index += 1) {
      await connection.query(
        `UPDATE navigation_items
            SET sort_order = ?, status = CASE WHEN status = 'archived' THEN status ELSE 'draft' END,
                updated_by = ?
          WHERE public_id = ? AND location = ?`,
        [index, actorId, orderedIds[index], location]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

// ── Usage source for media references inside nav items ──

async function findNavItemMediaUsages(reference) {
  const [rows] = await pool.query(
    `SELECT label, id FROM navigation_items WHERE media_public_id = ? LIMIT 50`,
    [reference.replace('media://', '')]
  );
  return rows.map((row) => ({
    source: 'navigation_items',
    label: 'Enlace de navegación',
    location: `Navbar — ${row.label}`,
  }));
}

function registerNavUsageSource() {
  usageService.registerUsageSource('navigation_items', findNavItemMediaUsages);
}

module.exports = {
  cacheGet,
  cacheSet,
  invalidateNamespace,
  flushCache,
  upsertSetting,
  saveSettingsDraft,
  getDraftSettings,
  getPublishedSettings,
  publishSettings,
  saveSectionDraft,
  publishSection,
  getSectionDraft,
  getPublishedHeroContent,
  listNavItems,
  getPublishedNavItems,
  saveNavItem,
  createNavItem,
  archiveNavItem,
  publishNavItems,
  reorderNavItems,
  findNavItemMediaUsages,
  registerNavUsageSource,
  ENTITY_SITE_SETTING,
  ENTITY_PAGE_SECTION,
  ENTITY_NAV_ITEM,
};
