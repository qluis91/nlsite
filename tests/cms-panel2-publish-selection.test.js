/**
 * Panel 2 publish selection + archive-aware collection pending/validation.
 *
 * Run: node --require ./config/testBootstrap.js --test tests/cms-panel2-publish-selection.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const repeatable = require('../services/cmsRepeatableService');
const publicationService = require('../services/publicationService');
const moduleRegistry = require('../services/moduleRegistry');
const {
  selectPanel2PublishModules,
  formatPublishError,
  publishPanel2,
} = require('../controllers/adminPanelsController');

const MARKER = 'p2_pub_sel_';
const COLLECTION_TABLES = ['logo_loop_items', 'home_carousel_items'];

async function getShowcaseSection() {
  const [[row]] = await pool.query(
    `SELECT s.id, s.content_json, s.published_content_json, s.status, s.is_enabled
       FROM page_sections s INNER JOIN pages p ON p.id = s.page_id
      WHERE p.page_key = 'home' AND s.section_key = 'showcase'`
  );
  assert.ok(row, 'showcase section required');
  return row;
}

/**
 * Temporarily neutralize foreign pending rows so assertions reflect only rows
 * owned by this suite. Every changed row is restored afterwards.
 */
async function withNeutralizedForeignPending(sectionId, ownedPublicIds, fn) {
  const owned = new Set(ownedPublicIds);
  const snapshots = [];

  for (const table of COLLECTION_TABLES) {
    const [rows] = await pool.query(
      `SELECT id, public_id, status, deleted_at, published_data, published_at, updated_by, is_visible, sort_order
         FROM ${table}
        WHERE page_section_id = ?
          AND (status IN ('draft', 'archived') OR published_data IS NULL)`,
      [sectionId]
    );
    for (const row of rows) {
      if (owned.has(row.public_id)) continue;
      snapshots.push({ table, row });
      await pool.query(
        `UPDATE ${table}
            SET status = 'published',
                deleted_at = NULL,
                published_data = COALESCE(published_data, ?)
          WHERE id = ?`,
        [JSON.stringify({ _test_neutralized: true, public_id: row.public_id }), row.id]
      );
    }
  }

  try {
    return await fn();
  } finally {
    for (const { table, row } of snapshots) {
      await pool.query(
        `UPDATE ${table}
            SET status = ?, deleted_at = ?, published_data = ?, published_at = ?,
                updated_by = ?, is_visible = ?, sort_order = ?
          WHERE id = ?`,
        [
          row.status,
          row.deleted_at,
          row.published_data,
          row.published_at,
          row.updated_by,
          row.is_visible,
          row.sort_order,
          row.id,
        ]
      );
    }
  }
}

