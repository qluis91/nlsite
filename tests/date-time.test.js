/**
 * Costa Rica display-time helper.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatDateTimeCR, COSTA_RICA_TIME_ZONE } = require('../utils/dateTime');

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\u202f|\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

describe('formatDateTimeCR', () => {
  it('uses America/Costa_Rica timezone', () => {
    assert.equal(COSTA_RICA_TIME_ZONE, 'America/Costa_Rica');
  });

  it('formats UTC instant as Costa Rica local time', () => {
    const label = normalizeLabel(formatDateTimeCR('2026-10-29T23:29:56.000Z'));
    assert.match(label, /29\/10\/2026/);
    assert.match(label, /5:29:56/);
    assert.match(label, /p\.\s*m\./);
  });

  it('returns empty string for invalid or empty values', () => {
    assert.equal(formatDateTimeCR(''), '');
    assert.equal(formatDateTimeCR(null), '');
    assert.equal(formatDateTimeCR('not-a-date'), '');
  });
});

describe('admin quote views use prepared createdAtLabel', () => {
  it('controller prepares createdAtLabel via formatDateTimeCR', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/adminQuoteRequestController.js'),
      'utf8'
    );
    assert.match(src, /formatDateTimeCR/);
    assert.match(src, /createdAtLabel/);
  });

  it('EJS templates do not call toLocaleString es-CR for quote timestamps', () => {
    const index = fs.readFileSync(
      path.join(__dirname, '../views/pages/admin/quotes/index.ejs'),
      'utf8'
    );
    const detail = fs.readFileSync(
      path.join(__dirname, '../views/pages/admin/quotes/detail.ejs'),
      'utf8'
    );
    assert.match(index, /createdAtLabel/);
    assert.match(detail, /createdAtLabel/);
    assert.doesNotMatch(index, /toLocaleString\(['"]es-CR['"]\)/);
    assert.doesNotMatch(detail, /toLocaleString\(['"]es-CR['"]\)/);
  });
});
