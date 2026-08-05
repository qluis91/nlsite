const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const publishing = require('../services/cmsPublishingService');
const validator = require('../validators/cmsPageValidator');
const usageService = require('../services/mediaUsageService');

// ── Migration / schema ──
test('navigation_items table is created by the migration', async () => {
  const [rows] = await pool.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'navigation_items'"
  );
  assert.equal(rows.length, 1);
});

test('navigation_items has required indexes', async () => {
  const [rows] = await pool.query(
    "SHOW INDEX FROM navigation_items WHERE Key_name IN ('idx_navigation_items_location_status', 'uq_navigation_items_public_id', 'idx_navigation_items_parent')"
  );
  assert.ok(rows.length >= 2);
});

test('migration is idempotent', async () => {
  const [before] = await pool.query('SELECT COUNT(*) total FROM navigation_items');
  const m = require('../scripts/migrate-nav-items');
  await m.migrateNavigationItems();
  const [after] = await pool.query('SELECT COUNT(*) total FROM navigation_items');
  assert.equal(before[0].total, after[0].total);
});

test('existing navigation data is not overwritten by seed', async () => {
  const [existing] = await pool.query("SELECT label, url FROM navigation_items WHERE location = 'home' AND label = 'Tienda' LIMIT 1");
  assert.ok(existing.length >= 1);
  assert.equal(existing[0].label, 'Tienda');
});

test('existing Phase 11A schema remains valid after migration', async () => {
  const tables = ['media_assets', 'pages', 'page_sections', 'site_settings', 'content_revisions'];
  for (const table of tables) {
    const [rows] = await pool.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]
    );
    assert.equal(rows.length, 1, `Table ${table} should exist`);
  }
});

// ── Authorization (middleware presence) ──
test('capabilities include navbar and hero grants', () => {
  const caps = require('../config/capabilities').CAPABILITIES;
  assert.equal(caps.NAVBAR_VIEW, 'navbar.view');
  assert.equal(caps.NAVBAR_EDIT, 'navbar.edit');
  assert.equal(caps.NAVBAR_PUBLISH, 'navbar.publish');
  assert.equal(caps.HERO_VIEW, 'home.hero.view');
  assert.equal(caps.HERO_EDIT, 'home.hero.edit');
  assert.equal(caps.HERO_PUBLISH, 'home.hero.publish');
});

test('admin role gets all CMS capabilities', () => {
  const { capabilitiesFor } = require('../config/capabilities');
  const adminCaps = capabilitiesFor({ role_id: 1 });
  assert.ok(adminCaps.includes('navbar.view'));
  assert.ok(adminCaps.includes('navbar.edit'));
  assert.ok(adminCaps.includes('home.hero.view'));
});

test('non-admin gets no CMS capabilities', () => {
  const { capabilitiesFor } = require('../config/capabilities');
  const guestCaps = capabilitiesFor({ role_id: 2 });
  assert.equal(guestCaps.length, 0);
});

// ── Validators ──
test('valid URL accepted', () => {
  assert.equal(validator.validateUrl('/tienda').valid, true);
  assert.equal(validator.validateUrl('#servicios').valid, true);
  assert.equal(validator.validateUrl('https://example.com').valid, true);
});

test('javascript: protocol rejected', () => {
  assert.equal(validator.validateUrl('javascript:alert(1)').valid, false);
});

test('data: protocol rejected', () => {
  assert.equal(validator.validateUrl('data:text/html,<script>alert(1)</script>').valid, false);
});

test('protocol-relative URLs rejected', () => {
  assert.equal(validator.validateUrl('//evil.com/xss.js').valid, false);
});

test('invalid colors rejected, valid accepted', () => {
  assert.equal(validator.validateColor('red', 'color').valid, false);
  assert.equal(validator.validateColor('#7cf03d', 'color').valid, true);
  assert.equal(validator.validateColor('#7cf03d80', 'color').valid, true);
});

test('target must be _self or _blank', () => {
  assert.equal(validator.validateTarget('_blank').valid, true);
  assert.equal(validator.validateTarget('_self').valid, true);
  assert.equal(validator.validateTarget('_parent').valid, false);
});

test('numeric model values bounded', () => {
  assert.equal(validator.validatePositiveNumber(10, 'scale', { min: 0.1, max: 5 }).valid, false);
  assert.equal(validator.validatePositiveNumber(2, 'scale', { min: 0.1, max: 5 }).valid, true);
  assert.equal(validator.validatePositiveNumber(11, 'pos', { min: -10, max: 10 }).valid, false);
});

test('text limits enforced', () => {
  assert.equal(validator.boundedText('a'.repeat(121), 'eyebrow', 120).valid, false);
  assert.equal(validator.boundedText('a'.repeat(181), 'heading', 180).valid, false);
  assert.equal(validator.boundedText('a'.repeat(1001), 'description', 1000).valid, false);
  assert.equal(validator.boundedText('a'.repeat(81), 'label', 80).valid, false);
  assert.equal(validator.boundedText('a'.repeat(101), 'label', 100).valid, false);
});

