/**
 * Persistent social thumbnail cache (Instagram, Facebook, TikTok).
 * Run: node --require ./config/testBootstrap.js --test tests/social-provider-thumbnail-cache.test.js
 */
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const pool = require('../config/db');
const {
  UPLOAD_PUBLIC_ROOT,
  resolveUploadStoragePath,
  publicUrlForStoragePath,
} = require('../config/uploadPaths');
const thumbnailCache = require('../services/socialProviderThumbnailService');
const imageProcessing = require('../services/imageProcessingService');
const socialFeed = require('../services/socialFeedService');
const instagram = require('../services/instagramSyncService');
const facebook = require('../services/facebookSyncService');
const tiktok = require('../services/tiktokSyncService');
const { migrateSocialProviderThumbnailCache } = require('../scripts/migrate-social-provider-thumbnail-cache');
const tracker = require('../scripts/migrationTracker');

const createdFiles = [];

async function makePngBuffer(width = 80, height = 60) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 180, b: 60 },
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

before(async () => {
  await migrateSocialProviderThumbnailCache(pool);
});

after(async () => {
  await cleanupFiles();
  thumbnailCache.setHttpFetch(null);
  thumbnailCache.setDownloadImpl(null);
  instagram.setHttpGet(null);
  facebook.setHttpGet(null);
  try { await pool.end(); } catch { /* ignore */ }
});

afterEach(async () => {
  thumbnailCache.setHttpFetch(null);
  thumbnailCache.setDownloadImpl(null);
  await cleanupFiles();
});

describe('migration registry', () => {
  it('registers migrateSocialProviderThumbnailCache at the end', () => {
    const last = tracker.MIGRATION_REGISTRY[tracker.MIGRATION_REGISTRY.length - 1];
    assert.equal(last.name, 'migrateSocialProviderThumbnailCache');
    assert.equal(tracker.MIGRATION_REGISTRY.length, 42);
    // TikTok reuses provider_thumbnail_local_path — no extra migration beyond Meta cache
    assert.ok(
      !tracker.MIGRATION_REGISTRY.some((e) => /tiktok.*thumbnail|thumbnail.*tiktok/i.test(e.name))
    );
  });

  it('adds provider_thumbnail_local_path idempotently', async () => {
    await migrateSocialProviderThumbnailCache(pool);
    const [cols] = await pool.query(
      "SHOW COLUMNS FROM social_posts LIKE 'provider_thumbnail_local_path'"
    );
    assert.equal(cols.length, 1);
    assert.match(String(cols[0].Type), /varchar\(500\)/i);
  });

  it('schema.sql documents the local path column', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    assert.match(sql, /provider_thumbnail_local_path VARCHAR\(500\) NOT NULL DEFAULT ''/);
  });
});

describe('isValidMetaImageUrl / redirects / limits', () => {
  it('accepts official Meta CDN hosts', () => {
    assert.ok(thumbnailCache.isValidMetaImageUrl('https://scontent.cdninstagram.com/v/t51.jpg'));
    assert.ok(thumbnailCache.isValidMetaImageUrl('https://scontent-lax3-2.fbcdn.net/v/pic.png'));
  });

  it('rejects lookalikes, http, credentials, and foreign hosts', () => {
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://fbcdn.net.attacker.com/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://cdninstagram.com.attacker.com/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('http://scontent.fbcdn.net/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://example.com/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://user:pass@scontent.fbcdn.net/x.jpg'));
  });

  it('allows Meta→Meta redirects and rejects Meta→example.com', async () => {
    const png = await makePngBuffer();
    let hop = 0;
    thumbnailCache.setHttpFetch(async (url) => {
      hop += 1;
      if (hop === 1) {
        return {
          status: 302,
          ok: false,
          headers: { get: (n) => (n.toLowerCase() === 'location' ? 'https://scontent.fbcdn.net/v/final.jpg' : null) },
          body: { cancel: async () => {} },
        };
      }
      assert.equal(url, 'https://scontent.fbcdn.net/v/final.jpg');
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        body: null,
      };
    });
    const buf = await thumbnailCache.downloadMetaImageBytes('https://scontent.cdninstagram.com/v/start.jpg');
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 0);

    thumbnailCache.setHttpFetch(async () => ({
      status: 302,
      ok: false,
      headers: { get: (n) => (n.toLowerCase() === 'location' ? 'https://example.com/evil.jpg' : null) },
      body: { cancel: async () => {} },
    }));
    await assert.rejects(
      () => thumbnailCache.downloadMetaImageBytes('https://scontent.cdninstagram.com/v/start.jpg'),
      (err) => err.code === 'REDIRECT_REJECTED'
    );
  });

  it('aborts downloads over SOCIAL_THUMBNAIL_SOURCE_MAX_BYTES and leaves no file', async () => {
    const before = fs.existsSync(path.join(UPLOAD_PUBLIC_ROOT, 'social', 'instagram'))
      ? fs.readdirSync(path.join(UPLOAD_PUBLIC_ROOT, 'social', 'instagram'))
      : [];

    thumbnailCache.setDownloadImpl(async () => Buffer.alloc(thumbnailCache.SOCIAL_THUMBNAIL_SOURCE_MAX_BYTES + 1));
    await assert.rejects(
      () => thumbnailCache.cacheProviderThumbnail({
        provider: 'instagram',
        sourceUrl: 'https://scontent.cdninstagram.com/v/huge.jpg',
      }),
      (err) => err.code === 'SIZE_LIMIT'
    );

    const after = fs.existsSync(path.join(UPLOAD_PUBLIC_ROOT, 'social', 'instagram'))
      ? fs.readdirSync(path.join(UPLOAD_PUBLIC_ROOT, 'social', 'instagram'))
      : [];
    assert.deepEqual(after, before);
  });
});

