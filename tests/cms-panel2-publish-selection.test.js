/**
 * Panel 2 publish must not require unchanged LogoLoop/Carousel drafts.
 *
 * Run: node --require ./config/testBootstrap.js --test tests/cms-panel2-publish-selection.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const repeatable = require('../services/cmsRepeatableService');
const publicationService = require('../services/publicationService');
const {
  selectPanel2PublishModules,
  formatPublishError,
  publishPanel2,
} = require('../controllers/adminPanelsController');

const MARKER = 'p2_pub_sel_';

async function getShowcaseSection() {
  const [[row]] = await pool.query(
    `SELECT s.id, s.content_json, s.published_content_json, s.status, s.is_enabled
       FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = 'home' AND s.section_key = 'showcase'`
  );
  assert.ok(row, 'showcase section required');
  return row;
}

/** Archive leftover drafts so pendingCheck reflects only the scenario under test. */
async function clearCollectionDrafts(sectionId) {
  await pool.query(
    `UPDATE logo_loop_items
        SET status = 'archived', deleted_at = NOW()
      WHERE page_section_id = ? AND status = 'draft' AND deleted_at IS NULL`,
    [sectionId]
  );
  await pool.query(
    `UPDATE home_carousel_items
        SET status = 'archived', deleted_at = NOW()
      WHERE page_section_id = ? AND status = 'draft' AND deleted_at IS NULL`,
    [sectionId]
  );
}

