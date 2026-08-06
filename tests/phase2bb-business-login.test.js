/**
 * Phase 2E-B Business Login config_id + business_management tests.
 *
 * Covers:
 *  - authorization URL includes config_id
 *  - exact four permissions requested
 *  - missing META_CONFIG_ID blocks connection
 *  - granular one-Page response
 *  - business-managed Page discovery fallback
 *  - missing business_management (no fallback)
 *  - declined pages_show_list
 *  - no secret leakage (config_id, app_secret, token)
 *  - permissions diagnostics (granted/declined)
 *  - successful Page + linked IG discovery
 *  - Meta OAuth security regressions
 *  - YouTube/TikTok regressions
 */
const { test, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const pool = require('../config/db');
const metaOAuth = require('../services/metaOAuthService');

after(async () => {
  metaOAuth.setHttpGet(null);
  metaOAuth.setHttpPost(null);
  // Close pool connection to allow clean exit
  await pool.end().catch(() => {});
});

// ── Helpers ──

function setEnv(key, val) {
  if (val != null) process.env[key] = val; else delete process.env[key];
}

function cacheEnv() {
  return {
    META_CONFIG_ID: process.env.META_CONFIG_ID || null,
    META_APP_ID: process.env.META_APP_ID || null,
    META_APP_SECRET: process.env.META_APP_SECRET || null,
    SOCIAL_TOKEN_ENCRYPTION_KEY: process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || null,
  };
}

function restoreEnv(cache) {
  setEnv('META_CONFIG_ID', cache.META_CONFIG_ID);
  setEnv('META_APP_ID', cache.META_APP_ID);
  setEnv('META_APP_SECRET', cache.META_APP_SECRET);
  setEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', cache.SOCIAL_TOKEN_ENCRYPTION_KEY);
}

// ═══════════════════════════════════════
// 1. config_id in authorization URL
// ═══════════════════════════════════════

test('getConfigId reads META_CONFIG_ID env var', () => {
  const orig = process.env.META_CONFIG_ID;
  process.env.META_CONFIG_ID = 'test_config_123';
  assert.strictEqual(metaOAuth.getConfigId(), 'test_config_123');
  setEnv('META_CONFIG_ID', orig);
});

test('getConfigId returns empty when not set', () => {
  const orig = process.env.META_CONFIG_ID;
  delete process.env.META_CONFIG_ID;
  assert.strictEqual(metaOAuth.getConfigId(), '');
  setEnv('META_CONFIG_ID', orig);
});

test('getAuthorizationUrl includes config_id parameter', () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_123';
  process.env.META_CONFIG_ID = 'config_456';
  process.env.META_APP_SECRET = 'secret';
  process.env.NODE_ENV = 'test';
  try {
    const { url } = metaOAuth.getAuthorizationUrl('instagram', 'session_abc');
    assert.ok(url.includes('config_id=config_456'), `URL must contain config_id, got: ${url}`);
  } finally { restoreEnv(env); }
});

test('getAuthorizationUrl throws NO_CONFIG_ID when missing', () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_123';
  process.env.META_APP_SECRET = 'secret';
  delete process.env.META_CONFIG_ID;
  process.env.NODE_ENV = 'test';
  try {
    metaOAuth.getAuthorizationUrl('instagram', 'session_abc');
    assert.fail('should have thrown NO_CONFIG_ID');
  } catch (error) {
    assert.strictEqual(error.code, 'NO_CONFIG_ID');
    assert.ok(error.message.includes('META_CONFIG_ID'));
  } finally { restoreEnv(env); }
});

// ═══════════════════════════════════════
// 2. Exact permissions requested
// ═══════════════════════════════════════

test('getAuthorizationUrl requests exactly four permissions', () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_123';
  process.env.META_CONFIG_ID = 'config_456';
  process.env.META_APP_SECRET = 'secret';
  process.env.NODE_ENV = 'test';
  try {
    const { url } = metaOAuth.getAuthorizationUrl('instagram', 'session_abc');
    const scopeMatch = url.match(/scope=([^&]+)/);
    assert.ok(scopeMatch);
    const scopes = decodeURIComponent(scopeMatch[1]).split(',');
    assert.strictEqual(scopes.length, 4, `Expected 4 scopes, got ${scopes.length}`);
    assert.ok(scopes.includes('instagram_basic'));
    assert.ok(scopes.includes('pages_show_list'));
    assert.ok(scopes.includes('pages_read_engagement'));
    assert.ok(scopes.includes('business_management'));
    assert.ok(!scopes.includes('pages_manage_posts'));
    assert.ok(!scopes.includes('ads_management'));
  } finally { restoreEnv(env); }
});