describe('Sharp cache pipeline', () => {
  it('writes WebP under UPLOAD_PUBLIC_ROOT and returns storage-relative path', async () => {
    const png = await makePngBuffer(640, 480);
    thumbnailCache.setDownloadImpl(async () => png);

    const result = await thumbnailCache.cacheProviderThumbnail({
      provider: 'instagram',
      sourceUrl: 'https://scontent.cdninstagram.com/v/ok.jpg',
    });
    trackFile(result.storagePath);

    assert.match(result.storagePath, /^social\/instagram\/[0-9a-f-]+\.webp$/i);
    assert.ok(result.storagePath.indexOf('/uploads/') === -1);
    assert.ok(!path.isAbsolute(result.storagePath));
    assert.ok(fs.existsSync(result.absolutePath));
    assert.ok(result.absolutePath.startsWith(UPLOAD_PUBLIC_ROOT));
    assert.equal(result.publicUrl, publicUrlForStoragePath(result.storagePath));
    assert.match(result.publicUrl, /^\/uploads\/social\/instagram\/.+\.webp$/);

    const meta = await sharp(result.absolutePath).metadata();
    assert.equal(meta.format, 'webp');
    assert.ok(meta.width <= 1200);
    assert.ok(meta.height <= 1200);
  });
});

describe('public feed thumbnail priority', () => {
  const marker = `cache-${Date.now()}`;

  async function insertPublished({
    publicId = crypto.randomUUID(),
    platform = 'instagram',
    title = marker,
    thumbnailMediaRef = '',
    providerUrl = '',
    expiresAt = null,
    localPath = '',
  }) {
    const snapshot = JSON.stringify({
      platform,
      postUrl: `https://www.instagram.com/p/${publicId}/`,
      title,
      description: '',
      thumbnailMediaRef,
      embedEnabled: false,
      displayMode: 'external',
      isFeatured: false,
    });
    await pool.query(
      `INSERT INTO social_posts
        (public_id, platform, post_url, title, description, thumbnail_media_ref,
         provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
         embed_enabled, display_mode, is_active, is_featured, sort_order, status,
         published_content_json, published_at, provider, provider_external_id, is_imported)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 0, 'external', 1, 0, 0, 'published', ?, NOW(), ?, ?, 1)`,
      [
        publicId,
        platform,
        `https://www.instagram.com/p/${publicId}/`,
        title,
        thumbnailMediaRef,
        providerUrl,
        expiresAt,
        localPath,
        snapshot,
        platform,
        `ext-${publicId}`,
      ]
    );
    return publicId;
  }

  afterEach(async () => {
    await pool.query('DELETE FROM social_posts WHERE title LIKE ?', [`${marker}%`]);
  });

  it('Case A: manual CMS thumbnail wins over local + external', async () => {
    const png = await makePngBuffer();
    thumbnailCache.setDownloadImpl(async () => png);
    const cached = await thumbnailCache.cacheProviderThumbnail({
      provider: 'instagram',
      sourceUrl: 'https://scontent.cdninstagram.com/v/a.jpg',
    });
    trackFile(cached.storagePath);

    const originalResolve = require('../services/cmsContentService').resolveMediaReference;
    const cms = require('../services/cmsContentService');
    cms.resolveMediaReference = async () => ({ url: '/uploads/media/manual.webp', thumbnailUrl: '/uploads/media/manual.webp' });

    try {
      const publicId = await insertPublished({
        title: `${marker}-A`,
        thumbnailMediaRef: 'media://manual-thumb',
        providerUrl: 'https://scontent.cdninstagram.com/v/ext.jpg',
        expiresAt: new Date(Date.now() + 86400000),
        localPath: cached.storagePath,
      });
      const feed = await socialFeed.getPublicFeed({ maximumPosts: 12, platforms: ['instagram'] });
      const post = feed.find((p) => p.publicId === publicId);
      assert.ok(post);
      assert.equal(post.thumbnailUrl, '/uploads/media/manual.webp');
    } finally {
      cms.resolveMediaReference = originalResolve;
    }
  });

  it('Case B: local cache wins when external is expired', async () => {
    const png = await makePngBuffer();
    thumbnailCache.setDownloadImpl(async () => png);
    const cached = await thumbnailCache.cacheProviderThumbnail({
      provider: 'instagram',
      sourceUrl: 'https://scontent.cdninstagram.com/v/b.jpg',
    });
    trackFile(cached.storagePath);

    const publicId = await insertPublished({
      title: `${marker}-B`,
      providerUrl: 'https://scontent.cdninstagram.com/v/expired.jpg',
      expiresAt: new Date(Date.now() - 3600000),
      localPath: cached.storagePath,
    });
    const feed = await socialFeed.getPublicFeed({ maximumPosts: 12, platforms: ['instagram'] });
    const post = feed.find((p) => p.publicId === publicId);
    assert.ok(post);
    assert.equal(post.thumbnailUrl, publicUrlForStoragePath(cached.storagePath));
    assert.ok(!post.thumbnailUrl.includes('social-feed-fallback'));
  });

  it('Case C: missing local file falls back to still-valid external URL', async () => {
    const publicId = await insertPublished({
      title: `${marker}-C`,
      providerUrl: 'https://scontent.cdninstagram.com/v/still-valid.jpg',
      expiresAt: new Date(Date.now() + 86400000),
      localPath: 'social/instagram/does-not-exist.webp',
    });
    const feed = await socialFeed.getPublicFeed({ maximumPosts: 12, platforms: ['instagram'] });
    const post = feed.find((p) => p.publicId === publicId);
    assert.ok(post);
    assert.equal(post.thumbnailUrl, 'https://scontent.cdninstagram.com/v/still-valid.jpg');
  });

  it('Case D: no local + expired external → fallback SVG', async () => {
    const publicId = await insertPublished({
      title: `${marker}-D`,
      providerUrl: 'https://scontent.cdninstagram.com/v/gone.jpg',
      expiresAt: new Date(Date.now() - 1000),
      localPath: '',
    });
    const feed = await socialFeed.getPublicFeed({ maximumPosts: 12, platforms: ['instagram'] });
    const post = feed.find((p) => p.publicId === publicId);
    assert.ok(post);
    assert.equal(post.thumbnailUrl, '/images/social-feed-fallback.svg');
  });
});