describe('Panel 2 publish module selection', () => {
  let showcaseId;
  let saved = null;
  const cleanup = [];

  before(async () => {
    const section = await getShowcaseSection();
    showcaseId = section.id;
    saved = {
      content_json: section.content_json,
      published_content_json: section.published_content_json,
      status: section.status,
      is_enabled: section.is_enabled,
    };
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
        /* ignore */
      }
    }
    if (showcaseId != null && saved) {
      await pool.query(
        `UPDATE page_sections
            SET content_json = ?, published_content_json = ?, status = ?, is_enabled = ?
          WHERE id = ?`,
        [saved.content_json, saved.published_content_json, saved.status, saved.is_enabled, showcaseId]
      );
    }
    await pool.end();
  });

  it('formatPublishError keeps validation reasons and hides sensitive details', () => {
    assert.equal(
      formatPublishError(new Error('Validación fallida: Panel 2 — Showcase de proyectos: El Panel 2 requiere un encabezado.')),
      'Error al publicar: Validación fallida: Panel 2 — Showcase de proyectos: El Panel 2 requiere un encabezado.'
    );
    assert.equal(formatPublishError(new Error('ER_BAD_FIELD_ERROR: Unknown column')), 'Error al publicar.');
    assert.equal(formatPublishError(new Error('password=secret leaked')), 'Error al publicar.');
    assert.equal(formatPublishError(new Error('')), 'Error al publicar.');
  });

  it('showcase draft + already-published LogoLoop/Carousel publishes successfully', async () => {
    await clearCollectionDrafts(showcaseId);

    // Seed already-published collections with no remaining drafts.
    const logo = await repeatable.createItem(
      'logo_loop_items',
      showcaseId,
      {
        item_type: 'text',
        text_content: `${MARKER}logo_ok`,
        sort_order: 8801,
        is_visible: 1,
        status: 'draft',
      }
    );
    cleanup.push({ table: 'logo_loop_items', publicId: logo.public_id, entityType: 'logo_loop_item' });
    await repeatable.publishCollection('logo_loop_items', showcaseId, 'logoLoop_p2sel');

    const carousel = await repeatable.createItem(
      'home_carousel_items',
      showcaseId,
      {
        title: `${MARKER}carousel_ok`,
        description: 'ok',
        media_public_id: null,
        media_alt: 'alt',
        theme_key: 'graphite',
        sort_order: 8802,
        is_visible: 1,
        status: 'draft',
      }
    );
    cleanup.push({
      table: 'home_carousel_items',
      publicId: carousel.public_id,
      entityType: 'carousel_item',
    });
    await repeatable.publishCollection('home_carousel_items', showcaseId, 'carousel_p2sel');

    // Only general showcase content is pending.
    const draftContent = {
      isVisible: true,
      eyebrow: 'CMS',
      heading: `${MARKER}heading_ok`,
      supportText: 'support',
      carouselLabel: '',
      logoLoopAriaLabel: '',
      carouselControlsAriaLabel: 'Controles',
      carouselPreviousLabel: 'Anterior',
      carouselNextLabel: 'Siguiente',
    };
    await pool.query(
      `UPDATE page_sections
          SET content_json = ?, status = 'draft', is_enabled = 1
        WHERE id = ?`,
      [JSON.stringify(draftContent), showcaseId]
    );

    const modules = await selectPanel2PublishModules();
    assert.deepEqual(modules, ['home.showcase']);

    const result = await publicationService.publishModules(modules, 'module', { actorId: null });
    assert.ok(result);
    assert.equal(result.success !== false, true);

    const [[after]] = await pool.query(
      'SELECT status, published_content_json FROM page_sections WHERE id = ?',
      [showcaseId]
    );
    assert.equal(after.status, 'published');
    const published =
      typeof after.published_content_json === 'string'
        ? JSON.parse(after.published_content_json)
        : after.published_content_json;
    assert.equal(published.heading, `${MARKER}heading_ok`);
  });

  it('LogoLoop draft exists -> included and published', async () => {
    const logo = await repeatable.createItem(
      'logo_loop_items',
      showcaseId,
      {
        item_type: 'text',
        text_content: `${MARKER}logo_draft`,
        sort_order: 8803,
        is_visible: 1,
        status: 'draft',
      }
    );
    cleanup.push({ table: 'logo_loop_items', publicId: logo.public_id, entityType: 'logo_loop_item' });

    await pool.query(
      `UPDATE page_sections SET status = 'draft', content_json = ? WHERE id = ?`,
      [
        JSON.stringify({
          isVisible: true,
          heading: `${MARKER}with_logo_draft`,
          supportText: '',
        }),
        showcaseId,
      ]
    );

    const modules = await selectPanel2PublishModules();
    assert.ok(modules.includes('home.showcase'));
    assert.ok(modules.includes('home.logoLoop'));

    await publicationService.publishModules(modules, 'module', { actorId: null });
    const published = await repeatable.getPublishedItems('logo_loop_items', showcaseId);
    assert.ok(published.some((item) => item.public_id === logo.public_id));
  });

  it('Carousel draft exists -> included and published', async () => {
    const carousel = await repeatable.createItem(
      'home_carousel_items',
      showcaseId,
      {
        title: `${MARKER}carousel_draft`,
        description: 'draft',
        media_public_id: null,
        media_alt: 'alt',
        theme_key: 'graphite',
        sort_order: 8804,
        is_visible: 1,
        status: 'draft',
      }
    );
    cleanup.push({
      table: 'home_carousel_items',
      publicId: carousel.public_id,
      entityType: 'carousel_item',
    });

    await pool.query(
      `UPDATE page_sections SET status = 'draft', content_json = ? WHERE id = ?`,
      [
        JSON.stringify({
          isVisible: true,
          heading: `${MARKER}with_carousel_draft`,
          supportText: '',
        }),
        showcaseId,
      ]
    );

    const modules = await selectPanel2PublishModules();
    assert.ok(modules.includes('home.showcase'));
    assert.ok(modules.includes('home.carousel'));

    await publicationService.publishModules(modules, 'module', { actorId: null });
    const published = await repeatable.getPublishedItems('home_carousel_items', showcaseId);
    assert.ok(published.some((item) => item.public_id === carousel.public_id));
  });

  it('real validation failure still blocks publish', async () => {
    await clearCollectionDrafts(showcaseId);
    await pool.query(
      `UPDATE page_sections SET status = 'draft', content_json = ? WHERE id = ?`,
      [JSON.stringify({ isVisible: true, heading: '', supportText: 'x' }), showcaseId]
    );

    // Ensure collections are not pending so only showcase validation applies.
    const modules = await selectPanel2PublishModules();
    assert.deepEqual(modules, ['home.showcase']);

    await assert.rejects(
      () => publicationService.publishModules(modules, 'module', { actorId: null }),
      /Validación fallida|encabezado/i
    );
  });

  it('publishPanel2 surfaces a useful safe error message', async () => {
    await clearCollectionDrafts(showcaseId);
    await pool.query(
      `UPDATE page_sections SET status = 'draft', content_json = ? WHERE id = ?`,
      [JSON.stringify({ isVisible: true, heading: '', supportText: 'x' }), showcaseId]
    );

    const req = {
      body: { active_tab: 'general' },
      session: {},
    };
    let redirectedTo = null;
    const res = {
      redirect(url) {
        redirectedTo = url;
        return this;
      },
    };

    await publishPanel2(req, res);
    assert.equal(redirectedTo, '/admin/page/home/panel-2?tab=general');
    assert.match(String(req.session.error_msg || ''), /^Error al publicar: /);
    assert.match(String(req.session.error_msg || ''), /encabezado|Validación/i);
    assert.doesNotMatch(String(req.session.error_msg || ''), /ER_|SQLSTATE|password|at\s+\S+\s*\(/i);
  });
});
