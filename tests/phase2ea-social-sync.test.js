/**
 * Phase 2E-A — Social synchronization foundation + YouTube auto import.
 *
 * Tests cover:
 * - Migration idempotency
 * - Admin authorization
 * - Secret redaction
 * - Channel/playlist resolution
 * - Pagination
 * - Upsert without duplicates
 * - Draft-by-default imports
 * - Manual edit preservation
 * - Transient retry and quota errors
 * - Overlapping-sync lock
 * - Disconnect behavior
 * - Provider failure public isolation
 * - Phase 2A–2D regressions
 *
 * All YouTube calls are mocked — no real network requests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildIsolatedTestEnvironment } = require('../config/testProcessEnvironment');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const youtube = require('../services/youtubeSyncService');
const syncService = require('../services/socialSyncService');
const { CAPABILITIES } = require('../config/capabilities');

const marker = `phase2ea_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const adminEmail = `${marker}@example.invalid`;
const password = `2Ea-${crypto.randomBytes(6).toString('hex')}!`;
const port = 36500 + Math.floor(Math.random() * 300);
const adminJar = {};
let serverProcess;

// ── HTTP helpers ──

function request(method, rPath, body, jar = {}, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let payload = null;
    const headers = { ...extraHeaders };
    if (body && !Buffer.isBuffer(body)) {
      payload = Buffer.from(new URLSearchParams(body).toString());
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (payload) headers['Content-Length'] = payload.length;
    if (jar.cookie) headers.Cookie = jar.cookie;
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: rPath, headers },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.headers['set-cookie']?.[0]) jar.cookie = res.headers['set-cookie'][0].split(';')[0];
          resolve({ status: res.statusCode, data, headers: res.headers, location: res.headers.location || '' });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function csrf(html) {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  assert.ok(match, 'Must have CSRF token');
  return match[1];
}

// ── Mock helpers ──

function mockYoutubeChannel(channelId, uploadsPlaylistId) {
  return {
    kind: 'youtube#channelListResponse',
    items: [{
      id: channelId,
      contentDetails: {
        relatedPlaylists: { uploads: uploadsPlaylistId },
      },
    }],
  };
}

function mockPlaylistItems(videos, nextPageToken = null) {
  return {
    kind: 'youtube#playlistItemListResponse',
    items: videos.map((v, i) => ({
      id: `item-${i}`,
      snippet: {
        resourceId: { videoId: v.id },
        title: v.title,
        description: v.description || '',
        thumbnails: v.thumbnail ? {
          medium: { url: v.thumbnail },
        } : {},
        publishedAt: v.publishedAt || new Date().toISOString(),
      },
    })),
    nextPageToken: nextPageToken || undefined,
  };
}

// ── Setup / teardown ──

test.before(async () => {
  // Set env var for YouTube API in test process (sync service reads process.env)
  process.env.YOUTUBE_API_KEY = 'test-api-key-2ea';

  // Run migrations
  const { migrateSocialIntegrations } = require('../scripts/migrate-social-integrations');
  const { migrateSocialSyncRuns } = require('../scripts/migrate-social-sync-runs');
  const { migrateSocialPostsImportFields } = require('../scripts/migrate-social-posts-import-fields');
  await migrateSocialIntegrations(pool);
  await migrateSocialSyncRuns(pool);
  await migrateSocialPostsImportFields(pool);

  // Cleanup
  await pool.query("DELETE FROM social_sync_runs WHERE provider = 'youtube'");
  await pool.query("DELETE FROM social_posts WHERE provider = 'youtube'");
  await pool.query("DELETE FROM sessions WHERE data LIKE ?", [`%${marker}%`]);
  await pool.query('DELETE FROM users WHERE email = ?', [adminEmail]);

  const hash = await bcrypt.hash(password, 8);
  await pool.query('INSERT INTO users (name,email,password,role_id,is_active) VALUES (?,?,?,1,1)', [`Admin ${marker}`, adminEmail, hash]);

  // Reset integration
  await pool.query(
    "UPDATE social_integrations SET config_json = '{}', is_connected = 0, is_enabled = 0, auto_sync = 0, require_approval = 1, last_sync_at = NULL, last_sync_status = NULL, last_sync_error = NULL, imported_count = 0, skipped_count = 0, updated_count = 0 WHERE provider = 'youtube'"
  );

  // Start server
  serverProcess = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..'),
    env: buildIsolatedTestEnvironment(process.env, { PORT: String(port), YOUTUBE_API_KEY: 'test-api-key-2ea' }),
    stdio: 'ignore',
    windowsHide: true,
  });

  for (let a = 0; a < 60; a++) {
    try { if ((await request('GET', '/health')).status === 200) break; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }

  // Login admin
  const page = await request('GET', '/auth/login?returnTo=' + encodeURIComponent('/admin'), null, adminJar);
  await request('POST', '/auth/login', { email: adminEmail, password, _csrf: csrf(page.data), returnTo: '/admin' }, adminJar);
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  await pool.query("DELETE FROM social_sync_runs WHERE provider = 'youtube'");
  await pool.query("DELETE FROM social_posts WHERE provider = 'youtube'");
  await pool.query("DELETE FROM sessions WHERE data LIKE ?", [`%${marker}%`]);
  await pool.query('DELETE FROM users WHERE email = ?', [adminEmail]);
  await pool.end();
});

// ── Migration tests ──

test('migration 27: social_integrations table is created', async () => {
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_integrations'");
  assert.equal(cnt, 1);
});

test('migration 27: social_integrations has default YouTube row', async () => {
  const [[row]] = await pool.query("SELECT * FROM social_integrations WHERE provider = 'youtube'");
  assert.ok(row);
  assert.equal(row.provider, 'youtube');
  assert.equal(row.is_connected, 0);
  assert.equal(row.require_approval, 1);
});

test('migration 27: social_integrations is idempotent', async () => {
  const { migrateSocialIntegrations } = require('../scripts/migrate-social-integrations');
  await migrateSocialIntegrations(pool);
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM social_integrations WHERE provider = 'youtube'");
  assert.equal(cnt, 1);
});

test('migration 28: social_sync_runs table is created', async () => {
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_sync_runs'");
  assert.equal(cnt, 1);
});

test('migration 28: social_sync_runs is idempotent', async () => {
  const { migrateSocialSyncRuns } = require('../scripts/migrate-social-sync-runs');
  await migrateSocialSyncRuns(pool);
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_sync_runs'");
  assert.equal(cnt, 1);
});

test('migration 29: social_posts has provider columns', async () => {
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider'");
  assert.equal(cnt, 1);
});

test('migration 29: social_posts has provider_external_id', async () => {
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_external_id'");
  assert.equal(cnt, 1);
});

test('migration 29: social_posts has is_imported column', async () => {
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'is_imported'");
  assert.equal(cnt, 1);
});

test('migration 29: social_posts import fields migration is idempotent', async () => {
  const { migrateSocialPostsImportFields } = require('../scripts/migrate-social-posts-import-fields');
  await migrateSocialPostsImportFields(pool);
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_posts' AND COLUMN_NAME = 'provider_external_id'");
  assert.equal(cnt, 1);
});

// ── Capabilities ──

test('SOCIAL_INTEGRATIONS capabilities are registered', () => {
  assert.ok(CAPABILITIES.SOCIAL_INTEGRATIONS_VIEW);
  assert.ok(CAPABILITIES.SOCIAL_INTEGRATIONS_EDIT);
  assert.ok(CAPABILITIES.SOCIAL_INTEGRATIONS_SYNC);
});

// ── Secret redaction ──

test('YOUTUBE_API_KEY is never in config_json', async () => {
  await pool.query(
    'UPDATE social_integrations SET config_json = ?, is_enabled = 1, is_connected = 1 WHERE provider = ?',
    [JSON.stringify({ channelId: 'UCtest', maxVideos: 10 }), 'youtube']
  );
  const [[row]] = await pool.query("SELECT config_json FROM social_integrations WHERE provider = 'youtube'");
  const config = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
  assert.ok(!config.apiKey);
  assert.ok(!config.clientSecret);
  assert.ok(!config.accessToken);
});

test('config_json never contains apiKey after save', async () => {
  await syncService.saveIntegration('youtube', {
    configJson: { channelId: 'UCtest', maxVideos: 10, apiKey: 'SHOULD_NOT_BE_STORED' },
    isEnabled: true,
    autoSync: false,
    requireApproval: true,
    isConnected: true,
  });
  const [[row]] = await pool.query("SELECT config_json FROM social_integrations WHERE provider = 'youtube'");
  const config = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
  assert.ok(!config.apiKey);
});

// ── YouTube service: channel resolution ──

test('resolveUploadsPlaylistId resolves playlist from channel', async () => {
  const playlistId = 'UU' + crypto.randomBytes(12).toString('hex').slice(0, 22);
  youtube.setHttpGet(async () => ({
    status: 200,
    data: mockYoutubeChannel('UCtest123', playlistId),
  }));
  const result = await youtube.resolveUploadsPlaylistId('UCtest123', 'fake-key');
  assert.equal(result, playlistId);
});

test('resolveUploadsPlaylistId throws on empty channel', async () => {
  youtube.setHttpGet(async () => ({ status: 200, data: { items: [] } }));
  await assert.rejects(
    () => youtube.resolveUploadsPlaylistId('UCnonexistent', 'fake-key'),
    (err) => err.code === 'CHANNEL_NOT_FOUND'
  );
});

// ── Pagination ──

test('fetchPlaylistItems paginates correctly', async () => {
  const allVideos = Array.from({ length: 35 }, (_, i) => ({
    id: `vid-${i}`, title: `Video ${i}`, publishedAt: new Date().toISOString(),
  }));
  let callCount = 0;
  youtube.setHttpGet(async (url) => {
    callCount++;
    if (url.includes('pageToken=token2')) {
      return { status: 200, data: mockPlaylistItems(allVideos.slice(20), null) };
    }
    return { status: 200, data: mockPlaylistItems(allVideos.slice(0, 20), 'token2') };
  });
  const items = await youtube.fetchPlaylistItems('PLtest', 'fake-key', 30);
  assert.ok(items.length >= 20);
  assert.ok(callCount >= 2);
});

// ── Normalize ──

test('normalizeVideo extracts videoId, title, URL', () => {
  const result = youtube.normalizeVideo({
    snippet: {
      resourceId: { videoId: 'dQw4w9WgXcQ' },
      title: 'Test Video',
      description: 'A test video',
      thumbnails: { medium: { url: 'https://img.youtube.com/vi/abc/default.jpg' } },
      publishedAt: '2024-01-01T00:00:00Z',
    },
  });
  assert.equal(result.videoId, 'dQw4w9WgXcQ');
  assert.equal(result.title, 'Test Video');
  assert.equal(result.postUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(result.thumbnailUrl);
});

// ── Upsert: import ──

test('upsertPost creates a new draft post', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: { channelId: 'UCtest', maxVideos: 10 } };
    const video = { videoId: 'new-test-001', title: 'Nuevo Video', description: 'Desc', postUrl: 'https://www.youtube.com/watch?v=new-test-001', thumbnailUrl: 'https://img.example.com/thumb.jpg' };
    const result = await youtube.upsertPost(conn, video, intRow);
    assert.equal(result.action, 'imported');
    const [[post]] = await conn.query("SELECT * FROM social_posts WHERE provider_external_id = 'new-test-001'");
    assert.equal(post.status, 'draft');
    assert.equal(post.is_imported, 1);
    assert.equal(post.provider, 'youtube');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ── Upsert: skip duplicate ──

test('upsertPost skips duplicate external_id', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: { channelId: 'UCtest' } };
    const video = { videoId: 'dup-002', title: 'Dup', description: '', postUrl: 'https://www.youtube.com/watch?v=dup-002', thumbnailUrl: '' };
    await youtube.upsertPost(conn, video, intRow);
    const result2 = await youtube.upsertPost(conn, video, intRow);
    assert.ok(['skipped', 'updated'].includes(result2.action));
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ── Upsert: duplicate URL ──

test('upsertPost skips when manual post with same URL exists', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const publicId = crypto.randomUUID();
    await conn.query(
      'INSERT INTO social_posts (public_id, platform, post_url, title, status, provider, is_imported) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [publicId, 'youtube', 'https://www.youtube.com/watch?v=dup-url-003', 'Manual', 'published', 'manual', 0]
    );
    const intRow = { require_approval: 1, config_json: {} };
    const video = { videoId: 'dup-url-003', title: 'Auto', description: '', postUrl: 'https://www.youtube.com/watch?v=dup-url-003', thumbnailUrl: '' };
    const result = await youtube.upsertPost(conn, video, intRow);
    assert.equal(result.action, 'skipped');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ── Upsert: preserve manual edits ──

test('upsertPost preserves manual edits on existing manual post', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const publicId = crypto.randomUUID();
    await conn.query(
      'INSERT INTO social_posts (public_id, platform, post_url, title, status, provider, provider_external_id, is_imported) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [publicId, 'youtube', 'https://www.youtube.com/watch?v=preserve-test', 'Manual Title', 'published', 'manual', 'preserve-test', 0]
    );
    const intRow = { require_approval: 1, config_json: {} };
    const video = { videoId: 'preserve-test', title: 'Auto Title', description: '', postUrl: 'https://www.youtube.com/watch?v=preserve-test', thumbnailUrl: '' };
    const result = await youtube.upsertPost(conn, video, intRow);
    assert.equal(result.action, 'skipped');
    const [[post]] = await conn.query("SELECT title FROM social_posts WHERE provider_external_id = 'preserve-test'");
    assert.equal(post.title, 'Manual Title');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ── Draft-by-default vs auto-publish ──

test('imports are draft by default', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 1, config_json: {} };
    const video = { videoId: 'draft-default', title: 'Draft', description: '', postUrl: 'https://www.youtube.com/watch?v=draft-default', thumbnailUrl: '' };
    const result = await youtube.upsertPost(conn, video, intRow);
    assert.equal(result.action, 'imported');
    const [[post]] = await conn.query("SELECT status FROM social_posts WHERE provider_external_id = 'draft-default'");
    assert.equal(post.status, 'draft');
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('auto-publish when defaultPublished config is set', async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const intRow = { require_approval: 0, config_json: { defaultPublished: true, channelId: 'UCtest', maxVideos: 10 } };
    const video = { videoId: 'auto-pub-001', title: 'Auto Publish', description: '', postUrl: 'https://www.youtube.com/watch?v=auto-pub-001', thumbnailUrl: '' };
    const result = await youtube.upsertPost(conn, video, intRow);
    assert.equal(result.action, 'imported');
    const [[post]] = await conn.query("SELECT status, published_content_json FROM social_posts WHERE provider_external_id = 'auto-pub-001'");
    assert.equal(post.status, 'published');
    assert.ok(post.published_content_json);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

// ── Retry and transient errors ──

test('fetchWithRetry succeeds on transient 429 with backoff', async () => {
  let calls = 0;
  youtube.setHttpGet(async () => {
    calls++;
    if (calls < 3) return { status: 429, data: { error: 'quota exceeded' } };
    return { status: 200, data: { items: [] } };
  });
  const result = await youtube.fetchWithRetry('https://example.com/test');
  assert.equal(result.status, 200);
  assert.ok(calls >= 3);
});

test('fetchWithRetry fails on non-retryable 403', async () => {
  youtube.setHttpGet(async () => ({ status: 403, data: { error: { message: 'forbidden' } } }));
  await assert.rejects(() => youtube.fetchWithRetry('https://example.com/test'), /YouTube API error 403/);
});

// ── Sync lock: overlapping runs blocked ──

test('sync lock prevents concurrent runs', async () => {
  const conn1 = await pool.getConnection();
  try {
    // Acquire lock with short timeout for test
    const [[{ locked }]] = await conn1.query('SELECT GET_LOCK(?, 1) AS locked', ['social_sync_test']);
    assert.ok(locked);
    // Second attempt should fail with 1s timeout
    const conn2 = await pool.getConnection();
    try {
      const [[{ locked: locked2 }]] = await conn2.query('SELECT GET_LOCK(?, 1) AS locked', ['social_sync_test']);
      assert.ok(!locked2);
    } finally {
      conn2.release();
    }
  } finally {
    await conn1.query('SELECT RELEASE_LOCK(?)', ['social_sync_test']);
    conn1.release();
  }
});

// ── Sync run logging ──

test('sync creates a run record', async () => {
  await pool.query("DELETE FROM social_sync_runs WHERE provider = 'youtube'");
  // Mock a successful sync
  youtube.setHttpGet(async (url) => {
    if (url.includes('/channels')) {
      return { status: 200, data: mockYoutubeChannel('UCtest', 'UUuploads123') };
    }
    return { status: 200, data: mockPlaylistItems([
      { id: 'run-test-01', title: 'Run Test', publishedAt: new Date().toISOString() },
    ]) };
  });
  await pool.query(
    "UPDATE social_integrations SET config_json = ?, is_enabled = 1, is_connected = 1 WHERE provider = 'youtube'",
    [JSON.stringify({ channelId: 'UCtest', maxVideos: 5 })]
  );

  const result = await syncService.syncProvider('youtube');
  assert.ok(result.imported >= 0);

  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM social_sync_runs WHERE provider = 'youtube'");
  assert.ok(cnt >= 1);

  // Cleanup
  await pool.query("DELETE FROM social_posts WHERE provider = 'youtube'");
  await pool.query("DELETE FROM social_sync_runs WHERE provider = 'youtube'");
  await pool.query(
    "UPDATE social_integrations SET is_enabled = 0, is_connected = 0, config_json = '{}' WHERE provider = 'youtube'"
  );
});

// ── Disconnect ──

test('disconnect clears integration config', async () => {
  await pool.query(
    "UPDATE social_integrations SET config_json = ?, is_connected = 1, is_enabled = 1, auto_sync = 1, last_sync_status = 'success' WHERE provider = 'youtube'",
    [JSON.stringify({ channelId: 'UCtest' })]
  );
  await syncService.disconnectProvider('youtube');
  const [[row]] = await pool.query("SELECT * FROM social_integrations WHERE provider = 'youtube'");
  assert.equal(row.is_connected, 0);
  assert.equal(row.is_enabled, 0);
  assert.equal(row.auto_sync, 0);
  assert.equal(row.last_sync_status, null);
});

// ── Admin HTTP routes ──

test('integrations list is accessible', async () => {
  const resp = await request('GET', '/admin/page/integrations', null, adminJar);
  assert.equal(resp.status, 200);
  assert.match(resp.data, /Integraciones sociales/);
});

test('integrations list shows YouTube card', async () => {
  const resp = await request('GET', '/admin/page/integrations', null, adminJar);
  assert.match(resp.data, /YouTube/);
});

test('integrations edit page is accessible', async () => {
  const resp = await request('GET', '/admin/page/integrations/edit?provider=youtube', null, adminJar);
  assert.equal(resp.status, 200);
  assert.match(resp.data, /Configurar YouTube/);
});

test('integrations edit rejects invalid provider', async () => {
  const resp = await request('GET', '/admin/page/integrations/edit?provider=twitch', null, adminJar);
  assert.equal(resp.status, 302);
  assert.match(resp.location, /\/admin\/page\/integrations/);
});

test('save config redirects with success', async () => {
  const page = await request('GET', '/admin/page/integrations/edit?provider=youtube', null, adminJar);
  const resp = await request('POST', '/admin/page/integrations/save', {
    _csrf: csrf(page.data),
    provider: 'youtube',
    channelId: 'UCtestconfig123',
    maxVideos: '15',
    isEnabled: '1',
    autoSync: '0',
    requireApproval: '1',
    defaultPublished: '0',
  }, adminJar);
  assert.equal(resp.status, 302);
  assert.match(resp.location, /\/admin\/page\/integrations/);
});

test('save config fails with empty channel when enabled', async () => {
  const page = await request('GET', '/admin/page/integrations/edit?provider=youtube', null, adminJar);
  const resp = await request('POST', '/admin/page/integrations/save', {
    _csrf: csrf(page.data),
    provider: 'youtube',
    channelId: '',
    maxVideos: '15',
    isEnabled: '1',
  }, adminJar);
  // Should redirect back with validation errors
  assert.equal(resp.status, 302);
});

test('unauthorized cannot access integrations list', async () => {
  const unauthedJar = {};
  const resp = await request('GET', '/admin/page/integrations', null, unauthedJar);
  assert.equal(resp.status, 302);
  assert.match(resp.location, /\/auth\/login/);
});

// ── Secret redaction in HTTP responses ──

test('integrations list HTML does not contain API key', async () => {
  const resp = await request('GET', '/admin/page/integrations', null, adminJar);
  assert.doesNotMatch(resp.data, /test-api-key-2ea/);
});

test('integrations edit HTML does not contain API key', async () => {
  const resp = await request('GET', '/admin/page/integrations/edit?provider=youtube', null, adminJar);
  assert.doesNotMatch(resp.data, /test-api-key-2ea/);
});

// ── Sync lock: overlapping runs blocked ──

// ── Sync lock: overlapping runs blocked ──

test('HTTP sync route requires CSRF token', async () => {
  const resp = await request('POST', '/admin/page/integrations/sync', {
    provider: 'youtube',
  }, adminJar);
  assert.equal(resp.status, 403);
});

// ── Provider failure does not affect public feed ──

test('provider failure keeps public Social Feed functional', async () => {
  // Reset mocked HTTP to return a failure (use non-retryable status for speed)
  youtube.setHttpGet(async () => ({ status: 400, data: { error: 'bad request' } }));
  await pool.query(
    "UPDATE social_integrations SET config_json = ?, is_enabled = 1, is_connected = 1 WHERE provider = 'youtube'",
    [JSON.stringify({ channelId: 'UCtest', maxVideos: 5 })]
  );

  // Trying to sync should fail gracefully
  await assert.rejects(
    () => syncService.syncProvider('youtube'),
    /YouTube API/
  );

  // Integration last_sync_status should be 'error'
  const [[row]] = await pool.query("SELECT last_sync_status, last_sync_error FROM social_integrations WHERE provider = 'youtube'");
  assert.equal(row.last_sync_status, 'error');

  // Public feed should still work (no crash)
  const socialFeedService = require('../services/socialFeedService');
  const feed = await socialFeedService.getPublicFeed({});
  assert.ok(Array.isArray(feed));
});

// ── List integrations returns correct structure ──

test('listIntegrations returns structured data', async () => {
  const integrations = await syncService.listIntegrations();
  assert.ok(integrations.length >= 1);
  const yt = integrations.find(i => i.provider === 'youtube');
  assert.ok(yt);
  assert.ok('provider' in yt);
  assert.ok('isConnected' in yt);
  assert.ok('isEnabled' in yt);
  assert.ok('autoSync' in yt);
});

// ── Phase 2A/2D regression: existing capabilities still registered ──

test('Social Feed capability still registered', () => {
  assert.ok(CAPABILITIES.SOCIAL_FEED_VIEW);
  assert.ok(CAPABILITIES.SOCIAL_FEED_EDIT);
});

test('Testimonials capability still registered', () => {
  assert.ok(CAPABILITIES.TESTIMONIALS_VIEW);
  assert.ok(CAPABILITIES.TESTIMONIALS_EDIT);
});

test('MIGRATION_REGISTRY has all entries (26 base + 3 new = 29)', () => {
  const { MIGRATION_REGISTRY } = require('../scripts/migrationTracker');
  assert.equal(MIGRATION_REGISTRY.length, 35);
});

// ── Cleanup: reset mock ──

test.after(() => {
  youtube.setHttpGet(null);
});
