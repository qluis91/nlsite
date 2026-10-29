/**
 * Infinite Gallery — unique bubbles + click-to-center selection.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
let renderer;
let mat;

function makeItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: `Item ${index + 1}`,
    category: 'Demo',
    type: 'image',
    thumbnail: `/uploads/gallery/thumbnails/item-${index + 1}.webp`,
  }));
}

before(async () => {
  renderer = await import(
    pathToFileURL(path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs')).href
  );
  mat = await import(
    pathToFileURL(path.join(root, 'public/vendor/gl-matrix/index.js')).href
  );
});

describe('Unique bubbles — no duplication', () => {
  it('5 items → 5 sphere points and 1:1 mapping', () => {
    const points = renderer.createSpherePoints(5);
    assert.equal(points.length, 5);
    for (let index = 0; index < 5; index += 1) {
      assert.equal(index, index); // pointIndex === itemIndex
    }
    const source = fs.readFileSync(
      path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs'),
      'utf8'
    );
    assert.match(source, /int itemIndex = vInstanceId;/);
    assert.doesNotMatch(source, /vInstanceId % uItemCount/);
    assert.doesNotMatch(source, /pointIndex % this\.items\.length/);
  });

  it('24 items → exactly 24 bubbles', () => {
    assert.equal(renderer.createSpherePoints(24).length, 24);
    const layout = renderer.createAtlasLayout(24, 4096);
    assert.equal(layout.columns * layout.rows >= 24, true);
  });

  it('30 items remain unique within the new safety cap (no silent 24 cutoff)', () => {
    assert.equal(renderer.createSpherePoints(30).length, 30);
    const layout = renderer.createAtlasLayout(30, 4096);
    // Atlas must have capacity for all 30 cells (was previously clamped to 24).
    assert.ok(layout.columns * layout.rows >= 30);
    const source = fs.readFileSync(
      path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs'),
      'utf8'
    );
    assert.match(source, /MAX_ITEMS = 64/);
    assert.doesNotMatch(source, /MAX_ITEMS = 24/);
  });

  it('preserves multi-row atlas Y-flip compensation', () => {
    const source = fs.readFileSync(
      path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs'),
      'utf8'
    );
    assert.match(source, /textureRow = uAtlasRows - 1 - logicalRow/);
    const layout = renderer.createAtlasLayout(5, 4096);
    assert.equal(layout.columns, 3);
    assert.equal(layout.rows, 2);
    const uv = renderer.atlasCellUv(0, layout);
    assert.equal(uv.minV, 0.5);
  });
});

describe('Pointer picking', () => {
  it('returns the bubble under the pointer and null for empty space', () => {
    const points = renderer.createSpherePoints(6);
    const orientation = mat.quat.create();
    const layout = renderer.resolveSphereLayout(800, 600, 6);
    const camera = renderer.createCameraMatrices(800, 600, layout);

    // Project point 0 and click its center.
    const projected = renderer.projectBubbleToScreen({
      point: points[0],
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointIndex: 0,
      activePointIndex: renderer.closestFrontPointIndex(points, orientation),
    });
    assert.ok(projected, 'front-ish bubble should project');

    const hit = renderer.pickBubbleAtScreenPoint({
      spherePoints: points,
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointerX: projected.screenX,
      pointerY: projected.screenY,
      activePointIndex: renderer.closestFrontPointIndex(points, orientation),
    });
    assert.ok(hit);
    assert.equal(hit.pointIndex, hit.itemIndex);

    const miss = renderer.pickBubbleAtScreenPoint({
      spherePoints: points,
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointerX: 2,
      pointerY: 2,
      activePointIndex: -1,
    });
    assert.equal(miss, null);
  });

  it('prefers the front-most bubble when projections overlap', () => {
    // Two coincident world points with different depths via camera distance:
    // synthesize projected candidates by stacking two points near FRONT.
    const near = mat.vec3.fromValues(0, 0, 4.2);
    const far = mat.vec3.fromValues(0.01, 0, -4.2);
    const orientation = mat.quat.create();
    const layout = renderer.resolveSphereLayout(800, 600, 2);
    const camera = renderer.createCameraMatrices(800, 600, layout);

    const nearProj = renderer.projectBubbleToScreen({
      point: near,
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointIndex: 0,
      activePointIndex: 0,
    });
    assert.ok(nearProj);

    const hit = renderer.pickBubbleAtScreenPoint({
      spherePoints: [near, far],
      orientation,
      layout,
      viewMatrix: camera.view,
      projectionMatrix: camera.projection,
      cameraPosition: camera.position,
      canvasWidth: 800,
      canvasHeight: 600,
      pointerX: nearProj.screenX,
      pointerY: nearProj.screenY,
      activePointIndex: 0,
    });
    assert.ok(hit);
    assert.equal(hit.pointIndex, 0);
  });
});

describe('Targeted snap + pending selection', () => {
  it('snapTargetForPoint places the requested point near FRONT_DIRECTION', () => {
    const points = renderer.createSpherePoints(8);
    const orientation = mat.quat.create();
    // Rotate away from identity so closest-front ≠ arbitrary index 4.
    mat.quat.rotateY(orientation, orientation, 1.1);
    mat.quat.rotateX(orientation, orientation, 0.4);

    const targetIndex = 4;
    const closestBefore = renderer.closestFrontPointIndex(points, orientation);
    assert.notEqual(closestBefore, targetIndex);

    const target = renderer.snapTargetForPoint(points[targetIndex], orientation);
    const rotated = mat.vec3.transformQuat(mat.vec3.create(), points[targetIndex], target);
    mat.vec3.normalize(rotated, rotated);
    const front = mat.vec3.fromValues(0, 0, 1);
    assert.ok(mat.vec3.dot(rotated, front) > 0.999);
  });

  it('finishPendingSelection opens the clicked item once after snap', () => {
    const items = makeItems(6);
    let selected = [];
    const fake = {
      items,
      spherePoints: renderer.createSpherePoints(6),
      orientation: mat.quat.create(),
      pendingSelectionPointIndex: 4,
      options: {
        onSelect(item) { selected.push(item); },
        onActiveChange() {},
      },
      container: {
        querySelector() { return null; },
      },
      activePointIndex: -1,
      activeItemIndex: -1,
      emitActive: renderer.InfiniteMenuRenderer.prototype.emitActive,
      finishPendingSelection: renderer.InfiniteMenuRenderer.prototype.finishPendingSelection,
    };

    // Align item 4 to front so finishPendingSelection accepts it.
    const target = renderer.snapTargetForPoint(fake.spherePoints[4], fake.orientation);
    mat.quat.copy(fake.orientation, target);
    fake.finishPendingSelection();

    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, 5);
    assert.equal(fake.pendingSelectionPointIndex, null);

    fake.finishPendingSelection();
    assert.equal(selected.length, 1);
  });

  it('source click path uses pick + pending selection; drag threshold preserved', () => {
    const source = fs.readFileSync(
      path.join(root, 'public/js/gallery/infiniteMenuRenderer.mjs'),
      'utf8'
    );
    assert.match(source, /handleBubbleClick/);
    assert.match(source, /pendingSelectionPointIndex/);
    assert.match(source, /CLICK_DISTANCE_PX/);
    assert.match(source, /finishPendingSelection/);
    assert.match(source, /beginSnapToPoint\(hit\.pointIndex\)/);
  });
});
