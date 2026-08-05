const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCollectionPublicationSnapshot,
} = require('../services/publicationService');

test('carousel publication snapshot includes rounded and clamped focal values', () => {
  const snapshot = buildCollectionPublicationSnapshot(
    'home_carousel_items',
    ['title', 'position_x', 'position_y'],
    { title: 'Carousel', position_x: '24.7', position_y: 140 }
  );
  assert.deepEqual(snapshot, { title: 'Carousel', position_x: 25, position_y: 100 });
});

test('legacy carousel publication snapshot defaults each missing focal axis to 50', () => {
  const snapshot = buildCollectionPublicationSnapshot(
    'home_carousel_items',
    ['title', 'position_x', 'position_y'],
    { title: 'Legacy' }
  );
  assert.deepEqual(snapshot, { title: 'Legacy', position_x: 50, position_y: 50 });
});

test('non-carousel publication retains the previous exact selected keys', () => {
  const snapshot = buildCollectionPublicationSnapshot(
    'home_feature_items',
    ['title', 'description', 'optional_label'],
    { title: 'Feature', description: 'Existing', ignored: 'not selected' }
  );
  assert.deepEqual(snapshot, {
    title: 'Feature',
    description: 'Existing',
    optional_label: undefined,
  });
});

test('undefined optional values remain omitted from serialized non-carousel JSON', () => {
  const snapshot = buildCollectionPublicationSnapshot(
    'logo_loop_items',
    ['text_content', 'url'],
    { text_content: 'NinjaLab', url: undefined }
  );
  assert.equal(JSON.stringify(snapshot), '{"text_content":"NinjaLab"}');
});

test('selected unknown future keys survive focal normalization', () => {
  const snapshot = buildCollectionPublicationSnapshot(
    'home_carousel_items',
    ['title', 'future_key', 'position_x', 'position_y'],
    { title: 'Future', future_key: { enabled: true }, position_x: 10, position_y: 90 }
  );
  assert.deepEqual(snapshot.future_key, { enabled: true });
  assert.equal(snapshot.position_x, 10);
  assert.equal(snapshot.position_y, 90);
});

test('focal keys never leak into non-carousel collection snapshots', () => {
  for (const table of [
    'logo_loop_items',
    'home_feature_items',
    'home_social_items',
    'services',
    'social_posts',
    'testimonials',
  ]) {
    const snapshot = buildCollectionPublicationSnapshot(
      table,
      ['title', 'optional'],
      { title: table, position_x: 12, position_y: 88 }
    );
    assert.deepEqual(snapshot, { title: table, optional: undefined });
    assert.equal(Object.hasOwn(snapshot, 'position_x'), false);
    assert.equal(Object.hasOwn(snapshot, 'position_y'), false);
  }
});
