const { describe, before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const publishing = require('../services/cmsPublishingService');
const publicationService = require('../services/publicationService');
const cmsContent = require('../services/cmsContentService');
const { migrateAboutPageCms } = require('../scripts/migrate-about-page-cms');
const { startTestServer, stopTestServer } = require('./testServer');
const { restoreRevision } = require('../controllers/adminPublishingController');

let server;
let sectionId;
let snapshot;
let revisionBaseline = 0;
let batchBaseline = 0;
const marker = `Phase 1H ${Date.now()}`;

before(async () => {
  await migrateAboutPageCms(pool);
  await migrateAboutPageCms(pool);
  const [[row]] = await pool.query(
    `SELECT s.* FROM page_sections s
      INNER JOIN pages p ON p.id = s.page_id
     WHERE p.page_key = 'nosotros' AND s.section_key = 'about-content'`
  );
  sectionId = row.id;
  snapshot = row;
  const [[rev]] = await pool.query(
    "SELECT COALESCE(MAX(id), 0) AS id FROM content_revisions WHERE entity_type = 'page_section' AND entity_id = ?",
    [sectionId]
  );
  revisionBaseline = Number(rev.id);
  const [[batch]] = await pool.query('SELECT COALESCE(MAX(id), 0) AS id FROM publication_batches');
  batchBaseline = Number(batch.id);
  server = await startTestServer();
});

after(async () => {
  await stopTestServer().catch(() => {});
  if (snapshot && sectionId) {
    await pool.query(
      `UPDATE page_sections SET
         content_json=?, style_json=?, published_content_json=?, published_style_json=?,
         sort_order=?, is_enabled=?, status=?, version=?, published_at=?, updated_by=?
       WHERE id=?`,
      [
        snapshot.content_json, snapshot.style_json,
        snapshot.published_content_json, snapshot.published_style_json,
        snapshot.sort_order, snapshot.is_enabled, snapshot.status, snapshot.version,
        snapshot.published_at, snapshot.updated_by, sectionId,
      ]
    ).catch(() => {});
    await pool.query('DELETE FROM publication_batch_items WHERE batch_id > ?', [batchBaseline]).catch(() => {});
    await pool.query('DELETE FROM publication_batches WHERE id > ?', [batchBaseline]).catch(() => {});
    await pool.query(
      "DELETE FROM content_revisions WHERE entity_type='page_section' AND entity_id=? AND id>?",
      [sectionId, revisionBaseline]
    ).catch(() => {});
  }
  publishing.invalidateNamespace('sc_nosotros');
  await pool.end();
});

describe('Phase 1H — draft, publish and public isolation', () => {
  test('migration is idempotent and seeds one published page section/navbar item', async () => {
    const [[pages]] = await pool.query("SELECT COUNT(*) AS count FROM pages WHERE page_key='nosotros'");
    const [[sections]] = await pool.query(
      `SELECT COUNT(*) AS count FROM page_sections s
        INNER JOIN pages p ON p.id=s.page_id
       WHERE p.page_key='nosotros' AND s.section_key='about-content'`
    );
    const [[nav]] = await pool.query(
      "SELECT COUNT(*) AS count FROM navigation_items WHERE location='home' AND url='/nosotros' AND deleted_at IS NULL"
    );
    assert.equal(Number(pages.count), 1);
    assert.equal(Number(sections.count), 1);
    assert.equal(Number(nav.count), 1);
  });

  test('public route and navbar render the published snapshot', async () => {
    const response = await fetch(`${server.baseUrl}/nosotros`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /href="\/nosotros"/);
    assert.match(html, /aria-current="page"/);
    assert.match(html, /<meta name="description"/);
    assert.match(html, /rel="canonical"/);
  });

  test('Save changes only the draft and records a field-level revision', async () => {
    const draft = await publishing.getSectionDraft('nosotros', 'about-content');
    const previousPublished = await cmsContent.getPublishedSectionContent('nosotros', 'about-content', null);
    const changed = structuredClone(draft.content);
    changed.hero.title = marker;
    await publishing.saveSectionDraft('nosotros', 'about-content', changed, draft.style, {
      expectedVersion: draft.version,
    });

    const publicBeforePublish = await cmsContent.getPublishedSectionContent('nosotros', 'about-content', null);
    assert.equal(publicBeforePublish.hero.title, previousPublished.hero.title);
    assert.notEqual(publicBeforePublish.hero.title, marker);

    const [[revision]] = await pool.query(
      `SELECT action, previous_data, new_data
         FROM content_revisions
        WHERE entity_type='page_section' AND entity_id=? AND id>?
        ORDER BY id DESC LIMIT 1`,
      [sectionId, revisionBaseline]
    );
    assert.equal(revision.action, 'metadata_edit');
    assert.ok(revision.previous_data);
    assert.ok(revision.new_data);
  });

  test('stale version is rejected without overwriting the stored draft', async () => {
    const current = await publishing.getSectionDraft('nosotros', 'about-content');
    const attempted = structuredClone(current.content);
    attempted.hero.title = 'No debe persistir';
    await assert.rejects(
      publishing.saveSectionDraft('nosotros', 'about-content', attempted, current.style, {
        expectedVersion: Number(current.version) - 1,
      }),
      (error) => error.code === 'CMS_VERSION_CONFLICT'
    );
    const persisted = await publishing.getSectionDraft('nosotros', 'about-content');
    assert.equal(persisted.content.hero.title, marker);
  });

  test('Publish updates public output immediately from the saved draft', async () => {
    await publicationService.publishModules(['nosotros.about-content'], 'module');
    const published = await cmsContent.getPublishedSectionContent('nosotros', 'about-content', null);
    assert.equal(published.hero.title, marker);
    const response = await fetch(`${server.baseUrl}/nosotros`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, new RegExp(marker));
  });

  test('history contains publish data and remains restorable as a page_section draft', async () => {
    const [rows] = await pool.query(
      `SELECT action, previous_data, new_data
         FROM content_revisions
        WHERE entity_type='page_section' AND entity_id=? AND id>?
        ORDER BY id ASC`,
      [sectionId, revisionBaseline]
    );
    assert.ok(rows.some((row) => row.action === 'metadata_edit'));
    assert.ok(rows.some((row) => row.action === 'publish'));
    assert.ok(rows.every((row) => row.previous_data || row.new_data));

    const [[sourceRevision]] = await pool.query(
      `SELECT id FROM content_revisions
        WHERE entity_type='page_section' AND entity_id=? AND id>? AND action='metadata_edit'
        ORDER BY id ASC LIMIT 1`,
      [sectionId, revisionBaseline]
    );
    let redirect = '';
    await restoreRevision(
      { params: { id: String(sourceRevision.id) }, body: { publish: '0' }, user: null },
      { redirect(location) { redirect = location; return location; } },
      (error) => { throw error; }
    );
    assert.match(redirect, /\/admin\/page\/history\?saved=/);
    const restoredDraft = await publishing.getSectionDraft('nosotros', 'about-content');
    assert.equal(restoredDraft.status, 'draft');
    const [[restoreRow]] = await pool.query(
      `SELECT action, source_revision_id FROM content_revisions
        WHERE entity_type='page_section' AND entity_id=? AND id>? AND action='restore'
        ORDER BY id DESC LIMIT 1`,
      [sectionId, revisionBaseline]
    );
    assert.equal(restoreRow.action, 'restore');
    assert.equal(Number(restoreRow.source_revision_id), Number(sourceRevision.id));
  });
});
