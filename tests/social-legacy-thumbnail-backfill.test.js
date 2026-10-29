/**
 * Legacy social thumbnail backfill — posts outside the provider sync window.
 * Run: node --require ./config/testBootstrap.js --test tests/social-legacy-thumbnail-backfill.test.js
 */
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const pool = require('../config/db');
const { resolveUploadStoragePath, publicUrlForStoragePath } = require('../config/uploadPaths');
const thumbnailCache = require('../services/socialProviderThumbnailService');
const imageProcessing = require('../services/imageProcessingService');
const socialFeed = require('../services/socialFeedService');
const instagram = require('../services/instagramSyncService');
const facebook = require('../services/facebookSyncService');
const metaOAuth = require('../services/metaOAuthService');
const adminCtrl = require('../controllers/adminSocialSyncController');
const { migrateSocialProviderThumbnailCache } = require('../scripts/migrate-social-provider-thumbnail-cache');

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || 'test-enc-key-32bytes-len!!!';
process.env.META_APP_ID = process.env.META_APP_ID || '123456789012345';
process.env.META_APP_SECRET = process.env.META_APP_SECRET || 'test-app-secret-value-32b';
process.env.META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';
process.env.SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

const MARKER = `legacy-bf-${Date.now()}`;
const createdFiles = [];

async function makePngBuffer(width = 64, height = 64) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 120, b: 200 },
    },
  }).png().toBuffer();
}

function trackFile(storagePath) {
  if (storagePath) createdFiles.push(storagePath);
  return storagePath;
}

async function cleanupFiles() {
  while (createdFiles.length) {
    const rel = createdFiles.pop();
    try {
      await imageProcessing.deleteProcessedImage(resolveUploadStoragePath(rel));
    } catch { /* ignore */ }
  }
}

async function insertImportedIgPost({
  extId,
  title,
  sortOrder,
  localPath = '',
  published = true,
  active = true,
}) {
  const publicId = crypto.randomUUID();
  const postUrl = `https://www.instagram.com/p/${extId}/`;
  const status = published ? 'published' : 'draft';
  const snapshot = published
    ? JSON.stringify({
      platform: 'instagram',
      postUrl,
      title,
      description: '',
      thumbnailMediaRef: '',
      embedEnabled: false,
      displayMode: 'external',
      isFeatured: false,
    })
    : null;
  await pool.query(
    `INSERT INTO social_posts
      (public_id, platform, post_url, title, description, thumbnail_media_ref,
       provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
       embed_enabled, display_mode, is_active, is_featured, sort_order, status,
       published_content_json, published_at, provider, provider_external_id, provider_synced_at, is_imported)
     VALUES (?, 'instagram', ?, ?, '', '',
       'https://scontent.cdninstagram.com/v/stale.jpg', NULL, ?,
       0, 'external', ?, 0, ?, ?,
       ?, ${published ? 'NOW()' : 'NULL'}, 'instagram', ?, NOW(), 1)`,
    [
      publicId,
      postUrl,
      title,
      localPath,
      active ? 1 : 0,
      sortOrder,
      status,
      snapshot,
      extId,
    ]
  );
  return publicId;
}

before(async () => {
  await migrateSocialProviderThumbnailCache(pool);
  const { migrateSeedMetaIntegrations } = require('../scripts/migrate-seed-meta-integrations');
  await migrateSeedMetaIntegrations(pool);
});

after(async () => {
  await cleanupFiles();
  thumbnailCache.setDownloadImpl(null);
  thumbnailCache.setHttpFetch(null);
  instagram.setHttpGet(null);
  facebook.setHttpGet(null);
  metaOAuth.setHttpGet(null);
  await pool.query('DELETE FROM social_posts WHERE provider_external_id LIKE ?', [`${MARKER}%`]);
  try { await pool.end(); } catch { /* ignore */ }
});

afterEach(async () => {
  thumbnailCache.setDownloadImpl(null);
  thumbnailCache.setHttpFetch(null);
  instagram.setHttpGet(null);
  facebook.setHttpGet(null);
  metaOAuth.setHttpGet(null);
  await pool.query('DELETE FROM social_posts WHERE provider_external_id LIKE ?', [`${MARKER}%`]);
  await cleanupFiles();
});

