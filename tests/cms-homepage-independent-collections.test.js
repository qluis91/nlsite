/**
 * Public homepage must load independently published repeatable collections
 * when the parent section is enabled, even if published_content_json is null.
 *
 * Run: node --require ./config/testBootstrap.js --test tests/cms-homepage-independent-collections.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../config/db');
const repeatable = require('../services/cmsRepeatableService');

const MARKER = 'indep_pub_coll_';

async function resolveHomeSection(sectionKey) {
  const [[row]] = await pool.query(
    `SELECT s.id, s.status, s.is_enabled,
            (s.published_content_json IS NOT NULL) AS has_published_version,
            s.published_content_json
       FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = 'home' AND s.section_key = ?`,
    [sectionKey]
  );
  return row || null;
}

/** Mirrors the public `/` gate after the independent-collections fix. */
async function loadPublishedCollectionIfEnabled(table, sectionKey) {
  const section = await resolveHomeSection(sectionKey);
  if (!(section && Number(section.is_enabled) === 1)) return [];
  return repeatable.getPublishedItems(table, section.id);
}

describe('Public homepage independently published collections', () => {
  let showcaseId;
  let servicesId;
  let heroId;
  let savedShowcaseContent = null;
  let savedShowcaseEnabled = null;
  const cleanup = [];

  before(async () => {
    const showcase = await resolveHomeSection('showcase');
    const services = await resolveHomeSection('services');
    const hero = await resolveHomeSection('hero');
    assert.ok(showcase, 'showcase section must exist');
    assert.ok(services, 'services section must exist');
    assert.ok(hero, 'hero section must exist');
    showcaseId = showcase.id;
    servicesId = services.id;
    heroId = hero.id;
    savedShowcaseContent = showcase.published_content_json;
    savedShowcaseEnabled = showcase.is_enabled;
  });

  after(async () => {
    for (const { table, publicId, entityType } of cleanup) {
      try {
        const [[row]] = await pool.query(`SELECT id FROM ${table} WHERE public_id = ?`, [publicId]);
        if (row) {
          await pool.query('DELETE FROM content_revisions WHERE entity_type = ? AND entity_id = ?', [
            entityType,
            row.id,
          ]);
          await pool.query(`DELETE FROM ${table} WHERE id = ?`, [row.id]);
        }
      } catch (_) {
        /* ignore cleanup errors */
      }
    }
    if (showcaseId != null) {
      await pool.query(
        'UPDATE page_sections SET published_content_json = ?, is_enabled = ? WHERE id = ?',
        [savedShowcaseContent, savedShowcaseEnabled, showcaseId]
      );
    }
    await pool.end();
  });

  it('app.js gates repeatables on is_enabled, not published_content_json', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
    const logoBlock = src.slice(
      src.indexOf("resolveSection('showcase')"),
      src.indexOf("resolveSection('services')")
    );
    assert.match(logoBlock, /section && Number\(section\.is_enabled\) === 1/);
    assert.doesNotMatch(logoBlock, /has_published_version/);

    const socialBlock = src.slice(
      src.indexOf("resolveSection('hero')"),
      src.indexOf("resolveSection('showcase')")
    );
    assert.match(socialBlock, /section && Number\(section\.is_enabled\) === 1/);
    assert.doesNotMatch(socialBlock, /has_published_version/);

    const featureBlock = src.slice(
      src.indexOf("resolveSection('services')"),
      src.indexOf('// Resolve media references')
    );
    assert.match(featureBlock, /section && Number\(section\.is_enabled\) === 1/);
    assert.doesNotMatch(featureBlock, /has_published_version/);
  });

  it('published LogoLoop renders publicly without section published_content_json', async () => {
    const created = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}logo`,
      sort_order: 9901,
      is_visible: 1,
      status: 'draft',
    });
    cleanup.push({ table: 'logo_loop_items', publicId: created.public_id, entityType: 'logo_loop_item' });

    await repeatable.publishCollection('logo_loop_items', showcaseId, 'logoLoop_indep_test');

    // Simulate the failure mode: collection published, section text snapshot absent.
    await pool.query(
      'UPDATE page_sections SET published_content_json = NULL, is_enabled = 1 WHERE id = ?',
      [showcaseId]
    );
    const section = await resolveHomeSection('showcase');
    assert.equal(Number(section.has_published_version), 0);
    assert.equal(Number(section.is_enabled), 1);

    const items = await loadPublishedCollectionIfEnabled('logo_loop_items', 'showcase');
    assert.ok(
      items.some((item) => item.public_id === created.public_id && item.text_content === `${MARKER}logo`),
      'independently published LogoLoop must be readable publicly'
    );
  });

  it('draft LogoLoop items do not render publicly', async () => {
    const created = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}draft`,
      sort_order: 9902,
      is_visible: 1,
      status: 'draft',
    });
    cleanup.push({ table: 'logo_loop_items', publicId: created.public_id, entityType: 'logo_loop_item' });

    await pool.query(
      'UPDATE page_sections SET published_content_json = NULL, is_enabled = 1 WHERE id = ?',
      [showcaseId]
    );

    const items = await loadPublishedCollectionIfEnabled('logo_loop_items', 'showcase');
    assert.equal(items.some((item) => item.public_id === created.public_id), false);
  });

  it('archived/unpublished LogoLoop items do not render after publishCollection', async () => {
    const created = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}archive`,
      sort_order: 9903,
      is_visible: 1,
      status: 'draft',
    });
    cleanup.push({ table: 'logo_loop_items', publicId: created.public_id, entityType: 'logo_loop_item' });

    await repeatable.publishCollection('logo_loop_items', showcaseId, 'logoLoop_indep_test');
    let items = await loadPublishedCollectionIfEnabled('logo_loop_items', 'showcase');
    assert.ok(items.some((item) => item.public_id === created.public_id));

    await repeatable.archiveItem('logo_loop_items', created.public_id);
    await repeatable.publishCollection('logo_loop_items', showcaseId, 'logoLoop_indep_test');

    await pool.query(
      'UPDATE page_sections SET published_content_json = NULL, is_enabled = 1 WHERE id = ?',
      [showcaseId]
    );

    items = await loadPublishedCollectionIfEnabled('logo_loop_items', 'showcase');
    assert.equal(items.some((item) => item.public_id === created.public_id), false);
  });

  it('disabled section blocks independently published LogoLoop', async () => {
    const created = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}disabled`,
      sort_order: 9904,
      is_visible: 1,
      status: 'draft',
    });
    cleanup.push({ table: 'logo_loop_items', publicId: created.public_id, entityType: 'logo_loop_item' });
    await repeatable.publishCollection('logo_loop_items', showcaseId, 'logoLoop_indep_test');

    await pool.query(
      'UPDATE page_sections SET published_content_json = NULL, is_enabled = 0 WHERE id = ?',
      [showcaseId]
    );

    const items = await loadPublishedCollectionIfEnabled('logo_loop_items', 'showcase');
    assert.equal(items.some((item) => item.public_id === created.public_id), false);

    await pool.query('UPDATE page_sections SET is_enabled = 1 WHERE id = ?', [showcaseId]);
  });

  it('published carousel items load without section published_content_json', async () => {
    const created = await repeatable.createItem('home_carousel_items', showcaseId, {
      title: `${MARKER}carousel`,
      description: 'desc',
      media_public_id: null,
      media_alt: 'alt',
      preview_media_public_id: null,
      preview_media_alt: '',
      theme_key: 'graphite',
      sort_order: 9905,
      is_visible: 1,
      status: 'draft',
    });
    cleanup.push({ table: 'home_carousel_items', publicId: created.public_id, entityType: 'carousel_item' });

    await repeatable.publishCollection('home_carousel_items', showcaseId, 'carousel_indep_test');
    await pool.query(
      'UPDATE page_sections SET published_content_json = NULL, is_enabled = 1 WHERE id = ?',
      [showcaseId]
    );

    const items = await loadPublishedCollectionIfEnabled('home_carousel_items', 'showcase');
    assert.ok(items.some((item) => item.public_id === created.public_id));

    const draft = await repeatable.createItem('home_carousel_items', showcaseId, {
      title: `${MARKER}carousel_draft`,
      description: 'draft',
      media_public_id: null,
      media_alt: 'alt',
      sort_order: 9906,
      is_visible: 1,
      status: 'draft',
    });
    cleanup.push({ table: 'home_carousel_items', publicId: draft.public_id, entityType: 'carousel_item' });
    const after = await loadPublishedCollectionIfEnabled('home_carousel_items', 'showcase');
    assert.equal(after.some((item) => item.public_id === draft.public_id), false);
  });

  it('published feature items load without section published_content_json', async () => {
    const [[before]] = await pool.query(
      'SELECT published_content_json, is_enabled FROM page_sections WHERE id = ?',
      [servicesId]
    );

    const created = await repeatable.createItem('home_feature_items', servicesId, {
      title: `${MARKER}feature`,
      description: 'desc',
      url: '/servicios',
      button_label: 'Ver',
      link_aria_label: 'Ver servicio',
      media_public_id: null,
      media_alt: '',
      icon_type: 'builtin',
      icon_key: 'print',
      sort_order: 9907,
      is_visible: 1,
      status: 'draft',
    });
    cleanup.push({ table: 'home_feature_items', publicId: created.public_id, entityType: 'feature_item' });

    await repeatable.publishCollection('home_feature_items', servicesId, 'features_indep_test');
    await pool.query(
      'UPDATE page_sections SET published_content_json = NULL, is_enabled = 1 WHERE id = ?',
      [servicesId]
    );

    const items = await loadPublishedCollectionIfEnabled('home_feature_items', 'services');
    assert.ok(items.some((item) => item.public_id === created.public_id));

    await pool.query(
      'UPDATE page_sections SET published_content_json = ?, is_enabled = ? WHERE id = ?',
      [before.published_content_json, before.is_enabled, servicesId]
    );
  });

  it('published social items load without section published_content_json', async () => {
    const [[before]] = await pool.query(
      'SELECT published_content_json, is_enabled FROM page_sections WHERE id = ?',
      [heroId]
    );

    const created = await repeatable.createItem('home_social_items', heroId, {
      platform: 'youtube',
      label: `${MARKER}social`,
      profile_url: 'https://example.com/channel-indep',
      aria_label: `${MARKER}social`,
      media_public_id: null,
      sort_order: 9908,
      is_visible: 1,
      status: 'draft',
    });
    cleanup.push({ table: 'home_social_items', publicId: created.public_id, entityType: 'social_item' });

    await repeatable.publishCollection('home_social_items', heroId, 'hero_social_indep_test');
    await pool.query(
      'UPDATE page_sections SET published_content_json = NULL, is_enabled = 1 WHERE id = ?',
      [heroId]
    );

    const items = await loadPublishedCollectionIfEnabled('home_social_items', 'hero');
    assert.ok(items.some((item) => item.public_id === created.public_id));

    const draft = await repeatable.createItem('home_social_items', heroId, {
      platform: 'instagram',
      label: `${MARKER}social_draft`,
      profile_url: 'https://example.com/draft',
      aria_label: `${MARKER}social_draft`,
      media_public_id: null,
      sort_order: 9909,
      is_visible: 1,
      status: 'draft',
    });
    cleanup.push({ table: 'home_social_items', publicId: draft.public_id, entityType: 'social_item' });
    const after = await loadPublishedCollectionIfEnabled('home_social_items', 'hero');
    assert.equal(after.some((item) => item.public_id === draft.public_id), false);

    await pool.query(
      'UPDATE page_sections SET published_content_json = ?, is_enabled = ? WHERE id = ?',
      [before.published_content_json, before.is_enabled, heroId]
    );
  });
});
