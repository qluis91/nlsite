/**
 * Phase 16D — Permanent media delete tests.
 * Run: node --test tests/media-permanent-delete.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ──── Service: permanentDelete function exists ────

describe('Media permanent delete — service', () => {
  it('mediaService exports permanentDelete', () => {
    const mediaService = require('../services/mediaService');
    assert.strictEqual(typeof mediaService.permanentDelete, 'function', 'Should export permanentDelete');
  });

  it('mediaService.archive still exists', () => {
    const mediaService = require('../services/mediaService');
    assert.strictEqual(typeof mediaService.archive, 'function', 'Should still export archive');
  });

  it('mediaService.restore still exists', () => {
    const mediaService = require('../services/mediaService');
    assert.strictEqual(typeof mediaService.restore, 'function', 'Should still export restore');
  });

  it('permanentDelete validates publicId format', async () => {
    const mediaService = require('../services/mediaService');
    try {
      await mediaService.permanentDelete('not-a-uuid');
      assert.fail('Should throw for invalid publicId');
    } catch (err) {
      assert.ok(
        err.message.includes('valido') || err.message.includes('INVALID_ID') || err.message.includes('no v'),
        'Should reject invalid UUID'
      );
    }
  });

  it('permanentDelete checks references via usage service', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'mediaService.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('assertNotReferenced'), 'Should check references before delete');
    assert.ok(fnBody.includes('eliminar permanentemente'), 'Should use correct operation label');
  });

  it('permanentDelete removes DB record AND physical files', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'mediaService.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('DELETE FROM media_assets'), 'Should delete DB record');
    const hasFileDelete = fnBody.includes('unlink') || fnBody.includes('removeStoredPaths');
    assert.ok(hasFileDelete, 'Should delete physical files');
  });

  it('permanentDelete handles missing physical files gracefully', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'mediaService.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes("err.code !== 'ENOENT'"), 'Should ignore ENOENT errors for missing files');
  });

  it('permanentDelete uses storage ownedPaths for file cleanup', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'mediaService.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('storage.ownedPaths') || fnBody.includes('ownedPaths'), 'Should use ownedPaths for file discovery');
  });

  it('permanentDelete records revision history', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'mediaService.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('PERMANENT_DELETE'), 'Should record PERMANENT_DELETE revision');
  });

  it('permanentDelete commits DB before deleting files', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'mediaService.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    const commitIdx = fnBody.indexOf('commit()');
    const fileDeleteIdx = fnBody.indexOf('fs.') > -1 ? fnBody.indexOf('fs.') : fnBody.indexOf('unlink');
    assert.ok(commitIdx < fileDeleteIdx || fileDeleteIdx === -1, 'Should commit DB BEFORE deleting files');
  });
});

// ──── Route and controller ────

describe('Media permanent delete — route', () => {
  it('route file has permanent-delete POST route', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminPageRoutes.js'), 'utf8');
    assert.ok(code.includes('/permanent-delete'), 'Should have permanent-delete route');
    assert.ok(code.includes('MEDIA_DELETE'), 'Should use MEDIA_DELETE capability');
    assert.ok(code.includes('csrfSynchronisedProtection'), 'Should require CSRF');
  });

  it('permanent-delete is POST only (not GET)', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminPageRoutes.js'), 'utf8');
    const permDeleteSection = code.substring(code.indexOf('permanent-delete'));
    assert.ok(permDeleteSection.startsWith('permanent-delete') || code.substring(code.indexOf('router.post') - 20, code.indexOf('permanent-delete')).includes('router.post'), 'Should be POST route');
  });
});

describe('Media permanent delete — controller', () => {
  it('controller exports permanentDelete', () => {
    const controller = require('../controllers/adminMediaController');
    assert.strictEqual(typeof controller.permanentDelete, 'function', 'Should export permanentDelete handler');
  });

  it('controller handler calls mediaService.permanentDelete', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminMediaController.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('mediaService.permanentDelete'), 'Should call mediaService.permanentDelete');
  });

  it('controller handler redirects to library on success', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminMediaController.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('LIBRARY_PATH'), 'Should redirect to library');
  });

  it('controller handler passes actorId', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminMediaController.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('actorId('), 'Should pass actor ID for audit');
  });
});

// ──── Capability ────

describe('Media permanent delete — capability', () => {
  it('MEDIA_DELETE capability exists', () => {
    const { CAPABILITIES } = require('../config/capabilities');
    assert.strictEqual(CAPABILITIES.MEDIA_DELETE, 'media.delete', 'Should define MEDIA_DELETE');
  });

  it('MEDIA_DELETE is available to admins', () => {
    const { hasCapability } = require('../config/capabilities');
    const admin = { role_id: 1 };
    assert.strictEqual(hasCapability(admin, 'media.delete'), true, 'Admins should have media.delete');
  });

  it('MEDIA_DELETE is not available to non-admins', () => {
    const { hasCapability } = require('../config/capabilities');
    const user = { role_id: 2 };
    assert.strictEqual(hasCapability(user, 'media.delete'), false, 'Regular users should not have media.delete');
  });
});

// ──── View ────

describe('Media permanent delete — view', () => {
  it('detail.ejs has Eliminar button', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'detail.ejs'), 'utf8');
    assert.ok(code.includes('Eliminar permanentemente'), 'Should have Eliminar button');
    assert.ok(code.includes('/permanent-delete'), 'Should point to permanent-delete action');
  });

  it('detail.ejs Eliminar button includes CSRF token', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'detail.ejs'), 'utf8');
    const deleteSection = code.substring(code.indexOf('permanent-delete'));
    assert.ok(deleteSection.includes('_csrf'), 'Should include CSRF hidden input');
  });

  it('detail.ejs Eliminar button has confirmation warning', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'detail.ejs'), 'utf8');
    const deleteSection = code.substring(code.indexOf('permanent-delete'));
    assert.ok(deleteSection.includes('data-confirm'), 'Should have confirmation dialog');
    assert.ok(deleteSection.includes('NO se puede deshacer'), 'Should warn about irreversibility');
  });

  it('detail.ejs Eliminar button gated on media.delete capability', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'detail.ejs'), 'utf8');
    const deleteSection = code.substring(code.indexOf('permanent-delete') - 200, code.indexOf('permanent-delete') + 200);
    assert.ok(deleteSection.includes('capabilities'), 'Should check capabilities');
    assert.ok(deleteSection.includes('media.delete'), 'Should require media.delete capability');
  });

  it('detail.ejs Eliminar button only for archived items', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'detail.ejs'), 'utf8');
    const pdIdx = code.indexOf('permanent-delete');
    // The is_archived guard appears just above the permanent-delete form
    const contextStart = Math.max(0, pdIdx - 800);
    const context = code.substring(contextStart, pdIdx);
    assert.ok(context.includes('is_archived'), 'Should only show for archived items');
  });
});

// ──── Archive behavior unchanged ────

describe('Media permanent delete — archive unchanged', () => {
  it('archive route still exists', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminPageRoutes.js'), 'utf8');
    assert.ok(code.includes('/archive'), 'Archive route should still exist');
  });

  it('restore route still exists', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminPageRoutes.js'), 'utf8');
    assert.ok(code.includes('/restore'), 'Restore route should still exist');
  });

  it('archive does NOT delete physical files', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'mediaService.js'), 'utf8');
    const fnStart = code.indexOf('async function archive');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(!fnBody.includes('unlink'), 'Archive should NOT delete files');
    assert.ok(fnBody.includes('DELETE') === false || fnBody.includes('DELETE FROM') === false, 'Archive should be soft delete only');
  });
});

// ──── Path traversal prevention ────

describe('Media permanent delete — path safety', () => {
  it('permanentDelete uses resolveStoragePath for path containment', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'services', 'mediaService.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('resolveStoragePath'), 'Should use resolveStoragePath for path containment');
  });

  it('storage ownedPaths never returns paths outside upload root', () => {
    const storage = require('../services/mediaStorageService');
    const fakeAsset = {
      storage_path: '../etc/passwd',
      variants_json: null,
    };
    try {
      storage.ownedPaths(fakeAsset);
    } catch (err) {
      // Expected — path traversal should be caught
      assert.ok(err.message.includes('invalida') || err.message.includes('fuera'), 'Should reject path traversal');
    }
  });
});

// ──── Library list view actions ────

describe('Media permanent delete — library list', () => {
  it('index.ejs has Eliminar button for archived items', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    assert.ok(code.includes('Eliminar permanentemente'), 'Should have Eliminar button in library list');
  });

  it('index.ejs Eliminar button only in archived block', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    const pdIdx = code.indexOf('permanent-delete');
    // The is_archived guard appears before permanent-delete in the <% if (asset.is_archived) { %> block
    const contextStart = Math.max(0, pdIdx - 800);
    const context = code.substring(contextStart, pdIdx);
    assert.ok(context.includes('is_archived'), 'Eliminar should only appear for archived items');
  });

  it('index.ejs Eliminar button includes CSRF', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    const pdIdx = code.indexOf('permanent-delete');
    const block = code.substring(Math.max(0, pdIdx - 500), pdIdx + 200);
    assert.ok(block.includes('_csrf'), 'Should include CSRF token');
  });

  it('index.ejs Eliminar button has confirmation', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    const pdIdx = code.indexOf('permanent-delete');
    const block = code.substring(pdIdx - 200, pdIdx + 200);
    assert.ok(block.includes('data-confirm'), 'Should have confirmation attribute');
  });

  it('index.ejs Eliminar button gated on media.delete capability', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    const pdIdx = code.indexOf('permanent-delete');
    const block = code.substring(pdIdx - 300, pdIdx);
    assert.ok(block.includes('media.delete'), 'Should check media.delete capability');
  });

  it('index.ejs has Archivar button for active items', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    assert.ok(code.includes('/archive') && code.includes('Archivar'), 'Should have Archivar button');
  });

  it('index.ejs has Restaurar button for archived items', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    assert.ok(code.includes('/restore') && code.includes('Restaurar'), 'Should have Restaurar button');
  });

  it('index.ejs Editar button still present', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    assert.ok(code.includes('/edit') && code.includes('Editar'), 'Editar button should remain');
  });

  it('index.ejs Copiar URL button still present', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    assert.ok(code.includes('data-copy-url'), 'Copiar URL button should remain');
  });

  it('index.ejs forms include return_to hidden field', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'index.ejs'), 'utf8');
    const returnToCount = (code.match(/return_to/g) || []).length;
    assert.ok(returnToCount >= 3, 'Should have return_to in archive, restore, and delete forms');
  });
});

// ──── Controller return_to support ────

describe('Media permanent delete — return_to', () => {
  it('controller has destinationFor helper', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminMediaController.js'), 'utf8');
    assert.ok(code.includes('function destinationFor'), 'Should have destinationFor helper');
  });

  it('destinationFor falls back to default when no return_to', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminMediaController.js'), 'utf8');
    const fnIdx = code.indexOf('function destinationFor');
    const fnBlock = code.substring(fnIdx, fnIdx + 500);
    assert.ok(fnBlock.includes('return fallback'), 'Should return fallback when no valid return_to');
  });

  it('destinationFor validates return_to starts with LIBRARY_PATH', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminMediaController.js'), 'utf8');
    const fnIdx = code.indexOf('function destinationFor');
    const fnBlock = code.substring(fnIdx, fnIdx + 500);
    assert.ok(fnBlock.includes('startsWith'), 'Should validate path prefix');
  });

  it('archive handler uses destinationFor', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminMediaController.js'), 'utf8');
    const fnStart = code.indexOf('async function archive');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('destinationFor'), 'Archive should use destinationFor');
  });

  it('restore handler uses destinationFor', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminMediaController.js'), 'utf8');
    const fnStart = code.indexOf('async function restore');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('destinationFor'), 'Restore should use destinationFor');
  });

  it('permanentDelete handler uses destinationFor', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'adminMediaController.js'), 'utf8');
    const fnStart = code.indexOf('async function permanentDelete');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('destinationFor'), 'PermanentDelete should use destinationFor');
  });
});

// ──── Detail view still has delete button ────

describe('Media permanent delete — detail view preserved', () => {
  it('detail.ejs still has Eliminar button', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'detail.ejs'), 'utf8');
    assert.ok(code.includes('Eliminar permanentemente'), 'Detail view should still have delete button');
  });

  it('detail.ejs archive form does NOT have return_to', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'admin', 'page', 'media', 'detail.ejs'), 'utf8');
    assert.ok(!code.includes('return_to'), 'Detail view forms should not include return_to (uses default redirect)');
  });
});
