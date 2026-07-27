/**
 * Navbar favicon regression — resolveMediaData column name fix.
 * Run: node --test tests/navbar-favicon-regression.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const controllerSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'controllers', 'adminPageContentController.js'),
  'utf-8'
);

const schemaSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'schema.sql'),
  'utf-8'
);

describe('Navbar admin — resolveMediaData column fix', () => {
  it('media_assets schema has original_name (not original_filename)', () => {
    // Scope to media_assets table only
    const mediaAssetsStart = schemaSrc.indexOf('CREATE TABLE IF NOT EXISTS media_assets');
    const mediaAssetsEnd = schemaSrc.indexOf('\nCREATE TABLE', mediaAssetsStart + 10);
    const mediaAssetsBlock = schemaSrc.slice(mediaAssetsStart, mediaAssetsEnd > 0 ? mediaAssetsEnd : undefined);
    assert.ok(/original_name /.test(mediaAssetsBlock), 'media_assets has original_name column');
    assert.ok(!/original_filename/.test(mediaAssetsBlock), 'media_assets must NOT have original_filename column');
  });

  it('media_assets schema has thumbnail_path (not thumbnail_url)', () => {
    const mediaAssetsStart = schemaSrc.indexOf('CREATE TABLE IF NOT EXISTS media_assets');
    const mediaAssetsEnd = schemaSrc.indexOf('\nCREATE TABLE', mediaAssetsStart + 10);
    const mediaAssetsBlock = schemaSrc.slice(mediaAssetsStart, mediaAssetsEnd > 0 ? mediaAssetsEnd : undefined);
    assert.ok(/thumbnail_path /.test(mediaAssetsBlock), 'media_assets has thumbnail_path column');
    assert.ok(!/thumbnail_url/.test(mediaAssetsBlock), 'media_assets must NOT have thumbnail_url column');
  });

  it('media_assets has width and height columns', () => {
    const mediaAssetsStart = schemaSrc.indexOf('CREATE TABLE IF NOT EXISTS media_assets');
    const mediaAssetsEnd = schemaSrc.indexOf('\nCREATE TABLE', mediaAssetsStart + 10);
    const mediaAssetsBlock = schemaSrc.slice(mediaAssetsStart, mediaAssetsEnd > 0 ? mediaAssetsEnd : undefined);
    assert.ok(/\n\s+width\s+INT/.test(mediaAssetsBlock), 'media_assets has width column');
    assert.ok(/\n\s+height\s+INT/.test(mediaAssetsBlock), 'media_assets has height column');
  });

  it('resolveMediaData maps the shared resolver title to original_filename', () => {
    assert.match(controllerSrc, /original_filename:\s*resolved\.title/);
  });

  it('resolveMediaData maps the shared resolver thumbnail URL', () => {
    assert.match(controllerSrc, /thumbnail_url:\s*resolved\.thumbnailUrl/);
  });

  it('resolveMediaData maps dimensions from the shared resolver', () => {
    assert.match(controllerSrc, /dimensions:\s*resolved\.dimensions/);
  });

  it('resolveMediaData does NOT query bare non-existent columns', () => {
    const fnStart = controllerSrc.indexOf('async function resolveMediaData');
    const fnEnd = controllerSrc.indexOf('\n}\n', fnStart);
    const fnBody = controllerSrc.slice(fnStart, fnEnd);
    const bareCol = fnBody.match(/SELECT[\s\S]*?FROM/);
    if (bareCol) {
      // Remove AS alias targets before checking for bare column names
      const withoutAliases = bareCol[0].replace(/\bAS\s+\w+/g, '');
      assert.doesNotMatch(withoutAliases, /\boriginal_filename\b/);
      assert.doesNotMatch(withoutAliases, /\bthumbnail_url\b/);
      assert.doesNotMatch(withoutAliases, /\bdimensions\b/);
    }
  });

  it('resolveMediaData returns null for falsy/non-media:// refs', () => {
    assert.match(controllerSrc, /!ref\s*\|\|\s*!ref\.startsWith/);
  });

  it('resolveMediaData returns rows[0] || null — never throws on missing', () => {
    assert.match(controllerSrc, /if\s*\(!resolved\)\s*return null/);
  });

  it('navbar.ejs passes selectedDimensions to media-selector', () => {
    const navSrc = fs.readFileSync(
      path.resolve(__dirname, '..', 'views', 'pages', 'admin', 'page', 'navbar.ejs'),
      'utf-8'
    );
    assert.match(navSrc, /selectedDimensions/);
  });
});