describe('Instagram sync backfill / no-redownload / preserve on failure', () => {
  const extId = `ig-cache-${Date.now()}`;

  afterEach(async () => {
    await pool.query('DELETE FROM social_posts WHERE provider_external_id = ?', [extId]);
    thumbnailCache.setDownloadImpl(null);
  });

  it('backfills local WebP for existing imported post with empty local path', async () => {
    const publicId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO social_posts
        (public_id, platform, post_url, title, description, thumbnail_media_ref,
         provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
         embed_enabled, display_mode, is_active, is_featured, sort_order, status,
         published_content_json, provider, provider_external_id, provider_synced_at, is_imported)
       VALUES (?, 'instagram', ?, 'Backfill me', '', '',
         'https://scontent.cdninstagram.com/v/old.jpg', NULL, '',
         0, 'external', 1, 0, 0, 'published',
         ?, 'instagram', ?, NOW(), 1)`,
      [
        publicId,
        `https://www.instagram.com/p/${extId}/`,
        JSON.stringify({
          platform: 'instagram',
          postUrl: `https://www.instagram.com/p/${extId}/`,
          title: 'Backfill me',
          description: '',
          thumbnailMediaRef: '',
          embedEnabled: false,
          displayMode: 'external',
          isFeatured: false,
        }),
        extId,
      ]
    );

    let downloads = 0;
    thumbnailCache.setDownloadImpl(async () => {
      downloads += 1;
      return makePngBuffer();
    });

    const result = await instagram.prepareAndUpsert(
      {
        externalId: extId,
        mediaType: 'IMAGE',
        caption: 'Backfill me',
        mediaUrl: 'https://scontent.cdninstagram.com/v/new.jpg',
        permalink: `https://www.instagram.com/p/${extId}/`,
        thumbnailUrl: 'https://scontent.cdninstagram.com/v/new_thumb.jpg',
        timestamp: '2026-01-01',
        username: 'test',
      },
      { require_approval: 0, config_json: {} }
    );
    assert.equal(result.action, 'updated');
    assert.equal(downloads, 1);

    const [[row]] = await pool.query(
      `SELECT provider_thumbnail_local_path, provider_thumbnail_url, provider_thumbnail_expires_at, public_id
         FROM social_posts WHERE provider_external_id = ?`,
      [extId]
    );
    assert.equal(row.public_id, publicId);
    assert.match(row.provider_thumbnail_local_path, /^social\/instagram\/.+\.webp$/);
    trackFile(row.provider_thumbnail_local_path);
    assert.equal(row.provider_thumbnail_url, 'https://scontent.cdninstagram.com/v/new_thumb.jpg');
    assert.ok(row.provider_thumbnail_expires_at);
    assert.ok(fs.existsSync(resolveUploadStoragePath(row.provider_thumbnail_local_path)));
  });

  it('does not redownload when local cache file already exists', async () => {
    const png = await makePngBuffer();
    thumbnailCache.setDownloadImpl(async () => png);
    const cached = await thumbnailCache.cacheProviderThumbnail({
      provider: 'instagram',
      sourceUrl: 'https://scontent.cdninstagram.com/v/seed.jpg',
    });
    trackFile(cached.storagePath);

    const publicId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO social_posts
        (public_id, platform, post_url, title, description, thumbnail_media_ref,
         provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
         embed_enabled, display_mode, is_active, is_featured, sort_order, status,
         published_content_json, provider, provider_external_id, provider_synced_at, is_imported)
       VALUES (?, 'instagram', ?, 'Cached', '', '',
         'https://scontent.cdninstagram.com/v/old.jpg', NULL, ?,
         0, 'external', 1, 0, 0, 'draft',
         NULL, 'instagram', ?, NOW(), 1)`,
      [publicId, `https://www.instagram.com/p/${extId}/`, cached.storagePath, extId]
    );

    let downloads = 0;
    thumbnailCache.setDownloadImpl(async () => {
      downloads += 1;
      return png;
    });

    const result = await instagram.prepareAndUpsert(
      {
        externalId: extId,
        mediaType: 'IMAGE',
        caption: 'Cached',
        mediaUrl: 'https://scontent.cdninstagram.com/v/x.jpg',
        permalink: `https://www.instagram.com/p/${extId}/`,
        thumbnailUrl: 'https://scontent.cdninstagram.com/v/refreshed.jpg',
        timestamp: '2026-01-01',
        username: 'test',
      },
      { require_approval: 0, config_json: {} }
    );
    assert.equal(result.action, 'updated');
    assert.equal(downloads, 0);

    const [[row]] = await pool.query(
      `SELECT provider_thumbnail_local_path, provider_thumbnail_url FROM social_posts WHERE public_id = ?`,
      [publicId]
    );
    assert.equal(row.provider_thumbnail_local_path, cached.storagePath);
    assert.equal(row.provider_thumbnail_url, 'https://scontent.cdninstagram.com/v/refreshed.jpg');
  });

  it('preserves local path when provider download fails', async () => {
    const png = await makePngBuffer();
    thumbnailCache.setDownloadImpl(async () => png);
    const cached = await thumbnailCache.cacheProviderThumbnail({
      provider: 'instagram',
      sourceUrl: 'https://scontent.cdninstagram.com/v/keep.jpg',
    });
    trackFile(cached.storagePath);

    // Force "needs cache" by pointing DB at a missing path? No — user wants:
    // existing valid local + download failure → keep local.
    // ensureProviderThumbnailCached skips download when file exists.
    // To simulate refresh failure we temporarily break download while file exists:
    // actually skip path never downloads. So simulate by deleting file then failing download,
    // OR: keep file, and ensure failure path when somehow cache is attempted.
    // Spec: "Existing post: local path valid. Simulate provider/download failure. local path preserved."
    // With valid file, download isn't invoked — failure can't clear path.
    // Test: existing local path, setDownloadImpl throws, still keep path after prepareAndUpsert.
    thumbnailCache.setDownloadImpl(async () => {
      throw Object.assign(new Error('cdn down'), { code: 'HTTP_ERROR' });
    });

    const publicId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO social_posts
        (public_id, platform, post_url, title, description, thumbnail_media_ref,
         provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
         embed_enabled, display_mode, is_active, is_featured, sort_order, status,
         published_content_json, published_at, provider, provider_external_id, is_imported)
       VALUES (?, 'instagram', ?, 'Keep local', '', '',
         'https://scontent.cdninstagram.com/v/old.jpg', ?, ?,
         0, 'external', 1, 0, 0, 'published',
         ?, NOW(), 'instagram', ?, 1)`,
      [
        publicId,
        `https://www.instagram.com/p/${extId}/`,
        new Date(Date.now() - 1000),
        cached.storagePath,
        JSON.stringify({
          platform: 'instagram',
          postUrl: `https://www.instagram.com/p/${extId}/`,
          title: 'Keep local',
          description: '',
          thumbnailMediaRef: '',
          embedEnabled: false,
          displayMode: 'external',
          isFeatured: false,
        }),
        extId,
      ]
    );

    await instagram.prepareAndUpsert(
      {
        externalId: extId,
        mediaType: 'IMAGE',
        caption: 'Keep local',
        mediaUrl: 'https://scontent.cdninstagram.com/v/x.jpg',
        permalink: `https://www.instagram.com/p/${extId}/`,
        thumbnailUrl: 'https://scontent.cdninstagram.com/v/fail.jpg',
        timestamp: '2026-01-01',
        username: 'test',
      },
      { require_approval: 0, config_json: {} }
    );

    const [[row]] = await pool.query(
      `SELECT provider_thumbnail_local_path FROM social_posts WHERE public_id = ?`,
      [publicId]
    );
    assert.equal(row.provider_thumbnail_local_path, cached.storagePath);

    const feed = await socialFeed.getPublicFeed({ maximumPosts: 12, platforms: ['instagram'] });
    const post = feed.find((p) => p.publicId === publicId);
    assert.ok(post);
    assert.equal(post.thumbnailUrl, publicUrlForStoragePath(cached.storagePath));
  });

  it('deletes newly created WebP when DB persistence fails', async () => {
    const png = await makePngBuffer();
    thumbnailCache.setDownloadImpl(async () => png);

    const dir = path.join(UPLOAD_PUBLIC_ROOT, 'social', 'instagram');
    const before = new Set(
      fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.webp')) : []
    );

    const originalUpsert = instagram.upsertPost;
    instagram.upsertPost = async () => {
      throw new Error('simulated db persistence failure');
    };

    try {
      await assert.rejects(
        () => instagram.prepareAndUpsert(
          {
            externalId: `${extId}-dbfail`,
            mediaType: 'IMAGE',
            caption: 'DB fail',
            mediaUrl: 'https://scontent.cdninstagram.com/v/x.jpg',
            permalink: `https://www.instagram.com/p/${extId}-dbfail/`,
            thumbnailUrl: 'https://scontent.cdninstagram.com/v/dbfail.jpg',
            timestamp: '2026-01-01',
            username: 'test',
          },
          { require_approval: 0, config_json: {} }
        ),
        /simulated db persistence failure/
      );

      const after = new Set(
        fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.webp')) : []
      );
      for (const name of after) {
        assert.ok(before.has(name), `orphan WebP left behind after DB failure: ${name}`);
      }
    } finally {
      instagram.upsertPost = originalUpsert;
      await pool.query('DELETE FROM social_posts WHERE provider_external_id = ?', [`${extId}-dbfail`]);
    }
  });
});