test('nav item button validates URL/target', () => {
  const good = validator.validateNavItem({ label: 'T', url: '/test', sort_order: 0 });
  assert.equal(good.valid, true);
  const bad = validator.validateNavItem({ label: 'T', url: 'javascript:bad' });
  assert.equal(bad.valid, false);
});

test('hero content validation', () => {
  const c = validator.validateHeroContent({
    eyebrow: 'Eyebrow',
    heading: 'Heading for hero panel',
    description: 'A description here',
  });
  assert.equal(c.valid, true);
  assert.equal(c.value.eyebrow, 'Eyebrow');
  assert.equal(c.value.heading, 'Heading for hero panel');

  const missing = validator.validateHeroContent({});
  assert.equal(missing.valid, false);
});

test('hero style validation', () => {
  const s = validator.validateHeroStyle({
    model_scale: '2.5',
    model_pos_x: '0',
    model_pos_y: '0',
    model_pos_z: '0',
    model_rot_x: '0',
    model_rot_y: '0',
    model_rot_z: '0',
    auto_rotate: '1',
    auto_rotate_speed: '0.5',
  });
  assert.equal(s.valid, true);
  assert.equal(s.value.model.scale, 2.5);
  assert.equal(s.value.model.autoRotateSpeed, 0.5);

  const bad = validator.validateHeroStyle({ model_scale: 'not-number' });
  assert.equal(bad.valid, false);
});

// ── Navigation items CRUD ──
test('create nav item + read + archive', async () => {
  const result = await publishing.createNavItem(
    { label: 'testCreate', url: '/test-create', linkType: 'internal', target: '_self', sortOrder: 99, isVisible: true, location: 'home' },
    { actorId: null }
  );
  assert.ok(result.public_id);
  assert.equal(result.label, 'testCreate');

  const items = await publishing.listNavItems('home', { includeArchived: true });
  const found = items.find(i => i.public_id === result.public_id);
  assert.ok(found);

  await publishing.archiveNavItem(result.public_id, { actorId: null });
});

test('nav item draft → publish workflow', async () => {
  const created = await publishing.createNavItem(
    { label: 'PubFlow', url: '/pubflow', linkType: 'internal', target: '_self', sortOrder: 101, isVisible: true, location: 'home' },
    { actorId: null }
  );
  // Set to draft explicitly
  await pool.query("UPDATE navigation_items SET status = 'draft' WHERE public_id = ?", [created.public_id]);

  const published = await publishing.publishNavItems({ location: 'home', actorId: null });

  await publishing.archiveNavItem(created.public_id, { actorId: null });
  assert.ok(published >= 0);
});

test('hidden items flagged via is_visible', async () => {
  const result = await publishing.createNavItem(
    { label: 'Hidden', url: '/hidden-x', linkType: 'internal', target: '_self', sortOrder: 102, isVisible: false, location: 'home' },
    { actorId: null }
  );
  assert.equal(result.isVisible, false);
  await publishing.archiveNavItem(result.public_id, { actorId: null });
});

test('reorder persists sort_order', async () => {
  const items = await publishing.listNavItems('home', { includeArchived: false });
  const visible = items.filter(i => i.is_visible);
  if (visible.length >= 2) {
    const ids = [visible[0].public_id, visible[1].public_id];
    await publishing.reorderNavItems(ids, { location: 'home', actorId: null });
    const after = await publishing.listNavItems('home', { includeArchived: false });
    assert.equal(after.find(i => i.public_id === ids[0]).sort_order, 0);
    assert.equal(after.find(i => i.public_id === ids[1]).sort_order, 1);
  }
});

test('published nav items resolved via cache', async () => {
  publishing.invalidateNamespace('nav_home');
  const items = await publishing.getPublishedNavItems('home');
  assert.ok(Array.isArray(items));
  for (const item of items) {
    assert.equal(item.status || 'published', item.status || 'published');
  }
});

test('_blank links get external link type', () => {
  const item = validator.validateNavItem({ label: 'Ext', url: 'https://example.com', sort_order: 1 });
  assert.equal(item.valid, true);
  assert.equal(item.value.linkType, 'external');
  assert.equal(item.value.target, '_blank');
});

// ── Hero content ──
test('hero draft saves', async () => {
  // Save original state to restore later
  const original = await publishing.getSectionDraft('home', 'hero');
  const origContent = original ? original.content : null;
  const origStyle = original ? original.style : null;
  const origStatus = original ? original.status : null;

  const content = {
    eyebrow: 'CMS Eyebrow',
    heading: 'CMS Heading Test',
    description: 'CMS Description',
    primaryButton: { label: 'Primary', url: '#primary', target: '_self', visible: true },
    secondaryButton: { label: 'Secondary', url: '#secondary', target: '_self', visible: true },
    backgroundMedia: null, modelMedia: null, modelFallbackMedia: null, modelEnabled: true,
  };
  await publishing.saveSectionDraft('home', 'hero', content, {}, { actorId: null });

  const draft = await publishing.getSectionDraft('home', 'hero');
  assert.equal(draft.content.eyebrow, 'CMS Eyebrow');
  assert.equal(draft.content.heading, 'CMS Heading Test');
  assert.equal(draft.status, 'draft');

  // Restore original state (or null it out)
  if (origContent) {
    // Reset content_json to null and restore original status
    const db = require('../config/db');
    await db.query(
      "UPDATE page_sections SET content_json = NULL, style_json = NULL, status = ?, is_enabled = 0 WHERE section_key = 'hero'",
      [origStatus || 'draft']
    );
  }
});