describe('Panel 2 publish module selection', () => {
  let showcaseId;
  let saved = null;
  const cleanup = [];

  function track(table, publicId, entityType) {
    cleanup.push({ table, publicId, entityType });
    return publicId;
  }

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

  it('unchanged fully-published collection is not selected', async () => {
    const logo = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}logo_ok`,
      sort_order: 8801,
      is_visible: 1,
      status: 'draft',
    });
    track('logo_loop_items', logo.public_id, 'logo_loop_item');
    await repeatable.publishCollection('logo_loop_items', showcaseId, 'logoLoop_p2sel');

    const carousel = await repeatable.createItem('home_carousel_items', showcaseId, {
      title: `${MARKER}carousel_ok`,
      description: 'ok',
      media_public_id: null,
      media_alt: 'alt',
      theme_key: 'graphite',
      sort_order: 8802,
      is_visible: 1,
      status: 'draft',
    });
    track('home_carousel_items', carousel.public_id, 'carousel_item');
    await repeatable.publishCollection('home_carousel_items', showcaseId, 'carousel_p2sel');

    await pool.query(
      `UPDATE page_sections
          SET content_json = ?, status = 'draft', is_enabled = 1
        WHERE id = ?`,
      [
        JSON.stringify({
          isVisible: true,
          eyebrow: 'CMS',
          heading: `${MARKER}heading_ok`,
          supportText: 'support',
          carouselLabel: '',
          logoLoopAriaLabel: '',
          carouselControlsAriaLabel: 'Controles',
          carouselPreviousLabel: 'Anterior',
          carouselNextLabel: 'Siguiente',
        }),
        showcaseId,
      ]
    );

    await withNeutralizedForeignPending(
      showcaseId,
      [logo.public_id, carousel.public_id],
      async () => {
        const modules = await selectPanel2PublishModules();
        assert.deepEqual(modules, ['home.showcase']);

        const result = await publicationService.publishModules(modules, 'module', { actorId: null });
        assert.ok(result);

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
      }
    );
  });

  it('visible draft is selected and published', async () => {
    const logo = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}logo_draft`,
      sort_order: 8803,
      is_visible: 1,
      status: 'draft',
    });
    track('logo_loop_items', logo.public_id, 'logo_loop_item');

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

    await withNeutralizedForeignPending(showcaseId, [logo.public_id], async () => {
      const modules = await selectPanel2PublishModules();
      assert.ok(modules.includes('home.showcase'));
      assert.ok(modules.includes('home.logoLoop'));

      await publicationService.publishModules(modules, 'module', { actorId: null });
      const published = await repeatable.getPublishedItems('logo_loop_items', showcaseId);
      assert.ok(published.some((item) => item.public_id === logo.public_id));
    });
  });

  it('carousel draft is selected and published', async () => {
    const carousel = await repeatable.createItem('home_carousel_items', showcaseId, {
      title: `${MARKER}carousel_draft`,
      description: 'draft',
      media_public_id: null,
      media_alt: 'alt',
      theme_key: 'graphite',
      sort_order: 8804,
      is_visible: 1,
      status: 'draft',
    });
    track('home_carousel_items', carousel.public_id, 'carousel_item');

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

    await withNeutralizedForeignPending(showcaseId, [carousel.public_id], async () => {
      const modules = await selectPanel2PublishModules();
      assert.ok(modules.includes('home.showcase'));
      assert.ok(modules.includes('home.carousel'));

      await publicationService.publishModules(modules, 'module', { actorId: null });
      const published = await repeatable.getPublishedItems('home_carousel_items', showcaseId);
      assert.ok(published.some((item) => item.public_id === carousel.public_id));
    });
  });

  it('archived previously-published item is selected and clears published_data', async () => {
    const keep = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}logo_keep`,
      sort_order: 8805,
      is_visible: 1,
      status: 'draft',
    });
    track('logo_loop_items', keep.public_id, 'logo_loop_item');

    const doomed = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}logo_archive`,
      sort_order: 8806,
      is_visible: 1,
      status: 'draft',
    });
    track('logo_loop_items', doomed.public_id, 'logo_loop_item');

    await repeatable.publishCollection('logo_loop_items', showcaseId, 'logoLoop_p2sel');
    let published = await repeatable.getPublishedItems('logo_loop_items', showcaseId);
    assert.ok(published.some((item) => item.public_id === doomed.public_id));

    await repeatable.archiveItem('logo_loop_items', doomed.public_id);

    const [[archivedRow]] = await pool.query(
      'SELECT status, deleted_at, published_data FROM logo_loop_items WHERE public_id = ?',
      [doomed.public_id]
    );
    assert.equal(archivedRow.status, 'archived');
    assert.ok(archivedRow.deleted_at);
    assert.ok(archivedRow.published_data);

    await pool.query(
      `UPDATE page_sections SET status = 'draft', content_json = ? WHERE id = ?`,
      [
        JSON.stringify({
          isVisible: true,
          heading: `${MARKER}with_archive`,
          supportText: '',
        }),
        showcaseId,
      ]
    );

    await withNeutralizedForeignPending(
      showcaseId,
      [keep.public_id, doomed.public_id],
      async () => {
        assert.equal(await moduleRegistry.getModule('home.logoLoop').pendingCheck(), true);
        const modules = await selectPanel2PublishModules();
        assert.ok(modules.includes('home.logoLoop'));

        await publicationService.publishModules(modules, 'module', { actorId: null });

        const [[after]] = await pool.query(
          'SELECT status, published_data FROM logo_loop_items WHERE public_id = ?',
          [doomed.public_id]
        );
        assert.equal(after.status, 'archived');
        assert.equal(after.published_data, null);

        published = await repeatable.getPublishedItems('logo_loop_items', showcaseId);
        assert.equal(published.some((item) => item.public_id === doomed.public_id), false);
        assert.ok(published.some((item) => item.public_id === keep.public_id));
      }
    );
  });

  it('archive one item while other published visible items remain succeeds', async () => {
    const a = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}logo_pair_a`,
      sort_order: 8807,
      is_visible: 1,
      status: 'draft',
    });
    const b = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}logo_pair_b`,
      sort_order: 8808,
      is_visible: 1,
      status: 'draft',
    });
    track('logo_loop_items', a.public_id, 'logo_loop_item');
    track('logo_loop_items', b.public_id, 'logo_loop_item');
    await repeatable.publishCollection('logo_loop_items', showcaseId, 'logoLoop_p2sel');
    await repeatable.archiveItem('logo_loop_items', b.public_id);

    await withNeutralizedForeignPending(showcaseId, [a.public_id, b.public_id], async () => {
      const validation = await moduleRegistry.getModule('home.logoLoop').validate();
      assert.equal(validation.valid, true);

      const modules = await selectPanel2PublishModules();
      assert.ok(modules.includes('home.logoLoop'));
      await publicationService.publishModules(['home.logoLoop'], 'module', { actorId: null });

      const published = await repeatable.getPublishedItems('logo_loop_items', showcaseId);
      assert.ok(published.some((item) => item.public_id === a.public_id));
      assert.equal(published.some((item) => item.public_id === b.public_id), false);
    });
  });

  it('archiving the last visible item is blocked by validation', async () => {
    const only = await repeatable.createItem('logo_loop_items', showcaseId, {
      item_type: 'text',
      text_content: `${MARKER}logo_last`,
      sort_order: 8809,
      is_visible: 1,
      status: 'draft',
    });
    track('logo_loop_items', only.public_id, 'logo_loop_item');
    await repeatable.publishCollection('logo_loop_items', showcaseId, 'logoLoop_p2sel');
    await repeatable.archiveItem('logo_loop_items', only.public_id);

    await withNeutralizedForeignPending(showcaseId, [only.public_id], async () => {
      // Also neutralize other non-owned published visible survivors so "last item" is true.
      const [survivors] = await pool.query(
        `SELECT id, public_id, status, deleted_at, published_data, published_at, updated_by, is_visible, sort_order
           FROM logo_loop_items
          WHERE page_section_id = ?
            AND public_id <> ?
            AND status <> 'archived'
            AND deleted_at IS NULL
            AND is_visible = 1`,
        [showcaseId, only.public_id]
      );
      const survivorSnapshots = [];
      for (const row of survivors) {
        survivorSnapshots.push(row);
        await pool.query(
          `UPDATE logo_loop_items
              SET status = 'archived', deleted_at = NOW(), is_visible = 0
            WHERE id = ?`,
          [row.id]
        );
      }

      try {
        const validation = await moduleRegistry.getModule('home.logoLoop').validate();
        assert.equal(validation.valid, false);
        assert.match((validation.errors || []).join(' '), /elemento visible/i);

        await assert.rejects(
          () =>
            publicationService.publishModules(['home.logoLoop'], 'module', {
              actorId: null,
            }),
          /Validación fallida|elemento visible/i
        );
      } finally {
        for (const row of survivorSnapshots) {
          await pool.query(
            `UPDATE logo_loop_items
                SET status = ?, deleted_at = ?, published_data = ?, published_at = ?,
                    updated_by = ?, is_visible = ?, sort_order = ?
              WHERE id = ?`,
            [
              row.status,
              row.deleted_at,
              row.published_data,
              row.published_at,
              row.updated_by,
              row.is_visible,
              row.sort_order,
              row.id,
            ]
          );
        }
      }
    });
  });

  it('real showcase validation failure still blocks publish', async () => {
    await pool.query(
      `UPDATE page_sections SET status = 'draft', content_json = ? WHERE id = ?`,
      [JSON.stringify({ isVisible: true, heading: '', supportText: 'x' }), showcaseId]
    );

    await withNeutralizedForeignPending(showcaseId, [], async () => {
      const modules = await selectPanel2PublishModules();
      assert.deepEqual(modules, ['home.showcase']);
      await assert.rejects(
        () => publicationService.publishModules(modules, 'module', { actorId: null }),
        /Validación fallida|encabezado/i
      );
    });
  });

  it('publishPanel2 surfaces a useful safe error message', async () => {
    await pool.query(
      `UPDATE page_sections SET status = 'draft', content_json = ? WHERE id = ?`,
      [JSON.stringify({ isVisible: true, heading: '', supportText: 'x' }), showcaseId]
    );

    await withNeutralizedForeignPending(showcaseId, [], async () => {
      const req = { body: { active_tab: 'general' }, session: {} };
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
});