describe('Facebook prepareAndUpsert uses the same cache', () => {
  const extId = `fb-cache-${Date.now()}`;

  afterEach(async () => {
    await pool.query('DELETE FROM social_posts WHERE provider_external_id = ?', [extId]);
    thumbnailCache.setDownloadImpl(null);
  });

  it('caches full_picture locally on import', async () => {
    let downloads = 0;
    thumbnailCache.setDownloadImpl(async () => {
      downloads += 1;
      return makePngBuffer();
    });

    const result = await facebook.prepareAndUpsert(
      {
        externalId: extId,
        message: 'FB cached image',
        fullPicture: 'https://scontent.fbcdn.net/v/t1.6435-9/pic.jpg',
        permalink: `https://www.facebook.com/${extId}`,
        createdTime: '2026-01-01',
      },
      { require_approval: 0, config_json: { defaultPublished: true } }
    );
    assert.equal(result.action, 'imported');
    assert.equal(downloads, 1);

    const [[row]] = await pool.query(
      `SELECT provider_thumbnail_local_path, provider_thumbnail_url FROM social_posts WHERE provider_external_id = ?`,
      [extId]
    );
    assert.match(row.provider_thumbnail_local_path, /^social\/facebook\/.+\.webp$/);
    trackFile(row.provider_thumbnail_local_path);
    assert.equal(row.provider_thumbnail_url, 'https://scontent.fbcdn.net/v/t1.6435-9/pic.jpg');
  });
});

