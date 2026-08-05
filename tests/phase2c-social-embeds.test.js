/**
 * Phase 2C — lazy, allowlisted Social Feed embeds.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const pool = require('../config/db');
const { startTestServer, stopTestServer } = require('./testServer');
const { migrateSocialFeed } = require('../scripts/migrate-social-feed');
const { migrateSocialFeedHomeSection } = require('../scripts/migrate-social-feed-home-section');
const social = require('../services/socialFeedService');
const cmsPublishing = require('../services/cmsPublishingService');
const {
  EMBED_FRAME_ORIGINS,
  deriveSocialEmbed,
  describeAdminBehavior,
} = require('../services/socialEmbedService');

const marker = `p2c_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const password = `P2c-${crypto.randomBytes(8).toString('hex')}!`;
const email = `${marker}@example.invalid`;
const jar = { cookie: '' };
let baseUrl;
let adminId;
let sectionId;
let originalSection;
let sectionCreatedByTest = false;
const createdPosts = {};

function safeDb() {
  const { assertSafeTestDatabase } = require('../config/testDatabaseGuard');
  assertSafeTestDatabase({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || '',
  }, { requireMutationOptIn: true });
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'Expected CSRF token');
  return match[1];
}

async function request(method, requestPath, fields = null) {
  const headers = {};
  let body;
  if (fields) {
    body = new URLSearchParams(fields).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  if (jar.cookie) headers.cookie = jar.cookie;
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
    text: await response.text(),
    headers: response.headers,
  };
}

async function createPublished(name, overrides) {
  const post = await social.createPost({
    platform: 'youtube',
    postUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: `${marker}-${name}`,
    description: `Descripción ${name}`,
    thumbnailMediaRef: '',
    embedEnabled: 1,
    displayMode: 'embed',
    isActive: 1,
    isFeatured: 0,
    ...overrides,
  }, adminId);
  await social.publishPost(post.publicId, adminId);
  createdPosts[name] = await social.getPost(post.publicId);
  return createdPosts[name];
}

test.before(async () => {
  safeDb();
  await migrateSocialFeed();
  const [[home]] = await pool.query("SELECT id FROM pages WHERE page_key = 'home' LIMIT 1");
  const [[before]] = await pool.query(
    "SELECT * FROM page_sections WHERE page_id = ? AND section_key = 'social-feed' LIMIT 1",
    [home.id]
  );
  originalSection = before || null;
  sectionCreatedByTest = !before;
  await migrateSocialFeedHomeSection(pool);
  const [[section]] = await pool.query(
    "SELECT * FROM page_sections WHERE page_id = ? AND section_key = 'social-feed' LIMIT 1",
    [home.id]
  );
  sectionId = section.id;

  const hash = await bcrypt.hash(password, 8);
  const [created] = await pool.query(
    'INSERT INTO users (name, email, password, role_id, is_active) VALUES (?, ?, ?, 1, 1)',
    [`Admin ${marker}`, email, hash]
  );
  adminId = created.insertId;

  await createPublished('external', {
    postUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    displayMode: 'external',
    embedEnabled: 1,
  });
  await createPublished('youtube', {});
  await createPublished('tiktok', {
    platform: 'tiktok',
    postUrl: 'https://www.tiktok.com/@ninjalab/video/1234567890123456789',
  });
  await createPublished('instagram', {
    platform: 'instagram',
    postUrl: 'https://www.instagram.com/reel/AbCde_12345/',
  });
  await createPublished('facebook', {
    platform: 'facebook',
    postUrl: 'https://www.facebook.com/NinjaLab/posts/123456789012345',
  });
  await createPublished('unsupported', {
    platform: 'instagram',
    postUrl: 'https://www.instagram.com/ninjalabcr/',
  });
  await social.createPost({
    platform: 'youtube',
    postUrl: 'https://www.youtube.com/watch?v=Z1Y2X3W4V5U',
    title: `${marker}-draft`,
    description: 'No publicar',
    thumbnailMediaRef: '',
    embedEnabled: 1,
    displayMode: 'embed',
    isActive: 1,
    isFeatured: 0,
  }, adminId);

  await cmsPublishing.saveSectionDraft('home', 'social-feed', {
    enabled: true,
    title: 'NinjaLab en redes',
    subtitle: 'Phase 2C',
    maximumPosts: 12,
    featuredOnly: false,
    platforms: ['instagram', 'facebook', 'tiktok', 'youtube'],
    displayOrder: 'newest',
  }, {}, { actorId: adminId });
  await cmsPublishing.publishSection('home', 'social-feed', { actorId: adminId });

  const server = await startTestServer();
  baseUrl = server.baseUrl;
  const login = await request('GET', '/auth/login?returnTo=%2Fadmin%2Fpage%2Fsocial-feed');
  const response = await request('POST', '/auth/login', {
    email,
    password,
    _csrf: csrf(login.text),
    returnTo: '/admin/page/social-feed',
  });
  assert.equal(response.status, 302);
});

test.after(async () => {
  await stopTestServer();
  await pool.query('DELETE FROM content_revisions WHERE changed_by = ?', [adminId]).catch(() => {});
  await pool.query('DELETE FROM social_posts WHERE created_by = ?', [adminId]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = ?', [adminId]).catch(() => {});
  if (sectionCreatedByTest) {
    await pool.query('DELETE FROM page_sections WHERE id = ?', [sectionId]).catch(() => {});
  } else if (originalSection) {
    await pool.query(
      `UPDATE page_sections SET content_json = ?, style_json = ?, sort_order = ?,
       is_enabled = ?, status = ?, version = ?, published_content_json = ?,
       published_style_json = ?, published_at = ?, updated_by = ?
       WHERE id = ?`,
      [
        originalSection.content_json,
        originalSection.style_json,
        originalSection.sort_order,
        originalSection.is_enabled,
        originalSection.status,
        originalSection.version,
        originalSection.published_content_json,
        originalSection.published_style_json,
        originalSection.published_at,
        originalSection.updated_by,
        sectionId,
      ]
    ).catch(() => {});
  }
  await pool.end();
});

test('YouTube, TikTok, Instagram, and Facebook URLs derive fixed allowlisted embeds', () => {
  const cases = [
    ['youtube', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['tiktok', 'https://www.tiktok.com/@ninja/video/1234567890123456789', 'https://www.tiktok.com/player/v1/1234567890123456789'],
    ['instagram', 'https://instagram.com/p/AbCdEf_123/', 'https://www.instagram.com/p/AbCdEf_123/embed/'],
    ['facebook', 'https://facebook.com/NinjaLab/posts/123456789', 'https://www.facebook.com/plugins/post.php?'],
  ];
  for (const [platform, postUrl, expected] of cases) {
    const result = deriveSocialEmbed({
      platform,
      postUrl,
      displayMode: 'embed',
      embedEnabled: true,
    });
    assert.equal(result.action, 'embed');
    assert.ok(result.src.startsWith(expected));
    assert.ok(EMBED_FRAME_ORIGINS.includes(new URL(result.src).origin));
  }
});

test('external mode is unchanged and unsupported embed URLs fall back externally', () => {
  assert.deepEqual(
    deriveSocialEmbed({
      platform: 'youtube',
      postUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      displayMode: 'external',
      embedEnabled: true,
    }),
    { action: 'external', supported: false, reason: 'external_mode' }
  );
  const unsupported = deriveSocialEmbed({
    platform: 'instagram',
    postUrl: 'https://instagram.com/ninjalabcr/',
    displayMode: 'embed',
    embedEnabled: true,
  });
  assert.equal(unsupported.action, 'fallback');
  assert.equal(describeAdminBehavior({
    platform: 'instagram',
    postUrl: 'https://instagram.com/ninjalabcr/',
    displayMode: 'embed',
    embedEnabled: true,
  }).kind, 'fallback');
  assert.equal(deriveSocialEmbed({
    platform: 'youtube',
    postUrl: 'https://evil.example/watch?v=dQw4w9WgXcQ',
    displayMode: 'embed',
    embedEnabled: true,
  }).action, 'fallback');
});

test('published embed cards get modal descriptors while external and unsupported cards keep safe links', async () => {
  const feed = await social.getPublicFeed({
    maximumPosts: 12,
    platforms: ['instagram', 'facebook', 'tiktok', 'youtube'],
    displayOrder: 'newest',
  });
  const byTitle = Object.fromEntries(
    feed.filter((post) => post.title.startsWith(marker)).map((post) => [post.title, post])
  );
  assert.equal(byTitle[`${marker}-external`].embed.action, 'external');
  assert.equal(byTitle[`${marker}-unsupported`].embed.action, 'fallback');
  for (const platform of ['youtube', 'tiktok', 'instagram', 'facebook']) {
    assert.equal(byTitle[`${marker}-${platform}`].embed.action, 'embed');
  }
  assert.ok(!feed.some((post) => post.title === `${marker}-draft`));
});

test('homepage has progressive external links and modal triggers without initial third-party frames or scripts', async () => {
  const home = await request('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /data-social-embed-modal/);
  assert.match(home.text, /data-social-embed-open/);
  assert.match(home.text, /data-embed-platform="youtube"/);
  assert.match(home.text, /target="_blank"\s+rel="noopener noreferrer"/);
  assert.doesNotMatch(home.text, /<iframe/i);
  assert.doesNotMatch(home.text, /<script[^>]+(?:tiktok|instagram|facebook|youtube)/i);
  assert.match(home.text, new RegExp(`${marker}-external`));
  assert.match(home.text, new RegExp(`${marker}-unsupported`));
});

test('modal runtime creates one iframe lazily and completely removes provider nodes on close', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../public/js/home/socialEmbedModal.js'),
    'utf8'
  );
  const openStart = source.indexOf('function open(trigger)');
  const iframeCreation = source.indexOf("document.createElement('iframe')");
  assert.ok(openStart >= 0 && iframeCreation > openStart);
  assert.match(source, /if \(isOpen\) close\(\{ restoreFocus: false \}\)/);
  assert.match(source, /providerFrame\.removeAttribute\('src'\)/);
  assert.match(source, /providerFrame\.remove\(\)/);
  assert.match(source, /script\[data-social-embed-script\]/);
  assert.match(source, /clearActiveListeners\(\)/);
  assert.doesNotMatch(source.slice(0, openStart), /createElement\('iframe'\)/);
});

test('modal lifecycle covers focus trap/restoration, Escape, backdrop intent, scroll lock, and reduced motion', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../public/js/home/socialEmbedModal.js'),
    'utf8'
  );
  const css = fs.readFileSync(path.join(__dirname, '../public/css/home.css'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../views/pages/home.ejs'), 'utf8');
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /focusTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /data-social-embed-backdrop/);
  assert.match(source, /classList\.add\('is-social-embed-open'\)/);
  assert.match(source, /classList\.remove\('is-social-embed-open'\)/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(css, /body\.is-social-embed-open\s*\{\s*overflow:\s*hidden/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(template, /role="dialog"/);
  assert.match(template, /aria-modal="true"/);
  assert.match(template, /data-social-embed-close/);
});

test('controlled load failure retains thumbnail, description, and safe original-link fallback', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../public/js/home/socialEmbedModal.js'),
    'utf8'
  );
  const template = fs.readFileSync(path.join(__dirname, '../views/pages/home.ejs'), 'utf8');
  assert.match(source, /LOAD_TIMEOUT_MS/);
  assert.match(source, /providerFrame, 'error', showError/);
  assert.match(source, /NinjaAlerts\?\.warning/);
  assert.match(source, /safeOriginalUrl/);
  assert.match(template, /data-social-embed-fallback-image/);
  assert.match(template, /data-social-embed-description/);
  assert.match(template, /data-social-embed-fallback-link/);
  assert.match(template, /rel="noopener noreferrer"/);
});

test('CSP allows only required frame origins and adds no social provider script origins', async () => {
  const home = await request('GET', '/');
  const csp = home.headers.get('content-security-policy') || '';
  const frameDirective = csp.split(';').find((directive) => directive.trim().startsWith('frame-src')) || '';
  const scriptDirective = csp.split(';').find((directive) => directive.trim().startsWith('script-src')) || '';
  for (const origin of EMBED_FRAME_ORIGINS) assert.ok(frameDirective.includes(origin));
  for (const origin of ['tiktok.com', 'instagram.com', 'facebook.com']) {
    assert.ok(!scriptDirective.includes(origin));
  }
  assert.ok(!scriptDirective.trim().split(/\s+/).includes("'unsafe-eval'"));
});

test('Social Feed Admin identifies external, embed, and unsupported fallback behavior', async () => {
  const [admin, form] = await Promise.all([
    request('GET', '/admin/page/social-feed'),
    request('GET', `/admin/page/social-feed/edit?id=${createdPosts.youtube.publicId}`),
  ]);
  assert.equal(admin.status, 200);
  assert.equal(form.status, 200);
  assert.match(admin.text, /Comportamiento público:/);
  assert.match(admin.text, /Abrirá como embed de youtube\./);
  assert.match(admin.text, /Abrirá el enlace original en una pestaña nueva\./);
  assert.match(admin.text, /El formato de URL no admite embed; abrirá el enlace original\./);
  assert.match(form.text, /Embed en modal/);
});

test('Phase 2B mobile row, homepage, Gallery, and Store remain healthy', async () => {
  const [home, gallery, store] = await Promise.all([
    request('GET', '/'),
    request('GET', '/galeria'),
    request('GET', '/tienda'),
  ]);
  assert.equal(home.status, 200);
  assert.equal(gallery.status, 200);
  assert.equal(store.status, 200);
  assert.match(home.text, /data-social-feed-viewport/);
  assert.match(home.text, /data-social-feed-prev/);
  assert.match(home.text, /data-social-feed-next/);
});
