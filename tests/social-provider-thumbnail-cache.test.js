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
  it('keeps later cost-quote migrations after thumbnail cache migration', () => {
    const last = tracker.MIGRATION_REGISTRY[tracker.MIGRATION_REGISTRY.length - 1];
    assert.equal(last.name, 'migrateCostQuotePrinterCosts');
    assert.equal(tracker.MIGRATION_REGISTRY.length, 46);
    assert.ok(tracker.MIGRATION_REGISTRY.some((e) => e.name === 'migrateSocialProviderThumbnailCache'));
    assert.ok(tracker.MIGRATION_REGISTRY.some((e) => e.name === 'migratePublicNavigationV2'));
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
  it('accepts official Meta CDN hosts including fbsbx and apex', () => {
    assert.ok(thumbnailCache.isValidMetaImageUrl('https://scontent-abc.cdninstagram.com/v/t51.jpg'));
    assert.ok(thumbnailCache.isValidMetaImageUrl('https://instagram.xxx.fbcdn.net/v/pic.png'));
    assert.ok(thumbnailCache.isValidMetaImageUrl('https://lookaside.fbsbx.com/lookaside/v/x.jpg'));
    assert.ok(thumbnailCache.isValidMetaImageUrl('https://cdninstagram.com/v/apex.jpg'));
    assert.ok(thumbnailCache.isValidMetaImageUrl('https://fbcdn.net/v/apex.jpg'));
    assert.ok(thumbnailCache.isValidMetaImageUrl('https://fbsbx.com/v/apex.jpg'));
  });

  it('rejects lookalikes, http, credentials, and foreign hosts', () => {
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://fbcdn.net.attacker.com/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://cdninstagram.com.attacker.com/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://fbsbx.com.attacker.com/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://evil-fbcdn.net/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('http://scontent.fbcdn.net/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://example.com/x.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://facebook.com/photo.jpg'));
    assert.ok(!thumbnailCache.isValidMetaImageUrl('https://instagram.com/p/x/media'));
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

describe('public uploads route for social WebP', () => {
  it('resolveLocalThumbnailPublicUrl maps social/instagram/*.webp to /uploads/...', async () => {
    const png = await makePngBuffer();
    thumbnailCache.setDownloadImpl(async () => png);
    const created = await thumbnailCache.cacheProviderThumbnail({
      provider: 'instagram',
      sourceUrl: 'https://scontent.cdninstagram.com/v/route.jpg',
    });
    trackFile(created.storagePath);
    assert.match(created.storagePath, /^social\/instagram\/.+\.webp$/);
    const publicUrl = thumbnailCache.resolveLocalThumbnailPublicUrl(created.storagePath);
    assert.equal(publicUrl, `/uploads/${created.storagePath}`);
    assert.equal(publicUrl, publicUrlForStoragePath(created.storagePath));
    assert.ok(fs.existsSync(resolveUploadStoragePath(created.storagePath)));
  });
});

describe('thumbnail cache observability + signed URL retry', () => {
  const adminCtrl = require('../controllers/adminSocialSyncController');

  afterEach(() => {
    thumbnailCache.setDownloadImpl(null);
    thumbnailCache.setHttpFetch(null);
    instagram.setHttpGet(null);
  });

  it('logs invalid_source and returns diagnostic meta without signed URL', async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };

    try {
      const prepared = await thumbnailCache.ensureProviderThumbnailCached({
        provider: 'instagram',
        sourceUrl: 'https://cdninstagram.com.attacker.com/v/t.jpg?oh=SECRET&oe=DEAD',
        existingLocalPath: '',
      });
      assert.equal(prepared.cached, false);
      assert.equal(prepared.status, 'invalid_source');
      assert.equal(prepared.errorCode, 'INVALID_URL');
      assert.equal(prepared.sourceHost, 'cdninstagram.com.attacker.com');
      const joined = warnings.join('\n');
      assert.match(joined, /invalid_source/);
      assert.ok(!joined.includes('oh=SECRET'));
      assert.ok(!joined.includes('oe=DEAD'));
      assert.ok(!joined.includes('access_token'));
    } finally {
      console.warn = origWarn;
    }
  });

  it('HTTP 403 cache failure is not silent — stats + warning alert', async () => {
    const extId = `ig-obs-403-${Date.now()}`;
    thumbnailCache.setDownloadImpl(async () => {
      throw Object.assign(new Error('Thumbnail HTTP 403'), {
        code: 'HTTP_ERROR',
        status: 403,
        sourceHost: 'scontent-xxx.cdninstagram.com',
      });
    });
    // Prevent refresh retry from calling Graph (no token / no mock needed for this unit path)
    const originalFetchById = instagram.fetchInstagramMediaById;
    instagram.fetchInstagramMediaById = async () => {
      throw new Error('no refresh in this test');
    };

    try {
      const result = await instagram.prepareAndUpsert(
        {
          externalId: extId,
          mediaType: 'IMAGE',
          caption: 'Obs 403',
          mediaUrl: 'https://scontent-xxx.cdninstagram.com/v/img.jpg?oh=SEC&oe=BEEF',
          permalink: `https://www.instagram.com/p/${extId}/`,
          thumbnailUrl: 'https://scontent-xxx.cdninstagram.com/v/img.jpg?oh=SEC&oe=BEEF',
          timestamp: '2026-01-01',
          username: 'test',
        },
        { require_approval: 0, config_json: {} },
        { accessToken: 'test-token-no-refresh' }
      );
      assert.equal(result.action, 'imported');
      assert.equal(result.thumbnailCache.cached, false);
      assert.equal(result.thumbnailCache.code, 'HTTP_ERROR');
      assert.equal(result.thumbnailCache.httpStatus, 403);
      assert.equal(result.thumbnailCache.sourceHost, 'scontent-xxx.cdninstagram.com');
      const metaJson = JSON.stringify(result.thumbnailCache);
      assert.ok(!metaJson.includes('oh=SEC'));
      assert.ok(!metaJson.includes('access_token'));

      const [[row]] = await pool.query(
        'SELECT provider_thumbnail_url, provider_thumbnail_local_path FROM social_posts WHERE provider_external_id = ?',
        [extId]
      );
      assert.equal(row.provider_thumbnail_url, 'https://scontent-xxx.cdninstagram.com/v/img.jpg?oh=SEC&oe=BEEF');
      assert.equal(row.provider_thumbnail_local_path, '');

      const syncResult = {
        imported: 1,
        updated: 0,
        skipped: 0,
        thumbnailStats: { cached: 0, reused: 0, failed: 1, noSource: 0, invalidSource: 0 },
        thumbnailErrors: [{
          provider: 'instagram',
          code: 'HTTP_ERROR',
          status: 403,
          host: 'scontent-xxx.cdninstagram.com',
          count: 1,
        }],
      };
      const alert = adminCtrl.buildSyncAlert(syncResult);
      assert.equal(alert.type, 'warning');
      assert.match(alert.text, /advertencias/i);
      assert.match(alert.text, /HTTP_ERROR 403/);
      assert.ok(!alert.text.includes('oh=SEC'));
    } finally {
      instagram.fetchInstagramMediaById = originalFetchById;
      await pool.query('DELETE FROM social_posts WHERE provider_external_id = ?', [extId]);
    }
  });

  it('successful cache increments thumbnailStats.cached and stores social/instagram/*.webp', async () => {
    const extId = `ig-obs-ok-${Date.now()}`;
    thumbnailCache.setDownloadImpl(async () => makePngBuffer());
    const result = await instagram.prepareAndUpsert(
      {
        externalId: extId,
        mediaType: 'IMAGE',
        caption: 'Obs OK',
        mediaUrl: 'https://scontent.cdninstagram.com/v/ok.jpg',
        permalink: `https://www.instagram.com/p/${extId}/`,
        thumbnailUrl: 'https://scontent.cdninstagram.com/v/ok.jpg',
        timestamp: '2026-01-01',
        username: 'test',
      },
      { require_approval: 0, config_json: {} }
    );
    assert.equal(result.action, 'imported');
    assert.equal(result.thumbnailCache.cached, true);
    assert.equal(result.thumbnailCache.status, 'cached_new');

    const stats = thumbnailCache.createEmptyThumbnailStats();
    thumbnailCache.accumulateThumbnailStat(stats, {
      status: result.thumbnailCache.status,
      cached: result.thumbnailCache.cached,
      skippedDownload: result.thumbnailCache.reused,
    });
    assert.equal(stats.cached, 1);
    assert.equal(stats.failed, 0);

    const [[row]] = await pool.query(
      'SELECT provider_thumbnail_local_path FROM social_posts WHERE provider_external_id = ?',
      [extId]
    );
    assert.match(row.provider_thumbnail_local_path, /^social\/instagram\/.+\.webp$/);
    trackFile(row.provider_thumbnail_local_path);
    await pool.query('DELETE FROM social_posts WHERE provider_external_id = ?', [extId]);
  });

  it('Instagram 403 refresh retry succeeds on second URL once', async () => {
    const extId = `ig-retry-ok-${Date.now()}`;
    const url1 = 'https://scontent.cdninstagram.com/v/old.jpg?oh=AAA&oe=111';
    const url2 = 'https://scontent.cdninstagram.com/v/fresh.jpg?oh=BBB&oe=222';
    let cacheAttempts = 0;
    let refreshCount = 0;

    thumbnailCache.setDownloadImpl(async (url) => {
      cacheAttempts += 1;
      if (String(url).includes('old.jpg')) {
        throw Object.assign(new Error('Thumbnail HTTP 403'), {
          code: 'HTTP_ERROR',
          status: 403,
          sourceHost: 'scontent.cdninstagram.com',
        });
      }
      return makePngBuffer();
    });

    const originalFetchById = instagram.fetchInstagramMediaById;
    instagram.fetchInstagramMediaById = async (mediaId) => {
      refreshCount += 1;
      assert.equal(mediaId, extId);
      return {
        externalId: extId,
        mediaType: 'IMAGE',
        caption: 'Retry OK',
        mediaUrl: url2,
        permalink: `https://www.instagram.com/p/${extId}/`,
        thumbnailUrl: url2,
        timestamp: '2026-01-01',
        username: 'test',
      };
    };

    try {
      const result = await instagram.prepareAndUpsert(
        {
          externalId: extId,
          mediaType: 'IMAGE',
          caption: 'Retry OK',
          mediaUrl: url1,
          permalink: `https://www.instagram.com/p/${extId}/`,
          thumbnailUrl: url1,
          timestamp: '2026-01-01',
          username: 'test',
        },
        { require_approval: 0, config_json: {} },
        { accessToken: 'test-token' }
      );
      assert.equal(result.action, 'imported');
      assert.equal(refreshCount, 1);
      assert.equal(cacheAttempts, 2);
      assert.equal(result.thumbnailCache.cached, true);
      assert.equal(result.thumbnailCache.refreshAttempts, 1);

      const [[row]] = await pool.query(
        'SELECT provider_thumbnail_url, provider_thumbnail_local_path FROM social_posts WHERE provider_external_id = ?',
        [extId]
      );
      assert.equal(row.provider_thumbnail_url, url2);
      assert.match(row.provider_thumbnail_local_path, /^social\/instagram\/.+\.webp$/);
      trackFile(row.provider_thumbnail_local_path);

      const [[dupes]] = await pool.query(
        'SELECT COUNT(*) AS c FROM social_posts WHERE provider_external_id = ?',
        [extId]
      );
      assert.equal(Number(dupes.c), 1);
    } finally {
      instagram.fetchInstagramMediaById = originalFetchById;
      await pool.query('DELETE FROM social_posts WHERE provider_external_id = ?', [extId]);
    }
  });

  it('Instagram 403 refresh retry still fails once — no third attempt', async () => {
    const extId = `ig-retry-fail-${Date.now()}`;
    const url1 = 'https://scontent.cdninstagram.com/v/a.jpg?oh=A';
    const url2 = 'https://scontent.cdninstagram.com/v/b.jpg?oh=B';
    let cacheAttempts = 0;
    let refreshCount = 0;

    thumbnailCache.setDownloadImpl(async () => {
      cacheAttempts += 1;
      throw Object.assign(new Error('Thumbnail HTTP 403'), {
        code: 'HTTP_ERROR',
        status: 403,
        sourceHost: 'scontent.cdninstagram.com',
      });
    });

    const originalFetchById = instagram.fetchInstagramMediaById;
    instagram.fetchInstagramMediaById = async () => {
      refreshCount += 1;
      return {
        externalId: extId,
        mediaType: 'IMAGE',
        caption: 'Retry fail',
        mediaUrl: url2,
        permalink: `https://www.instagram.com/p/${extId}/`,
        thumbnailUrl: url2,
        timestamp: '2026-01-01',
        username: 'test',
      };
    };

    try {
      const result = await instagram.prepareAndUpsert(
        {
          externalId: extId,
          mediaType: 'IMAGE',
          caption: 'Retry fail',
          mediaUrl: url1,
          permalink: `https://www.instagram.com/p/${extId}/`,
          thumbnailUrl: url1,
          timestamp: '2026-01-01',
          username: 'test',
        },
        { require_approval: 0, config_json: {} },
        { accessToken: 'test-token' }
      );
      assert.equal(result.action, 'imported');
      assert.equal(refreshCount, 1);
      assert.equal(cacheAttempts, 2);
      assert.equal(result.thumbnailCache.cached, false);
      assert.equal(result.thumbnailCache.code, 'HTTP_ERROR');

      const alert = adminCtrl.buildSyncAlert({
        imported: 1,
        updated: 0,
        skipped: 0,
        thumbnailStats: { cached: 0, reused: 0, failed: 1, noSource: 0, invalidSource: 0 },
        thumbnailErrors: [{
          provider: 'instagram', code: 'HTTP_ERROR', status: 403,
          host: 'scontent.cdninstagram.com', count: 1,
        }],
      });
      assert.equal(alert.type, 'warning');

      const [[row]] = await pool.query(
        'SELECT provider_thumbnail_url, title FROM social_posts WHERE provider_external_id = ?',
        [extId]
      );
      assert.equal(row.provider_thumbnail_url, url2);
      assert.equal(row.title, 'Retry fail');
    } finally {
      instagram.fetchInstagramMediaById = originalFetchById;
      await pool.query('DELETE FROM social_posts WHERE provider_external_id = ?', [extId]);
    }
  });

  it('download request sends image Accept + stable User-Agent (no cookies/token)', async () => {
    const png = await makePngBuffer();
    let seenHeaders = null;
    thumbnailCache.setHttpFetch(async (_url, init) => {
      seenHeaders = init?.headers || {};
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        body: null,
      };
    });
    await thumbnailCache.downloadProviderImageBytes(
      'instagram',
      'https://lookaside.fbsbx.com/lookaside/v/pic.jpg'
    );
    assert.equal(seenHeaders['User-Agent'], thumbnailCache.CACHE_USER_AGENT);
    assert.equal(seenHeaders.Accept, thumbnailCache.CACHE_ACCEPT);
    assert.ok(!Object.keys(seenHeaders).some((k) => /cookie/i.test(k)));
    assert.ok(!JSON.stringify(seenHeaders).includes('access_token'));
  });
});