describe('TikTok URL validation / redirects / cache', () => {
  afterEach(() => {
    thumbnailCache.setHttpFetch(null);
    thumbnailCache.setDownloadImpl(null);
  });

  it('accepts approved TikTok CDN hosts and rejects unsafe URLs', () => {
    assert.ok(thumbnailCache.isValidTikTokImageUrl('https://p16-sign.tiktokcdn-us.com/img.jpg'));
    assert.ok(thumbnailCache.isValidTikTokThumbnail('https://p16-sign-va.tiktokcdn.com/thumb.jpg'));
    assert.ok(tiktok.isValidTikTokThumbnail('https://p19-sign.tiktokcdn-us.com/cover.webp'));

    assert.ok(!thumbnailCache.isValidTikTokImageUrl('http://p16-sign-va.tiktokcdn.com/image.jpg'));
    assert.ok(!thumbnailCache.isValidTikTokImageUrl('https://p16-sign-va.tiktokcdn.com.attacker.com/image.jpg'));
    assert.ok(!thumbnailCache.isValidTikTokImageUrl('https://example.com/image.jpg'));
    assert.ok(!thumbnailCache.isValidTikTokImageUrl('https://127.0.0.1/image.jpg'));
    assert.ok(!thumbnailCache.isValidTikTokImageUrl('https://user:pass@p16-sign.tiktokcdn-us.com/x.jpg'));
  });

  it('allows TikTok→TikTok redirects and rejects TikTok→example.com', async () => {
    const png = await makePngBuffer();
    let hop = 0;
    thumbnailCache.setHttpFetch(async (url) => {
      hop += 1;
      if (hop === 1) {
        return {
          status: 302,
          ok: false,
          headers: {
            get: (n) => (n.toLowerCase() === 'location'
              ? 'https://p19-sign.tiktokcdn-us.com/final.jpg'
              : null),
          },
          body: { cancel: async () => {} },
        };
      }
      assert.equal(url, 'https://p19-sign.tiktokcdn-us.com/final.jpg');
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        body: null,
      };
    });
    const buf = await thumbnailCache.downloadProviderImageBytes(
      'tiktok',
      'https://p16-sign.tiktokcdn-us.com/start.jpg'
    );
    assert.ok(Buffer.isBuffer(buf));

    thumbnailCache.setHttpFetch(async () => ({
      status: 302,
      ok: false,
      headers: { get: (n) => (n.toLowerCase() === 'location' ? 'https://example.com/evil.jpg' : null) },
      body: { cancel: async () => {} },
    }));
    await assert.rejects(
      () => thumbnailCache.downloadProviderImageBytes(
        'tiktok',
        'https://p16-sign.tiktokcdn-us.com/start.jpg'
      ),
      (err) => err.code === 'REDIRECT_REJECTED'
    );
  });

  it('writes TikTok WebP under social/tiktok/', async () => {
    const png = await makePngBuffer(320, 400);
    thumbnailCache.setDownloadImpl(async () => png);
    const result = await thumbnailCache.cacheProviderThumbnail({
      provider: 'tiktok',
      sourceUrl: 'https://p16-sign.tiktokcdn-us.com/ok.jpg',
    });
    trackFile(result.storagePath);
    assert.match(result.storagePath, /^social\/tiktok\/[0-9a-f-]+\.webp$/i);
    assert.ok(fs.existsSync(result.absolutePath));
    assert.equal(result.publicUrl, publicUrlForStoragePath(result.storagePath));
    const meta = await sharp(result.absolutePath).metadata();
    assert.equal(meta.format, 'webp');
  });
});