// ═══════════════════════════════════════
// 3. No secret leakage
// ═══════════════════════════════════════

test('getAuthorizationUrl never exposes config_id value in error messages', () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_123';
  delete process.env.META_CONFIG_ID;
  process.env.NODE_ENV = 'test';
  try {
    metaOAuth.getAuthorizationUrl('instagram', 'session');
    assert.fail('should throw');
  } catch (error) {
    assert.ok(!error.message.includes('config_'), 'Error must not leak config_id value');
    assert.ok(error.message.includes('META_CONFIG_ID'));
  } finally { restoreEnv(env); }
});

test('getAuthorizationUrl never exposes app_secret in URL', () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_123';
  process.env.META_CONFIG_ID = 'config_456';
  process.env.META_APP_SECRET = 'super_secret_value';
  process.env.NODE_ENV = 'test';
  try {
    const { url } = metaOAuth.getAuthorizationUrl('instagram', 'session_abc');
    assert.doesNotMatch(url, /super_secret_value/);
    assert.doesNotMatch(url, /app_secret/);
    assert.doesNotMatch(url, /client_secret/);
  } finally { restoreEnv(env); }
});

// ═══════════════════════════════════════
// 4. Granular one-Page response
// ═══════════════════════════════════════

test('discoverAccountOptions returns single granted Page with inline IG', async () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_123';
  process.env.META_CONFIG_ID = 'config_456';
  process.env.META_APP_SECRET = 'secret';
  process.env.NODE_ENV = 'test';

  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/permissions')) {
      return { status: 200, data: { data: [
        { permission: 'instagram_basic', status: 'granted' },
        { permission: 'pages_show_list', status: 'granted' },
        { permission: 'pages_read_engagement', status: 'granted' },
        { permission: 'business_management', status: 'granted' },
      ]}};
    }
    if (url.includes('/me/accounts')) {
      return { status: 200, data: { data: [
        { id: 'page_789', name: 'NinjaLab3D', access_token: 'EAApageTokenHere',
          picture: { data: { url: 'https://example.com/pic.jpg' } },
          instagram_business_account: { id: 'ig_101', username: 'ninjalab3dcr', name: 'NinjaLab3D CR' } },
      ]}};
    }
    return { status: 200, data: { id: 'me' } };
  });

  try {
    const options = await metaOAuth.discoverAccountOptions('test_token');
    assert.strictEqual(options.length, 1);
    assert.strictEqual(options[0].page.id, 'page_789');
    assert.strictEqual(options[0].page.name, 'NinjaLab3D');
    assert.strictEqual(options[0].instagram.username, 'ninjalab3dcr');
    assert.strictEqual(options[0].instagram.id, 'ig_101');
  } finally { metaOAuth.setHttpGet(null); }
});

// ═══════════════════════════════════════
// 5. Business-managed Page discovery fallback
// ═══════════════════════════════════════

test('discoverAccountOptions falls back to Business discovery when /me/accounts is empty', async () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_123';
  process.env.META_CONFIG_ID = 'config_456';
  process.env.META_APP_SECRET = 'secret';
  process.env.NODE_ENV = 'test';

  const callLog = [];
  metaOAuth.setHttpGet(async (url) => {
    callLog.push(url);
    if (url.includes('/me/permissions')) {
      return { status: 200, data: { data: [
        { permission: 'business_management', status: 'granted' },
        { permission: 'pages_show_list', status: 'granted' },
      ]}};
    }
    if (url.includes('/me/accounts')) {
      return { status: 200, data: { data: [] } };
    }
    if (url.includes('/me/businesses')) {
      return { status: 200, data: { data: [{ id: 'biz_001', name: 'NinjaLab Portfolio' }] }};
    }
    if (url.includes('biz_001/client_pages')) {
      return { status: 200, data: { data: [
        { id: 'page_biz', name: 'Business Page', access_token: 'EAApageBiz',
          instagram_business_account: { id: 'ig_biz', username: 'business_ig' } },
      ]}};
    }
    return { status: 200, data: { id: 'me' } };
  });

  try {
    const options = await metaOAuth.discoverAccountOptions('test_token');
    assert.ok(callLog.some(u => u.includes('/me/businesses')), 'Should have called /me/businesses');
    assert.ok(callLog.some(u => u.includes('client_pages')), 'Should have called client_pages');
    assert.strictEqual(options.length, 1);
    assert.strictEqual(options[0].page.id, 'page_biz');
    assert.strictEqual(options[0].instagram.username, 'business_ig');
  } finally { metaOAuth.setHttpGet(null); }
});

