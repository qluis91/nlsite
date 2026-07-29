/**
 * Phase 1G persistence integration. Uses only a temporary category row.
 */
const { describe, before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const catalog = require('../services/adminCatalogService');
const { migrateCategoryStoreHero } = require('../scripts/migrate-category-store-hero');

let categoryId = null;
const slug = `phase1g-${Date.now()}`;

before(async () => {
  await migrateCategoryStoreHero(pool);
  await migrateCategoryStoreHero(pool);
});

after(async () => {
  if (categoryId) {
    await pool.query(
      "DELETE FROM content_revisions WHERE entity_type = 'category' AND entity_id = ?",
      [categoryId]
    ).catch(() => {});
    await pool.query('DELETE FROM categories WHERE id = ?', [categoryId]).catch(() => {});
  }
  await pool.end();
});

describe('Phase 1G category hero persistence', () => {
  test('create persists all new fields without activating legacy image data', async () => {
    const created = await catalog.createCategory('Phase 1G temporal', slug, {
      description: 'Categoría temporal',
      hero_eyebrow: 'Nuevo',
      hero_title: 'Hero temporal',
      hero_description: 'Descripción temporal',
      hero_media_ref: 'media://11111111-1111-4111-8111-111111111111',
      hero_alt: 'Imagen temporal',
      hero_position: 'top',
      hero_button_label: 'Explorar',
      hero_button_url: '/tienda?category=phase1g',
      hero_button_target: '_blank',
      hero_custom_enabled: true,
    });
    categoryId = created.id;

    const stored = await catalog.getCategoryById(categoryId);
    assert.equal(stored.hero_eyebrow, 'Nuevo');
    assert.equal(stored.hero_media_ref, 'media://11111111-1111-4111-8111-111111111111');
    assert.equal(stored.hero_button_target, '_blank');
    assert.equal(Number(stored.hero_custom_enabled), 1);
    assert.equal(stored.hero_image, null);
  });

  test('update can disable the hero and clear only its media reference', async () => {
    const updated = await catalog.updateCategory(categoryId, 'Phase 1G temporal', slug, {
      description: 'Categoría temporal',
      hero_eyebrow: 'Nuevo',
      hero_title: 'Hero actualizado',
      hero_description: 'Descripción temporal',
      hero_media_ref: null,
      hero_alt: 'Imagen temporal',
      hero_position: 'center',
      hero_button_label: null,
      hero_button_url: null,
      hero_button_target: '_self',
      hero_custom_enabled: false,
    });

    assert.equal(updated.hero_title, 'Hero actualizado');
    assert.equal(updated.hero_media_ref, null);
    assert.equal(Number(updated.hero_custom_enabled), 0);
    assert.equal(updated.hero_button_target, '_self');
  });

  test('create and update are traceable in existing revision history', async () => {
    const [rows] = await pool.query(
      `SELECT action, previous_data, new_data
         FROM content_revisions
        WHERE entity_type = 'category' AND entity_id = ?
        ORDER BY revision_number`,
      [categoryId]
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].action, 'metadata_edit');
    assert.equal(rows[0].previous_data, null);
    assert.ok(rows[0].new_data);
    assert.ok(rows[1].previous_data);
    assert.ok(rows[1].new_data);
  });
});