describe('TikTok prepareAndUpsert backfill / no-redownload / preserve / public expiry', () => {
  const extId = `tk-cache-${Date.now()}`;

  afterEach(async () => {
    await pool.query('DELETE FROM social_posts WHERE provider_external_id LIKE ?', [`${extId}%`]);
    thumbnailCache.setDownloadImpl(null);
  });

  it('backfills local WebP for existing imported TikTok post', async () => {
    const publicId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO social_posts
        (public_id, platform, post_url, title, description, thumbnail_media_ref,
         provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
         embed_enabled, display_mode, is_active, is_featured, sort_order, status,
         published_content_json, published_at, provider, provider_external_id, provider_synced_at, is_imported)
       VALUES (?, 'tiktok', ?, 'TT Backfill', '', '',
         'https://p16-sign.tiktokcdn-us.com/old.jpg', NULL, '',
         1, 'embed', 1, 0, 0, 'published',
         ?, NOW(), 'tiktok', ?, NOW(), 1)`,
      [
        publicId,
        `https://www.tiktok.com/@user/video/${extId}`,
        JSON.stringify({
          platform: 'tiktok',
          postUrl: `https://www.tiktok.com/@user/video/${extId}`,
          title: 'TT Backfill',
          description: '',
          thumbnailMediaRef: '',
          embedEnabled: true,
          displayMode: 'embed',
          isFeatured: false,
        }),
        extId,
      ]
    );

    let downloads = 0;
    thumbnailCache.setDownloadImpl(async () => {
      downloads += 1;
      return makePngBuffer();
    });

    const result = await tiktok.prepareAndUpsert(
      {
        externalId: extId,
        title: 'TT Backfill',
        description: '',
        coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/new_cover.jpg',
        shareUrl: `https://www.tiktok.com/@user/video/${extId}`,
        createTime: null,
        duration: 10,
        embedSrc: `https://www.tiktok.com/embed/v2/${extId}`,
      },
      { require_approval: 0, config_json: {} }
    );
    assert.equal(result.action, 'updated');
    assert.equal(downloads, 1);

    const [rows] = await pool.query(
      `SELECT public_id, provider_thumbnail_local_path, provider_thumbnail_url
         FROM social_posts WHERE provider_external_id = ?`,
      [extId]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].public_id, publicId);
    assert.match(rows[0].provider_thumbnail_local_path, /^social\/tiktok\/.+\.webp$/);
    trackFile(rows[0].provider_thumbnail_local_path);
    assert.equal(rows[0].provider_thumbnail_url, 'https://p16-sign.tiktokcdn-us.com/new_cover.jpg');
    assert.ok(fs.existsSync(resolveUploadStoragePath(rows[0].provider_thumbnail_local_path)));
  });

  it('does not redownload when TikTok local cache already exists', async () => {
    const png = await makePngBuffer();
    thumbnailCache.setDownloadImpl(async () => png);
    const cached = await thumbnailCache.cacheProviderThumbnail({
      provider: 'tiktok',
      sourceUrl: 'https://p16-sign.tiktokcdn-us.com/seed.jpg',
    });
    trackFile(cached.storagePath);

    const publicId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO social_posts
        (public_id, platform, post_url, title, description, thumbnail_media_ref,
         provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
         embed_enabled, display_mode, is_active, is_featured, sort_order, status,
         published_content_json, provider, provider_external_id, is_imported)
       VALUES (?, 'tiktok', ?, 'TT Cached', '', '',
         'https://p16-sign.tiktokcdn-us.com/old.jpg', NULL, ?,
         1, 'embed', 1, 0, 0, 'draft', NULL, 'tiktok', ?, 1)`,
      [publicId, `https://www.tiktok.com/@user/video/${extId}-keep`, cached.storagePath, `${extId}-keep`]
    );

    let downloads = 0;
    thumbnailCache.setDownloadImpl(async () => {
      downloads += 1;
      return png;
    });

    await tiktok.prepareAndUpsert(
      {
        externalId: `${extId}-keep`,
        title: 'TT Cached',
        description: '',
        coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/refreshed.jpg',
        shareUrl: `https://www.tiktok.com/@user/video/${extId}-keep`,
        createTime: null,
        duration: 5,
        embedSrc: `https://www.tiktok.com/embed/v2/${extId}-keep`,
      },
      { require_approval: 0, config_json: {} }
    );
    assert.equal(downloads, 0);

    const [[row]] = await pool.query(
      `SELECT provider_thumbnail_local_path, provider_thumbnail_url FROM social_posts WHERE public_id = ?`,
      [publicId]
    );
    assert.equal(row.provider_thumbnail_local_path, cached.storagePath);
    assert.equal(row.provider_thumbnail_url, 'https://p16-sign.tiktokcdn-us.com/refreshed.jpg');
  });

  it('preserves TikTok local path on download failure and public feed still uses it', async () => {
    const png = await makePngBuffer();
    thumbnailCache.setDownloadImpl(async () => png);
    const cached = await thumbnailCache.cacheProviderThumbnail({
      provider: 'tiktok',
      sourceUrl: 'https://p16-sign.tiktokcdn-us.com/keep.jpg',
    });
    trackFile(cached.storagePath);

    const publicId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO social_posts
        (public_id, platform, post_url, title, description, thumbnail_media_ref,
         provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
         embed_enabled, display_mode, is_active, is_featured, sort_order, status,
         published_content_json, published_at, provider, provider_external_id, is_imported)
       VALUES (?, 'tiktok', ?, 'TT Keep', '', '',
         'https://p16-sign.tiktokcdn-us.com/old.jpg', ?, ?,
         1, 'embed', 1, 0, 0, 'published',
         ?, NOW(), 'tiktok', ?, 1)`,
      [
        publicId,
        `https://www.tiktok.com/@user/video/${extId}-fail`,
        new Date(Date.now() - 1000),
        cached.storagePath,
        JSON.stringify({
          platform: 'tiktok',
          postUrl: `https://www.tiktok.com/@user/video/${extId}-fail`,
          title: 'TT Keep',
          description: '',
          thumbnailMediaRef: '',
          embedEnabled: true,
          displayMode: 'embed',
          isFeatured: false,
        }),
        `${extId}-fail`,
      ]
    );

    thumbnailCache.setDownloadImpl(async () => {
      throw Object.assign(new Error('cdn down'), { code: 'HTTP_ERROR' });
    });

    await tiktok.prepareAndUpsert(
      {
        externalId: `${extId}-fail`,
        title: 'TT Keep',
        description: '',
        coverImageUrl: 'https://p16-sign.tiktokcdn-us.com/fail.jpg',
        shareUrl: `https://www.tiktok.com/@user/video/${extId}-fail`,
        createTime: null,
        duration: 5,
        embedSrc: `https://www.tiktok.com/embed/v2/${extId}-fail`,
      },
      { require_approval: 0, config_json: {} }
    );

    const [[row]] = await pool.query(
      `SELECT provider_thumbnail_local_path FROM social_posts WHERE public_id = ?`,
      [publicId]
    );
    assert.equal(row.provider_thumbnail_local_path, cached.storagePath);

    const feed = await socialFeed.getPublicFeed({ maximumPosts: 12, platforms: ['tiktok'] });
    const post = feed.find((p) => p.publicId === publicId);
    assert.ok(post);
    assert.equal(post.thumbnailUrl, publicUrlForStoragePath(cached.storagePath));
  });

  it('public feed uses local TikTok WebP even when provider URL is expired', async () => {
    const png = await makePngBuffer();
    thumbnailCache.setDownloadImpl(async () => png);
    const cached = await thumbnailCache.cacheProviderThumbnail({
      provider: 'tiktok',
      sourceUrl: 'https://p16-sign.tiktokcdn-us.com/expiry.jpg',
    });
    trackFile(cached.storagePath);

    const publicId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO social_posts
        (public_id, platform, post_url, title, description, thumbnail_media_ref,
         provider_thumbnail_url, provider_thumbnail_expires_at, provider_thumbnail_local_path,
         embed_enabled, display_mode, is_active, is_featured, sort_order, status,
         published_content_json, published_at, provider, provider_external_id, is_imported)
       VALUES (?, 'tiktok', ?, 'TT Expired External', '', '',
         'https://p16-sign.tiktokcdn-us.com/expired.jpg', ?, ?,
         1, 'embed', 1, 0, 0, 'published',
         ?, NOW(), 'tiktok', ?, 1)`,
      [
        publicId,
        `https://www.tiktok.com/@user/video/${extId}-exp`,
        new Date(Date.now() - 86400000),
        cached.storagePath,
        JSON.stringify({
          platform: 'tiktok',
          postUrl: `https://www.tiktok.com/@user/video/${extId}-exp`,
          title: 'TT Expired External',
          description: '',
          thumbnailMediaRef: '',
          embedEnabled: true,
          displayMode: 'embed',
          isFeatured: false,
        }),
        `${extId}-exp`,
      ]
    );

    const feed = await socialFeed.getPublicFeed({ maximumPosts: 12, platforms: ['tiktok'] });
    const post = feed.find((p) => p.publicId === publicId);
    assert.ok(post);
    assert.equal(post.thumbnailUrl, publicUrlForStoragePath(cached.storagePath));
    assert.match(post.thumbnailUrl, /^\/uploads\/social\/tiktok\//);
    assert.ok(!post.thumbnailUrl.includes('social-feed-fallback'));
  });
});