// ═══════════════════════════════════════
// 6. Missing business_management — no fallback
// ═══════════════════════════════════════

test('discoverAccountOptions does NOT use Business fallback when business_management is declined', async () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_123';
  process.env.META_CONFIG_ID = 'config_456';
  process.env.META_APP_SECRET = 'secret';
  process.env.NODE_ENV = 'test';

  const callLog = [];
  metaOAuth.setHttpGet(async (url) => {
    callLog.push(url);
    if (url.includes('/me/permissions')) {
      return { status: 200, data: { data: [
        { permission: 'pages_show_list', status: 'granted' },
        { permission: 'business_management', status: 'declined' },
      ]}};
    }
    if (url.includes('/me/accounts')) {
      return { status: 200, data: { data: [] } };
    }
    return { status: 200, data: { id: 'me' } };
  });

  try {
    const options = await metaOAuth.discoverAccountOptions('test_token');
    assert.ok(!callLog.some(u => u.includes('/me/businesses')), 'Should NOT call /me/businesses');
    assert.strictEqual(options.length, 0, 'Should return zero options');
  } finally { metaOAuth.setHttpGet(null); }
});

// ═══════════════════════════════════════
// 7. Declined pages_show_list
// ═══════════════════════════════════════

test('getGrantedPermissions separates granted and declined', async () => {
  const env = cacheEnv();
  process.env.NODE_ENV = 'test';
  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/permissions')) {
      return { status: 200, data: { data: [
        { permission: 'instagram_basic', status: 'granted' },
        { permission: 'pages_show_list', status: 'declined' },
        { permission: 'business_management', status: 'granted' },
        { permission: 'pages_read_engagement', status: 'declined' },
      ]}};
    }
    return { status: 200, data: { id: 'me' } };
  });
  try {
    const perms = await metaOAuth.getGrantedPermissions('test_token');
    assert.deepStrictEqual(perms.granted.sort(), ['business_management', 'instagram_basic'].sort());
    assert.deepStrictEqual(perms.declined.sort(), ['pages_read_engagement', 'pages_show_list'].sort());
  } finally { metaOAuth.setHttpGet(null); }
});

test('discoverAccountOptions returns empty when pages_show_list is declined', async () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_123';
  process.env.META_CONFIG_ID = 'config_456';
  process.env.META_APP_SECRET = 'secret';
  process.env.NODE_ENV = 'test';

  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/permissions')) {
      return { status: 200, data: { data: [
        { permission: 'pages_show_list', status: 'declined' },
        { permission: 'business_management', status: 'granted' },
      ]}};
    }
    if (url.includes('/me/accounts')) {
      return { status: 200, data: { data: [] } };
    }
    return { status: 200, data: { id: 'me' } };
  });

  try {
    const options = await metaOAuth.discoverAccountOptions('test_token');
    assert.strictEqual(options.length, 0);
  } finally { metaOAuth.setHttpGet(null); }
});

// ═══════════════════════════════════════
// 8. getPages returns inline IG
// ═══════════════════════════════════════

test('getPages returns inline instagram_business_account via /me/accounts', async () => {
  const env = cacheEnv();
  process.env.NODE_ENV = 'test';
  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/accounts')) {
      return { status: 200, data: { data: [
        { id: 'pg1', name: 'Main Page', access_token: 'EAAtok1',
          picture: { data: { url: 'https://pics.com/a.jpg' } },
          instagram_business_account: { id: 'ig1', username: 'main_ig', name: 'Main IG' } },
      ]}};
    }
    return { status: 200, data: { id: 'me' } };
  });
  try {
    const pages = await metaOAuth.getPages('test_token');
    assert.strictEqual(pages.length, 1);
    assert.strictEqual(pages[0].id, 'pg1');
    assert.strictEqual(pages[0].instagram_business_account.id, 'ig1');
    assert.strictEqual(pages[0].instagram_business_account.username, 'main_ig');
  } finally { metaOAuth.setHttpGet(null); }
});

