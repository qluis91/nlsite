/**
 * Phase 2E-D Legal Pages — Privacy, Terms, Data Deletion.
 *
 * Tests public legal routes required for Meta OAuth compliance.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, stopTestServer } = require('./testServer');

let baseUrl;

test.before(async () => {
  const { baseUrl: bUrl } = await startTestServer();
  baseUrl = bUrl.replace(/\/$/, '');
});

test.after(async () => {
  await stopTestServer();
});

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
  });
  return {
    status: response.status,
    text: await response.text(),
  };
}

// ═══════════════════════════════════════
// Privacy Policy (/privacidad)
// ═══════════════════════════════════════

test('GET /privacidad returns 200 without authentication', async () => {
  const res = await request('/privacidad');
  assert.equal(res.status, 200);
});

test('GET /privacidad renders page title', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /Política de Privacidad/);
});

test('GET /privacidad mentions site name', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /[nN]inja[Ll]ab/);
});

test('GET /privacidad mentions Meta / Facebook / Instagram', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /Facebook/);
  assert.match(res.text, /Instagram/);
});

test('GET /privacidad mentions token protection / encryption', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /[Cc]ifrad|[Tt]oken/);
});

test('GET /privacidad mentions TikTok and YouTube', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /TikTok/);
  assert.match(res.text, /YouTube/);
});

test('GET /privacidad mentions user rights', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /[Dd]erechos/);
  assert.match(res.text, /[Aa]cceso/);
});

test('GET /privacidad does not expose env secrets', async () => {
  const res = await request('/privacidad');
  assert.doesNotMatch(res.text, /SOCIAL_TOKEN_ENCRYPTION_KEY/);
  assert.doesNotMatch(res.text, /TIKTOK_CLIENT_SECRET/);
  assert.doesNotMatch(res.text, /META_APP_SECRET/);
  assert.doesNotMatch(res.text, /YOUTUBE_API_KEY/);
});

test('GET /privacidad does not expose DB implementation', async () => {
  const res = await request('/privacidad');
  assert.doesNotMatch(res.text, /social_token_secrets/);
  assert.doesNotMatch(res.text, /social_integrations/);
  assert.doesNotMatch(res.text, /encrypted_data/);
});

// ═══════════════════════════════════════
// Terms of Service (/terminos)
// ═══════════════════════════════════════

test('GET /terminos returns 200 without authentication', async () => {
  const res = await request('/terminos');
  assert.equal(res.status, 200);
});

test('GET /terminos renders page title', async () => {
  const res = await request('/terminos');
  assert.match(res.text, /Términos de Servicio/);
});

test('GET /terminos mentions Costa Rican law', async () => {
  const res = await request('/terminos');
  assert.match(res.text, /Costa Rica/);
});

test('GET /terminos mentions social media platforms', async () => {
  const res = await request('/terminos');
  assert.match(res.text, /Facebook/);
  assert.match(res.text, /Instagram/);
  assert.match(res.text, /TikTok/);
  assert.match(res.text, /YouTube/);
});

test('GET /terminos renders site name', async () => {
  const res = await request('/terminos');
  assert.match(res.text, /[nN]inja[Ll]ab/);
});

test('GET /terminos does not expose env secrets', async () => {
  const res = await request('/terminos');
  assert.doesNotMatch(res.text, /SOCIAL_TOKEN_ENCRYPTION_KEY/);
  assert.doesNotMatch(res.text, /TIKTOK_CLIENT_SECRET/);
  assert.doesNotMatch(res.text, /encrypted_data/);
});

// ═══════════════════════════════════════
// Data Deletion (/eliminacion-de-datos)
// ═══════════════════════════════════════

test('GET /eliminacion-de-datos returns 200 without authentication', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.equal(res.status, 200);
});

test('GET /eliminacion-de-datos renders page title', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.match(res.text, /Eliminación de Datos/);
});

test('GET /eliminacion-de-datos includes Meta revocation info', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.match(res.text, /Revocar autorización/);
  assert.match(res.text, /facebook\.com\/settings/);
});

test('GET /eliminacion-de-datos includes Instagram revocation info', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.match(res.text, /instagram\.com\/accounts\/manage_access/);
});

test('GET /eliminacion-de-datos includes TikTok revocation instructions', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.match(res.text, /TikTok/);
  assert.match(res.text, /Aplicaciones autorizadas/);
});

test('GET /eliminacion-de-datos includes deletion request section', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.match(res.text, /Solicitar eliminación/);
  assert.match(res.text, /verificar/);
});

test('GET /eliminacion-de-datos explains what is and is not deleted', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.match(res.text, /[Nn]o se eliminan/);
  assert.match(res.text, /publicaciones/);
});

test('GET /eliminacion-de-datos renders site name', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.match(res.text, /[nN]inja[Ll]ab/);
});

test('GET /eliminacion-de-datos does not expose internal data', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.doesNotMatch(res.text, /SOCIAL_TOKEN/);
  assert.doesNotMatch(res.text, /social_token_secrets/);
  assert.doesNotMatch(res.text, /provider_external_id/);
});

// ═══════════════════════════════════════
// Footer links
// ═══════════════════════════════════════

test('homepage footer includes privacy link', async () => {
  const res = await request('/');
  assert.match(res.text, /href="\/privacidad"/);
});

test('homepage footer includes terms link', async () => {
  const res = await request('/');
  assert.match(res.text, /href="\/terminos"/);
});

test('homepage footer includes data deletion link', async () => {
  const res = await request('/');
  assert.match(res.text, /href="\/eliminacion-de-datos"/);
});

test('legal pages cross-link each other', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /href="\/terminos"/);
  assert.match(res.text, /href="\/eliminacion-de-datos"/);
});

// ═══════════════════════════════════════
// SEO metadata
// ═══════════════════════════════════════

test('GET /privacidad has canonical tag', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /canonical/);
});

test('GET /terminos has canonical tag', async () => {
  const res = await request('/terminos');
  assert.match(res.text, /canonical/);
});

test('GET /eliminacion-de-datos has canonical tag', async () => {
  const res = await request('/eliminacion-de-datos');
  assert.match(res.text, /canonical/);
});

test('GET /privacidad has index,follow meta', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /index,\s*follow/);
});

test('GET /privacidad has meta description', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /<meta\s[^>]*description/i);
});

// ═══════════════════════════════════════
// Accessibility
// ═══════════════════════════════════════

test('all legal pages have h1', async () => {
  for (const path of ['/privacidad', '/terminos', '/eliminacion-de-datos']) {
    const res = await request(path);
    assert.match(res.text, /<h1/, `${path} missing h1`);
  }
});

test('all legal pages have h2 headings', async () => {
  for (const path of ['/privacidad', '/terminos', '/eliminacion-de-datos']) {
    const res = await request(path);
    assert.match(res.text, /<h2/, `${path} missing h2`);
  }
});

test('legal pages have table of contents', async () => {
  const res = await request('/privacidad');
  assert.match(res.text, /Tabla de contenidos/);
  assert.match(res.text, /<nav/);
});

// ═══════════════════════════════════════
// Regression: homepage and store
// ═══════════════════════════════════════

test('homepage still renders (regression)', async () => {
  const res = await request('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /[nN]inja[Ll]ab/);
});

test('store page still renders (regression)', async () => {
  const res = await request('/tienda');
  assert.equal(res.status, 200);
});