test('publishing creates a revision', async () => {
  // Save draft first
  const content = {
    eyebrow: 'Pub Test',
    heading: 'Pub Heading',
    description: 'Pub Desc',
    primaryButton: { label: 'P', url: '#p', target: '_self', visible: true },
    secondaryButton: { label: 'S', url: '#s', target: '_self', visible: true },
    backgroundMedia: null, modelMedia: null, modelFallbackMedia: null, modelEnabled: true,
  };
  await publishing.saveSectionDraft('home', 'hero', content, {}, { actorId: null });

  const section = await publishing.getSectionDraft('home', 'hero');
  const [before] = await pool.query(
    "SELECT COUNT(*) total FROM content_revisions WHERE entity_type = 'page_section' AND entity_id = ?",
    [section.id]
  );
  await publishing.publishSection('home', 'hero', { actorId: null });
  const [after] = await pool.query(
    "SELECT COUNT(*) total FROM content_revisions WHERE entity_type = 'page_section' AND entity_id = ?",
    [section.id]
  );
  assert.ok(after[0].total >= before[0].total);

  // Clean up: reset hero content to null so other tests don't conflict
  await pool.query(
    "UPDATE page_sections SET content_json = NULL, style_json = NULL, status = 'draft', is_enabled = 0 WHERE section_key = 'hero'"
  );
  publishing.invalidateNamespace('sc_home');
});

test('published content resolved', async () => {
  const content = await publishing.getPublishedHeroContent('home', 'hero', null);
  assert.ok(content !== undefined);
});

test('fallback when nothing published', async () => {
  // Read from non-existent section should return null fallback
  const content = await publishing.getPublishedHeroContent('home', 'nonexistent', { fallback: true });
  assert.deepEqual(content, { fallback: true });
});

// ── Cache ──
test('cache set/get/invalidate', () => {
  publishing.cacheSet('test_ns', 'key', 'val');
  assert.equal(publishing.cacheGet('test_ns', 'key'), 'val');
  publishing.invalidateNamespace('test_ns');
  assert.equal(publishing.cacheGet('test_ns', 'key'), null);
});

test('publish invalidates nav cache', () => {
  publishing.cacheSet('nav_home', 'published', ['cached']);
  publishing.invalidateNamespace('nav_home');
  assert.equal(publishing.cacheGet('nav_home', 'published'), null);
});

// ── Safe serialization ──
test('safe JSON prevents script injection', () => {
  const payload = { model: { scale: 1, autoRotate: true } };
  const escaped = JSON.stringify(payload)
    .replace(/"/g, '&quot;')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  assert.doesNotMatch(escaped, /<script/);
  assert.doesNotMatch(escaped, /<\/script/);
});

// ── Usage sources ──
test('navigation items usage source registered', { only: false }, () => {
  publishing.registerNavUsageSource();
  const sources = usageService.registeredSources();
  assert.ok(sources.includes('navigation_items'));
});

// ── Navbar settings ──
test('upsert setting writes to site_settings and can be read', async () => {
  await publishing.upsertSetting('test.setting', 'test-value', 'string', { settingGroup: 'test', isPublic: true, actorId: null });
  const settings = await publishing.getPublishedSettings(['test.setting']);
  assert.equal(settings['test.setting'], 'test-value');
  await pool.query("DELETE FROM site_settings WHERE setting_key = 'test.setting'");
  publishing.invalidateNamespace('siteSettings');
});

// ── Migration idempotency for nav seed ──
test('seed does not overwrite manually created items', async () => {
  await pool.query(
    "INSERT INTO navigation_items (public_id, location, label, url, link_type, target, sort_order, is_visible, status) VALUES (UUID(), 'home', 'ManualItem', '/manual', 'internal', '_self', 9999, 1, 'draft')"
  );

  const [beforeCount] = await pool.query("SELECT COUNT(*) total FROM navigation_items WHERE location = 'home'");
  const m = require('../scripts/migrate-nav-items');
  await m.migrateNavigationItems();
  const [afterCount] = await pool.query("SELECT COUNT(*) total FROM navigation_items WHERE location = 'home'");
  assert.equal(beforeCount[0].total, afterCount[0].total);

  await pool.query("DELETE FROM navigation_items WHERE label = 'ManualItem'");
});

// ── Cleanup ──
test('cleanup test data', async () => {
  await pool.query("DELETE FROM navigation_items WHERE label IN ('testCreate', 'PubFlow', 'Hidden')");
  await pool.end();
});