// ═══════════════════════════════════════
// 9. Permissions diagnostics
// ═══════════════════════════════════════

test('getGrantedPermissions handles empty response gracefully', async () => {
  const env = cacheEnv();
  process.env.NODE_ENV = 'test';
  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/permissions')) return { status: 200, data: { data: [] } };
    return { status: 200, data: { id: 'me' } };
  });
  try {
    const perms = await metaOAuth.getGrantedPermissions('test_token');
    assert.deepStrictEqual(perms.granted, []);
    assert.deepStrictEqual(perms.declined, []);
  } finally { metaOAuth.setHttpGet(null); }
});

test('getGrantedPermissions handles API error gracefully', async () => {
  const env = cacheEnv();
  process.env.NODE_ENV = 'test';
  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/permissions')) return { status: 500, data: {} };
    return { status: 200, data: { id: 'me' } };
  });
  try {
    const perms = await metaOAuth.getGrantedPermissions('test_token');
    assert.deepStrictEqual(perms.granted, []);
  } finally { metaOAuth.setHttpGet(null); }
});

// ═══════════════════════════════════════
// 10. discoverBusinessPages handles failures
// ═══════════════════════════════════════

test('discoverBusinessPages returns [] when /me/businesses fails', async () => {
  const env = cacheEnv();
  process.env.NODE_ENV = 'test';
  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/businesses')) return { status: 403, data: { error: { message: 'Forbidden' } } };
    return { status: 200, data: { id: 'me' } };
  });
  try {
    const pages = await metaOAuth.discoverBusinessPages('test_token');
    assert.deepStrictEqual(pages, []);
  } finally { metaOAuth.setHttpGet(null); }
});

test('discoverBusinessPages returns [] when /me/businesses is empty', async () => {
  const env = cacheEnv();
  process.env.NODE_ENV = 'test';
  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('/me/businesses')) return { status: 200, data: { data: [] } };
    return { status: 200, data: { id: 'me' } };
  });
  try {
    const pages = await metaOAuth.discoverBusinessPages('test_token');
    assert.deepStrictEqual(pages, []);
  } finally { metaOAuth.setHttpGet(null); }
});

// ═══════════════════════════════════════
// 11. Regressions
// ═══════════════════════════════════════

test('YouTube integration still exists', async () => {
  const [[row]] = await pool.query('SELECT * FROM social_integrations WHERE provider = ?', ['youtube']);
  assert.ok(row, 'YouTube integration must exist');
});

test('TikTok integration still exists', async () => {
  const [[row]] = await pool.query('SELECT * FROM social_integrations WHERE provider = ?', ['tiktok']);
  assert.ok(row, 'TikTok integration must exist');
});

test('exchangeCodeForToken still works (regression)', async () => {
  const env = cacheEnv();
  process.env.META_APP_ID = 'app_regression';
  process.env.META_APP_SECRET = 'secret_regression';
  process.env.NODE_ENV = 'test';

  metaOAuth.setHttpPost(async () => ({ status: 200, data: { access_token: 'short_lived_token' } }));
  metaOAuth.setHttpGet(async (url) => {
    if (url.includes('fb_exchange_token')) return { status: 200, data: { access_token: 'long_lived_token', expires_in: 5184000 } };
    return { status: 200, data: { id: 'me' } };
  });

  try {
    const stateId = crypto.randomBytes(16).toString('hex');
    await metaOAuth.persistState(stateId, 'instagram', 'test_sess');
    const tokenData = await metaOAuth.exchangeCodeForToken('test_code', stateId, 'test_sess');
    assert.strictEqual(tokenData.accessToken, 'long_lived_token');
    assert.strictEqual(tokenData.expiresIn, 5184000);
    assert.strictEqual(tokenData.provider, 'instagram');
  } finally {
    metaOAuth.setHttpPost(null);
    metaOAuth.setHttpGet(null);
    restoreEnv(env);
    await pool.query('DELETE FROM social_oauth_states WHERE provider = ?', ['instagram']);
  }
});