describe('needsLocalThumbnailBackfill helper', () => {
  it('needs repair for empty path and missing file, not for valid WebP', async () => {
    assert.equal(thumbnailCache.needsLocalThumbnailBackfill(''), true);
    assert.equal(thumbnailCache.needsLocalThumbnailBackfill('social/instagram/missing.webp'), true);

    thumbnailCache.setDownloadImpl(async () => makePngBuffer());
    const created = await thumbnailCache.cacheProviderThumbnail({
      provider: 'instagram',
      sourceUrl: 'https://scontent.cdninstagram.com/v/ok.jpg',
    });
    trackFile(created.storagePath);
    assert.equal(thumbnailCache.needsLocalThumbnailBackfill(created.storagePath), false);
  });
});

describe('production-shaped Instagram legacy backfill (35 DB / 25 API)', () => {
  it('repairs older 10 outside maxPosts=25 and updates Home feed thumbnails', async () => {
    // Isolate from leftover imported rows in shared local DB
    await pool.query("DELETE FROM social_posts WHERE provider = 'instagram'");

    const recentIds = [];
    const oldIds = [];
    const oldPublicIds = [];

    // Create valid WebPs for the "recent" 25
    thumbnailCache.setDownloadImpl(async () => makePngBuffer());
    for (let i = 0; i < 25; i += 1) {
      const extId = `${MARKER}-recent-${String(i).padStart(2, '0')}`;
      recentIds.push(extId);
      const cached = await thumbnailCache.cacheProviderThumbnail({
        provider: 'instagram',
        sourceUrl: `https://scontent.cdninstagram.com/v/r${i}.jpg`,
      });
      trackFile(cached.storagePath);
      await insertImportedIgPost({
        extId,
        title: `Recent ${i}`,
        sortOrder: 100 + i,
        localPath: cached.storagePath,
        published: true,
      });
    }

    // Older 10 with empty local path — Home prefers low sort_order
    for (let i = 0; i < 10; i += 1) {
      const extId = `${MARKER}-old-${String(i).padStart(2, '0')}`;
      oldIds.push(extId);
      const publicId = await insertImportedIgPost({
        extId,
        title: i === 0 ? 'Colección Bob Esponja' : `Old legacy ${i}`,
        sortOrder: i, // 0..9 appear first on Home
        localPath: '',
        published: true,
      });
      oldPublicIds.push(publicId);
    }

    // Before sync: public feed should fall back for old cards
    const feedBefore = await socialFeed.getPublicFeed({ maximumPosts: 6, platforms: ['instagram'] });
    const beforeOld = feedBefore.find((p) => p.publicId === oldPublicIds[0]);
    assert.ok(beforeOld);
    assert.equal(beforeOld.thumbnailUrl, '/images/social-feed-fallback.svg');

    let byIdCalls = 0;
    const byIdSeen = new Set();

    await metaOAuth.completeConnection(
      'instagram',
      'ig-legacy-test-token',
      5184000,
      { id: 'page_legacy', name: 'Page', accessToken: 'page-tok' },
      { id: 'ig_legacy_user', username: 'ninjalab', name: 'NL' },
      'test-sess'
    );
    await pool.query(
      `UPDATE social_integrations
          SET is_connected = 1, is_enabled = 1,
              config_json = JSON_SET(COALESCE(config_json, '{}'), '$.maxPosts', 25, '$.igUserId', 'ig_legacy_user')
        WHERE provider = 'instagram'`
    );

    metaOAuth.setHttpGet(async (url) => {
      if (String(url).includes('/me?')) {
        return { status: 200, data: { id: 'user_legacy', name: 'Test' } };
      }
      return { status: 500, data: { error: { message: 'unexpected meta http' } } };
    });

    instagram.setHttpGet(async (url) => {
      const u = String(url);
      if (u.includes('/media?')) {
        return {
          status: 200,
          data: {
            data: recentIds.map((id, idx) => ({
              id,
              caption: `Recent ${idx}`,
              media_type: 'IMAGE',
              media_url: `https://scontent.cdninstagram.com/v/recent_${idx}.jpg`,
              permalink: `https://www.instagram.com/p/${id}/`,
              timestamp: '2026-01-01T00:00:00+0000',
              username: 'ninjalab',
            })),
          },
        };
      }
      // Single-media refresh: /{mediaId}?fields=
      const m = u.match(/\/([A-Za-z0-9_-]+)\?fields=/);
      if (m) {
        const mediaId = m[1];
        byIdCalls += 1;
        byIdSeen.add(mediaId);
        assert.ok(oldIds.includes(mediaId), `unexpected media id refresh: ${mediaId}`);
        return {
          status: 200,
          data: {
            id: mediaId,
            caption: `Refreshed ${mediaId}`,
            media_type: 'IMAGE',
            media_url: `https://scontent.cdninstagram.com/v/fresh_${mediaId}.jpg`,
            permalink: `https://www.instagram.com/p/${mediaId}/`,
            timestamp: '2025-06-01T00:00:00+0000',
            username: 'ninjalab',
          },
        };
      }
      return { status: 500, data: { error: { message: 'unexpected ig http' } } };
    });

    let downloads = 0;
    thumbnailCache.setDownloadImpl(async () => {
      downloads += 1;
      return makePngBuffer();
    });

    const [[intRow]] = await pool.query(
      "SELECT * FROM social_integrations WHERE provider = 'instagram'"
    );
    intRow.config_json = typeof intRow.config_json === 'string'
      ? JSON.parse(intRow.config_json)
      : (intRow.config_json || {});

    const result = await instagram.syncInstagram(intRow);

    assert.equal(result.updated, 25);
    assert.equal(result.thumbnailStats.reused, 25);
    assert.equal(result.thumbnailStats.cached, 0);
    assert.ok(result.backfillStats);
    assert.equal(result.backfillStats.scanned, 35);
    assert.equal(result.backfillStats.needed, 10);
    assert.equal(result.backfillStats.cached, 10);
    assert.equal(result.backfillStats.failed, 0);
    assert.equal(byIdCalls, 10, 'backfill must not be capped by maxPosts=25');
    assert.equal(byIdSeen.size, 10);
    assert.equal(downloads, 10, 'only legacy posts should download');

    const [allRows] = await pool.query(
      `SELECT provider_external_id, provider_thumbnail_local_path
         FROM social_posts
        WHERE provider_external_id LIKE ?
        ORDER BY provider_external_id`,
      [`${MARKER}%`]
    );
    assert.equal(allRows.length, 35);
    for (const row of allRows) {
      assert.match(row.provider_thumbnail_local_path, /^social\/instagram\/.+\.webp$/);
      assert.ok(thumbnailCache.localThumbnailFileExists(row.provider_thumbnail_local_path));
      trackFile(row.provider_thumbnail_local_path);
    }

    const [[dupes]] = await pool.query(
      `SELECT COUNT(*) AS c FROM social_posts WHERE provider_external_id LIKE ?`,
      [`${MARKER}%`]
    );
    assert.equal(Number(dupes.c), 35);

    const feedAfter = await socialFeed.getPublicFeed({ maximumPosts: 6, platforms: ['instagram'] });
    const afterOld = feedAfter.find((p) => p.publicId === oldPublicIds[0]);
    assert.ok(afterOld);
    assert.ok(
      thumbnailCache.isLocalSocialThumbnailPublicUrl(afterOld.thumbnailUrl),
      `expected local uploads URL, got ${afterOld.thumbnailUrl}`
    );
    assert.match(afterOld.thumbnailUrl, /^\/uploads\/social\/instagram\//);
    assert.equal(afterOld.thumbnailUrl, publicUrlForStoragePath(
      (await pool.query(
        'SELECT provider_thumbnail_local_path FROM social_posts WHERE public_id = ?',
        [oldPublicIds[0]]
      ))[0][0].provider_thumbnail_local_path
    ));

    const alert = adminCtrl.buildSyncAlert(result);
    assert.equal(alert.type, 'success');
    assert.match(alert.text, /10 miniaturas antiguas reparadas/);
    assert.match(alert.text, /25 actualizados/);
    assert.match(alert.text, /25.*reutilizadas/);

    await metaOAuth.disconnectProvider('instagram');
  });
});

describe('legacy backfill edge cases', () => {
  it('recreates cache when DB path points to a missing file', async () => {
    const extId = `${MARKER}-missing-file`;
    await insertImportedIgPost({
      extId,
      title: 'Missing file',
      sortOrder: 1,
      localPath: 'social/instagram/does-not-exist.webp',
      published: true,
    });

    let byId = 0;
    const original = instagram.fetchInstagramMediaById;
    instagram.fetchInstagramMediaById = async (id) => {
      byId += 1;
      assert.equal(id, extId);
      return {
        externalId: extId,
        mediaType: 'IMAGE',
        caption: 'Missing file',
        mediaUrl: 'https://scontent.cdninstagram.com/v/recreate.jpg',
        permalink: `https://www.instagram.com/p/${extId}/`,
        thumbnailUrl: 'https://scontent.cdninstagram.com/v/recreate.jpg',
        timestamp: '2026-01-01',
        username: 't',
      };
    };
    thumbnailCache.setDownloadImpl(async () => makePngBuffer());

    try {
      const result = await instagram.backfillLegacyThumbnails(
        { config_json: {} },
        'tok'
      );
      assert.equal(result.backfillStats.needed, 1);
      assert.equal(result.backfillStats.cached, 1);
      assert.equal(result.backfillStats.reused, 0);
      assert.equal(byId, 1);

      const [[row]] = await pool.query(
        'SELECT provider_thumbnail_local_path FROM social_posts WHERE provider_external_id = ?',
        [extId]
      );
      assert.match(row.provider_thumbnail_local_path, /^social\/instagram\/.+\.webp$/);
      assert.notEqual(row.provider_thumbnail_local_path, 'social/instagram/does-not-exist.webp');
      trackFile(row.provider_thumbnail_local_path);
    } finally {
      instagram.fetchInstagramMediaById = original;
    }
  });

  it('skips valid local cache — no metadata fetch / no download', async () => {
    thumbnailCache.setDownloadImpl(async () => makePngBuffer());
    const cached = await thumbnailCache.cacheProviderThumbnail({
      provider: 'instagram',
      sourceUrl: 'https://scontent.cdninstagram.com/v/keep.jpg',
    });
    trackFile(cached.storagePath);

    const extId = `${MARKER}-skip-ok`;
    await insertImportedIgPost({
      extId,
      title: 'Already cached',
      sortOrder: 1,
      localPath: cached.storagePath,
      published: true,
    });

    let byId = 0;
    let downloads = 0;
    const original = instagram.fetchInstagramMediaById;
    instagram.fetchInstagramMediaById = async () => {
      byId += 1;
      throw new Error('should not fetch');
    };
    thumbnailCache.setDownloadImpl(async () => {
      downloads += 1;
      return makePngBuffer();
    });

    try {
      const result = await instagram.backfillLegacyThumbnails({ config_json: {} }, 'tok');
      assert.equal(result.backfillStats.needed, 0);
      assert.equal(result.backfillStats.cached, 0);
      assert.equal(byId, 0);
      assert.equal(downloads, 0);
    } finally {
      instagram.fetchInstagramMediaById = original;
    }
  });

  it('deleted media increments unavailable and continues other posts', async () => {
    const goneId = `${MARKER}-gone`;
    const okId = `${MARKER}-still-ok`;
    await insertImportedIgPost({
      extId: goneId, title: 'Gone', sortOrder: 1, localPath: '', published: true,
    });
    await insertImportedIgPost({
      extId: okId, title: 'Still ok', sortOrder: 2, localPath: '', published: true,
    });

    const original = instagram.fetchInstagramMediaById;
    instagram.fetchInstagramMediaById = async (id) => {
      if (id === goneId) {
        throw Object.assign(new Error('Object does not exist'), {
          code: 'IG_MEDIA_REFRESH_ERROR',
          status: 400,
          data: { error: { code: 100, message: 'Unsupported get request. Object does not exist' } },
        });
      }
      return {
        externalId: id,
        mediaType: 'IMAGE',
        caption: 'Still ok',
        mediaUrl: 'https://scontent.cdninstagram.com/v/ok2.jpg',
        permalink: `https://www.instagram.com/p/${id}/`,
        thumbnailUrl: 'https://scontent.cdninstagram.com/v/ok2.jpg',
        timestamp: '2026-01-01',
        username: 't',
      };
    };
    thumbnailCache.setDownloadImpl(async () => makePngBuffer());

    try {
      const result = await instagram.backfillLegacyThumbnails({ config_json: {} }, 'tok');
      assert.equal(result.backfillStats.needed, 2);
      assert.equal(result.backfillStats.unavailable, 1);
      assert.equal(result.backfillStats.cached, 1);
      assert.equal(result.backfillStats.failed, 0);

      const [[gone]] = await pool.query(
        'SELECT provider_thumbnail_local_path, title FROM social_posts WHERE provider_external_id = ?',
        [goneId]
      );
      assert.equal(gone.title, 'Gone');
      assert.equal(gone.provider_thumbnail_local_path, '');

      const [[ok]] = await pool.query(
        'SELECT provider_thumbnail_local_path FROM social_posts WHERE provider_external_id = ?',
        [okId]
      );
      assert.match(ok.provider_thumbnail_local_path, /^social\/instagram\/.+\.webp$/);
      trackFile(ok.provider_thumbnail_local_path);

      const alert = adminCtrl.buildSyncAlert({
        imported: 0,
        updated: 25,
        skipped: 0,
        thumbnailStats: { cached: 0, reused: 25, failed: 0, noSource: 0, invalidSource: 0 },
        backfillStats: result.backfillStats,
        backfillErrors: result.backfillErrors,
      });
      assert.equal(alert.type, 'warning');
      assert.match(alert.text, /advertencias/i);
      assert.match(alert.text, /no pudieron recuperarse/);
    } finally {
      instagram.fetchInstagramMediaById = original;
    }
  });

  it('Facebook backfillLegacyThumbnails repairs empty local path via fetchFacebookPostById', async () => {
    const extId = `${MARKER}-fb-old`;
    const publicId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO social_posts
        (public_id, platform, post_url, title, description, thumbnail_media_ref,
         provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
         embed_enabled, display_mode, is_active, is_featured, sort_order, status,
         published_content_json, published_at, provider, provider_external_id, provider_synced_at, is_imported)
       VALUES (?, 'facebook', ?, 'FB old', '', '',
         '', NULL, '',
         0, 'external', 1, 0, 0, 'published',
         ?, NOW(), 'facebook', ?, NOW(), 1)`,
      [
        publicId,
        `https://www.facebook.com/${extId}`,
        JSON.stringify({
          platform: 'facebook',
          postUrl: `https://www.facebook.com/${extId}`,
          title: 'FB old',
          description: '',
          thumbnailMediaRef: '',
          embedEnabled: false,
          displayMode: 'external',
          isFeatured: false,
        }),
        extId,
      ]
    );

    const original = facebook.fetchFacebookPostById;
    facebook.fetchFacebookPostById = async (id) => {
      assert.equal(id, extId);
      return {
        externalId: extId,
        message: 'FB old',
        fullPicture: 'https://scontent.fbcdn.net/v/fresh.jpg',
        permalink: `https://www.facebook.com/${extId}`,
        createdTime: '2026-01-01',
      };
    };
    thumbnailCache.setDownloadImpl(async () => makePngBuffer());

    try {
      const result = await facebook.backfillLegacyThumbnails({ config_json: { pageId: 'pg' } }, 'page-tok');
      assert.equal(result.backfillStats.needed, 1);
      assert.equal(result.backfillStats.cached, 1);
      const [[row]] = await pool.query(
        'SELECT provider_thumbnail_local_path FROM social_posts WHERE public_id = ?',
        [publicId]
      );
      assert.match(row.provider_thumbnail_local_path, /^social\/facebook\/.+\.webp$/);
      trackFile(row.provider_thumbnail_local_path);
    } finally {
      facebook.fetchFacebookPostById = original;
    }
  });

  it('admin alert shows backfill al día when nothing needed', () => {
    const alert = adminCtrl.buildSyncAlert({
      imported: 0,
      updated: 25,
      skipped: 0,
      thumbnailStats: { cached: 0, reused: 25, failed: 0, noSource: 0, invalidSource: 0 },
      backfillStats: { scanned: 35, needed: 0, cached: 0, reused: 0, failed: 0, unavailable: 0 },
      backfillErrors: [],
    });
    assert.equal(alert.type, 'success');
    assert.match(alert.text, /backfill al día/);
  });
});
