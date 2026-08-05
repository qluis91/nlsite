const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const pool = require('../config/db');
const { withDeadlockRetry } = require('../services/mysqlRetry');
const publishing = require('../services/cmsPublishingService');
const {
  inspectCmsSchema,
  assertCmsSchemaReady,
} = require('../services/cmsSchemaReadinessService');
const {
  migrateCmsPhase1aSaveRepair,
} = require('../scripts/migrate-cms-phase1a-save-repair');
const { startTestServer, stopTestServer } = require('./testServer');

const root = path.resolve(__dirname, '..');
const marker = `panel1_save_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const adminEmail = `${marker}@example.invalid`;
const password = `Cms-${crypto.randomBytes(8).toString('hex')}!`;
const jar = {};
let baseUrl;
let adminId;
let sectionId;
let originalSection;
let originalSocialCount;

function assertSafeLocalDatabase() {
  const { assertSafeTestDatabase } = require('../config/testDatabaseGuard');
  assertSafeTestDatabase({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || '',
  }, { requireMutationOptIn: true });
}

async function request(method, requestPath, fields = null) {
  const headers = {};
  let body;
  if (fields) {
    body = new URLSearchParams(fields).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (jar.cookie) headers.Cookie = jar.cookie;
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers,
    body,
    redirect: 'manual',
  });
  const cookie = response.headers.get('set-cookie');
  if (cookie) jar.cookie = cookie.split(';')[0];
  return {
    status: response.status,
    location: response.headers.get('location') || '',
    requestId: response.headers.get('x-request-id') || '',
    text: await response.text(),
  };
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'Panel 1 must render a CSRF token');
  return match[1];
}

function heroPayload(token, overrides = {}) {
  return {
    _csrf: token,
    is_visible: '1',
    eyebrow: `${marker} eyebrow`,
    heading: `${marker} draft heading`,
    description: `${marker} draft description`,
    primary_label: `${marker} primary`,
    primary_url: '#productos',
    primary_target: '_self',
    primary_visible: '1',
    secondary_label: `${marker} secondary`,
    secondary_url: '#servicios',
    secondary_target: '_self',
    secondary_visible: '1',
    background_media: '',
    model_media: '',
    model_fallback: '',
    model_enabled: '1',
    model_scale: '1',
    auto_rotate_speed: '1',
    model_pos_x: '0',
    model_pos_y: '0',
    model_pos_z: '0',
    model_rot_x: '0',
    model_rot_y: '0',
    model_rot_z: '0',
    auto_rotate: '1',
    hero_aria_label: 'Hero',
    loading_aria_label: 'Cargando',
    model_error_text: 'No disponible',
    retry_label: 'Reintentar',
    model_poster_alt: 'Poster',
    model_fallback_alt: 'Respaldo',
    social_aria_label: 'Redes sociales',
    ...overrides,
  };
}

async function login() {
  const page = await request('GET', '/auth/login?returnTo=%2Fadmin');
  const response = await request('POST', '/auth/login', {
    email: adminEmail,
    password,
    _csrf: csrf(page.text),
    returnTo: '/admin',
  });
  assert.equal(response.status, 302);
  assert.equal(response.location, '/admin');
}

test.before(async () => {
  assertSafeLocalDatabase();
  const [[section]] = await pool.query(
    `SELECT s.* FROM page_sections s INNER JOIN pages p ON p.id=s.page_id
      WHERE p.page_key='home' AND s.section_key='hero' LIMIT 1`
  );
  assert.ok(section);
  sectionId = section.id;
  originalSection = section;
  const [[social]] = await pool.query(
    'SELECT COUNT(*) total FROM home_social_items WHERE page_section_id = ?',
    [sectionId]
  );
  originalSocialCount = Number(social.total);

  const published = {
    eyebrow: `${marker} published eyebrow`,
    heading: `${marker} published heading`,
    description: `${marker} published description`,
    primaryButton: { label: 'Published primary', url: '#published', target: '_self', visible: true },
    secondaryButton: { label: 'Published secondary', url: '#published-secondary', target: '_self', visible: true },
    backgroundMedia: null,
    modelMedia: null,
    modelFallbackMedia: null,
    modelEnabled: true,
    isVisible: true,
  };
  await pool.query(
    `UPDATE page_sections
        SET content_json = ?, style_json = NULL, published_content_json = ?,
            published_style_json = NULL, status = 'draft', is_enabled = 1
      WHERE id = ?`,
    [JSON.stringify({ isVisible: true, retryLabel: 'Draft retry' }), JSON.stringify(published), sectionId]
  );

  const hash = await bcrypt.hash(password, 8);
  const [userResult] = await pool.query(
    'INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,1,1)',
    [`Admin ${marker}`, adminEmail, hash]
  );
  adminId = userResult.insertId;

  await withDeadlockRetry(() => migrateCmsPhase1aSaveRepair());
  await withDeadlockRetry(() => migrateCmsPhase1aSaveRepair());
  ({ baseUrl } = await startTestServer());
  await login();
});

test.after(async () => {
  await stopTestServer();
  await pool.query('DELETE FROM content_revisions WHERE changed_by = ?', [adminId]).catch(() => {});
  await pool.query(
    'DELETE FROM publication_batch_items WHERE batch_id IN (SELECT id FROM publication_batches WHERE created_by = ?)',
    [adminId]
  ).catch(() => {});
  await pool.query('DELETE FROM publication_batches WHERE created_by = ?', [adminId]).catch(() => {});
  await pool.query('DELETE FROM sessions WHERE data LIKE ?', [`%${marker}%`]).catch(() => {});
  await pool.query(
    `UPDATE page_sections
        SET content_json=?, style_json=?, published_content_json=?, published_style_json=?,
            status=?, is_enabled=?, version=?, updated_by=?, published_at=?
      WHERE id=?`,
    [
      originalSection.content_json,
      originalSection.style_json,
      originalSection.published_content_json,
      originalSection.published_style_json,
      originalSection.status,
      originalSection.is_enabled,
      originalSection.version,
      originalSection.updated_by,
      originalSection.published_at,
      sectionId,
    ]
  );
  await pool.query('DELETE FROM users WHERE id = ?', [adminId]);
  await stopTestServer();
  await pool.end();
});

test('repair migration restores missing draft fields from published data without changing published content', async () => {
  const [[row]] = await pool.query(
    'SELECT content_json, published_content_json FROM page_sections WHERE id = ?',
    [sectionId]
  );
  const draft = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
  const published = typeof row.published_content_json === 'string'
    ? JSON.parse(row.published_content_json)
    : row.published_content_json;
  assert.equal(draft.heading, `${marker} published heading`);
  assert.equal(draft.retryLabel, 'Draft retry');
  assert.equal(published.heading, `${marker} published heading`);
});

test('Panel 1 form has an explicit association and relies on visible server validation', async () => {
  const page = await request('GET', '/admin/page/home/panel-1');
  assert.equal(page.status, 200);
  assert.match(page.text, /id="panel1-draft-form"[^>]*action="\/admin\/page\/home\/panel-1\/save"[^>]*method="POST"[^>]*novalidate/);
  assert.match(page.text, /type="submit" form="panel1-draft-form">Guardar cambios/);
  assert.doesNotMatch(page.text, /name="heading"[^>]*required/);
  assert.match(page.text, new RegExp(`value="${marker} published heading"`));
});

test('invalid Panel 1 save returns 422, preserves submitted values, and never redirects', async () => {
  const page = await request('GET', '/admin/page/home/panel-1');
  const invalidLabel = `${marker} preserved invalid CTA`;
  const response = await request('POST', '/admin/page/home/panel-1/save', heroPayload(csrf(page.text), {
    heading: '',
    primary_label: invalidLabel,
  }));
  assert.equal(response.status, 422);
  assert.equal(response.location, '');
  assert.ok(response.requestId);
  assert.match(response.text, /No se pudo guardar el borrador/);
  assert.match(response.text, new RegExp(invalidLabel));

  const [[row]] = await pool.query('SELECT content_json FROM page_sections WHERE id = ?', [sectionId]);
  const draft = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
  assert.notEqual(draft.primaryButton?.label, invalidLabel);
});

test('transaction failure rolls back and preserves the previous draft', async () => {
  const [[before]] = await pool.query('SELECT content_json, version FROM page_sections WHERE id = ?', [sectionId]);
  const circular = { heading: `${marker} must rollback` };
  circular.self = circular;
  await assert.rejects(
    publishing.saveSectionDraft('home', 'hero', circular, {}, { actorId: adminId }),
    /circular/i
  );
  const [[after]] = await pool.query('SELECT content_json, version FROM page_sections WHERE id = ?', [sectionId]);
  assert.equal(after.content_json, before.content_json);
  assert.equal(after.version, before.version);
});

test('save persists, reload reads the draft, public stays published until Publish', async () => {
  const socialBefore = await pool.query(
    'SELECT COUNT(*) total FROM home_social_items WHERE page_section_id = ?',
    [sectionId]
  );
  const publicBefore = await request('GET', '/');
  assert.match(publicBefore.text, new RegExp(`${marker} published eyebrow`));
  assert.doesNotMatch(publicBefore.text, new RegExp(`${marker} eyebrow`));

  const editor = await request('GET', '/admin/page/home/panel-1');
  const saved = await request(
    'POST',
    '/admin/page/home/panel-1/save',
    heroPayload(csrf(editor.text))
  );
  assert.equal(saved.status, 302);
  assert.equal(saved.location, '/admin/page/home/panel-1');
  assert.ok(saved.requestId);

  const [[draftRow]] = await pool.query(
    'SELECT content_json, published_content_json, status FROM page_sections WHERE id = ?',
    [sectionId]
  );
  const draft = typeof draftRow.content_json === 'string'
    ? JSON.parse(draftRow.content_json)
    : draftRow.content_json;
  const published = typeof draftRow.published_content_json === 'string'
    ? JSON.parse(draftRow.published_content_json)
    : draftRow.published_content_json;
  assert.equal(draft.heading, `${marker} draft heading`);
  assert.equal(draft.primaryButton.label, `${marker} primary`);
  assert.equal(published.heading, `${marker} published heading`);
  assert.equal(draftRow.status, 'draft');

  const reloaded = await request('GET', '/admin/page/home/panel-1');
  assert.match(reloaded.text, new RegExp(`${marker} draft heading`));
  assert.match(reloaded.text, new RegExp(`${marker} primary`));
  assert.match(reloaded.text, /Borrador guardado/);

  const publicStillPublished = await request('GET', '/');
  assert.match(publicStillPublished.text, new RegExp(`${marker} published eyebrow`));
  assert.doesNotMatch(publicStillPublished.text, new RegExp(`${marker} eyebrow`));

  const publishedResponse = await request('POST', '/admin/page/home/panel-1/publish', {
    _csrf: csrf(reloaded.text),
  });
  assert.equal(publishedResponse.status, 302);

  const publicAfter = await request('GET', '/');
  assert.match(publicAfter.text, new RegExp(`${marker} eyebrow`));

  const [[socialAfter]] = await pool.query(
    'SELECT COUNT(*) total FROM home_social_items WHERE page_section_id = ?',
    [sectionId]
  );
  assert.equal(Number(socialBefore[0][0].total), originalSocialCount);
  assert.equal(Number(socialAfter.total), originalSocialCount);
});

test('missing CMS schema is reported explicitly and editor state clears only after navigation success', async () => {
  const fakeDb = { query: async () => [[]] };
  const result = await inspectCmsSchema(fakeDb, { force: true });
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes('page_sections.content_json'));
  await assert.rejects(
    assertCmsSchemaReady(fakeDb, { force: true }),
    (error) => error.code === 'CMS_SCHEMA_NOT_READY' && error.status === 503
  );

  const editorState = fs.readFileSync(path.join(root, 'public/js/admin/cms-editor-state.js'), 'utf8');
  assert.match(editorState, /form\.noValidate = true/);
  assert.match(editorState, /setState\('saving'\)/);
  assert.doesNotMatch(editorState, /setState\('saved'\).*submit/s);
});

test('the six CMS editor families retain POST Save routes and server-side error rendering', () => {
  const contracts = [
    ['views/pages/admin/page/panel1.ejs', '/admin/page/home/panel-1/save'],
    ['views/pages/admin/page/panel2.ejs', '/admin/page/home/panel-2/draft'],
    ['views/pages/admin/page/panel3.ejs', '/admin/page/home/panel-3/draft'],
    ['views/pages/admin/page/navbar.ejs', '/admin/page/navbar/save'],
    ['views/pages/admin/page/global-settings.ejs', '/admin/page/global-settings/save'],
    ['views/pages/admin/page/page-seo.ejs', '/admin/page/page-seo/save'],
  ];
  for (const [file, action] of contracts) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, new RegExp(`action="${action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(source, /method="POST"/);
    assert.match(source, /data-cms-editor-form[^>]*novalidate/);
  }

  const panelController = fs.readFileSync(path.join(root, 'controllers/adminPanelsController.js'), 'utf8');
  const globalController = fs.readFileSync(path.join(root, 'controllers/adminGlobalSettingsController.js'), 'utf8');
  const seoController = fs.readFileSync(path.join(root, 'controllers/adminPageSeoController.js'), 'utf8');
  assert.match(panelController, /cmsEditorOverride/);
  assert.match(globalController, /cmsSettingsOverride/);
  assert.match(seoController, /cmsSeoOverride/);
});
