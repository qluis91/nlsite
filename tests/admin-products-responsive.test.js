/**
 * Admin products desktop/mobile visibility and image bounds.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/css/style.css'), 'utf8');
const productsEjs = fs.readFileSync(
  path.join(__dirname, '../views/pages/admin/products.ejs'),
  'utf8'
);

function ruleBlock(selector) {
  const idx = css.indexOf(selector);
  assert.ok(idx >= 0, `missing selector ${selector}`);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(open, close + 1);
}

describe('admin products responsive CSS', () => {
  it('keeps desktop table visible and mobile cards hidden by default', () => {
    assert.match(ruleBlock('.products-desktop'), /display:\s*block/);
    assert.match(ruleBlock('.products-mobile'), /display:\s*none/);
  });

  it('swaps visibility at max-width 768px', () => {
    const mediaIdx = css.indexOf('@media (max-width: 768px)');
    assert.ok(mediaIdx >= 0);
    // Prefer the products-specific media block near products-desktop rules
    const productsIdx = css.indexOf('.products-desktop');
    const mediaNearProducts = css.indexOf('@media (max-width: 768px)', productsIdx);
    assert.ok(mediaNearProducts > productsIdx);
    const block = css.slice(mediaNearProducts, mediaNearProducts + 400);
    assert.match(block, /\.products-desktop\s*\{[^}]*display:\s*none/s);
    assert.match(block, /\.products-mobile\s*\{[^}]*display:\s*grid/s);
  });

  it('bounds mobile card images to 72×72 with contain fit', () => {
    const imgWrap = ruleBlock('.product-card-mobile__img');
    assert.match(imgWrap, /width:\s*72px/);
    assert.match(imgWrap, /height:\s*72px/);
    const img = ruleBlock('.product-card-mobile__img img');
    assert.match(img, /width:\s*100%/);
    assert.match(img, /height:\s*100%/);
    assert.match(img, /object-fit:\s*contain/);
  });

  it('keeps desktop thumbnails at 48×48', () => {
    const thumb = ruleBlock('.thumb-sm');
    assert.match(thumb, /width:\s*48px/);
    assert.match(thumb, /height:\s*48px/);
  });

  it('products template still renders both desktop and mobile markup', () => {
    assert.match(productsEjs, /products-desktop/);
    assert.match(productsEjs, /products-mobile/);
    assert.match(productsEjs, /product-card-mobile__img/);
  });
});
